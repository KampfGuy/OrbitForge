// evaluated in page: scripted ascent to orbit using debug hooks (no human input)
async (opts) => {
  const F = OF.flight, D = F.debug, log = [];
  const st = () => D.status();
  D.throttle(1); if (F.prop.next === 0) D.stage();
  let phase = 'ascent', t0 = performance.now();
  for (let i = 0; i < 4000; i++) {
    const s = st();
    if (s.destroyed) { log.push('DESTROYED at ' + JSON.stringify(s)); break; }
    const alt = s.alt;
    // auto staging: flameout of current stage or burnt-out side boosters
    const b = F.prop.burn(F.throttle, 0, 0);
    const srbDry = [...F.prop.active].some(u => F.prop.alive.has(u) && F.prop.by.get(u).def.srb && F.prop.fuel.get(u) <= 1e-7);
    const nextEv = F.events[F.prop.next];
    if (F.throttle > 0 && nextEv && !nextEv.chute && (b.F === 0 || (srbDry && nextEv.drop))) { D.stage(); log.push(`stage -> ${F.prop.next} at alt ${(alt/1000).toFixed(1)}km`); continue; }
    if (phase === 'ascent') {
      const k = Math.min(1, Math.max(0, (alt - 600) / 32000));
      D.point(90 - 88 * Math.pow(k, 0.45), 90);
      if (i % 40 === 0) { const f = F.frame(); const nose = new F.root.position.constructor(0,1,0).applyQuaternion(F.q); log.push(`t=${s.t.toFixed(0)} alt ${(alt/1000).toFixed(1)} tgtP ${(90 - 88 * Math.pow(k, 0.45)).toFixed(0)} actP ${(Math.asin(Math.min(1,nose.dot(f.up)))*57.3).toFixed(0)} spd ${s.speed.toFixed(0)} ap ${(s.ap/1000).toFixed(1)} q ${(F.q_dyn||0).toFixed(0)}`); }
      const srbOn = [...F.prop.active].some(u => F.prop.alive.has(u) && F.prop.by.get(u).def.srb && F.prop.fuel.get(u) > 1e-7);
      if (s.ap > 80000 && !srbOn) { D.throttle(0); phase = 'coast'; log.push(`MECO alt ${(alt/1000).toFixed(1)}km ap ${(s.ap/1000).toFixed(1)}km t=${s.t.toFixed(0)}`); }
    } else if (phase === 'coast') {
      F.navMode = 'orbit'; F.navFrame = 'orbit'; D.sas('pro');
      if (alt > 70500 && s.tAp < opts.lead) { phase = 'circ'; D.throttle(1); log.push(`circ burn start alt ${(alt/1000).toFixed(1)}km`); }
    } else if (phase === 'circ') {
      D.sas('pro');
      if (i % 20 === 0) log.push(`circ t=${s.t.toFixed(0)} ap ${(s.ap/1000).toFixed(1)} pe ${(s.pe/1000).toFixed(1)} tAp ${s.tAp.toFixed(0)}`);
      if (s.pe > 76000 || (s.ap > 0 && s.pe > s.ap - 3000)) { D.throttle(0); phase = 'orbit'; log.push(`ORBIT ap ${(s.ap/1000).toFixed(1)} pe ${(s.pe/1000).toFixed(1)} t=${s.t.toFixed(0)}`); break; }
      if (s.tAp > 200 && s.tAp < 1000 && s.pe < 0) { /* passed apoapsis, keep burning prograde */ }
    }
    D.simulate(phase === 'coast' ? 1.0 : 0.25);
  }
  const s = st();
  return { log, final: s, wallMs: performance.now() - t0, dvLeft: F._dvCache };
}
