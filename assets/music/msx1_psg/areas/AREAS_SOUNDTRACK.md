# Zanac (MSX) — Complete In-Game Area Soundtracks

Chaque fichier WAV ci-dessous reproduit **l'expérience musicale complète et continue** de chaque Area telle qu'elle se déroule dans le jeu original sur MSX (AY-3-8910 PSG à 1.7897725 MHz).

### Émulation matérielle exacte au cycle près :
- **Batterie complète restaurée** : Générateur de bruit pseudo-aléatoire 17-bit LFSR échantillon par échantillon (grosse caisse, caisse claire, toms, charleston).
- **Synthé Lead mélodique** : Enveloppe de volume Courbe 7 (`0x5347`) restaurée.
- **Pitch Slide Z80 (0x8C / 0x4F7A)** : Balayage exponentiel descendant produisant les drops spatiaux et impacts de toms réverbérés.
- **Mixeur PSG AY-3-8910** : Combinaison simultanée ton + bruit pour le timbre caractéristique des percussions Compile.
- **Filtre de couplage AC** : Élimination des dérives DC comme sur le condensateur de sortie de la carte mère MSX.

## 🎵 Catalogue des 12 Areas + Bonus

| Fichier | Area / Titre | Durée | Taille WAV | Description & Enchaînement |
|---------|--------------|-------|------------|----------------------------|
| **[Area_01.wav](Area_01.wav)** | Area 01 — First Flight | 01:29 | 7747 KB | Stage 1 Intro Fanfare (Ev 7) → Main Stage BGM with Drums & Lead (Ev 1) → Boss Alert (Ev 12) → Victory (Ev 5) → Round Clear (Ev 26) |
| **[Area_02.wav](Area_02.wav)** | Area 02 — Mechanical Fortress | 01:21 | 7058 KB | Main Stage BGM with Drums & Lead (Ev 1) → Boss Alert (Ev 12) → Victory (Ev 5) → Round Clear (Ev 26) |
| **[Area_03.wav](Area_03.wav)** | Area 03 — Deep Space Infiltration | 01:21 | 7058 KB | Main Stage BGM with Drums & Lead (Ev 1) → Boss Alert (Ev 12) → Victory (Ev 5) → Round Clear (Ev 26) |
| **[Area_04.wav](Area_04.wav)** | Area 04 — Tech Complex Perimeter | 01:21 | 7058 KB | Main Stage BGM with Drums & Lead (Ev 1) → Boss Alert (Ev 12) → Victory (Ev 5) → Round Clear (Ev 26) |
| **[Area_05.wav](Area_05.wav)** | Area 05 — Asteroid Belt Assault | 01:21 | 7058 KB | Main Stage BGM with Drums & Lead (Ev 1) → Boss Alert (Ev 12) → Victory (Ev 5) → Round Clear (Ev 26) |
| **[Area_06.wav](Area_06.wav)** | Area 06 — Core Defense Bastion | 01:21 | 7058 KB | Main Stage BGM with Drums & Lead (Ev 1) → Boss Alert (Ev 12) → Victory (Ev 5) → Round Clear (Ev 26) |
| **[Area_07.wav](Area_07.wav)** | Area 07 — Planetary Surface Strike | 01:21 | 7058 KB | Main Stage BGM with Drums & Lead (Ev 1) → Boss Alert (Ev 12) → Victory (Ev 5) → Round Clear (Ev 26) |
| **[Area_08.wav](Area_08.wav)** | Area 08 — Special Warning Zone | 01:19 | 6886 KB | Round 8 Special Stage Theme (Ev 2) → Boss Alert (Ev 12) → Victory (Ev 5) → Round Clear (Ev 26) |
| **[Area_09.wav](Area_09.wav)** | Area 09 — Citadel Outer Ring | 01:21 | 7058 KB | Main Stage BGM with Drums & Lead (Ev 1) → Boss Alert (Ev 12) → Victory (Ev 5) → Round Clear (Ev 26) |
| **[Area_10.wav](Area_10.wav)** | Area 10 — Heavy Fortification | 01:21 | 7058 KB | Main Stage BGM with Drums & Lead (Ev 1) → Boss Alert (Ev 12) → Victory (Ev 5) → Round Clear (Ev 26) |
| **[Area_11.wav](Area_11.wav)** | Area 11 — The Final Citadel Gate | 01:21 | 7058 KB | Main Stage BGM with Drums & Lead (Ev 1) → Boss Alert (Ev 12) → Victory (Ev 5) → Round Clear (Ev 26) |
| **[Area_12.wav](Area_12.wav)** | Area 12 — The Final Confrontation & Staff Roll | 02:17 | 11883 KB | Final Area Theme (Ev 2) → Mother Computer Boss (Ev 12) → Core Destroyed (Ev 5) → Ending & Credits (Ev 10) → Final Fanfare (Ev 27) |
| **[Title_Screen.wav](Title_Screen.wav)** | Title Screen Theme | 01:05 | 5641 KB | Title Screen Theme (Ev 3, with complete drum track, pitch-slide space drop, and decaying echoes) |
| **[Game_Over.wav](Game_Over.wav)** | Game Over Theme | 00:10 | 904 KB | Game Over Theme (Ev 4) |
| **[Warp_Transfer_Shortcut.wav](Warp_Transfer_Shortcut.wav)** | Inter-Stage Warp Transfer Shortcut (SFX / Jingle) | 00:03 | 324 KB | Inter-Stage Transfer / Warp Shortcut Fanfare (Ev 11) |


---
*Généré avec émulation matérielle AY-3-8910 au cycle près via le moteur Z80 original de Zanac (1987, Pony Canyon / Compile).*