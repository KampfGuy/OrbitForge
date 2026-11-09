# Orbit Forge

**By: Kampfguy**

Orbit Forge is an original 3D rocket game that runs in the browser. You build a rocket, fly it to orbit around the home planet **Kampa**, and go on to the moons **Lumo** and **Pip**. It's tuned for Safari on iPhone, and it also runs on Mac Safari, Chrome and Firefox.

▶ **Play:** https://kampfguy.github.io/OrbitForge/

## Features
- **3D builder ("the Forge").** Pods, 1.25 m and 2.5 m tanks, four liquid engines, two solid boosters, stack and side splitters, nose cones, fins, an adapter and a parachute.
  - Parts stack and snap together. Side boosters attach radially with symmetry (×1/2/3/4/6).
  - Delete and undo.
  - Stages are worked out automatically, with live Δv, TWR and burn time for each stage.
  - Crafts save to the device, and there are 4 stock example crafts.
- **3D flight.** Kampa has a 600 km radius and 9.81 m/s² surface gravity.
  - The atmosphere reaches 70 km, with exponential density, drag and pressure-dependent engine Isp.
  - Physics runs on a fixed 50 Hz timestep.
  - Throttle, staging, debris, parachutes, landings, crashes and recovery.
- **SAS** with stability hold plus prograde, retrograde, normal, anti-normal, radial in/out and maneuver modes. The navball is 3D, with surface and orbit speed modes.
- **Orbits.** Patched conics with SOI transitions to Lumo and Pip, using a universal-variable Kepler propagator. Time warp has physics warp (1-4×) and on-rails warp (up to 100 000×).
- **Map view** in 3D with trajectory patches, Ap/Pe/encounter labels and maneuver nodes.
  - Nodes have prograde, normal and radial Δv, with time adjust and snap to Ap/Pe.
  - You can also tap the orbit line to place a node.
  - Shows a burn timer and the predicted encounter periapsis.
- **Floating origin.** Everything renders relative to the vessel, and physics runs in JS doubles, so there's no jitter far from Kampa.
- **Mobile controls.** Joystick, roll buttons, throttle slider, and STAGE, SAS, MAP and warp buttons. The layout handles safe areas and adapts to portrait and landscape.
- **PWA.** You can Add to Home Screen.

## Controls (keyboard)
`W/S` pitch · `A/D` yaw · `Q/E` roll · `Shift/Ctrl` throttle · `Z` full · `X` cut · `Space` stage · `T` SAS · `M` map · `,` `.` warp · `Esc` menu

## Tech
Plain ES modules with no build step. three.js r170 is vendored in `js/vendor/` (MIT).

| File | What's in it |
|------|--------------|
| `js/orbit.js` | bodies, Kepler propagation, patched-conic prediction |
| `js/craft.js` | craft layout, staging, Δv |
| `js/parts.js` | procedural part meshes |
| `js/world.js` | planets, terrain patch, sky |
| `js/flight.js` | simulation, HUD, map, nodes |
| `js/builder.js` | the Forge (rocket builder) |
| `js/navball.js` | the navball |
| `js/main.js` | app shell |

Tests in `tests/` drive the game headlessly with Playwright (Chromium and WebKit).

All names, parts, models and code are original. Gameplay is inspired by the rocket-sim genre.
