// Orbit Forge - craft structure, layout, staging and delta-v
import * as THREE from './vendor/three.module.min.js';
import { PARTS } from './parts.js';
import { G0 } from './orbit.js';
const V3 = THREE.Vector3, TAU = Math.PI * 2;

export function sideItems(gr) { return gr.items.filter(x => x !== 'rdec' && x !== 'fin'); }

export function layout(craft) {
  const inst = []; let y = 0, uid = 0, section = 0;
  craft.stack.forEach((sp, i) => {
    const def = PARTS[sp.p];
    if (def.decoupler === 'stack' && i > 0) section++;
    const top = y;
    inst.push({ uid: uid++, id: sp.p, def, pos: new V3(0, top, 0), ang: 0, kind: 'stack', si: i, section, groupKey: null,
      com: new V3(0, top - def.h / 2, 0), bot: top - def.h, top, ext: def.r });
    (sp.radial || []).forEach((gr, gi) => {
      const sym = gr.sym || 1, isFin = gr.items[0] === 'fin' && gr.t === undefined, hasDec = gr.items[0] === 'rdec';
      const rk = PARTS[gr.items[0]].radial;
      if (!hasDec && !isFin && (rk === 'surf' || rk === 'gear' || rk === 'intake' || rk === 'fin')) {
        const id = gr.items[0], pd = PARTS[id], t = gr.t === undefined ? 0.5 : gr.t;
        const rr = def.rBot !== undefined ? def.r + (def.rBot - def.r) * (1 - t) : def.r;
        const pr = Math.max(0.2, rr) * 0.95;
        const ay = top - def.h + def.h * t;
        const angs = [];
        for (let k = 0; k < sym; k++) angs.push(gr.mirror && sym === 2 ? (k === 0 ? gr.ang : Math.PI - gr.ang) : (gr.ang || 0) + k * TAU / sym);
        angs.forEach((a, k) => {
          const d = new V3(Math.cos(a), 0, Math.sin(a));
          const span = pd.surf ? pd.surf.span : pd.gear ? pd.gear.len : (pd.span || 0.5);
          const chord = pd.h;
          inst.push({ uid: uid++, id, def: pd, kind: 'radial', item: 0, ang: a, si: i, gi, section, groupKey: null, sym: k, rkind: rk,
            pos: d.clone().multiplyScalar(pr).setY(ay), com: d.clone().multiplyScalar(pr + span * 0.4).setY(ay - chord * ({ delta: 0.14, strake: 0.16, tail: 0.1 }[pd.surf && pd.surf.shape] || 0)),
            bot: ay - chord / 2, top: ay + chord / 2, ext: pr + span, dir: d, attachR: pr });
        });
        return;
      }
      const pr = Math.max(def.r, def.rTop || 0) * (def.rTop && def.rTop < def.r ? 0.85 : 1);
      const side = isFin ? [] : sideItems(gr);
      const rs = side.reduce((m, id) => Math.max(m, PARTS[id].r), 0);
      const gkey = hasDec ? i + ':' + gi : null;
      for (let k = 0; k < sym; k++) {
        const a = (gr.ang || 0) + k * TAU / sym, d = new V3(Math.cos(a), 0, Math.sin(a));
        const base = { ang: a, si: i, gi, section, groupKey: gkey, sym: k };
        if (isFin) {
          const fy = top - def.h + 1.0;
          inst.push(Object.assign({ uid: uid++, id: 'fin', def: PARTS.fin, kind: 'radial', item: 0, pos: d.clone().multiplyScalar(pr).setY(fy),
            com: d.clone().multiplyScalar(pr + 0.4).setY(fy - 0.6), bot: fy - 1.0, top: fy, ext: pr + 0.8 }, base));
          continue;
        }
        if (hasDec) {
          const ry = top - Math.min(def.h, 1.6) / 2;
          inst.push(Object.assign({ uid: uid++, id: 'rdec', def: PARTS.rdec, kind: 'radial', item: 0, pos: d.clone().multiplyScalar(pr).setY(ry),
            com: d.clone().multiplyScalar(pr + 0.1).setY(ry), bot: ry - 0.35, top: ry + 0.35, ext: pr + 0.22 }, base));
        }
        const dist = pr + (hasDec ? 0.22 : 0) + rs;
        let yy = top, j0 = hasDec ? 1 : 0;
        for (const id of side) { if (PARTS[id].nose) yy += PARTS[id].h; else break; }
        let last = null;
        gr.items.forEach((id, j) => {
          if (j < j0 || id === 'fin') return;
          const pd = PARTS[id];
          const o = Object.assign({ uid: uid++, id, def: pd, kind: 'side', item: j, pos: d.clone().multiplyScalar(dist).setY(yy),
            com: d.clone().multiplyScalar(dist).setY(yy - pd.h / 2), bot: yy - pd.h, top: yy, ext: dist + pd.r }, base);
          inst.push(o); last = o; yy -= pd.h;
        });
        if (gr.fins && last) {
          const fy = last.bot + 1.0, fr = dist + last.def.r * 0.95;
          inst.push(Object.assign({ uid: uid++, id: 'fin', def: PARTS.fin, kind: 'radial', item: -1, finOnSide: true, pos: d.clone().multiplyScalar(fr).setY(fy),
            com: d.clone().multiplyScalar(fr + 0.4).setY(fy - 0.6), bot: fy - 1.0, top: fy, ext: fr + 0.8 }, base));
        }
      }
    });
    y -= def.h;
  });
  let minY = Infinity; for (const p of inst) minY = Math.min(minY, p.bot);
  if (!isFinite(minY)) minY = 0;
  for (const p of inst) { p.pos.y -= minY; p.com.y -= minY; p.bot -= minY; p.top -= minY; }
  return inst;
}

// staging events (index 0 fires first)
export function buildEvents(inst) {
  const N = inst.reduce((m, p) => Math.max(m, p.section), 0);
  const ev = [];
  const engines = s => inst.filter(p => p.def.engine && p.section === s).map(p => p.uid);
  for (let s = N; s >= 0; s--) {
    if (s === N) { const e = engines(N); if (e.length) ev.push({ ignite: e }); }
    const gks = [...new Set(inst.filter(p => p.section === s && p.groupKey).map(p => p.groupKey))];
    if (gks.length) ev.push({ drop: gks });
    if (s > 0) ev.push({ decStack: s, ignite: engines(s - 1) });
  }
  const ch = inst.filter(p => p.def.chute).map(p => p.uid);
  if (ch.length) ev.push({ chute: ch });
  return ev;
}
export function eventRemoves(inst, e, alive) {
  if (e.decStack !== undefined) return inst.filter(p => p.section >= e.decStack && alive.has(p.uid)).map(p => p.uid);
  if (e.drop) return inst.filter(p => p.groupKey && e.drop.includes(p.groupKey) && alive.has(p.uid)).map(p => p.uid);
  return [];
}
export function eventLabel(inst, e) {
  const by = new Map(inst.map(p => [p.uid, p]));
  const names = list => { const c = {}; for (const u of list) { const n = by.get(u).def.name; c[n] = (c[n] || 0) + 1; } return Object.entries(c).map(([n, k]) => (k > 1 ? k + '× ' : '') + n).join(', '); };
  const parts = [];
  if (e.decStack !== undefined) parts.push('✂ Split stage');
  if (e.drop) parts.push('✂ Drop side boosters');
  if (e.ignite && e.ignite.length) parts.push('🔥 ' + names(e.ignite));
  if (e.chute) parts.push('☂ ' + names(e.chute));
  return parts.join(' · ') || '—';
}

// live propulsion / fuel state shared by stats and flight
export class Propulsion {
  constructor(inst, events) {
    this.inst = inst; this.events = events; this.next = 0;
    this.by = new Map(inst.map(p => [p.uid, p]));
    this.alive = new Set(inst.map(p => p.uid));
    this.fuel = new Map(inst.map(p => [p.uid, p.def.fuel]));
    this.active = new Set(); this.chutes = new Set(); this.spool = new Map(); this.mode = new Map();
    this.intakes = inst.some(p => p.def.intake);
  }
  poolKey(p) { return p.groupKey ? 'g' + p.groupKey : 's' + p.section; }
  mass() { let m = 0; for (const u of this.alive) { const p = this.by.get(u); m += p.def.dry + this.fuel.get(u); } return m * 1000; }
  pools() {
    const pools = {};
    for (const u of this.alive) { const p = this.by.get(u); if (p.def.fuel > 0 && !p.def.srb) { const k = this.poolKey(p); (pools[k] = pools[k] || { fuel: 0, cap: 0, tanks: [] }); pools[k].fuel += this.fuel.get(u); pools[k].cap += p.def.fuel; pools[k].tanks.push(u); } }
    return pools;
  }
  hasFuel(u, pools) { const p = this.by.get(u); if (p.def.srb) return this.fuel.get(u) > 1e-7; const pl = pools[this.poolKey(p)]; return !!pl && pl.fuel > 1e-7; }
  stage() {
    if (this.next >= this.events.length) return null;
    const e = this.events[this.next++];
    const removed = eventRemoves(this.inst, e, this.alive);
    for (const u of removed) { this.alive.delete(u); this.active.delete(u); }
    if (e.ignite) for (const u of e.ignite) if (this.alive.has(u)) this.active.add(u);
    if (e.chute) for (const u of e.chute) if (this.alive.has(u)) this.chutes.add(u);
    return { e, removed };
  }
  // returns {F (N), mdot (kg/s), firing:[uids]} and consumes fuel when dt>0
  // air-breathing engine output: returns {T (N), isp, mode}
  airEngine(d, u, env) {
    const rho = env ? env.rho : 1.225 * 1, M = env ? env.mach : 0, air = env ? env.intake !== false && this.intakeAlive() : true;
    const dens = Math.max(0, rho / 1.225);
    if (d.air === 'jet') {
      const f = Math.max(0, 1 + 0.55 * M - 0.24 * M * M);
      return { T: air ? d.thrust * 1000 * Math.pow(dens, 0.7) * f : 0, isp: d.ispAir, mode: 'air' };
    }
    const f = Math.max(0, 1 + 0.9 * M - 0.13 * M * M);
    const aT = air ? d.airThrust * 1000 * Math.pow(dens, 0.5) * f : 0;
    const forced = this.mode.get(u);
    const useAir = forced ? forced === 'air' : aT > d.airThrust * 1000 * 0.3;
    if (useAir) return { T: aT, isp: d.ispAir, mode: 'air' };
    const p = Math.min(1, dens);
    const isp = d.ispV + (d.ispA - d.ispV) * p;
    return { T: d.thrust * 1000 * isp / d.ispV, isp, mode: 'rocket' };
  }
  intakeAlive() { for (const u of this.alive) if (this.by.get(u).def.intake) return true; return false; }
  burn(throttle, p, dt, env) {
    const pools = this.pools();
    let F = 0, mdot = 0; const firing = [], demand = {};
    this.lastModes = {};
    for (const u of this.active) {
      if (!this.alive.has(u) || !this.hasFuel(u, pools)) continue;
      const x = this.by.get(u), d = x.def;
      let thr = d.srb ? 1 : throttle;
      let md, f1;
      if (d.air) {
        // spool-up lag for air-breathers
        let sp = this.spool.get(u) || 0;
        if (dt > 0) { sp += (thr - sp) * Math.min(1, dt * 0.9); this.spool.set(u, sp); }
        const ae = this.airEngine(d, u, env || { rho: 1.225, mach: 0 });
        this.lastModes[u] = ae.mode;
        const eff = ae.mode === 'air' ? sp : thr;
        f1 = ae.T * eff; md = f1 / (ae.isp * G0);
        if (f1 <= 0) continue;
      } else {
        if (thr <= 0) continue;
        md = d.thrust * 1000 / (d.ispV * G0) * thr;
        const isp = d.ispV + (d.ispA - d.ispV) * p;
        f1 = md * isp * G0;
      }
      F += f1; mdot += md; firing.push(u);
      if (d.srb) { if (dt > 0) this.fuel.set(u, Math.max(0, this.fuel.get(u) - md * dt / 1000)); }
      else { const k = this.poolKey(x); demand[k] = (demand[k] || 0) + md; }
    }
    if (dt > 0) for (const k in demand) {
      const pl = pools[k], take = Math.min(pl.fuel, demand[k] * dt / 1000), f = pl.fuel > 0 ? take / pl.fuel : 0;
      for (const u of pl.tanks) this.fuel.set(u, this.fuel.get(u) * (1 - f));
    }
    return { F, mdot, firing, pools };
  }
  // seconds until the first engine/pool currently burning runs dry (full throttle)
  timeToDepletion(throttle) {
    const pools = this.pools(); let t = Infinity; const demand = {};
    for (const u of this.active) {
      if (!this.alive.has(u) || !this.hasFuel(u, pools)) continue;
      const x = this.by.get(u), d = x.def;
      let md = d.thrust * 1000 / (d.ispV * G0) * (d.srb ? 1 : throttle);
      if (d.air) { const ae = this.airEngine(d, u, this._env || { rho: 1.225, mach: 0 }); md = ae.T * throttle / (ae.isp * G0); }
      if (md <= 0) continue;
      if (d.srb) t = Math.min(t, this.fuel.get(u) * 1000 / md); else { const k = this.poolKey(x); demand[k] = (demand[k] || 0) + md; }
    }
    for (const k in demand) t = Math.min(t, pools[k].fuel * 1000 / demand[k]);
    return t;
  }
}

// per-stage delta-v (vacuum) & TWR (first stage at sea level on home world)
export function stageStats(inst, events, gSurf = 9.81) {
  const run = (pr) => {
    const P = new Propulsion(inst, events), res = [];
    for (let i = 0; i < events.length; i++) {
      P.stage();
      const p = pr(i);
      let dropSet = null;
      for (let j = i + 1; j < events.length; j++) { const rm = eventRemoves(inst, events[j], P.alive); if (rm.length) { dropSet = rm; break; } }
      const m0 = P.mass(); let dv = 0, t = 0, F0 = null;
      for (let it = 0; it < 4000; it++) {
        const pools = P.pools();
        const firing = [...P.active].filter(u => P.alive.has(u) && P.hasFuel(u, pools));
        if (!firing.length) break;
        if (dropSet) { const de = dropSet.filter(u => P.active.has(u)); if (de.length && de.every(u => !P.hasFuel(u, pools))) break; }
        let dt = Math.min(20, P.timeToDepletion(1)); dt = Math.max(dt, 1e-3);
        const m = P.mass();
        const b = P.burn(1, p, dt);
        if (F0 === null) F0 = b.F;
        if (b.mdot <= 0) break;
        dv += b.F / b.mdot * Math.log(m / Math.max(1, m - b.mdot * dt)); t += dt;
      }
      res.push({ dv, t, m0, F0: F0 || 0, twr: (F0 || 0) / (m0 * gSurf) });
    }
    return res;
  };
  const firstPowered = events.findIndex(e => e.ignite && e.ignite.length);
  const vac = run(() => 0);
  const asl = run(i => (i === firstPowered ? 1 : 0));
  return vac.map((s, i) => ({ dvVac: s.dv, dv: asl[i].dv, t: s.t, m0: s.m0, twr: i === firstPowered ? asl[i].twr : s.twr, twrAsl: i === firstPowered }));
}
export function craftMass(inst) { return inst.reduce((m, p) => m + p.def.mass, 0); }

// ---------- examples & storage ----------
export const EXAMPLES = [
  { name: 'Skipper Hop', stack: [{ p: 'chute' }, { p: 'pod1' }, { p: 'dec1' }, { p: 's_bolt', radial: [{ sym: 3, ang: 0, items: ['fin'] }] }] },
  { name: 'Forge-1 Orbiter', stack: [{ p: 'chute' }, { p: 'pod1' }, { p: 'dec1' }, { p: 't400' }, { p: 'e_wisp' }, { p: 'dec1' }, { p: 't400' },
    { p: 't400', radial: [{ sym: 2, ang: 0, items: ['rdec', 'nose1', 's_thunder'], fins: true }] }, { p: 'e_hammer' }] },
  { name: 'Lumo Lander', stack: [{ p: 'chute' }, { p: 'pod1' }, { p: 't200' }, { p: 'e_spark', radial: [] }, { p: 'dec1' }, { p: 't400' }, { p: 'e_wisp' }, { p: 'dec1' },
    { p: 't400' }, { p: 't400', radial: [{ sym: 4, ang: Math.PI / 4, items: ['rdec', 'nose1', 's_thunder'], fins: true }] }, { p: 'e_hammer' }] },
  { name: 'Heavy Barrel', stack: [{ p: 'chute' }, { p: 'pod3' }, { p: 'dec2' }, { p: 'b800' }, { p: 'e_wisp' }, { p: 'dec2' }, { p: 'b3200', radial: [{ sym: 4, ang: Math.PI / 4, items: ['fin'] }] }, { p: 'e_bulwark' }] },
];
const H = Math.PI / 2;
export const PLANE_EXAMPLES = [
  { name: 'Kestrel Jet', kind: 'plane', stack: [
    { p: 'ck_hawk', radial: [{ sym: 1, ang: H, items: ['gear_nose'], t: 0.4 }] },
    { p: 'fz_l', radial: [{ sym: 2, mirror: true, ang: 0, items: ['wing_delta'], t: 0.12 }, { sym: 2, mirror: true, ang: 0, items: ['wing_strake'], t: 0.78 },
      { sym: 2, mirror: true, ang: -0.75, items: ['in_rad'], t: 0.85 }] },
    { p: 'fz_s', radial: [{ sym: 2, mirror: true, ang: H - 0.55, items: ['gear_main'], t: 0.9 }, { sym: 2, mirror: true, ang: 0, items: ['elevon'], t: 0.3 },
      { sym: 1, ang: -H, items: ['rudder'], t: 0.45 }] },
    { p: 'j_gust' }] },
  { name: 'Skylance SSTO', kind: 'plane', stack: [
    { p: 'ck_hawk', radial: [{ sym: 1, ang: H, items: ['gear_nose'], t: 0.4 }] },
    { p: 'fz_l', radial: [{ sym: 2, mirror: true, ang: -0.75, items: ['in_rad'], t: 0.8 }, { sym: 2, mirror: true, ang: 0, items: ['wing_strake'], t: 0.45 }] },
    { p: 'fz_l', radial: [{ sym: 2, mirror: true, ang: 0, items: ['wing_delta'], t: 0.55 }] },
    { p: 'fz_l', radial: [{ sym: 2, mirror: true, ang: 0, items: ['wing_delta'], t: 0.45 }, { sym: 2, mirror: true, ang: H - 0.55, items: ['gear_main'], t: 0.95 },
      { sym: 2, mirror: true, ang: 0, items: ['elevon'], t: 0.08 }, { sym: 1, ang: -H, items: ['rudder'], t: 0.3 }] },
    { p: 'h_twin' }] },
];
// centre of mass / lift / thrust in craft coordinates
export function centers(inst, plane) {
  const com = new V3(), col = new V3(), cot = new V3(); let m = 0, a = 0, f = 0;
  for (const p of inst) {
    const pm = p.def.mass; com.addScaledVector(p.com, pm); m += pm;
    if (p.def.surf) { const n = new V3(-Math.sin(p.ang), 0, Math.cos(p.ang)); const w = p.def.surf.area * (plane ? n.z * n.z : 1); col.addScaledVector(p.com, w); a += w; }
    if (p.def.engine) { const t = p.def.thrust; cot.addScaledVector(new V3(p.pos.x, p.bot, p.pos.z), t); f += t; }
  }
  return { com: m ? com.divideScalar(m) : null, col: a ? col.divideScalar(a) : null, cot: f ? cot.divideScalar(f) : null };
}
const KEY = 'orbitforge.crafts';
export function savedCrafts() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } }
export function saveCraft(c) { const all = savedCrafts(); all[c.name] = c; localStorage.setItem(KEY, JSON.stringify(all)); }
export function deleteCraft(name) { const all = savedCrafts(); delete all[name]; localStorage.setItem(KEY, JSON.stringify(all)); }
export const clone = o => JSON.parse(JSON.stringify(o));

// remaining vacuum delta-v from a live Propulsion state (used in flight HUD)
export function dvRemaining(prop) {
  const P = new Propulsion(prop.inst, prop.events);
  P.next = prop.next; P.alive = new Set(prop.alive); P.fuel = new Map(prop.fuel); P.active = new Set(prop.active);
  const phase = () => {
    let dropSet = null;
    for (let j = P.next; j < P.events.length; j++) { const rm = eventRemoves(P.inst, P.events[j], P.alive); if (rm.length) { dropSet = rm; break; } }
    let dv = 0;
    for (let it = 0; it < 4000; it++) {
      const pools = P.pools();
      const firing = [...P.active].filter(u => P.alive.has(u) && P.hasFuel(u, pools));
      if (!firing.length) break;
      if (dropSet) { const de = dropSet.filter(u => P.active.has(u)); if (de.length && de.every(u => !P.hasFuel(u, pools))) break; }
      const dt = Math.max(1e-3, Math.min(20, P.timeToDepletion(1)));
      const m = P.mass(); const b = P.burn(1, 0, dt);
      if (b.mdot <= 0) break;
      dv += b.F / b.mdot * Math.log(m / Math.max(1, m - b.mdot * dt));
    }
    return dv;
  };
  let total = phase();
  let guard = 0;
  while (P.next < P.events.length && guard++ < 50) { P.stage(); total += phase(); }
  return total;
}
