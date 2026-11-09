# Auto-land tests: Kestrel jet and the Albatross orbiter (glider, after its tanks are gone), placed on a long final / far out.
# usage: python3 tests/landing.py [engine]
import asyncio, sys, json
from playwright.async_api import async_playwright
ENG = sys.argv[1] if len(sys.argv) > 1 else 'chromium'
CASES = [] if False else [
  ('Kestrel', dict(D=25000, h=3000, v=180)),
  ('Orbiter', dict(D=40000, h=10000, v=230)),
  ('Orbiter', dict(D=60000, h=14000, v=260, cross=8000)),
]
JS = r"""async ([which, opts]) => {
  const c = await import('./js/craft.js');
  let craft;
  if (which === 'Kestrel') craft = c.clone(c.PLANE_EXAMPLES[0]);
  else { craft = c.clone(c.EXAMPLES.find(x => x.name.startsWith('Albatross'))); for (const s of craft.stack) s.radial = (s.radial || []).filter(g => !g.items.includes('rdec')); craft.site = 'runway'; }
  OF.startFlight(craft); const F = OF.flight, D = F.debug; const V = F.r.constructor;
  for (let i = 0; i < 10; i++) F.advance(0.02); if (which === 'Kestrel') D.stage();
  D.place(opts); F.setThrottle(0); D.ap('land');
  const log = []; let i = 0;
  for (; i < 50 * 900 && !F.destroyed; i++) {
    F.advance(0.02);
    if (i % 250 == 0 || (F.ap.phase === 'flare' && i % 50 == 0)) { const vs = F.v.clone().sub(F.groundVel(F.r, new V())); log.push({ t: Math.round(i / 50), phase: F.ap.phase, msg: F.ap.msg, alt: Math.round(F.r.length() - F.body.radius), radar: Math.round(F.lowestAlt()), spd: Math.round(vs.length()), vs: +vs.dot(F.frame().up).toFixed(1), heat: +(F.heatMax || 0).toFixed(2), dbg: F.ap.dbg, thr: +F.throttle.toFixed(2), brk: F.brakes, pitch: +(F.pitchBank().pitch*57.3).toFixed(1), bank: +(F.pitchBank().bank*57.3).toFixed(1) }); }
    if (!F.ap.active) break;
  }
  return { log: log.slice(-40), destroyed: F.destroyed, why: F._crashWhy || null, result: F.ap.result || null, td: F.ap.td, lastMsg: F.ap.msg, t: Math.round(i / 50), landed: F.landed, maxTouch: F.stats && F.stats.touch };
}"""
async def main():
    async with async_playwright() as p:
        if ENG == 'webkit': b = await p.webkit.launch()
        else: b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        errs = []
        for which, opts in CASES:
            pg = await b.new_page(viewport={'width':844,'height':390})
            pg.on('pageerror', lambda e: errs.append('PAGEERROR: '+str(e)))
            await pg.goto('http://localhost:8765/'); await pg.wait_for_function("window.OF && !document.getElementById('boot')", timeout=30000)
            r = await pg.evaluate(JS, [which, opts])
            for l in r.pop('log'): print('  ', json.dumps(l))
            print(which, opts, json.dumps(r), flush=True)
            await pg.close()
        print('errors:', errs[:10])
        await b.close()
asyncio.run(main())
