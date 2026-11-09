# Spaceplane-to-orbit attempt with the stock Skylance SSTO (scripted autopilot inside the page).
import asyncio, sys, json
from playwright.async_api import async_playwright
URL='http://localhost:8765/'
ENG = sys.argv[1] if len(sys.argv) > 1 else 'chromium'
async def main():
    async with async_playwright() as p:
        b = await (p.webkit.launch() if ENG == 'webkit' else p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']))
        pg = await b.new_page(viewport={'width':844,'height':390})
        errs=[]
        pg.on('pageerror', lambda e: errs.append('PAGEERROR: '+str(e)))
        await pg.goto(URL); await pg.wait_for_function("window.OF && !document.getElementById('boot')", timeout=20000)
        await pg.evaluate("import('./js/craft.js').then(c => OF.startFlight(c.clone(c.PLANE_EXAMPLES[1])))")
        await pg.wait_for_timeout(800)
        log = await pg.evaluate("""() => { const F = OF.flight, D = F.debug, V = F.r.constructor; const out = [];
          const st = () => { const f = F.frame(); const vs = F.v.clone().sub(F.groundVel(F.r, new V())); const s = D.status();
            const nose = new V(0,1,0).applyQuaternion(F.q);
            return { t: +F.t.toFixed(0), alt: Math.round(s.alt), spd: Math.round(vs.length()), orb: Math.round(F.v.length()), M: +(vs.length()/340).toFixed(2), vv: Math.round(vs.dot(f.up)),
              pitch: +(Math.asin(nose.dot(f.up))*57.3).toFixed(1), ap: Math.round(s.ap), pe: Math.round(s.pe), mode: F.engineInfo(), fuel: Math.round(F.mass), thr: F._lastBurn ? Math.round(F._lastBurn.F/1000) : 0, aoa: F.aoa !== undefined ? +F.aoa.toFixed(1) : null, dead: F.destroyed }; };
          D.stage(); D.throttle(1); F.sas = true; F.sasMode = 'stab';
          for (let i = 0; i < 60 && !F.destroyed; i++) { D.simulate(0.5); if (F.v.clone().sub(F.groundVel(F.r, new V())).length() > 80) break; }
          out.push(['rotate', st()]);
          let phase = 'climb', lastLog = 0, rocketT = null;
          for (let k = 0; k < 2400 && !F.destroyed; k++) {
            const s = st();
            if (phase === 'climb') {
              if (s.alt > 300) F.gearDown = false;
              let p = s.alt < 1000 ? 12 : s.alt < 9000 ? 16 : s.alt < 16000 ? 10 : 6;
              if (s.alt > 16000) { p = s.vv > 60 ? 3 : s.vv < 10 ? 9 : 6; }
              D.point(p, 90);
              if (s.mode.includes('ROCKET')) { phase = 'rocket'; rocketT = F.t; out.push(['switch', s]); }
            } else if (phase === 'rocket') {
              D.point(Math.min(24, 8 + (F.t - rocketT) * 0.8), 90);
              if (s.ap > 78000) { D.throttle(0); phase = 'coast'; out.push(['meco', s]); }
            } else if (phase === 'coast') {
              D.sas('pro');
              if (s.alt > 70500) { const t = D.status(); D.warpTo(F.t + Math.max(0, t.tAp - 25)); phase = 'circ'; out.push(['atAp', st()]); }
            } else if (phase === 'circ') {
              D.sas('pro'); D.throttle(1);
              if (s.pe > 72000 || F.mass <= F.prop.mass() && F._lastBurn && F._lastBurn.F === 0 && F.t > 0) { if (s.pe > 72000 || !F._lastBurn || F._lastBurn.F === 0) { D.throttle(0); out.push(['done', st()]); break; } }
            }
            D.simulate(0.5);
            if (F.t - lastLog > 20) { out.push([phase, st()]); lastLog = F.t; }
          }
          out.push(['final', st()]); return out; }""")
        for l in log: print(json.dumps(l))
        print('errors:', errs[:10])
        await b.close()
asyncio.run(main())
