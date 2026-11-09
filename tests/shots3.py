# Round-3 screenshots + layout check (iPhone 12 landscape/portrait, desktop) in Chromium or WebKit.
# Writes to screenshots/r3/ (git-ignored). Reports console errors and any visible button that sits off-screen.
import asyncio, sys, json, os
from playwright.async_api import async_playwright
URL='http://localhost:8765/'
ENG = sys.argv[1] if len(sys.argv) > 1 else 'chromium'
SIZES = {'iphone-landscape': (844, 390, True), 'iphone-portrait': (390, 844, True), 'desktop': (1440, 900, False)}
want = sys.argv[2:] or list(SIZES)
OUT = 'screenshots/r3'; os.makedirs(OUT, exist_ok=True)
CHECK = """() => { const bad = []; const W = innerWidth, H = innerHeight;
  for (const e of document.querySelectorAll('#ui button, #ui .sb, #dialog button, #menu button')) { const r = e.getBoundingClientRect(); if (!r.width || !r.height) continue;
    const st = getComputedStyle(e); if (st.visibility === 'hidden' || st.display === 'none' || +st.opacity === 0) continue;
    let p = e, hid = false; while (p) { if (p.classList && p.classList.contains('hidden')) { hid = true; break; } p = p.parentElement; } if (hid) continue;
    if (e.closest('.scrolly')) continue;
    if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1) bad.push((e.textContent || e.className).trim().slice(0, 20) + ' @' + Math.round(r.left) + ',' + Math.round(r.top)); }
  return bad; }"""
async def run(p, name):
    W, H, mob = SIZES[name]
    pre = ('safari-' if ENG == 'webkit' else 'chrome-') + name
    b = await (p.webkit.launch() if ENG == 'webkit' else p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']))
    kw = dict(viewport={'width': W, 'height': H}, device_scale_factor=2 if mob else 1, has_touch=mob, is_mobile=mob)
    ctx = await b.new_context(**kw); pg = await ctx.new_page(); errs = []; off = {}
    pg.on('console', lambda m: errs.append(m.type + ': ' + m.text) if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: errs.append('PAGEERROR: ' + str(e)))
    async def shot(tag, wait=500):
        await pg.wait_for_timeout(wait); await pg.screenshot(path=f'{OUT}/{pre}-{tag}.png')
        bad = await pg.evaluate(CHECK)
        if bad: off[tag] = bad
    await pg.goto(URL); await pg.wait_for_function("window.OF && !document.getElementById('boot')", timeout=40000)
    await pg.evaluate("localStorage.setItem('orbitforge.rotateHint','off')")
    await shot('01-menu')
    await pg.evaluate("import('./js/mods.js').then(m => m.MODS.menu(OF))"); await shot('02-mods', 900); await pg.evaluate("OF.closeDialog()")
    await pg.evaluate("OF.flight.settings()"); await shot('03-settings'); await pg.evaluate("OF.closeDialog()")
    # shuttle in the Forge
    await pg.evaluate("import('./js/craft.js').then(c => { OF.toBuilder('vab'); OF.builder.craft = c.clone(c.EXAMPLES.find(x => x.name === 'Albatross Shuttle')); OF.builder.rebuild(true); OF.builder.setDrawer(false); })")
    await shot('04-forge-shuttle', 1200)
    await pg.evaluate("OF.builder.moreMenu()"); await shot('05-forge-more'); await pg.evaluate("OF.closeDialog()")
    await pg.evaluate("OF.builder.setDrawer(true); OF.builder.cat = 'Shuttle'; OF.builder.renderTabs(); OF.builder.renderPalette()"); await shot('06-forge-shuttle-parts')
    # shuttle on the pad, popovers
    await pg.evaluate("import('./js/craft.js').then(c => OF.startFlight(c.clone(c.EXAMPLES.find(x => x.name === 'Albatross Shuttle'))))")
    await shot('07-shuttle-pad', 1800)
    await pg.evaluate("OF.flight.togglePop(OF.flight.sasPop)"); await shot('08-sas-autopilot-pop')
    await pg.evaluate("OF.flight.closePops(); OF.flight.togglePop(OF.flight.actPop)"); await shot('09-actions-pop')
    await pg.evaluate("OF.flight.closePops(); OF.flight.debug.ap('ascent'); OF.flight.debug.simulate(60)"); await shot('10-shuttle-ascent-ap', 900)
    await pg.evaluate("OF.flight.debug.simulate(40)"); await shot('11-shuttle-boosters-off', 900)
    # orbiter gliding toward the runway, landing autopilot
    await pg.evaluate("import('./js/craft.js').then(c => { const craft = c.clone(c.EXAMPLES.find(x => x.name.startsWith('Albatross'))); for (const s of craft.stack) s.radial = (s.radial || []).filter(g => !g.items.includes('rdec')); craft.site = 'runway'; OF.startFlight(craft); })"); await pg.wait_for_timeout(1200)
    await pg.evaluate("""() => { const F = OF.flight, D = F.debug; D.place({ D: 9000, h: 900, v: 140 }); D.ap('land'); D.simulate(30); }""")
    await shot('12-glide-land-ap', 900)
    await pg.evaluate("OF.flight.toggleBay()"); await shot('13-bay-open', 2500)
    # plane steering: Kestrel in a held bank
    await pg.evaluate("import('./js/craft.js').then(c => OF.startFlight(c.clone(c.PLANE_EXAMPLES[0])))"); await pg.wait_for_timeout(1200)
    await pg.evaluate("() => { const D = OF.flight.debug; D.stage(); D.throttle(0.8); D.place({ D: 30000, h: 2500, v: 180 }); OF.flight.sas = true; OF.flight.sasMode = 'stab'; D.simulate(3); }")
    await shot('14-plane-flight', 900)
    await pg.evaluate("OF.flight.setMap && OF.flight.setMap(true)"); await shot('15-map', 900)
    await pg.evaluate("OF.flight.setMap && OF.flight.setMap(false)")
    await b.close()
    return {'size': name, 'errors': errs[:10], 'offscreen': off}
async def main():
    async with async_playwright() as p:
        for n in want: print(ENG, json.dumps(await run(p, n)))
asyncio.run(main())
