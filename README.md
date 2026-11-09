# Orbit Forge

**By: Kampfguy**

Orbit Forge is an original 3D rocket and spaceplane game that runs in the browser. You build a rocket or a spaceplane, fly it to orbit around the home planet **Kampa**, and go on to the moons **Lumo** and **Pip**. It's tuned for Safari on iPhone, and it also runs on Mac Safari, Chrome and Firefox.

▶ **Play:** https://kampfguy.github.io/OrbitForge/

## Features
- **3D builder ("the Forge").** Pods, 1.25 m and 2.5 m tanks, four liquid engines, two solid boosters, stack and side splitters, nose cones, fins, an adapter and a parachute.
  - Parts stack and snap together. Side boosters attach radially with symmetry (×1/2/3/4/6).
  - Delete and undo.
  - Stages are worked out automatically, with live Δv, TWR and burn time for each stage.
  - Crafts save to the device, and there are 4 stock example crafts.
- **The Hangar (spaceplanes).** A second editor where planes are built lying flat.
  - Parts: Hawk and Heron cockpits, fuselage tanks, a tail cone, delta and straight wings, strakes, elevons, a rudder tail, tail fins, nose and main landing gear, a shock-cone intake and side intakes.
  - Engines: the Gust Turbojet (air-breathing only) and the Twinmode Hybrid (breathes air up to about Mach 5 and 25 km, then switches to rocket mode on its own).
  - Wings, gear and intakes are always mirrored. Live CoM (yellow), CoL (blue) and CoT (magenta) markers, plus design warnings.
  - Stock planes: **Kestrel Jet** and **Skylance SSTO**.
- **Runway and hangar** at the space center. The runway runs east-west and is 2.4 km long.
- **Flight model for planes.**
  - Each wing surface has its own lift and drag with angle of attack, stall and Mach effects.
  - Control surfaces deflect automatically for pitch, roll and yaw, from the pilot or from SAS.
  - Spring-damper wheels with rolling resistance, brakes (`B`), side friction and nose-wheel steering.
  - Retractable gear (`G`). Jets spool up, and need intakes and air.
- **KSP-style loading screen** with original artwork rendered from the game itself, a progress bar and rotating tips.
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
- **Mobile controls, tuned for the iPhone 12.**
  - Compact navball at the bottom center with the speed readout.
  - SAS button plus a SAS-mode pop-up.
  - Collapsible staging chip, and an altitude pill that expands on tap.
  - Joystick and roll under the left thumb. Throttle and a big STAGE button under the right.
  - GEAR and BRK buttons for planes.
  - In map view, the node editor moves to the left side (landscape) or a bottom sheet (portrait).
  - The builders use a slide-out parts drawer.
  - Landscape is recommended. A dismissible hint appears in portrait.
- **PWA.** You can Add to Home Screen.

## Controls (keyboard)
`W/S` pitch (W = nose down) · `A/D` yaw · `Q/E` roll · `Shift/Ctrl` throttle · `Z` full · `X` cut · `Space` stage · `T` SAS · `M` map · `G` gear · `B` brakes (hold) · `,` `.` warp · `Esc` menu

**Planes:** on the runway, press STAGE to start the engine, go to full throttle, and pull back (`S` or stick down) at about 70-90 m/s. The stick banks the plane in the air and steers the nose wheel on the ground.

## Tech
Plain ES modules with no build step. three.js r170 is vendored in `js/vendor/` (MIT).

| File | What's in it |
|------|--------------|
| `js/orbit.js` | bodies, Kepler propagation, patched-conic prediction |
| `js/craft.js` | craft layout, staging, Δv |
| `js/parts.js` | part definitions and procedural meshes |
| `js/world.js` | planets, terrain patch, sky |
| `js/flight.js` | simulation, HUD, map, nodes |
| `js/builder.js` | the Forge (rockets) and the Hangar (planes) |
| `js/navball.js` | the navball |
| `js/main.js` | app shell |

Tests in `tests/` drive the game headlessly with Playwright (Chromium and WebKit). They include `plane.py` (runway takeoff and climb), `ssto.py` (spaceplane to orbit), `interaction.py` (building a rocket and a plane with taps, then flying them with the on-screen controls) and `render_art.py` (renders the loading-screen art).

All names, parts, models and code are original. Gameplay is inspired by the rocket-sim genre.
