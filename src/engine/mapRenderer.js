/**
 * Zanac EX WebPort - Map & Tilegrid Renderer
 * High-performance tile renderer using a RenderTexture to eliminate seam lines.
 *
 * Implements authentic MSX2 Z80 scroll physics & boss encounter controller:
 * - Cruising speed: 1.0 px/frame (60 Hz)
 * - Deceleration ramp: 8-10 step ease-out curve from ASM Bank 13 0xB3B0 & Bank 3
 * - Boss stationary halt & countdown timer (BCD seconds from ASM Cmd 7 / Cmd 11)
 * - Acceleration rate: +0.02 px/frame (+0x0002 from ASM Bank 14 0x1D6EF)
 */

export class MapRenderer {
  constructor(pixiApp, groundContainer = null) {
    this.app = pixiApp;
    this.gridData = null;
    this.tilesetTexture = null;
    this.tileTextures = [];
    this.container = groundContainer || new PIXI.Container();
    if (!groundContainer) {
      this.app.stage.addChildAt(this.container, 0);
    }

    // Scroll Coordinates & Physics (ASM 0xC09A, 0xC09C, 0xE710)
    this.scrollPosY = 0;
    this.cruiseSpeed = 1.0;
    this.scrollSpeed = 1.0;
    this.targetSpeed = 1.0;
    this.accelRate = 0.02; // +0.02 px/f per frame from ASM line 0x1D6EF
    this.isScrollPaused = false;
    this.isTurbo = false;
    this.turboMultiplier = 5.0;
    this.visibleRows = 31;
    this.cols = 40;
    this.totalRows = 574;
    this.totalHeight = 574 * 16;

    // Scroll State Machine: 'CRUISING', 'DECELERATING', 'BOSS_STOPPED', 'ACCELERATING'
    this.scrollState = 'CRUISING';

    // Boss Encounter Controller
    this.bossEncounters = [];
    this.activeBoss = null;
    this.activeBossIndex = -1;
    this.bossTimerSeconds = 0;
    this.bossTimerFrames = 0;
    this.bossTimerActive = false;
    this.bossStatusText = '';
    this.bossStopScrollY = 0;
    this.decelStartScrollY = 0;
    this.decelTotalDist = 0;

    // Callbacks for coordination with game engine & audio
    this.onBossArrived = null;
    this.onBossCleared = null;
    this.onBossTimeout = null;

    // Off-screen container for building the tile grid each frame
    this._offscreenContainer = new PIXI.Container();
    this._offscreenContainer.roundPixels = true;

    // RenderTexture: 640 x 496 (31 rows + 1 extra row for sub-tile scrolling)
    this._renderTexture = null;

    // The single display sprite that shows the pre-rendered background
    this._displaySprite = null;

    // Sprite pool for off-screen rendering
    this.tileSprites = [];
  }

  async loadMap(gridJsonUrl, tilesetPngUrl, bossJsonUrl = 'src/data/boss_encounters.json') {
    // 0. Clean up previous map display & textures if reloading
    if (this._displaySprite) {
      this.container.removeChild(this._displaySprite);
      this._displaySprite.destroy();
      this._displaySprite = null;
    }
    if (this._renderTexture) {
      this._renderTexture.destroy(true);
      this._renderTexture = null;
    }
    this._offscreenContainer.removeChildren();
    this.tileSprites = [];

    // 1. Fetch grid JSON
    const res = await fetch(gridJsonUrl);
    this.gridData = await res.json();
    this.cols = this.gridData.width || this.gridData.cols || 40;
    this.totalRows = this.gridData.height || this.gridData.rows || 574;
    this.totalHeight = this.totalRows * 16;
    this.scrollPosY = 0;
    this.scrollSpeed = this.cruiseSpeed;
    this.scrollState = 'CRUISING';

    // 2. Boss Encounters Configuration (Priority: embedded in gridData for current Area)
    if (this.gridData && Array.isArray(this.gridData.bosses)) {
      this.setBossEncounters(this.gridData.bosses);
    } else {
      try {
        const bossRes = await fetch(bossJsonUrl);
        const bossData = await bossRes.json();
        this.setBossEncounters(bossData.bosses || []);
      } catch (e) {
        console.warn('[MapRenderer] No boss encounters JSON loaded:', e);
      }
    }

    // 3. Load Tileset Atlas (256x256 PNG containing 16x16 meta-tiles)
    this.tilesetTexture = await PIXI.Assets.load(tilesetPngUrl);
    if (this.tilesetTexture.source) {
      this.tilesetTexture.source.style.scaleMode = 'nearest';
      this.tilesetTexture.source.scaleMode = 'nearest';
      this.tilesetTexture.source.style.addressMode = 'clamp-to-edge';
      this.tilesetTexture.source.update();
    }

    // Extract 256 sub-textures of 16x16
    this.tileTextures = [];
    for (let t = 0; t < 256; t++) {
      const sx = (t % 16) * 16;
      const sy = Math.floor(t / 16) * 16;
      const frame = new PIXI.Rectangle(sx, sy, 16, 16);
      this.tileTextures.push(new PIXI.Texture({ source: this.tilesetTexture.source, frame }));
    }

    // Authentic MSX Animated Boss Tile Phases (0% Sprites, 100% Tile Animation)
    // MT 20: 20 (Phase 0), 26 (Phase 1), 27 (Phase 2), 28 (Phase 3)
    // MT 3:   3 (Phase 0), 29 (Phase 1), 30 (Phase 2), 31 (Phase 3)
    // MT 6:   6 (Phase 0), 32 (Phase 1), 33 (Phase 2), 34 (Phase 3)
    this.animatedBossTiles = {
      20: [this.tileTextures[20], this.tileTextures[26], this.tileTextures[27], this.tileTextures[28]],
      3:  [this.tileTextures[3],  this.tileTextures[29], this.tileTextures[30], this.tileTextures[31]],
      6:  [this.tileTextures[6],  this.tileTextures[32], this.tileTextures[33], this.tileTextures[34]],
    };

    // 4. Pre-instantiate sprite pool for off-screen rendering
    const numSprites = this.cols * (this.visibleRows + 2);
    for (let i = 0; i < numSprites; i++) {
      const sp = new PIXI.Sprite(this.tileTextures[0]);
      sp.width = 16;
      sp.height = 16;
      this._offscreenContainer.addChild(sp);
      this.tileSprites.push(sp);
    }

    // 5. Create the RenderTexture (640 x 496 to cover 480 + one extra row)
    this._renderTexture = PIXI.RenderTexture.create({
      width: 640,
      height: 496,
      scaleMode: 'nearest',
    });

    // 6. Create the display sprite (the ONLY child of the ground container)
    this._displaySprite = new PIXI.Sprite(this._renderTexture);
    this._displaySprite.x = 0;
    this._displaySprite.y = -8; // Offset to center the extra row
    this.container.addChild(this._displaySprite);
  }

  setBossEncounters(encounters) {
    this.bossEncounters = encounters.map(b => ({
      ...b,
      cleared: false,
      timedOut: false,
    }));

    // Link target references from gridData.objects if available
    if (this.gridData && this.gridData.objects) {
      this.bossEncounters.forEach(b => {
        if (b.targets) {
          b.targets.forEach(t => {
            const match = this.gridData.objects.find(o => o.row === t.row && o.col === t.col);
            if (match) t.objectRef = match;
          });
        }
      });
    }
  }

  // Destroy a ground structure and restore the underlying natural terrain
  destroyGroundTile(row, col) {
    if (!this.gridData) return;
    const under = this.gridData.under_mt[row][col];
    this.gridData.grid_mt[row][col] = under;
  }

  // 100% Tile-based animated boss eye phase (MSX2 VRAM pattern swap simulation)
  setBossEyePhase(mt, phase) {
    if (this.animatedBossTiles && this.animatedBossTiles[mt]) {
      const tex = this.animatedBossTiles[mt][phase] || this.animatedBossTiles[mt][0];
      if (tex) {
        this.tileTextures[mt] = tex;
      }
    }
  }

  // --- Scroll & State Machine Update (60 Hz) ---

  update(deltaFrames = 1, isTurbo = false) {
    if (!this.gridData) return;

    this.isTurbo = isTurbo;

    if (!this.isScrollPaused) {
      this.updateScrollPhysics(deltaFrames);
    }

    this.renderVisibleGrid();
  }

  updateScrollPhysics(deltaFrames = 1) {
    // Current top row visible at top of screen (row counter equivalent in MSX Z80)
    const baseRowInt = Math.floor(this.scrollPosY / 16);
    const topRow = baseRowInt + 30;
    const mult = this.isTurbo ? this.turboMultiplier : 1.0;

    // --- State 1: CRUISING ---
    if (this.scrollState === 'CRUISING') {
      this.scrollSpeed = this.cruiseSpeed * mult;
      this.scrollPosY += this.scrollSpeed * deltaFrames;

      // Check if top edge reached an uncleared boss trigger row
      for (let i = 0; i < this.bossEncounters.length; i++) {
        const boss = this.bossEncounters[i];
        if (!boss.cleared && !boss.timedOut && topRow >= boss.triggerRow && topRow <= boss.triggerRow + 4) {
          // Trigger boss deceleration sequence!
          this.activeBoss = boss;
          this.activeBossIndex = i;
          this.scrollState = 'DECELERATING';

          // Target stopping scroll position (clamped to map bounds):
          const maxScroll = (this.totalRows - 30) * 16;
          const targetBaseRow = boss.triggerRow - 30 + boss.decelSteps;
          this.bossStopScrollY = Math.min(targetBaseRow * 16, (this.totalRows - 31) * 16);
          this.decelStartScrollY = this.scrollPosY;
          this.decelTotalDist = Math.max(16, this.bossStopScrollY - this.decelStartScrollY);
          this.bossStatusText = `WARNING: APPROACHING ${boss.name.toUpperCase()} (DECEL)`;
          break;
        }
      }
    }

    // --- State 2: DECELERATING ---
    else if (this.scrollState === 'DECELERATING') {
      const remainingDist = this.bossStopScrollY - this.scrollPosY;

      if (remainingDist <= 0.6 || this.scrollPosY >= this.bossStopScrollY) {
        // Reached complete stop at exact boss fight position!
        this.scrollPosY = this.bossStopScrollY;
        this.scrollSpeed = 0.0;
        this.scrollState = 'BOSS_STOPPED';

        // Initialize authentic BCD seconds timer from ASM
        this.bossTimerSeconds = this.activeBoss.timerSeconds;
        this.bossTimerFrames = 60;
        this.bossTimerActive = this.activeBoss.hasTimer;
        this.bossStatusText = `ENGAGE: ${this.activeBoss.name.toUpperCase()}!`;

        if (this.onBossArrived) {
          this.onBossArrived(this.activeBoss);
        }
      } else {
        // Authentic deceleration ramp (ease-out curve matching Bank 13 0xB3E3 table)
        const progress = 1.0 - (remainingDist / this.decelTotalDist);
        const factor = Math.max(0, 1.0 - progress);
        // Exponential ease curve down to 0.12 min speed
        this.scrollSpeed = Math.max(0.12, this.cruiseSpeed * Math.pow(factor, 0.85) * mult);

        this.scrollPosY += this.scrollSpeed * deltaFrames;
        if (this.scrollPosY >= this.bossStopScrollY) {
          this.scrollPosY = this.bossStopScrollY;
        }
      }
    }

    // --- State 3: BOSS_STOPPED ---
    else if (this.scrollState === 'BOSS_STOPPED') {
      this.scrollSpeed = 0.0;

      // Countdown Boss Timer (60 frames per second at 60 Hz)
      if (this.bossTimerActive && this.bossTimerSeconds > 0) {
        this.bossTimerFrames -= deltaFrames;
        if (this.bossTimerFrames <= 0) {
          this.bossTimerFrames += 60;
          this.bossTimerSeconds--;

          if (this.bossTimerSeconds <= 0) {
            this.bossTimerSeconds = 0;
            this.bossTimerActive = false;
            this.activeBoss.timedOut = true;
            this.bossStatusText = 'TIME UP! BOSS RETREATED';

            if (this.onBossTimeout) {
              this.onBossTimeout(this.activeBoss);
            }
            this.finishBossEncounter(false);
          }
        }
      }
    }

    // --- State 4: ACCELERATING ---
    else if (this.scrollState === 'ACCELERATING') {
      // Smooth acceleration +0.02 px/f per frame (ASM Bank 14 0x1D6EF)
      this.scrollSpeed += this.accelRate * deltaFrames * mult;
      this.scrollPosY += this.scrollSpeed * deltaFrames;

      if (this.scrollSpeed >= this.cruiseSpeed * mult) {
        this.scrollSpeed = this.cruiseSpeed * mult;
        this.scrollState = 'CRUISING';
        this.activeBoss = null;
        this.bossStatusText = '';
      }
    }

    // Clamp map scroll to end of map
    const maxScroll = (this.totalRows - 31) * 16;
    if (this.scrollPosY >= maxScroll) {
      this.scrollPosY = maxScroll;
      this.scrollSpeed = 0.0;
    }
  }

  // Called when all boss targets are destroyed
  clearActiveBoss() {
    if (!this.activeBoss) return;
    this.activeBoss.cleared = true;
    this.bossTimerActive = false;
    this.bossStatusText = `★ ${this.activeBoss.name.toUpperCase()} DESTROYED! +${this.activeBoss.bonusScore} ★`;

    if (this.onBossCleared) {
      this.onBossCleared(this.activeBoss);
    }
    this.finishBossEncounter(true);
  }

  finishBossEncounter(isDefeated) {
    // Initiate acceleration back to cruise speed
    this.scrollState = 'ACCELERATING';
    this.scrollSpeed = 0.04;
  }

  // Debug shortcut: Jump directly to a boss encounter
  jumpToBoss(bossIndex = 0) {
    if (!this.bossEncounters[bossIndex]) return;
    const b = this.bossEncounters[bossIndex];

    // Mark previous bosses as cleared so they don't intercept
    for (let k = 0; k < this.bossEncounters.length; k++) {
      if (k < bossIndex) {
        this.bossEncounters[k].cleared = true;
      } else {
        this.bossEncounters[k].cleared = false;
        this.bossEncounters[k].timedOut = false;
      }
    }

    this.activeBoss = null;
    this.scrollState = 'CRUISING';
    this.scrollSpeed = this.cruiseSpeed;

    // Position scroll 2 rows before the trigger row
    this.scrollPosY = Math.max(0, (b.triggerRow - 30 - 2) * 16);
    this.bossStatusText = `JUMPED TO ${b.name.toUpperCase()} (ROW ${b.triggerRow})`;
    console.log(`[MapRenderer] Jumped to boss #${bossIndex}: ${b.name} at row ${b.triggerRow}`);
  }

  renderVisibleGrid() {
    const scrollTileY = this.scrollPosY / 16;
    const baseRowInt = Math.floor(scrollTileY);
    const subTileOffsetY = (scrollTileY - baseRowInt) * 16;

    let spriteIdx = 0;

    for (let rOffset = 0; rOffset <= this.visibleRows + 1; rOffset++) {
      const row = baseRowInt + rOffset;
      if (row < 0 || row >= this.totalRows) continue;

      // Render in RenderTexture coordinates (0,0 is top-left)
      // Row at higher rOffset should appear higher on screen (lower Y)
      const screenY = 480 - (rOffset * 16) + subTileOffsetY + 8; // +8 for extra row buffer

      const rowTiles = this.gridData.grid_mt[row];
      if (!rowTiles) continue;

      for (let c = 0; c < this.cols; c++) {
        if (spriteIdx >= this.tileSprites.length) break;
        const sp = this.tileSprites[spriteIdx++];
        const mt = rowTiles[c];
        sp.texture = this.tileTextures[mt] || this.tileTextures[0];
        sp.x = c * 16;
        sp.y = screenY;
        sp.visible = true;
      }
    }

    // Hide unused sprites
    for (; spriteIdx < this.tileSprites.length; spriteIdx++) {
      this.tileSprites[spriteIdx].visible = false;
    }

    // Render the off-screen container into the RenderTexture
    this.app.renderer.render({
      container: this._offscreenContainer,
      target: this._renderTexture,
      clear: true,
    });
  }

  getCurrentRow() {
    return Math.floor(this.scrollPosY / 16);
  }
}
