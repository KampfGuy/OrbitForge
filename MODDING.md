# Modding Orbit Forge

Orbit Forge can load **mods**: small JSON files that add parts, new moons, ready-made crafts, loading-screen tips and,
optionally, a script that runs in the game. Mods are installed from the in-game **🧩 Mods** menu (main menu), stored on
your device (IndexedDB), and can be switched on/off or deleted at any time. Changes apply after a reload.

> ⚠ **Script mods run code.** A mod with a `"script"` runs JavaScript inside the game with the same access the game has
> (your saves on this device, the page). The game shows a warning before installing one. Only install script mods from
> people you trust. Mods without a script are just data and can't run code.

## Quick start

1. Copy [`mods/template.json`](mods/template.json) and change `id` and `name`.
2. Edit the parts (sizes in metres, masses in tonnes, thrust in kN).
3. Main menu → **🧩 Mods** → **From file…** and pick your file (or paste a URL to a JSON file that allows CORS, for
   example a GitHub raw link or a GitHub Pages file).
4. Tap **⟳ Reload to apply**. New parts appear in the editors (in the category you gave them, or a new **Mods** tab).

The example mods in [`mods/`](mods/) can be installed straight from the Mods menu:

| File | What it shows |
|---|---|
| [`parts-pack.json`](mods/parts-pack.json) | Three parts (stubby tank, Viper engine, ogive nose), a sample craft, a tip |
| [`ember-moon.json`](mods/ember-moon.json) | A new moon, *Ember*, with a thin atmosphere and its own colours |
| [`readout-hud.json`](mods/readout-hud.json) | Script mod: an extra flight readout panel + a button in the ⋯ menu |
| [`nova-copilot.json`](mods/nova-copilot.json) | Script mod: *Nova*, a copilot who comments on your flight in speech bubbles |
| [`template.json`](mods/template.json) | Minimal starting point |

## File format

```json
{
  "id": "my-mod",            // required: 2-48 letters/digits/dots/dashes, unique
  "name": "My Mod",          // required
  "version": "1.0",
  "author": "You",
  "api": 1,                  // mod API version this was written for
  "description": "What it does",
  "parts":   { "part_id": { ... }, ... },
  "planets": [ { ... } ],
  "crafts":  [ { ... } ],
  "tips":    [ "Loading-screen tip (under 140 characters)" ],
  "script":  "JavaScript source (optional)"
}
```
(Comments above are for explanation only; real JSON can't contain comments.)

### Parts

Each key in `parts` is the part id (2-40 letters, digits, `_` or `-`). A mod can't replace a stock part.

| Field | Meaning |
|---|---|
| `name`, `desc` | Shown in the editors |
| `cat` | Category tab, e.g. `Tanks`, `Engines`, `Boosters`, `Aero`, `Pods`, `Utility`, `Wings` or a new one |
| `h`, `r` | Height and radius in metres (stack parts are cylinders; 0.625 = 1.25 m size, 1.25 = 2.5 m size) |
| `mass` | Total mass in tonnes |
| `dry` | Dry mass in tonnes; `mass - dry` is fuel |
| `thrust` | Engine thrust in kN (makes it an engine) |
| `ispV`, `ispA` | Specific impulse in vacuum / at sea level, seconds |
| `gimbal` | Engine gimbal range, degrees (steering authority) |
| `srb: true` | Solid booster: can't be throttled or shut down |
| `torque` | Reaction wheel torque, kN·m (pods and cores) |
| `crew` | Seats (makes it a crewed pod) |
| `nose: true` | Pointy top: less drag when it's at the top of a stack |
| `shield: true` | Heat shield: protects parts behind it on reentry |
| `tiles: true` | Heat tiles: part survives higher temperatures (2500 K) |
| `mono` | Monopropellant (RCS fuel) it carries, tonnes |
| `radial: "fin"` + `surf` | Radial aero surface; `surf: { "area": m², "span": m, "chord": m, "ctrl": degrees }` (`ctrl` makes it a control surface) |
| `mesh` | Look: `{ "shape": "tank" \| "nose" \| "capsule" \| "engine" \| "srb" \| "wing" \| "box", "color": "#rrggbb", "accent": "#rrggbb" }` |

Unknown fields are ignored. Numbers are checked; a bad part stops that mod from loading and the Mods menu shows the error.

### Planets (moons)

```json
{ "name": "Ember", "parent": "Kampa", "radius": 120000, "gravity": 1.1,
  "orbit": { "a": 24000000, "inc": 3, "lan": 40, "phase": 200 },
  "rotPeriod": 60000,
  "atm": { "height": 25000, "scale": 3500, "rho0": 0.12 },
  "colors": { "low": "#7a3422", "mid": "#a5532f", "high": "#d58a5c", "poles": "#e9d3c0" } }
```

| Field | Meaning |
|---|---|
| `name` | 2-24 characters, unique |
| `parent` | Body it orbits (`Kampa`, `Lumo`, `Pip`, or another mod moon loaded earlier). Default `Kampa` |
| `radius` | Metres, 5 km - 2000 km |
| `gravity` | Surface gravity in m/s² (or give `mu`, the gravitational parameter, in m³/s²) |
| `orbit.a` | Orbit radius in metres; must be more than 3× the parent's radius and inside its sphere of influence. Lumo is at 11.4 Mm, Pip at 45 Mm |
| `orbit.inc`, `orbit.lan`, `orbit.phase` | Inclination, ascending node, starting angle, degrees |
| `rotPeriod` | Day length, seconds |
| `atm` | Optional: `height` (m), `scale` height (m), `rho0` sea-level density (kg/m³; Kampa is 1.225) |
| `colors` | Terrain colours, low ground → high ground, plus optional polar caps |

### Crafts

Same format as a saved craft: a `stack` listed top to bottom, each entry `{ "p": "part_id", "radial": [...] }`, where a
radial group is `{ "sym": 1-8, "ang": radians, "items": ["rdec", "s_thunder"], "fins": true }`. Easiest way to get one:
build it in the game, open the editor's **⋯** menu → **📋 Craft as JSON**, tap **Copy** and paste it into `crafts`. The same box loads a pasted craft. Add `"kind": "plane"` to put it in the hangar
list instead of the rocket list.

## Script API (`api`)

A mod's `script` is run once at load with a single variable, `api`. Everything is plain JavaScript; there's no build step.

```js
api.onFlightStart(f => api.toast('Hello ' + f.craft));
api.onUpdate((dt, f) => { if (f && f.alt > 70000) api.log('in space!'); });
api.addUIButton({ label: 'Hi', icon: '👋', where: 'flight', onClick: f => api.toast('Altitude ' + Math.round(f.alt) + ' m') });
```

| Member | Description |
|---|---|
| `api.version` | API version (1) |
| `api.mod` | `{ id, name, version }` of this mod |
| `api.THREE` | The three.js module the game uses (r170) |
| `api.onLoad(fn)` | Called once after all mods loaded |
| `api.onFlightStart(fn(flight))` | Each time a flight starts (`flight` is the snapshot below) |
| `api.onUpdate(fn(dt, flight))` | Every frame during flight (`dt` in seconds). Keep it cheap |
| `api.onStage(fn(flight, event))` | After each staging |
| `api.onCrash(fn(flight))` | When the craft is destroyed |
| `api.registerPart(id, def)` | Add a part from code (same fields as above) |
| `api.registerPlanet(def)` | Add a moon from code |
| `api.registerCraft(craft)` | Add an example craft |
| `api.addTip(text)` | Add a loading-screen tip |
| `api.addUIButton({ label, icon, where, onClick })` | `where: "flight"` puts it in the flight ⋯ menu, `"menu"` on the main menu |
| `api.toast(text, ms)` | Show a message during flight |
| `api.ui.panel(className)` | Make an absolutely-positioned `<div>` over the game for your own HUD (style it yourself). Recreate it in `onFlightStart`, the UI is rebuilt between screens |
| `api.storage.get(key)` / `.set(key, value)` | Small per-mod saved settings (JSON) |
| `api.log(...)` | `console.log` with the mod's name |
| `api.flight` | Current flight snapshot, or `null` outside flight |
| `api.game` | The game object itself, for advanced use. Unstable: may change between versions |

The **flight snapshot** (read-only, a fresh object each time) has: `body`, `alt` (m), `radar` (m above terrain), `speed`
(orbital, m/s), `srfSpeed`, `vSpeed`, `mach`, `q` (dynamic pressure, kPa), `ap`, `pe` (m above the surface), `throttle`
(0-1), `mass` (kg), `thrust` (N), `twr`, `pitch`, `heading` (degrees), `met` (s), `landed`, `contact` (touching the ground), `destroyed`, `stage`, `heat`
(hottest part as a fraction of its limit), `craft` (name), `situation` (`landed`, `ground`, `flying`, `suborbital`, `orbiting`,
`escaping`, `destroyed`) and the helper `fmtDist(m)`.

If a hook throws three times, it's paused for the session and the Mods menu shows the error.

## Template

[`mods/template.json`](mods/template.json):

```json
{
  "id": "my-first-mod",
  "name": "My First Mod",
  "version": "0.1",
  "author": "You",
  "api": 1,
  "description": "Copy this file, change the id and name, and edit the parts below.",
  "parts": {
    "my_tank": { "name": "My Tank", "cat": "Tanks", "h": 2.0, "r": 0.625, "mass": 1.2, "dry": 0.14,
                 "desc": "A tank I made", "mesh": { "shape": "tank", "color": "#88ccff", "accent": "#224466" } }
  },
  "planets": [],
  "crafts": [],
  "tips": ["Loading my first mod…"],
  "script": "api.onFlightStart(f => api.toast('Hello from ' + api.mod.name + '! Flying ' + (f ? f.craft : '?'), 2500));\n"
}
```

Delete the `script` line if you don't need code. A data-only mod doesn't trigger the code warning.

## Tips

- Keep ids unique, e.g. prefix them with your name (`kg_tank`).
- Test with the browser console open (desktop): mod errors are logged with the mod's id.
- Saved crafts that use a mod's parts are marked ⚠ in **Load…** and can't be opened while that mod is off.
- Sharing: host the JSON on GitHub Pages or as a GitHub raw file, then anyone can install it with **Get** in the Mods menu.
