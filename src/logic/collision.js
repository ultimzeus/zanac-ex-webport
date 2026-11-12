/**
 * Zanac EX WebPort - Collision & Interaction Engine
 * Implements exact collision matrix from MSX Zanac EX death_transition_table (0x716B)
 */

export class CollisionSystem {
  constructor(weaponsManager, enemyManager, mapRenderer = null, soundManager = null) {
    this.weapons = weaponsManager;
    this.enemies = enemyManager;
    this.map = mapRenderer;
    this.sound = soundManager;
  }

  // Fast axis-aligned box overlap check
  testBoxOverlap(x1, y1, w1, h1, x2, y2, w2, h2) {
    return (
      Math.abs(x1 - x2) * 2 < (w1 + w2) &&
      Math.abs(y1 - y2) * 2 < (h1 + h2)
    );
  }

  // Fast radial distance check
  testCircleOverlap(x1, y1, r1, x2, y2, r2) {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return (dx * dx + dy * dy) <= (r1 + r2) * (r1 + r2);
  }

  checkAllCollisions(player, onPlayerHit, onBossDestroyed = null) {
    const pW = 16, pH = 16;

    // 1. Player vs Pickups (Power Chips & Weapon Tokens)
    for (let i = this.enemies.activePickups.length - 1; i >= 0; i--) {
      const p = this.enemies.activePickups[i];
      if (this.testBoxOverlap(player.x, player.y, pW, pH, p.x, p.y, 22, 22)) {
        if (p.typeId === 63) {
          // Power Chip: Upgrade normal shot
          this.weapons.addPowerChip();
          this.enemies.score += 100;
          if (this.sound) this.sound.playSfx('power_up');
        } else if (p.typeId === 83) {
          // Numbered Sub-Weapon Token (0..7)
          this.weapons.selectSubWeapon(p.subWeaponNum !== undefined ? p.subWeaponNum : 0);
          this.enemies.score += 200;
          if (this.sound) this.sound.playSfx('power_up');
        }
        this.enemies.activePickups.splice(i, 1);
      }
    }

    // 2. Player vs Enemy Bullets
    if (!player.isInvincible && !player.isDead) {
      for (let i = this.enemies.activeBullets.length - 1; i >= 0; i--) {
        const b = this.enemies.activeBullets[i];
        if (this.testCircleOverlap(player.x, player.y, 6, b.x, b.y, b.width ? b.width / 2 : 4)) {
          this.enemies.activeBullets.splice(i, 1);
          this.enemies.triggerExplosion(b.x, b.y, 'orange');
          onPlayerHit('bullet');
          break;
        }
      }
    }

    // 3. Player vs Aerial Enemies
    if (!player.isInvincible && !player.isDead) {
      for (let i = this.enemies.activeEnemies.length - 1; i >= 0; i--) {
        const e = this.enemies.activeEnemies[i];
        if (e.category === 'ground') continue; // Ground turrets don't collide with flying ship directly
        const eW = e.typeId === 61 || e.typeId === 72 ? 40 : 20;
        const eH = e.typeId === 61 || e.typeId === 72 ? 40 : 20;
        if (this.testBoxOverlap(player.x, player.y, pW, pH, e.x, e.y, eW, eH)) {
          onPlayerHit('enemy');
          break;
        }
      }
    }

    // 4. Ground Objects Interaction (Turret fire & destructibles)
    if (this.map && this.map.gridData && this.map.gridData.objects) {
      const scrollY = this.map.scrollPosY;
      const objs = this.map.gridData.objects;

      for (let i = 0; i < objs.length; i++) {
        const obj = objs[i];
        if (obj.destroyed) continue;

        const screenX = obj.col * 16 + 8;
        const screenY = 480 - (obj.row * 16 - scrollY) - 8;

        // Skip if outside active viewport
        if (screenY < -24 || screenY > 504) continue;

        // Ground Turret Fire logic
        if (obj.type === 'turret_cannon' || obj.type === 'turret_box' || obj.type === 'boss_turret') {
          obj.fireTimer = (obj.fireTimer || Math.floor(Math.random() * 80)) + 1;
          if (obj.fireTimer >= 110) {
            obj.fireTimer = 0;
            if (screenY > 20 && screenY < 400 && !player.isDead) {
              this.enemies.spawnBullet(38, screenX, screenY, player.x, player.y, 2.6);
            }
          }
        }

        // Sub-Weapons vs Ground Object
        for (let swIdx = this.weapons.activeSubWeapons.length - 1; swIdx >= 0; swIdx--) {
          const sw = this.weapons.activeSubWeapons[swIdx];
          if (!sw.destroys_ground) continue;

          const hit = sw.isOrbiting
            ? this.testCircleOverlap(sw.x, sw.y, sw.hitRadius || 14, screenX, screenY, 10)
            : this.testBoxOverlap(sw.x, sw.y, sw.width || 24, sw.height || 20, screenX, screenY, 16, 16);

          if (hit) {
            obj.hp -= (sw.damage || 2);
            this.enemies.triggerExplosion(screenX, screenY, 'yellow', 'small');
            if (obj.hp <= 0) {
              this.destroyGroundObject(obj, screenX, screenY, onBossDestroyed);
            }
            if (!sw.pierces) {
              this.weapons.activeSubWeapons.splice(swIdx, 1);
            }
            break;
          }
        }

        // Normal Shots vs Ground Object
        for (let sIdx = this.weapons.activeShots.length - 1; sIdx >= 0; sIdx--) {
          const s = this.weapons.activeShots[sIdx];
          if (this.testBoxOverlap(s.x, s.y, s.width || 8, s.height || 14, screenX, screenY, 16, 16)) {
            this.weapons.activeShots.splice(sIdx, 1);
            obj.hp -= 1;
            this.enemies.triggerExplosion(screenX, screenY, 'yellow', 'small');
            if (obj.hp <= 0) {
              this.destroyGroundObject(obj, screenX, screenY, onBossDestroyed);
            }
            break;
          }
        }
      }
    }

    // 5. Sub-Weapons vs Enemy Bullets & Aerial Enemies
    for (let swIdx = this.weapons.activeSubWeapons.length - 1; swIdx >= 0; swIdx--) {
      const sw = this.weapons.activeSubWeapons[swIdx];

      // Bullets vs Sub-Weapon
      if (sw.destroys_bullets) {
        for (let bIdx = this.enemies.activeBullets.length - 1; bIdx >= 0; bIdx--) {
          const b = this.enemies.activeBullets[bIdx];
          const hit = sw.isOrbiting
            ? this.testCircleOverlap(sw.x, sw.y, sw.hitRadius || 12, b.x, b.y, 6)
            : this.testBoxOverlap(sw.x, sw.y, sw.width || 24, sw.height || 20, b.x, b.y, 8, 8);

          if (hit) {
            this.enemies.activeBullets.splice(bIdx, 1);
            this.enemies.triggerExplosion(b.x, b.y, 'yellow', 'small');
            if (sw.type === 2) { // Field Shutter loses durability
              this.weapons.fireAmmo = Math.max(0, this.weapons.fireAmmo - 2);
            }
          }
        }
      }

      // Enemies vs Sub-Weapon
      for (let eIdx = this.enemies.activeEnemies.length - 1; eIdx >= 0; eIdx--) {
        const e = this.enemies.activeEnemies[eIdx];
        const eW = e.typeId === 61 ? 40 : 20;
        const eH = e.typeId === 61 ? 40 : 20;
        const hit = sw.isOrbiting
          ? this.testCircleOverlap(sw.x, sw.y, sw.hitRadius || 14, e.x, e.y, eW / 2)
          : this.testBoxOverlap(sw.x, sw.y, sw.width || 24, sw.height || 20, e.x, e.y, eW, eH);

        if (hit) {
          if (sw.type === 6 && sw.isBomb) {
            // Plasma Flash Screen Bomb Detonates!
            this.detonatePlasmaBomb(sw.x, sw.y);
            this.weapons.activeSubWeapons.splice(swIdx, 1);
            break;
          }

          e.hp -= (sw.damage || 2);
          if (sw.type === 2) {
            this.weapons.fireAmmo = Math.max(0, this.weapons.fireAmmo - 5);
          }

          if (e.hp <= 0) {
            this.destroyEnemy(e, eIdx);
          }

          if (!sw.pierces) {
            this.weapons.activeSubWeapons.splice(swIdx, 1);
            break;
          }
        }
      }
    }

    // 6. Normal Shots vs Aerial Enemies
    for (let sIdx = this.weapons.activeShots.length - 1; sIdx >= 0; sIdx--) {
      const s = this.weapons.activeShots[sIdx];
      let shotConsumed = false;

      for (let eIdx = this.enemies.activeEnemies.length - 1; eIdx >= 0; eIdx--) {
        const e = this.enemies.activeEnemies[eIdx];
        const eW = e.typeId === 61 ? 36 : 18;
        const eH = e.typeId === 61 ? 36 : 18;

        if (this.testBoxOverlap(s.x, s.y, s.width, s.height, e.x, e.y, eW, eH)) {
          shotConsumed = true;
          e.hp -= 1;
          if (e.hp <= 0) {
            this.destroyEnemy(e, eIdx);
          } else {
            this.enemies.triggerExplosion(s.x, s.y, 'yellow', 'small');
          }
          break;
        }
      }

      if (shotConsumed) {
        this.weapons.activeShots.splice(sIdx, 1);
      }
    }
  }

  destroyGroundObject(obj, screenX, screenY, onBossDestroyed = null) {
    obj.destroyed = true;
    if (this.sound) this.sound.playSfx('explosion_large');
    this.enemies.triggerExplosion(screenX, screenY, 'orange', 'large');
    this.enemies.score += (obj.type.includes('boss') ? 2000 : 500);

    // Update map grid tile visually
    if (this.map && this.map.gridData) {
      const destMt = obj.destroyed_mt !== undefined ? obj.destroyed_mt : this.map.gridData.under_mt[obj.row][obj.col];
      this.map.gridData.grid_mt[obj.row][obj.col] = destMt;
    }

    // Handle drops
    if (obj.item_drop !== null && obj.item_drop !== undefined) {
      if (obj.item_drop === 'power_chip') {
        this.enemies.spawnEnemy(63, screenX, screenY);
      } else if (typeof obj.item_drop === 'number') {
        this.enemies.spawnEnemy(83, screenX, screenY, { subWeaponNum: obj.item_drop });
      }
    }

    // Check if Boss Core
    if (obj.type === 'boss_core') {
      const coresRemaining = this.map.gridData.objects.filter(o => o.type === 'boss_core' && !o.destroyed);
      if (coresRemaining.length === 0) {
        if (onBossDestroyed) onBossDestroyed();
      }
    }
  }

  destroyEnemy(enemy, enemyIndex) {
    this.enemies.score += enemy.score;
    this.enemies.triggerExplosion(enemy.x, enemy.y, 'orange');

    // Handle Drops
    if (enemy.category === 'pickup_box') {
      const drop = enemy.drop_on_destroy || {};
      if (drop.type === 'power_chip') {
        this.enemies.spawnEnemy(63, enemy.x, enemy.y);
      } else if (drop.type === 'bullets') {
        for (let k = 0; k < 3; k++) {
          const ang = (Math.PI * 0.3) + (k * 0.2);
          this.enemies.spawnBullet(38, enemy.x, enemy.y, enemy.x + Math.cos(ang) * 60, enemy.y + Math.sin(ang) * 60, 2.5);
        }
      }
    }

    this.enemies.activeEnemies.splice(enemyIndex, 1);
  }

  detonatePlasmaBomb(bombX, bombY) {
    if (this.sound) this.sound.playSfx('explosion_large');
    this.enemies.triggerExplosion(bombX, bombY, 'yellow', 'large');

    // Annihilate all aerial enemies on screen
    for (let i = this.enemies.activeEnemies.length - 1; i >= 0; i--) {
      const e = this.enemies.activeEnemies[i];
      if (e.category !== 'ground') {
        this.destroyEnemy(e, i);
      }
    }
    // Also clear all bullets
    this.enemies.activeBullets = [];
  }
}

