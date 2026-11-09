async (opts) => {
  const F = OF.flight, D = F.debug, log = [];
  let s = D.status();
  const period = 2 * Math.PI * Math.sqrt(Math.pow((s.ap + s.pe) / 2 + 600000, 3) / (9.81 * 600000 * 600000));
  let best = null;
  outer: for (let pro = 800; pro <= 1100; pro += 20) {
    for (let dt = 60; dt < period + 60; dt += 20) {
      const st = D.node(s.t + dt, pro, 0, 0);
      const enc = st.nodePatches.find(p => p.body === 'Lumo');
      if (enc && enc.pe > 15000) { best = { dt, pro, enc }; break outer; }
    }
  }
  log.push('node search: ' + JSON.stringify(best));
  if (!best) return { log, final: D.status() };
  D.node(s.t + best.dt, best.pro, 0, 0);
  { const n = F.node; const T = F.root.position.constructor; const e = (await import('./js/orbit.js')).elements(n.base.r, n.base.v.clone().add(n.dvWorld), n.base.body.mu);
    log.push('planned post-burn ap ' + ((e.ra - 600000)/1000).toFixed(0) + 'km, |dvWorld| ' + n.dvWorld.length().toFixed(1) + ' base r ' + n.base.r.length().toFixed(0) + ' vessel mass ' + F.mass.toFixed(0)); }
  // execute: warp to ~T-burn/2-30 then burn on node marker
  const B = F.prop.burn(1, 0, 0), ve = B.F / B.mdot, bt = F.mass * (1 - Math.exp(-best.pro / ve)) / B.mdot;
  log.push(`burn time est ${bt.toFixed(1)}s`);
  D.warpTo(F.node.t - bt / 2 - 40);
  D.sas('node'); D.simulate(30);
  while (F.t < F.node.t - bt / 2) D.simulate(0.5);
  D.throttle(1);
  for (let i = 0; i < 4000; i++) {
    const rem = F.nodeRemaining(); const left = rem.dot(F.node.dvWorld) / F.node.dvWorld.length();
    if (left < 1.5) break;
    if (left < 30) D.throttle(Math.max(0.05, left / 30));
    D.simulate(0.1);
  }
  D.throttle(0);
  log.push('applied |dv| ' + F.node.applied.length().toFixed(1) + ' t ' + F.t.toFixed(0) + ' node.t ' + F.node.t.toFixed(0));
  s = D.status();
  log.push('after burn: ' + JSON.stringify({ ap: s.ap, pe: s.pe, rem: s.node.rem, patches: s.patches }));
  // course correction if the finite burn lost the encounter
  if (!F.patches.find(p => p.end === 'encounter')) {
    let corr = null; s = D.status();
    search: for (let dtc = 200; dtc < 3000; dtc += 400) for (let pr = -30; pr <= 30; pr += 1) for (const nm of [0, -5, 5]) {
      const st = D.node(s.t + dtc, pr, nm, 0); const e = st.nodePatches.find(p => p.body === 'Lumo'); if (e && e.pe > 15000) { corr = { dtc, pr, nm, e }; break search; } }
    log.push('correction: ' + JSON.stringify(corr));
    if (corr) {
      D.node(s.t + corr.dtc, corr.pr, corr.nm, 0);
      D.warpTo(F.node.t - 40); D.sas('node'); D.simulate(25);
      while (F.t < F.node.t - 2) D.simulate(0.5);
      D.throttle(0.3);
      for (let i = 0; i < 4000; i++) { const rem = F.nodeRemaining(); const left = rem.dot(F.node.dvWorld) / F.node.dvWorld.length(); if (left < 0.3) break; if (left < 5) D.throttle(0.05); D.simulate(0.05); }
      D.throttle(0);
      log.push('after correction: ' + JSON.stringify(D.status().patches));
    }
  }
  // warp until SOI change
  const enc = F.patches.find(p => p.end === 'encounter');
  if (enc) { D.warpTo(enc.t1 + 60); }
  s = D.status();
  log.push('after warp: body ' + s.body + ' alt ' + (s.alt / 1000).toFixed(0) + 'km pe ' + (s.pe / 1000).toFixed(1) + 'km t=' + s.t.toFixed(0));
  return { log, final: s };
}
