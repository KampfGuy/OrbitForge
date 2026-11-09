import asyncio, json, sys
from playwright.async_api import async_playwright
ENGINE = sys.argv[1] if len(sys.argv) > 1 else 'chromium'
async def marker_xy(pg, idx=None, pick='last'):
    return await pg.evaluate("""(pick)=>{const B=OF.builder; const ms=B.markerGroup.children.filter(m=>m.userData.point!==undefined);
      const out=ms.map(m=>{const v=m.position.clone().project(B.camera); return [(v.x+1)/2*OF.W,(1-v.y)/2*OF.H, m.position.y, Math.hypot(m.position.x,m.position.z)];});
      return out;}""", pick)
async def tap(pg, x, y, touch):
    if touch: await pg.touchscreen.tap(x, y)
    else: await pg.mouse.click(x, y)
async def main():
    async with async_playwright() as p:
        if ENGINE == 'webkit':
            b = await p.webkit.launch()
            kw = dict(viewport={'width':390,'height':844}, device_scale_factor=3, is_mobile=True, has_touch=True)
        else:
            b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
            kw = dict(viewport={'width':390,'height':844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        ctx = await b.new_context(**kw); pg = await ctx.new_page()
        errs=[]; pg.on('pageerror', lambda e: errs.append('PAGEERROR '+str(e))); pg.on('console', lambda m: errs.append(m.type+' '+m.text) if m.type in ('error','warning') else None)
        await pg.goto('http://localhost:8765/'); await pg.wait_for_timeout(2500)
        info = await pg.evaluate("(()=>{const gl=OF.renderer.getContext(); return {webgl2: OF.renderer.capabilities.isWebGL2, renderer: gl.getParameter(gl.RENDERER), ua: navigator.userAgent}})()")
        print('GL', info)
        touch = True
        # Build from scratch: New, then Pod, tank, engine, chute
        await pg.wait_for_function("!document.getElementById('boot')", timeout=20000)
        await pg.evaluate("localStorage.setItem('orbitforge.rotateHint','off'); document.querySelectorAll('.rotate').forEach(e=>e.remove())")
        await pg.locator('.mb', has_text='Forge').first.tap(); await pg.wait_for_timeout(800)
        async def more(item):
            await pg.get_by_title('More').tap(); await pg.wait_for_timeout(300)
            await pg.locator('#dialog .mb', has_text=item).tap(); await pg.wait_for_timeout(400)
        await more('New craft')
        async def opendrawer():
            if await pg.locator('.drawbtn').is_visible(): await pg.locator('.drawbtn').tap(); await pg.wait_for_timeout(350)
        async def add(cat, name, which):
            await opendrawer()
            await pg.locator('.tab', has_text=cat).tap(); await pg.wait_for_timeout(200)
            await pg.locator('.pbtn', has_text=name).first.tap(); await pg.wait_for_timeout(300)
            ms = await marker_xy(pg)
            if not ms: raise Exception('no markers for '+name)
            ms.sort(key=lambda m: m[2])
            m = ms[0] if which == 'bottom' else ms[-1]
            await tap(pg, m[0], m[1], touch); await pg.wait_for_timeout(400)
            n = await pg.evaluate("OF.builder.inst.length"); print('added', name, '-> parts', n)
        await add('Pods', 'Acorn Pod', 'bottom')
        await add('Tanks', 'Cask-400', 'bottom')
        await add('Tanks', 'Cask-200', 'bottom')
        await add('Engines', 'Hammer', 'bottom')
        await add('Utility', 'Canopy Chute', 'top')
        # radial: side splitter + booster (sym 2)
        await opendrawer(); await pg.locator('.tab', has_text='Coupling').tap(); await pg.locator('.pbtn', has_text='Side Splitter').tap(); await pg.wait_for_timeout(400)
        ms = await marker_xy(pg); ms.sort(key=lambda m: m[2]); 
        # choose a marker at mid height of the tank (lowest one is on the engine-less tank)
        mid = [m for m in ms if 0 <= m[0] <= 390 and 120 <= m[1] <= 700]
        await tap(pg, mid[len(mid)//2][0], mid[len(mid)//2][1], touch); await pg.wait_for_timeout(400)
        await opendrawer(); await pg.locator('.tab', has_text='Boosters').tap(); await pg.locator('.pbtn', has_text='Bolt').tap(); await pg.wait_for_timeout(400)
        ms = await marker_xy(pg)
        vis = [m for m in ms if 0 <= m[0] <= 390 and 80 <= m[1] <= 700 and m[3] > 0.8]
        print('booster markers', vis)
        await tap(pg, vis[0][0], vis[0][1], touch); await pg.wait_for_timeout(500)
        st = await pg.evaluate("(()=>{const B=OF.builder; return {parts:B.inst.length, craft:B.craft, stats:document.querySelector('.bstats').innerText}})()")
        print('BUILT', json.dumps(st['craft'])); print(st['stats'].replace('\n',' | '))
        await pg.evaluate("document.querySelector('.bstats').classList.remove('compact')")
        await pg.wait_for_timeout(300)
        await pg.screenshot(path=f'screenshots/{ENGINE}-built-from-scratch.png')
        # select + delete + undo
        await pg.get_by_title('Undo').tap(); await pg.wait_for_timeout(300)
        n1 = await pg.evaluate("OF.builder.inst.length"); print('after undo parts', n1)
        await pg.get_by_title('Undo').tap(); await pg.wait_for_timeout(300)
        # save
        await pg.locator('.bname').fill('Test Rocket'); await more('Save on this device')
        saved = await pg.evaluate("Object.keys(JSON.parse(localStorage.getItem('orbitforge.crafts')||'{}'))"); print('saved', saved)
        # Launch via real UI controls: slider + STAGE button
        await pg.get_by_role('button', name='LAUNCH ▶').tap(); await pg.wait_for_timeout(1200)
        thr = await pg.locator('.throttle').bounding_box()
        await pg.mouse.move(thr['x']+thr['width']/2, thr['y']+thr['height']*0.5); await pg.mouse.down(); await pg.mouse.move(thr['x']+thr['width']/2, thr['y']+2); await pg.mouse.up()
        await pg.locator('.stagebtn').tap(); await pg.wait_for_timeout(2500)
        s = await pg.evaluate("OF.flight.debug.status()"); print('after UI launch: alt %.0f m, speed %.0f, throttle %.2f, landed %s' % (s['alt'], s['speed'], s['throttle'], s['landed']))
        await pg.screenshot(path=f'screenshots/{ENGINE}-ui-launch.png')
        # chute landing test with Skipper Hop
        r = await pg.evaluate("""async()=>{const c=await import('./js/craft.js'); OF.startFlight(c.clone(c.EXAMPLES[0])); const F=OF.flight,D=F.debug; const log=[];
          D.throttle(1); D.stage(); D.point(90,90);
          for(let i=0;i<4000;i++){ const s=D.status(); if(s.destroyed){log.push('destroyed');break;}
            const v=F.v.dot(F.frame().up);
            if(F.prop.next===1 && i>100 && v<0){ D.stage(); log.push('decoupled at '+s.alt.toFixed(0)); }
            if(F.prop.next===2 && s.alt<15000 && v<0){ D.stage(); log.push('chute armed at '+s.alt.toFixed(0)); D.sas('stab'); }
            if(s.landed && i>200){ log.push('LANDED t='+s.t.toFixed(0)); break; }
            D.simulate(0.5); }
          let maxv=0; return {log, st:D.status(), maxAlt:F.stats.maxAlt, recoverVisible: !document.querySelector('.recover').classList.contains('hidden')}}""")
        await pg.wait_for_timeout(600)
        rv = await pg.evaluate("!document.querySelector('.recover').classList.contains('hidden')")
        print('chute test', r['log'], 'maxAlt %.0f'%r['maxAlt'], 'destroyed', r['st']['destroyed'], 'recover button', rv)
        await pg.screenshot(path=f'screenshots/{ENGINE}-landed-chute.png')
        # crash test: drop pod without chute from 3 km
        r = await pg.evaluate("""async()=>{const c=await import('./js/craft.js'); OF.startFlight({name:'Brick',stack:[{p:'pod1'}]}); const F=OF.flight,D=F.debug;
          F.r.setLength(F.r.length()+3000); F.landed=false; F.contact=false; for(let i=0;i<200;i++){D.simulate(0.5); if(F.destroyed) break;} return D.status();}""")
        await pg.wait_for_timeout(2600)
        dlg = await pg.evaluate("document.querySelector('#dialog').innerText")
        print('crash test destroyed', r['destroyed'], 'dialog:', dlg.replace('\n',' | ')[:120])
        await pg.screenshot(path=f'screenshots/{ENGINE}-crash.png')
        # ---- Hangar: build a small jet from scratch with taps, then take off with the on-screen controls ----
        await pg.evaluate("OF.toBuilder('sph')"); await pg.wait_for_timeout(700)
        await more('New craft')
        async def addp(cat, name, choose):
            await opendrawer()
            await pg.locator('.tab', has_text=cat).tap(); await pg.wait_for_timeout(200)
            await pg.locator('.pbtn', has_text=name).first.tap(); await pg.wait_for_timeout(300)
            pts = await pg.evaluate("""()=>{const B=OF.builder; B.rig.updateMatrixWorld(true); return B.markerGroup.children.filter(m=>m.userData.point!==undefined).map(m=>{const w=m.getWorldPosition(new m.position.constructor()); const v=w.clone().project(B.camera); const pt=B.points[m.userData.point]; return {x:(v.x+1)/2*OF.W, y:(1-v.y)/2*OF.H, ly:pt.pos.y, lx:pt.pos.x, lz:pt.pos.z, i:m.userData.point};});}""")
            if not pts: raise Exception('no markers for '+name)
            m = choose(pts)
            await tap(pg, m['x'], m['y'], touch); await pg.wait_for_timeout(400)
            n = await pg.evaluate("OF.builder.inst.length"); print('hangar added', name, '-> parts', n)
        await addp('Cockpits', 'Hawk Cockpit', lambda p: p[0])
        await addp('Fuselage', 'Fuselage Tank L', lambda p: min(p, key=lambda m: m['ly']))
        await addp('Air', 'Gust Turbojet', lambda p: min(p, key=lambda m: m['ly']))
        # wings on the fuselage tank (stack index 1): pick the slot at t=0.15 (lowest y among those on the tank)
        await addp('Wings', 'Delta Wing', lambda p: sorted([m for m in p if 2.0 < m['ly'] < 6.0], key=lambda m: m['ly'])[0])
        await addp('Control', 'Rudder Tail', lambda p: sorted([m for m in p if m['lz'] < -0.3], key=lambda m: m['ly'])[0])
        await addp('Air', 'Side Intake', lambda p: sorted(p, key=lambda m: -m['ly'])[1])
        await addp('Control', 'Elevon', lambda p: sorted([m for m in p if abs(m['lz']) < 0.3], key=lambda m: m['ly'])[0])
        await addp('Gear', 'Nose Gear', lambda p: sorted([m for m in p if abs(m['lx']) < 0.05 and m['lz'] > 0.3], key=lambda m: -m['ly'])[0])
        await addp('Gear', 'Main Gear', lambda p: sorted([m for m in p if abs(m['lx']) > 0.1 and m['lz'] > 0.3 and 2.0 < m['ly'] < 6.5], key=lambda m: m['ly'])[0])
        hs = await pg.evaluate("(()=>{const B=OF.builder; return {craft:B.craft, stats:B.statsEl.innerText, c:B._centers}})()")
        print('HANGAR BUILT', json.dumps(hs['craft'])); print(hs['stats'].replace('\n',' | ')); print('centers', json.dumps(hs['c']))
        await pg.evaluate("document.querySelector('.bstats').classList.remove('compact')"); await pg.wait_for_timeout(300)
        await pg.screenshot(path=f'screenshots/{ENGINE}-hangar-built-from-scratch.png')
        await pg.get_by_role('button', name='LAUNCH ▶').tap(); await pg.wait_for_timeout(1200)
        await pg.locator('.stagebtn').tap(); await pg.wait_for_timeout(200)
        await pg.locator('.thbtns .sb', has_text='MAX').tap(); await pg.wait_for_timeout(200)
        await pg.locator('.sb.sas').tap(); await pg.wait_for_timeout(100)
        t0 = await pg.evaluate("OF.flight.debug.simulate(14)")
        jb = await pg.locator('.joy').bounding_box()
        cx, cy = jb['x']+jb['width']/2, jb['y']+jb['height']/2
        # hold the stick back (pull down) using a real pointer drag while the game runs
        await pg.mouse.move(cx, cy); await pg.mouse.down(); await pg.mouse.move(cx, cy + jb['height']*0.28, steps=4)
        r1 = await pg.evaluate("(()=>{const F=OF.flight; F.debug.simulate(6); return {joy:F.joyV, st:F.debug.status(), contact:F.contact}})()")
        await pg.mouse.up()
        r2 = await pg.evaluate("(()=>{const F=OF.flight; F.debug.simulate(8); const s=F.debug.status(); return {alt:s.alt, contact:F.contact, destroyed:s.destroyed}})()")
        print('hangar jet: after roll', 'speed %.0f' % t0['speed'], '| stick back', r1['joy'], 'alt %.1f contact %s' % (r1['st']['alt'], r1['contact']), '| 8 s later', r2)
        await pg.screenshot(path=f'screenshots/{ENGINE}-hangar-jet-flying.png')
        print('ERRORS', errs[:15])
        await b.close()
asyncio.run(main())
