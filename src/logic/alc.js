/**
 * Zanac EX WebPort - ALC (Adaptive Level Control) & Wave Spawner
 * Byte-accurate simulation of Zanac's dynamic difficulty system (Subsystem I)
 */

export class ALCSystem {
  constructor(enemyManager, screenWidth = 640, screenHeight = 480) {
    this.enemies = enemyManager;
    this.screenWidth = screenWidth;
    this.screenHeight = screenHeight;

    // ALC state variables (from MSX memory E12E..E142)
    this.spawnPos = 0;             // E12E:E12F (spawn schedule position)
    this.levelSegCtr = 0;         // E131 (segment advance accumulator)
    this.spawnTimer = 60;         // Countdown to next aerial wave spawn
    this.spawnInterval = 75;      // Frames between waves (decreases as ALC rises)
    this.difficultyTier = 0;      // 0..7 (derived from spawnPos)

    // Pre-scripted wave formations
    this.waveTypes = [
      'box_cluster',
      'umber_flock',
      'duster_rush',
      'teruzo_corner_cross',
      'veybar_dive',
      'luster_cruiser_pair',
      'stealth_patrol',
      'large_descender_strike'
    ];
  }

  // Called whenever player fires a shot with measured cadence
  onPlayerFired(cadenceFrames) {
    // Lookup cadence in shot_rate_table simulation:
    // Slower steady firing -> +1, rapid mashing -> up to +24 advance!
    let advance = 1;
    if (cadenceFrames < 6) advance = 24;
    else if (cadenceFrames < 10) advance = 16;
    else if (cadenceFrames < 15) advance = 8;
    else if (cadenceFrames < 22) advance = 3;
    else advance = 1;

    this.spawnPos += advance;
    this.levelSegCtr += advance;

    // Difficulty rises as spawnPos advances
    this.difficultyTier = Math.min(7, Math.floor(this.spawnPos / 250));
    // Spawn rate speeds up as difficulty rises (MSX 0xBE76: 56 -> 50 -> 44 -> 34 -> 28 -> 20 frames)
    this.spawnInterval = Math.max(22, 85 - (this.difficultyTier * 8));
  }

  // Update ALC spawner every frame
  update(scrollRow = 0) {
    this.spawnTimer--;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = this.spawnInterval;
      this.spawnDynamicWave();
    }
  }

  spawnDynamicWave() {
    // Choose wave based on current difficulty tier and random distribution
    const maxWaveIdx = Math.min(this.waveTypes.length - 1, this.difficultyTier + 1);
    const waveName = this.waveTypes[Math.floor(Math.random() * (maxWaveIdx + 1))];

    const marginX = 80;
    const playW = this.screenWidth - marginX * 2;

    switch (waveName) {
      case 'box_cluster': {
        // Spawns 1 to 2 floating boxes (mostly Power Chips or Bullet boxes)
        const bx = marginX + Math.random() * playW;
        const bType = Math.random() < 0.4 ? 6 : (Math.random() < 0.7 ? 4 : 5);
        this.enemies.spawnEnemy(bType, bx, -20);
        break;
      }

      case 'umber_flock': {
        // 2 or 3 Umbers rising from bottom corners
        [-1, 1].forEach(side => {
          const ux = side === -1 ? marginX + 40 : this.screenWidth - marginX - 40;
          this.enemies.spawnEnemy(7, ux, this.screenHeight + 20);
        });
        break;
      }

      case 'duster_rush': {
        // 3 tumbling meteors from top
        [-40, 0, 40].forEach(ox => {
          const dx = this.screenWidth / 2 + ox + (Math.random() * 60 - 30);
          this.enemies.spawnEnemy(10, dx, -20 - Math.abs(ox));
        });
        break;
      }

      case 'teruzo_corner_cross': {
        // Teruzo sweeping from corners
        this.enemies.spawnEnemy(12, this.screenWidth - marginX, this.screenHeight - 60);
        this.enemies.spawnEnemy(13, marginX, this.screenHeight - 60);
        break;
      }

      case 'veybar_dive': {
        // High-speed Veybar dart gliders diving
        [-60, 60].forEach(ox => {
          this.enemies.spawnEnemy(22, this.screenWidth / 2 + ox, -20);
        });
        break;
      }

      case 'luster_cruiser_pair': {
        // Heavy aerial cruisers
        this.enemies.spawnEnemy(16, marginX + 80, -30);
        this.enemies.spawnEnemy(18, this.screenWidth - marginX - 80, -50);
        break;
      }

      case 'stealth_patrol': {
        // Stealth tracker jet flanking player
        const sx = Math.random() < 0.5 ? marginX + 30 : this.screenWidth - marginX - 30;
        this.enemies.spawnEnemy(31, sx, -20);
        break;
      }

      case 'large_descender_strike': {
        // Mini-boss craft
        const lx = this.screenWidth / 2;
        this.enemies.spawnEnemy(61, lx, -40);
        break;
      }
    }
  }
}

