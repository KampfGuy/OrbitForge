import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        pg = await b.new_page(viewport={'width':1440,'height':900})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://localhost:8765/'); await pg.wait_for_timeout(2000)
        await pg.get_by_text('Quick Launch').click(); await pg.wait_for_timeout(1000)
        await pg.keyboard.down('Shift'); await pg.wait_for_timeout(1800); await pg.keyboard.up('Shift')
        th = await pg.evaluate("OF.flight.throttle")
        await pg.keyboard.press('z'); await pg.keyboard.press('Space'); await pg.keyboard.press('t'); await pg.wait_for_timeout(3000)
        s = await pg.evaluate("[OF.flight.debug.status().alt, OF.flight.sas, OF.flight.prop.next]")
        await pg.keyboard.down('d'); await pg.wait_for_timeout(1500); await pg.keyboard.up('d')
        hdg = await pg.evaluate("OF.flight.navTxt.textContent")
        await pg.keyboard.press('m'); await pg.wait_for_timeout(500); mp = await pg.evaluate("OF.flight.map")
        await pg.keyboard.press('m')
        await pg.keyboard.press('Period'); w = await pg.evaluate("OF.flight.warpFactor()")
        print('shift throttle', round(th,2), 'alt/sas/stage', s, 'after D:', hdg, 'map', mp, 'warp after .', w, 'errs', errs)
        await b.close()
asyncio.run(main())
