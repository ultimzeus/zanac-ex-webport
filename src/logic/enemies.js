/**
 * Zanac EX WebPort - Enemy & Spawning System
 * Accurate behavioral state machines for all aerial, ground, and boss enemies
 */

export class EnemyManager {
  constructor(enemyData, soundManager = null) {
    this.data = enemyData.enemy_types;
    this.sound = soundManager;
    this.activeEnemies = [];
    this.activeBullets = [];
    this.activePickups = [];
    this.activeExplosions = [];
    this.score = 0;
  }

  // --- Spawning Helpers ---

  spawnEnemy(typeId, x, y, extraParams = {}) {
    const def = this.data[typeId];
    if (!def) return null;

    const enemy = {
      id: Math.random().toString(36).substring(2, 9),
      typeId: parseInt(typeId, 10),
      name: def.name,
      category: def.category,
      x: x,
      y: y,
      vx: def.speed_x || 0,
      vy: def.speed_y || 0,
      hp: def.hp || 1,
      maxHp: def.hp || 1,
      score: def.score || 100,
      frame: 0,
      animTimer: 0,
      state: 'active',
      timeAlive: 0,
      spriteBase: def.sprite_base,
      scriptDirs: def.script_dirs ? [...def.script_dirs] : null,
      scriptStep: 0,
      scriptTick: 0,
      fireCadence: def.fire_cadence || 0,
      fireTimer: Math.floor(Math.random() * (def.fire_cadence || 60)),
      ...extraParams,
    };

    if (def.category === 'pickup') {
      this.activePickups.push(enemy);
    } else {
      this.activeEnemies.push(enemy);
    }
    return enemy;
  }

  spawnBullet(bulletType, x, y, targetX = null, targetY = null, speed = 3.5) {
    let vx = 0;
    let vy = speed;

    if (targetX !== null && targetY !== null) {
      const angle = Math.atan2(targetY - y, targetX - x);
      vx = Math.cos(angle) * speed;
      vy = Math.sin(angle) * speed;
    }

    this.activeBullets.push({
      bulletType,
      x,
      y,
      vx,
      vy,
      frame: 0,
      width: bulletType === 37 ? 8 : (bulletType === 20 ? 12 : 16),
      height: bulletType === 37 ? 8 : (bulletType === 20 ? 12 : 16),
    });
  }

  triggerExplosion(x, y, color = 'orange', size = 'normal') {
    if (this.sound) this.sound.playSfx('explosion');
    this.activeExplosions.push({
      x,
      y,
      color,
      size,
      frame: 0,
      maxFrames: 4,
      frameDuration: 4,
      timer: 0,
    });
  }

  // --- Per-Frame Update (60 Hz) ---

  update(playerX, playerY, scrollSpeed = 1.0, screenWidth = 640, screenHeight = 480) {
    // 1. Update Enemies
    for (let i = this.activeEnemies.length - 1; i >= 0; i--) {
      const e = this.activeEnemies[i];
      e.timeAlive++;
      e.animTimer++;
      if (e.animTimer >= 6) {
        e.animTimer = 0;
        e.frame = (e.frame + 1) % 4;
      }

      // Archetype 1: Floating Box (Types 4, 5, 6)
      if (e.category === 'pickup_box') {
        e.y += e.vy + (scrollSpeed * 0.5);
      }

      // Archetype 2: Umber rising with Y-homing (Types 7, 8, 9)
      else if (e.typeId >= 7 && e.typeId <= 9) {
        e.y += e.vy;
        if (e.y < 90 && e.state === 'active') {
          e.state = 'bursting';
          e.vy = 0;
          if (e.typeId === 7) {
            // Burst 7 fragments in circle
            for (let k = 0; k < 7; k++) {
              const ang = (k / 7) * Math.PI * 2;
              this.spawnBullet(38, e.x, e.y, e.x + Math.cos(ang) * 100, e.y + Math.sin(ang) * 100, 2.5);
            }
          } else if (e.typeId === 8) {
            // Burst 2 homing fragments
            this.spawnBullet(20, e.x - 10, e.y, playerX, playerY, 3.0);
            this.spawnBullet(20, e.x + 10, e.y, playerX, playerY, 3.0);
          }
          this.triggerExplosion(e.x, e.y, 'orange');
          this.activeEnemies.splice(i, 1);
          continue;
        }
        if (e.typeId === 9 && e.fireCadence > 0) {
          e.fireTimer++;
          if (e.fireTimer >= e.fireCadence) {
            e.fireTimer = 0;
            this.spawnBullet(20, e.x, e.y, playerX, playerY, 2.8);
          }
        }
      }

      // Archetype 3: Duster lateral homing (Type 10)
      else if (e.typeId === 10) {
        e.y += e.vy;
        const dx = playerX - e.x;
        e.vx += Math.sign(dx) * 0.08;
        e.vx = Math.max(-2.5, Math.min(2.5, e.vx));
        e.x += e.vx;
      }

      // Archetype 4: Teruzo curved motion script (Types 12..15)
      else if (e.typeId >= 12 && e.typeId <= 15) {
        e.scriptTick++;
        if (e.scriptTick >= 8 && e.scriptDirs && e.scriptStep < e.scriptDirs.length) {
          e.scriptTick = 0;
          const dir16 = e.scriptDirs[e.scriptStep];
          const rad = (dir16 / 16) * Math.PI * 2;
          const spd = 3.5;
          e.vx = Math.cos(rad) * spd;
          e.vy = Math.sin(rad) * spd;
          e.scriptStep++;
        }
        e.x += e.vx;
        e.y += e.vy;
      }

      // Archetype 5: Luster aerial cruiser (Types 16..18)
      else if (e.typeId >= 16 && e.typeId <= 18) {
        e.y += e.vy;
        if (e.homing_x) {
          e.x += Math.sign(playerX - e.x) * 1.2;
        }
        if (e.fireCadence > 0) {
          e.fireTimer++;
          if (e.fireTimer >= e.fireCadence) {
            e.fireTimer = 0;
            this.spawnBullet(37, e.x, e.y + 12, playerX, playerY, 3.8);
          }
        }
      }

      // Archetype 6: Veybar dart glider (Type 22)
      else if (e.typeId === 22) {
        e.y += e.vy;
        if (e.timeAlive === 40) {
          this.spawnBullet(37, e.x, e.y + 10, playerX, playerY, 4.0);
        }
      }

      // Archetype 7: Stealth tracker (Types 31, 34)
      else if (e.typeId === 31) {
        if (Math.abs(e.y - playerY) > 20) {
          e.y += Math.sign(playerY - e.y) * 2.2;
        } else {
          e.x += Math.sign(playerX - e.x) * 2.0;
        }
      } else if (e.typeId === 34) {
        // Stealth gunship stationary burst fire
        e.y += 0.8;
        e.fireTimer++;
        if (e.fireTimer >= 60) {
          e.fireTimer = 0;
          [-0.3, 0, 0.3].forEach(offsetAngle => {
            const angle = Math.atan2(playerY - e.y, playerX - e.x) + offsetAngle;
            this.activeBullets.push({
              bulletType: 37,
              x: e.x,
              y: e.y + 12,
              vx: Math.cos(angle) * 3.5,
              vy: Math.sin(angle) * 3.5,
              frame: 0,
              width: 8,
              height: 8,
            });
          });
        }
      }

      // Archetype 8: Ground Turret (Type 44) attached to scroll
      else if (e.category === 'ground') {
        e.y += scrollSpeed;
        e.fireTimer++;
        if (e.fireTimer >= (e.fireCadence || 90)) {
          e.fireTimer = 0;
          if (e.y > 0 && e.y < screenHeight - 60) {
            this.spawnBullet(37, e.x, e.y - 8, playerX, playerY, 3.0);
          }
        }
      }

      // Archetype 9: Large Descender Mini-Boss (Type 61)
      else if (e.typeId === 61) {
        if (e.state === 'active') {
          e.y += 2.0;
          if (e.y >= 96) {
            e.state = 'halting';
            e.haltTimer = 60;
          }
        } else if (e.state === 'halting') {
          e.haltTimer--;
          if (e.haltTimer % 20 === 0) {
            this.spawnBullet(37, e.x - 14, e.y, playerX, playerY, 3.8);
            this.spawnBullet(37, e.x + 14, e.y, playerX, playerY, 3.8);
          }
          if (e.haltTimer <= 0) {
            e.state = 'diving';
            const ang = Math.atan2(playerY - e.y, playerX - e.x);
            e.vx = Math.cos(ang) * 4.5;
            e.vy = Math.sin(ang) * 4.5;
          }
        } else if (e.state === 'diving') {
          e.x += e.vx;
          e.y += e.vy;
        }
      }

      // General movement fallback
      else {
        e.x += e.vx;
        e.y += e.vy;
      }

      // Cull offscreen
      if (e.y < -80 || e.y > screenHeight + 80 || e.x < -80 || e.x > screenWidth + 80) {
        this.activeEnemies.splice(i, 1);
      }
    }

    // 2. Update Bullets
    for (let i = this.activeBullets.length - 1; i >= 0; i--) {
      const b = this.activeBullets[i];
      b.x += b.vx;
      b.y += b.vy;
      b.frame = (b.frame + 1) % 4;
      if (b.y < -30 || b.y > screenHeight + 30 || b.x < -30 || b.x > screenWidth + 30) {
        this.activeBullets.splice(i, 1);
      }
    }

    // 3. Update Pickups
    for (let i = this.activePickups.length - 1; i >= 0; i--) {
      const p = this.activePickups[i];
      p.y += p.vy || 0.8;
      p.animTimer = (p.animTimer || 0) + 1;
      if (p.animTimer >= 6) {
        p.animTimer = 0;
        p.frame = (p.frame + 1) % 4;
      }
      if (p.y > screenHeight + 40) {
        this.activePickups.splice(i, 1);
      }
    }

    // 4. Update Explosions
    for (let i = this.activeExplosions.length - 1; i >= 0; i--) {
      const ex = this.activeExplosions[i];
      ex.timer++;
      if (ex.timer >= ex.frameDuration) {
        ex.timer = 0;
        ex.frame++;
        if (ex.frame >= ex.maxFrames) {
          this.activeExplosions.splice(i, 1);
        }
      }
    }
  }
}

