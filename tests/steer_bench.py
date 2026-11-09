# Steering benchmark: overshoot / settle time for SAS slews and stick pulses (rocket in orbit, rocket on ascent, plane in cruise).
# Uses only hooks that exist in both the old and new code (F.debug.point, F.testInput, F.sas), so it runs before/after.
# usage: python3 tests/steer_bench.py [url] [engine]
import asyncio, sys, json
from playwright.async_api import async_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8765/'
ENG = sys.argv[2] if len(sys.argv) > 2 else 'chromium'
JS = r"""async (scn) => {
  const c = await import('./js/craft.js'); const F = OF.flight, D = F.debug; let V = null; const V3c = () => V || (V = F.r.constructor);
  const nose = () => new (V3c())(0,1,0).applyQuaternion(F.q);
  const dirOf = (p, h) => { const f = F.frame(); p *= Math.PI/180; h *= Math.PI/180; return f.up.clone().multiplyScalar(Math.sin(p)).addScaledVector(f.north, Math.cos(p)*Math.cos(h)).addScaledVector(f.east, Math.cos(p)*Math.sin(h)); };
  const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, a.dot(b)))) * 57.2958;
  const run = (sec, fn) => { const n = Math.round(sec / 0.02); for (let i = 0; i < n && !F.destroyed; i++) { F.advance(0.02); if (fn && i % 5 == 0) fn(F.t); } };
  // slew test: SAS custom target from (p0,h0) to (p1,h1); returns overshoot (deg past target along slew) and settle time (within 1 deg, rate < 0.6 deg/s, for good)
  const slew = (p0, h0, p1, h1, T, pre) => {
    if (!pre) { D.point(p0, h0); run(8); } F.testInput = null;
    const t0 = F.t; const s0 = nose().clone(); D.point(p1, h1);
    let over = 0, settle = 0, crossed = false, maxErr = 0; const tgtAng = ang(s0, dirOf(p1, h1));
    run(T, (t) => { const n = nose(), tg = dirOf(p1, h1); const e = ang(n, tg); const prog = ang(s0, n);
      if (prog >= tgtAng - 0.5 || e < 1) crossed = true;
      if (crossed) over = Math.max(over, prog - tgtAng, 0), maxErr = Math.max(maxErr, e);
      const wdeg = F.w.length() * 57.3;
      if (e > 1 || wdeg > 0.6) settle = t - t0; });
    return { overshoot: +over.toFixed(2), settle: +settle.toFixed(1), finalErr: +ang(nose(), dirOf(p1, h1)).toFixed(2) };
  };
  // pulse test: full stick on axis i for dur s, then release (SAS on/off); measure drift after release and time to stop rotating
  const pulse = (i, val, dur, sas, T) => {
    F.sas = sas; F.sasMode = 'stab'; F.holdQ = null; run(3);
    const u = [0,0,0]; u[i] = val; F.testInput = u; run(dur); F.testInput = null;
    const t0 = F.t, n0 = nose().clone(), q0 = F.q.clone(); let stop = null, maxDrift = 0; const pb0 = scn === 'plane' ? pbNow() : null;
    run(T, (t) => { const d = 2*Math.acos(Math.min(1, Math.abs(q0.clone().invert().multiply(F.q).w)))*57.3; maxDrift = Math.max(maxDrift, d);
      if (F.w.length()*57.3 > 0.6) stop = null; else if (stop === null) stop = t - t0; });
    const dEnd = 2*Math.acos(Math.min(1, Math.abs(q0.clone().invert().multiply(F.q).w)))*57.3;
    const res = { driftMax: +maxDrift.toFixed(1), driftEnd: +dEnd.toFixed(1), stopTime: stop === null ? 'never' : +stop.toFixed(1), wEnd: +(F.w.length()*57.3).toFixed(2) };
    if (pb0) { const p1 = pbNow(); res.bankRel = +pb0.bank.toFixed(1); res.bankEnd = +p1.bank.toFixed(1); res.pitchRel = +pb0.pitch.toFixed(1); res.pitchEnd = +p1.pitch.toFixed(1); }
    return res;
  };
  const pbNow = () => { const f = F.frame(), n = nose(), R = new (V3c())(-1,0,0).applyQuaternion(F.q); return { pitch: Math.asin(n.dot(f.up))*57.3, bank: Math.asin(-R.dot(f.up))*57.3 }; };
  // wait until the craft has stopped rotating (max T s), so a slew starts from rest
  const rest = (T) => { const n = Math.round(T / 0.02); for (let i = 0; i < n && F.w.length()*57.3 > 0.05; i++) F.advance(0.02); };
  const slewRest = (p0, h0, p1, h1, T) => { D.point(p0, h0); run(8); rest(60); return slew(p0, h0, p1, h1, T, true); };
  const out = {};
  if (scn === 'orbit') {
    OF.startFlight(c.clone(c.EXAMPLES[1])); D.setOrbit('Kampa', 100000); F.sas = true;
    out.slew45 = slew(0, 90, 45, 90, 40);
    out.slew90yaw = slew(0, 90, 0, 0, 40);
    out.slew45fromRest = slewRest(0, 90, 45, 90, 40);
    out.slew90yawFromRest = slewRest(0, 90, 0, 0, 40);
    out.pulsePitchSAS = pulse(0, -1, 1.0, true, 20);
    out.pulsePitchNoSAS = pulse(0, -1, 1.0, false, 20);
    out.pulseRollNoSAS = pulse(1, 1, 1.0, false, 20);
  }
  if (scn === 'ascent') {
    OF.startFlight(c.clone(c.EXAMPLES[1])); D.throttle(1); D.stage(); F.sas = true; F.sasMode = 'stab';
    run(14); out.altAtTest = Math.round(F.r.length() - F.body.radius);
    out.slew80 = slew(90, 90, 75, 90, 25);
    out.pulseYawSAS = pulse(2, 1, 0.8, true, 12);
  }
  if (scn === 'plane') {
    OF.startFlight(c.clone(c.PLANE_EXAMPLES[0])); run(2); D.stage(); D.throttle(1); F.sas = true; F.sasMode = 'stab';
    for (let i = 0; i < 40; i++) { run(1); const vs = F.v.clone().sub(F.groundVel(F.r, new (V3c())())).length(); if (vs > 75) break; }
    D.point(10, 90); run(25); F.gearDown = false; D.point(3, 90); run(20);
    out.altAtTest = Math.round(F.r.length() - F.body.radius);
    out.hdg30 = slew(3, 90, 3, 120, 40);
    out.pitch10 = slew(3, 120, 12, 120, 30);
    F.sas = true; D.point(3, 120); run(10);
    out.bankPulseSAS = pulse(1, 1, 1.0, true, 15);
    out.pitchPulseNoSAS = pulse(0, -1, 0.6, false, 10);
    out.destroyed = F.destroyed;
  }
  return out;
}"""
async def main():
    async with async_playwright() as p:
        if ENG == 'webkit': b = await p.webkit.launch()
        else: b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        errs = []
        res = {}
        for scn in ['orbit', 'ascent', 'plane']:
            pg = await b.new_page(viewport={'width':844,'height':390})
            pg.on('pageerror', lambda e: errs.append('PAGEERROR: '+str(e)))
            await pg.goto(URL); await pg.wait_for_function("window.OF && !document.getElementById('boot')", timeout=30000)
            res[scn] = await pg.evaluate(JS, scn)
            print(scn, json.dumps(res[scn]), flush=True)
            await pg.close()
        print('errors:', errs)
        await b.close()
asyncio.run(main())
