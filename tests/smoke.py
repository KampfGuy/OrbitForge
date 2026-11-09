import asyncio, sys, json
from playwright.async_api import async_playwright
URL='http://localhost:8765/'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        pg = await b.new_page(viewport={'width':390,'height':844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        errs=[]
        pg.on('console', lambda m: errs.append(m.type+': '+m.text) if m.type in ('error','warning') else None)
        pg.on('pageerror', lambda e: errs.append('PAGEERROR: '+str(e)))
        await pg.goto(URL); await pg.wait_for_timeout(3000)
        await pg.screenshot(path='screenshots/_menu.png')
        await pg.evaluate("OF.toBuilder()"); await pg.wait_for_timeout(1500)
        await pg.screenshot(path='screenshots/_builder.png')
        await pg.evaluate("OF.startFlight(OF.builder.craft)"); await pg.wait_for_timeout(2500)
        await pg.screenshot(path='screenshots/_pad.png')
        print('\n'.join(errs[:30]))
        await b.close()
asyncio.run(main())
