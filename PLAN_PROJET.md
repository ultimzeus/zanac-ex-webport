# Plan de Développement — `Zanac_WebPort` (Édition Remasterisée 640 px)

1. **Étape 1 — Moteur de Grille de Tuiles (40 × N) & Tileset Dynamique**
   - Export JSON par stage (`grid_mt` 40xN, `under_mt` pour le terrain sous les tourelles détruites, liste des objets destructibles et boîtes d'items).
   - Rendu GPU par tuiles permettant la destruction en temps réel des tourelles (`mt < 27`), dômes (`mt = 23`), boîtes (`mt = 25`) et cœurs de Boss.

2. **Étape 2 — Extraction des Sprites & Remasterisation 2× / 256 Couleurs (NanoBanana)**
   - Extraction depuis la ROM de *Zanac EX* : vaisseau Zanac, 8 armes, ennemis aériens/sol, projectiles, explosions, items, HUD.
   - Passage en résolution 2× et 256 couleurs via NanoBanana (avec bascule 1× Original / 2× Remasterisé dans le jeu).

3. **Étape 3 — Rétro-Ingénierie Exacte des Ennemis (Mouvements & Attaques)**
   - Extraction depuis le code Z80 (`zanac-re` & `Zanac EX`) des trajectoires `(vx, vy)`, machines à états, visée trigonométrique, HP, scores et système ALC.

4. **Étape 4 — Rétro-Ingénierie Exacte des Armes du Fighter Zanac**
   - Scripts complets pour le canon principal et les 8 sous-armes (`#0` All-Range à `#7` Homing) : niveaux d'évolution, sprites, vitesses, pénétration, bouclier et collisions.

5. **Étape 5 — Moteur Web : PixiJS v8 + Boucle 60 Hz fixe**
   - Rendu WebGL2/WebGPU ultra-fluide à 60/120 FPS + logique déterministe à 60 ticks/s (identique au VBlank MSX2) + Web Audio API (OST Stéréo FJ + SFX).

6. **Étape 6 — Première Ébauche Jouable (Prototype Area 1 en 640 px)**
   - Niveau 1 complet jouable en 640 px avec destruction du décor, boîtes de power-ups, 8 armes, ennemis de l'Area 1, Boss final et musique stéréo.

