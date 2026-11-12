# Zanac EX WebPort (Remastered 640px Arcade Edition)

An authentic, high-performance web port of **Zanac EX** (Compile / Pony Canyon, MSX2 1986), reverse-engineered directly from the original Z80 ROM assembly and remastered in 640×480 arcade presentation using modern **PixiJS v8** and ES Modules.

---

## Key Technical Features

### 1. Authentic MSX2 Compile Z80 Architecture
* **Accurate Scroll Physics**: Cruising speed of exact 1.00 px/frame (60.0 px/s at 60 Hz), frame-rate independent via normalized `ticker.deltaTime`.
* **Authentic Deceleration & Boss Halt**: 8–10 step ease-out deceleration curve from ROM Bank 13 (`0xB3B0`), BCD countdown timer, and smooth post-boss acceleration (+0.02 px/f).
* **Modular Tilegrid Boss Architecture**: Boss chassis (hulls, wings, armor) are painted directly into the tile grid (`grid_mt`). Destructible components (cannons, radar domes, turrets, eye sockets) mutate the background grid into authentic crater tiles (`under_mt` / MT 21, 19, 18) upon lethal damage with zero sprite alignment seams.
* **Universal 4.0s 5-Phase Eye Core System**:
  * **Petit Cœur** (32×32 in 2×) & **Gros Cœur** (64×64 in 2×)
  * Phase 0 (1.0s): Armored / closed (deflects shots)
  * Phase 1 & 2 (0.5s): Opening slit and half-open transitions
  * Phase 3 (2.0s): Fully open, vulnerable, core pulsing, counter-attacks
  * Phase 2 & 1 (0.5s): Closing transitions

### 2. Dual Graphics Engine (1× Original MSX / 2× Remastered Arcade)
* Seamless in-game toggle (`G` key) between raw 1× MSX2 V9938 tiles/sprites and crisp 2× 256-color remastered pixel art.
* 12-frame arcade explosion particle systems, glowing energy halos, and sub-pixel projectile physics.

### 3. Complete 12-Area World
* All 12 Areas extracted byte-for-byte from MSX2 ROM:
  * Full terrain data, object schedules, and authentic enemy spawn tables (`grid_mt`, `under_mt`, `objects`, `bosses`).
* Dual PSG & EX Stereo soundtrack with gapless looping and authentic sound effects.

---

## Controls

| Action | Keyboard |
| :--- | :--- |
| **Move** | Arrow Keys or `W` / `A` / `S` / `D` |
| **Main Weapon (Rapid Fire)** | `Space` or `Z` |
| **Sub-Weapon (Special)** | `X` or `K` |
| **Toggle Graphics (1× MSX / 2× Remastered)** | `G` |
| **Turbo Scroll (Fast Forward)** | `T` |
| **Next Boss Jump (Debug)** | `B` |
| **Next Area Warp (Debug)** | `N` |
| **Previous Area Warp (Debug)** | `P` |

---

## Project Structure

```
Zanac_WebPort/
├── index.html                 # Main entry point (PixiJS v8 canvas setup)
├── src/
│   ├── engine/
│   │   ├── game.js            # Main game loop, delta ticker, collisions, boss controller
│   │   ├── mapRenderer.js     # RenderTexture 640x496 tilegrid background renderer
│   │   ├── spriteManager.js   # 1x / 2x asset slicer and texture atlas manager
│   │   ├── audio.js           # Web Audio API manager for PSG and stereo BGM/SFX
│   │   ├── enemyManager.js    # Aerial enemy spawn controller and AI
│   │   └── input.js           # Keyboard and gamepad input handling
│   ├── logic/
│   │   ├── weapons.js         # Main cannon (tiers 0-2) and 8 sub-weapons physics
│   │   ├── player.js          # Player physics, banking tilts, invincibility states
│   │   └── ai.js              # MSX enemy behavior state machines
│   └── data/
│       ├── boss_encounters.json # Boss components, hitpoints, and scores
│       ├── enemies.json         # Enemy stats and sprite associations
│       └── weapons.json         # Sub-weapon parameters
├── assets/
│   ├── maps/640px_ex/         # All 12 area grid JSON files (grid_mt, under_mt, bosses)
│   ├── tiles/                 # 256x256 tileset PNGs per Area
│   ├── sprites/               # Remastered 2x, original 1x, and structure sprites
│   ├── music/                 # Stereo and MSX PSG soundtrack files
│   ├── sfx/                   # PSG sound effects
│   └── roms/                  # MSX ROM binaries used for verification
└── tools/
    ├── build_all_zanac_ex_maps.py # ROM disassembler and map extraction engine
    └── export_all_areas_web.py    # Area JSON exporter for web port
```

---

## How to Run Locally

You can run any static HTTP server. For example with Python:

```bash
# In the repository root:
python -m http.server 8085
```

Then open `http://localhost:8085/index.html` in your web browser.

---

## Continuation on Google AI Studio

To continue developing this project with Gemini 1.5 Pro / 2.0 on **Google AI Studio**:

1. Clone or import this GitHub repository: `https://github.com/ultimzeus/zanac-ex-webport`.
2. In Google AI Studio, upload the repository files or select key source files:
   * `src/engine/game.js`
   * `src/engine/mapRenderer.js`
   * `src/logic/weapons.js`
   * `src/data/boss_encounters.json`
3. Set System Instructions:
   > "You are an expert game developer working on Zanac EX WebPort, an authentic MSX2 Compile Z80 shooter in PixiJS v8. All physics and animations must remain frame-rate independent via ticker.deltaTime, boss components mutate directly into the grid_mt/under_mt tilegrid, and 2x remastered pixel art must be preserved."
