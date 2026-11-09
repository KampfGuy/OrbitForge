# Round-2 screenshots: loading screen, hangar, runway takeoff, decluttered flight UI (iPhone 12 sizes + desktop)
import asyncio, sys, json
from playwright.async_api import async_playwright
URL='http://localhost:8765/'
ENG = sys.argv[1] if len(sys.argv) > 1 else 'chromium'
SIZES = {'iphone-landscape': (844, 390, True), 'iphone-portrait': (390, 844, True), 'desktop': (1440, 900, False)}
want = sys.argv[2:] or list(SIZES)
async def run(p, name):
    W, H, mob = SIZES[name]
    pre = ('safari-' if ENG == 'webkit' else '') + name
    if ENG == 'webkit': b = await p.webkit.launch()
    else: b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
    kw = dict(viewport={'width': W, 'height': H}, device_scale_factor=2 if mob else 1, has_touch=mob)
    if mob and ENG != 'webkit': kw['is_mobile'] = True
    if mob and ENG == 'webkit': kw['is_mobile'] = True
    ctx = await b.new_context(**kw)
    pg = await ctx.new_page()
    errs = []
    pg.on('console', lambda m: errs.append(m.type + ': ' + m.text) if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: errs.append('PAGEERROR: ' + str(e)))
    await pg.goto(URL)
    await pg.wait_for_timeout(1700)
    await pg.screenshot(path=f'screenshots/{pre}-r2-1-loading.png')
    await pg.wait_for_function("window.OF && !document.getElementById('boot')", timeout=30000)
    await pg.evaluate("localStorage.setItem('orbitforge.rotateHint','on')")
    await pg.wait_for_timeout(400)
    await pg.screenshot(path=f'screenshots/{pre}-r2-2-menu.png')
    # hangar with the stock jet
    await pg.evaluate("localStorage.removeItem('orbitforge.current.sph'); OF.toBuilder('sph')")
    await pg.wait_for_timeout(1200)
    await pg.screenshot(path=f'screenshots/{pre}-r2-3-hangar.png')
    await pg.evaluate("OF.builder.setDrawer(true); OF.builder.cat='Wings'; OF.builder.renderTabs(); OF.builder.renderPalette()")
    await pg.wait_for_timeout(500)
    await pg.screenshot(path=f'screenshots/{pre}-r2-4-hangar-drawer.png')
    await pg.evaluate("OF.builder.setDrawer(false); OF.builder.held='wing_rect'; OF.builder.updateMarkers(); OF.builder.statsEl.classList.remove('compact')")
    await pg.wait_for_timeout(400)
    await pg.screenshot(path=f'screenshots/{pre}-r2-5-hangar-attach.png')
    await pg.evaluate("OF.builder.held=null; OF.builder.updateMarkers(); OF.builder.statsEl.classList.add('compact')")
    # spaceplane in hangar
    await pg.evaluate("import('./js/craft.js').then(c => { OF.builder.craft = c.clone(c.PLANE_EXAMPLES[1]); OF.builder.rebuild(true); })")
    await pg.wait_for_timeout(700)
    await pg.screenshot(path=f'screenshots/{pre}-r2-6-hangar-ssto.png')
    # runway
    await pg.evaluate("import('./js/craft.js').then(c => OF.startFlight(c.clone(c.PLANE_EXAMPLES[0])))")
    await pg.wait_for_timeout(1500)
    await pg.screenshot(path=f'screenshots/{pre}-r2-7-runway.png')
    await pg.evaluate("""() => { const D = OF.flight.debug, F = OF.flight; D.stage(); D.throttle(1); F.sas = true; F.sasMode='stab'; D.simulate(5.5); }""")
    await pg.wait_for_timeout(600)
    await pg.screenshot(path=f'screenshots/{pre}-r2-8-takeoff-roll.png')
    await pg.evaluate("""() => { const D = OF.flight.debug, F = OF.flight; D.point(10, 90); D.simulate(5); }""")
    await pg.wait_for_timeout(600)
    await pg.screenshot(path=f'screenshots/{pre}-r2-9-liftoff.png')
    await pg.evaluate("""() => { const D = OF.flight.debug, F = OF.flight; F.gearDown = false; D.point(14, 90); D.simulate(20); F.setHudOpen(true); }""")
    await pg.wait_for_timeout(700)
    await pg.screenshot(path=f'screenshots/{pre}-r2-10-climb.png')
    # rocket flight UI
    await pg.evaluate("import('./js/craft.js').then(c => OF.startFlight(c.clone(c.EXAMPLES[1])))")
    await pg.wait_for_timeout(1200)
    await pg.screenshot(path=f'screenshots/{pre}-r2-11-pad.png')
    await pg.evaluate("""() => { const F = OF.flight; F.sasPop.classList.remove('hidden'); F.setStagesOpen(true); }""")
    await pg.wait_for_timeout(300)
    await pg.screenshot(path=f'screenshots/{pre}-r2-12-sas-stages.png')
    await pg.evaluate("""() => { const F = OF.flight, D = F.debug; F.sasPop.classList.add('hidden'); F.setStagesOpen(false); D.setOrbit('Kampa', 90000, 0.3); F.toggleMap(); D.node(F.t + 600, 300, 0, 0); F.nodePanelHidden = false; }""")
    await pg.wait_for_timeout(900)
    await pg.screenshot(path=f'screenshots/{pre}-r2-13-map-node.png')
    print(name, 'errors:', [e for e in errs if 'art/' not in e][:12])
    await b.close()
async def main():
    async with async_playwright() as p:
        for n in want: await run(p, n)
asyncio.run(main())
