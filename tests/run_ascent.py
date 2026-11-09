import asyncio, json
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        pg = await b.new_page(viewport={'width':844,'height':390})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type=='error' else None)
        await pg.goto('http://localhost:8765/'); await pg.wait_for_timeout(2000)
        await pg.evaluate("import('./js/craft.js').then(c=>OF.startFlight(c.clone(c.EXAMPLES[1])))"); await pg.wait_for_timeout(1000)
        r = await pg.evaluate(open('tests/ascent.js').read(), {'lead':30})
        print('\n'.join(r['log'][-6:]))
        r2 = await pg.evaluate(open('tests/transfer.js').read(), {})
        print('\n'.join(r2['log'])); print('ERR', errs[:10])
        await pg.screenshot(path='screenshots/_orbit.png')
        await b.close()
asyncio.run(main())
