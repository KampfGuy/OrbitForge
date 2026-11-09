# Scripted takeoff test: Kestrel Jet from the runway, full throttle, rotate, climb.
import asyncio, sys, json
from playwright.async_api import async_playwright
URL='http://localhost:8765/'
ENG = sys.argv[1] if len(sys.argv) > 1 else 'chromium'
CRAFT = int(sys.argv[2]) if len(sys.argv) > 2 else 0
async def main():
    async with async_playwright() as p:
        if ENG == 'webkit': b = await p.webkit.launch()
        else: b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        pg = await b.new_page(viewport={'width':844,'height':390})
        errs=[]
        pg.on('console', lambda m: errs.append(m.type+': '+m.text) if m.type in ('error','warning') else None)
        pg.on('pageerror', lambda e: errs.append('PAGEERROR: '+str(e)))
        await pg.goto(URL); await pg.wait_for_function("window.OF && !document.getElementById('boot')", timeout=20000)
        await pg.evaluate(f"import('./js/craft.js').then(c => OF.startFlight(c.clone(c.PLANE_EXAMPLES[{CRAFT}])))")
        await pg.wait_for_timeout(800)
        st = await pg.evaluate("""() => { const F = OF.flight, D = F.debug; const st = D.simulate(3); 
          const f = F.frame(); const nose = new F.r.constructor(0,1,0).applyQuaternion(F.q);
          return {st, noseUp: nose.dot(f.up), noseE: nose.dot(f.east), contact: F.contact, landed: F.landed, wc: F.gears.map(g=>g.wc), mass: F.mass}; }""")
        print('settle', json.dumps(st))
        log = await pg.evaluate("""() => { const F = OF.flight, D = F.debug; const out = [];
          D.stage(); D.throttle(1); F.sas = true; F.sasMode = 'stab';
          const rec = (tag) => { const f = F.frame(); const vs = F.v.clone().sub(F.groundVel(F.r, new F.r.constructor()));
            const nose = new F.r.constructor(0,1,0).applyQuaternion(F.q); const right = new F.r.constructor(-1,0,0).applyQuaternion(F.q);
            out.push({tag, t: +(F.t).toFixed(1), alt: +(F.r.length()-F.body.radius).toFixed(1), spd: +vs.length().toFixed(1), vs: +vs.dot(f.up).toFixed(1),
              pitch: +(Math.asin(nose.dot(f.up))*57.3).toFixed(1), hdg: +(Math.atan2(nose.dot(f.east), nose.dot(f.north))*57.3).toFixed(1), bank: +(Math.asin(right.dot(f.up))*57.3).toFixed(1),
              aoa: F.aoa !== undefined ? +F.aoa.toFixed(1) : null, contact: F.contact, destroyed: F.destroyed, thr: F._lastBurn ? +(F._lastBurn.F/1000).toFixed(1) : 0}); };
          for (let i = 0; i < 40 && !F.destroyed; i++) { D.simulate(1); if (i % 3 == 0) rec('roll'); const vs = F.v.clone().sub(F.groundVel(F.r, new F.r.constructor())).length(); if (vs > 75) break; }
          rec('rotate');
          // rotate: point nose 12 deg up, wings level, heading east (custom SAS keeps wings level)
          D.point(10, 90);
          for (let i = 0; i < 30 && !F.destroyed; i++) { D.simulate(1); if (i % 3 == 0) rec('climb'); }
          F.gearDown = false;
          D.point(15, 90);
          for (let i = 0; i < 60 && !F.destroyed; i++) { D.simulate(1); if (i % 10 == 0) rec('climb2'); }
          rec('end'); return out; }""")
        for l in log: print(json.dumps(l))
        print('errors:', '\n'.join(errs[:20]))
        await b.close()
asyncio.run(main())
