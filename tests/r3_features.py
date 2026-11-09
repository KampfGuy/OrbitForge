# Round-3 feature test: example mods install + load, mod parts/moon/craft/scripts, quicksave/quickload, RCS translation, legs, bay.
import asyncio, sys, json
from playwright.async_api import async_playwright
ENGINE = sys.argv[1] if len(sys.argv) > 1 else 'chromium'
URL = 'http://localhost:8765/'
async def main():
    async with async_playwright() as p:
        b = await (p.webkit.launch() if ENGINE == 'webkit' else p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']))
        ctx = await b.new_context(viewport={'width':844,'height':390}, device_scale_factor=2, is_mobile=True, has_touch=True)
        pg = await ctx.new_page(); errs=[]
        pg.on('pageerror', lambda e: errs.append('PAGEERROR '+str(e)))
        pg.on('console', lambda m: errs.append(m.type+' '+m.text) if m.type in ('error','warning') else None)
        boot = "window.OF && !document.getElementById('boot')"
        await pg.goto(URL); await pg.wait_for_function(boot, timeout=40000)
        await pg.evaluate("localStorage.setItem('orbitforge.rotateHint','off')")
        # install every example mod through the same path the Mods menu uses
        n = await pg.evaluate("""async()=>{const {MODS}=await import('./js/mods.js'); const idx=await (await fetch('mods/index.json')).json(); for(const e of idx){const m=await (await fetch('mods/'+e.file)).json(); await MODS.install(m,'example');} return idx.length}""")
        print('installed', n)
        await pg.reload(); await pg.wait_for_function(boot, timeout=40000)
        info = await pg.evaluate("""async()=>{const {MODS}=await import('./js/mods.js'); const P=await import('./js/parts.js'); const O=await import('./js/orbit.js'); const C=await import('./js/craft.js');
          return {loaded: MODS.loaded, parts: ['x_stubby','x_viper','x_ogive'].map(k=>!!P.PARTS[k]), bodies: O.BODIES.map(b=>b.name), ex: C.EXAMPLES.map(c=>c.name), btnMenu: MODS.buttons('menu').length, btnFlight: MODS.buttons('flight').length, menuBtn: document.querySelector('[data-a=mods]')?.textContent || [...document.querySelectorAll('button')].map(x=>x.textContent).find(t=>t.includes('Mods'))}}""")
        print(json.dumps(info))
        await pg.screenshot(path='/tmp/r3/feat_menu.png')
        await pg.evaluate("async()=>{const {MODS}=await import('./js/mods.js'); MODS.menu(OF)}"); await pg.wait_for_timeout(800)
        await pg.screenshot(path='/tmp/r3/feat_modsdlg.png'); await pg.evaluate("OF.closeDialog()")
        # fly the mod craft for a bit: scripts should run (readout panel, Nova)
        await pg.evaluate("""()=>import('./js/craft.js').then(c=>OF.startFlight(c.clone(c.EXAMPLES.find(x=>x.name==='Viper Two-Stage'))))"""); await pg.wait_for_timeout(1500)
        await pg.evaluate("OF.flight.debug.throttle(1); OF.flight.debug.stage(); OF.flight.debug.sas('stab')")
        await pg.wait_for_timeout(6000)
        st = await pg.evaluate("({s: OF.flight.debug.status(), panels: document.querySelectorAll('.modpanel').length, panelText: [...document.querySelectorAll('.modpanel')].map(d=>d.textContent.slice(0,80))})")
        print('viper flight', json.dumps({k: st['s'][k] for k in ('alt','speed','destroyed')}), st['panels'], st['panelText'])
        await pg.screenshot(path='/tmp/r3/feat_modflight.png')
        # Ember moon: orbit it
        em = await pg.evaluate("OF.flight.debug.throttle(0); OF.flight.debug.setOrbit('Ember', 30000)"); em2 = await pg.evaluate("OF.flight.debug.simulate(20)")
        print('ember orbit', round(em['pe']), '->', round(em2['pe']), em2['body'], em2['destroyed'])
        # quicksave / quickload
        await pg.evaluate("""()=>import('./js/craft.js').then(c=>OF.startFlight(c.clone(c.EXAMPLES.find(x=>x.name==='Lumo Lander'))))"""); await pg.wait_for_timeout(1200)
        s0 = await pg.evaluate("OF.flight.debug.setOrbit('Kampa', 90000); OF.flight.quicksave(); OF.flight.debug.status()")
        await pg.evaluate("OF.flight.debug.simulate(60)")
        await pg.evaluate("OF.flight.quickload()"); await pg.wait_for_timeout(500)
        s1 = await pg.evaluate("OF.flight.debug.status()")
        print('quickload', 'alt', round(s0['alt']), round(s1['alt']), 't', round(s0['t'],1), round(s1['t'],1), 'body', s1['body'])
        # RCS + translation, legs: a small test lander with RCS blocks + legs, in a 90 km orbit
        await pg.evaluate("""()=>import('./js/craft.js').then(c=>OF.startFlight({name:'RCS Test', stack:[{p:'pod1', radial:[{sym:4, ang:0, items:['rcs_quad'], t:0.5}]},{p:'mono_t'},{p:'t200', radial:[{sym:3, ang:0, items:['leg_lt'], t:0.12}]},{p:'e_spark'}]}))"""); await pg.wait_for_timeout(1200)
        await pg.evaluate("OF.flight.debug.setOrbit('Kampa', 90000)")
        r = await pg.evaluate("""()=>{const F=OF.flight; const out={rcs:F.rcsBlocks.length, legs:F.legs.length}; F.toggleRCS(); out.rcsOn=F.rcsOn; const m0=F.monoLeft; const snap=()=>({r:F.r.clone(), v:F.v.clone(), q:F.q.clone(), w:F.w.clone(), t:F.t}); const back=s=>{F.r.copy(s.r); F.v.copy(s.v); F.q.copy(s.q); F.w.copy(s.w); F.t=s.t;};
           const s0=snap(); F.debug.simulate(3); const vA=F.v.clone(); back(s0); F.keys.KeyH=true; F.debug.simulate(3); F.keys.KeyH=false; out.dv=+F.v.clone().sub(vA).length().toFixed(3); out.fire=F._rcsFire; out.mono=[+m0.toFixed(3), +F.monoLeft.toFixed(3)];
           F.toggleGear(); F.debug.simulate(2); out.legsDown=F.legsDown; out.legFrac=+F.legFrac.toFixed(2); return out}""")
        print('rcs/legs', json.dumps(r))
        # shuttle bay
        bay = await pg.evaluate("""()=>import('./js/craft.js').then(c=>{OF.startFlight(c.clone(c.EXAMPLES.find(x=>x.name==='Albatross Shuttle'))); const F=OF.flight; F.toggleBay(); return {bays:F.bays.length, open:F.bayOpen}})""")
        await pg.wait_for_timeout(3000); bay['frac'] = await pg.evaluate("OF.flight.bayFrac"); print('bay', json.dumps(bay))
        await pg.screenshot(path='/tmp/r3/feat_bay.png')
        # settings dialog
        await pg.evaluate("OF.flight.settings()"); await pg.wait_for_timeout(500); await pg.screenshot(path='/tmp/r3/feat_settings.png'); await pg.evaluate("OF.closeDialog()")
        # mods off again: toggling + removal
        rem = await pg.evaluate("""async()=>{const {MODS}=await import('./js/mods.js'); for(const r of [...MODS.records]) await MODS.remove(r.id); return MODS.records.length}""")
        print('removed, left', rem)
        await pg.reload(); await pg.wait_for_function(boot, timeout=40000)
        print('after removal bodies', await pg.evaluate("import('./js/orbit.js').then(o=>o.BODIES.map(b=>b.name))"))
        print('ERRORS', errs[:20])
        await b.close()
asyncio.run(main())
