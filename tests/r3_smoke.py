import asyncio, sys
from playwright.async_api import async_playwright
ENGINE = sys.argv[1] if len(sys.argv) > 1 else 'chromium'
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:8765/'
async def main():
    async with async_playwright() as p:
        if ENGINE == 'webkit': b = await p.webkit.launch()
        else: b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        ctx = await b.new_context(viewport={'width':844,'height':390}, device_scale_factor=2, is_mobile=ENGINE!='firefox', has_touch=True)
        pg = await ctx.new_page(); errs=[]
        pg.on('pageerror', lambda e: errs.append('PAGEERROR '+str(e))); pg.on('console', lambda m: errs.append(m.type+' '+m.text) if m.type in ('error','warning') else None)
        await pg.goto(URL); await pg.wait_for_function("window.OF && !document.getElementById('boot')", timeout=30000)
        await pg.evaluate("localStorage.setItem('orbitforge.rotateHint','off')")
        await pg.screenshot(path='/tmp/r3/menu.png')
        for name in ['Albatross Shuttle','Forge-1 Orbiter']:
            await pg.evaluate("""(n)=>import('./js/craft.js').then(c=>OF.startFlight(c.clone(c.EXAMPLES.find(x=>x.name===n))))""", name)
            await pg.wait_for_timeout(2500)
            await pg.screenshot(path=f'/tmp/r3/fl_{name[:5]}.png')
            await pg.locator('.sb.sas').first.click(); await pg.wait_for_timeout(300)
            await pg.screenshot(path=f'/tmp/r3/sas_{name[:5]}.png')
            await pg.evaluate("OF.flight.closePops()")
            await pg.locator('.sb.act').first.click(); await pg.wait_for_timeout(300)
            await pg.screenshot(path=f'/tmp/r3/act_{name[:5]}.png')
            await pg.evaluate("OF.flight.closePops()")
        print('\n'.join(errs[:30]) or 'no errors')
        await b.close()
asyncio.run(main())
