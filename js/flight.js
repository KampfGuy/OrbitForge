// Orbit Forge - flight simulation, map view, maneuver nodes, HUD
import * as THREE from './vendor/three.module.min.js';
import { PARTS, makePartMesh, makePlume, makeCanopy } from './parts.js';
import { layout, buildEvents, Propulsion, eventLabel, dvRemaining } from './craft.js';
import { BODIES, HOME, G0, propagate, elements, predict, moonState, bodyGlobalPos, atmosphere, horizonFrame, fmtDist, fmtTime, clamp } from './orbit.js';
import { BodyView, makeStars, makeSun, SUN_DIR } from './world.js';
import { Navball } from './navball.js';
const V3 = THREE.Vector3, Q = THREE.Quaternion;
const DT = 0.02;
const RAILS = [1, 5, 10, 50, 100, 1000, 10000, 100000];
const PHYS = [1, 2, 3, 4];
const CRASH_SPEED = 11;
const Y = new V3(0, 1, 0);
const SITE = new V3(1, 0, 0);
// runway in site-local coords (x = south, z = west); planes spawn at the west end facing east
export const RUNWAY = { x: 700, z0: 1180, z1: -1180, w: 40 };
const RAD = Math.PI / 180;
function siteToWorld(x, z, R) { return new V3(R, -x, z).normalize(); }
function clAlpha(a) { // lift coefficient vs angle of attack (rad), with stall
  const s = Math.sign(a), x = Math.abs(a);
  if (x < 0.26) return s * 5.4 * x;
  if (x < 0.42) return s * (1.404 + (0.9 * Math.sin(0.84) - 1.404) * (x - 0.26) / 0.16);
  return s * 0.9 * Math.sin(2 * Math.min(x, Math.PI / 2));
}
function waveCd(M) { return M < 0.85 ? 0 : M < 1.1 ? 0.3 * (M - 0.85) / 0.25 : 0.3 * Math.max(0.35, 1.1 / M); }
const tmpA = new V3(), tmpB = new V3(), tmpC = new V3(), tmpQ = new Q();

function el(tag, cls, html, parent) { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; if (parent) parent.appendChild(e); return e; }
function bodyRot(b, t, out = new Q()) { return out.setFromAxisAngle(Y, (b.rotRate * t) % (Math.PI * 2)); }

export class Flight {
  constructor(app) {
    this.app = app;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.3, 1e10);
    this.sun = new THREE.DirectionalLight(0xfff4e6, 2.6);
    this.scene.add(this.sun, this.sun.target);
    this.amb = new THREE.AmbientLight(0x8899bb, 0.32); this.scene.add(this.amb);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x4a5a3a, 0); this.scene.add(this.hemi);
    this.views = BODIES.map(b => { const v = new BodyView(b); this.scene.add(v.group); return v; });
    this.stars = makeStars(); this.scene.add(this.stars);
    this.sunSprite = makeSun(); this.scene.add(this.sunSprite);
    this.navball = new Navball();
    this.lines = []; this.nodeLines = [];
    const mkLine = (color, n = 2400) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: true })); l.frustumCulled = false; l.visible = false; this.scene.add(l); return l; };
    const cols = [0x4fd1ff, 0xffa646, 0xd06bff];
    for (let i = 0; i < 3; i++) { this.lines.push(mkLine(cols[i])); this.nodeLines.push(mkLine([0xffe14f, 0xff7b4f, 0xff4fa0][i])); }
    this.moonLines = BODIES.filter(b => b.parent).map(b => {
      const l = mkLine(0x7f8a99, 257), p = l.geometry.attributes.position, mp = new V3();
      for (let i = 0; i <= 256; i++) { moonState(b, i / 256 * b.orbit.period, mp); p.setXYZ(i, mp.x, mp.y, mp.z); }
      p.needsUpdate = true; l.geometry.setDrawRange(0, 257); l.userData.body = b; return l;
    });
    this.buildUI();
    this.keys = {};
    this.debug = this.makeDebug();
  }

  // ---------------- setup ----------------
  start(craft) {
    this.craft = craft;
    this.t = this.t0 = 0;
    this.body = HOME;
    this.destroyed = false; this.recovered = false; this.ended = false;
    this.throttle = 0; this.sas = false; this.sasMode = 'stab'; this.holdQ = null;
    this.warpIdx = 0; this.warpMode = 'phys'; this.acc = 0;
    this.map = false; this.mapFocus = null; this.node = null; this.patches = []; this.nodePatches = []; this.predTimer = 0;
    this.camState = { yaw: 1.85, pitch: 0.12, dist: 30, mapYaw: 0.6, mapPitch: 0.9, mapDist: 4e6 };
    this.navMode = 'auto';
    this.stats = { maxAlt: 0, maxSpeed: 0, visited: new Set(['Kampa']) };
    this.contact = true; this.contactT = 1; this.landed = true;
    this.effects = []; this.debris = []; this._camH = undefined; this._lastBurn = null; this.aoa = undefined; this.q_dyn = 0;
    this.w = new V3();
    this.chuteState = new Map();
    // vessel
    if (this.root) this.scene.remove(this.root);
    this.root = new THREE.Group(); this.shape = new THREE.Group(); this.root.add(this.shape); this.scene.add(this.root);
    this.inst = layout(craft); this.events = buildEvents(this.inst); this.prop = new Propulsion(this.inst, this.events);
    this.meshes = new Map(); this.plumes = new Map(); this.canopies = new Map();
    for (const p of this.inst) {
      const m = makePartMesh(p.id); m.position.copy(p.pos); if (p.kind !== 'stack') m.rotation.y = -p.ang;
      this.shape.add(m); this.meshes.set(p.uid, m);
      if (p.def.engine) { const pl = makePlume(p.def.r * (p.def.srb ? 0.8 : 0.75)); pl.position.set(p.pos.x, p.bot, p.pos.z); pl.visible = false; this.shape.add(pl); this.plumes.set(p.uid, pl); }
      if (p.def.chute) { const c = makeCanopy(); c.visible = false; this.shape.add(c); this.canopies.set(p.uid, c); this.chuteState.set(p.uid, { frac: 0, mode: 0 }); }
    }
    // aircraft bits
    this.surfAero = this.inst.some(p => p.rkind === 'surf');
    this.surfs = this.inst.filter(p => p.def.surf && p.kind === 'radial').map(p => {
      p.n = new V3(-Math.sin(p.ang), 0, Math.cos(p.ang)); p.span = new V3(Math.cos(p.ang), 0, Math.sin(p.ang)); p.delta = 0; return p; });
    this.gears = this.inst.filter(p => p.def.gear).map(p => {
      p.tip = p.pos.clone().addScaledVector(p.dir, p.def.gear.len - 0.3).add(new V3(0, 0, 0.3)); return p; });
    this.isPlane = craft.kind === 'plane' || this.gears.length > 0;
    this.gearDown = true; this.gearFrac = 1; this.brakes = false; this.steer = 0;
    this.ctrlAuth = [0, 0, 0];
    this.ui.classList.toggle('plane', this.isPlane);
    this.com = new V3(); this.recomputeShape(true);
    const R = HOME.radius, qr = bodyRot(HOME, this.t);
    if (this.isPlane) {
      // place on the runway threshold, nose east, wings level
      const up0 = siteToWorld(RUNWAY.x, RUNWAY.z0, R), f0 = horizonFrame(up0);
      const m4 = new THREE.Matrix4().makeBasis(f0.north, f0.east, up0.clone().negate());
      this.q = new Q().setFromRotationMatrix(m4).premultiply(qr);
      let low = 0; for (const g of this.gears) low = Math.max(low, g.tip.z - this.com.z);
      if (!this.gears.length) for (const p of this.inst) low = Math.max(low, p.ext);
      this.r = up0.clone().multiplyScalar(R + low - 0.08).applyQuaternion(qr);
      this.camState.yaw = Math.PI - 0.55; this.camState.pitch = 0.22;
    } else {
      // place on pad: X = west, Y = up, Z = north (pilot right = -X = east, dorsal = -Z = south)
      const up0 = SITE.clone(), east0 = Y.clone().cross(up0).normalize(), north0 = up0.clone().cross(east0).normalize();
      const m4 = new THREE.Matrix4().makeBasis(east0.clone().negate(), up0, north0);
      this.q = new Q().setFromRotationMatrix(m4).premultiply(qr);
      this.r = SITE.clone().multiplyScalar(R + (-this.bounds.minY) + 0.02).applyQuaternion(qr);
    }
    this.v = new V3().crossVectors(Y.clone().multiplyScalar(HOME.rotRate), this.r);
    this.camState.dist = Math.max(14, this.bounds.len * (this.isPlane ? 1.9 : 1.6));
    this.updatePrediction(true);
    this.refreshStages();
    this.showUI(true);
    this.toast(this.isPlane ? 'On the runway. STAGE starts the engine, throttle up, pull up (S / stick down) at ~70 m/s.' : 'On the pad. Throttle up (Shift / slider) and press STAGE (Space) to launch.', 5000);
  }
  stop() { this.showUI(false); }

  recomputeShape(first) {
    const alive = this.prop.alive; let m = 0; const c = new V3();
    for (const p of this.inst) { if (!alive.has(p.uid)) continue; const pm = (p.def.dry + this.prop.fuel.get(p.uid)) * 1000; m += pm; c.addScaledVector(p.com, pm); }
    c.divideScalar(Math.max(m, 1));
    const old = this.com.clone();
    this.com.copy(c);
    this.shape.position.copy(c).negate();
    if (!first) this.r.add(c.clone().sub(old).applyQuaternion(this.q));
    let minY = Infinity, maxY = -Infinity, maxR = 0.3, Ip = 0, Ir = 0, fins = 0, top = null;
    for (const p of this.inst) {
      if (!alive.has(p.uid)) continue;
      const pm = (p.def.dry + this.prop.fuel.get(p.uid)) * 1000;
      const dy = p.com.y - c.y, dh = Math.hypot(p.com.x - c.x, p.com.z - c.z);
      Ip += pm * (dy * dy + dh * dh * 0.5 + p.def.h * p.def.h / 12 + p.def.r * p.def.r / 4); Ir += pm * (dh * dh + p.def.r * p.def.r / 2);
      minY = Math.min(minY, p.bot - c.y); maxY = Math.max(maxY, p.top - c.y); maxR = Math.max(maxR, p.ext);
      if (p.id === 'fin') fins++;
      if (p.kind === 'stack' && (!top || p.top > top.top)) top = p;
    }
    this.mass = m; this.Ip = Math.max(Ip, 50); this.Ir = Math.max(Ir, 20);
    if (this.isPlane !== undefined) {
      const pts = this.bodyPts = [];
      for (const p of this.inst) {
        if (!alive.has(p.uid)) continue;
        if (p.kind === 'stack') { const rr = Math.max(0.15, p.def.r * 0.95); for (const y of [p.top, p.bot]) for (const [x, z] of [[rr, 0], [-rr, 0], [0, rr], [0, -rr]]) pts.push(new V3(x, y, z)); }
        else if (p.def.surf && p.dir) { const tip = p.pos.clone().addScaledVector(p.dir, p.ext - p.attachR); pts.push(tip.clone().setY(p.top), tip.clone().setY(p.bot)); }
        else if (p.def.gear) pts.push(p.pos.clone().addScaledVector(p.dir, 0.3));
      }
    }
    this.bounds = { minY, maxY, maxR, len: maxY - minY };
    this.fins = fins;
    this.area = Math.PI * Math.pow(Math.max(...this.inst.filter(p => alive.has(p.uid) && p.kind === 'stack').map(p => p.def.r), 0.3), 2);
    this.cd0 = top && (top.def.nose || top.def.chute || top.id.startsWith('pod')) ? 0.38 : 0.7;
    this.torque = this.inst.filter(p => alive.has(p.uid) && p.def.torque).reduce((s, p) => s + p.def.torque * 1000, 0);
    this.hasControl = this.torque > 0;
    for (const [u, pl] of this.plumes) if (!alive.has(u)) pl.visible = false;
  }

  // ---------------- UI ----------------
  buildUI() {
    const ui = this.ui = el('div', 'fui hidden', '', document.getElementById('ui'));
    const btn = (parent, label, cls, fn, title) => { const b = el('button', cls, label, parent); if (title) b.title = title; b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); fn(b); }); return b; };
    // top pill: altitude + speed, tap for details (auto-collapses)
    this.hud = el('div', 'ftop panel', '', ui);
    this.hudMain = el('div', 'hmain', '', this.hud); this.hudDet = el('div', 'hdet', '', this.hud);
    this.hud.addEventListener('pointerdown', e => { e.stopPropagation(); this.setHudOpen(!this.hudOpen); });
    this.nodeHud = el('div', 'nodehud panel hidden', '', ui);
    this.nodeHud.addEventListener('pointerdown', e => { e.stopPropagation(); this.nodePanelHidden = !this.nodePanelHidden; });
    // staging: collapsed chip showing the next stage; tap to expand the full list
    this.stageWrap = el('div', 'stagewrap', '', ui);
    this.stageChip = el('button', 'stagechip panel', '', this.stageWrap);
    this.stageChip.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); this.setStagesOpen(!this.stagesOpen); });
    this.stageBox = el('div', 'stagebox panel scrolly hidden', '', this.stageWrap);
    this.toastEl = el('div', 'toast hidden', '', ui);
    // bottom centre: SAS row, speed readout, navball
    const bot = el('div', 'fbottom', '', ui);
    const sl = el('div', 'sascol l', '', bot), mid = el('div', 'fmid', '', bot), sr = el('div', 'sascol r', '', bot);
    this.sasBtn = btn(sl, 'SAS', 'sb sas', () => this.toggleSAS(), 'T');
    this.sasModeBtn = btn(sl, '◎', 'sb mode', () => this.sasPop.classList.toggle('hidden'), 'SAS mode');
    this.gearBtn = btn(sr, 'GEAR', 'sb pl gear on', () => this.toggleGear(), 'G');
    this.brkBtn = btn(sr, 'BRK', 'sb pl', () => { this.brakes = !this.brakes; }, 'B');
    this.sasPop = el('div', 'saspop panel hidden', '', bot);
    this.sasBtns = {};
    const modes = [['stab', '◎', 'Hold'], ['pro', '⊕', 'Prograde'], ['retro', '⊗', 'Retro'], ['norm', '▲', 'Normal'], ['anti', '▼', 'Anti-norm'], ['radOut', '⊙', 'Rad out'], ['radIn', '⦾', 'Rad in'], ['node', '◆', 'Node']];
    this.modeGlyph = Object.fromEntries(modes.map(m => [m[0], m[1]])); this.modeGlyph.custom = '✦';
    for (const [k, lab, name] of modes) this.sasBtns[k] = btn(this.sasPop, `${lab}<small>${name}</small>`, 'sb pm', () => { this.setSAS(k); this.sasPop.classList.add('hidden'); }, k);
    this.speedEl = el('button', 'speedro', '', mid);
    this.speedEl.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); this.navMode = this.navMode === 'auto' ? (this.navFrame === 'surface' ? 'orbit' : 'surface') : (this.navMode === 'surface' ? 'orbit' : 'auto'); });
    this.navModeBtn = this.speedEl;
    this.navEl = el('div', 'navball', '', mid);
    this.navTxt = el('div', 'navtxt', '', this.navEl);
    // right thumb: throttle + stage
    const right = el('div', 'fright', '', ui);
    const thc = el('div', 'thcol', '', right);
    const thb = el('div', 'thbtns', '', thc);
    btn(thb, 'MAX', 'sb small', () => this.setThrottle(1)); btn(thb, 'CUT', 'sb small', () => this.setThrottle(0));
    const th = el('div', 'throttle', '', thc);
    this.thFill = el('div', 'thfill', '', th); this.thKnob = el('div', 'thknob', '', th); this.thLab = el('div', 'thlabel', 'THR', th);
    const setTh = e => { const r = th.getBoundingClientRect(); this.setThrottle(clamp(1 - (e.clientY - r.top) / r.height, 0, 1)); };
    th.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); th.setPointerCapture(e.pointerId); this._thDrag = true; setTh(e); });
    th.addEventListener('pointermove', e => { if (this._thDrag) setTh(e); });
    th.addEventListener('pointerup', () => this._thDrag = false); th.addEventListener('pointercancel', () => this._thDrag = false);
    this.stageBtn = btn(right, 'STAGE', 'stagebtn', () => this.doStage(), 'Space');
    // left thumb: joystick + roll
    const left = this.leftEl = el('div', 'fleft', '', ui);
    const rr = el('div', 'rollrow', '', left);
    this.joy = el('div', 'joy', '', left); this.knob = el('div', 'knob', '', this.joy);
    this.joyV = { x: 0, y: 0 }; this.rollIn = 0;
    const joyMove = e => { const r = this.joy.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2, R = r.width / 2;
      let x = (e.clientX - cx) / R, y = (e.clientY - cy) / R; const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
      this.joyV.x = x; this.joyV.y = y; this.knob.style.transform = `translate(${x * R * 0.6}px,${y * R * 0.6}px)`; };
    this.joy.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); this.joy.setPointerCapture(e.pointerId); this._joy = true; joyMove(e); });
    this.joy.addEventListener('pointermove', e => { if (this._joy) joyMove(e); });
    const joyEnd = () => { this._joy = false; this.joyV.x = this.joyV.y = 0; this.knob.style.transform = ''; };
    this.joy.addEventListener('pointerup', joyEnd); this.joy.addEventListener('pointercancel', joyEnd);
    for (const [lab, val] of [['⟲', -1], ['⟳', 1]]) { const b = el('button', 'sb roll', lab, rr); b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); this.rollIn = val; }); const end = () => { this.rollIn = 0; }; b.addEventListener('pointerup', end); b.addEventListener('pointercancel', end); b.addEventListener('pointerleave', end); }
    // top-right tools
    const tools = el('div', 'ftools', '', ui);
    this.mapBtn = btn(tools, 'MAP', 'sb', () => this.toggleMap(), 'M');
    const wr = el('div', 'warpgrp', '', tools);
    btn(wr, '◀◀', 'sb w', () => this.warp(-1), ',');
    this.warpEl = el('div', 'warptxt', '1×', wr);
    btn(wr, '▶▶', 'sb w', () => this.warp(1), '.');
    btn(tools, '☰', 'sb', () => this.menu(), 'Esc');
    this.recoverBtn = btn(ui, 'RECOVER', 'recover hidden', () => this.recover());
    // map tools
    this.mapTools = el('div', 'maptools hidden', '', ui);
    btn(this.mapTools, '+ Node', 'sb wide', () => this.addNode());
    btn(this.mapTools, 'Focus', 'sb wide', () => this.cycleFocus());
    this.nodePanel = el('div', 'nodepanel panel hidden', '', ui);
    this.buildNodePanel();
    this.labels = el('div', 'labels', '', ui); this.labelPool = [];
    this.hudOpen = false; this.stagesOpen = false;
  }
  setHudOpen(on) { if (on && this.stagesOpen && this.app.W < 900) this.setStagesOpen(false); this.hudOpen = on; this.hud.classList.toggle('open', on); this.ui.classList.toggle('hudopen', on); clearTimeout(this._hudT); if (on && this.app.W < 900) this._hudT = setTimeout(() => this.setHudOpen(false), 6000); }
  setStagesOpen(on) { if (on && this.hudOpen && this.app.W < 900) this.setHudOpen(false); this.stagesOpen = on; this.stageBox.classList.toggle('hidden', !on); this.stageChip.classList.toggle('open', on); this.refreshStages(); clearTimeout(this._stT); if (on) this._stT = setTimeout(() => this.setStagesOpen(false), 6000); }
  toggleGear() { this.gearDown = !this.gearDown; this.toast(this.gearDown ? 'Gear down' : 'Gear up', 1000); }
  buildNodePanel() {
    const P = this.nodePanel; P.innerHTML = '';
    const row = cls => el('div', 'nrow ' + (cls || ''), '', P);
    const rep = (b, fn) => { let iv = null, to = null; const stop = () => { clearInterval(iv); clearTimeout(to); };
      b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); fn(); to = setTimeout(() => iv = setInterval(fn, 70), 380); });
      b.addEventListener('pointerup', stop); b.addEventListener('pointerleave', stop); b.addEventListener('pointercancel', stop); };
    this.nodeStep = 10;
    const r0 = row(); el('span', 'nlab', 'Time', r0);
    for (const [lab, dt] of [['−5m', -300], ['−30s', -30], ['−5s', -5], ['+5s', 5], ['+30s', 30], ['+5m', 300]]) rep(el('button', 'nb', lab, r0), () => this.editNode('t', dt));
    const r1 = row(); rep(el('button', 'nb', '→Ap', r1), () => this.editNode('ap')); rep(el('button', 'nb', '→Pe', r1), () => this.editNode('pe'));
    el('span', 'nlab', 'Step', r1);
    this.stepBtns = [1, 10, 100].map(s => { const b = el('button', 'nb' + (s === 10 ? ' on' : ''), s + '', r1); b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); this.nodeStep = s; this.stepBtns.forEach(x => x.classList.toggle('on', x === b)); }); return b; });
    this.nodeVals = {};
    for (const [k, lab, col] of [['pro', 'Prograde', '#d8f03a'], ['norm', 'Normal', '#d14cf0'], ['rad', 'Radial', '#3ae0f0']]) {
      const r = row(); const l = el('span', 'nlab', lab, r); l.style.color = col;
      rep(el('button', 'nb', '−', r), () => this.editNode(k, -this.nodeStep));
      this.nodeVals[k] = el('span', 'nval', '0', r);
      rep(el('button', 'nb', '+', r), () => this.editNode(k, this.nodeStep));
      rep(el('button', 'nb', '0', r), () => this.editNode(k, 0, true));
    }
    this.nodeInfo = el('div', 'ninfo', '', P);
    const r4 = row(); const del = el('button', 'nb danger', 'Delete node', r4); del.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); this.node = null; this.updatePrediction(true); });
  }
  showUI(on) { this.ui.classList.toggle('hidden', !on); }
  toast(msg, ms = 3500) { this.toastEl.textContent = msg; this.toastEl.classList.remove('hidden'); clearTimeout(this._toastT); this._toastT = setTimeout(() => this.toastEl.classList.add('hidden'), ms); }
  refreshStages() {
    const ev = this.events, html = [];
    for (let i = this.prop.next; i < ev.length; i++) html.push(`<div class="st${i === this.prop.next ? ' next' : ''}"><b>${ev.length - i}</b> ${eventLabel(this.inst, ev[i])}</div>`);
    this.stageBox.innerHTML = html.length ? html.join('') : '<div class="st">No stages left</div>';
    const left = ev.length - this.prop.next;
    this.stageChip.innerHTML = left > 0 ? `<b>${left}</b> ${eventLabel(this.inst, ev[this.prop.next])} <i>${this.stagesOpen ? '▴' : '▾'}</i>` : '<b>0</b> No stages left';
  }

  // ---------------- controls ----------------
  setThrottle(x) { this.throttle = clamp(x, 0, 1); }
  toggleSAS() { this.sas = !this.sas; this.holdQ = null; if (this.sas && !this.hasControl) this.toast('No reaction wheel: SAS works through engine gimbal only'); }
  setSAS(k) {
    if (k === 'node' && !this.node) { this.toast('No maneuver node'); return; }
    this.sas = true; this.sasMode = k; this.holdQ = null;
  }
  doStage() {
    if (this.destroyed) return;
    const res = this.prop.stage();
    if (!res) { this.toast('Nothing left to stage'); return; }
    if (res.removed.length) this.spawnDebris(res.removed, res.e);
    this.recomputeShape(false);
    this.refreshStages();
    this.updatePrediction(true);
    if (this.landed && res.e.ignite && res.e.ignite.length) { this.landed = false; }
  }
  warp(d) {
    const railsOK = this.canRails();
    if (d > 0) {
      if (railsOK) { if (this.warpMode !== 'rails') { this.warpMode = 'rails'; this.warpIdx = 0; } this.warpIdx = Math.min(this.warpIdx + 1, this.maxRailsIdx()); }
      else { if (this.warpMode !== 'phys') { this.warpMode = 'phys'; this.warpIdx = 0; } this.warpIdx = Math.min(this.warpIdx + 1, PHYS.length - 1); if (this.throttle > 0 || this.contact) this.toast('Physics warp (in atmosphere / thrusting)'); }
    } else this.warpIdx = Math.max(0, this.warpIdx - 1);
  }
  warpFactor() { return this.warpMode === 'rails' ? RAILS[this.warpIdx] : PHYS[this.warpIdx]; }
  maxRailsIdx() {
    const alt = this.r.length() - this.body.radius;
    if (this.landed) return RAILS.length - 1;
    if (alt < 5000) return 2; if (alt < 30000) return 4; if (alt < 120000) return 5; if (alt < 600000) return 6; return RAILS.length - 1;
  }
  thrusting() { if (this.throttle <= 0 && ![...this.prop.active].some(u => this.prop.by.get(u).def.srb && this.prop.fuel.get(u) > 0)) return false; const b = this.prop.burn(this.throttle, 0, 0); return b.F > 0; }
  canRails() {
    if (this.destroyed) return false;
    if (this.landed) return !this.thrusting();
    const alt = this.r.length() - this.body.radius;
    return !this.thrusting() && !this.contact && (!this.body.atm || alt > this.body.atm.height);
  }
  toggleMap() {
    this.map = !this.map; this.mapTools.classList.toggle('hidden', !this.map); this.ui.classList.toggle('mapmode', this.map);
    this.mapBtn.classList.toggle('on', this.map);
    if (this.map) { this.mapFocus = this.body; this.camState.mapDist = Math.max(this.body.radius * 3.2, this.r.length() * 2.4); }
    this.nodePanel.classList.toggle('hidden', !(this.map && this.node));
  }
  cycleFocus() {
    const list = [this.body, 'vessel', ...BODIES.filter(b => b !== this.body)];
    const i = list.indexOf(this.mapFocus); this.mapFocus = list[(i + 1) % list.length];
    const fb = this.mapFocus === 'vessel' ? null : this.mapFocus;
    this.camState.mapDist = fb ? fb.radius * 4 : 2e5;
    this.toast('Map focus: ' + (fb ? fb.name : 'vessel'), 1500);
  }
  menu() {
    this.app.dialog('Paused', [
      ['Resume', () => { }],
      ['Revert to launch', () => this.start(this.craft)],
      ['Back to builder', () => this.app.toBuilder()],
      ['Main menu', () => this.app.toMenu()],
    ]);
  }
  recover() {
    const s = this.stats;
    this.ended = true;
    this.app.dialog('Vessel recovered', [['Back to builder', () => this.app.toBuilder()], ['Fly again', () => this.start(this.craft)], ['Main menu', () => this.app.toMenu()]],
      `<p>Max altitude: <b>${fmtDist(s.maxAlt)}</b><br>Max speed: <b>${s.maxSpeed.toFixed(0)} m/s</b><br>Visited: <b>${[...s.visited].join(', ')}</b><br>Mission time: <b>${fmtTime(this.t - this.t0)}</b></p>`);
  }

  // ---------------- maneuver nodes ----------------
  addNode() {
    if (!this.patches.length) return;
    const el0 = this.patches[0].el;
    let t = this.t + 120;
    if (el0.ecc < 1 && isFinite(el0.tAp)) t = this.t + el0.tAp;
    this.node = { t, pro: 0, norm: 0, rad: 0, applied: new V3() };
    this.nodePanel.classList.remove('hidden');
    this.updatePrediction(true);
  }
  editNode(k, d, abs) {
    const n = this.node; if (!n) return;
    if (k === 't') n.t = Math.max(this.t + 1, n.t + d);
    else if (k === 'ap' || k === 'pe') { const st = this.stateAt(n.t); if (st) { const e = elements(st.r, st.v, st.body.mu); const dtt = k === 'ap' ? e.tAp : e.tPe; if (isFinite(dtt)) { n.t = n.t + dtt; if (e.period && n.t - this.t > e.period) n.t -= e.period; } } }
    else n[k] = abs ? 0 : n[k] + d;
    n.applied.set(0, 0, 0);
    this.updatePrediction(true);
  }
  // state on the current predicted trajectory at absolute time tt
  stateAt(tt) {
    for (const p of this.patches) {
      if (tt >= p.t0 - 1e-6 && (tt <= p.t1 + 1e-6 || p.end === 'closed')) {
        const r = new V3(), v = new V3(); propagate(p.r0, p.v0, tt - p.t0, p.body.mu, r, v); return { body: p.body, r, v };
      }
    }
    return null;
  }
  nodeFrame(st) {
    const pro = st.v.clone().normalize(), norm = new V3().crossVectors(st.r, st.v).normalize(), rad = new V3().crossVectors(pro, norm).normalize();
    return { pro, norm, rad };
  }
  updatePrediction(force) {
    if (this.destroyed) { this.patches = []; return; }
    this.patches = this.landed ? [] : predict(this.body, this.r, this.v, this.t, 3);
    this.nodePatches = [];
    const n = this.node;
    if (n && this.patches.length) {
      if (n.t < this.t && n.applied.lengthSq() === 0) n.t = this.t + 1;
      if (n.applied.lengthSq() === 0 || !n.base) {
        const st = this.stateAt(Math.max(n.t, this.t));
        if (st) {
          const f = this.nodeFrame(st);
          n.base = st; n.dvWorld = f.pro.multiplyScalar(n.pro).add(f.norm.multiplyScalar(n.norm)).add(f.rad.multiplyScalar(n.rad));
        }
      }
      if (n.base) this.nodePatches = predict(n.base.body, n.base.r, n.base.v.clone().add(n.dvWorld), n.t, 3);
    }
  }
  nodeRemaining() { const n = this.node; if (!n || !n.dvWorld) return null; return n.dvWorld.clone().sub(n.applied); }

  // ---------------- physics ----------------
  frame() { return horizonFrame(this.r); }
  groundVel(r, out) { return out.crossVectors(tmpC.set(0, this.body.rotRate, 0), r); }
  lowestAlt() {
    const R = this.body.radius; let lo = Infinity; const b = this.bounds;
    if (this.gears.length && this.bodyPts) {
      for (const p of this.bodyPts) { tmpA.copy(p).sub(this.com).applyQuaternion(this.q).add(this.r); lo = Math.min(lo, tmpA.length() - R); }
      for (const g of this.gears) { if (!this.prop.alive.has(g.uid)) continue; tmpA.copy(g.tip).sub(this.com).applyQuaternion(this.q).add(this.r); lo = Math.min(lo, tmpA.length() - R); }
      return lo;
    }
    for (const y of [b.minY, b.maxY]) for (let k = 0; k < 6; k++) {
      const a = k / 6 * Math.PI * 2; tmpA.set(Math.cos(a) * b.maxR * 0.7, y, Math.sin(a) * b.maxR * 0.7).applyQuaternion(this.q).add(this.r);
      lo = Math.min(lo, tmpA.length() - R);
    }
    return lo;
  }
  dirs(frameKind) {
    // navball marker directions (world)
    const vs = frameKind === 'surface' ? this.v.clone().sub(this.groundVel(this.r, new V3())) : this.v.clone();
    if (vs.lengthSq() < 0.01) return { pro: null, norm: null, radOut: null, node: null };
    const pro = vs.clone().normalize();
    const norm = new V3().crossVectors(this.r, this.v).normalize();
    const radOut = new V3().crossVectors(pro, norm).normalize();
    const rem = this.nodeRemaining();
    return { pro, norm, radOut, node: rem && rem.lengthSq() > 1e-6 ? rem.clone().normalize() : null };
  }
  sasTarget() {
    const m = this.sasMode;
    if (m === 'custom' && this.customDir) { const f = this.frame(); const p = this.customDir.pitch * Math.PI / 180, h = this.customDir.hdg * Math.PI / 180;
      return f.up.clone().multiplyScalar(Math.sin(p)).addScaledVector(f.north, Math.cos(p) * Math.cos(h)).addScaledVector(f.east, Math.cos(p) * Math.sin(h)); }
    if (m === 'stab' || m === 'custom') return null;
    const d = this.dirs(this.navFrame || 'orbit');
    const map = { pro: d.pro, retro: d.pro && d.pro.clone().negate(), norm: d.norm, anti: d.norm && d.norm.clone().negate(), radOut: d.radOut, radIn: d.radOut && d.radOut.clone().negate(), node: d.node };
    return map[m] || null;
  }
  // control input (pilot + SAS), returns per-axis command [-1,1] in local axes (x pitch, y roll, z yaw)
  controlInput() {
    const pb = this._lastBurn;
    let gimbal = 0;
    if (pb) for (const u of pb.firing) { const p = this.prop.by.get(u); if (p.def.gimbal) gimbal += p.def.thrust * 1000 * (p.def.srb ? 1 : this.throttle) * Math.sin(p.def.gimbal * Math.PI / 180) * Math.abs(p.bot - this.com.y); }
    const ca = this.ctrlAuth || [0, 0, 0];
    this.alphaAct = [clamp((this.torque + gimbal) / this.Ip, 0.03, 5), clamp((this.torque + gimbal * 0.15) / this.Ir, 0.03, 5), clamp((this.torque + gimbal) / this.Ip, 0.03, 5)];
    const alpha = [clamp((this.torque + gimbal + ca[0]) / this.Ip, 0.03, 8), clamp((this.torque + gimbal * 0.15 + ca[1]) / this.Ir, 0.03, 8), clamp((this.torque + gimbal + ca[2]) / this.Ip, 0.03, 8)];
    const k = this.keys;
    // W = nose down (+x), E = roll right (+y), D = yaw right (+z)
    const uin = [
      (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0) - this.joyV.y,
      (k.KeyE ? 1 : 0) - (k.KeyQ ? 1 : 0) + this.rollIn,
      (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0) + this.joyV.x,
    ].map(x => clamp(x, -1, 1));
    if (this.isPlane) { // planes: stick left/right banks in the air, steers on the ground
      const yx = this.joyV.x, onG = this.contact;
      uin[2] = clamp((k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0) + yx * (onG ? 1 : 0.3), -1, 1);
      uin[1] = clamp((k.KeyE ? 1 : 0) - (k.KeyQ ? 1 : 0) + this.rollIn + (onG ? 0 : yx * 0.85), -1, 1);
    }
    if (this.testInput) for (let i = 0; i < 3; i++) uin[i] = this.testInput[i];
    this.uin = uin;
    const anyIn = uin.some(x => Math.abs(x) > 0.05);
    const u = uin.slice();
    if (this.sas) {
      const w = this.w;
      let err = null;
      const target = this.sasTarget();
      if (target) {
        const dl = target.clone().applyQuaternion(tmpQ.copy(this.q).invert());
        const ax = new V3().crossVectors(Y, dl); const s = ax.length(), c = Y.dot(dl);
        const ang = Math.atan2(s, c);
        err = s > 1e-9 ? ax.multiplyScalar(ang / s) : new V3(c < 0 ? Math.PI : 0, 0, 0);
        err.y = 0;
        if (this.isPlane && this.sasMode === 'custom') { // keep the wings level
          const up = this.r.clone().normalize(), right = new V3(-1, 0, 0).applyQuaternion(this.q), dors = new V3(0, 0, -1).applyQuaternion(this.q);
          err.y = Math.atan2(right.dot(up), Math.max(0.05, dors.dot(up))) * 0.8;
        }
      } else {
        if (anyIn || !this.holdQ || (this.isPlane && this.contact)) this.holdQ = this.q.clone();
        const qe = this.q.clone().invert().multiply(this.holdQ);
        if (qe.w < 0) { qe.x = -qe.x; qe.y = -qe.y; qe.z = -qe.z; qe.w = -qe.w; }
        const sa = Math.sqrt(1 - Math.min(1, qe.w * qe.w)), ang = 2 * Math.acos(Math.min(1, qe.w));
        err = sa > 1e-9 ? new V3(qe.x / sa * ang, qe.y / sa * ang, qe.z / sa * ang) : new V3();
      }
      const e = [err.x, err.y, err.z], wv = [w.x, w.y, w.z];
      for (let i = 0; i < 3; i++) {
        if (Math.abs(uin[i]) > 0.05) continue;
        const ae = Math.abs(e[i]);
        const wdes = Math.sign(e[i]) * Math.min(Math.sqrt(1.2 * alpha[i] * ae), 3.5 * ae, 1.0);
        u[i] = clamp((wdes - wv[i]) / (alpha[i] * 0.12), -1, 1);
      }
    }
    return u;
  }
  rotIntegrate(dt, u, aero, extT) {
    const a = this.alphaAct;
    this.w.x += (u[0] * a[0] + (aero ? aero.x : 0) + (extT ? extT.x / this.Ip : 0)) * dt;
    this.w.y += (u[1] * a[1] + (aero ? aero.y || 0 : 0) + (extT ? extT.y / this.Ir : 0)) * dt;
    this.w.z += (u[2] * a[2] + (aero ? aero.z : 0) + (extT ? extT.z / this.Ip : 0)) * dt;
    if (aero && aero.damp) { const f = 1 / (1 + aero.damp * dt); this.w.x *= f; this.w.z *= f; }
    if (this.w.length() > 3) this.w.setLength(3);
    const wl = this.w.length();
    if (wl > 1e-9) { tmpQ.setFromAxisAngle(tmpA.copy(this.w).divideScalar(wl), wl * dt); this.q.multiply(tmpQ).normalize(); }
  }
  rotStep(dt, aero) { const u = this.controlInput(); this.rotIntegrate(dt, u, aero); }
  // lift/drag of one surface; vp = surface velocity through the air (local), n = surface normal (local)
  surfForce(S, vp, n, rho, mach, rr, outF, outT) {
    const sp = vp.length(); if (sp < 0.3) return;
    const vh = tmpB.copy(vp).divideScalar(sp);
    const sa = clamp(n.dot(vh), -1, 1), a = Math.asin(sa);
    const qd = 0.5 * rho * sp * sp;
    const cl = clAlpha(a) * (mach > 1 ? 1 / Math.pow(mach, 0.6) : 1);
    const cd = 0.018 + 1.15 * sa * sa + 0.045 * cl * cl + waveCd(mach) * 0.12;
    const perp = tmpC.copy(n).addScaledVector(vh, -sa); const pl = perp.length();
    const f = new V3();
    if (pl > 1e-6) f.addScaledVector(perp, -qd * S * cl / pl);
    f.addScaledVector(vh, -qd * S * cd);
    outF.add(f); if (outT) outT.add(new V3().crossVectors(rr, f));
  }
  surfaceAero(vsl, rho, mach, u, dt) {
    const F = new V3(), T = new V3(), auth = [0, 0, 0];
    const alive = this.prop.alive;
    const rr = new V3(), vp = new V3(), n = new V3(), Tp = new V3(), Tm = new V3(), dum = new V3();
    for (const s of this.surfs) {
      if (!alive.has(s.uid)) continue;
      rr.copy(s.com).sub(this.com);
      vp.crossVectors(this.w, rr).add(vsl);
      const sf = s.def.surf;
      let target = 0;
      if (sf.ctrl) {
        const d0 = 0.1;
        Tp.set(0, 0, 0); Tm.set(0, 0, 0);
        n.copy(s.n).multiplyScalar(Math.cos(d0)).addScaledVector(Y, -Math.sin(d0)); this.surfForce(sf.area, vp, n, rho, mach, rr, dum.set(0, 0, 0), Tp);
        n.copy(s.n).multiplyScalar(Math.cos(d0)).addScaledVector(Y, Math.sin(d0)); this.surfForce(sf.area, vp, n, rho, mach, rr, dum.set(0, 0, 0), Tm);
        const A = [Tp.x - Tm.x, Tp.y - Tm.y, Tp.z - Tm.z], am = Math.max(Math.abs(A[0]), Math.abs(A[1]), Math.abs(A[2]), 1e-9);
        let cmd = 0;
        for (let i = 0; i < 3; i++) if (Math.abs(A[i]) > 0.3 * am) { cmd += u[i] * Math.sign(A[i]); auth[i] += Math.abs(A[i]) / (2 * d0) * sf.ctrl * RAD; }
        target = clamp(cmd, -1, 1) * sf.ctrl * RAD;
      }
      s.delta += clamp(target - s.delta, -dt * 3, dt * 3);
      n.copy(s.n).multiplyScalar(Math.cos(s.delta)).addScaledVector(Y, -Math.sin(s.delta));
      this.surfForce(sf.area, vp, n, rho, mach, rr, F, T);
    }
    this.ctrlAuth = auth;
    return { F, T };
  }
  // landing gear: spring-damper wheels with rolling, braking, side friction and nose-wheel steering
  wheels(dt, u, vs) {
    this._wheelContact = false;
    if (this.gearFrac < 0.95 || !this.gears.length) return null;
    const b = this.body, R = b.radius, alive = this.prop.alive;
    const list = this.gears.filter(p => alive.has(p.uid)); if (!list.length) return null;
    const n = list.length, m = this.mass, g = b.mu / this.r.lengthSq();
    const k = m * g / (n * 0.12), c = 2 * 0.8 * Math.sqrt(k * m / n);
    const F = new V3(), T = new V3(), qi = this.q.clone().invert();
    const nose = Y.clone().applyQuaternion(this.q), right = new V3(-1, 0, 0).applyQuaternion(this.q);
    const spd = vs.length();
    for (const p of list) {
      const rl = p.tip.clone().sub(this.com);
      const P = rl.clone().applyQuaternion(this.q).add(this.r);
      const h = P.length() - R;
      p.wc = h < 0;
      if (h >= 0) continue;
      this._wheelContact = true;
      const up = P.clone().normalize();
      const vpt = new V3().crossVectors(this.w, rl).applyQuaternion(this.q).add(vs);
      const vn = vpt.dot(up);
      const N = Math.max(0, k * (-h) - c * vn);
      let fwd = nose.clone().addScaledVector(up, -nose.dot(up)); if (fwd.lengthSq() < 1e-6) fwd = right.clone().cross(up); fwd.normalize();
      let side = right.clone().addScaledVector(up, -right.dot(up)).addScaledVector(fwd, -right.dot(fwd)).normalize();
      if (p.def.gear.steer) {
        const st = this.steer * p.def.gear.steer * RAD * (spd < 12 ? 1 : Math.max(0.2, 12 / spd));
        const f2 = fwd.clone().multiplyScalar(Math.cos(st)).addScaledVector(side, Math.sin(st)); side = side.clone().multiplyScalar(Math.cos(st)).addScaledVector(fwd, -Math.sin(st)); fwd = f2;
        p.steerAng = st;
      }
      const vf = vpt.dot(fwd), vl = vpt.dot(side);
      const mu = 0.9;
      const Flat = clamp(-vl * (m / n) * 14, -mu * N, mu * N);
      const bc = this.brakes && p.def.gear.brake ? 0.6 : 0.012;
      const Flong = -Math.sign(vf) * Math.min(Math.abs(vf) * (m / n) / (dt * 4), bc * N);
      const f = up.multiplyScalar(N).addScaledVector(side, Flat).addScaledVector(fwd, Flong);
      F.add(f); T.add(new V3().crossVectors(rl, f.clone().applyQuaternion(qi)));
    }
    return { F, T };
  }
  step(dt) {
    const b = this.body, r = this.r, v = this.v;
    const rm = r.length(), alt = rm - b.radius;
    const atm = atmosphere(b, alt);
    const vg = this.groundVel(r, new V3());
    const vs = v.clone().sub(vg); const vsm = vs.length();
    const mach = vsm / 340;
    // engines
    this.prop._env = { rho: atm.rho, mach };
    const burn = this.prop.burn(this.throttle, atm.p, dt, this.prop._env);
    this._lastBurn = burn;
    if (burn.F > 0) this.mass = this.prop.mass();
    const nose = Y.clone().applyQuaternion(this.q);
    const acc = r.clone().multiplyScalar(-b.mu / (rm * rm * rm));
    const thrA = burn.F / this.mass;
    acc.addScaledVector(nose, thrA);
    if (this.node && burn.F > 0) this.node.applied.addScaledVector(nose, thrA * dt);
    // gear animation
    this.gearFrac = clamp(this.gearFrac + (this.gearDown ? 1 : -1) * dt * 0.7, 0, 1);
    // chutes
    let chuteA = 0, chuteN = 0;
    for (const u of this.prop.chutes) {
      if (!this.prop.alive.has(u)) continue;
      const cs = this.chuteState.get(u);
      if (cs.mode === 0 && atm.rho > 0.02 && vsm < 400) cs.mode = 1;
      if (cs.mode === 1 && alt - (-this.bounds.minY) < 1100 && atm.rho > 0.02) cs.mode = 2;
      if (atm.rho <= 0 && cs.mode > 0 && cs.mode < 3) cs.mode = 0;
      if (this.landed && cs.mode === 2) cs.mode = 3;
      const target = cs.mode === 2 ? 1 : cs.mode === 1 ? 0.03 : 0;
      cs.frac += (target - cs.frac) * Math.min(1, dt * 0.9);
      chuteA += cs.frac * 560; chuteN += cs.frac;
    }
    const u = this.controlInput();
    // aero
    let aero = null;
    if (atm.rho > 0 && vsm > 0.5) {
      const qdyn = 0.5 * atm.rho * vsm * vsm;
      const qi = tmpQ.copy(this.q).invert();
      const vdl = vs.clone().divideScalar(vsm).applyQuaternion(qi);
      const sin2 = 1 - Math.pow(clamp(vdl.y, -1, 1), 2);
      this.q_dyn = qdyn;
      if (this.surfAero) {
        const CdA = this.area * (this.cd0 * 0.6 + 0.8 * sin2 + waveCd(mach)) + chuteA;
        acc.addScaledVector(vs, -0.5 * atm.rho * vsm * CdA / this.mass);
        const sa = this.surfaceAero(vs.clone().applyQuaternion(qi), atm.rho, mach, u, dt);
        acc.addScaledVector(sa.F.applyQuaternion(this.q), 1 / this.mass);
        aero = { x: sa.T.x / this.Ip, y: sa.T.y / this.Ir, z: sa.T.z / this.Ip, damp: chuteN * 2 };
        this.aoa = Math.atan2(vdl.z, vdl.y) / RAD;
      } else {
        const CdA = this.area * (this.cd0 + 1.1 * sin2) + chuteA;
        acc.addScaledVector(vs, -0.5 * atm.rho * vsm * CdA / this.mass);
        const L = Math.max(1, this.bounds.len) / 6;
        const stab = 0.1 + 0.35 * this.fins;
        const ax = new V3().crossVectors(Y, vdl).multiplyScalar(qdyn * this.area * L * stab / this.Ip);
        if (chuteN > 0.02) ax.add(new V3().crossVectors(Y, vdl.clone().negate()).multiplyScalar(qdyn * Math.min(chuteA, 60) * L * 0.5 / this.Ip));
        aero = { x: ax.x, z: ax.z, damp: Math.min(20, qdyn * this.area * L * L * (0.3 + 0.5 * this.fins) / this.Ip * 0.5 + chuteN * 2) };
      }
    } else { this.q_dyn = 0; this.ctrlAuth = [0, 0, 0]; }
    // wheels
    this.steer = clamp(this.uin ? this.uin[2] : 0, -1, 1); // nose-wheel steering follows the pilot only (SAS steering oscillates on the ground)
    const wr = this.gears.length ? this.wheels(dt, u, vs) : null;
    if (wr) acc.addScaledVector(wr.F, 1 / this.mass);
    // rotation (rockets sitting on the ground keep their attitude locked)
    const weight = b.mu / (rm * rm) * this.mass;
    if (this.contact && !this.gears.length && burn.F < weight * 1.02) {
      this.w.set(0, 0, 0);
      tmpQ.setFromAxisAngle(Y, b.rotRate * dt); this.q.premultiply(tmpQ);
    } else this.rotIntegrate(dt, u, aero, wr ? wr.T : null);
    // integrate (semi-implicit Euler)
    v.addScaledVector(acc, dt); r.addScaledVector(v, dt);
    this.t += dt;
    this.groundContact(dt);
    this.checkSOI();
    if (burn.firing.length === 0 && this.prop.active.size && this.throttle > 0 && !this._flameoutWarned) { this._flameoutWarned = true; this.toast(this.isPlane && [...this.prop.active].some(u => this.prop.by.get(u).def.air) ? 'Flameout: not enough air (or fuel)' : 'Flameout: stage when ready'); }
    if (burn.firing.length) this._flameoutWarned = false;
    if (burn.F > 0 && this.node) { const rem = this.nodeRemaining(); if (rem && rem.dot(this.node.dvWorld) <= 0) { this.toast('Maneuver complete'); } }
  }
  groundContact(dt) {
    if (this.destroyed) return;
    if (this.gears.length) return this.planeContact(dt);
    const lo = this.lowestAlt();
    if (lo < 0) {
      const up = this.r.clone().normalize();
      const vg = this.groundVel(this.r, new V3());
      const vrel = this.v.clone().sub(vg);
      const sp = vrel.length();
      if (!this.contact && sp > CRASH_SPEED) { this.crash(sp); return; }
      this.r.addScaledVector(up, -lo);
      const vn = vrel.dot(up);
      if (vn < 0) vrel.addScaledVector(up, -vn);
      const vt = vrel.clone().addScaledVector(up, -vrel.dot(up));
      vrel.addScaledVector(vt, -Math.min(1, 6 * dt));
      this.v.copy(vg).add(vrel);
      this.contact = true; this.contactT += dt;
      if (this.contactT > 0.6 && vrel.length() < 0.6 && !this.landed) { this.landed = true; this.toast('Landed on ' + this.body.name); this.updatePrediction(true); }
    } else { if (this.contact && lo > 0.3) { this.contact = false; this.contactT = 0; if (this.landed) { this.landed = false; } } }
  }
  planeContact(dt) {
    const R = this.body.radius; let lo = Infinity;
    for (const p of this.bodyPts) { tmpA.copy(p).sub(this.com).applyQuaternion(this.q).add(this.r); lo = Math.min(lo, tmpA.length() - R); }
    if (this.gearFrac < 0.95) for (const g of this.gears) { if (!this.prop.alive.has(g.uid)) continue; tmpA.copy(g.tip).sub(this.com).applyQuaternion(this.q).add(this.r); lo = Math.min(lo, tmpA.length() - R + 0.6); }
    const up = this.r.clone().normalize();
    const vg = this.groundVel(this.r, new V3());
    const vrel = this.v.clone().sub(vg);
    let body = false;
    if (lo < 0) {
      const vn = vrel.dot(up), sp = vrel.length();
      if (vn < -CRASH_SPEED || sp > 60) { this.crash(sp); return; }
      body = true;
      this.r.addScaledVector(up, -lo);
      if (vn < 0) vrel.addScaledVector(up, -vn);
      const vt = vrel.clone().addScaledVector(up, -vrel.dot(up));
      vrel.addScaledVector(vt, -Math.min(1, 1.2 * dt));
      this.v.copy(vg).add(vrel);
      this.w.multiplyScalar(0.9);
    }
    const c = body || this._wheelContact;
    if (c) {
      this.contact = true; this.contactT += dt;
      const sp = vrel.length();
      if (!this.landed && this.contactT > 0.6 && sp < 0.3 && this.w.length() < 0.05 && this.throttle === 0) { this.landed = true; if (this.stats.maxSpeed > 0 && this.t - this.t0 > 8) this.toast('Stopped on ' + this.body.name, 1500); this.updatePrediction(true); }
      if (this.landed && (sp > 0.8 || this.throttle > 0)) this.landed = false;
    } else { this.contact = false; this.contactT = 0; this.landed = false; }
  }
  checkSOI() {
    const b = this.body, P = new V3(), Vv = new V3();
    if (b.parent && this.r.length() > b.soi) { moonState(b, this.t, P, Vv); this.r.add(P); this.v.add(Vv); this.setBody(b.parent); return; }
    for (const m of b.children) { moonState(m, this.t, P, Vv); if (this.r.distanceTo(P) < m.soi) { this.r.sub(P); this.v.sub(Vv); this.setBody(m); return; } }
  }
  setBody(nb) {
    this.body = nb; this.stats.visited.add(nb.name);
    for (const d of this.debris) this.scene.remove(d.group);
    this.debris = [];
    if (this.map) this.mapFocus = nb;
    this.toast('Entering sphere of influence: ' + nb.name);
    this.updatePrediction(true);
  }
  crash(speed) {
    this.destroyed = true; this.root.visible = false;
    for (const pl of this.plumes.values()) pl.visible = false;
    this.explode(this.r.clone(), Math.max(12, this.bounds.len));
    this.warpIdx = 0;
    setTimeout(() => {
      if (!this.destroyed || this.ended) return;
      this.ended = true;
      this.app.dialog('Vessel destroyed', [['Revert to launch', () => this.start(this.craft)], ['Back to builder', () => this.app.toBuilder()]], `<p>Impact at ${speed.toFixed(1)} m/s on ${this.body.name}. Crash tolerance is ${CRASH_SPEED} m/s.</p>`);
    }, 1800);
  }
  explode(pos, size) {
    const g = new THREE.Group();
    const m1 = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), new THREE.MeshBasicMaterial({ color: 0xffc060, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    const m2 = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: 0x553322, transparent: true, depthWrite: false }));
    g.add(m1, m2); this.scene.add(g);
    this.effects.push({ g, m1, m2, pos, body: this.body, t: 0, size });
  }
  spawnDebris(uids, e) {
    const groups = new Map();
    for (const u of uids) { const p = this.prop.by.get(u); const key = e.drop ? p.groupKey + '#' + p.sym : 'stack'; (groups.get(key) || groups.set(key, []).get(key)).push(p); }
    for (const [key, parts] of groups) {
      const g = new THREE.Group(); const c = new V3(); let m = 0;
      for (const p of parts) { const pm = (p.def.dry + this.prop.fuel.get(p.uid)) * 1000; c.addScaledVector(p.com, pm); m += pm; }
      c.divideScalar(Math.max(m, 1));
      for (const p of parts) { const me = this.meshes.get(p.uid); me.position.copy(p.pos).sub(c); g.add(me); const pl = this.plumes.get(p.uid); if (pl) { pl.visible = false; } }
      const off = c.clone().sub(this.com).applyQuaternion(this.q);
      const r = this.r.clone().add(off);
      const sep = e.drop ? new V3(off.x, off.y, off.z).projectOnPlane(Y.clone().applyQuaternion(this.q)).normalize().multiplyScalar(4) : Y.clone().applyQuaternion(this.q).multiplyScalar(-2);
      const v = this.v.clone().add(sep);
      this.scene.add(g);
      this.debris.push({ g, group: g, r, v, q: this.q.clone(), w: new V3((Math.random() - 0.5) * 0.4, 0, (Math.random() - 0.5) * 0.4), m: Math.max(m, 50), ttl: 120, area: 1.2 });
    }
  }
  stepDebris(dt) {
    const b = this.body;
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      const rm = d.r.length(), alt = rm - b.radius, atm = atmosphere(b, alt);
      const acc = d.r.clone().multiplyScalar(-b.mu / (rm * rm * rm));
      if (atm.rho > 0) { const vs = d.v.clone().sub(this.groundVel(d.r, new V3())); acc.addScaledVector(vs, -0.5 * atm.rho * vs.length() * d.area / d.m); }
      d.v.addScaledVector(acc, dt); d.r.addScaledVector(d.v, dt);
      const wl = d.w.length(); if (wl > 1e-6) { tmpQ.setFromAxisAngle(tmpA.copy(d.w).divideScalar(wl), wl * dt); d.q.multiply(tmpQ); }
      d.ttl -= dt;
      const far = d.r.distanceTo(this.r) > 40000;
      if (alt < 1 || d.ttl < 0 || far) {
        if (alt < 1 && !far) this.explode(d.r.clone(), 8);
        this.scene.remove(d.g); this.debris.splice(i, 1);
      }
    }
  }
  railsAdvance(T, rotate) {
    const b = this.body;
    if (this.landed) {
      const qr = bodyRot(b, T);
      this.r.applyQuaternion(qr); this.q.premultiply(qr); this.groundVel(this.r, this.v); this.t += T; this.w.set(0, 0, 0); return;
    }
    let rem = T, steps = 0;
    const P = new V3();
    while (rem > 1e-9 && steps < 400) {
      const rm = this.r.length(), vm = Math.max(this.v.length(), 1), alt = rm - this.body.radius;
      let h = clamp(0.02 * rm / vm, 0.02, 3000);
      if (this.r.dot(this.v) < 0) h = Math.min(h, Math.max(0.02, 0.3 * alt / vm));
      for (const m of this.body.children) { moonState(m, this.t, P); const dd = P.distanceTo(this.r); h = Math.min(h, Math.max(0.5, 0.05 * (dd - m.soi * 0.9) / vm)); }
      if (this.body.parent) h = Math.min(h, Math.max(0.5, 0.2 * (this.body.soi - rm) / vm));
      h = Math.min(h, rem);
      propagate(this.r, this.v, h, this.body.mu, this.r, this.v);
      if (rotate) this.rotStep(h, null);
      this.t += h; rem -= h; steps++;
      const ob = this.body; this.checkSOI();
      const nalt = this.r.length() - this.body.radius;
      if (this.body.atm && nalt < this.body.atm.height) { if (this.warpIdx > 0) this.toast('Entering atmosphere: warp stopped'); this.warpIdx = 0; this.warpMode = 'phys'; break; }
      if (!this.body.atm && this.lowestAlt() < 30 && this.r.dot(this.v) < 0) { this.warpIdx = 0; this.warpMode = 'phys'; break; }
      if (ob !== this.body && this.warpIdx > 3) this.warpIdx = 3;
    }
    if (this.warpIdx > this.maxRailsIdx()) this.warpIdx = this.maxRailsIdx();
  }
  // advance simulation by real dt (seconds)
  advance(dtReal) {
    if (this.destroyed) { this.t += dtReal; return; }
    const k = this.keys;
    if (k.ShiftLeft || k.ShiftRight) this.setThrottle(this.throttle + dtReal * 0.7);
    if (k.ControlLeft || k.ControlRight) this.setThrottle(this.throttle - dtReal * 0.7);
    const railsOK = this.canRails();
    if (this.warpMode === 'rails' && this.warpIdx > 0 && !railsOK) { this.warpIdx = 0; this.toast('Warp stopped'); }
    if (this.warpMode === 'phys' && this.warpIdx > 0 && railsOK && !this.landed) { /* allow phys warp in space too */ }
    const W = this.warpFactor();
    if (this.warpMode === 'rails' && W > 1) { this.railsAdvance(dtReal * W, false); this._lastBurn = null; }
    else if (railsOK && !this.contact && !this.landed) { this.railsAdvance(dtReal * (this.warpMode === 'phys' ? W : 1), true); this._lastBurn = null; this.acc = 0; }
    else {
      this.acc += dtReal * (this.warpMode === 'phys' ? W : 1);
      let n = 0;
      while (this.acc >= DT && n < 16 && !this.destroyed) { this.step(DT); this.stepDebris(DT); this.acc -= DT; n++; }
      if (n >= 16) this.acc = 0;
    }
    if (this.debris.length && this.warpFactor() > 4) { for (const d of this.debris) this.scene.remove(d.g); this.debris = []; }
    // bookkeeping
    const alt = this.r.length() - this.body.radius;
    if (this.body === HOME) this.stats.maxAlt = Math.max(this.stats.maxAlt, alt);
    this.stats.maxSpeed = Math.max(this.stats.maxSpeed, this.v.length());
    this.predTimer -= dtReal;
    if (this.predTimer <= 0) { this.updatePrediction(false); this.predTimer = this._lastBurn && this._lastBurn.F > 0 ? 0.15 : (this.warpFactor() > 1 ? 0.12 : 0.5); }
  }

  // ---------------- per-frame visuals ----------------
  update(dt) {
    this.advance(dt);
    this.updateVisuals(dt);
    this.hudTimer = (this.hudTimer || 0) - dt;
    if (this.hudTimer <= 0) { this.updateHUD(); this.hudTimer = 0.1; }
  }
  updateVisuals(dt) {
    const t = this.t, vg = bodyGlobalPos(this.body, t, new V3()).add(this.r);
    const bp = new V3();
    for (const v of this.views) {
      bodyGlobalPos(v.body, t, bp); v.group.position.copy(bp).sub(vg); bodyRot(v.body, t, v.group.quaternion);
      if (v.atmo) v.atmo.material.uniforms.sunDir.value.copy(SUN_DIR);
      if (v.body === this.body) {
        const alt = this.r.length() - v.body.radius;
        const dirFixed = this.r.clone().normalize().applyQuaternion(bodyRot(v.body, t).invert());
        v.updatePatch(dirFixed, alt);
      } else if (v.patch) v.patch.visible = false;
    }
    this.root.quaternion.copy(this.q);
    // aircraft moving parts
    for (const s of this.surfs) { const m = this.meshes.get(s.uid); if (m && m.userData.flap) m.userData.flap.rotation.x = s.delta; }
    for (const g of this.gears) { const m = this.meshes.get(g.uid); if (!m || !m.userData.strut) continue; m.userData.strut.rotation.z = (1 - this.gearFrac) * 1.5; if (m.userData.wheel) m.userData.wheel.rotation.x = g.steerAng || 0; }
    // plumes
    const atm = atmosphere(this.body, this.r.length() - this.body.radius);
    const firing = new Set(this._lastBurn ? this._lastBurn.firing : (this.thrusting() ? this.prop.burn(this.throttle, atm.p, 0).firing : []));
    for (const [u, pl] of this.plumes) {
      const on = firing.has(u) && !this.destroyed; pl.visible = on;
      if (on) { const p = this.prop.by.get(u); const thr = p.def.srb ? 1 : this.throttle;
        const airM = p.def.air && this.prop.lastModes && this.prop.lastModes[u] === 'air'; pl.material.color.setHex(airM ? 0xbfe0ff : 0xff9a3c);
        if (airM) { const sp = this.prop.spool.get(u) || 0; const L = (0.5 + 1.3 * sp) * p.def.r * 2; pl.scale.set(pl.userData.r * 0.7, L, pl.userData.r * 0.7); pl.material.opacity = 0.05 + 0.12 * sp; continue; } const L = (1.5 + 5 * thr) * p.def.r * 2 * (1 + 1.8 * (1 - atm.p)); const rr = pl.userData.r * (1 + 1.5 * (1 - atm.p)); pl.scale.set(rr, L * (0.92 + Math.random() * 0.16), rr); pl.material.opacity = 0.25 + 0.3 * thr; }
    }
    // canopies
    const vs = this.v.clone().sub(this.groundVel(this.r, new V3()));
    const vdl = vs.lengthSq() > 0.01 ? vs.normalize().applyQuaternion(this.q.clone().invert()) : new V3(0, -1, 0);
    for (const [u, c] of this.canopies) {
      const cs = this.chuteState.get(u); const p = this.prop.by.get(u);
      const on = this.prop.alive.has(u) && cs.frac > 0.005; c.visible = on;
      if (on) { const rad = Math.max(0.6, Math.sqrt(cs.frac * 560 / Math.PI) * 0.42); c.scale.set(rad, rad * 0.8, rad);
        const dir = vdl.clone().negate(); c.position.set(p.pos.x, p.top, p.pos.z).addScaledVector(dir, rad * 1.6); c.quaternion.setFromUnitVectors(Y, dir); }
    }
    // debris
    for (const d of this.debris) { d.g.position.copy(d.r).sub(this.r); d.g.quaternion.copy(d.q); }
    // effects
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i]; e.t += dt; const k = e.t / 2.2;
      bodyGlobalPos(e.body, t, bp); e.g.position.copy(bp).add(e.pos).sub(vg);
      e.m1.scale.setScalar(e.size * (0.3 + 1.8 * Math.sqrt(k))); e.m1.material.opacity = Math.max(0, 1 - k);
      e.m2.scale.setScalar(e.size * (0.4 + 2.4 * k)); e.m2.material.opacity = Math.max(0, 0.7 - k * 0.7);
      if (k >= 1) { this.scene.remove(e.g); this.effects.splice(i, 1); }
    }
    // sky
    const f = this.frame();
    const sunUp = f.up.dot(SUN_DIR);
    const day = clamp(sunUp * 3 + 0.35, 0, 1);
    const skyAmt = this.body.atm ? clamp(Math.pow(atm.p, 0.45), 0, 1) : 0;
    const sky = new THREE.Color(0x63a7ee).multiplyScalar(day * skyAmt).lerp(new THREE.Color(0xf09060), skyAmt * clamp(1 - Math.abs(sunUp) * 6, 0, 1) * 0.35 * (day > 0.05 ? 1 : 0));
    this.app.renderer.setClearColor(this.map ? 0x02030a : sky);
    this.stars.material.opacity = this.map ? 1 : clamp(1 - skyAmt * day * 1.6, 0, 1);
    this.amb.intensity = 0.3 + 0.2 * skyAmt * day;
    this.hemi.intensity = 1.1 * skyAmt * day; this.hemi.position.copy(f.up);
    this.sun.position.copy(SUN_DIR).multiplyScalar(1000); this.sun.target.position.set(0, 0, 0);
    // camera
    const cam = this.camera, cs = this.camState;
    this.root.visible = !this.destroyed;
    for (const l of this.lines) l.visible = false; for (const l of this.nodeLines) l.visible = false;
    for (const l of this.moonLines) l.visible = this.map;
    if (!this.map) {
      let yaw = cs.yaw;
      if (this.isPlane) { const nz = Y.clone().applyQuaternion(this.q); const ne = nz.dot(f.east), nn = nz.dot(f.north); if (ne * ne + nn * nn > 0.01) { const h = Math.atan2(ne, nn); this._camH = this._camH === undefined ? h : this._camH + Math.atan2(Math.sin(h - this._camH), Math.cos(h - this._camH)) * Math.min(1, dt * 2.5); } yaw = cs.yaw + (this._camH || 0); }
      const off = f.east.clone().multiplyScalar(Math.cos(cs.pitch) * Math.sin(yaw)).addScaledVector(f.north, Math.cos(cs.pitch) * Math.cos(yaw)).addScaledVector(f.up, Math.sin(cs.pitch));
      cam.position.copy(off.multiplyScalar(cs.dist)); cam.up.copy(f.up); cam.lookAt(0, 0, 0);
      cam.near = 0.3; cam.far = 1e10;
      // keep camera above ground
      const camAlt = cam.position.clone().add(this.r).length() - this.body.radius;
      if (camAlt < 2) { cam.position.addScaledVector(f.up, 2 - camAlt); cam.lookAt(0, 0, 0); }
    } else {
      const fb = this.mapFocus && this.mapFocus !== 'vessel' ? this.mapFocus : null;
      const target = fb ? bodyGlobalPos(fb, t, new V3()).sub(vg) : new V3();
      const off = new V3(Math.cos(cs.mapPitch) * Math.sin(cs.mapYaw), Math.sin(cs.mapPitch), Math.cos(cs.mapPitch) * Math.cos(cs.mapYaw)).multiplyScalar(cs.mapDist);
      cam.position.copy(target).add(off); cam.up.set(0, 1, 0); cam.lookAt(target);
      cam.near = Math.max(1, cs.mapDist * 0.0005); cam.far = 1e10;
      this.drawPatches(this.patches, this.lines, vg);
      this.drawPatches(this.nodePatches, this.nodeLines, vg);
      for (const l of this.moonLines) { const b = l.userData.body; bodyGlobalPos(b.parent, t, bp); l.position.copy(bp).sub(vg); }
    }
    // shift the picture up so the vessel sits above the navball cluster
    if (!this.map) cam.setViewOffset(this.app.W, this.app.H, 0, this.app.H * (this.app.W > this.app.H ? 0.14 : 0.06), this.app.W, this.app.H); else cam.clearViewOffset();
    cam.updateProjectionMatrix();
    this.stars.position.copy(cam.position);
    this.sunSprite.position.copy(cam.position).addScaledVector(SUN_DIR, 1e9);
    this.updateLabels(vg);
  }
  drawPatches(patches, lines, vg) {
    const bp = new V3();
    patches.forEach((p, i) => {
      if (i >= lines.length) return;
      const l = lines[i], pos = l.geometry.attributes.position, n = Math.min(p.pts.length, pos.count);
      for (let k = 0; k < n; k++) pos.setXYZ(k, p.pts[k].x, p.pts[k].y, p.pts[k].z);
      pos.needsUpdate = true; l.geometry.setDrawRange(0, n);
      bodyGlobalPos(p.body, this.t, bp); l.position.copy(bp).sub(vg); l.visible = true;
    });
  }
  label(i, x, y, text, cls) {
    let d = this.labelPool[i]; if (!d) { d = this.labelPool[i] = el('div', 'mlabel', '', this.labels); }
    d.style.display = ''; d.className = 'mlabel ' + (cls || ''); d.textContent = text; d.style.transform = `translate(${x}px,${y}px)`;
  }
  updateLabels(vg) {
    let i = 0;
    if (this.map) {
      const W = this.app.W, H = this.app.H, cam = this.camera, p = new V3(), bp = new V3();
      const proj = (v) => { p.copy(v).project(cam); if (p.z > 1 || p.z < -1) return null; return [(p.x + 1) / 2 * W, (1 - p.y) / 2 * H]; };
      const put = (v, txt, cls) => { const s = proj(v); if (s && s[0] > -50 && s[0] < W + 50 && s[1] > -20 && s[1] < H + 20) this.label(i++, s[0], s[1], txt, cls); };
      put(new V3(), '▲ ' + (this.craft.name || 'Vessel'), 'ship');
      for (const b of BODIES) { bodyGlobalPos(b, this.t, bp).sub(vg); put(bp, b.name, 'body'); }
      const show = (patches, tag) => {
        patches.forEach((pt, k) => {
          const e = pt.el; const base = bodyGlobalPos(pt.body, this.t, new V3()).sub(vg);
          const at = (dtt) => { const rr = new V3(); propagate(pt.r0, pt.v0, dtt, pt.body.mu, rr, new V3()); return rr.add(base); };
          const tNow = Math.max(this.t, pt.t0);
          const st = new V3(), sv = new V3(); propagate(pt.r0, pt.v0, tNow - pt.t0, pt.body.mu, st, sv);
          const e2 = elements(st, sv, pt.body.mu);
          if (isFinite(e2.tPe) && e2.tPe > 0 && tNow + e2.tPe <= pt.t1 + (pt.end === 'closed' ? 1e9 : 0)) put(at(tNow - pt.t0 + e2.tPe), tag + 'Pe ' + fmtDist(e2.rp - pt.body.radius), 'pe');
          if (e2.ecc < 1 && isFinite(e2.tAp) && (pt.end === 'closed' || tNow + e2.tAp <= pt.t1)) put(at(tNow - pt.t0 + e2.tAp), tag + 'Ap ' + fmtDist(e2.ra - pt.body.radius), 'ap');
          if (pt.end === 'encounter') put(pt.pts[pt.pts.length - 1].clone().add(base), tag + '→ ' + pt.next.name + ' encounter', 'enc');
          if (pt.end === 'escape') put(pt.pts[pt.pts.length - 1].clone().add(base), tag + 'Escape ' + pt.body.name, 'enc');
          if (pt.end === 'impact') put(pt.pts[pt.pts.length - 1].clone().add(base), tag + '✖ Impact', 'imp');
        });
      };
      show(this.patches, '');
      if (this.node && this.node.base) {
        const nb = bodyGlobalPos(this.node.base.body, this.t, new V3()).sub(vg).add(this.node.base.r);
        put(nb, '◆ Node', 'node');
        show(this.nodePatches.slice(0, 2), '◆ ');
      }
    }
    for (; i < this.labelPool.length; i++) this.labelPool[i].style.display = 'none';
  }
  updateHUD() {
    const b = this.body, r = this.r, v = this.v, rm = r.length(), alt = rm - b.radius;
    const f = this.frame();
    const vgr = this.groundVel(r, new V3()), vs = v.clone().sub(vgr);
    this.navFrame = this.navMode === 'auto' ? (alt < (b.atm ? 36000 : 8000) ? 'surface' : 'orbit') : this.navMode;
    const spd = this.navFrame === 'surface' ? vs.length() : v.length();
    const vvert = v.dot(f.up);
    const el0 = elements(r, v, b.mu);
    const situ = this.destroyed ? 'Destroyed' : this.landed ? 'Landed' : this.contact ? 'On ground' : (b.atm && alt < b.atm.height) ? 'Flying' : el0.rp < b.radius ? 'Sub-orbital' : (el0.ecc >= 1 || el0.ra > (b.soi || Infinity)) ? 'Escaping' : 'Orbiting';
    const radar = this.lowestAlt();
    const grounded = this.landed || this.contact;
    const ap = grounded ? NaN : el0.ecc < 1 ? el0.ra - b.radius : Infinity, pe = grounded ? NaN : el0.rp - b.radius;
    const apS = isNaN(ap) ? '—' : isFinite(ap) ? fmtDist(ap) : '∞', peS = isNaN(pe) ? '—' : fmtDist(pe);
    const showRadar = situ === 'Flying' || situ === 'Landed' || situ === 'On ground' || radar < 3000;
    this.hudMain.innerHTML = `<span class="alt">${fmtDist(showRadar && radar < 3000 ? Math.max(0, radar) : alt)}</span><span class="lab">${showRadar && radar < 3000 ? 'RADAR' : 'ALT'}</span>` +
      (this.app.W < 520 && !this.hudOpen ? '' : `<span class="sep"></span><span class="lab">Ap</span><b>${apS}</b><span class="lab">Pe</span><b>${peS}</b>`) + `<i class="chev">${this.hudOpen ? '▴' : '▾'}</i>`;
    if (this.hudOpen) {
      if ((this._dvT = (this._dvT || 0) - 1) <= 0) { this._dvCache = dvRemaining(this.prop).toFixed(0); this._dvT = 8; }
      this.hudDet.innerHTML = `<div><b>${b.name}</b> · ${situ}</div>
        <div>Ap <b>${apS}</b> ${!grounded && el0.ecc < 1 && isFinite(el0.tAp) ? 'in ' + fmtTime(el0.tAp) : ''} · Pe <b>${peS}</b> ${!grounded && isFinite(el0.tPe) && el0.tPe > 0 ? 'in ' + fmtTime(el0.tPe) : ''}</div>
        <div>ALT ${fmtDist(alt)} · V/S ${vvert.toFixed(1)} m/s${this.isPlane ? ` · Mach ${(vs.length() / 340).toFixed(2)}${this.aoa !== undefined && this.q_dyn > 50 ? ' · AoA ' + this.aoa.toFixed(1) + '°' : ''}` : ''}</div>
        <div>MET ${fmtTime(this.t - this.t0)} · Δv ${this._dvCache} m/s · ${(this.mass / 1000).toFixed(2)} t</div>
        ${this.isPlane ? `<div>${this.engineInfo()}</div>` : ''}`;
    }
    this.speedEl.innerHTML = `<small>${this.navFrame === 'surface' ? 'SURFACE' : 'ORBIT'}${this.navMode !== 'auto' ? '•' : ''}</small><b>${spd.toFixed(1)}</b><small>m/s</small>`;
    this.thFill.style.height = (this.throttle * 100) + '%'; this.thKnob.style.bottom = `calc(${this.throttle * 100}% - 8px)`;
    this.thLab.textContent = (this.throttle * 100).toFixed(0) + '%';
    this.warpEl.textContent = this.warpFactor() + '×' + (this.warpMode === 'phys' && this.warpIdx > 0 ? 'ᵖ' : '');
    this.sasBtn.classList.toggle('on', this.sas);
    this.sasModeBtn.textContent = this.modeGlyph[this.sasMode] || '◎';
    this.sasModeBtn.classList.toggle('on', this.sas && this.sasMode !== 'stab');
    for (const k in this.sasBtns) this.sasBtns[k].classList.toggle('on', this.sas && this.sasMode === k);
    if (this.gears.length) { this.gearBtn.classList.toggle('on', this.gearDown); this.gearBtn.textContent = this.gearDown ? 'GEAR▼' : 'GEAR▲'; this.brkBtn.classList.toggle('on', this.brakes); }
    this.recoverBtn.classList.toggle('hidden', !(this.landed && b === HOME && !this.destroyed && !this.ended && (this.prop.next > 0 || this.stats.maxAlt > 30)));
    // node HUD
    if (this.node && this.node.t < this.t - 30) { const rr = this.nodeRemaining(); if (!rr || rr.length() < 3 || this.node.applied.lengthSq() === 0 || this.node.t < this.t - 600) { this.node = null; this.nodePatches = []; } }
    const rem = this.nodeRemaining();
    if (this.node && rem) {
      const dv = rem.length() * Math.sign(rem.dot(this.node.dvWorld) || 1);
      const B = this.prop.burn(1, 0, 0); let bt = Infinity;
      if (B.F > 0) { const ve = B.F / B.mdot; bt = this.mass * (1 - Math.exp(-Math.abs(dv) / ve)) / B.mdot; }
      const tt = this.node.t - this.t;
      this.nodeHud.classList.remove('hidden');
      this.nodeHud.innerHTML = `◆ Node ${this.map ? (this.nodePanelHidden ? '▸ ' : '▾ ') : ''}<b>T${tt >= 0 ? '−' : '+'}${fmtTime(Math.abs(tt))}</b> · Δv <b>${dv.toFixed(1)}</b> m/s · burn ${isFinite(bt) ? fmtTime(bt) : 'no thrust'}${isFinite(bt) && tt > 0 && tt < bt / 2 + 10 ? ' · <b class="warn">START BURN</b>' : ''}`;
      if (this.nodeVals) { this.nodeVals.pro.textContent = this.node.pro.toFixed(0); this.nodeVals.norm.textContent = this.node.norm.toFixed(0); this.nodeVals.rad.textContent = this.node.rad.toFixed(0); }
      const np = this.nodePatches; let info = '';
      if (np.length) { const e = np[0].el; info += `After burn: Ap ${e.ecc < 1 && np[0].end === 'closed' ? fmtDist(e.ra - np[0].body.radius) : '∞'} · Pe ${fmtDist(e.rp - np[0].body.radius)}`; }
      const enc = np.find((p, i) => i > 0 && p.body !== this.body);
      if (enc) info += `<br>→ ${enc.body.name}: Pe ${fmtDist(enc.el.rp - enc.body.radius)}${enc.end === 'impact' ? ' (impact!)' : ''}`;
      this.nodeInfo.innerHTML = info;
      this.nodePanel.classList.toggle('hidden', !this.map || !!this.nodePanelHidden);
    } else { this.nodeHud.classList.add('hidden'); this.nodePanel.classList.add('hidden'); }
    // navball
    const d = this.dirs(this.navFrame);
    const nb = this.navball.update(this.q, f, d);
    this.navTxt.textContent = `${nb.hdg.toFixed(0).padStart(3, '0')}° · ${nb.pitch >= 0 ? '+' : ''}${nb.pitch.toFixed(0)}°`;
  }
  engineInfo() {
    const out = [];
    for (const u of this.prop.active) { const d = this.prop.by.get(u).def; if (!d.air) continue; const m = this.prop.lastModes && this.prop.lastModes[u]; out.push(`${d.name}: ${m === 'rocket' ? 'ROCKET' : 'AIR'} ${Math.round((this.prop.spool.get(u) || 0) * 100)}%`); }
    return out.length ? out.join(' · ') : 'No jet running';
  }
  render(renderer) {
    renderer.render(this.scene, this.camera);
    if (!this.map || true) { renderer.autoClear = false; this.navball.render(renderer, this.navEl.getBoundingClientRect(), this.app.H); renderer.autoClear = true; renderer.setViewport(0, 0, this.app.W, this.app.H); }
  }
  resize(w, h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }

  // ---------------- input from app ----------------
  onKey(e, down) {
    this.keys[e.code] = down;
    if (!down) { if (e.code === 'KeyB' && !this._brkLatch) this.brakes = false; return; }
    switch (e.code) {
      case 'Space': this.doStage(); e.preventDefault(); break;
      case 'KeyT': this.toggleSAS(); break;
      case 'KeyG': if (this.gears.length) this.toggleGear(); break;
      case 'KeyB': this.brakes = true; break;
      case 'KeyM': this.toggleMap(); break;
      case 'Period': this.warp(1); break;
      case 'Comma': this.warp(-1); break;
      case 'KeyZ': this.setThrottle(1); break;
      case 'KeyX': this.setThrottle(0); break;
      case 'Escape': this.menu(); break;
    }
  }
  onDrag(dx, dy) {
    const cs = this.camState;
    if (this.map) { cs.mapYaw -= dx * 0.006; cs.mapPitch = clamp(cs.mapPitch + dy * 0.006, -1.5, 1.5); }
    else { cs.yaw -= dx * 0.006; cs.pitch = clamp(cs.pitch + dy * 0.006, -1.45, 1.45); }
  }
  onZoom(f) {
    const cs = this.camState;
    if (this.map) cs.mapDist = clamp(cs.mapDist * f, 3000, 3e8);
    else cs.dist = clamp(cs.dist * f, 4, 3000);
  }
  onTap(x, y) {
    if (!this.map || !this.patches.length) return;
    // place a node on the closest trajectory point near the tap
    const cam = this.camera, vg = bodyGlobalPos(this.body, this.t, new V3()).add(this.r), p = new V3();
    let best = null, bd = 30 * 30;
    this.patches.slice(0, 2).forEach(pt => {
      const base = bodyGlobalPos(pt.body, this.t, new V3()).sub(vg);
      for (let k = 0; k < pt.pts.length; k++) {
        p.copy(pt.pts[k]).add(base).project(cam); if (p.z > 1) continue;
        const sx = (p.x + 1) / 2 * this.app.W, sy = (1 - p.y) / 2 * this.app.H; const d2 = (sx - x) ** 2 + (sy - y) ** 2;
        if (d2 < bd && pt.t0 + pt.times[k] > this.t + 2) { bd = d2; best = pt.t0 + pt.times[k]; }
      }
    });
    if (best !== null) {
      if (!this.node) this.node = { t: best, pro: 0, norm: 0, rad: 0, applied: new V3() }; else { this.node.t = best; this.node.applied.set(0, 0, 0); }
      this.updatePrediction(true); this.toast('Maneuver node placed', 1200);
    }
  }

  // ---------------- debug / test hooks ----------------
  makeDebug() {
    const F = this;
    return {
      status() {
        const b = F.body, el0 = elements(F.r, F.v, b.mu);
        return { body: b.name, t: F.t, alt: F.r.length() - b.radius, ap: el0.ecc < 1 ? el0.ra - b.radius : Infinity, pe: el0.rp - b.radius, ecc: el0.ecc,
          speed: F.v.length(), landed: F.landed, contact: F.contact, destroyed: F.destroyed, nextStage: F.prop.next, stages: F.events.length, mass: F.mass, throttle: F.throttle,
          tAp: el0.tAp, patches: F.patches.map(p => ({ body: p.body.name, end: p.end, pe: p.el.rp - p.body.radius })),
          nodePatches: F.nodePatches.map(p => ({ body: p.body.name, end: p.end, pe: p.el.rp - p.body.radius })), node: F.node ? { t: F.node.t, rem: F.nodeRemaining() ? F.nodeRemaining().length() : null } : null };
      },
      point(pitch, hdg) { F.sas = true; F.sasMode = 'custom'; F.customDir = { pitch, hdg }; },
      sas(mode) { F.setSAS(mode); },
      throttle(x) { F.setThrottle(x); },
      stage() { F.doStage(); },
      simulate(sec) { const n = Math.round(sec / DT); for (let i = 0; i < n && !F.destroyed; i++) F.advance(DT); return this.status(); },
      warpTo(tAbs) { // fast rails warp in one call
        let guard = 0; while (F.t < tAbs && guard++ < 200000 && !F.destroyed) { const W = Math.min(100000, Math.max(1, (tAbs - F.t) / 2)); if (F.canRails()) F.railsAdvance(Math.min(tAbs - F.t, W * 0.05), false); else F.advance(Math.min(DT, tAbs - F.t)); }
        F.updatePrediction(true); return this.status();
      },
      node(t, pro, norm, rad) { F.node = { t, pro, norm, rad, applied: new V3() }; F.updatePrediction(true); return this.status(); },
      setOrbit(name, alt, ang = 0) {
        const b = BODIES.find(x => x.name === name); const rr = b.radius + alt, vc = Math.sqrt(b.mu / rr);
        F.body = b; F.r.set(rr * Math.cos(ang), 0, -rr * Math.sin(ang)); F.v.set(-vc * Math.sin(ang), 0, -vc * Math.cos(ang));
        F.landed = false; F.contact = false; F.warpIdx = 0; F.updatePrediction(true); return this.status();
      },
      F,
    };
  }
}
