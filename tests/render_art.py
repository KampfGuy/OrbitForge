# Renders the loading-screen artwork from the game itself (original, self-made images).
import asyncio
from playwright.async_api import async_playwright
URL='http://localhost:8765/'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        pg = await b.new_page(viewport={'width':960,'height':540})
        await pg.goto(URL); await pg.wait_for_function("window.OF && !document.getElementById('boot')", timeout=30000)
        await pg.evaluate("OF.setQuality('high'); document.getElementById('ui').style.display='none'; document.querySelectorAll('.rotate').forEach(e=>e.remove())")
        async def shot(n): await pg.evaluate('() => { OF.flight._adv = OF.flight._adv || OF.flight.advance; OF.flight.advance = function(){}; }'); await pg.wait_for_timeout(900); await pg.screenshot(path=f'art/load{n}.jpg', type='jpeg', quality=74); await pg.evaluate('() => { OF.flight.advance = OF.flight._adv; }')
        # 1: liftoff
        await pg.evaluate("""import('./js/craft.js').then(c => { OF.startFlight(c.clone(c.EXAMPLES[1])); const F = OF.flight, D = F.debug; D.throttle(1); D.stage(); F.sas = true; D.simulate(1.1); F.camState.yaw = 2.0; F.camState.pitch = 0.12; F.camState.dist = 42; })""")
        await shot(1)
        # 2: jet on the runway with the hangar
        await pg.evaluate("""import('./js/craft.js').then(c => { OF.startFlight(c.clone(c.PLANE_EXAMPLES[0])); const F = OF.flight; F.camState.yaw = 2.35; F.camState.pitch = 0.12; F.camState.dist = 15; })""")
        await shot(2)
        # 3: spaceplane high and fast
        await pg.evaluate("""import('./js/craft.js').then(c => { OF.startFlight(c.clone(c.PLANE_EXAMPLES[1])); const F = OF.flight, D = F.debug; D.stage(); D.throttle(1); F.sas = true; F.sasMode='stab';
          for (let i = 0; i < 40; i++) { D.simulate(0.5); if (F.v.clone().sub(F.groundVel(F.r, new F.r.constructor())).length() > 80) break; }
          D.point(10, 90); D.simulate(12); F.gearDown = false; D.point(16, 90); D.simulate(80); D.point(9, 90); D.simulate(170); F.camState.yaw = 2.2; F.camState.pitch = 0.25; F.camState.dist = 26; })""")
        await shot(3)
        # 4: in orbit above Kampa
        await pg.evaluate("""import('./js/craft.js').then(c => { const cr = c.clone(c.EXAMPLES[1]); OF.startFlight(cr); const F = OF.flight, D = F.debug; D.stage(); D.stage(); D.stage(); D.setOrbit('Kampa', 85000, 0.25); D.sas('pro'); D.simulate(3); F.camState.yaw = 0.9; F.camState.pitch = 0.35; F.camState.dist = 22; })""")
        await shot(4)
        # 5: map-style view of Kampa with Lumo's orbit
        await pg.evaluate("""() => { const F = OF.flight; F.toggleMap(); F.camState.mapDist = 2.1e6; F.camState.mapPitch = 0.45; F.camState.mapYaw = 1.1; }""")
        await shot(5)
        await b.close()
asyncio.run(main())
