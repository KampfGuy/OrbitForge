// Orbit Forge - original procedural part catalogue
import * as THREE from './vendor/three.module.min.js';
const R1 = 0.625, R2 = 1.25;
// mass/dry/fuel in tonnes, thrust in kN, torque in kN*m
export const PARTS = {
  pod1:   { name: 'Acorn Pod', cat: 'Pods', h: 1.0, r: R1, rTop: 0.32, mass: 0.82, torque: 12, crew: 1, desc: '1-seat capsule with reaction wheel' },
  pod3:   { name: 'Trio Pod', cat: 'Pods', h: 1.7, r: R2, rTop: 0.55, mass: 2.5, torque: 18, crew: 3, desc: '3-seat capsule' },
  probe:  { name: 'Drone Core', cat: 'Pods', h: 0.5, r: R1, mass: 0.12, torque: 4, crew: 0, desc: 'Uncrewed control core' },
  chute:  { name: 'Canopy Chute', cat: 'Utility', h: 0.32, r: 0.3, mass: 0.1, chute: true, desc: 'Top-mount parachute. Stage to arm.' },
  nose1:  { name: 'Nose Cone', cat: 'Aero', h: 1.1, r: R1, mass: 0.03, nose: true, desc: 'Cuts drag on stack tops and boosters' },
  fin:    { name: 'Booster Fin', cat: 'Aero', h: 1.0, r: 0, mass: 0.04, radial: 'fin', surf: { area: 0.6, span: 0.8, chord: 1.0 }, desc: 'Aerodynamic stability (radial)' },
  t100:   { name: 'Cask-100 Tank', cat: 'Tanks', h: 0.95, r: R1, mass: 0.56, dry: 0.065, desc: 'Small 1.25 m tank' },
  t200:   { name: 'Cask-200 Tank', cat: 'Tanks', h: 1.9, r: R1, mass: 1.12, dry: 0.13, desc: 'Medium 1.25 m tank' },
  t400:   { name: 'Cask-400 Tank', cat: 'Tanks', h: 3.75, r: R1, mass: 2.25, dry: 0.26, desc: 'Long 1.25 m tank' },
  b800:   { name: 'Barrel-800 Tank', cat: 'Tanks', h: 1.9, r: R2, mass: 4.5, dry: 0.5, desc: '2.5 m tank' },
  b1600:  { name: 'Barrel-1600 Tank', cat: 'Tanks', h: 3.75, r: R2, mass: 9.0, dry: 1.0, desc: 'Long 2.5 m tank' },
  b3200:  { name: 'Barrel-3200 Tank', cat: 'Tanks', h: 7.5, r: R2, mass: 18, dry: 2.0, desc: 'Huge 2.5 m tank' },
  adapt:  { name: 'Taper Adapter', cat: 'Coupling', h: 1.2, r: R2, rTop: R1, mass: 0.12, desc: '2.5 m to 1.25 m adapter' },
  e_spark:{ name: 'Spark Engine', cat: 'Engines', h: 0.55, r: 0.35, mass: 0.13, thrust: 22, ispV: 315, ispA: 90, gimbal: 3, desc: 'Tiny lander engine' },
  e_wisp: { name: 'Wisp Vacuum Engine', cat: 'Engines', h: 1.1, r: R1, mass: 0.5, thrust: 62, ispV: 345, ispA: 90, gimbal: 4, desc: 'Efficient upper stage' },
  e_hammer:{ name: 'Hammer Lifter', cat: 'Engines', h: 1.5, r: R1, mass: 1.45, thrust: 220, ispV: 312, ispA: 262, gimbal: 3, desc: 'Strong 1.25 m first-stage engine' },
  e_bulwark:{ name: 'Bulwark Main Engine', cat: 'Engines', h: 2.3, r: R2, mass: 4.0, thrust: 1050, ispV: 318, ispA: 285, gimbal: 2, desc: 'Big 2.5 m lifter' },
  s_bolt: { name: 'Bolt Solid Booster', cat: 'Boosters', h: 1.8, r: 0.5, mass: 1.5, dry: 0.45, thrust: 190, ispV: 165, ispA: 142, srb: true, desc: 'Short punchy SRB (can\'t throttle)' },
  s_thunder:{ name: 'Thunder Solid Booster', cat: 'Boosters', h: 4.6, r: R1, mass: 7.6, dry: 1.5, thrust: 300, ispV: 212, ispA: 178, srb: true, desc: 'Big SRB, ~40 s burn' },
  dec1:   { name: 'Stack Splitter 1.25', cat: 'Coupling', h: 0.3, r: R1, mass: 0.05, decoupler: 'stack', desc: 'Separates stages' },
  dec2:   { name: 'Stack Splitter 2.5', cat: 'Coupling', h: 0.4, r: R2, mass: 0.35, decoupler: 'stack', desc: 'Separates 2.5 m stages' },
  rdec:   { name: 'Side Splitter', cat: 'Coupling', h: 0.7, r: 0, mass: 0.05, decoupler: 'radial', radial: 'rdec', desc: 'Radial decoupler for boosters' },
  // ---------- aircraft parts (built horizontally in the Hangar) ----------
  ck_hawk: { name: 'Hawk Cockpit', cat: 'Cockpits', plane: 1, h: 2.4, r: R1, mass: 1.0, torque: 8, crew: 1, nose: true, desc: 'Pointy 1-seat nose cockpit' },
  ck_heron:{ name: 'Heron Cockpit', cat: 'Cockpits', plane: 1, h: 1.7, r: R1, mass: 0.8, torque: 6, crew: 1, desc: 'Inline cockpit with canopy' },
  fz_s:    { name: 'Fuselage Tank S', cat: 'Fuselage', plane: 1, h: 1.9, r: R1, mass: 1.0, dry: 0.12, desc: 'Short fuselage fuel tank' },
  fz_l:    { name: 'Fuselage Tank L', cat: 'Fuselage', plane: 1, h: 3.75, r: R1, mass: 2.0, dry: 0.24, desc: 'Long fuselage fuel tank' },
  fz_tail: { name: 'Tail Cone', cat: 'Fuselage', plane: 1, h: 1.4, r: R1, rBot: 0.25, mass: 0.1, desc: 'Tapered tail end' },
  in_cone: { name: 'Shock Cone Intake', cat: 'Air', plane: 1, h: 1.1, r: R1, mass: 0.12, intake: true, nose: true, desc: 'Nose intake feeding jets' },
  in_rad:  { name: 'Side Intake', cat: 'Air', plane: 1, h: 1.3, r: 0, mass: 0.06, intake: true, radial: 'intake', surf: null, span: 0.45, desc: 'Radial air scoop' },
  j_gust:  { name: 'Gust Turbojet', cat: 'Air', plane: 1, h: 2.0, r: R1, mass: 1.2, thrust: 105, air: 'jet', ispAir: 4000, ispV: 4000, ispA: 4000, gimbal: 1, desc: 'Air-breathing jet. Needs an intake and air; best around Mach 1-2' },
  h_twin:  { name: 'Twinmode Hybrid Engine', cat: 'Air', plane: 1, h: 2.3, r: R1, mass: 1.75, thrust: 185, ispV: 322, ispA: 275, air: 'hybrid', airThrust: 115, ispAir: 3200, gimbal: 2, desc: 'Breathes air up to ~Mach 4, then switches to rocket mode' },
  wing_delta: { name: 'Delta Wing', cat: 'Wings', plane: 1, h: 3.0, r: 0, mass: 0.32, radial: 'surf', surf: { area: 5.5, span: 3.2, chord: 3.0, shape: 'delta' }, desc: 'Main lifting wing' },
  wing_rect:  { name: 'Straight Wing', cat: 'Wings', plane: 1, h: 1.5, r: 0, mass: 0.25, radial: 'surf', surf: { area: 4.2, span: 3.0, chord: 1.5, shape: 'rect' }, desc: 'Efficient subsonic wing' },
  wing_strake:{ name: 'Wing Strake', cat: 'Wings', plane: 1, h: 2.6, r: 0, mass: 0.1, radial: 'surf', surf: { area: 1.5, span: 1.0, chord: 2.6, shape: 'strake' }, desc: 'Extra lift close to the body' },
  tailfin:    { name: 'Tail Fin', cat: 'Wings', plane: 1, h: 1.5, r: 0, mass: 0.08, radial: 'surf', surf: { area: 1.5, span: 1.5, chord: 1.5, shape: 'tail' }, desc: 'Vertical/horizontal stabiliser' },
  elevon:     { name: 'Elevon', cat: 'Control', plane: 1, h: 0.8, r: 0, mass: 0.05, radial: 'surf', surf: { area: 1.1, span: 1.5, chord: 0.8, shape: 'rect', ctrl: 20 }, desc: 'Pitch + roll control surface' },
  rudder:     { name: 'Rudder Tail', cat: 'Control', plane: 1, h: 1.6, r: 0, mass: 0.12, radial: 'surf', surf: { area: 2.0, span: 1.8, chord: 1.6, shape: 'tail', ctrl: 15 }, desc: 'All-moving vertical tail (yaw)' },
  gear_main:  { name: 'Main Gear', cat: 'Gear', plane: 1, h: 0.8, r: 0, mass: 0.15, radial: 'gear', gear: { len: 1.2, steer: 0, brake: true }, desc: 'Retractable wheel with brakes (G / B)' },
  gear_nose:  { name: 'Nose Gear', cat: 'Gear', plane: 1, h: 0.7, r: 0, mass: 0.1, radial: 'gear', gear: { len: 1.2, steer: 22, brake: false }, desc: 'Steerable retractable wheel' },
};
for (const [id, p] of Object.entries(PARTS)) {
  p.id = id;
  if (p.dry !== undefined) p.fuel = p.mass - p.dry; else { p.dry = p.mass; p.fuel = 0; }
  p.engine = !!p.thrust;
}
export const CATS = ['Pods', 'Tanks', 'Engines', 'Boosters', 'Coupling', 'Aero', 'Utility'];
export const PLANE_CATS = ['Cockpits', 'Fuselage', 'Wings', 'Control', 'Gear', 'Air', 'Engines', 'Tanks', 'Coupling', 'Utility'];
export const isSurf = id => PARTS[id].radial === 'surf' || PARTS[id].radial === 'fin';

// ---------- procedural meshes (origin at top centre, extends to y=-h) ----------
const M = {};
function mat(name, color, opts = {}) {
  if (!M[name]) M[name] = new THREE.MeshLambertMaterial(Object.assign({ color }, opts));
  return M[name];
}
const geoCache = {};
function geo(key, fn) { return geoCache[key] || (geoCache[key] = fn()); }
const SEG = 20;
function cyl(rt, rb, h, seg = SEG) { return geo('cyl' + rt + '_' + rb + '_' + h + '_' + seg, () => new THREE.CylinderGeometry(rt, rb, h, seg)); }
function add(g, geom, m, y, x = 0, z = 0) { const me = new THREE.Mesh(geom, m); me.position.set(x, y, z); g.add(me); return me; }

export function makePartMesh(id) {
  const p = PARTS[id], g = new THREE.Group();
  const white = mat('white', 0xe9e6df), dark = mat('dark', 0x2b2d33), orange = mat('orange', 0xe07b2a),
    gold = mat('gold', 0xc9a43a), red = mat('red', 0xc8372d), metal = mat('metal', 0x8a9099), yellow = mat('yellow', 0xe8c33a),
    glass = mat('glass', 0x6fb7ff, { emissive: 0x10304a }), teal = mat('teal', 0x2aa198);
  switch (id) {
    case 'pod1': case 'pod3': {
      add(g, cyl(p.rTop, p.r, p.h * 0.92), white, -p.h * 0.46);
      add(g, cyl(p.r * 1.0, p.r * 1.02, p.h * 0.08), dark, -p.h * 0.96);
      add(g, cyl(p.rTop * 0.8, p.rTop, 0.06), metal, 0);
      const w = add(g, geo('win' + id, () => new THREE.BoxGeometry(p.r * 0.45, p.h * 0.22, 0.05)), glass, -p.h * 0.42, 0, 0);
      w.position.z = (p.r + p.rTop) / 2 + 0.02; w.rotation.x = -Math.atan((p.r - p.rTop) / p.h);
      break;
    }
    case 'probe': {
      add(g, cyl(p.r, p.r, p.h, 8), dark, -p.h / 2);
      add(g, geo('probeTop', () => new THREE.SphereGeometry(0.3, 12, 8)), gold, -0.05);
      break;
    }
    case 'chute': {
      add(g, cyl(0.22, p.r, p.h * 0.8), red, -p.h * 0.4);
      add(g, cyl(p.r, p.r, p.h * 0.2), metal, -p.h * 0.9);
      break;
    }
    case 'nose1': {
      add(g, geo('nose', () => {
        const pts = []; for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push(new THREE.Vector2(R1 * Math.sqrt(1 - t * t) , -p.h + p.h * t)); }
        return new THREE.LatheGeometry(pts, SEG);
      }), white, 0);
      break;
    }
    case 'fin': {
      const fg = geo('fin', () => { const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(0.8, -0.75); s.lineTo(0.8, -1.0); s.lineTo(0, -1.0); s.lineTo(0, 0);
        const e = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: false }); e.translate(0, 0, -0.025); return e; });
      add(g, fg, red, 0);
      break;
    }
    case 't100': case 't200': case 't400': case 'b800': case 'b1600': case 'b3200': {
      add(g, cyl(p.r, p.r, p.h), white, -p.h / 2);
      const bands = Math.max(1, Math.round(p.h / 1.9));
      for (let i = 0; i < bands; i++) add(g, cyl(p.r * 1.01, p.r * 1.01, 0.12), orange, -p.h * (i + 0.5) / bands);
      add(g, cyl(p.r * 1.005, p.r * 1.005, 0.06), metal, -0.03); add(g, cyl(p.r * 1.005, p.r * 1.005, 0.06), metal, -p.h + 0.03);
      break;
    }
    case 'adapt': add(g, cyl(p.rTop, p.r, p.h), metal, -p.h / 2); add(g, cyl(p.r * 1.01, p.r * 1.01, 0.1), orange, -p.h + 0.05); break;
    case 'dec1': case 'dec2': add(g, cyl(p.r, p.r, p.h * 0.5), yellow, -p.h * 0.25); add(g, cyl(p.r * 0.98, p.r * 0.98, p.h * 0.5), dark, -p.h * 0.75); break;
    case 'rdec': add(g, geo('rdec', () => new THREE.BoxGeometry(0.22, p.h, 0.32)), yellow, -0, 0.11); break;
    case 'e_spark': case 'e_wisp': case 'e_hammer': case 'e_bulwark': {
      const mountH = p.h * 0.32;
      add(g, cyl(p.r * 0.95, p.r * 0.7, mountH), dark, -mountH / 2);
      const bellR = id === 'e_wisp' ? p.r * 0.95 : p.r * 0.75;
      add(g, geo('bell' + id, () => {
        const pts = [], bh = p.h - mountH;
        for (let i = 10; i >= 0; i--) { const t = i / 10; pts.push(new THREE.Vector2(bellR * (0.25 + 0.75 * Math.pow(t, 1.6)), -t * bh)); }
        const lg = new THREE.LatheGeometry(pts, SEG); return lg;
      }), id === 'e_hammer' || id === 'e_bulwark' ? metal : gold, -mountH);
      if (id === 'e_hammer' || id === 'e_bulwark') add(g, cyl(p.r * 0.3, p.r * 0.3, 0.3, 8), teal, -mountH * 0.5, p.r * 0.75, 0);
      break;
    }
    case 'ck_hawk': {
      add(g, geo('hawk', () => { const pts = []; for (let i = 0; i <= 14; i++) { const t = i / 14; pts.push(new THREE.Vector2(R1 * Math.pow(Math.sin(Math.min(1, (1 - t) * 1.25) * Math.PI / 2), 0.8) + 0.001, -p.h + p.h * t)); } return new THREE.LatheGeometry(pts, SEG); }), white, 0);
      const cn = add(g, geo('canopy1', () => new THREE.SphereGeometry(0.42, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2)), glass, -p.h * 0.62, 0, 0);
      cn.scale.set(0.9, 1.9, 0.9); cn.rotation.x = Math.PI / 2; cn.position.z = -R1 * 0.72; cn.scale.set(0.9, 0.9, 1.6); cn.rotation.set(-Math.PI / 2, 0, 0);
      break;
    }
    case 'ck_heron': {
      add(g, cyl(R1, R1, p.h), white, -p.h / 2);
      const cn = add(g, geo('canopy2', () => new THREE.SphereGeometry(0.45, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2)), glass, -p.h * 0.5, 0, -R1 * 0.75); cn.rotation.x = -Math.PI / 2; cn.scale.set(0.9, 1.5, 0.9);
      break;
    }
    case 'fz_s': case 'fz_l': add(g, cyl(p.r, p.r, p.h), mat('fuse', 0xd7dbe2), -p.h / 2); add(g, cyl(p.r * 1.01, p.r * 1.01, 0.1), dark, -0.05); add(g, cyl(p.r * 1.01, p.r * 1.01, 0.1), dark, -p.h + 0.05); break;
    case 'fz_tail': add(g, cyl(p.r, p.rBot, p.h), mat('fuse', 0xd7dbe2), -p.h / 2); break;
    case 'in_cone': {
      add(g, cyl(0.12, p.r * 0.95, p.h * 0.85), metal, -p.h * 0.425 - 0.0);
      add(g, cyl(p.r, p.r, p.h * 0.15), dark, -p.h * 0.925);
      add(g, geo('spike', () => new THREE.ConeGeometry(0.2, 0.5, 10)), dark, 0.2);
      break;
    }
    case 'in_rad': { const b = add(g, geo('inrad', () => { const bx = new THREE.BoxGeometry(0.45, p.h, 0.5); return bx; }), metal, 0, 0.22); add(g, geo('inradm', () => new THREE.BoxGeometry(0.38, 0.05, 0.42)), dark, p.h / 2, 0.22); break; }
    case 'j_gust': case 'h_twin': {
      const body = p.h * 0.6;
      add(g, cyl(p.r, p.r * 0.85, body), mat('fuse', 0xd7dbe2), -body / 2);
      add(g, cyl(p.r * 0.86, p.r * 0.86, 0.12), id === 'h_twin' ? teal : orange, -body + 0.06);
      add(g, geo('noz' + id, () => { const pts = [], bh = p.h - body; for (let i = 10; i >= 0; i--) { const t = i / 10; pts.push(new THREE.Vector2(p.r * (0.82 - 0.25 * Math.sin(t * Math.PI) * (id === 'h_twin' ? 0.6 : 1)), -t * bh)); } return new THREE.LatheGeometry(pts, SEG); }), dark, -body);
      break;
    }
    case 'wing_delta': case 'wing_rect': case 'wing_strake': case 'tailfin': case 'elevon': case 'rudder': {
      const sf = p.surf, c = sf.chord, sp = sf.span;
      const gm = geo('surf' + id, () => {
        const sh = new THREE.Shape();
        if (sf.shape === 'delta') { sh.moveTo(0, c / 2); sh.lineTo(sp, -c / 2 + 0.35); sh.lineTo(sp, -c / 2); sh.lineTo(0, -c / 2); }
        else if (sf.shape === 'strake') { sh.moveTo(0, c / 2); sh.lineTo(sp, -c / 2 + 0.2); sh.lineTo(sp * 0.9, -c / 2); sh.lineTo(0, -c / 2); }
        else if (sf.shape === 'tail') { sh.moveTo(0, c / 2); sh.lineTo(sp, -c / 2 + c * 0.35); sh.lineTo(sp, -c / 2 - c * 0.05); sh.lineTo(0, -c / 2); }
        else { sh.moveTo(0, c / 2); sh.lineTo(sp, c / 2 - 0.1); sh.lineTo(sp, -c / 2); sh.lineTo(0, -c / 2); }
        sh.closePath();
        const e = new THREE.ExtrudeGeometry(sh, { depth: 0.1, bevelEnabled: false }); e.translate(0, 0, -0.05); return e;
      });
      const holder = new THREE.Group(); g.add(holder); g.userData.flap = holder;
      add(holder, gm, sf.ctrl ? orange : mat('wing', 0xc9ced8), 0);
      break;
    }
    case 'gear_main': case 'gear_nose': {
      const L = p.gear.len, hold = new THREE.Group(); g.add(hold); g.userData.strut = hold;
      add(hold, geo('strut', () => new THREE.BoxGeometry(L - 0.25, 0.14, 0.14).translate((L - 0.25) / 2, 0, 0)), metal, 0);
      const w = add(hold, geo('wheel', () => new THREE.CylinderGeometry(0.3, 0.3, 0.22, 14).rotateX(Math.PI / 2)), dark, 0, L - 0.3, 0);
      if (id === 'gear_nose') { w.position.z = 0; }
      g.userData.wheel = w;
      break;
    }
    case 's_bolt': case 's_thunder': {
      add(g, cyl(p.r, p.r, p.h * 0.9), white, -p.h * 0.45);
      for (let i = 0; i < 3; i++) add(g, cyl(p.r * 1.01, p.r * 1.01, 0.18), red, -p.h * (0.15 + 0.3 * i));
      add(g, geo('srbn' + id, () => new THREE.CylinderGeometry(p.r * 0.45, p.r * 0.7, p.h * 0.1, 14)), dark, -p.h * 0.95);
      break;
    }
  }
  g.userData.partId = id;
  return g;
}

// plume mesh for engines (additive cone)
export function makePlume(r) {
  const gm = geo('plume', () => { const c = new THREE.ConeGeometry(1, 1, 14, 1, true); c.rotateX(Math.PI); c.translate(0, -0.5, 0); return c; });
  const m = new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const me = new THREE.Mesh(gm, m);
  me.userData.r = r;
  return me;
}
export function makeCanopy() {
  const gm = geo('canopy', () => new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2));
  const g = new THREE.Group();
  const cm = new THREE.Mesh(gm, new THREE.MeshLambertMaterial({ color: 0xff7a2f, side: THREE.DoubleSide }));
  g.add(cm);
  return g;
}
