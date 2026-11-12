/**
 * Zanac EX WebPort - Sprite & Texture Manager
 * Supports seamless switching between 1x Original MSX V9938 Sprites and 2x Remastered 256-Color Arcade Sprites
 */

export class SpriteManager {
  constructor() {
    this.mode = '2x'; // Default to 2x Remastered Arcade graphics
    this.textures = { '1x': {}, '2x': {} };
  }

  async init() {
    const v = '?v=boss_cannons_v1';
    // 1. Load 2x Remastered Sheets
    const [sShip2x, sWeap2x, sItem2x, sEnem2x, sStage2x] = await Promise.all([
      PIXI.Assets.load('assets/sprites/remastered_2x/player_ship_sheet.png' + v),
      PIXI.Assets.load('assets/sprites/remastered_2x/weapons_sheet.png' + v),
      PIXI.Assets.load('assets/sprites/remastered_2x/items_and_explosions_sheet.png' + v),
      PIXI.Assets.load('assets/sprites/remastered_2x/enemies_common_sheet.png' + v),
      PIXI.Assets.load('assets/sprites/remastered_2x/enemies_stage_sets_sheet.png' + v),
    ]);

    // 2. Load 1x Original Sheets
    const [sShip1x, sWeap1x, sItem1x, sEnem1x, sStage1x] = await Promise.all([
      PIXI.Assets.load('assets/sprites/original_1x/player_ship_sheet.png' + v),
      PIXI.Assets.load('assets/sprites/original_1x/weapons_sheet.png' + v),
      PIXI.Assets.load('assets/sprites/original_1x/items_and_explosions_sheet.png' + v),
      PIXI.Assets.load('assets/sprites/original_1x/enemies_common_sheet.png' + v),
      PIXI.Assets.load('assets/sprites/original_1x/enemies_stage_sets_sheet.png' + v),
    ]);

    // Set nearest neighbor scaling on all sprite sheets for crisp pixel art
    [sShip2x, sWeap2x, sItem2x, sEnem2x, sStage2x, sShip1x, sWeap1x, sItem1x, sEnem1x, sStage1x].forEach(s => {
      if (s && s.source) {
        s.source.style.scaleMode = 'nearest';
        s.source.scaleMode = 'nearest';
        s.source.style.addressMode = 'clamp-to-edge';
        s.source.update();
      }
    });

    // 3. Load 2x Remastered Structures & Components
    const structNames = [
      'base_220_chassis_2x',
      'base_305_chassis_2x',
      'base_564_chassis_2x',
      'base_a02_chassis_2x',
      'base_round_petit_2x',
      'base_round_petit_chassis_2x',
      'comp_mini_core_2x',
      'comp_mini_core_pulse_2x',
      'comp_boss_core_2x',
      'comp_boss_core_pulse_2x',
      'comp_radar_dome_2x',
      'comp_boss_turret_2x',
      'comp_turret_cannon_2x',
      'comp_eye_phase_0_2x',
      'comp_eye_phase_1_2x',
      'comp_eye_phase_2_2x',
      'comp_eye_phase_3_2x',
      'comp_eye_phase_3_pulse_2x',
      'comp_eye_gros_0_2x',
      'comp_eye_gros_1_2x',
      'comp_eye_gros_2_2x',
      'comp_eye_gros_3_2x',
      'comp_eye_gros_3_pulse_2x',
      'comp_eye_petit_0_2x',
      'comp_eye_petit_1_2x',
      'comp_eye_petit_2_2x',
      'comp_eye_petit_3_2x',
      'comp_eye_petit_3_pulse_2x',
      'crater_21_2x',
      'idol_face_warp_2x',
      'idol_face_item_2x',
      'idol_face_crater_2x',
      'comp_cannon_mt13',
      'comp_cannon_mt14',
      'comp_cannon_mt15',
      'comp_cannon_mt16',
      'comp_cannon_crater',
    ];
    const structAssets = await Promise.all(
      structNames.map(name => PIXI.Assets.load(`assets/sprites/structures/${name}.png` + v))
    );
    structAssets.forEach((tex, idx) => {
      if (tex && tex.source) {
        tex.source.style.scaleMode = 'nearest';
        tex.source.scaleMode = 'nearest';
        tex.source.style.addressMode = 'clamp-to-edge';
        tex.source.update();
      }
      const key = structNames[idx];
      this.textures['2x'][key] = tex;
      this.textures['1x'][key] = tex;
    });

    // 4. Load 12-Frame Authentic Arcade Explosion Sheet (96x96 per frame)
    const expArcade = await PIXI.Assets.load('assets/sprites/remastered_2x/explosion_arcade_12frames.png' + v);
    if (expArcade && expArcade.source) {
      expArcade.source.style.scaleMode = 'nearest';
      expArcade.source.scaleMode = 'nearest';
      expArcade.source.style.addressMode = 'clamp-to-edge';
      expArcade.source.update();
    }
    const arcadeFrames = [];
    for (let f = 0; f < 12; f++) {
      const frame = new PIXI.Rectangle(f * 96, 0, 96, 96);
      arcadeFrames.push(new PIXI.Texture({ source: expArcade.source, frame }));
    }

    // Parse frames for 2x
    Object.assign(this.textures['2x'], this.sliceSheets(sShip2x, sWeap2x, sItem2x, sEnem2x, sStage2x, 2));
    // Parse frames for 1x
    Object.assign(this.textures['1x'], this.sliceSheets(sShip1x, sWeap1x, sItem1x, sEnem1x, sStage1x, 1));

    // Build Weapon-0 style Concentric Idol Halo textures (Yellow CLS & Blackened Warp)
    this.buildIdolHaloTextures(sWeap2x, sWeap1x);

    // Overwrite explosion textures with authentic 12-frame arcade pixel art
    this.textures['2x']['explosion_arcade'] = arcadeFrames;
    this.textures['1x']['explosion_arcade'] = arcadeFrames;
    this.textures['2x']['explosion_orange'] = arcadeFrames;
    this.textures['1x']['explosion_orange'] = arcadeFrames;
    this.textures['2x']['explosion_yellow'] = arcadeFrames;
    this.textures['1x']['explosion_yellow'] = arcadeFrames;
  }

  sliceSheets(sShip, sWeap, sItem, sEnem, sStage, scale) {
    const dict = {};

    // Helper for sub-texture slicing
    const slice = (sheet, x, y, w, h) => {
      const frame = new PIXI.Rectangle(x * scale, y * scale, w * scale, h * scale);
      return new PIXI.Texture({ source: sheet.source, frame });
    };

    // 1. Player Ship (Cell: 32x24) - animated thruster fire (blue & red)
    dict['player_ship_blue'] = slice(sShip, 0, 0, 32, 24);
    dict['player_ship_red'] = slice(sShip, 0, 48, 32, 24);
    dict['player_ship'] = dict['player_ship_blue'];
    for (let i = 0; i < 7; i++) {
      dict[`player_death_${i}`] = slice(sShip, (i + 1) * 32, 0, 32, 24);
    }
    for (let i = 0; i < 4; i++) {
      dict[`player_shield_${i}`] = slice(sShip, i * 32, 24, 32, 24);
      dict[`wing_pod_${i}`] = slice(sShip, (4 + i) * 32 + 8, 28, 16, 16);
    }

    // 2. Weapons (Cell: 32x32)
    for (let tier = 0; tier < 3; tier++) {
      dict[`shot_tier_${tier}`] = [];
      for (let f = 0; f < 4; f++) {
        dict[`shot_tier_${tier}`].push(slice(sWeap, (tier * 4 + f) * 32, 0, 32, 32));
      }
    }
    dict['sub_orb'] = [0, 1, 2, 3].map(f => slice(sWeap, f * 32, 32, 32, 32));
    dict['sub_blade'] = [0, 1, 2, 3].map(f => slice(sWeap, (4 + f) * 32, 32, 32, 32));
    dict['sub_wave'] = [0, 1, 2, 3].map(f => slice(sWeap, f * 32, 64, 32, 32));
    dict['sub_shutter'] = [0, 1, 2, 3].map(f => slice(sWeap, f * 32, 64, 32, 32));
    dict['sub_plasma'] = [0, 1].map(f => slice(sWeap, (10 + f) * 32, 32, 32, 32));
    dict['sub_all_range'] = [0, 1, 2, 3].map(f => slice(sWeap, (4 + f) * 32, 64, 32, 32));

    // 3. Items & Pickups (Cell: 24x24)
    dict['power_chip'] = [0, 1, 2, 3].map(f => slice(sItem, f * 24, 0, 24, 24));
    dict['idol_orb'] = [0, 1, 2, 3].map(f => slice(sItem, (4 + f) * 24, 0, 24, 24));
    dict['box_yellow'] = [0, 1, 2, 3].map(f => slice(sItem, f * 24, 24, 24, 24));
    dict['box_blue'] = [0, 1, 2, 3].map(f => slice(sItem, (4 + f) * 24, 24, 24, 24));
    for (let num = 0; num < 8; num++) {
      dict[`weapon_token_${num}`] = slice(sItem, num * 24, 48, 24, 24);
    }
    dict['explosion_orange'] = [0, 1, 2, 3].map(f => slice(sItem, f * 24, 72, 24, 24));
    dict['explosion_yellow'] = [0, 1, 2, 3].map(f => slice(sItem, (4 + f) * 24, 72, 24, 24));
    dict['bullet_lead'] = [0, 1, 2, 3].map(f => slice(sItem, f * 24, 96, 24, 24));
    dict['bullet_ring'] = [0, 1, 2, 3].map(f => slice(sItem, (4 + f) * 24, 96, 24, 24));

    // 4. Common Enemies (Cell: 32x24)
    const enemyKeys = [
      'loga', 'umber', 'swooper', 'veybar',
      'luster_blue', 'luster_orange', 'duster', 'spinner',
      'teruzo', 'stealth', 'mech_pod', 'tentacle',
      'degid_full', 'degid_half'
    ];
    enemyKeys.forEach((key, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      dict[`enemy_${key}`] = [0, 1, 2, 3].map(f =>
        slice(sEnem, (col * 4 + f) * 32, row * 24, 32, 24)
      );
    });

    // 5. Stage Giant Enemies & Mini-Bosses (Cell: 40x40)
    for (let setIdx = 0; setIdx < 6; setIdx++) {
      dict[`stage_boss_${setIdx}`] = [0, 1, 2, 3].map(f =>
        slice(sStage, f * 40, setIdx * 40, 40, 40)
      );
    }

    return dict;
  }

  buildIdolHaloTextures(sWeap2x, sWeap1x) {
    const makeCanvasTex = (canvas) => {
      const tex = PIXI.Texture.from(canvas);
      if (tex && tex.source) {
        tex.source.style.scaleMode = 'nearest';
        tex.source.scaleMode = 'nearest';
        tex.source.style.addressMode = 'clamp-to-edge';
        tex.source.update();
      }
      return tex;
    };

    // --- 2x Mode: Yellow Concentric Halo (weapons_sheet col 11, row 2) + Blackened Warp variant ---
    const res2x = sWeap2x && sWeap2x.source && sWeap2x.source.resource;
    if (res2x) {
      const cYellow = document.createElement('canvas');
      cYellow.width = 64;
      cYellow.height = 64;
      const ctxY = cYellow.getContext('2d', { willReadFrequently: true });
      ctxY.imageSmoothingEnabled = false;
      // Shift +2px horizontally so the 42x38 rings sit dead-center at (32, 32)
      ctxY.drawImage(res2x, 11 * 64, 128, 64, 64, 2, 0, 64, 64);

      const cBlack = document.createElement('canvas');
      cBlack.width = 64;
      cBlack.height = 64;
      const ctxB = cBlack.getContext('2d');
      const imgData = ctxY.getImageData(0, 0, 64, 64);
      const d = imgData.data;
      for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3];
        if (a > 0) {
          const lum = (d[i] + d[i + 1] + d[i + 2]) / 3;
          if (lum > 170) {
            // Deep near-black core rings
            d[i] = 14;
            d[i + 1] = 14;
            d[i + 2] = 18;
          } else if (lum > 75) {
            // Subtle dark slate edge so rings remain readable over black void
            d[i] = 48;
            d[i + 1] = 48;
            d[i + 2] = 60;
          } else {
            d[i] = 0;
            d[i + 1] = 0;
            d[i + 2] = 0;
          }
        }
      }
      ctxB.putImageData(imgData, 0, 0);

      this.textures['2x']['idol_halo_yellow'] = makeCanvasTex(cYellow);
      this.textures['2x']['idol_halo_black'] = makeCanvasTex(cBlack);
    }

    // --- 1x Mode: Weapon-0 Concentric Rings (col 4, row 2) recolored Yellow & Black ---
    const res1x = sWeap1x && sWeap1x.source && sWeap1x.source.resource;
    if (res1x) {
      const cYellow1 = document.createElement('canvas');
      cYellow1.width = 64;
      cYellow1.height = 64;
      const ctxY1 = cYellow1.getContext('2d', { willReadFrequently: true });
      ctxY1.imageSmoothingEnabled = false;
      ctxY1.drawImage(res1x, 4 * 32, 64, 32, 32, 0, 0, 64, 64);

      const imgY1 = ctxY1.getImageData(0, 0, 64, 64);
      const dy1 = imgY1.data;
      const cBlack1 = document.createElement('canvas');
      cBlack1.width = 64;
      cBlack1.height = 64;
      const ctxB1 = cBlack1.getContext('2d');
      const imgB1 = ctxY1.getImageData(0, 0, 64, 64);
      const db1 = imgB1.data;

      for (let i = 0; i < dy1.length; i += 4) {
        if (dy1[i + 3] > 0) {
          dy1[i] = 255;
          dy1[i + 1] = 232;
          dy1[i + 2] = 0;

          db1[i] = 20;
          db1[i + 1] = 20;
          db1[i + 2] = 28;
        }
      }
      ctxY1.putImageData(imgY1, 0, 0);
      ctxB1.putImageData(imgB1, 0, 0);

      this.textures['1x']['idol_halo_yellow'] = makeCanvasTex(cYellow1);
      this.textures['1x']['idol_halo_black'] = makeCanvasTex(cBlack1);
    }
  }

  setGraphicsMode(mode) {
    if (mode === '1x' || mode === '2x') {
      this.mode = mode;
    }
  }

  get(textureKey) {
    return this.textures[this.mode][textureKey] || this.textures['2x'][textureKey];
  }
}

