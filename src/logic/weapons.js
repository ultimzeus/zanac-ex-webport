/**
 * Zanac EX WebPort - Weapons System
 * Byte-accurate simulation of the AFX-6502 Zanac Fighter's Normal Shot and 8 Sub-Weapons (#0..#7)
 */

export class WeaponsManager {
  constructor(weaponsData, soundManager = null) {
    this.data = weaponsData;
    this.sound = soundManager;

    // Normal Shot state
    this.shotLevel = 0;          // 0..5 (upgraded by power chips / key 'P')
    this.shotCooldown = 0;       // Autofire cooldown countdown
    this.nextSalvoId = 0;
    this.shotsFiredCount = 0;    // Cumulative shots
    this.framesSinceLastShot = 0;
    this.activeShots = [];

    // Sub-Weapon state
    this.activeFireNum = 0;      // Current sub-weapon (0..7)
    this.fireAmmo = 0;           // Remaining ammo / durability / seconds
    this.fireMaxAmmo = 0;
    this.fireCooldown = 0;
    this.activeSubWeapons = [];
    this.circularAngle = 0;      // Orbit angle for Fire #3 Circular
    this.selectSubWeapon(0);
  }

  // --- Normal Shot Upgrades & Firing ---

  getShotParams() {
    const lvl = Math.max(0, Math.min(5, this.shotLevel));
    return this.data.normal_shot.levels[lvl];
  }

  powerUp() {
    // Cycle levels 0..5 for complete testing
    this.shotLevel = (this.shotLevel + 1) % 6;
    if (this.sound) this.sound.playSfx('powerup');
    return this.shotLevel;
  }

  addPowerChip() {
    return this.powerUp();
  }

  canFireShot() {
    if (this.shotCooldown > 0) return false;
    const params = this.getShotParams();
    // Count active salvos (clusters fired together), matching MSX Z80 entity slots (0xE320, 0xE340, 0xE360)
    const activeSalvos = new Set(this.activeShots.map(s => s.salvoId)).size;
    return activeSalvos < params.max_simultaneous;
  }

  fireNormalShot(playerX, playerY) {
    if (!this.canFireShot()) return false;

    const params = this.getShotParams();
    this.shotCooldown = params.cooldown || (params.fast ? 4 : 7);
    this.shotsFiredCount++;
    const cadence = this.framesSinceLastShot;
    this.framesSinceLastShot = 0;

    const salvoId = ++this.nextSalvoId;

    // Play authentic tier sound (Event 13, 14, or 15)
    if (this.sound) {
      const sfxName = params.tier === 0 ? 'shot_tier0' : (params.tier === 1 ? 'shot_tier1' : 'shot_tier2');
      this.sound.playSfx(sfxName);
    }

    // Spawn 1, 2, or 3 projectiles depending on tier
    if (params.shots === 1) {
      this.activeShots.push({
        salvoId,
        x: playerX,
        y: playerY - 14,
        vx: 0,
        vy: -params.vy,
        tier: params.tier,
        frame: 0,
        width: 12,
        height: 24,
      });
    } else if (params.shots === 2) {
      [-10, 10].forEach(ox => {
        this.activeShots.push({
          salvoId,
          x: playerX + ox,
          y: playerY - 12,
          vx: 0,
          vy: -params.vy,
          tier: params.tier,
          frame: 0,
          width: 12,
          height: 24,
        });
      });
    } else if (params.shots === 3) {
      [-16, 0, 16].forEach(ox => {
        this.activeShots.push({
          salvoId,
          x: playerX + ox,
          y: playerY - (ox === 0 ? 14 : 10),
          vx: 0,
          vy: -params.vy,
          tier: params.tier,
          frame: 0,
          width: 12,
          height: 24,
        });
      });
    }

    return { fired: true, cadence };
  }

  // --- Sub-Weapon Select & Firing (#0..#7) ---

  selectSubWeapon(fireNum) {
    this.activeFireNum = Math.max(0, Math.min(7, fireNum));
    const def = this.data.sub_weapons[this.activeFireNum];

    if (def.limit_type === 'ammo') {
      this.fireAmmo = 100;
      this.fireMaxAmmo = 100;
    } else if (def.limit_type === 'durability') {
      this.fireAmmo = 100;
      this.fireMaxAmmo = 100;
    } else if (def.limit_type === 'time') {
      this.fireAmmo = 60; // 60s for thorough testing
      this.fireMaxAmmo = 60;
    } else {
      this.fireAmmo = 999; // Infinite
      this.fireMaxAmmo = 999;
    }

    // Reset sub-weapon entities
    this.activeSubWeapons = [];
    if (this.sound) this.sound.playSfx('weapon_switch');
  }

  canFireSubWeapon() {
    if (this.fireCooldown > 0) return false;
    const def = this.data.sub_weapons[this.activeFireNum];
    if (def.limit_type !== 'infinite' && this.fireAmmo <= 0) return false;
    return this.activeSubWeapons.length < def.max_on_screen;
  }

  fireSubWeapon(playerX, playerY, moveDirX = 0, moveDirY = -1) {
    if (!this.canFireSubWeapon()) return false;

    const def = this.data.sub_weapons[this.activeFireNum];
    this.fireCooldown = (def.cooldown !== undefined) ? def.cooldown : 15;

    if (def.limit_type === 'ammo') {
      this.fireAmmo--;
    }

    // Play authentic weapon sound (Event 6 for all sub-weapons on fire)
    if (this.sound) {
      this.sound.playSfx('subweapon_fire');
    }

    switch (this.activeFireNum) {
      case 0: {
        // #0 All-Range Cannon: fires in direction of motion (or forward fan)
        let dirAngle = Math.atan2(moveDirY, moveDirX);
        if (moveDirX === 0 && moveDirY === 0) dirAngle = -Math.PI / 2; // Default upward
        const spd = def.speed || 8;
        this.activeSubWeapons.push({
          type: 0,
          x: playerX,
          y: playerY - 10,
          vx: Math.cos(dirAngle) * spd,
          vy: Math.sin(dirAngle) * spd,
          pierces: false,
          destroys_ground: true,
          destroys_bullets: false,
          radius: 8,
          frame: 0,
        });
        break;
      }

      case 1: {
        // #1 Straight Crasher: slow piercing energy sphere (only 1 on screen)
        this.activeSubWeapons.push({
          type: 1,
          x: playerX,
          y: playerY - 20,
          vx: 0,
          vy: -(def.speed || 3.0),
          pierces: true,
          destroys_ground: true,
          destroys_bullets: true,
          radius: 12,
          frame: 0,
        });
        break;
      }

      case 2: {
        // #2 Field Shutter: forward barrier locked directly in front of ship
        this.activeSubWeapons = [{
          type: 2,
          x: playerX,
          y: playerY + (def.offset_y || -28),
          isLockedToPlayer: true,
          offsetY: def.offset_y || -28,
          destroys_ground: false,
          destroys_bullets: true,
          width: 48,
          height: 24,
          frame: 0,
        }];
        break;
      }

      case 3: {
        // #3 Circular: single round energy ring rapidly rotating around ship
        this.activeSubWeapons = [
          {
            type: 3,
            isOrbiting: true,
            radius: def.orbit_radius || 72,
            destroys_bullets: true,
            pierces: true,
            hitRadius: 12,
            frame: 0,
          },
        ];
        break;
      }

      case 4: {
        // #4 Vibrator: round projectile deployed at fixed Y above ship, scanning horizontally
        const deployY = Math.max(30, playerY - 36);
        this.activeSubWeapons = [{
          type: 4,
          baseX: playerX,
          x: playerX,
          y: deployY,
          time: 0,
          amp: def.vibrate_amplitude || 86,
          freq: def.vibrate_freq || 0.20,
          pierces: true,
          destroys_ground: true,
          destroys_bullets: true,
          hitRadius: 12,
          frame: 0,
        }];
        break;
      }

      case 5: {
        // #5 Rewinder: star cutter rising with deceleration to high reach (+80% amplitude), tracking playerX, lingering at apex (+100% time), then accelerating downwards
        this.activeSubWeapons = [{
          type: 5,
          x: playerX,
          y: playerY - 14,
          vy: def.rise_vy || -8.0,
          gravity: def.decel || 0.15,
          state: 'rising',
          peakDwellFrames: def.peak_dwell_frames || 26,
          peakTimer: 0,
          pierces: true,
          destroys_ground: true,
          destroys_bullets: true,
          width: 24,
          height: 24,
          frame: 0,
        }];
        break;
      }

      case 6: {
        // #6 Plasma Flash: tactical bomb orb detonating on contact to clear all enemies
        this.activeSubWeapons.push({
          type: 6,
          x: playerX,
          y: playerY - 16,
          vx: 0,
          vy: -(def.speed || 6.0),
          isBomb: true,
          pierces: true,
          destroys_ground: true,
          destroys_bullets: true,
          radius: 14,
          frame: 0,
        });
        break;
      }

      case 7: {
        // #7 High Speed: MSX Z80 authentic single ultra-fast star projectile (Slot 0xE380)
        // MSX ASM: fire0_dir_table + set_velocity_from_dir (ix17 = 0xc3 -> speed mult = 36)
        // Dir 12 (Stationary): vx = 0, vy = -36.0 px/frame (2x) [-18 px/f 1x]
        // Dir 13 (Right bank): vx = +13.5, vy = -33.2 px/frame (2x) [+6.75, -16.59 1x]
        // Dir 11 (Left bank):  vx = -13.5, vy = -33.2 px/frame (2x) [-6.75, -16.59 1x]
        let vx = 0;
        let vy = -(def.speed || 36.0);
        if (moveDirX > 0.1) {
          vx = def.diag_vx || 13.5;
          vy = def.diag_vy || -33.2;
        } else if (moveDirX < -0.1) {
          vx = -(def.diag_vx || 13.5);
          vy = def.diag_vy || -33.2;
        }

        this.activeSubWeapons.push({
          type: 7,
          x: playerX,
          y: playerY - 14,
          vx,
          vy,
          pierces: true,
          destroys_ground: true,
          destroys_bullets: true,
          width: 24,
          height: 24,
          frame: 0,
        });
        break;
      }
    }

    return true;
  }

  // --- Per-Frame Update (60 Hz Normalized) ---

  update(playerX, playerY, screenWidth = 640, screenHeight = 480, deltaFrames = 1) {
    if (this.shotCooldown > 0) this.shotCooldown = Math.max(0, this.shotCooldown - deltaFrames);
    if (this.fireCooldown > 0) this.fireCooldown = Math.max(0, this.fireCooldown - deltaFrames);
    this.framesSinceLastShot += deltaFrames;

    // Time-based sub-weapon decrement (#3, #7)
    const def = this.data.sub_weapons[this.activeFireNum];
    if (def.limit_type === 'time' && this.fireAmmo > 0) {
      this.fireAmmo -= (deltaFrames / 60);
      if (this.fireAmmo <= 0) {
        this.selectSubWeapon(0); // Expire back to #0 All-Range
      }
    }

    // 1. Update Normal Shots
    for (let i = this.activeShots.length - 1; i >= 0; i--) {
      const s = this.activeShots[i];
      s.x += s.vx * deltaFrames;
      s.y += s.vy * deltaFrames;
      s.frame = (s.frame + deltaFrames) % 4;
      if (s.y < -30 || s.y > screenHeight + 30 || s.x < -30 || s.x > screenWidth + 30) {
        this.activeShots.splice(i, 1);
      }
    }

    // 2. Update Sub-Weapons
    this.circularAngle += 0.18 * deltaFrames; // Fast rotation for #3

    for (let i = this.activeSubWeapons.length - 1; i >= 0; i--) {
      const sw = this.activeSubWeapons[i];

      if (sw.type === 2) {
        // #2 Field Shutter: locked directly ahead of ship, thickness decreases with durability
        sw.x = playerX;
        sw.y = playerY + sw.offsetY;
        const pct = this.fireAmmo / (this.fireMaxAmmo || 100);
        if (pct > 0.75) sw.frame = 0;      // 4 layers (thick)
        else if (pct > 0.50) sw.frame = 1; // 3 layers
        else if (pct > 0.25) sw.frame = 2; // 2 layers
        else sw.frame = 3;                 // 1 layer (thin)

        if (this.fireAmmo <= 0) {
          this.activeSubWeapons.splice(i, 1);
          this.selectSubWeapon(0);
          continue;
        }
      } else if (sw.type === 3) {
        // #3 Circular: single orb rapidly rotating around fighter
        sw.x = playerX + Math.cos(this.circularAngle) * sw.radius;
        sw.y = playerY + Math.sin(this.circularAngle) * sw.radius;
        sw.frame = (sw.frame + deltaFrames) % 4;

        if (this.fireAmmo <= 0) {
          this.activeSubWeapons.splice(i, 1);
          this.selectSubWeapon(0);
          continue;
        }
      } else if (sw.type === 4) {
        // #4 Vibrator: horizontal scan across 4x ship width at fixed deployed Y
        sw.time += deltaFrames;
        sw.x = sw.baseX + Math.sin(sw.time * sw.freq) * sw.amp;
        sw.frame = (sw.frame + deltaFrames) % 4;

        if (this.fireAmmo <= 0) {
          this.activeSubWeapons.splice(i, 1);
          this.selectSubWeapon(0);
          continue;
        }
      } else if (sw.type === 5) {
        // #5 Rewinder: tracks playerX, decelerates to peak, lingers at peak (+100% time), then accelerates down
        sw.x = playerX;

        if (sw.state === 'rising') {
          sw.y += sw.vy * deltaFrames;
          sw.vy += sw.gravity * deltaFrames;
          if (sw.vy >= 0) {
            sw.state = 'peak';
            sw.vy = 0;
            sw.peakTimer = sw.peakDwellFrames || 26;
          }
        } else if (sw.state === 'peak') {
          // Lingering at apex: spins furiously while chopping anything in its path (+100% duration)
          sw.peakTimer -= deltaFrames;
          if (sw.peakTimer <= 0) {
            sw.state = 'falling';
            sw.vy = 0.5;
          }
        } else {
          // Accelerating downward back toward player
          sw.y += sw.vy * deltaFrames;
          sw.vy += sw.gravity * 1.6 * deltaFrames;
          if (sw.y >= playerY + 16) {
            this.activeSubWeapons.splice(i, 1);
            continue;
          }
        }

        sw.frame = (sw.frame + deltaFrames) % 4;
      } else {
        // Linear movement (#0, #1, #6, #7)
        sw.x += (sw.vx || 0) * deltaFrames;
        sw.y += (sw.vy || 0) * deltaFrames;
        sw.frame = (sw.frame + deltaFrames) % 4;
      }

      // Cull offscreen
      if (!sw.isLockedToPlayer && !sw.isOrbiting && sw.type !== 4) {
        const cullTop = sw.type === 7 ? -20 : -40;
        const cullSide = sw.type === 7 ? -20 : -40;
        const cullRight = sw.type === 7 ? screenWidth + 20 : screenWidth + 40;
        if (sw.y < cullTop || sw.y > screenHeight + 40 || sw.x < cullSide || sw.x > cullRight) {
          this.activeSubWeapons.splice(i, 1);
        }
      }
    }
  }
}
