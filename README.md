# ROOFTOP // VERTIGO

A 3D first-person illegal urban exploration, roofing, and high-altitude extraction game built with **Three.js (r170)** and **PointerLockControls**.

---

## Overview

Explore an industrial night hub, loot underground fallout shelters and bunker wings, scale wet urban rooftops, crawl through ventilation ducts, and ascend massive vertical structures—including an unfinished 130m skyscraper, a 110m brutalist scaffolding tower, a 165m twin-spire comms skyscraper, and a 220m TV broadcast lattice mast.

---

## Core Features

- **PBR Night Atmosphere & Volumetric Lighting**:
  - Three.js `ACESFilmicToneMapping` with selective `UnrealBloomPass` for realistic emissive lights without wall glare.
  - Wet-reflective asphalt with procedural puddle masks, sodium streetlights with soft volumetric light cones, cold flickering fluorescent bunker tubes, and pulsing aviation red obstruction strobes.
  - Instanced geometry batching for ladders, steel trusses, scaffolding frames, and structural boxes (60+ FPS performance target).

- **Vertical Sectors & Map Layout**:
  1. **Central Safe Hub / Wet Alley (`0m`)**: Trader kiosk ("Scrap Buyer"), sodium lighting, puddles, zipline landing cushion.
  2. **Fallout Shelter & Bunker Storage Wing (`-6m`)**: Heavy blast doors, flickering lamps, dual interconnected storage corridors with 9 loot caches.
  3. **Air Vents & Crawl Tubes**: Low-clearance ductwork connecting the surface rear alley to the subterranean bunker wing (switches player into a `0.8m` crawl posture).
  4. **Low/Mid Blocks A & B (`24m – 28m`)**: Exterior metal fire escapes, tar roofs, rooftop catwalk bridge, and west skybridge.
  5. **Brutalist Scaffolding Tower (`110m`)**: Wrap-around scaffolding ramps, a 42m balance plank, safety nets, and the *Seismic Gyro Stabilizer* ($1,250 Sub-Apex).
  6. **Unfinished Skyscraper (`130m`)**: Multi-stage exterior ladders, suspended catch safety nets, 136m tower crane jib catwalk, and summit-to-hub zipline.
  7. **Twin-Spire Comms Skyscraper (`165m`)**: Dual North/South spires, 96m suspended window-washer gondola, 140m wind-tunnel truss skybridge, and the *Quantum Microwave Transceiver* ($2,100 Sub-Apex).
  8. **TV Broadcast Lattice Mast (`220m`)**: 4-legged steel mast with caged ladders, resting platforms, extreme wind shear, summit zipline, and the *Master Broadcast Core* ($3,500 Apex Trophy).

- **Physics, Wind & Vertigo**:
  - Dynamic stamina and encumbrance system (salvage weight increases stamina burn).
  - High-altitude wind gust alerts and lateral force above 50m.
  - **Carabiner Anchor (`F`)**: Clip into ladder rungs, scaffolding poles, I-beams, or anchor bolts to lock movement, rest hands, and recover stamina safely during gusts.
  - Dynamic adaptive collision sub-stepping with 16m spatial hashing to eliminate high-altitude tunnelling.
  - Summit-to-Hub extraction ziplines with mid-air `[Space]` release.

- **Economy & Upgrades**:
  - Sell collected salvage components at the Scrap Buyer Kiosk.
  - Upgrade climbing chalk/gloves, quick-lock carabiner (0.3s latch), tactical wide headlamp, carbon harness pack frame, and adrenaline injections.

---

## Controls

| Key | Action |
| :--- | :--- |
| `W` `A` `S` `D` | Move / Climb |
| `Shift` (Hold) | Sprint on ground / Fast ladder slide |
| `Space` | Jump / Dismount ladder / Release zipline mid-air |
| `Mouse` | Look around (PointerLock) / 180° scan on ladders |
| `F` | Clip / Unclip carabiner anchor |
| `E` | Salvage loot cache / Interact with trader / Enter air vent / Ride zipline |
| `Q` | Energy injection (+65% instant stamina + 8s adrenaline grip) |
| `H` | Toggle tactical headlamp |
| `Tab` | Salvage pack & sector intel dossier |
| `Esc` | Pause menu & graphics settings |

---

## Quick Start

Run any static local web server inside the repository folder:

```bash
# Python 3
python3 -m http.server 8080

# or Node.js npx
npx serve .
```

Open `http://localhost:8080` in any modern WebGL-compatible browser (Chrome, Edge, Firefox, Safari). Click **ENTER THE ALLEY** to begin.
