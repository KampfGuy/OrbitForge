# Autopilot ascent tests: Forge-1 and the Albatross shuttle to orbit; logs the flight and the result.
# usage: python3 tests/shuttle.py [engine] [craftName]
import asyncio, sys, json
from playwright.async_api import async_playwright
ENG = sys.argv[1] if len(sys.argv) > 1 else 'chromium'
NAMES = sys.argv[2:] or ['Forge-1 Orbiter', 'Albatross Shuttle']
JS = r"""async (name) => {
  const c = await import('./js/craft.js'); const craft = c.clone(c.EXAMPLES.find(x => x.name === name)); OF.startFlight(craft);
  const F = OF.flight, D = F.debug, V = F.r.constructor; const log = [];
  const st = () => { const f = F.frame(), n = new V(0,1,0).applyQuaternion(F.q), alt = F.r.length() - F.body.radius; const el = (F.debug.orbit ? null : null);
    const vs = F.v.clone().sub(F.groundVel(F.r, new V()));
    return { t: Math.round(F.t - F.t0), alt: Math.round(alt), v: Math.round(F.v.length()), pitch: +(Math.asin(n.dot(f.up))*57.3).toFixed(1), fpa: +(Math.asin(vs.clone().normalize().dot(f.up))*57.3).toFixed(1),
      hdg: Math.round(Math.atan2(n.dot(f.east), n.dot(f.north))*57.3), thr: +F.throttle.toFixed(2), mass: +F.mass.toFixed(1), next: F.prop.next, ev: F.events.length, heat: +((F.heatMax||0)).toFixed(2), ap: F.ap.phase, msg: F.ap.msg, w: +(F.w.length()*57.3).toFixed(1), q: Math.round((F.q_dyn||0)/1000) }; };
  F.t0 = F.t0 || F.t; const t0 = F.t;
  D.ap('ascent');
  let k = 0; const orbit = () => { const { elements } = window.__orb || {}; return null; };
  for (let i = 0; i < 60000 && !F.destroyed; i++) { F.advance(0.02); if (i % 500 == 0) log.push(st()); if (F.ap.phase === 'done' || !F.ap.active) { log.push(st()); break; } }
  const { elements } = await import('./js/orbit.js'); const el = elements(F.r, F.v, F.body.mu);
  return { log, destroyed: F.destroyed, why: F.crashWhy || null, ap: Math.round(el.ra - F.body.radius), pe: Math.round(el.rp - F.body.radius), simTime: Math.round(F.t - t0), apMsg: F.ap.msg, apActive: F.ap.active, phase: F.ap.phase };
}"""
async def main():
    async with async_playwright() as p:
        if ENG == 'webkit': b = await p.webkit.launch()
        else: b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        errs = []
        for name in NAMES:
            pg = await b.new_page(viewport={'width':844,'height':390})
            pg.on('pageerror', lambda e: errs.append('PAGEERROR: '+str(e)))
            pg.on('console', lambda m: errs.append(m.type+' '+m.text) if m.type in ('error','warning') else None)
            await pg.goto('http://localhost:8765/'); await pg.wait_for_function("window.OF && !document.getElementById('boot')", timeout=30000)
            r = await pg.evaluate(JS, name)
            for l in r.pop('log'): print('  ', json.dumps(l))
            print(name, json.dumps(r), flush=True)
            await pg.close()
        print('errors:', errs[:10])
        await b.close()
asyncio.run(main())
