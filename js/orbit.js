// Orbit Forge - orbital mechanics (patched conics, universal-variable Kepler propagation)
import * as THREE from './vendor/three.module.min.js';
export const G0 = 9.80665;
const V3 = THREE.Vector3;
const TAU = Math.PI * 2;
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export const BODIES = [];
function mkBody(o) {
  o.children = [];
  o.index = BODIES.length;
  BODIES.push(o);
  if (o.parent) {
    o.parent.children.push(o);
    const P = o.parent;
    o.soi = o.orbit.a * Math.pow(o.mu / P.mu, 0.4);
    o.orbit.n = Math.sqrt(P.mu / Math.pow(o.orbit.a, 3));
    o.orbit.period = TAU / o.orbit.n;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(o.orbit.inc, o.orbit.lan, 0, 'YXZ'));
    o.orbit.q = q;
  }
  o.rotRate = TAU / o.rotPeriod;
  o.g = o.mu / (o.radius * o.radius);
  return o;
}
// Home world: 600 km radius, 9.81 m/s^2 surface gravity
export const HOME = mkBody({ name: 'Kampa', radius: 600000, mu: 9.81 * 600000 * 600000, soi: 8.4e7, parent: null,
  rotPeriod: 21000, atm: { height: 70000, scale: 5600, rho0: 1.225 }, kind: 'home', color: 0x3d8f4a });
export const LUMO = mkBody({ name: 'Lumo', radius: 210000, mu: 7.0e10, parent: HOME,
  orbit: { a: 11400000, inc: 0, lan: 0, phase: 2.1 }, rotPeriod: 152000, atm: null, kind: 'lumo', color: 0x9a9a9a });
export const PIP = mkBody({ name: 'Pip', radius: 65000, mu: 2.0e9, parent: HOME,
  orbit: { a: 45000000, inc: 6 * Math.PI / 180, lan: 1.3, phase: 0.9 }, rotPeriod: 41000, atm: null, kind: 'pip', color: 0xa9d8c4 });

// mods: add a moon (or a moon of a moon). Units: metres, seconds, degrees for angles.
export function registerBody(d) {
  const name = String(d.name || '').trim();
  if (!/^[\w \-']{2,24}$/.test(name)) throw new Error('planet needs a short name');
  if (BODIES.some(b => b.name.toLowerCase() === name.toLowerCase())) throw new Error('a world called ' + name + ' already exists');
  const parent = BODIES.find(b => b.name === (d.parent || 'Kampa')); if (!parent) throw new Error('unknown parent ' + d.parent);
  const radius = +d.radius; if (!(radius >= 5000 && radius <= 2e6)) throw new Error('radius must be 5 km - 2000 km (in metres)');
  const mu = d.mu ? +d.mu : (+d.gravity || 1) * radius * radius; if (!(mu > 0)) throw new Error('bad gravity');
  const o = d.orbit || {}, a = +o.a; if (!(a > parent.radius * 3)) throw new Error('orbit.a (metres) must be well outside ' + parent.name);
  if (parent.soi && a > parent.soi * 0.7) throw new Error('orbit.a is outside ' + parent.name + "'s sphere of influence");
  const atm = d.atm ? { height: +d.atm.height || 30000, scale: +d.atm.scale || 4000, rho0: +d.atm.rho0 || 0.5 } : null;
  return mkBody({ name, radius, mu, parent, orbit: { a, inc: (+o.inc || 0) * Math.PI / 180, lan: (+o.lan || 0) * Math.PI / 180, phase: (+o.phase || 0) * Math.PI / 180 },
    rotPeriod: +d.rotPeriod || 40000, atm, kind: 'custom', colors: d.colors || {}, color: d.colors && d.colors.mid ? d.colors.mid : '#999999', mod: d.mod || true, desc: d.desc || '' });
}
// moon state relative to its parent at time t
export function moonState(b, t, outP, outV) {
  const o = b.orbit, th = o.phase + o.n * t, a = o.a;
  outP.set(a * Math.cos(th), 0, -a * Math.sin(th)).applyQuaternion(o.q);
  if (outV) outV.set(-a * o.n * Math.sin(th), 0, -a * o.n * Math.cos(th)).applyQuaternion(o.q);
  return outP;
}
// global (home-centred inertial) position of any body
const _p = new V3();
export function bodyGlobalPos(b, t, out) {
  out.set(0, 0, 0);
  while (b && b.parent) { moonState(b, t, _p); out.add(_p); b = b.parent; }
  return out;
}
export function bodyRotAngle(b, t) { return (b.rotRate * t) % TAU; }
export function atmosphere(b, alt) {
  if (!b.atm || alt >= b.atm.height) return { rho: 0, p: 0 };
  const f = Math.exp(-Math.max(alt, 0) / b.atm.scale);
  // fade smoothly to zero at the top
  const top = 1 - Math.pow(Math.max(alt, 0) / b.atm.height, 6);
  return { rho: b.atm.rho0 * f * top, p: f * top };
}

function stumpC(z) {
  if (z > 1e-6) { const s = Math.sqrt(z); return (1 - Math.cos(s)) / z; }
  if (z < -1e-6) { const s = Math.sqrt(-z); return (Math.cosh(s) - 1) / (-z); }
  return 0.5 - z / 24 + z * z / 720;
}
function stumpS(z) {
  if (z > 1e-6) { const s = Math.sqrt(z); return (s - Math.sin(s)) / (s * s * s); }
  if (z < -1e-6) { const s = Math.sqrt(-z); return (Math.sinh(s) - s) / (s * s * s); }
  return 1 / 6 - z / 120 + z * z / 5040;
}
// propagate state (r0,v0) by dt seconds under central body mu. Writes outR/outV.
export function propagate(r0, v0, dt, mu, outR, outV) {
  const r0m = r0.length();
  const v0m2 = v0.lengthSq();
  const rv = r0.dot(v0);
  const vr0 = rv / r0m;
  const alpha = 2 / r0m - v0m2 / mu;
  if (alpha > 1e-12) { const P = TAU / Math.sqrt(mu * alpha * alpha * alpha); dt = dt % P; }
  const smu = Math.sqrt(mu);
  let x;
  if (alpha > 1e-12) x = smu * alpha * dt;
  else if (alpha < -1e-12) {
    const a = 1 / alpha, sg = Math.sign(dt) || 1;
    x = sg * Math.sqrt(-a) * Math.log((-2 * mu * alpha * dt) / (rv + sg * Math.sqrt(-mu * a) * (1 - r0m * alpha)));
    if (!isFinite(x)) x = smu * dt / r0m;
  } else x = smu * dt / r0m;
  const sig0 = rv / smu;
  for (let i = 0; i < 200; i++) {
    const z = alpha * x * x, C = stumpC(z), S = stumpS(z);
    const F = sig0 * x * x * C + (1 - alpha * r0m) * x * x * x * S + r0m * x - smu * dt;
    const dF = sig0 * x * (1 - z * S) + (1 - alpha * r0m) * x * x * C + r0m;
    const d2F = sig0 * (1 - z * C) + (1 - alpha * r0m) * x * (1 - z * S);
    // Laguerre-Conway iteration (robust for all conics)
    const n = 5;
    const disc = Math.sqrt(Math.abs((n - 1) * (n - 1) * dF * dF - n * (n - 1) * F * d2F));
    const den = dF + (dF >= 0 ? disc : -disc);
    const ratio = n * F / den;
    if (!isFinite(ratio)) break;
    x -= ratio;
    if (Math.abs(ratio) < 1e-11 * (1 + Math.abs(x))) break;
  }
  const z = alpha * x * x, C = stumpC(z), S = stumpS(z);
  const f = 1 - x * x / r0m * C;
  const g = dt - x * x * x / smu * S;
  const rx = f * r0.x + g * v0.x, ry = f * r0.y + g * v0.y, rz = f * r0.z + g * v0.z;
  const rm = Math.sqrt(rx * rx + ry * ry + rz * rz);
  const fd = smu / (rm * r0m) * (alpha * x * x * x * S - x);
  const gd = 1 - x * x / rm * C;
  const vx = fd * r0.x + gd * v0.x, vy = fd * r0.y + gd * v0.y, vz = fd * r0.z + gd * v0.z;
  outR.set(rx, ry, rz);
  if (outV) outV.set(vx, vy, vz);
}

// classical elements & derived readouts
export function elements(r, v, mu) {
  const rm = r.length(), v2 = v.lengthSq();
  const h = new V3().crossVectors(r, v);
  const e = new V3().crossVectors(v, h).divideScalar(mu).sub(r.clone().divideScalar(rm));
  const ecc = e.length();
  const energy = v2 / 2 - mu / rm;
  const a = -mu / (2 * energy);
  const p = h.lengthSq() / mu;
  const rp = p / (1 + ecc);
  const ra = ecc < 1 ? p / (1 - ecc) : Infinity;
  let nu = 0;
  if (ecc > 1e-9) { nu = Math.acos(clamp(e.dot(r) / (ecc * rm), -1, 1)); if (r.dot(v) < 0) nu = -nu; }
  let period = Infinity, tPe = NaN, tAp = NaN;
  if (ecc < 1) {
    period = TAU * Math.sqrt(a * a * a / mu);
    const E = 2 * Math.atan(Math.sqrt((1 - ecc) / (1 + ecc)) * Math.tan(nu / 2));
    let M = E - ecc * Math.sin(E); M = ((M % TAU) + TAU) % TAU;
    const tsp = M / TAU * period;
    tPe = (period - tsp) % period;
    tAp = ((period / 2 - tsp) % period + period) % period;
  } else if (ecc > 1) {
    const F = 2 * Math.atanh(Math.sqrt((ecc - 1) / (ecc + 1)) * Math.tan(nu / 2));
    const M = ecc * Math.sinh(F) - F;
    const n = Math.sqrt(-mu / (a * a * a));
    tPe = -M / n;
  }
  const inc = Math.acos(clamp(h.y / h.length(), -1, 1));
  return { h, e, ecc, a, p, rp, ra, nu, period, tPe, tAp, inc, energy };
}

// ---------- patched conic prediction ----------
const _r = new V3(), _v = new V3(), _mp = new V3(), _mv = new V3();
function sampleAt(r0, v0, mu, tt, outR, outV) { propagate(r0, v0, tt, mu, outR, outV); }

export function predict(body, r0in, v0in, t0, maxPatches = 3, maxSteps = 2200) {
  const patches = [];
  let b = body, r0 = r0in.clone(), v0 = v0in.clone(), tStart = t0, excludeMoon = null;
  for (let pi = 0; pi < maxPatches; pi++) {
    const el = elements(r0, v0, b.mu);
    const closed = el.ecc < 1 && el.ra < (b.soi || Infinity) * 0.999;
    const horizon = closed ? el.period : 2.5e7;
    const pts = [r0.clone()], times = [0];
    let tt = 0, end = closed ? 'closed' : 'limit', next = null, steps = 0;
    let exclArmed = !!excludeMoon;
    const cond = (rr, time) => {
      const rm = rr.length();
      if (rm < b.radius) return 'impact';
      if (b.parent && rm > b.soi) return 'escape';
      for (const m of b.children) {
        if (exclArmed && m === excludeMoon) continue;
        moonState(m, time, _mp);
        if (_mp.distanceTo(rr) < m.soi) return m;
      }
      return null;
    };
    // impact check from start
    if (r0.length() < b.radius) { end = 'impact'; patches.push({ body: b, t0: tStart, t1: tStart, pts, times, end, el, r0, v0 }); break; }
    while (tt < horizon && steps < maxSteps) {
      steps++;
      _r.copy(pts[pts.length - 1]);
      sampleAt(r0, v0, b.mu, tt, _r, _v);
      const rm = _r.length(), vm = _v.length() || 1;
      let dt = clamp(0.035 * rm / vm, 1, closed ? el.period / 90 : 4000);
      // near surface take small steps
      dt = Math.min(dt, Math.max(1, 0.5 * (rm - b.radius) / vm + 1));
      // near a moon take smaller steps
      for (const m of b.children) { moonState(m, tStart + tt, _mp); const d = _mp.distanceTo(_r); if (d < m.soi * 4) dt = Math.min(dt, Math.max(5, 0.08 * d / vm)); }
      let tn = Math.min(tt + dt, horizon);
      sampleAt(r0, v0, b.mu, tn, _r, _v);
      if (exclArmed) { moonState(excludeMoon, tStart + tn, _mp); if (_mp.distanceTo(_r) > excludeMoon.soi * 1.05) exclArmed = false; }
      const c = cond(_r, tStart + tn);
      if (c) {
        // bisection refine
        let lo = tt, hi = tn;
        for (let k = 0; k < 40; k++) {
          const mid = (lo + hi) / 2; sampleAt(r0, v0, b.mu, mid, _r, _v);
          if (cond(_r, tStart + mid)) hi = mid; else lo = mid;
        }
        sampleAt(r0, v0, b.mu, hi, _r, _v);
        tn = hi;
        pts.push(_r.clone()); times.push(tn);
        if (c === 'impact') end = 'impact';
        else if (c === 'escape') { end = 'escape'; next = b.parent; }
        else { end = 'encounter'; next = c; }
        tt = tn;
        break;
      }
      pts.push(_r.clone()); times.push(tn);
      tt = tn;
    }
    const patch = { body: b, t0: tStart, t1: tStart + tt, pts, times, end, el, r0, v0, next };
    patches.push(patch);
    if (!next) break;
    // transform state into next frame
    sampleAt(r0, v0, b.mu, tt, _r, _v);
    const tEv = tStart + tt;
    if (end === 'escape') {
      moonState(b, tEv, _mp, _mv);
      excludeMoon = b;
      r0 = _r.clone().add(_mp); v0 = _v.clone().add(_mv);
    } else {
      moonState(next, tEv, _mp, _mv);
      excludeMoon = null;
      r0 = _r.clone().sub(_mp); v0 = _v.clone().sub(_mv);
    }
    b = next; tStart = tEv;
  }
  return patches;
}

// local horizon frame for position r around body at time t
export function horizonFrame(r) {
  const up = r.clone().normalize();
  let east = new V3(0, 1, 0).cross(up);
  if (east.lengthSq() < 1e-10) east.set(1, 0, 0);
  east.normalize();
  const north = new V3().crossVectors(up, east);
  return { up, east, north };
}
export function fmtDist(m) {
  if (!isFinite(m)) return '—';
  const a = Math.abs(m);
  if (a < 10000) return m.toFixed(0) + ' m';
  if (a < 1e7) return (m / 1000).toFixed(a < 1e5 ? 2 : 1) + ' km';
  return (m / 1e6).toFixed(2) + ' Mm';
}
export function fmtTime(s) {
  if (!isFinite(s)) return '—';
  const neg = s < 0; s = Math.abs(s);
  const d = Math.floor(s / 21000); s -= d * 21000; // a Kampa day is 21000 s (5h50m)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  let out = '';
  if (d) out += d + 'd ';
  if (d || h) out += h + 'h ';
  if (d || h || m) out += m + 'm ';
  out += sec + 's';
  return (neg ? '-' : '') + out;
}
