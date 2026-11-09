// Orbit Forge - flight simulation, map view, maneuver nodes, HUD
import * as THREE from './vendor/three.module.min.js';
import { PARTS, makePartMesh, makePlume, makeCanopy } from './parts.js';
import { layout, buildEvents, Propulsion, eventLabel, dvRemaining } from './craft.js';
import { BODIES, HOME, G0, propagate, elements, predict, moonState, bodyGlobalPos, atmosphere, horizonFrame, fmtDist, fmtTime, clamp } from './orbit.js';
import { BodyView, makeStars, makeSun, SUN_DIR } from './world.js';
import { Navball } from './navball.js';
import { CTRL, saveCtrl, shapeStick, easeKey, TILT, enableTilt, disableTilt, recenterTilt } from './control.js';
import { Autopilot } from './autopilot.js';
import { maxTemp } from './parts.js';
import { AUDIO } from './audio.js';
import { MODS } from './mods.js';
const V3 = THREE.Vector3, Q = THREE.Quaternion;
const DT = 0.02;
const RAILS = [1, 5, 10, 50, 100, 1000, 10000, 100000];
const PHYS = [1, 2, 3, 4];
const CRASH_SPEED = 11, LEG_CRASH = 14;
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
    this.throttle = 0; this.sas = false; this.sasMode = 'stab'; this.holdQ = this.holdPB = null;
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
    this.plasma = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), new THREE.MeshBasicMaterial({ color: 0xff7a30, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.plasma.visible = false; this.root.add(this.plasma);
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
    this.site = craft.site || (craft.kind === 'plane' ? 'runway' : 'pad');
    this.padMode = this.site === 'pad' && this.gears.length > 0;
    this.wingArea = this.surfs.filter(p => Math.abs(p.n.z) > 0.5).reduce((a, p) => a + p.def.surf.area, 0);
    this.winged = this.wingArea > 3;
    this.gearDown = !this.padMode; this.gearFrac = this.gearDown ? 1 : 0; this.brakes = false; this.steer = 0; this.dragChute = false;
    this.ctrlAuth = [0, 0, 0];
    this.legs = this.inst.filter(p => p.def.leg); this.legsDown = false; this.legFrac = 0;
    this.rcsBlocks = this.inst.filter(p => p.def.rcs); this.rcsOn = false; this.trnMode = false; this.trn = [0, 0, 0];
    this.mono = new Map(this.inst.filter(p => p.def.mono).map(p => [p.uid, p.def.mono]));
    this.bays = this.inst.filter(p => p.def.bay); this.bayOpen = false; this.bayFrac = 0;
    this.temps = new Map(this.inst.map(p => [p.uid, 290])); this.heatFlux = 0; this.heatMax = 0;
    this.fine = false; this.holdQ = this.holdPB = null; this.integ = [0, 0, 0]; this.keyRamp = [0, 0, 0]; this._pilotT = -99;
    if (!this.ap) this.ap = new Autopilot(this); this.ap.off(true);
    for (const p of this.rcsBlocks) { const m = this.meshes.get(p.uid); const pf = new THREE.Mesh(this.puffGeo || (this.puffGeo = new THREE.SphereGeometry(0.18, 6, 4)), this.puffMat || (this.puffMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false }))); pf.visible = false; pf.position.set(0.32, 0, 0); m.add(pf); p.puff = pf; }
    this.ui.classList.toggle('plane', this.isPlane);
    this.ui.classList.toggle('haslegs', this.legs.length > 0); this.ui.classList.toggle('hasrcs', this.rcsBlocks.length > 0); this.ui.classList.toggle('hasbay', this.bays.length > 0);
    this.com = new V3(); this.recomputeShape(true);
    const R = HOME.radius, qr = bodyRot(HOME, this.t);
    if (this.site === 'runway') {
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
    this.buildPopovers();
    this.toast(this.site === 'runway' ? 'On the runway. STAGE starts the engine, throttle up, pull the stick down (S) at ~70 m/s.' : this.winged ? 'On the pad. Tap ◎ → ASCENT for an automatic climb to orbit, or throttle up and STAGE.' : 'On the pad. Throttle up and press STAGE (Space). ◎ → ASCENT flies a gravity turn for you.', 5000);
    AUDIO.reset(); MODS.emit('flightStart', this);
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
    this.rcsTorque = 0; this.rcsF = 0;
    for (const p of this.inst) if (alive.has(p.uid) && p.def.rcs) { this.rcsF += p.def.rcs * 1000; this.rcsTorque += p.def.rcs * 1000 * Math.max(0.6, Math.hypot(p.com.y - c.y, p.attachR || 0.6)) * 1.5; }
    this.hasControl = this.torque > 0;
    for (const [u, pl] of this.plumes) if (!alive.has(u)) pl.visible = false;
  }

  // ---------------- UI ----------------
  buildUI() {
    const ui = this.ui = el('div', 'fui hidden', '', document.getElementById('ui'));
    const btn = this._btn = (parent, label, cls, fn, title) => { const b = el('button', cls, label, parent); if (title) b.title = title; b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); AUDIO.unlock(); fn(b); }); return b; };
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
    this.sasModeBtn = btn(sl, '◎', 'sb mode', () => this.togglePop(this.sasPop), 'SAS modes + autopilot');
    this.actBtn = btn(sl, '⋯', 'sb act', () => this.togglePop(this.actPop), 'Actions: RCS, legs, bay, quicksave, tilt, sound');
    this.gearBtn = btn(sr, 'GEAR', 'sb pl gear on', () => this.toggleGear(), 'G');
    this.brkBtn = btn(sr, 'BRK', 'sb pl brk', () => { this.brakes = !this.brakes; }, 'B (airbrake in flight)');
    this.sasPop = el('div', 'saspop panel hidden', '', bot);
    this.actPop = el('div', 'saspop actpop panel hidden', '', bot);
    const modes = this.sasModes = [['stab', '◎', 'Hold'], ['pro', '⊕', 'Prograde'], ['retro', '⊗', 'Retro'], ['norm', '▲', 'Normal'], ['anti', '▼', 'Anti-norm'], ['radOut', '⊙', 'Rad out'], ['radIn', '⦾', 'Rad in'], ['node', '◆', 'Node']];
    this.modeGlyph = Object.fromEntries(modes.map(m => [m[0], m[1]])); this.modeGlyph.custom = '✦';
    this.sasBtns = {};
    this.apChip = el('div', 'apchip panel hidden', '', ui);
    this.apChip.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); this.ap.off(); });
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
    this.joy = el('div', 'joy', '', left); this.knob = el('div', 'knob', '', this.joy); el('div', 'finebadge', 'FINE', this.joy); el('div', 'trnbadge', 'RCS MOVE', this.joy);
    this.joyV = { x: 0, y: 0 }; this.rollIn = 0;
    const joyMove = e => { const r = this.joy.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2, R = r.width / 2;
      let x = (e.clientX - cx) / R, y = (e.clientY - cy) / R; const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
      this.joyV.x = x; this.joyV.y = y; this.knob.style.transform = `translate(${x * R * 0.6}px,${y * R * 0.6}px)`; };
    this.joy.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); this.joy.setPointerCapture(e.pointerId); this._joy = true; joyMove(e); });
    this.joy.addEventListener('pointermove', e => { if (this._joy) joyMove(e); });
    const joyEnd = () => { this._joy = false; this.joyV.x = this.joyV.y = 0; this.knob.style.transform = ''; };
    this.joy.addEventListener('pointerup', joyEnd); this.joy.addEventListener('pointercancel', joyEnd);
    this.rollBtns = [];
    for (const [lab, val] of [['⟲', -1], ['⟳', 1]]) { const b = el('button', 'sb roll', lab, rr); this.rollBtns.push(b); b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); this.rollIn = val; }); const end = () => { this.rollIn = 0; }; b.addEventListener('pointerup', end); b.addEventListener('pointercancel', end); b.addEventListener('pointerleave', end); }
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
  toggleGear() { if (!this.gears.length && this.legs.length) return this.toggleLegs(); this.gearDown = !this.gearDown; this.toast(this.gearDown ? 'Gear down' : 'Gear up', 1000); AUDIO.click(); }
  togglePop(p) { const open = p.classList.contains('hidden'); this.sasPop.classList.add('hidden'); this.actPop.classList.add('hidden'); if (open) { p.classList.remove('hidden'); this.toastEl.classList.add('hidden'); clearTimeout(this._popT); this._popT = setTimeout(() => p.classList.add('hidden'), 9000); } }
  closePops() { this.sasPop.classList.add('hidden'); this.actPop.classList.add('hidden'); }
  // ◎ popover: SAS modes + autopilot + precision; ⋯ popover: craft actions
  buildPopovers() {
    const btn = this._btn, P = this.sasPop; P.innerHTML = '';
    this.sasBtns = {};
    for (const [k, lab, name] of this.sasModes) this.sasBtns[k] = btn(P, `${lab}<small>${name}</small>`, 'sb pm', () => { this.ap.off(); this.setSAS(k); this.closePops(); }, k);
    this.apBtns = {};
    if (this.winged) {
      for (const [k, lab, name] of [['hold', '✈', 'HDG+ALT'], ['reentry', '☄', 'Reentry'], ['land', '🛬', 'Land']]) this.apBtns[k] = btn(P, `${lab}<small>${name}</small>`, 'sb pm ap', () => { this.ap.toggle(k); this.closePops(); }, 'Autopilot: ' + name);
      if (!this.isPlane || this.site === 'pad') this.apBtns.ascent = btn(P, `🚀<small>Ascent</small>`, 'sb pm ap', () => { this.ap.toggle('ascent'); this.closePops(); }, 'Autopilot: gravity turn to orbit');
      else el('div', 'pm gap', '', P);
    } else {
      this.apBtns.ascent = btn(P, `🚀<small>Ascent AP</small>`, 'sb pm ap w2', () => { this.ap.toggle('ascent'); this.closePops(); }, 'Autopilot: gravity turn to orbit');
      btn(P, `−<small>10 km</small>`, 'sb pm', () => { this.ap.targetAlt = Math.max(72000, this.ap.targetAlt - 10000); this.buildPopovers(); this.sasPop.classList.remove('hidden'); });
      this.apAltBtn = btn(P, `+<small>${(this.ap.targetAlt / 1000).toFixed(0)} km</small>`, 'sb pm', () => { this.ap.targetAlt = Math.min(400000, this.ap.targetAlt + 10000); this.buildPopovers(); this.sasPop.classList.remove('hidden'); });
    }
    this.fineBtn = btn(P, `🎯<small>Fine</small>`, 'sb pm' + (this.fine ? ' on' : ''), () => { this.setFine(!this.fine); this.buildPopovers(); }, 'Precision controls (Caps Lock)');
    this.assistBtn = btn(P, `🛟<small>Assist</small>`, 'sb pm' + (CTRL.assist ? ' on' : ''), () => { CTRL.assist = !CTRL.assist; saveCtrl(); this.toast(CTRL.assist ? 'Steering assist ON: the craft stops turning when you let go' : 'Steering assist OFF: raw controls, it keeps spinning', 2500); this.buildPopovers(); }, 'Steering assist');
    btn(P, `⚙<small>Controls</small>`, 'sb pm w2', () => { this.closePops(); this.settings(); });
    // actions
    const A = this.actPop; A.innerHTML = '';
    if (this.rcsBlocks.length) { this.rcsBtn = btn(A, `💨<small>RCS</small>`, 'sb pm' + (this.rcsOn ? ' on' : ''), () => { this.toggleRCS(); this.buildPopovers(); this.actPop.classList.remove('hidden'); }, 'R');
      this.trnBtn = btn(A, `✥<small>Move</small>`, 'sb pm' + (this.trnMode ? ' on' : ''), () => { this.setTrn(!this.trnMode); this.toast(this.trnMode ? 'Joystick now translates with RCS (twist buttons = forward/back)' : 'Joystick steers again', 2200); this.buildPopovers(); }, 'Joystick translates (RCS)'); }
    if (this.legs.length) this.legBtn = btn(A, `🦵<small>Legs</small>`, 'sb pm' + (this.legsDown ? ' on' : ''), () => { this.toggleLegs(); this.buildPopovers(); this.actPop.classList.remove('hidden'); }, 'G');
    if (this.bays.length) this.bayBtn = btn(A, `📦<small>Bay</small>`, 'sb pm' + (this.bayOpen ? ' on' : ''), () => { this.toggleBay(); this.buildPopovers(); this.actPop.classList.remove('hidden'); }, 'Bay doors');
    if (this.gears.length) this.brkBtn2 = btn(A, `🛑<small>Brakes</small>`, 'sb pm' + (this.brakes ? ' on' : ''), () => { this.brakes = !this.brakes; this.buildPopovers(); this.actPop.classList.remove('hidden'); }, 'B');
    btn(A, `💾<small>Q.Save</small>`, 'sb pm', () => { this.quicksave(); this.closePops(); }, 'F5');
    btn(A, `⏏<small>Q.Load</small>`, 'sb pm', () => { this.quickload(); }, 'F9');
    btn(A, `📱<small>Tilt</small>`, 'sb pm' + (TILT.on ? ' on' : ''), async () => { if (TILT.on) { disableTilt(); this.toast('Tilt steering off'); } else { const err = await enableTilt(); this.toast(err || 'Tilt steering on: hold the phone how you like, that is centre', 2500); } this.buildPopovers(); }, 'Tilt to steer');
    btn(A, `${CTRL.sound ? '🔊' : '🔇'}<small>Sound</small>`, 'sb pm' + (CTRL.sound ? ' on' : ''), () => { CTRL.sound = !CTRL.sound; saveCtrl(); AUDIO.setOn(CTRL.sound); this.buildPopovers(); this.actPop.classList.remove('hidden'); });
    for (const b of MODS.buttons('flight')) btn(A, `${b.icon || '🧩'}<small>${b.label}</small>`, 'sb pm', () => { this.closePops(); MODS.safe(b.mod, () => b.onClick(MODS.api(b.mod).flight)); });
  }
  settings(after) {
    const html = `<div class="sets">
      <div class="srow2"><span>Stick sensitivity</span><button data-k="sens-">−</button><b id="s_sens">${CTRL.sens.toFixed(1)}×</b><button data-k="sens+">+</button></div>
      <div class="srow2"><span>Steering assist<small>stops the turn when you let go</small></span><button data-k="assist" class="${CTRL.assist ? 'on' : ''}">${CTRL.assist ? 'ON' : 'OFF'}</button></div>
      <div class="srow2"><span>Control feel<small>auto: planes pitch/roll, rockets pitch/yaw</small></span><button data-k="feel">${CTRL.feel.toUpperCase()}</button></div>
      <div class="srow2"><span>Tilt to steer<small>uses the phone's motion sensor</small></span><button data-k="tilt" class="${TILT.on ? 'on' : ''}">${TILT.on ? 'ON' : 'OFF'}</button><button data-k="recenter">Centre</button></div>
      <div class="srow2"><span>Sound effects</span><button data-k="sound" class="${CTRL.sound ? 'on' : ''}">${CTRL.sound ? 'ON' : 'OFF'}</button></div>
      <p class="small">Precision mode: Caps Lock or ◎ → Fine. Keys: W/S pitch · A/D yaw · Q/E roll · R RCS · H/N J/L I/K RCS translate · G gear/legs · F5/F9 quicksave/load.</p></div>`;
    this.app.dialog('Controls & sound', [['Done', () => { if (after) after(); }]], html);
    const d = document.getElementById('dialog');
    d.querySelectorAll('[data-k]').forEach(b => b.addEventListener('click', async e => {
      e.stopPropagation(); const k = b.dataset.k;
      if (k === 'sens-') CTRL.sens = Math.max(0.4, +(CTRL.sens - 0.1).toFixed(1)); if (k === 'sens+') CTRL.sens = Math.min(2, +(CTRL.sens + 0.1).toFixed(1));
      if (k === 'assist') CTRL.assist = !CTRL.assist;
      if (k === 'feel') { const o = ['auto', 'rocket', 'plane']; CTRL.feel = o[(o.indexOf(CTRL.feel) + 1) % 3]; }
      if (k === 'tilt') { if (TILT.on) disableTilt(); else { const err = await enableTilt(); if (err) this.toast(err, 3000); } }
      if (k === 'recenter') { recenterTilt(); this.toast('Tilt centred', 1000); }
      if (k === 'sound') { CTRL.sound = !CTRL.sound; AUDIO.setOn(CTRL.sound); }
      saveCtrl(); this.settings(after); if (this.ui && !this.ui.classList.contains('hidden')) this.buildPopovers();
    }));
  }
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
  toggleSAS() { if (this.ap.active) { this.ap.off(); this.sas = true; this.sasMode = 'stab'; this.holdQ = this.holdPB = null; return; } this.sas = !this.sas; this.holdQ = this.holdPB = null; if (this.sas && !this.hasControl) this.toast('No reaction wheel: SAS works through engine gimbal only'); }
  setSAS(k) {
    if (k === 'node' && !this.node) { this.toast('No maneuver node'); return; }
    this.sas = true; this.sasMode = k; this.holdQ = this.holdPB = null;
  }
  doStage() {
    if (this.destroyed) return;
    const res = this.prop.stage();
    if (!res) { this.toast('Nothing left to stage'); return; }
    AUDIO.stage(!!(res.e.ignite && res.e.ignite.length), res.removed.length > 0); MODS.emit('stage', this, res.e);
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
  translating() { if (!this.rcsOn || !this.rcsBlocks.length) return false; const k = this.keys; return !!(k.KeyH || k.KeyN || k.KeyJ || k.KeyL || k.KeyI || k.KeyK || (this.trnMode && this.joyV && (Math.abs(this.joyV.x) + Math.abs(this.joyV.y) + Math.abs(this.rollIn || 0) > 0.02))); }
  canRails() {
    if (this.destroyed) return false;
    if (this.landed) return !this.thrusting();
    const alt = this.r.length() - this.body.radius;
    return !this.thrusting() && !this.translating() && !this.contact && (!this.body.atm || alt > this.body.atm.height);
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

  // ---------------- legs, RCS, bay, heat ----------------
  legFoot(p, out) { const th = 2.95 - 2.35 * this.legFrac, L = p.def.leg.len; return out.copy(p.pos).addScaledVector(p.dir, 0.12 + L * Math.sin(th)).add(tmpC.set(0, -L * Math.cos(th), 0)); }
  toggleLegs() { if (!this.legs.length) return; this.legsDown = !this.legsDown; this.toast(this.legsDown ? 'Landing legs down' : 'Landing legs up', 1000); AUDIO.click(); }
  toggleBay() { if (!this.bays.length) { this.toast('No payload bay'); return; } this.bayOpen = !this.bayOpen; this.toast(this.bayOpen ? 'Bay doors opening (more drag, keep them shut for reentry)' : 'Bay doors closing', 1800); AUDIO.click(); }
  toggleRCS() { if (!this.rcsBlocks.length) { this.toast('No RCS thrusters on this craft'); return; } this.rcsOn = !this.rcsOn; if (!this.rcsOn) this.setTrn(false); this.toast(this.rcsOn ? 'RCS on' : 'RCS off', 1000); AUDIO.click(); }
  setTrn(on) { this.trnMode = on && this.rcsBlocks.length > 0; if (this.trnMode && !this.rcsOn) this.rcsOn = true; this.ui.classList.toggle('trn', this.trnMode); if (on && !this.rcsBlocks.length) this.toast('Translation needs RCS thrusters'); }
  setFine(on) { this.fine = on; this.ui.classList.toggle('fine', on); this.toast(on ? 'Precision controls ON (Caps Lock)' : 'Precision controls off', 1200); }
  get monoLeft() { let m = 0; for (const [u, v] of this.mono) if (this.prop.alive.has(u)) m += v; return m; }
  rcsStep(dt, u, acc) {
    this._rcsFire = 0;
    if (!this.rcsOn || !this.rcsBlocks.length) return;
    const k = this.keys, mono = this.monoLeft; if (mono <= 1e-6) return;
    // translation: H/N fore-aft, J/L left-right, I/K up-down (or the stick in TRN mode)
    const t = [(k.KeyL ? 1 : 0) - (k.KeyJ ? 1 : 0), (k.KeyH ? 1 : 0) - (k.KeyN ? 1 : 0), (k.KeyI ? 1 : 0) - (k.KeyK ? 1 : 0)];
    if (this.trnMode) { t[0] += this.joyV.x; t[2] += -this.joyV.y; t[1] += this.rollIn; }
    for (let i = 0; i < 3; i++) t[i] = clamp(t[i], -1, 1) * (this.fine ? 0.3 : 1);
    this.trn = t;
    const F = this.rcsF;
    const lt = new V3(-t[0], t[1], -t[2]).multiplyScalar(F / this.mass).applyQuaternion(this.q);
    acc.add(lt);
    const rot = this.torque > 0 ? 0.35 : 1; // reaction wheels take most of the turning work
    const use = (Math.abs(t[0]) + Math.abs(t[1]) + Math.abs(t[2]) + rot * (Math.abs(u[0]) + Math.abs(u[1]) + Math.abs(u[2])) * 0.5) * F / (240 * G0) / 1000 * dt;
    this._rcsFire = use / dt;
    let need = use; for (const [uid, v] of this.mono) { if (need <= 0) break; if (!this.prop.alive.has(uid) || v <= 0) continue; const d = Math.min(v, need); this.mono.set(uid, v - d); need -= d; }
  }
  heatStep(dt, atm, vs, vsm) {
    const rho = atm.rho;
    const q = rho > 0 && vsm > 200 ? 4.4e-4 * Math.sqrt(rho) * vsm * vsm * vsm : 0; // convective flux, W/m^2 (game-scaled)
    this.heatFlux = q;
    const Tamb = rho > 0 ? 220 + 70 * atm.p : 140, alive = this.prop.alive;
    const uL = vsm > 1 ? vs.clone().divideScalar(vsm).applyQuaternion(tmpQ.copy(this.q).invert()) : null;
    this._heatDir = uL;
    let pmax = -Infinity, smax = -Infinity;
    if (uL) for (const p of this.inst) { if (!alive.has(p.uid)) continue; const pr = tmpA.copy(p.com).sub(this.com).dot(uL) + (p.kind === 'stack' ? Math.abs(uL.y) * p.def.h * 0.5 : 0); p._proj = pr; pmax = Math.max(pmax, pr); if (p.def.shield) smax = Math.max(smax, pr); }
    this._heatFront = pmax;
    let hot = 0, hotP = null;
    const len = this.bounds.len, sb = 5.67e-8 * 0.8;
    for (const p of this.inst) {
      if (!alive.has(p.uid)) continue;
      let T = this.temps.get(p.uid);
      let ex = 0;
      if (q > 0 && uL) {
        ex = clamp(1 - (pmax - p._proj) / (2 + 0.12 * len), 0.12, 1);
        if (p.def.surf && p.n) ex = Math.max(ex * 0.6, Math.abs(p.n.dot(uL)) * 0.8);
        if (!p.def.shield && smax > p._proj + 0.05) ex *= 0.15;
      }
      T += (q * ex - sb * (T * T * T * T - Tamb * Tamb * Tamb * Tamb)) / 4000 * dt;
      T = Math.max(T, 4);
      this.temps.set(p.uid, T);
      const mt = maxTemp(p.def) * (p.def.bay && this.bayOpen ? 0.5 : 1), fr = T / mt;
      if (fr > hot) { hot = fr; hotP = p; }
      if (T > mt) { this.overheat(p); if (this.destroyed) return; }
    }
    this.heatMax = hot; this.heatPart = hotP;
    if (hot > 0.85 && !this._heatWarned) { this._heatWarned = true; this.toast('⚠ ' + (hotP ? hotP.def.name : 'Part') + ' is overheating!', 2500); }
    if (hot < 0.7) this._heatWarned = false;
  }
  overheat(p) {
    if (p.kind === 'stack') { this.explode(this.r.clone(), Math.max(12, this.bounds.len)); this.crash(0, `${p.def.name} burned up during reentry (${Math.round(this.temps.get(p.uid))} K, limit ${maxTemp(p.def)} K). Use heat shields or tiles, enter shallower, or keep your nose pointed prograde.`); return; }
    const gone = p.groupKey ? this.inst.filter(q => q.groupKey === p.groupKey && this.prop.alive.has(q.uid)) : [p];
    for (const q of gone) { this.prop.alive.delete(q.uid); this.prop.active.delete(q.uid); const m = this.meshes.get(q.uid); if (m) m.visible = false; const pl = this.plumes.get(q.uid); if (pl) pl.visible = false; }
    const off = p.com.clone().sub(this.com).applyQuaternion(this.q);
    this.explode(this.r.clone().add(off), 4); AUDIO.boom(0.5);
    this.toast('🔥 ' + p.def.name + ' overheated and broke off', 3000);
    this.recomputeShape(false); this.refreshStages();
  }
  // ---------------- quicksave ----------------
  quicksave() {
    if (this.destroyed) { this.toast('Nothing to save'); return; }
    const a = v => [v.x, v.y, v.z], P = this.prop;
    const st = { v: 1, craft: this.craft, t: this.t, t0: this.t0, body: this.body.name, r: a(this.r), vel: a(this.v), q: [this.q.x, this.q.y, this.q.z, this.q.w], w: a(this.w), throttle: this.throttle,
      sas: this.sas, sasMode: this.sasMode, customDir: this.customDir || null, next: P.next, alive: [...P.alive], fuel: [...P.fuel], active: [...P.active], chutes: [...P.chutes], spool: [...P.spool],
      chuteState: [...this.chuteState], gearDown: this.gearDown, legsDown: this.legsDown, bayOpen: this.bayOpen, rcsOn: this.rcsOn, mono: [...this.mono], temps: [...this.temps],
      landed: this.landed, contact: this.contact, padMode: this.padMode, stats: { maxAlt: this.stats.maxAlt, maxSpeed: this.stats.maxSpeed, visited: [...this.stats.visited] },
      node: this.node ? { t: this.node.t, pro: this.node.pro, norm: this.node.norm, rad: this.node.rad } : null, saved: Date.now() };
    try { localStorage.setItem('orbitforge.quicksave', JSON.stringify(st)); this.toast('Quicksaved (F5) · load with F9', 1800); AUDIO.click(); } catch (e) { this.toast('Quicksave failed: ' + e.message); }
  }
  quickload() {
    let st; try { st = JSON.parse(localStorage.getItem('orbitforge.quicksave')); } catch (e) { }
    if (!st || st.v !== 1) { this.toast('No quicksave yet (F5 saves)'); return; }
    const b = BODIES.find(x => x.name === st.body); if (!b) { this.toast('Quicksave is from a mod world that is not loaded'); return; }
    this.app.closeDialog(); if (this.app.mode !== 'flight') this.app.show('flight');
    this.start(st.craft);
    const P = this.prop;
    P.next = st.next; P.alive = new Set(st.alive); P.fuel = new Map(st.fuel); P.active = new Set(st.active); P.chutes = new Set(st.chutes); P.spool = new Map(st.spool);
    this.chuteState = new Map(st.chuteState); this.mono = new Map(st.mono); this.temps = new Map(st.temps);
    for (const p of this.inst) if (!P.alive.has(p.uid)) { const m = this.meshes.get(p.uid); if (m) m.visible = false; }
    this.body = b; this.t = st.t; this.t0 = st.t0;
    this.recomputeShape(true); this.mass = P.mass();
    this.r.fromArray(st.r); this.v.fromArray(st.vel); this.q.set(st.q[0], st.q[1], st.q[2], st.q[3]); this.w.fromArray(st.w);
    this.throttle = st.throttle; this.sas = st.sas; this.sasMode = st.sasMode; this.customDir = st.customDir;
    this.gearDown = st.gearDown; this.gearFrac = st.gearDown ? 1 : 0; this.legsDown = st.legsDown; this.legFrac = st.legsDown ? 1 : 0; this.bayOpen = st.bayOpen; this.rcsOn = st.rcsOn;
    this.landed = st.landed; this.contact = st.contact; this.padMode = st.padMode;
    this.stats = { maxAlt: st.stats.maxAlt, maxSpeed: st.stats.maxSpeed, visited: new Set(st.stats.visited) };
    this.node = st.node ? Object.assign({ applied: new V3() }, st.node) : null;
    this.updatePrediction(true); this.refreshStages(); this.buildPopovers();
    this.toast('Quickloaded', 1500);
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
  runwayEnds() { const R = HOME.radius, qr = bodyRot(HOME, this.t); const a = siteToWorld(RUNWAY.x, RUNWAY.z0, R).multiplyScalar(R).applyQuaternion(qr), b = siteToWorld(RUNWAY.x, RUNWAY.z1, R).multiplyScalar(R).applyQuaternion(qr); return { a, b, mid: a.clone().add(b).normalize().multiplyScalar(R), len: a.distanceTo(b) }; }
  groundVel(r, out) { return out.crossVectors(tmpC.set(0, this.body.rotRate, 0), r); }
  lowestAlt() {
    const R = this.body.radius; let lo = Infinity; const b = this.bounds;
    this._onLegs = false;
    if (this.gears.length && this.bodyPts && !this.padMode) {
      for (const p of this.bodyPts) { tmpA.copy(p).sub(this.com).applyQuaternion(this.q).add(this.r); lo = Math.min(lo, tmpA.length() - R); }
      for (const g of this.gears) { if (!this.prop.alive.has(g.uid)) continue; tmpA.copy(g.tip).sub(this.com).applyQuaternion(this.q).add(this.r); lo = Math.min(lo, tmpA.length() - R); }
      return lo;
    }
    for (const y of [b.minY, b.maxY]) for (let k = 0; k < 6; k++) {
      const a = k / 6 * Math.PI * 2; tmpA.set(Math.cos(a) * b.maxR * 0.7, y, Math.sin(a) * b.maxR * 0.7).applyQuaternion(this.q).add(this.r);
      lo = Math.min(lo, tmpA.length() - R);
    }
    if (this.legs && this.legs.length && this.legFrac > 0.5) {
      let lf = Infinity;
      for (const p of this.legs) { if (!this.prop.alive.has(p.uid)) continue; this.legFoot(p, tmpB); tmpA.copy(tmpB).sub(this.com).applyQuaternion(this.q).add(this.r); lf = Math.min(lf, tmpA.length() - R); }
      if (lf < lo + 0.05) this._onLegs = true;
      lo = Math.min(lo, lf);
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
  // control feel: rockets steer pitch/yaw on the stick; planes steer pitch/roll (yaw on the twist buttons)
  feel() {
    const f = CTRL.feel; if (f === 'rocket' || f === 'plane') return f;
    if (this.craft.kind === 'plane' && this.site !== 'pad') return 'plane';
    if (this.winged && this.gears.length) { // shuttles: rocket feel while boosting upward, plane feel when gliding
      if (this.padMode) return 'rocket';
      const up = this.r.clone().normalize(), nz = Y.clone().applyQuaternion(this.q).dot(up);
      return this._lastBurn && this._lastBurn.F > 0 && nz > 0.35 ? 'rocket' : 'plane';
    }
    return 'rocket';
  }
  // attitude error (local axis * angle) that rotates the current attitude onto quaternion qt
  quatErr(qt) {
    const qe = tmpQ.copy(this.q).invert().multiply(qt);
    if (qe.w < 0) { qe.x = -qe.x; qe.y = -qe.y; qe.z = -qe.z; qe.w = -qe.w; }
    const sa = Math.sqrt(Math.max(0, 1 - qe.w * qe.w)), ang = 2 * Math.acos(Math.min(1, qe.w));
    return sa > 1e-9 ? new V3(qe.x / sa * ang, qe.y / sa * ang, qe.z / sa * ang) : new V3();
  }
  dirErr(target) { // point the nose at a world direction, roll left free
    const dl = target.clone().applyQuaternion(tmpQ.copy(this.q).invert());
    const ax = new V3().crossVectors(Y, dl); const s = ax.length(), c = Y.dot(dl);
    const ang = Math.atan2(s, c);
    const err = s > 1e-9 ? ax.multiplyScalar(ang / s) : new V3(c < 0 ? Math.PI : 0, 0, 0);
    err.y = 0; return err;
  }
  // target attitude for winged flight: pitch above the horizon, bank (right wing down +), heading = current nose heading
  planeAttitude(pitch, bank, hdg) {
    const f = this.frame(), nose = Y.clone().applyQuaternion(this.q);
    let h = hdg;
    if (h === undefined) { const ne = nose.dot(f.east), nn = nose.dot(f.north); h = ne * ne + nn * nn > 0.02 ? Math.atan2(ne, nn) : (this._lastHdg || 0); }
    this._lastHdg = h;
    const hz = f.north.clone().multiplyScalar(Math.cos(h)).addScaledVector(f.east, Math.sin(h));
    const n = f.up.clone().multiplyScalar(Math.sin(pitch)).addScaledVector(hz, Math.cos(pitch));
    const sgn = new V3().crossVectors(f.east, f.up).dot(f.north) > 0 ? -1 : 1;
    const r0 = new V3().crossVectors(n, f.up).normalize().multiplyScalar(sgn);
    const l0 = new V3().crossVectors(r0, n).normalize(); if (l0.dot(f.up) < 0) l0.negate();
    const right = r0.clone().multiplyScalar(Math.cos(bank)).addScaledVector(l0, -Math.sin(bank));
    const lift = l0.clone().multiplyScalar(Math.cos(bank)).addScaledVector(r0, Math.sin(bank));
    const m4 = new THREE.Matrix4().makeBasis(right.negate(), n, lift.negate());
    return new Q().setFromRotationMatrix(m4);
  }
  pitchBank() {
    const f = this.frame(), n = Y.clone().applyQuaternion(this.q), R = new V3(-1, 0, 0).applyQuaternion(this.q);
    return { pitch: Math.asin(clamp(n.dot(f.up), -1, 1)), bank: Math.asin(clamp(-R.dot(f.up), -1, 1)) };
  }
  // pilot input + assist + SAS/autopilot -> per-axis command [-1,1] (x pitch, y roll, z yaw)
  controlInput(dt = DT) {
    dt = Math.min(dt, 0.1);
    const pb = this._lastBurn;
    let gimbal = 0;
    if (pb) for (const u of pb.firing) { const p = this.prop.by.get(u); if (p.def.gimbal) gimbal += (pb.perF ? pb.perF[u] : p.def.thrust * 1000 * this.throttle) * Math.sin(p.def.gimbal * RAD) * Math.max(0.5, Math.abs(p.bot - this.com.y)); }
    this.gimCap = gimbal;
    const W = this.torque + (this.rcsOn && this.monoLeft > 0 ? this.rcsTorque : 0);
    this.wheelT = W;
    const ca = this.ctrlAuth || [0, 0, 0];
    this.alphaAct = [(W + gimbal) / this.Ip, (W + gimbal * 0.15) / this.Ir, (W + gimbal) / this.Ip];
    const alpha = [clamp((W + gimbal + ca[0]) / this.Ip, 0.03, 80), clamp((W + gimbal * 0.15 + ca[1]) / this.Ir, 0.03, 80), clamp((W + gimbal + ca[2]) / this.Ip, 0.03, 80)];
    this.alphaEst = alpha;
    const k = this.keys, fine = this.fine;
    const feel = this._feel = this.feel(), planeFeel = feel === 'plane';
    // keyboard (eased) — W = nose down (+x), E = roll right (+y), D = yaw right (+z)
    const kt = [(k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0), (k.KeyE ? 1 : 0) - (k.KeyQ ? 1 : 0), (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0)];
    if (this.trnMode) { kt[0] = kt[1] = kt[2] = 0; }
    const kr = this.keyRamp || (this.keyRamp = [0, 0, 0]);
    for (let i = 0; i < 3; i++) kr[i] = easeKey(kr[i], kt[i], dt, fine);
    // stick + tilt (shaped)
    const jx = this.trnMode ? 0 : shapeStick(clamp(this.joyV.x + (TILT.on ? TILT.x : 0), -1, 1)), jy = this.trnMode ? 0 : shapeStick(clamp(this.joyV.y - (TILT.on ? TILT.y : 0), -1, 1));
    const twist = this.trnMode ? 0 : this.rollIn;
    const onG = this.contact;
    let uin;
    if (planeFeel) uin = [kr[0] - jy, kr[1] + (onG ? 0 : jx), kr[2] + twist + (onG ? jx : 0)];
    else uin = [kr[0] - jy, kr[1] + twist, kr[2] + jx];
    uin = uin.map(x => clamp(x, -1, 1));
    if (this.testInput) uin = this.testInput.slice();
    this.uin = uin;
    const scale = fine ? 0.3 : 1;
    const active = uin.map(x => Math.abs(x) > 0.02), anyIn = active.some(a => a);
    if (anyIn) this._pilotT = this.t;
    const u = [0, 0, 0];
    const assist = CTRL.assist !== false;
    const integ = this.integ || (this.integ = [0, 0, 0]);
    // ---- attitude target: autopilot > SAS mode > hold ----
    let err = null, ff = null;
    const aeroFly = this.winged && !onG && this.q_dyn > 200;
    const apt = this.ap && this.ap.active ? this.ap.target : null;
    if (apt) { err = apt.q ? this.quatErr(apt.q) : apt.dir ? this.dirErr(apt.dir) : null; if (anyIn && this.ap.onPilot) this.ap.onPilot(); }
    else if (this.sas) {
      const target = this.sasTarget();
      if (this.isPlane && this.sasMode === 'custom' && this.customDir && !onG) { // planes: fly to a pitch/heading by banking
        const f = this.frame(), vs = this.v.clone().sub(this.groundVel(this.r, new V3()));
        const nz = Y.clone().applyQuaternion(this.q), tr = Math.atan2(nz.dot(f.east), nz.dot(f.north)), he = Math.atan2(Math.sin(this.customDir.hdg * RAD - tr), Math.cos(this.customDir.hdg * RAD - tr));
        const bank = clamp(Math.atan(Math.max(vs.length(), 30) * (he / 5) / 9.81), -0.65, 0.65);
        err = this.quatErr(this.planeAttitude(this.customDir.pitch * RAD, bank));
      } else if (target) err = this.dirErr(target);
      else {
        // stability hold: after the pilot lets go, damp the rotation first, then lock the attitude it settled at (no snap-back)
        if (anyIn || (this.isPlane && onG)) { this.holdQ = this.holdPB = null; this.holdPB = null; }
        if (!this.holdQ && !this.holdPB && !anyIn) {
          const wl = this.w.length();
          if ((this.isPlane && onG) || wl < 0.03 || this.t - (this._pilotT || -99) > 2.5) {
            if (aeroFly && planeFeel) { const pb = this.pitchBank(); this.holdPB = { pitch: pb.pitch, bank: Math.abs(pb.bank) < 0.06 ? 0 : pb.bank }; } // planes: keep pitch + bank, let the heading turn
            else this.holdQ = this.q.clone();
          }
        }
        if (this.holdPB) err = this.quatErr(this.planeAttitude(this.holdPB.pitch, this.holdPB.bank));
        else if (this.holdQ) err = this.quatErr(this.holdQ);
      }
    }
    // winged flight: feed forward the turn rate of a coordinated banked turn so the loop doesn't fight the turn
    if (err && aeroFly) {
      const f = this.frame(), vsp = Math.max(30, this.v.clone().sub(this.groundVel(this.r, new V3())).length()), pb = this.pitchBank();
      const psi = 9.81 * Math.tan(clamp(pb.bank, -1.2, 1.2)) / vsp;
      ff = f.up.clone().multiplyScalar(-psi).applyQuaternion(tmpQ.copy(this.q).invert());
    }
    const steer = !!(err || this.sas || assist);
    const wv = [this.w.x, this.w.y, this.w.z];
    const base = planeFeel ? [0.7, 1.5, 0.35] : [0.55, 1.1, 0.55];
    const tau = planeFeel && this.q_dyn > 200 ? 0.2 : 0.12, dn = this.aeroDampN || [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const a = alpha[i];
      // max commanded rate: what the craft can stop from within ~7 degrees, times the sensitivity setting
      const wmax = Math.min(base[i] * CTRL.sens, Math.sqrt(2 * a * 0.12) * Math.max(0.7, CTRL.sens)) * scale;
      let wc = null;
      const pa = this._act || (this._act = [false, false, false]);
      if (planeFeel && pa[i] && !active[i]) integ[i] = 0; // planes: drop the stick-held trim when the pilot lets go
      pa[i] = active[i];
      if (active[i]) {
        if (!assist) { u[i] = uin[i] * scale; integ[i] *= 0.9; continue; }
        wc = uin[i] * wmax;
      } else if (err) {
        const e = [err.x, err.y, err.z][i], ae = Math.abs(e);
        const wsas = Math.max(Math.min(base[i] * 1.6, Math.sqrt(2 * a * 0.3)) * (fine ? 0.5 : 1), 0.05);
        const dec = planeFeel ? 0.55 : 0.75; // use 75% of the turning authority to brake, so the stop lands on target
        wc = Math.sign(e) * Math.min(Math.sqrt(2 * dec * a * ae), (planeFeel ? 1.1 : 1.4) * ae, wsas);
        if (ff) wc += [ff.x, ff.y, ff.z][i];
      } else if (steer) wc = 0;
      if (wc === null) { u[i] = 0; integ[i] *= 0.9; continue; }
      const re = wc - wv[i];
      // PI rate loop. Gain includes the aerodynamic damping so planes hold a rate as firmly as rockets in vacuum.
      let kp = (1 + Math.min(dn[i] * tau, 1.5)) / (a * tau);
      if (this.winged && this.q_dyn > 200 && i !== 1) kp = Math.max(kp, 1.2 / Math.max(0.2, base[i] * CTRL.sens)); // pitch/yaw are held by aero stiffness, not inertia: they need a firmer rate loop // aero stiffness: make sure the surfaces actually move
      let ui = re * kp + integ[i];
      if (Math.abs(ui) < 1 || Math.sign(re) !== Math.sign(integ[i])) integ[i] = clamp(integ[i] + re * kp * dt / 0.6, -0.8, 0.8);
      u[i] = clamp(ui, -1, 1);
    }
    return u;
  }
  rotIntegrate(dt, u, aero, extT) {
    // control torque: reaction wheels + engine gimbal. The gimbal first trims any off-centre thrust torque (thrT), then steers with what is left.
    const W = this.wheelT || 0, G = this.gimCap || 0, T = this.thrT, I = [this.Ip, this.Ir, this.Ip], Gx = [G, G * 0.15, G];
    const acc = [0, 0, 0], tt = T ? [T.x, T.y, T.z] : [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const g = Gx[i] > 0 ? clamp(u[i] - tt[i] / Gx[i], -1, 1) : 0;
      let tq = u[i] * W + g * Gx[i] + tt[i];
      if (W + Gx[i] < 0.03 * I[i]) tq += u[i] * 0.03 * I[i];
      acc[i] = tq / I[i];
    }
    this.w.x += (acc[0] + (aero ? aero.x : 0) + (extT ? extT.x / this.Ip : 0)) * dt;
    this.w.y += (acc[1] + (aero ? aero.y || 0 : 0) + (extT ? extT.y / this.Ir : 0)) * dt;
    this.w.z += (acc[2] + (aero ? aero.z : 0) + (extT ? extT.z / this.Ip : 0)) * dt;
    if (aero && aero.damp) { const f = 1 / (1 + aero.damp * dt); this.w.x *= f; this.w.z *= f; }
    if (this.w.length() > 3) this.w.setLength(3);
    const wl = this.w.length();
    if (wl > 1e-9) { tmpQ.setFromAxisAngle(tmpA.copy(this.w).divideScalar(wl), wl * dt); this.q.multiply(tmpQ).normalize(); }
  }
  rotStep(dt, aero) { const u = this.controlInput(dt); this.thrT = null; this.rotIntegrate(dt, u, aero); }
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
    const F = new V3(), T = new V3(), auth = [0, 0, 0], D = [0, 0, 0], ex = new V3();
    const alive = this.prop.alive, sp0 = vsl.length();
    const rr = new V3(), vp = new V3(), n = new V3(), Tp = new V3(), Tm = new V3(), dum = new V3();
    for (const s of this.surfs) {
      if (!alive.has(s.uid)) continue;
      rr.copy(s.com).sub(this.com);
      vp.crossVectors(this.w, rr).add(vsl);
      const sf = s.def.surf;
      // rotational damping of this surface (torque per rad/s), used to tune the steering loop
      for (let i = 0; i < 3; i++) { ex.set(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0).cross(rr); const c = s.n.dot(ex); D[i] += 0.5 * rho * sp0 * sf.area * 5.4 * c * c; }
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
    this.ctrlAuth = auth; this.aeroDampN = [D[0] / this.Ip, D[1] / this.Ir, D[2] / this.Ip];
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
    if (this.ap && this.ap.active) this.ap.step(dt);
    const burn = this.prop.burn(this.throttle, atm.p, dt, this.prop._env);
    this._lastBurn = burn;
    if (burn.F > 0) this.mass = this.prop.mass();
    // thrust that does not pass through the centre of mass makes a torque (the gimbal trims it in rotIntegrate)
    this.thrT = null;
    if (burn.F > 0) {
      const T = new V3();
      for (const u of burn.firing) {
        const p = this.prop.by.get(u), f = burn.perF[u] || 0;
        let ox = p.pos.x - this.com.x, oz = p.pos.z - this.com.z;
        if (p.def.cant) { // canted mounts: the engine bells aim the thrust line through the centre of mass (up to def.cant degrees)
          const lev = Math.max(0.5, Math.abs(this.com.y - p.pos.y)), tm = Math.tan(p.def.cant * RAD);
          ox -= lev * clamp(ox / lev, -tm, tm); oz -= lev * clamp(oz / lev, -tm, tm);
        }
        T.x += -oz * f; T.z += ox * f;
      }
      this.thrT = T;
    }
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
    const u = this._u = this.controlInput(dt);
    this.rcsStep(dt, u, acc);
    // aero
    let aero = null;
    if (atm.rho > 0 && vsm > 0.5) {
      const qdyn = 0.5 * atm.rho * vsm * vsm;
      const qi = tmpQ.copy(this.q).invert();
      const vdl = vs.clone().divideScalar(vsm).applyQuaternion(qi);
      const sin2 = 1 - Math.pow(clamp(vdl.y, -1, 1), 2);
      this.q_dyn = qdyn;
      if (this.surfAero) {
        const CdA = this.area * (this.cd0 * 0.6 + 0.8 * sin2 + waveCd(mach)) + chuteA + (this.brakes ? 1.5 + this.wingArea * 0.07 : 0) + (this.dragChute && this.contact ? 28 : 0) + (this.bayOpen ? 2 : 0);
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
        this.aeroDampN = [aero.damp, 0, aero.damp];
      }
    } else { this.q_dyn = 0; this.ctrlAuth = [0, 0, 0]; this.aeroDampN = null; }
    this.heatStep(dt, atm, vs, vsm);
    if (this.destroyed) return;
    // wheels
    this.steer = clamp((this.uin ? this.uin[2] : 0) + (this.apSteer || 0), -1, 1); // nose-wheel steering follows the pilot only (SAS steering oscillates on the ground)
    const wr = this.gears.length ? this.wheels(dt, u, vs) : null;
    if (wr) acc.addScaledVector(wr.F, 1 / this.mass);
    // rotation (rockets sitting on the ground keep their attitude locked)
    const weight = b.mu / (rm * rm) * this.mass;
    if (this.contact && (!this.gears.length || this.padMode) && burn.F < weight * 1.02) {
      this.w.set(0, 0, 0);
      tmpQ.setFromAxisAngle(Y, b.rotRate * dt); this.q.premultiply(tmpQ);
    } else this.rotIntegrate(dt, u, aero, wr ? wr.T : null);
    // integrate (semi-implicit Euler)
    v.addScaledVector(acc, dt); r.addScaledVector(v, dt);
    this.t += dt;
    this.groundContact(dt);
    if (this.padMode && (!this.contact && this.t - this.t0 > 3 || this.lowestAlt() > 25)) this.padMode = false;
    this.checkSOI();
    if (burn.firing.length === 0 && this.prop.active.size && this.throttle > 0 && !this._flameoutWarned) { this._flameoutWarned = true; this.toast(this.isPlane && [...this.prop.active].some(u => this.prop.by.get(u).def.air) ? 'Flameout: not enough air (or fuel)' : 'Flameout: stage when ready'); }
    if (burn.firing.length) this._flameoutWarned = false;
    if (burn.F > 0 && this.node) { const rem = this.nodeRemaining(); if (rem && rem.dot(this.node.dvWorld) <= 0) { this.toast('Maneuver complete'); } }
  }
  groundContact(dt) {
    if (this.destroyed) return;
    if (this.gears.length && !this.padMode) return this.planeContact(dt);
    const lo = this.lowestAlt();
    if (lo < 0) {
      const up = this.r.clone().normalize();
      const vg = this.groundVel(this.r, new V3());
      const vrel = this.v.clone().sub(vg);
      const sp = vrel.length();
      const lim = this._onLegs ? LEG_CRASH : CRASH_SPEED;
      if (!this.contact && sp > lim) { this.crash(sp); return; }
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
  crash(speed, why) {
    this.destroyed = true; this.root.visible = false; AUDIO.boom(); MODS.emit('crash', this);
    if (this.ap) this.ap.off(true);
    for (const pl of this.plumes.values()) pl.visible = false;
    this.explode(this.r.clone(), Math.max(12, this.bounds.len));
    this.warpIdx = 0;
    setTimeout(() => {
      if (!this.destroyed || this.ended) return;
      this.ended = true;
      this.app.dialog('Vessel destroyed', [['Revert to launch', () => this.start(this.craft)], ['Back to builder', () => this.app.toBuilder()]], why ? `<p>${why}</p>` : `<p>Impact at ${speed.toFixed(1)} m/s on ${this.body.name}. Crash tolerance is ${CRASH_SPEED} m/s (${LEG_CRASH} m/s on deployed landing legs).</p>`);
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
    if (this.ap && this.ap.active) this.ap.tick();
    const railsOK = this.canRails();
    if (this.warpMode === 'rails' && this.warpIdx > 0 && !railsOK) { this.warpIdx = 0; this.toast('Warp stopped'); }
    if (this.warpMode === 'phys' && this.warpIdx > 0 && railsOK && !this.landed) { /* allow phys warp in space too */ }
    const W = this.warpFactor();
    if (this.warpMode === 'rails' && W > 1) { this.railsAdvance(dtReal * W, false); this._lastBurn = null; }
    else if (railsOK && !this.contact && !this.landed && !(this.ap && this.ap.active)) { this.railsAdvance(dtReal * (this.warpMode === 'phys' ? W : 1), true); this._lastBurn = null; this.acc = 0; }
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
    AUDIO.update(this, dt);
    MODS.emit('update', dt, this);
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
    this.legFrac = clamp(this.legFrac + (this.legsDown ? 1 : -1) * dt * 0.8, 0, 1);
    for (const p of this.legs) { const m = this.meshes.get(p.uid); if (m && m.userData.leg) m.userData.leg.rotation.z = 2.95 - 2.35 * this.legFrac; }
    this.bayFrac = clamp(this.bayFrac + (this.bayOpen ? 1 : -1) * dt * 0.4, 0, 1);
    for (const p of this.bays) { const m = this.meshes.get(p.uid); if (m && m.userData.doors) for (const d of m.userData.doors) d.rotation.y = -d.userData.sd * this.bayFrac * 1.95; }
    for (const p of this.rcsBlocks) if (p.puff) { const on = this._rcsFire > 0 && this.prop.alive.has(p.uid) && !this.destroyed; p.puff.visible = on && Math.random() < 0.8; if (on) p.puff.scale.setScalar(0.6 + Math.random() * 0.8); }
    // reentry plasma: glowing cap on the upstream side
    { const q = this.heatFlux || 0, op = clamp((q - 6e4) / 3e5, 0, 0.8);
      this.plasma.visible = op > 0.01 && !this.destroyed && !!this._heatDir;
      if (this.plasma.visible) { const u = this._heatDir, R = Math.max(1.2, this.bounds.maxR * 1.3); this.plasma.position.copy(u).multiplyScalar((this._heatFront || 0) + 0.4); this.plasma.quaternion.setFromUnitVectors(Y, u); this.plasma.scale.set(R, R * (1 + op), R); this.plasma.material.opacity = op * (0.85 + Math.random() * 0.3); this.plasma.material.color.setHSL(0.06 - op * 0.03, 1, 0.55); } }
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
    const hp = Math.round((this.heatMax || 0) * 100);
    this.hudMain.innerHTML = `<span class="alt">${fmtDist(showRadar && radar < 3000 ? Math.max(0, radar) : alt)}</span><span class="lab">${showRadar && radar < 3000 ? 'RADAR' : 'ALT'}</span>` + (hp >= 45 ? `<span class="heat${hp >= 80 ? ' warn' : ''}">🔥${hp}%</span>` : '') +
      (this.app.W < 520 && !this.hudOpen ? '' : `<span class="sep"></span><span class="lab">Ap</span><b>${apS}</b><span class="lab">Pe</span><b>${peS}</b>`) + `<i class="chev">${this.hudOpen ? '▴' : '▾'}</i>`;
    if (this.hudOpen) {
      if ((this._dvT = (this._dvT || 0) - 1) <= 0) { this._dvCache = dvRemaining(this.prop).toFixed(0); this._dvT = 8; }
      this.hudDet.innerHTML = `<div><b>${b.name}</b> · ${situ}</div>
        <div>Ap <b>${apS}</b> ${!grounded && el0.ecc < 1 && isFinite(el0.tAp) ? 'in ' + fmtTime(el0.tAp) : ''} · Pe <b>${peS}</b> ${!grounded && isFinite(el0.tPe) && el0.tPe > 0 ? 'in ' + fmtTime(el0.tPe) : ''}</div>
        <div>ALT ${fmtDist(alt)} · V/S ${vvert.toFixed(1)} m/s${this.isPlane ? ` · Mach ${(vs.length() / 340).toFixed(2)}${this.aoa !== undefined && this.q_dyn > 50 ? ' · AoA ' + this.aoa.toFixed(1) + '°' : ''}` : ''}</div>
        <div>MET ${fmtTime(this.t - this.t0)} · Δv ${this._dvCache} m/s · ${(this.mass / 1000).toFixed(2)} t</div>
        <div>Hottest: ${this.heatPart ? this.heatPart.def.name + ' ' + Math.round(this.temps.get(this.heatPart.uid)) + ' K (' + hp + '%)' : '—'}${this.rcsBlocks.length ? ` · RCS ${this.rcsOn ? 'ON' : 'off'} ${(this.monoLeft * 1000).toFixed(0)} kg` : ''}</div>
        ${this.isPlane ? `<div>${this.engineInfo()}</div>` : ''}`;
    }
    this.speedEl.innerHTML = `<small>${this.navFrame === 'surface' ? 'SURFACE' : 'ORBIT'}${this.navMode !== 'auto' ? '•' : ''}</small><b>${spd.toFixed(1)}</b><small>m/s</small>`;
    this.thFill.style.height = (this.throttle * 100) + '%'; this.thKnob.style.bottom = `calc(${this.throttle * 100}% - 8px)`;
    this.thLab.textContent = (this.throttle * 100).toFixed(0) + '%';
    this.warpEl.textContent = this.warpFactor() + '×' + (this.warpMode === 'phys' && this.warpIdx > 0 ? 'ᵖ' : '');
    this.sasBtn.classList.toggle('on', this.sas);
    this.sasModeBtn.textContent = this.modeGlyph[this.sasMode] || '◎';
    this.sasModeBtn.classList.toggle('on', this.sas && this.sasMode !== 'stab');
    for (const k in this.sasBtns) this.sasBtns[k].classList.toggle('on', this.sas && this.sasMode === k && !this.ap.active);
    for (const k in this.apBtns || {}) this.apBtns[k].classList.toggle('on', this.ap.active && this.ap.mode === k);
    this.apChip.classList.toggle('hidden', !this.ap.active);
    if (this.ap.active) this.apChip.innerHTML = `<b>AP</b> ${this.ap.status()} <i>✕</i>`;
    this.sasBtn.classList.toggle('ap', this.ap.active);
    const rl = this.trnMode ? ['▼', '▲'] : this._feel === 'plane' ? ['◁', '▷'] : ['⟲', '⟳'];
    if (this.rollBtns[0].textContent !== rl[0]) { this.rollBtns[0].textContent = rl[0]; this.rollBtns[1].textContent = rl[1]; this.rollBtns.forEach(b => b.title = this.trnMode ? 'RCS back / forward' : this._feel === 'plane' ? 'Yaw (rudder)' : 'Roll'); }
    if (this._feelShown !== this._feel) { if (this._feelShown && this.t - this.t0 > 2) this.toast(this._feel === 'plane' ? 'Plane controls: stick = pitch + roll, ◁ ▷ = yaw' : 'Rocket controls: stick = pitch + yaw, ⟲ ⟳ = roll', 2500); this._feelShown = this._feel; }
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
      case 'KeyT': this.ap.off(); this.toggleSAS(); break;
      case 'KeyG': this.toggleGear(); break;
      case 'KeyR': this.toggleRCS(); break;
      case 'KeyO': this.toggleBay(); break;
      case 'CapsLock': this.setFine(!this.fine); break;
      case 'F5': this.quicksave(); e.preventDefault(); break;
      case 'F9': this.quickload(); e.preventDefault(); break;
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
      ap(mode, opts) { if (opts) Object.assign(F.ap, opts); if (mode) F.ap.engage(mode); else F.ap.off(); return F.ap.status(); },
      throttle(x) { F.setThrottle(x); },
      stage() { F.doStage(); },
      simulate(sec) { const n = Math.round(sec / DT); for (let i = 0; i < n && !F.destroyed; i++) F.advance(DT); return this.status(); },
      warpTo(tAbs) { // fast rails warp in one call
        let guard = 0; while (F.t < tAbs && guard++ < 200000 && !F.destroyed) { const W = Math.min(100000, Math.max(1, (tAbs - F.t) / 2)); if (F.canRails()) F.railsAdvance(Math.min(tAbs - F.t, W * 0.05), false); else F.advance(Math.min(DT, tAbs - F.t)); }
        F.updatePrediction(true); return this.status();
      },
      node(t, pro, norm, rad) { F.node = { t, pro, norm, rad, applied: new V3() }; F.updatePrediction(true); return this.status(); },
      // test hook: put a winged craft in level flight on the runway's extended centreline, D m before the threshold, h m up, at v m/s
      place({ D = 20000, h = 3000, v = 200, end = 'a', cross = 0 } = {}) {
        const rw = F.runwayEnds(), thr = end === 'a' ? rw.a : rw.b, oth = end === 'a' ? rw.b : rw.a, up = thr.clone().normalize();
        const flat = x => x.clone().addScaledVector(up, -x.dot(up)); const dir = flat(oth.clone().sub(thr)).normalize(), side = new V3().crossVectors(up, dir).normalize();
        F.body = HOME; F.r.copy(thr).addScaledVector(dir, -D).addScaledVector(side, cross).normalize().multiplyScalar(HOME.radius + h);
        const f = F.frame(); const hd = Math.atan2(dir.dot(f.east), dir.dot(f.north));
        F.v.copy(dir).multiplyScalar(v).add(F.groundVel(F.r, new V3()));
        F.q.copy(F.planeAttitude(0.05, 0, hd)); F.w.set(0, 0, 0);
        F.landed = false; F.contact = false; F.padMode = false; F.gearDown = false; F.gearFrac = 0; F.warpIdx = 0; F.holdQ = F.holdPB = null; F.updatePrediction(true); return this.status();
      },
      setOrbit(name, alt, ang = 0) {
        const b = BODIES.find(x => x.name === name); const rr = b.radius + alt, vc = Math.sqrt(b.mu / rr);
        F.body = b; F.r.set(rr * Math.cos(ang), 0, -rr * Math.sin(ang)); F.v.set(-vc * Math.sin(ang), 0, -vc * Math.cos(ang));
        F.landed = false; F.contact = false; F.warpIdx = 0; F.updatePrediction(true); return this.status();
      },
      F,
    };
  }
}
