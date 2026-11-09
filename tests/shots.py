import asyncio, json, sys
from playwright.async_api import async_playwright
VIEWS = {'iphone-portrait': dict(viewport={'width':390,'height':844}, device_scale_factor=3, is_mobile=True, has_touch=True),
         'iphone-landscape': dict(viewport={'width':844,'height':390}, device_scale_factor=3, is_mobile=True, has_touch=True),
         'desktop': dict(viewport={'width':1440,'height':900}, device_scale_factor=1)}
ONLY = sys.argv[1:] or list(VIEWS)
async def run(p, name, kw, errs):
    b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
    pg = await b.new_page(**kw)
    pg.on('pageerror', lambda e: errs.append(name+' PAGEERROR '+str(e)))
    pg.on('console', lambda m: errs.append(name+' '+m.type+' '+m.text) if m.type in ('error','warning') else None)
    await pg.goto('http://localhost:8765/'); await pg.wait_for_timeout(2500)
    shot = lambda n: pg.screenshot(path=f'screenshots/{name}-{n}.png')
    await shot('1-menu')
    await pg.evaluate("OF.toBuilder()"); await pg.wait_for_timeout(1200)
    await pg.evaluate("import('./js/craft.js').then(c=>{OF.builder.craft=c.clone(c.EXAMPLES[2]); OF.builder.rebuild(true);})"); await pg.wait_for_timeout(1200)
    await shot('2-builder')
    await pg.evaluate("import('./js/craft.js').then(c=>OF.startFlight(c.clone(c.EXAMPLES[1])))"); await pg.wait_for_timeout(1500)
    await shot('3-pad')
    await pg.evaluate("(()=>{const D=OF.flight.debug; D.throttle(1); D.stage(); D.point(90,90); D.simulate(7);})()"); await pg.wait_for_timeout(1200)
    await shot('4-launch')
    await pg.evaluate("(()=>{const D=OF.flight.debug; D.simulate(14);})()"); await pg.wait_for_timeout(1200)
    await shot('4b-ascent')
    r = await pg.evaluate(open('tests/ascent.js').read(), {'lead':30})
    await pg.evaluate("OF.flight.camState.pitch=0.35; OF.flight.camState.dist=22"); await pg.wait_for_timeout(1500)
    await shot('5-orbit')
    r2 = await pg.evaluate("""async()=>{const F=OF.flight,D=F.debug; const s=D.status(); let best=null;
       for(let pro=800;pro<=1100&&!best;pro+=20) for(let dt=60;dt<4000;dt+=20){const st=D.node(s.t+dt,pro,0,0); const e=st.nodePatches.find(p=>p.body==='Lumo'); if(e&&e.pe>15000){best={dt,pro};break;}}
       if(best) D.node(s.t+best.dt,best.pro,0,0); F.toggleMap(); F.camState.mapDist=3.0e7; F.camState.mapPitch=1.1; return best;}""")
    await pg.wait_for_timeout(1500)
    await shot('6-map-node')
    await pg.evaluate("OF.flight.toggleMap()"); await pg.wait_for_timeout(500)
    r3 = await pg.evaluate(open('tests/transfer.js').read(), {})
    await pg.evaluate("(()=>{const F=OF.flight; F.toggleMap(); F.camState.mapDist=6e6; F.camState.mapPitch=0.9;})()"); await pg.wait_for_timeout(1500)
    await shot('7-lumo-soi-map')
    perf = await pg.evaluate("(async()=>{const fr=[]; let l=performance.now(); for(let i=0;i<40;i++){await new Promise(r=>requestAnimationFrame(r)); const n=performance.now(); fr.push(n-l); l=n;} const m=performance.memory?{used:performance.memory.usedJSHeapSize/1048576,total:performance.memory.totalJSHeapSize/1048576}:null; const info=OF.renderer.info; return {avgFrameMs: fr.reduce((a,b)=>a+b)/fr.length, cpuMs: OF.cpuMs, pr: OF.pr, heapMB:m, geometries: info.memory.geometries, textures: info.memory.textures, calls: info.render.calls, tris: info.render.triangles}})()")
    print(name, 'ascent:', r['log'][-1], '| node:', r2, '| soi:', r3['log'][-1], '| perf:', json.dumps(perf))
    await b.close()
async def main():
    errs=[]
    async with async_playwright() as p:
        for n in ONLY: await run(p, n, VIEWS[n], errs)
    print('ERRORS:', json.dumps(errs[:20], indent=1))
asyncio.run(main())
