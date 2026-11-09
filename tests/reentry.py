# Reentry tests. (1) Forge-1 capsule (pod + chute) from an 80 km orbit: deorbit to a 30 km periapsis and fall; must survive the heating.
# (2) Albatross orbiter from an 80 km orbit: deorbit, reentry autopilot, then auto-land. The deorbit point is aimed by a first
#     "scout" run, then flown again. Reports heating, where it ends up and whether it lands on the runway.
# usage: python3 tests/reentry.py [engine] [which...]
import asyncio, sys, json
from playwright.async_api import async_playwright
ENG = sys.argv[1] if len(sys.argv) > 1 else 'chromium'
WHICH = sys.argv[2:] or ['capsule', 'orbiter']
LEAD = 150000  # put the runway this far short of the wings-level glide range; S-turns burn off the spare energy
JS = r"""async ([which, ang0, peT, scout]) => {
  const c = await import('./js/craft.js'); const O = await import('./js/orbit.js');
  let craft;
  if (which === 'capsule') craft = { name: 'Capsule', stack: [{ p: 'chute' }, { p: 'pod1' }] };
  else { craft = c.clone(c.EXAMPLES.find(x => x.name.startsWith('Albatross'))); for (const s of craft.stack) s.radial = (s.radial || []).filter(g => !g.items.includes('rdec')); craft.site = 'runway'; }
  OF.startFlight(craft); const F = OF.flight, D = F.debug, V = F.r.constructor;
  for (let i = 0; i < 5; i++) F.advance(0.02);
  D.setOrbit('Kampa', 80000, ang0); F.gearDown = false; F.gearFrac = 0;
  const el = () => O.elements(F.r, F.v, F.body.mu), alt = () => F.r.length() - F.body.radius;
  const log = []; let maxHeat = 0, maxHeatAlt = 0, maxG = 0, broke = [];
  const origOver = F.overheat.bind(F); F.overheat = p => { broke.push(p.def.name + '@' + Math.round(alt() / 1000) + 'km'); origOver(p); };
  // deorbit burn: retrograde until periapsis is down to peT
  F.sas = true; D.sas('retro'); for (let i = 0; i < 600; i++) F.advance(0.02);
  let burnT = 0;
  if (which === 'capsule') { // capsule has no engine: just give it the deorbit delta-v directly (as if a stage did the burn)
    const vs = F.v.clone(); for (let k = 0; k < 400 && el().rp - F.body.radius > peT; k++) F.v.addScaledVector(vs.clone().normalize(), -1);
  } else { if (F.prop.next === 0) D.stage(); F.setThrottle(1); while (el().rp - F.body.radius > peT && burnT < 120) { F.advance(0.02); burnT += 0.02; } F.setThrottle(0); }
  const pe0 = el().rp - F.body.radius;
  if (which === 'orbiter') { D.ap('reentry'); if (scout) F.ap.noSteer = true; } else { F.sas = true; D.sas('retro'); D.stage(); }
  let handoff = null, t = 0, v0 = F.v.clone();
  for (let i = 0; i < 50 * 3000 && !F.destroyed; i++) {
    F.advance(0.02); t += 0.02;
    const a = alt(); if ((F.heatMax || 0) > maxHeat) { maxHeat = F.heatMax; maxHeatAlt = a; }
    if (i % 5 == 0) { const acc = F.v.clone().sub(v0).length() / 0.1; if (a < 70000) maxG = Math.max(maxG, acc / 9.81); v0.copy(F.v); }
    if (!handoff && ((F.ap.mode === 'land' && F.ap.active) || (scout && a < 28000 && F.v.clone().sub(F.groundVel(F.r, new V())).length() < 480))) { const rw = F.runwayEnds(); handoff = { t: Math.round(t), alt: Math.round(a), dist: Math.round(rw.mid.clone().sub(F.r).length()), craftAng: Math.atan2(-F.r.z, F.r.x), rwAng: Math.atan2(-rw.mid.z, rw.mid.x) }; }
    if (i % 2500 == 0 || (handoff && i % 250 == 0)) log.push({ brk: F.brakes, pb: [+(F.pitchBank().pitch*57.3).toFixed(1), +(F.pitchBank().bank*57.3).toFixed(1)], aoa: +(F.aoa||0).toFixed(1), dbg: F.ap.dbg,  t: Math.round(t), alt: Math.round(a), v: Math.round(F.v.length()), heat: +(F.heatMax || 0).toFixed(2), hot: F.heatPart ? F.heatPart.def.name : '', ap: F.ap.active ? F.ap.mode + '/' + (F.ap.phase || '') : 'off', msg: F.ap.msg });
    if (which === 'capsule' && (F.landed || (F.contact && F.v.clone().sub(F.groundVel(F.r, new V())).length() < 0.5))) break;
    if (which === 'orbiter' && F.ap.result) break;
    if (scout && handoff) break;
    if (which === 'orbiter' && !F.ap.active && F.ap.mode === 'land' && (F.landed || F.contact)) break;
  }
  const rw = F.runwayEnds();
  return { which, ang0, pe0: Math.round(pe0), burnT: +burnT.toFixed(1), destroyed: F.destroyed, why: F._crashMsg || null, maxHeat: +maxHeat.toFixed(2), maxHeatAlt: Math.round(maxHeatAlt), maxG: +maxG.toFixed(1), broke,
    handoff, result: F.ap.result || null, td: F.ap.td || null, endDistToRunway: Math.round(rw.mid.clone().sub(F.r).length()), t: Math.round(t), log };
}"""
async def run(b, args):
    pg = await b.new_page(viewport={'width':844,'height':390}); errs=[]
    pg.on('pageerror', lambda e: errs.append('PAGEERROR: '+str(e)))
    await pg.goto('http://localhost:8765/'); await pg.wait_for_function("window.OF && !document.getElementById('boot')", timeout=30000)
    r = await pg.evaluate(JS, args); await pg.close(); r['errors'] = errs; return r
async def main():
    async with async_playwright() as p:
        if ENG == 'webkit': b = await p.webkit.launch()
        else: b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        for w in WHICH:
            if w == 'capsule':
                r = await run(b, ['capsule', 0, 30000])
            else:
                r = await run(b, ['orbiter', 0, 25000, 1])
                log = r.pop('log'); print('scout', json.dumps(r)[:900])
                if r['handoff']:
                    import math
                    d = r['handoff']['rwAng'] - r['handoff']['craftAng']; d = math.atan2(math.sin(d), math.cos(d))
                    # aim the handoff ~40 km before the runway (the landing pattern needs some room)
                    r = await run(b, ['orbiter', d + LEAD / 600000, 25000, 0])
            log = r.pop('log', [])
            for l in log: print('  ', json.dumps(l))
            print(w, json.dumps(r), flush=True)
        await b.close()
asyncio.run(main())
