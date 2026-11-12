/**
 * Zanac EX WebPort - Main Game Loop & Coordinator
 * Full 640px PixiJS v8 engine with authentic 60 Hz deterministic game loop.
 *
 * Implements authentic MSX2 Z80 scroll physics & boss encounter controller:
 * - Acceleration, Cruising, and Deceleration matching ASM Bank 13 0xB3B0 & Bank 14 0x1D6EF
 * - Ground boss structures placed accurately on map (Row 220, Row 305, Row 564)
 * - Authentic BCD seconds timers ticking at 60 Hz per ASM Cmd 7 / Cmd 11
 * - Primary (X) & Sub-Weapons (C) collide with and destroy boss structures, turrets & cores
 * - Active boss turrets and cores aim and fire authentic lead & ring bullets
 * - Key [B]: Debug shortcut to cycle and jump directly to boss encounters!
 */

import { MapRenderer } from './mapRenderer.js?v=boss_per_area_v1';
import { SpriteManager } from './spriteManager.js?v=turbo_scroll_v1';
import { AudioManager } from './audio.js?v=turbo_scroll_v1';
import { WeaponsManager } from '../logic/weapons.js?v=turbo_scroll_v1';

export class ZanacGame {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.app = null;
    this.map = null;
    this.sprites = null;
    this.audio = null;
    this.weapons = null;

    // Score & Game Stats
    this.score = 0;
    this.currentBossJumpIdx = -1;

    // Player State (AFX-6502 Arrow Fighter)
    this.player = {
      x: 320,
      y: 380,
      vx: 0,
      vy: 0,
      speed: 3.8,
      lives: 3,
      isInvincible: true,
      invincibleTimer: 64, // Authentic ~1.06s (0x40 frames) blinking invincibility on spawn
      isDead: false,
      deathTimer: 0,
      deathTotalFrames: 70,
    };

    // Enemy bullets fired by boss turrets and cores
    this.enemyBullets = [];

    // Input State
    this.keys = {};
    this.playerExplosions = [];
    this.droppedItems = [];    // Collectibles dropped by items
    this.groundIdols = [];     // 2x Ground Idols (Faces: 3 hits -> Halo CLS/Warp; 100 hits -> +2 Lives, +10000 pts)
    this.halos = [];           // Floating Halos (Yellow pulsing Weapon-0 style CLS / Blackened Warp after 3s)
    this.clsFlash = 0;         // White screen-flash frames on CLS trigger
    this.warpFlash = 0;        // Cyan/blue warp flash frames
    this.screenFlashOverlay = null;
    this.playerBank = 0;       // -1.0 (full left tilt) to +1.0 (full right tilt) smoothed via lerp
    this.engineAnimTick = 0;   // Frame counter for alternating thruster flames (blue / red)

    // Stage State Machine (Zanac EX MSX2: Areas 1 to 12)
    this.currentArea = 1;          // Current Area (1 to 12)
    this.roundBannerTimer = 180;   // Banner frame timer
    this.roundBannerText = 'AREA 1';

    // Display Layer Containers
    this.layers = {
      ground: null,
      groundItems: null,
      subWeapons: null,
      enemies: null,
      items: null,
      bullets: null,
      player: null,
      playerShots: null,
      explosions: null,
      hud: null,
    };

    // HUD Text Elements
    this.hudElements = {};
  }

  async init() {
    // 1. Initialize PixiJS Application at actual window size
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;

    this.app = new PIXI.Application();
    await this.app.init({
      canvas: this.canvas,
      width: screenW,
      height: screenH,
      backgroundColor: 0x000000,
      antialias: false,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });
    this.app.stage.roundPixels = true;

    // 2. Master container scaling logical 640x480 → screen pixels
    this.gameContainer = new PIXI.Container();
    this.gameContainer.roundPixels = true;
    this.app.stage.addChild(this.gameContainer);

    const scale = Math.min(screenW / 640, screenH / 480);
    this.gameContainer.scale.set(scale);
    this.gameContainer.x = Math.round((screenW - 640 * scale) / 2);
    this.gameContainer.y = Math.round((screenH - 480 * scale) / 2);

    window.addEventListener('resize', () => this._onResize());

    // 3. Load Weapons Configuration
    const weapData = await fetch('src/data/weapons.json').then(r => r.json());

    // 4. Setup Display Layers inside gameContainer
    Object.keys(this.layers).forEach(k => {
      if (k === 'hud') {
        this.screenFlashOverlay = new PIXI.Graphics();
        this.screenFlashOverlay.rect(0, 0, 640, 480);
        this.screenFlashOverlay.fill(0xFFFFFF);
        this.screenFlashOverlay.visible = false;
        this.screenFlashOverlay.alpha = 0;
        this.gameContainer.addChild(this.screenFlashOverlay);
      }
      this.layers[k] = new PIXI.Container();
      this.gameContainer.addChild(this.layers[k]);
    });

    // 5. Initialize Subsystems (Audio with authentic WAVs, Sprites, Scrolling Map)
    this.audio = new AudioManager();
    this.sprites = new SpriteManager();
    await this.sprites.init();

    const urlParams = new URLSearchParams(window.location.search);
    const startArea = parseInt(urlParams.get('area'), 10) || 1;
    this.currentArea = Math.max(1, Math.min(12, startArea));

    const pad = (n) => String(n).padStart(2, '0');
    const areaStr = pad(this.currentArea);

    this.map = new MapRenderer(this.app, this.layers.ground);
    await this.map.loadMap(
      `assets/maps/640px_ex/area_${areaStr}_grid.json?v=modular_boss_grid_v2`,
      `assets/tiles/area_${areaStr}_tileset.png?v=modular_boss_grid_v2`,
      'src/data/boss_encounters.json?v=modular_boss_grid_v2'
    );

    // Setup Boss Event Hooks
    this.setupBossHooks();

    // Setup 2x Remastered Ground Structures & Objects
    this.setupGroundStructures();

    this.weapons = new WeaponsManager(weapData, this.audio);

    // 6. Create Player Sprite
    this.playerSprite = new PIXI.Sprite(this.sprites.get('player_ship'));
    this.playerSprite.anchor.set(0.5);
    this.layers.player.addChild(this.playerSprite);

    // 7. Setup Inputs & HUD
    this.setupInputs();
    this.setupHUD();

    // 8. Start BGM for current Area
    this.audio.resumeAreaBgm(this.currentArea);

    // 9. Attach 60 Hz Game Loop with normalized ticker.deltaTime
    this.app.ticker.add((ticker) => this.update(ticker));
  }

  setupBossHooks() {
    this.map.onBossArrived = (boss) => {
      console.log(`[ZanacGame] Arrived at ${boss.name}! Scroll halted. Timer: ${boss.timerSeconds}s`);
      if (boss.bossMusic) {
        this.audio.playBossMusic(boss.bgmTrack || '10 ZANAC 008 Boss.mp3');
      } else {
        this.audio.playSfx('warp', 0.8);
      }
    };

    this.map.onBossCleared = (boss) => {
      console.log(`[ZanacGame] Boss ${boss.name} DESTROYED! Awarding +${boss.bonusScore} pts`);
      this.score += (boss.bonusScore || 10000);

      // Cascade multi-explosion bursts across the boss structure
      if (boss.targets) {
        boss.targets.forEach((t, idx) => {
          const sx = t.col * 16 + 8;
          const sy = 480 - (t.row * 16 - this.map.scrollPosY) + 8;
          for (let k = 0; k < 4; k++) {
            this.playerExplosions.push({
              x: sx + (Math.random() - 0.5) * 36,
              y: sy + (Math.random() - 0.5) * 36,
              frame: 0,
              delay: idx * 6 + k * 8,
              color: k % 2 === 0 ? 'orange' : 'yellow',
              scale: 1.6,
            });
          }
        });
      }

      this.audio.playSfx('player_explosion');
      if (boss.victoryTrack) {
        this.audio.playBossVictory(boss.victoryTrack, () => {
          this.audio.resumeAreaBgm(this.currentArea);
        });
      } else {
        this.audio.resumeAreaBgm(this.currentArea);
      }
    };

    this.map.onBossTimeout = (boss) => {
      console.log(`[ZanacGame] Boss ${boss.name} TIMEOUT! Fled battle.`);
      this.audio.resumeAreaBgm(this.currentArea);
    };
  }

  _onResize() {
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    this.app.renderer.resize(screenW, screenH);

    const scale = Math.min(screenW / 640, screenH / 480);
    this.gameContainer.scale.set(scale);
    this.gameContainer.x = Math.round((screenW - 640 * scale) / 2);
    this.gameContainer.y = Math.round((screenH - 480 * scale) / 2);
  }

  setupInputs() {
    window.addEventListener('keydown', e => {
      this.audio.init(); // Unlock Web Audio context

      // 'X' = Primary Fire (ONLY 'X')
      if (e.code === 'KeyX' || e.key === 'x' || e.key === 'X') {
        e.preventDefault();
        this.keys['FirePrimary'] = true;
      }

      // 'C' = Secondary Fire (ONLY 'C')
      if (e.code === 'KeyC' || e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        this.keys['FireSecondary'] = true;
      }

      this.keys[e.code] = true;

      // Select Sub-Weapons 0 to 7
      if (e.key >= '0' && e.key <= '7') {
        const num = parseInt(e.key, 10);
        this.weapons.selectSubWeapon(num);
      }

      // 'B' = Jump to Next Boss Encounter (Debug / Testing)
      if (e.code === 'KeyB') {
        const count = this.map.bossEncounters.length;
        if (count > 0) {
          this.currentBossJumpIdx = ((this.currentBossJumpIdx || 0) + 1) % count;
          this.enemyBullets = [];
          this.resetBossStructures(this.currentBossJumpIdx);
          this.map.jumpToBoss(this.currentBossJumpIdx);
        }
      }

      // 'P' = Power-Up primary shot + trigger short blinking invincibility
      if (e.code === 'KeyP') {
        this.weapons.powerUp();
        this.player.isInvincible = true;
        this.player.invincibleTimer = 64; // ~1.06 seconds
      }

      // 'K' = Explode Fighter
      if (e.code === 'KeyK') {
        this.triggerPlayerExplosion();
      }

      // 'G' = Graphics mode toggle (1x / 2x)
      if (e.code === 'KeyG') {
        const nextMode = this.sprites.mode === '2x' ? '1x' : '2x';
        this.sprites.setGraphicsMode(nextMode);
      }

      // 'M' = Mute Audio toggle
      if (e.code === 'KeyM') {
        this.audio.isMuted = !this.audio.isMuted;
        if (this.audio.bgmAudio) {
          this.audio.bgmAudio.volume = this.audio.isMuted ? 0 : this.audio.bgmVolume;
        }
      }

      // 'S' = Turbo Scroll (vitesse x 5) - mode ressort (tant que appuyé)
      if (e.code === 'KeyS' || e.key === 's' || e.key === 'S') {
        this.keys['TurboScroll'] = true;
      }

      // 'PageUp' (ou 'N') = Stage Suivant (Area 1 -> Area 2 -> ... -> Area 12 -> Area 1)
      if (e.code === 'PageUp' || e.key === 'PageUp' || e.code === 'KeyN') {
        e.preventDefault();
        const next = this.currentArea >= 12 ? 1 : this.currentArea + 1;
        this.warpToArea(next);
      }
      // 'PageDown' = Stage Précédent (Area 1 -> Area 12 -> ... -> Area 2)
      if (e.code === 'PageDown' || e.key === 'PageDown') {
        e.preventDefault();
        const prev = this.currentArea <= 1 ? 12 : this.currentArea - 1;
        this.warpToArea(prev);
      }
    });

    window.addEventListener('keyup', e => {
      // ONLY 'X'
      if (e.code === 'KeyX' || e.key === 'x' || e.key === 'X') {
        e.preventDefault();
        this.keys['FirePrimary'] = false;
        // MSX Z80 line 3784 (0xE110 = 1): Reset shot cooldown immediately upon release for instant tap response!
        this.weapons.shotCooldown = 0;
      }
      // ONLY 'C'
      if (e.code === 'KeyC' || e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        this.keys['FireSecondary'] = false;
        // Instant tap response matching MSX Z80 slot 0xE380 logic
        this.weapons.fireCooldown = 0;
      }

      // 'S' = Relâchement Turbo Scroll (retour immédiat à vitesse normale)
      if (e.code === 'KeyS' || e.key === 's' || e.key === 'S') {
        this.keys['TurboScroll'] = false;
      }

      this.keys[e.code] = false;
    });

    window.addEventListener('blur', () => {
      this.keys['TurboScroll'] = false;
      this.keys['FirePrimary'] = false;
      this.keys['FireSecondary'] = false;
    });
  }

  triggerPlayerExplosion() {
    if (this.player.isDead) return;

    this.player.isDead = true;
    this.player.deathTotalFrames = 70;
    this.player.deathTimer = 70; // ~1.16s

    // Authentic MSX explosion sounds
    this.audio.playSfx('player_explosion');
    this.audio.playSfx('player_damage');

    // Downgrade 1 level of shot power on death (standard Zanac penalty)
    this.weapons.shotLevel = Math.max(0, this.weapons.shotLevel - 1);

    // Multi-burst explosive cascade
    this.playerExplosions = [
      { x: this.player.x, y: this.player.y, frame: 0, delay: 0, color: 'orange', scale: 1.6 },
      { x: this.player.x - 16, y: this.player.y - 10, frame: 0, delay: 8, color: 'yellow', scale: 1.3 },
      { x: this.player.x + 18, y: this.player.y + 6, frame: 0, delay: 16, color: 'orange', scale: 1.5 },
      { x: this.player.x - 6, y: this.player.y + 14, frame: 0, delay: 24, color: 'yellow', scale: 1.2 },
    ];
  }

  respawnPlayer() {
    this.player.x = 320;
    this.player.y = 400;
    this.player.isDead = false;
    this.player.deathTimer = 0;

    // Reset to normal fighter sprite
    this.playerSprite.texture = this.sprites.get('player_ship');

    // Enter short blinking invincibility mode (64 frames = ~1.06s)
    this.player.isInvincible = true;
    this.player.invincibleTimer = 64;
  }

  setupHUD() {
    // Semi-transparent background header bar
    const hudBg = new PIXI.Graphics();
    hudBg.rect(0, 0, 640, 52);
    hudBg.fill({ color: 0x000000, alpha: 0.75 });
    hudBg.stroke({ color: 0x004488, width: 1.5 });
    this.layers.hud.addChild(hudBg);

    const textStyle = {
      fontFamily: 'monospace',
      fontSize: 12,
      fontWeight: 'bold',
      fill: 0xFFFFFF,
      stroke: { color: 0x000000, width: 3 },
    };

    // Row 1: Primary Weapon | Sub-Weapon | Score
    this.hudElements.primary = new PIXI.Text({ text: '[X] SHOT: LV.1', style: textStyle });
    this.hudElements.primary.x = 10;
    this.hudElements.primary.y = 4;
    this.layers.hud.addChild(this.hudElements.primary);

    this.hudElements.sub = new PIXI.Text({ text: '[C] FIRE: #0 [INF]', style: { ...textStyle, fill: 0x00FF88 } });
    this.hudElements.sub.x = 220;
    this.hudElements.sub.y = 4;
    this.layers.hud.addChild(this.hudElements.sub);

    this.hudElements.score = new PIXI.Text({ text: 'SCORE: 000000', style: { ...textStyle, fill: 0xFFD700 } });
    this.hudElements.score.x = 480;
    this.hudElements.score.y = 4;
    this.layers.hud.addChild(this.hudElements.score);

    // Row 2: Scroll Velocity State & Boss Status Banner
    this.hudElements.scrollInfo = new PIXI.Text({
      text: 'SCROLL: 1.00 px/f [CRUISING]',
      style: { ...textStyle, fontSize: 11, fill: 0x55FF55 }
    });
    this.hudElements.scrollInfo.x = 10;
    this.hudElements.scrollInfo.y = 20;
    this.layers.hud.addChild(this.hudElements.scrollInfo);

    this.hudElements.bossBanner = new PIXI.Text({
      text: '',
      style: { ...textStyle, fontSize: 11, fontWeight: '900', fill: 0xFFEE00 }
    });
    this.hudElements.bossBanner.x = 240;
    this.hudElements.bossBanner.y = 20;
    this.layers.hud.addChild(this.hudElements.bossBanner);

    // Row 3: Controls Guide
    this.hudElements.controls = new PIXI.Text({
      text: '[B] JUMP BOSS  |  [0-7] SUB-WEAPONS  |  [P] POWER  |  [K] EXPLODE',
      style: { ...textStyle, fontSize: 10, fill: 0x66CCFF }
    });
    this.hudElements.controls.x = 10;
    this.hudElements.controls.y = 35;
    this.layers.hud.addChild(this.hudElements.controls);

    // Status Badge (Invincible / Destroyed)
    this.hudElements.badge = new PIXI.Text({
      text: '',
      style: {
        fontFamily: 'monospace',
        fontSize: 11,
        fontWeight: 'bold',
        fill: 0xFFD700,
        stroke: { color: 0x000000, width: 3 },
      },
    });
    this.hudElements.badge.anchor.set(1.0, 0); // Right-aligned
    this.hudElements.badge.x = 630;
    this.hudElements.badge.y = 35;
    this.layers.hud.addChild(this.hudElements.badge);

    // Center Arcade Round Banner: "ROUND 0", "ROUND 1", "ROUND 2"
    this.hudElements.centerBanner = new PIXI.Text({
      text: 'ROUND 1',
      style: {
        fontFamily: 'monospace',
        fontSize: 26,
        fontWeight: '900',
        fill: 0xFFDD00,
        stroke: { color: 0x002255, width: 6 },
      }
    });
    this.hudElements.centerBanner.anchor.set(0.5);
    this.hudElements.centerBanner.x = 320;
    this.hudElements.centerBanner.y = 200;
    this.hudElements.centerBanner.visible = true;
    this.layers.hud.addChild(this.hudElements.centerBanner);
  }

  updateHUD() {
    const shotParams = this.weapons.getShotParams();
    const shotLvl = this.weapons.shotLevel + 1;
    this.hudElements.primary.text = `[X] SHOT: LV.${shotLvl} (${shotParams.name})`;

    const def = this.weapons.data.sub_weapons[this.weapons.activeFireNum];
    let ammoStr = 'INF';
    if (def.limit_type === 'ammo') ammoStr = `${Math.max(0, this.weapons.fireAmmo)}`;
    else if (def.limit_type === 'durability') ammoStr = `${Math.max(0, this.weapons.fireAmmo)}%`;
    else if (def.limit_type === 'time') ammoStr = `${Math.ceil(Math.max(0, this.weapons.fireAmmo))}s`;

    this.hudElements.sub.text = `[C] #${this.weapons.activeFireNum} ${def.name} [${ammoStr}]`;
    this.hudElements.score.text = `SCORE: ${String(this.score).padStart(6, '0')}  LIVES: ${this.player.lives}  [AREA ${this.currentArea}]`;

    // Scroll Velocity State
    const spdStr = this.map.scrollSpeed.toFixed(2);
    if (this.map.isTurbo) {
      this.hudElements.scrollInfo.text = `SCROLL: ${spdStr} px/f [TURBO x5]`;
      this.hudElements.scrollInfo.style.fill = 0x00FFFF;
    } else if (this.map.scrollState === 'CRUISING') {
      this.hudElements.scrollInfo.text = `SCROLL: ${spdStr} px/f [CRUISING]`;
      this.hudElements.scrollInfo.style.fill = 0x55FF55;
    } else if (this.map.scrollState === 'DECELERATING') {
      this.hudElements.scrollInfo.text = `SCROLL: ${spdStr} px/f [DECEL RAMP]`;
      this.hudElements.scrollInfo.style.fill = 0xFFCC00;
    } else if (this.map.scrollState === 'BOSS_STOPPED') {
      this.hudElements.scrollInfo.text = `SCROLL: 0.00 px/f [STOPPED]`;
      this.hudElements.scrollInfo.style.fill = 0xFF4444;
    } else if (this.map.scrollState === 'ACCELERATING') {
      this.hudElements.scrollInfo.text = `SCROLL: ${spdStr} px/f [ACCEL +0.02]`;
      this.hudElements.scrollInfo.style.fill = 0x00FFFF;
    }

    // Boss Status Banner & ASM BCD Countdown Timer
    if (this.map.activeBoss) {
      const boss = this.map.activeBoss;
      if (this.map.scrollState === 'BOSS_STOPPED') {
        const bs = this.bossStructures ? this.bossStructures.find(s => s.config.id === boss.id) : null;
        const rem = bs && bs.components
          ? bs.components.filter(c => c.isTarget && !c.destroyed).length
          : (boss.targets || []).filter(t => !t.destroyed).length;

        const tSec = String(this.map.bossTimerSeconds).padStart(2, '0');
        const isLow = this.map.bossTimerSeconds <= 10;
        const flash = isLow && (Math.floor(this.map.bossTimerFrames / 15) % 2 === 0);

        this.hudElements.bossBanner.text = `⚡ ${boss.name.toUpperCase()} ⚡ TIME: ${tSec}s [CORES: ${rem}]`;
        this.hudElements.bossBanner.style.fill = flash ? 0xFF2222 : (isLow ? 0xFFAA00 : 0xFFEE00);
        this.hudElements.bossBanner.visible = true;
      } else if (this.map.scrollState === 'DECELERATING') {
        this.hudElements.bossBanner.text = `⚠ APPROACHING ${boss.name.toUpperCase()} (DECEL) ⚠`;
        this.hudElements.bossBanner.style.fill = 0xFFAA00;
        this.hudElements.bossBanner.visible = true;
      } else if (this.map.scrollState === 'ACCELERATING') {
        this.hudElements.bossBanner.text = this.map.bossStatusText || '★ ACCELERATING TO CRUISE SPEED... ★';
        this.hudElements.bossBanner.style.fill = 0x55FF55;
        this.hudElements.bossBanner.visible = true;
      }
    } else {
      this.hudElements.bossBanner.visible = false;
    }

    // Status Badge
    if (this.player.isDead) {
      this.hudElements.badge.text = '💥 DESTROYED 💥';
      this.hudElements.badge.style.fill = 0xFF4444;
      this.hudElements.badge.visible = true;
    } else if (this.player.isInvincible) {
      const flash = (Math.floor(this.player.invincibleTimer / 4) % 2 === 0);
      this.hudElements.badge.text = `★ INVINCIBLE (${(this.player.invincibleTimer / 60).toFixed(1)}s) ★`;
      this.hudElements.badge.style.fill = flash ? 0xFFD700 : 0xFFFFFF;
      this.hudElements.badge.visible = true;
    } else {
      this.hudElements.badge.visible = false;
    }

    // Center Arcade Round Banner countdown & pulse
    if (this.roundBannerTimer > 0) {
      this.roundBannerTimer -= 1;
      this.hudElements.centerBanner.text = this.roundBannerText;
      this.hudElements.centerBanner.visible = true;
      const s = 1.0 + 0.08 * Math.sin(this.roundBannerTimer * 0.15);
      this.hudElements.centerBanner.scale.set(s);
    } else {
      this.hudElements.centerBanner.visible = false;
    }
  }

  // --- Main Game Loop (Normalized to 60 Hz via ticker.deltaTime) ---

  update(tickerOrDelta = 1) {
    let rawDelta = 1;
    if (typeof tickerOrDelta === 'number') {
      rawDelta = tickerOrDelta;
    } else if (tickerOrDelta && typeof tickerOrDelta.deltaTime === 'number') {
      rawDelta = tickerOrDelta.deltaTime;
    }
    // Clamp to protect against tab lag / background pauses (e.g. min 0.05, max 3.0 frames)
    const deltaFrames = Math.min(3.0, Math.max(0.05, rawDelta));

    this.handlePlayerInput(deltaFrames);

    // 1. Update Map Scroll & Boss State Controller
    this.map.isScrollPaused = false;
    const isTurbo = Boolean(this.keys['TurboScroll'] || this.keys['KeyS']);
    this.map.update(deltaFrames, isTurbo);

    // 1.5 Update 2x Structures & Ground Objects
    this.updateStructures(deltaFrames);

    // 2. Update Weapons
    this.weapons.update(this.player.x, this.player.y, 640, 480, deltaFrames);

    // 3. Ground Structure Collisions (Normal shots & sub-weapons destroy turrets, domes, cores)
    this.checkGroundCollisions();

    // 4. Boss Attacks (turrets & cores fire authentic lead & ring bullets during BOSS_STOPPED)
    this.updateBossAttacks(deltaFrames);

    // 5. Update Enemy Bullets (motion, shutter absorption, player hits)
    this.updateEnemyBullets(deltaFrames);

    // 5.5 Update dropped collectibles (Power Chips from item boxes)
    for (let i = this.droppedItems.length - 1; i >= 0; i--) {
      const item = this.droppedItems[i];
      item.y += item.vy * deltaFrames;
      item.frame = (item.frame + 0.15 * deltaFrames) % 4;

      // Player pickup collision (24px radius)
      if (!this.player.isDead && Math.hypot(this.player.x - item.x, this.player.y - item.y) < 24) {
        this.weapons.powerUp();
        if (this.audio && this.audio.playSfx) this.audio.playSfx('powerup', 0.9);
        this.score += 500;
        this.playerExplosions.push({
          x: item.x,
          y: item.y,
          frame: 0,
          delay: 0,
          scale: 0.5,
          speed: 0.45
        });
        this.droppedItems.splice(i, 1);
        continue;
      }

      // Despawn off bottom of screen
      if (item.y > 510) {
        this.droppedItems.splice(i, 1);
      }
    }

    // 5.6 Update floating Halos (Weapon 0 Concentric Energy Ring: Yellow CLS or Blackened Warp)
    for (let i = this.halos.length - 1; i >= 0; i--) {
      const h = this.halos[i];
      h.age += deltaFrames;
      h.y += h.vy * deltaFrames; // Ascendant très ralenti (vy = -0.32 px/f)
      h.frame = (h.frame + 0.2 * deltaFrames) % 4;

      // Changement rapide de rayon pulsatile sinusoïdal (r = sinusoidal):
      h.pulsePhase = (h.pulsePhase || 0) + 0.36 * deltaFrames;
      h.pulseScale = 0.78 + 0.34 * Math.sin(h.pulsePhase);

      // Cas du Warp: commence jaune, et au bout de 3 sec (180 frames @ 60Hz) => noirci!
      // Cas du CLS: reste jaune jusqu'au bout!
      const isDarkened = h.canWarp && (h.age >= 180);
      h.isDarkened = isDarkened;

      // Player collision (hitbox: 24px)
      if (!this.player.isDead && Math.hypot(this.player.x - h.x, this.player.y - h.y) < 24) {
        const hx = h.x;
        const hy = h.y;
        const targetArea = h.warpTargetArea || (this.currentArea + 1);
        this.halos.splice(i, 1);

        if (!isDarkened) {
          // CLS Écran (tant qu'il est jaune, que ce soit CLS ou Warp avant 3 sec):
          // Tous les ennemis meurent d'un coup avec le son qui va avec + flash blanc!
          this.triggerClsClear(hx, hy);
        } else {
          // WARP Transfert vers un autre stage (une fois noirci après 3 sec):
          this.warpToArea(targetArea);
          this.playerExplosions.push({
            x: hx,
            y: hy,
            frame: 0,
            delay: 0,
            scale: 1.2,
            speed: 0.35,
            type: 'arcade'
          });
        }
        continue;
      }

      // Soit il sort de l'écran par le haut, soit il est consommé par le player:
      if (h.y < -32) {
        this.halos.splice(i, 1);
      }
    }

    // 6. Update explosion bursts (12-Frame Authentic Arcade Animation)
    for (let i = this.playerExplosions.length - 1; i >= 0; i--) {
      const exp = this.playerExplosions[i];
      if (exp.delay > 0) {
        exp.delay -= deltaFrames;
      } else {
        const speed = exp.speed || 0.35;
        exp.frame += speed * deltaFrames;
        if (exp.frame >= 12) {
          this.playerExplosions.splice(i, 1);
        }
      }
    }

    // 7. Render Dynamic Entities via PIXI
    this.renderEntities();

    // 8. Update HUD
    this.updateHUD();
  }

  handlePlayerInput(deltaFrames = 1) {
    if (this.player.isDead) {
      this.player.deathTimer -= deltaFrames;
      if (this.player.deathTimer <= 0) {
        this.respawnPlayer();
      }
      return;
    }

    if (this.player.invincibleTimer > 0) {
      this.player.invincibleTimer -= deltaFrames;
      if (this.player.invincibleTimer <= 0) {
        this.player.isInvincible = false;
      }
    }

    let dx = 0, dy = 0;
    if (this.keys['ArrowLeft'] || this.keys['KeyA']) dx -= 1;
    if (this.keys['ArrowRight'] || this.keys['KeyD']) dx += 1;
    if (this.keys['ArrowUp'] || this.keys['KeyW']) dy -= 1;
    if (this.keys['ArrowDown']) dy += 1;

    if (dx !== 0 && dy !== 0) {
      dx *= 0.7071;
      dy *= 0.7071;
    }

    this.player.x += dx * this.player.speed * deltaFrames;
    this.player.y += dy * this.player.speed * deltaFrames;

    this.player.x = Math.max(24, Math.min(616, this.player.x));
    this.player.y = Math.max(32, Math.min(454, this.player.y));

    const targetBank = dx;
    const bankSpeed = 0.16 * deltaFrames;
    this.playerBank += (targetBank - this.playerBank) * Math.min(1.0, bankSpeed);
    if (Math.abs(this.playerBank) < 0.005 && targetBank === 0) {
      this.playerBank = 0;
    }

    // Primary Fire (ONLY 'X')
    if (this.keys['FirePrimary'] || this.keys['KeyX']) {
      this.weapons.fireNormalShot(this.player.x, this.player.y);
    }

    // Secondary Fire (ONLY 'C')
    if (this.keys['FireSecondary'] || this.keys['KeyC']) {
      this.weapons.fireSubWeapon(this.player.x, this.player.y, dx, dy);
    }
  }

  // --- 2x Remastered Ground Structures & Objects ---

  setupGroundStructures() {
    if (this.groundIdols) {
      this.groundIdols.forEach(idol => {
        if (idol.sprite && idol.sprite.parent) {
          idol.sprite.parent.removeChild(idol.sprite);
          idol.sprite.destroy();
        }
      });
    }
    this.groundIdols = [];
    this.bossStructures = [];
    this.groundBoxes = [];
    if (this.layers && this.layers.groundItems) {
      this.layers.groundItems.removeChildren();
    }

    // 1. Initialize Boss Structures & Components (Authentic MSX2 modular architecture)
    if (this.map.bossEncounters) {
      this.map.bossEncounters.forEach((b, bIdx) => {
        let rawComps = b.components;

        // Auto-discover components from map grid objects if not explicitly provided
        if ((!rawComps || rawComps.length === 0) && this.map.gridData && this.map.gridData.objects) {
          const rMin = b.triggerRow;
          const rMax = b.triggerRow + (b.decelSteps || 8) + 20;
          const matchedObjs = this.map.gridData.objects.filter(o => o.row >= rMin && o.row <= rMax);
          rawComps = matchedObjs.map(o => {
            const isCore = (o.type === 'mini_core' || o.type === 'boss_core');
            const eyeType = (o.type === 'mini_core' ? 'petit' : 'gros');
            const isTarget = isCore || (b.targets && b.targets.some(t => t.row === o.row && t.col === o.col && t.isTarget));
            return {
              id: o.id || `${o.type}_${o.row}_${o.col}`,
              type: o.type,
              eyeType: eyeType,
              hasEyeShutter: isCore,
              row: o.row,
              col: o.col,
              hp: o.hp || (isCore ? 82 : 8),
              isTarget: isTarget,
              score: isCore ? 10000 : 1000,
              destroyed_mt: o.destroyed_mt || 21,
              fireCooldown: 40 + Math.floor(Math.random() * 40),
              fireRate: isCore ? 70 : 80
            };
          });
        }

        if (!rawComps || rawComps.length === 0) return;

        const comps = rawComps.map(c => {
          const comp = { ...c };
          comp.currentHp = comp.hp;
          comp.destroyed = false;
          comp.hitFlash = 0;
          comp.radius = comp.radius || 12;

          // Fallback coordinate resolution from baseRow and relX/relY if row/col missing
          if ((comp.row === undefined || comp.col === undefined) && b.baseRow !== undefined) {
            const baseCol = Math.round((320 - (b.width || 64) / 2) / 16);
            comp.col = baseCol + Math.round((comp.relX || 0) / 16);
            comp.row = b.baseRow + Math.round(((b.height || 64) / 2 - (comp.relY || 0)) / 16) - 1;
            if (this.map.gridData && this.map.gridData.objects) {
              const exactObj = this.map.gridData.objects.find(o =>
                Math.abs(o.row - comp.row) <= 1 && Math.abs(o.col - comp.col) <= 1
              );
              if (exactObj) {
                comp.row = exactObj.row;
                comp.col = exactObj.col;
                if (!comp.destroyed_mt) comp.destroyed_mt = exactObj.destroyed_mt;
              }
            }
          }

          // Save original meta-tile for clean reset
          if (comp.row !== undefined && comp.col !== undefined && this.map.gridData && this.map.gridData.grid_mt) {
            comp.initialMt = this.map.gridData.grid_mt[comp.row][comp.col];
            if (!comp.destroyed_mt && this.map.gridData.under_mt) {
              comp.destroyed_mt = this.map.gridData.under_mt[comp.row][comp.col] || 21;
            }
          }

          // Universal eye shutter system (Petit Cœur 32x32, Gros Cœur 32x32/64x64)
          if (comp.hasEyeShutter || comp.type === 'mini_core' || comp.type === 'boss_core') {
            comp.hasEyeShutter = true;
            comp.eyeType = comp.eyeType || (comp.type === 'mini_core' ? 'petit' : 'gros');
            comp.eyePhase = 0; // 0: Closed, 1: Slit, 2: Half, 3: Open
            comp.animTimer = 50; // Starts opening in ~0.16s
            comp.invulnerable = true;

            const eyePrefix = comp.eyeType === 'petit' ? 'comp_eye_petit' : 'comp_eye_gros';
            const eyeTex = this.sprites.get(`${eyePrefix}_0_2x`) || this.sprites.get('comp_eye_phase_0_2x');
            const eyeSprite = new PIXI.Sprite(eyeTex);
            eyeSprite.anchor.set(0.5);
            eyeSprite.scale.set(1.0); // Crisp 32x32 at 2x
            eyeSprite.visible = false;
            this.layers.groundItems.addChild(eyeSprite);
            comp.spriteRef = eyeSprite;
          }

          return comp;
        });

        this.bossStructures.push({
          config: b,
          bossIndex: bIdx,
          components: comps,
        });
      });
    }

    // 2. Initialize 2x Ground Idols (mt=11 Souriant Warp / mt=10 Non-Souriant Item CLS)
    this.groundIdols = [];
    if (this.map.gridData && this.map.gridData.objects) {
      this.map.gridData.objects.forEach(obj => {
        if (obj.type === 'idol_warp' || obj.type === 'idol_item') {
          const isWarp = (obj.type === 'idol_warp');
          // idol_face_warp_2x: Visuel SOURIANT (mt=11)
          // idol_face_item_2x: Visuel NON-SOURIANT (mt=10)
          const texKey = isWarp ? 'idol_face_warp_2x' : 'idol_face_item_2x';
          const tex = this.sprites.get(texKey);
          const sp = new PIXI.Sprite(tex);
          sp.anchor.set(0.5);
          sp.scale.set(1.0); // Crisp 32x32 at 2x!
          sp.visible = false;
          this.layers.groundItems.addChild(sp);

          // Replace underlying 16x16 meta-tile in map grid so it doesn't double-render
          if (this.map.gridData.grid_mt && this.map.gridData.grid_mt[obj.row]) {
            const neighborCol = obj.col > 0 ? obj.col - 1 : obj.col + 1;
            this.map.gridData.grid_mt[obj.row][obj.col] = this.map.gridData.grid_mt[obj.row][neighborCol] || 0;
          }

          this.groundIdols.push({
            data: obj,
            sprite: sp,
            type: obj.type,
            col: obj.col,
            row: obj.row,
            hp: 100,             // 100 hits to destroy!
            hitCount: 0,
            hitFlash: 0,
            haloSpawned: false,
            destroyed: false,
            isSmiling: isWarp,   // mt=11: souriant, mt=10: non-souriant
            canWarp: isWarp,     // mt=11 warpe vers l'Area cible
            warpTargetArea: isWarp ? (obj.warp_to || (this.currentArea + 1)) : null,
            sx: 0,
            sy: 0,
          });
        }
      });
    }
  }

  resetBossStructures(idx) {
    const bs = this.bossStructures[idx];
    if (!bs) return;
    bs.components.forEach(comp => {
      comp.destroyed = false;
      comp.currentHp = comp.hp;
      comp.hitFlash = 0;
      if (comp.hasEyeShutter) {
        comp.eyePhase = 0;
        comp.animTimer = 50; // Starts opening in 10 frames (~0.16s) right as the player looks at it
        comp.invulnerable = true;
      }
      if (comp.spriteRef) {
        comp.spriteRef.visible = true;
        comp.spriteRef.tint = 0xFFFFFF;
      }
      // Restore initial meta-tile in map grid
      if (comp.initialMt !== undefined && this.map.gridData && this.map.gridData.grid_mt[comp.row]) {
        this.map.gridData.grid_mt[comp.row][comp.col] = comp.initialMt;
      }
    });
  }

  // --- Subsystem M: Secrets & Warps & CLS ---

  triggerClsClear(hx, hy) {
    this.clsFlash = 16; // White/gold screen flash
    let destroyedAny = false;

    // 1. Destroy all active aerial enemies on screen
    if (this.enemies && this.enemies.activeEnemies) {
      this.enemies.activeEnemies.forEach(e => {
        if (e.active && !e.destroyed) {
          e.hp = 0;
          e.destroyed = true;
          destroyedAny = true;
          this.score += (e.score || 200);
          this.playerExplosions.push({
            x: e.x,
            y: e.y,
            frame: 0,
            delay: 0,
            scale: 0.9,
            speed: 0.35,
            type: 'arcade'
          });
        }
      });
    }

    // 2. Destroy visible non-core ground turrets / radar domes on screen
    if (this.bossStructures) {
      this.bossStructures.forEach(bs => {
        bs.components.forEach(comp => {
          if (!comp.destroyed && !comp.isTarget && !comp.hasEyeShutter && comp.isOnScreen) {
            comp.destroyed = true;
            comp.currentHp = 0;
            if (comp.spriteRef) comp.spriteRef.visible = false;
            if (comp.row !== undefined && comp.col !== undefined && this.map.gridData && this.map.gridData.grid_mt) {
              const crater = comp.destroyed_mt || 21;
              this.map.gridData.grid_mt[comp.row][comp.col] = crater;
            }
            destroyedAny = true;
            this.score += (comp.score || 500);
            this.playerExplosions.push({
              x: comp.cx,
              y: comp.cy,
              frame: 0,
              delay: 0,
              scale: 1.0,
              speed: 0.35,
              type: 'arcade'
            });
          }
        });
      });
    }

    // 3. Clear all enemy bullets with spark bursts
    if (this.enemyBullets && this.enemyBullets.length > 0) {
      destroyedAny = true;
      this.enemyBullets.forEach(b => {
        this.playerExplosions.push({
          x: b.x,
          y: b.y,
          frame: 0,
          delay: 0,
          scale: 0.45,
          speed: 0.5,
          type: 'spark'
        });
      });
      this.enemyBullets = [];
    }

    this.score += 1000;
    this.audio.playSfx('subweapon_special', 1.0);
    if (destroyedAny) {
      this.audio.playSfx('player_explosion', 0.65);
    }

    if (hx !== undefined && hy !== undefined) {
      this.playerExplosions.push({
        x: hx,
        y: hy,
        frame: 0,
        delay: 0,
        scale: 0.9,
        speed: 0.45,
        type: 'spark'
      });
    }
  }

  async warpToArea(targetArea) {
    const nextArea = targetArea || (this.currentArea + 1);
    this.warpFlash = 35;
    this.audio.playSfx('warp', 1.0);
    this.player.isInvincible = true;
    this.player.invincibleTimer = 180;
    this.score += 2000;
    this.currentArea = Math.max(1, Math.min(12, nextArea));
    this.roundBannerText = `AREA ${this.currentArea}`;
    this.roundBannerTimer = 180;

    // Clear active projectiles/halos & reset stage scroll/structures for new Area
    this.enemyBullets = [];
    this.halos = [];
    this.droppedItems = [];
    this.map.scrollPosY = 0;
    this.map.scrollState = 'CRUISING';
    this.map.scrollSpeed = this.map.cruiseSpeed;
    this.map.activeBoss = null;
    this.map.bossTimerActive = false;
    this.map.bossStatusText = '';

    // Load new map & tileset for targetArea!
    const pad = (n) => String(n).padStart(2, '0');
    const areaStr = pad(this.currentArea);
    const gridUrl = `assets/maps/640px_ex/area_${areaStr}_grid.json?v=modular_boss_grid_v2`;
    const tilesetUrl = `assets/tiles/area_${areaStr}_tileset.png?v=modular_boss_grid_v2`;
    await this.map.loadMap(gridUrl, tilesetUrl, 'src/data/boss_encounters.json?v=modular_boss_grid_v2');
    this.setupGroundStructures();

    this.audio.resumeAreaBgm(this.currentArea);
    console.log(`[ZANAC EX WARP] Teleported to Area ${this.currentArea}!`);
  }

  updateStructures(deltaFrames = 1) {
    const scrollY = this.map.scrollPosY;

    // 1. Update Boss Structures & Eyes
    this.corePulseTick = (this.corePulseTick || 0) + deltaFrames;
    const isPulsing = (Math.floor(this.corePulseTick / 12) % 2 === 1);

    this.bossStructures.forEach(bs => {
      bs.components.forEach(comp => {
        const cx = comp.col * 16 + 8;
        const cy = 480 - (comp.row * 16 - scrollY) + 8;
        comp.cx = cx;
        comp.cy = cy;

        const isVisibleOnScreen = (cy > -32 && cy < 512);
        comp.isOnScreen = isVisibleOnScreen;

        if (comp.destroyed) {
          if (comp.spriteRef) comp.spriteRef.visible = false;
          return;
        }

        if (comp.spriteRef) {
          comp.spriteRef.x = cx;
          comp.spriteRef.y = cy;
          comp.spriteRef.visible = isVisibleOnScreen;
        }

        // Universal animated eye shutter state machine: 4.0s @ 60Hz (authentic Compile cycle)
        if (comp.hasEyeShutter) {
          comp.animTimer = (comp.animTimer || 0) + deltaFrames;
          const t = comp.animTimer % 240;

          if (t < 60) {
            comp.eyePhase = 0; // Phase 0: Fermé (1.0s - blindé / invulnérable)
          } else if (t < 75) {
            comp.eyePhase = 1; // Phase 1: Fente (0.25s)
          } else if (t < 90) {
            comp.eyePhase = 2; // Phase 2: Demi-ouvert (0.25s)
          } else if (t < 210) {
            comp.eyePhase = 3; // Phase 3: Grand ouvert (2.0s - vulnérable, pulsation & tirs)
          } else if (t < 225) {
            comp.eyePhase = 2; // Phase 2: Demi-fermeture (0.25s)
          } else {
            comp.eyePhase = 1; // Phase 1: Fente de fermeture (0.25s)
          }

          // Armored eyelid: only vulnerable when fully open (Phase 3)
          comp.invulnerable = (comp.eyePhase !== 3);

          const eyePrefix = comp.eyeType === 'petit' ? 'comp_eye_petit' : 'comp_eye_gros';
          let texName = `${eyePrefix}_${comp.eyePhase}_2x`;
          if (comp.eyePhase === 3 && isPulsing) {
            texName = `${eyePrefix}_3_pulse_2x`;
          }
          const eyeTex = this.sprites.get(texName) || this.sprites.get(`comp_eye_phase_${comp.eyePhase}_2x`);
          if (eyeTex && comp.spriteRef) comp.spriteRef.texture = eyeTex;
        }

        // Damage flash
        if (comp.hitFlash > 0) {
          comp.hitFlash -= deltaFrames;
          if (comp.spriteRef) comp.spriteRef.tint = 0xFFAAAA;
        } else {
          if (comp.spriteRef) comp.spriteRef.tint = 0xFFFFFF;
        }
      });
    });

    // 2. Update 2x Ground Idols (Faces)
    this.groundIdols.forEach(idol => {
      const sx = idol.col * 16 + 8;
      const sy = 480 - (idol.row * 16 - scrollY) + 8;
      idol.sx = sx;
      idol.sy = sy;
      idol.sprite.x = sx;
      idol.sprite.y = sy;
      idol.sprite.visible = (sy > -32 && sy < 512);

      if (idol.hitFlash > 0) {
        idol.hitFlash -= deltaFrames;
        idol.sprite.tint = 0xFFAAAA;
      } else {
        idol.sprite.tint = 0xFFFFFF;
      }
    });
  }

  // --- Boss Structure Attacks & Projectiles ---

  updateBossAttacks(deltaFrames = 1) {
    if (!this.map.activeBoss || this.map.scrollState !== 'BOSS_STOPPED') return;
    if (this.player.isDead) return;

    const activeStruct = this.bossStructures.find(bs => bs.config.id === this.map.activeBoss.id);
    if (!activeStruct) return;

    activeStruct.components.forEach(comp => {
      if (comp.destroyed || !comp.isOnScreen) return;

      // Authentic MSX: Eye core only fires when FULLY OPEN (Phase 3)
      if (comp.hasEyeShutter && comp.eyePhase !== 3) return;

      comp.fireCooldown = (comp.fireCooldown || 0) + deltaFrames;
      const fireRate = comp.fireRate || 80;

      if (comp.fireCooldown >= fireRate) {
        comp.fireCooldown = 0;
        const sx = comp.cx;
        const sy = comp.cy;
        const angle = Math.atan2(this.player.y - sy, this.player.x - sx);

        if (comp.type === 'turret_cannon' || comp.type === 'boss_turret') {
          this.enemyBullets.push({
            x: sx,
            y: sy,
            vx: Math.cos(angle) * 2.8,
            vy: Math.sin(angle) * 2.8,
            type: 'lead',
            frame: 0,
          });
        } else if (comp.type === 'mini_core') {
          this.enemyBullets.push(
            { x: sx - 10, y: sy + 4, vx: Math.cos(angle - 0.16) * 2.6, vy: Math.sin(angle - 0.16) * 2.6, type: 'lead', frame: 0 },
            { x: sx + 10, y: sy + 4, vx: Math.cos(angle + 0.16) * 2.6, vy: Math.sin(angle + 0.16) * 2.6, type: 'lead', frame: 0 }
          );
        } else if (comp.type === 'boss_core') {
          this.enemyBullets.push({
            x: sx,
            y: sy + 6,
            vx: Math.cos(angle) * 2.4,
            vy: Math.sin(angle) * 2.4,
            type: 'ring',
            frame: 0,
          });
        } else if (comp.type === 'radar_dome') {
          this.enemyBullets.push({
            x: sx,
            y: sy,
            vx: Math.cos(angle) * 2.0,
            vy: Math.sin(angle) * 2.0,
            type: 'lead',
            frame: 0,
          });
        }
      }
    });
  }

  updateEnemyBullets(deltaFrames = 1) {
    for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
      const b = this.enemyBullets[i];
      b.x += b.vx * deltaFrames;
      b.y += b.vy * deltaFrames;
      b.frame = (b.frame + 0.18 * deltaFrames) % 4;

      if (b.x < -20 || b.x > 660 || b.y < -20 || b.y > 500) {
        this.enemyBullets.splice(i, 1);
        continue;
      }

      // Check collision with Sub-Weapon #2 (Field Shutter)
      let absorbed = false;
      for (const sw of this.weapons.activeSubWeapons) {
        if (sw.type === 2 && sw.isActive) {
          if (Math.abs(b.x - sw.x) < 28 && Math.abs(b.y - sw.y) < 14) {
            absorbed = true;
            this.weapons.fireAmmo = Math.max(0, this.weapons.fireAmmo - 2);
            this.playerExplosions.push({ x: b.x, y: b.y, frame: 0, delay: 0, color: 'yellow', scale: 0.7 });
            break;
          }
        } else if (sw.type === 0 || sw.type === 3 || sw.type === 4) {
          const dist = Math.hypot(b.x - sw.x, b.y - sw.y);
          if (dist < 22) {
            absorbed = true;
            this.playerExplosions.push({ x: b.x, y: b.y, frame: 0, delay: 0, color: 'yellow', scale: 0.7 });
            break;
          }
        }
      }

      if (absorbed) {
        this.enemyBullets.splice(i, 1);
        continue;
      }

      // Check collision with player fighter
      if (!this.player.isDead && !this.player.isInvincible) {
        const pDist = Math.hypot(b.x - this.player.x, b.y - this.player.y);
        if (pDist < 10) {
          this.triggerPlayerExplosion();
          this.enemyBullets.splice(i, 1);
          continue;
        }
      }
    }
  }

  // --- Ground Structure Collisions & Destruction ---

  checkGroundCollisions() {
    // 1. Collisions against Boss Structure components
    this.bossStructures.forEach(bs => {
      bs.components.forEach(comp => {
        if (comp.destroyed || !comp.isOnScreen) return;

        const cx = comp.cx;
        const cy = comp.cy;
        const hitboxRadius = comp.radius || 12;

        // Normal Shots vs Component
        for (let sIdx = this.weapons.activeShots.length - 1; sIdx >= 0; sIdx--) {
          const s = this.weapons.activeShots[sIdx];
          if (Math.abs(s.x - cx) < hitboxRadius && Math.abs(s.y - cy) < hitboxRadius) {
            if (comp.hasEyeShutter && comp.eyePhase < 3) {
              // Eyelid is closed or opening (phases 0, 1, 2):
              // Player fire passes straight over/through with ZERO collision!
              continue;
            }
            this.weapons.activeShots.splice(sIdx, 1);
            this.damageBossComponent(comp, 1, cx, cy, bs);
            break;
          }
        }

        // Sub-Weapons vs Component
        for (let swIdx = this.weapons.activeSubWeapons.length - 1; swIdx >= 0; swIdx--) {
          const sw = this.weapons.activeSubWeapons[swIdx];
          if (!sw.destroys_ground && sw.type !== 0 && sw.type !== 1 && sw.type !== 5 && sw.type !== 6 && sw.type !== 7) continue;

          if (Math.hypot(sw.x - cx, sw.y - cy) < hitboxRadius + 4) {
            if (comp.hasEyeShutter && comp.eyePhase < 3) {
              // Sub-weapon passes straight over/through the closed eyelid
              continue;
            }
            const dmg = sw.damage || 2;
            this.damageBossComponent(comp, dmg, cx, cy, bs);
            if (!sw.pierces) {
              this.weapons.activeSubWeapons.splice(swIdx, 1);
            }
            break;
          }
        }
      });
    });

    // 2. Collisions against 2x Ground Idols (Faces)
    this.groundIdols.forEach(idol => {
      if (idol.destroyed || !idol.sprite.visible) return;
      const ix = idol.sx;
      const iy = idol.sy;
      const hitbox = 20;

      // Normal Shots vs Idol
      for (let sIdx = this.weapons.activeShots.length - 1; sIdx >= 0; sIdx--) {
        const s = this.weapons.activeShots[sIdx];
        if (Math.abs(s.x - ix) < hitbox && Math.abs(s.y - iy) < hitbox) {
          this.weapons.activeShots.splice(sIdx, 1);
          this.hitGroundIdol(idol, 1, s.x, s.y);
          if (idol.destroyed) break;
        }
      }

      if (idol.destroyed) return;

      // Sub-Weapons vs Idol
      for (let swIdx = this.weapons.activeSubWeapons.length - 1; swIdx >= 0; swIdx--) {
        const sw = this.weapons.activeSubWeapons[swIdx];
        if (!sw.destroys_ground && sw.type !== 0 && sw.type !== 1 && sw.type !== 5 && sw.type !== 6 && sw.type !== 7) continue;

        if (sw.pierces) {
          if (!sw.hitIdols) sw.hitIdols = new Set();
          if (sw.hitIdols.has(idol)) continue;
        }

        if (Math.hypot(sw.x - ix, sw.y - iy) < hitbox + 4) {
          if (sw.pierces && sw.hitIdols) {
            sw.hitIdols.add(idol);
          }
          const dmg = sw.damage || 1;
          this.hitGroundIdol(idol, dmg, sw.x, sw.y);
          if (!sw.pierces) {
            this.weapons.activeSubWeapons.splice(swIdx, 1);
          }
          if (idol.destroyed) break;
        }
      }
    });
  }

  damageBossComponent(comp, dmg, cx, cy, bs) {
    comp.currentHp -= dmg;
    comp.hitFlash = 3;

    if (comp.currentHp > 0) {
      // MICRO-IMPACT: Only small spark/flash on non-fatal shot
      this.playerExplosions.push({
        x: cx,
        y: cy,
        frame: 0,
        delay: 0,
        scale: 0.28,
        speed: 0.65,
        type: 'spark'
      });
      this.audio.playSfx('shot_tier0', 0.35);
    } else {
      // FATAL DESTRUCTION: Authentic 12-frame arcade explosion!
      comp.destroyed = true;
      if (comp.spriteRef) {
        comp.spriteRef.visible = false;
      }

      // Direct tile grid mutation: Write crater tile into map grid!
      if (comp.row !== undefined && comp.col !== undefined && this.map.gridData && this.map.gridData.grid_mt) {
        const craterTile = comp.destroyed_mt || 21;
        this.map.gridData.grid_mt[comp.row][comp.col] = craterTile;
      }

      this.score += (comp.score || 1000);
      this.playerExplosions.push({
        x: cx,
        y: cy,
        frame: 0,
        delay: 0,
        scale: 1.15,
        speed: 0.28,
        type: 'arcade'
      });
      this.audio.playSfx('player_explosion', 0.7);

      // Check if all target cores of active boss are destroyed
      if (this.map.activeBoss && (this.map.activeBoss.id === bs.config.id || this.map.activeBossIndex === bs.bossIndex)) {
        const remainingTargets = bs.components.filter(c => c.isTarget && !c.destroyed);
        if (remainingTargets.length === 0) {
          // Epic boss defeat explosion cascade across the whole structure
          for (let k = 0; k < 12; k++) {
            const rx = cx - 50 + Math.random() * 100;
            const ry = cy - 50 + Math.random() * 100;
            this.playerExplosions.push({
              x: rx,
              y: ry,
              frame: 0,
              delay: k * 3,
              scale: 0.8 + Math.random() * 0.5,
              speed: 0.3,
              type: 'arcade'
            });
          }
          this.audio.playSfx('player_explosion', 0.9);
          this.map.clearActiveBoss();
        }
      }
    }
  }

  hitGroundIdol(idol, dmg, hx, hy) {
    if (idol.destroyed) return;
    idol.hp -= dmg;
    idol.hitCount += 1;
    idol.hitFlash = 3;

    if (idol.hp > 0) {
      // Micro-impact spark on non-fatal hit
      this.playerExplosions.push({
        x: hx,
        y: hy,
        frame: 0,
        delay: 0,
        scale: 0.28,
        speed: 0.65,
        type: 'spark'
      });
      this.audio.playSfx('shot_tier0', 0.35);

      // At 3 hits: release pulsing Yellow Halo (CLS or Warp depending on idol type)
      if (idol.hitCount >= 3 && !idol.haloSpawned) {
        idol.haloSpawned = true;
        this.halos.push({
          x: idol.sx,
          y: idol.sy - 8,
          vy: -0.32, // Ascendant très ralenti (~19 px/sec)
          frame: 0,
          age: 0,
          pulsePhase: 0,
          pulseScale: 0.78,
          canWarp: idol.canWarp,
          warpTargetArea: idol.warpTargetArea,
        });
        this.audio.playSfx('weapon_switch', 0.75);
      }
    } else {
      // 100 HITS DESTRUCTION! (+2 Lives + 10000 Score)
      idol.destroyed = true;
      idol.sprite.texture = this.sprites.get('idol_face_crater_2x');

      // Massive arcade explosion
      this.playerExplosions.push({
        x: idol.sx,
        y: idol.sy,
        frame: 0,
        delay: 0,
        scale: 1.35,
        speed: 0.28,
        type: 'arcade'
      });
      this.audio.playSfx('player_explosion', 0.9);
      this.audio.playSfx('powerup', 1.0);

      // +2 Extra Lives and 10000 Points
      this.player.lives = (this.player.lives || 3) + 2;
      this.score += 10000;
    }
  }

  // --- Dynamic Entity Render Synchronization ---

  renderEntities() {
    // 1. Player Fighter Sprite & Explosion Animation
    this.playerSprite.x = this.player.x;
    this.playerSprite.y = this.player.y;

    if (this.player.isDead) {
      const elapsed = this.player.deathTotalFrames - this.player.deathTimer;
      const deathFrame = Math.min(6, Math.floor(elapsed / 10));
      const deathTex = this.sprites.get(`player_death_${deathFrame}`);
      if (deathTex) this.playerSprite.texture = deathTex;

      this.playerSprite.visible = true;
      this.playerSprite.alpha = 1.0;
      this.playerSprite.tint = 0xFFFFFF;
      this.playerSprite.rotation = 0;
      this.playerSprite.scale.set(1.0);
      this.playerSprite.skew.set(0);
    } else {
      this.engineAnimTick = (this.engineAnimTick || 0) + 1;
      const isRedThrust = (Math.floor(this.engineAnimTick / 4) % 2 === 1);
      const thrustTex = this.sprites.get(isRedThrust ? 'player_ship_red' : 'player_ship_blue') || this.sprites.get('player_ship');
      this.playerSprite.texture = thrustTex;

      this.playerSprite.rotation = this.playerBank * 0.15;
      this.playerSprite.scale.x = 1.0 - Math.abs(this.playerBank) * 0.14;
      this.playerSprite.scale.y = 1.0;
      this.playerSprite.skew.y = this.playerBank * 0.08;
      this.playerSprite.skew.x = -this.playerBank * 0.04;

      this.playerSprite.visible = true;

      if (this.player.isInvincible) {
        const flash = (Math.floor(this.player.invincibleTimer / 2) % 2 === 0);
        this.playerSprite.alpha = flash ? 1.0 : 0.25;
        this.playerSprite.tint = flash ? 0x88FFFF : 0xFFFFFF;
      } else {
        this.playerSprite.alpha = 1.0;
        this.playerSprite.tint = 0xFFFFFF;
      }
    }

    // 2. Normal Shots
    this.syncContainer(this.layers.playerShots, this.weapons.activeShots, (sprite, s) => {
      const tierTex = this.sprites.get(`shot_tier_${s.tier || 1}`);
      if (tierTex && tierTex.length > 0) {
        sprite.texture = tierTex[s.frame] || tierTex[0];
      }
      sprite.x = s.x;
      sprite.y = s.y;
      sprite.anchor.set(0.5);
    });

    // 3. Sub-Weapons
    this.syncContainer(this.layers.subWeapons, this.weapons.activeSubWeapons, (sprite, sw) => {
      let tex = null;
      let scale = 1.0;
      if (sw.type === 0) {
        tex = this.sprites.get('sub_all_range')[sw.frame % 4];
        scale = 0.64;
      } else if (sw.type === 1) {
        tex = this.sprites.get('sub_plasma')[sw.frame % 2];
        scale = 0.8;
      } else if (sw.type === 2) {
        const shutterFrames = this.sprites.get('sub_shutter');
        tex = shutterFrames ? shutterFrames[Math.min(3, Math.max(0, sw.frame))] : null;
        scale = 1.0;
      } else if (sw.type === 3) {
        tex = this.sprites.get('sub_all_range')[sw.frame % 4];
        scale = 0.64;
      } else if (sw.type === 4) {
        tex = this.sprites.get('sub_all_range')[sw.frame % 4];
        scale = 0.64;
      } else if (sw.type === 5) {
        tex = this.sprites.get('sub_blade')[sw.frame % 4];
        scale = 1.0;
      } else if (sw.type === 6) {
        tex = this.sprites.get('sub_plasma')[sw.frame % 2];
        scale = 1.0;
      } else if (sw.type === 7) {
        tex = this.sprites.get('sub_blade')[sw.frame % 4];
        scale = 1.0;
      }

      if (tex) sprite.texture = tex;
      sprite.x = sw.x;
      sprite.y = sw.y;
      sprite.anchor.set(0.5);
      sprite.scale.set(scale);
    });

    // 3.5 Floating Halos (from Idols) & Collectibles
    const activeFloating = [...this.halos, ...this.droppedItems];
    this.syncContainer(this.layers.items, activeFloating, (sprite, item) => {
      if (item.type === 'power_chip') {
        const frames = this.sprites.get('power_chip');
        const f = Math.floor(item.frame) % (frames ? frames.length : 1);
        if (frames && frames[f]) sprite.texture = frames[f];
        sprite.x = item.x;
        sprite.y = item.y;
        sprite.anchor.set(0.5);
        sprite.scale.set(1.0);
        sprite.tint = 0xFFFFFF;
        sprite.alpha = 1.0;
        sprite.visible = true;
      } else {
        // Floating Halo (Weapon-0 concentric energy ring: Yellow CLS or Blackened Warp after 3s)
        const isDarkened = Boolean(item.canWarp && (item.age >= 180));
        const texKey = isDarkened ? 'idol_halo_black' : 'idol_halo_yellow';
        const tex = this.sprites.get(texKey);
        if (tex) sprite.texture = tex;
        sprite.x = item.x;
        sprite.y = item.y;
        sprite.anchor.set(0.5);
        sprite.scale.set(item.pulseScale || 1.0);
        sprite.tint = 0xFFFFFF;
        sprite.alpha = 1.0;
        sprite.visible = true;
      }
    });

    // 4. Explosions & Micro-Impact Sparks
    const visibleExplosions = this.playerExplosions.filter(e => e.delay === 0);
    this.syncContainer(this.layers.explosions, visibleExplosions, (sprite, ex) => {
      const frames = this.sprites.get('explosion_arcade') || this.sprites.get('explosion_orange');
      const frameIdx = Math.min(11, Math.max(0, Math.floor(ex.frame)));
      if (frames && frames[frameIdx]) sprite.texture = frames[frameIdx];
      sprite.x = ex.x;
      sprite.y = ex.y;
      sprite.anchor.set(0.5);
      sprite.scale.set(ex.scale || 0.8);
      // Micro-impact spark tint
      if (ex.type === 'spark') {
        sprite.tint = 0xFFFFAA;
      } else {
        sprite.tint = 0xFFFFFF;
      }
      sprite.visible = true;
    });

    // Screen Flash Effects (CLS bright whiteout & Warp portal cyan-blue jump)
    if (this.clsFlash > 0) {
      this.clsFlash--;
      if (this.screenFlashOverlay) {
        this.screenFlashOverlay.visible = (this.clsFlash % 2 === 0);
        this.screenFlashOverlay.tint = 0xFFFFDD;
        this.screenFlashOverlay.alpha = (this.clsFlash % 2 === 0) ? 0.8 : 0;
      }
      this.gameContainer.alpha = 1.0;
    } else if (this.warpFlash > 0) {
      this.warpFlash--;
      if (this.screenFlashOverlay) {
        this.screenFlashOverlay.visible = (this.warpFlash % 2 === 0);
        this.screenFlashOverlay.tint = 0x44CCFF;
        this.screenFlashOverlay.alpha = (this.warpFlash % 2 === 0) ? 0.65 : 0;
      }
      this.gameContainer.alpha = 1.0;
    } else {
      if (this.screenFlashOverlay) {
        this.screenFlashOverlay.visible = false;
        this.screenFlashOverlay.alpha = 0;
      }
      this.gameContainer.alpha = 1.0;
    }

    // 5. Enemy Bullets (fired by boss turrets and cores)
    this.syncContainer(this.layers.bullets, this.enemyBullets, (sprite, b) => {
      const key = b.type === 'ring' ? 'bullet_ring' : 'bullet_lead';
      const texFrames = this.sprites.get(key);
      const frameIdx = Math.floor(b.frame) % (texFrames ? texFrames.length : 1);
      if (texFrames) sprite.texture = texFrames[frameIdx];
      sprite.x = b.x;
      sprite.y = b.y;
      sprite.anchor.set(0.5);
      sprite.scale.set(1.0);
      sprite.visible = true;
    });

    // Clear unused enemy layers
    if (this.layers.enemies.children.length > 0) this.layers.enemies.removeChildren();
  }

  syncContainer(container, itemsArray, configureFn) {
    while (container.children.length < itemsArray.length) {
      const sp = new PIXI.Sprite();
      container.addChild(sp);
    }
    for (let i = 0; i < itemsArray.length; i++) {
      const sp = container.children[i];
      sp.visible = true;
      configureFn(sp, itemsArray[i]);
    }
    for (let i = itemsArray.length; i < container.children.length; i++) {
      container.children[i].visible = false;
    }
  }
}
