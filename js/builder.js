// Orbit Forge - 3D craft editors: the Forge (vertical rocket assembly) and the Hangar (horizontal spaceplane assembly)
import * as THREE from './vendor/three.module.min.js';
import { PARTS, CATS, PLANE_CATS, makePartMesh } from './parts.js';
import { layout, buildEvents, stageStats, eventLabel, craftMass, sideItems, centers, EXAMPLES, PLANE_EXAMPLES, savedCrafts, saveCraft, deleteCraft, clone } from './craft.js';
import { HOME, clamp } from './orbit.js';
const V3 = THREE.Vector3, TAU = Math.PI * 2, H = Math.PI / 2;
function el(tag, cls, html, parent) { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; if (parent) parent.appendChild(e); return e; }
const isRadial = id => !!PARTS[id].radial;
const CUR = { vab: 'orbitforge.current', sph: 'orbitforge.current.sph' };

export class Builder {
  constructor(app) {
    this.app = app;
    const s = this.scene = new THREE.Scene();
    s.background = new THREE.Color(0x1a202b);
    s.add(new THREE.HemisphereLight(0xe4ecff, 0x3a3530, 1.4));
    const d = new THREE.DirectionalLight(0xffffff, 1.8); d.position.set(6, 12, 8); s.add(d);
    const d2 = new THREE.DirectionalLight(0x9fb8ff, 0.6); d2.position.set(-8, 4, -6); s.add(d2);
    // Forge (VAB) decor
    const vab = this.vabDeco = new THREE.Group(); s.add(vab);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 48), new THREE.MeshLambertMaterial({ color: 0x3b4250 })); floor.rotation.x = -Math.PI / 2; vab.add(floor);
    const grid = new THREE.GridHelper(60, 30, 0x5c6778, 0x485160); grid.position.y = 0.01; vab.add(grid);
    const pm = new THREE.MeshLambertMaterial({ color: 0x59606c });
    for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; const b = new THREE.Mesh(new THREE.BoxGeometry(1.2, 40, 1.2), pm); b.position.set(Math.cos(a) * 26, 20, Math.sin(a) * 26); vab.add(b); }
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(26.5, 26.5, 1.2, 48, 1, true), new THREE.MeshBasicMaterial({ color: 0xe0a020, side: THREE.BackSide })); stripe.position.y = 3; vab.add(stripe);
    // Hangar (SPH) decor: long floor, arched ribs, hazard stripes
    const sph = this.sphDeco = new THREE.Group(); s.add(sph); sph.visible = false;
    const hf = new THREE.Mesh(new THREE.PlaneGeometry(44, 70), new THREE.MeshLambertMaterial({ color: 0x40464f })); hf.rotation.x = -Math.PI / 2; sph.add(hf);
    const hg = new THREE.GridHelper(70, 35, 0x6a7480, 0x4b525c); hg.position.y = 0.01; sph.add(hg);
    const rib = new THREE.MeshLambertMaterial({ color: 0x6b7380 });
    for (let i = -3; i <= 3; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(20, 0.35, 6, 32, Math.PI), rib); r.position.z = i * 10; sph.add(r); }
    const back = new THREE.Mesh(new THREE.CircleGeometry(20, 32, 0, Math.PI), new THREE.MeshLambertMaterial({ color: 0x2b3038, side: THREE.DoubleSide })); back.position.z = -32; sph.add(back);
    const yl = new THREE.MeshBasicMaterial({ color: 0xe0a020 });
    for (const x of [-7, 7]) { const st = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 60), yl); st.rotation.x = -Math.PI / 2; st.position.set(x, 0.02, 0); sph.add(st); }
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
    this.cam = { yaw: 0.7, pitch: 0.25, dist: 16, ty: 4 };
    this.rig = new THREE.Group(); s.add(this.rig);
    this.craftGroup = new THREE.Group(); this.rig.add(this.craftGroup);
    this.markerGroup = new THREE.Group(); this.rig.add(this.markerGroup);
    this.centerGroup = new THREE.Group(); this.rig.add(this.centerGroup);
    this.markerMat = new THREE.MeshBasicMaterial({ color: 0x3cff8a, transparent: true, opacity: 0.85, depthTest: false });
    this.markerHit = new THREE.MeshBasicMaterial({ visible: false });
    this.markerGeo = new THREE.SphereGeometry(0.22, 12, 8); this.hitGeo = new THREE.SphereGeometry(0.7, 8, 6);
    const cm = (c) => { const g = new THREE.Group(); const m = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 10), new THREE.MeshBasicMaterial({ color: c, depthTest: false, transparent: true, opacity: 0.95 }));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 6, 24), m.material); g.add(m, ring); g.renderOrder = 12; m.renderOrder = ring.renderOrder = 12; this.centerGroup.add(g); return g; };
    this.mCoM = cm(0xffd23a); this.mCoL = cm(0x3aa8ff); this.mCoT = cm(0xff4fd8);
    this.showCenters = localStorage.getItem('orbitforge.centers') !== '0';
    this.sel = null; this.held = null; this.sym = 2; this.history = []; this.cat = 'Pods';
    this.selBox = new THREE.BoxHelper(undefined, 0x3cff8a); this.selBox.visible = false; s.add(this.selBox);
    this.ray = new THREE.Raycaster();
    this.mode = 'vab';
    this.buildUI();
    this.craft = this.loadCurrent('vab') || clone(EXAMPLES[1]);
    this.rebuild(true);
  }
  get plane() { return this.mode === 'sph'; }
  loadCurrent(m) { try { return JSON.parse(localStorage.getItem(CUR[m])); } catch (e) { return null; } }
  setMode(m) {
    if (m === this.mode && this.craft) return;
    this.persist();
    this.mode = m; this.held = null; this.sel = null; this.history = [];
    this.craft = this.loadCurrent(m) || clone(m === 'sph' ? PLANE_EXAMPLES[0] : EXAMPLES[1]);
    this.cat = m === 'sph' ? 'Cockpits' : 'Pods';
    this.vabDeco.visible = m === 'vab'; this.sphDeco.visible = m === 'sph';
    this.ui.classList.toggle('sph', m === 'sph');
    this.modeLab.textContent = m === 'sph' ? 'HANGAR' : 'FORGE';
    this.cam = m === 'sph' ? { yaw: 0.95, pitch: 0.32, dist: 18, ty: 1.5 } : { yaw: 0.7, pitch: 0.25, dist: 16, ty: 4 };
    this._lastH = undefined;
    this.renderTabs(); this.renderPalette(); this.rebuild(true);
  }
  buildUI() {
    const ui = this.ui = el('div', 'bui hidden', '', document.getElementById('ui'));
    const top = el('div', 'btop', '', ui);
    const btn = (label, fn, cls, parent = top) => { const b = el('button', 'bb ' + (cls || ''), label, parent); b.addEventListener('click', e => { e.stopPropagation(); fn(b); }); return b; };
    btn('☰', () => this.app.toMenu(), 'ic');
    this.modeLab = el('span', 'bmode', 'FORGE', top);
    this.nameIn = el('input', 'bname', '', top); this.nameIn.maxLength = 28; this.nameIn.addEventListener('input', () => { this.craft.name = this.nameIn.value; this.persist(); });
    this.symBtn = btn('×2', () => { const o = [1, 2, 3, 4, 6]; this.sym = o[(o.indexOf(this.sym) + 1) % o.length]; this.symBtn.textContent = '×' + this.sym; this.updateMarkers(); this.hint('Radial symmetry ×' + this.sym); }, 'ic vabonly');
    this.symBtn.title = 'Symmetry';
    btn('↶', () => this.undo(), 'ic').title = 'Undo';
    btn('⋯', () => this.moreMenu(), 'ic').title = 'More';
    btn('LAUNCH ▶', () => this.launch(), 'go');
    // floating delete for the selected part
    this.delBtn = btn('🗑 Delete part', () => this.deleteSel(), 'danger delfloat hidden', ui);
    // stats pill
    this.statsEl = el('div', 'bstats panel scrolly compact', '', ui);
    this.statsEl.addEventListener('click', () => this.statsEl.classList.toggle('compact'));
    this.hintEl = el('div', 'bhint', '', ui);
    // parts drawer
    this.drawerBtn = btn('＋ Parts', () => this.setDrawer(!this.drawerOpen), 'drawbtn', ui);
    const pal = this.pal = el('div', 'palette panel', '', ui);
    const ph = el('div', 'palhead', '', pal);
    this.tabs = el('div', 'tabs scrolly', '', ph);
    btn('✕', () => this.setDrawer(false), 'ic palx', ph);
    this.plist = el('div', 'plist scrolly', '', pal);
    this.renderTabs(); this.renderPalette();
    this.setDrawer(innerWidth >= 1000);
  }
  setDrawer(on) { this.drawerOpen = on; this.pal.classList.toggle('open', on); this.drawerBtn.classList.toggle('hidden', on); }
  moreMenu() {
    const other = this.plane ? 'vab' : 'sph';
    this.app.dialog(this.plane ? 'Hangar' : 'Forge', [
      ['New craft', () => { this.push(); this.craft = { name: this.plane ? 'Untitled Plane' : 'Untitled Rocket', kind: this.plane ? 'plane' : undefined, stack: [] }; this.sel = null; this.rebuild(true); this.setDrawer(true); }],
      ['Load…', () => this.loadDialog()],
      ['Save on this device', () => { saveCraft(clone(this.craft)); this.hint('Saved "' + this.craft.name + '" on this device'); }],
      [(this.showCenters ? 'Hide' : 'Show') + ' CoM / CoL / CoT markers', () => { this.showCenters = !this.showCenters; localStorage.setItem('orbitforge.centers', this.showCenters ? '1' : '0'); this.updateCenters(); }],
      [other === 'sph' ? '✈ Go to the Hangar (planes)' : '🚀 Go to the Forge (rockets)', () => this.setMode(other)],
      ['Cancel', () => { }],
    ], '<p class="legend"><span style="color:#ffd23a">● CoM</span> centre of mass · <span style="color:#3aa8ff">● CoL</span> centre of lift · <span style="color:#ff4fd8">● CoT</span> centre of thrust</p>');
  }
  renderTabs() {
    this.tabs.innerHTML = '';
    const cats = this.plane ? PLANE_CATS : CATS;
    if (!cats.includes(this.cat)) this.cat = cats[0];
    for (const c of cats) { const t = el('button', 'tab' + (c === this.cat ? ' on' : ''), c, this.tabs); t.addEventListener('click', e => { e.stopPropagation(); this.cat = c; this.renderTabs(); this.renderPalette(); }); }
  }
  renderPalette() {
    this.plist.innerHTML = '';
    for (const [id, p] of Object.entries(PARTS)) {
      if (p.cat !== this.cat) continue;
      if (!this.plane && p.plane) continue;
      let info = `${p.mass.toFixed(2)} t`;
      if (p.air === 'jet') info += ` · ${p.thrust} kN (air)`;
      else if (p.air === 'hybrid') info += ` · ${p.airThrust} kN air / ${p.thrust} kN rocket`;
      else if (p.thrust) info += ` · ${p.thrust} kN · Isp ${p.ispA}/${p.ispV}`;
      if (p.fuel && !p.srb) info += ` · fuel ${p.fuel.toFixed(2)} t`;
      if (p.surf) info += ` · ${p.surf.area} m²` + (p.surf.ctrl ? ` · ±${p.surf.ctrl}°` : '');
      if (p.crew) info += ` · ${p.crew} crew`;
      const b = el('button', 'pbtn' + (this.held === id ? ' on' : ''), `<b>${p.name}</b><small>${info}</small><small class="desc">${p.desc}</small>`, this.plist);
      b.addEventListener('click', e => { e.stopPropagation(); this.held = this.held === id ? null : id; this.sel = null; this.renderPalette(); this.updateMarkers(); this.refreshSel();
        if (this.held) { if (innerWidth < 1000) this.setDrawer(false); this.hint(this.points.length ? (this.craft.stack.length ? 'Tap a green dot to attach ' + p.name + (isRadial(id) ? (this.plane ? ' (mirrored)' : ` (symmetry ×${this.sym})`) : '') : 'Tap the green dot to place your first part') : 'No place to attach ' + p.name + ' yet'); } });
    }
  }
  hint(t) { this.hintEl.textContent = t; this.hintEl.classList.add('show'); clearTimeout(this._ht); this._ht = setTimeout(() => this.hintEl.classList.remove('show'), 4000); }
  push() { this.history.push(JSON.stringify(this.craft)); if (this.history.length > 60) this.history.shift(); }
  undo() { if (!this.history.length) { this.hint('Nothing to undo'); return; } this.craft = JSON.parse(this.history.pop()); this.sel = null; this.rebuild(); }
  persist() { try { if (this.craft) localStorage.setItem(CUR[this.mode], JSON.stringify(this.craft)); } catch (e) { } }
  rebuild(frame) {
    if (this.plane) this.craft.kind = 'plane';
    this.nameIn.value = this.craft.name || '';
    this.persist();
    const g = this.craftGroup;
    while (g.children.length) g.remove(g.children[0]);
    this.inst = layout(this.craft);
    for (const p of this.inst) {
      const m = makePartMesh(p.id); m.position.copy(p.pos); if (p.kind !== 'stack') m.rotation.y = -p.ang;
      m.traverse(o => { o.userData.inst = p; });
      g.add(m); p.mesh = m;
    }
    // orientation: rockets stand up; planes lie flat, nose toward +Z, wheels on the floor
    const rig = this.rig;
    rig.position.set(0, 0, 0); rig.rotation.set(this.plane ? Math.PI / 2 : 0, 0, 0); rig.updateMatrixWorld(true);
    let len;
    if (this.plane && this.inst.length) {
      const box = new THREE.Box3().setFromObject(g);
      rig.position.set(0, 0.02 - box.min.y, -(box.min.z + box.max.z) / 2); rig.updateMatrixWorld(true);
      len = box.max.z - box.min.z;
    } else len = this.inst.reduce((m, p) => Math.max(m, p.top), 0);
    if (this._lastH !== undefined && Math.abs(len - this._lastH) > 0.4) frame = true;
    this._lastH = len;
    if (frame) {
      const pf = this.app.W < this.app.H ? 1.9 : 1;
      if (this.plane) { this.cam.ty = 1.2; this.cam.dist = Math.max(8, len * 0.95 + 3) * pf; }
      else { this.cam.ty = Math.max(1.5, len / 2); this.cam.dist = Math.max(9, len * 1.5 + 4); }
    }
    this.updateMarkers(); this.refreshSel(); this.updateStats(); this.updateCenters();
  }
  updateCenters() {
    const c = this.inst.length ? centers(this.inst, this.plane) : {};
    const set = (m, v) => { m.visible = !!(this.showCenters && v); if (v) m.position.copy(v); if (this.plane) m.rotation.set(0, 0, 0); else m.rotation.set(Math.PI / 2, 0, 0); };
    set(this.mCoM, c.com); set(this.mCoL, c.col); set(this.mCoT, c.cot);
    this._centers = c;
  }
  updateStats() {
    const inst = this.inst;
    if (!inst.length) { this.statsEl.innerHTML = `<b>Empty craft</b> · open ＋ Parts and pick a ${this.plane ? 'cockpit' : 'pod'}`; return; }
    const ev = buildEvents(inst), st = stageStats(inst, ev, HOME.g);
    const total = st.reduce((a, s) => a + s.dvVac, 0);
    const rows = ev.map((e, i) => `<div class="srow"><span class="sn">${i + 1}</span><span class="sl">${eventLabel(inst, e)}</span>${st[i].dvVac > 0.5 ? `<span class="sd">Δv ${st[i].dvVac.toFixed(0)} · TWR ${st[i].twr.toFixed(2)}${st[i].twrAsl ? ' (sea level)' : ''} · ${st[i].t.toFixed(0)}s</span>` : ''}</div>`).join('');
    const warn = [];
    const fp = st.find((s, i) => ev[i].ignite && ev[i].ignite.length);
    if (!inst.some(p => p.def.engine)) warn.push('No engines');
    if (this.plane) {
      const c = centers(inst, true), air = inst.some(p => p.def.air);
      if (!c.col) warn.push('No wings: it will not fly');
      else if (c.col.y > c.com.y - 0.15) warn.push('Centre of lift is ahead of the centre of mass: unstable. Move wings back.');
      if (air && !inst.some(p => p.def.intake)) warn.push('Jets need an air intake');
      if (!inst.some(p => p.def.gear)) warn.push('No landing gear');
      if (!inst.some(p => p.def.surf && p.def.surf.ctrl && Math.abs(Math.cos(p.ang)) > 0.5 && p.com.y < (c.com ? c.com.y : 0))) warn.push('No elevons behind the centre of mass: it cannot pitch up to take off');
      else { const g = inst.filter(p => p.def.gear); if (!g.some(p => p.com.y < (c.com ? c.com.y : 0))) warn.push('Put main gear just behind the centre of mass'); }
      if (fp && fp.twr < 0.35) warn.push('Thrust is very low for a takeoff');
    } else {
      if (!inst.some(p => p.def.torque)) warn.push('No control pod/core: steering will be weak');
      if (fp && fp.twr < 1) warn.push('First stage TWR &lt; 1: it will not lift off');
    }
    const jets = inst.some(p => p.def.air);
    this.statsEl.innerHTML = `<div class="stot"><b>${craftMass(inst).toFixed(2)} t</b> · Δv <b>${total.toFixed(0)}</b>${jets ? '*' : ''} · TWR <b>${fp ? fp.twr.toFixed(2) : '—'}</b>${warn.length ? ' <span class="warn">⚠' + warn.length + '</span>' : ''} <small class="tog">▾</small></div>
      <div class="srows"><div class="smeta">${this.craft.name || ''} · ${inst.length} parts${jets ? ' · *jets counted at sea level' : ''}</div>${rows}${warn.map(w => `<div class="warn">⚠ ${w}</div>`).join('')}</div>`;
  }
  // attach points for the held part (positions in craft coordinates)
  attachPoints() {
    const id = this.held; if (!id) return [];
    const def = PARTS[id], c = this.craft, pts = [];
    const stackInst = this.inst.filter(p => p.kind === 'stack');
    const angs = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
    const addGroup = (p, gr) => cr => { (cr.stack[p.si].radial = cr.stack[p.si].radial || []).push(gr); };
    if (!isRadial(id)) {
      if (!c.stack.length) { pts.push({ pos: new V3(0, 0.6, 0), act: cr => cr.stack.push({ p: id }) }); return pts; }
      stackInst.forEach((p, i) => pts.push({ pos: new V3(0, p.top, 0), act: cr => cr.stack.splice(p.si, 0, { p: id }) }));
      const last = stackInst[stackInst.length - 1];
      pts.push({ pos: new V3(0, last.bot, 0), act: cr => cr.stack.push({ p: id }) });
      for (const p of this.inst) {
        if (p.kind === 'radial' && p.id === 'rdec' && p.sym === 0) {
          const side = this.inst.filter(q => q.kind === 'side' && q.si === p.si && q.gi === p.gi && q.sym === 0);
          const d = new V3(Math.cos(p.ang), 0, Math.sin(p.ang));
          if (!side.length) pts.push({ pos: p.pos.clone().addScaledVector(d, 0.45 + def.r), act: cr => cr.stack[p.si].radial[p.gi].items.push(id) });
          else {
            const f = side[0], l = side[side.length - 1];
            pts.push({ pos: new V3(f.pos.x, f.top, f.pos.z), act: cr => cr.stack[p.si].radial[p.gi].items.splice(1, 0, id) });
            pts.push({ pos: new V3(l.pos.x, l.bot, l.pos.z), act: cr => { const it = cr.stack[p.si].radial[p.gi].items; it.push(id); } });
          }
        }
      }
    } else if (id === 'rdec') {
      for (const p of stackInst) { if (p.def.r < 0.4) continue; for (const a of angs) { const d = new V3(Math.cos(a), 0, Math.sin(a)); pts.push({ pos: d.multiplyScalar(p.def.r + 0.25).setY(p.top - Math.min(p.def.h, 1.6) / 2), act: addGroup(p, { sym: this.sym, ang: a, items: ['rdec'] }) }); } }
    } else if (id === 'fin' && !this.plane) {
      for (const p of stackInst) { if (p.def.r < 0.3) continue; for (const a of angs) { const d = new V3(Math.cos(a), 0, Math.sin(a)); pts.push({ pos: d.multiplyScalar(p.def.r + 0.3).setY(p.bot + 0.5), act: addGroup(p, { sym: this.sym, ang: a, items: ['fin'] }) }); } }
      for (const p of this.inst) {
        if (p.kind !== 'side' || p.sym !== 0) continue;
        const gr = c.stack[p.si].radial[p.gi]; const side = this.inst.filter(q => q.kind === 'side' && q.si === p.si && q.gi === p.gi && q.sym === 0);
        if (p !== side[side.length - 1] || gr.fins) continue;
        const d = new V3(Math.cos(p.ang), 0, Math.sin(p.ang));
        pts.push({ pos: p.pos.clone().addScaledVector(d, p.def.r + 0.3).setY(p.bot + 0.5), act: cr => { cr.stack[p.si].radial[p.gi].fins = true; } });
      }
    } else {
      // aircraft surface / gear / intake: fixed slots along each fuselage part, always mirrored
      const rk = def.radial, vert = id === 'rudder' || id === 'tailfin';
      const slots = [];
      if (rk === 'surf' || rk === 'fin') { slots.push({ ang: 0, mirror: true }); if (vert) slots.push({ ang: -H, single: true }); }
      if (rk === 'gear') { slots.push({ ang: H, single: true }); slots.push({ ang: H - 0.55, mirror: true }); }
      if (rk === 'intake') slots.push({ ang: -0.75, mirror: true });
      for (const p of stackInst) {
        if (p.def.r < 0.3) continue;
        for (const t of [0.15, 0.5, 0.85]) for (const sl of slots) {
          const d = new V3(Math.cos(sl.ang), 0, Math.sin(sl.ang));
          const rr = p.def.rBot !== undefined ? p.def.r + (p.def.rBot - p.def.r) * (1 - t) : p.def.r;
          pts.push({ pos: d.multiplyScalar(Math.max(0.2, rr) + 0.15).setY(p.bot + p.def.h * t),
            act: addGroup(p, sl.single ? { sym: 1, ang: sl.ang, items: [id], t } : { sym: 2, mirror: true, ang: sl.ang, items: [id], t }) });
        }
      }
    }
    return pts;
  }
  updateMarkers() {
    const g = this.markerGroup; while (g.children.length) g.remove(g.children[0]);
    this.points = this.attachPoints();
    this.points.forEach((pt, i) => {
      const m = new THREE.Mesh(this.markerGeo, this.markerMat); m.position.copy(pt.pos); m.renderOrder = 10; g.add(m);
      // shrink the invisible tap target when slots are close together so neighbours don't steal taps
      let near = Infinity; for (const q of this.points) if (q !== pt) near = Math.min(near, q.pos.distanceTo(pt.pos));
      const h = new THREE.Mesh(this.hitGeo, this.markerHit); h.position.copy(pt.pos); h.scale.setScalar(clamp(near * 0.48 / 0.7, 0.35, 1)); h.userData.point = i; g.add(h);
    });
  }
  refreshSel() {
    this.delBtn.classList.toggle('hidden', !this.sel);
    if (this.sel && this.sel.mesh) { this.selBox.setFromObject(this.sel.mesh); this.selBox.visible = true; } else this.selBox.visible = false;
  }
  deleteSel() {
    const p = this.sel; if (!p) { this.hint('Tap a part to select it first'); return; }
    this.push();
    const c = this.craft;
    if (p.kind === 'stack') c.stack.splice(p.si, 1);
    else {
      const sp = c.stack[p.si], gr = sp.radial[p.gi];
      if (p.item === 0) sp.radial.splice(p.gi, 1);
      else if (p.item === -1) gr.fins = false;
      else { gr.items.splice(p.item, 1); if (!sideItems(gr).length) gr.fins = false; }
    }
    this.sel = null; this.rebuild();
  }
  tap(x, y) {
    const ndc = new THREE.Vector2(x / this.app.W * 2 - 1, -(y / this.app.H) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    if (this.drawerOpen && innerWidth < 1000) { this.setDrawer(false); }
    if (this.held) {
      const hits = this.ray.intersectObjects(this.markerGroup.children.filter(m => m.userData.point !== undefined), false);
      if (hits.length) {
        // several tap targets can line up along the ray: take the one whose centre is nearest the finger on screen
        let best = hits[0].object, bd = Infinity; const v = new V3();
        for (const h of hits) { h.object.getWorldPosition(v); v.project(this.camera); const d = Math.hypot(v.x - ndc.x, v.y - ndc.y); if (d < bd) { bd = d; best = h.object; } }
        const pt = this.points[best.userData.point];
        this.push(); pt.act(this.craft);
        const name = PARTS[this.held].name; this.held = null; this.renderPalette(); this.rebuild(); this.hint('Attached ' + name);
        return;
      }
    }
    const hits = this.ray.intersectObjects(this.craftGroup.children, true);
    if (hits.length) { this.sel = hits[0].object.userData.inst; this.held = null; this.renderPalette(); this.updateMarkers(); this.hint('Selected ' + this.sel.def.name + (this.sel.kind !== 'stack' ? ' (with its mirror copies)' : '')); }
    else { this.sel = null; if (this.held) { this.held = null; this.renderPalette(); this.updateMarkers(); } }
    this.refreshSel();
  }
  loadDialog() {
    const saved = savedCrafts();
    const ex = this.plane ? PLANE_EXAMPLES : EXAMPLES;
    const items = ex.map(c => [`★ ${c.name}`, () => { this.push(); this.craft = clone(c); this.sel = null; this.rebuild(true); }]);
    for (const n of Object.keys(saved)) { const isP = saved[n].kind === 'plane'; if (isP !== this.plane) continue; items.push([`💾 ${n}`, () => { this.push(); this.craft = clone(saved[n]); this.sel = null; this.rebuild(true); }]); }
    if (Object.keys(saved).length) items.push(['🗑 Delete a saved craft…', () => {
      this.app.dialog('Delete saved craft', Object.keys(saved).map(n => [n, () => { deleteCraft(n); this.hint('Deleted ' + n); }]).concat([['Cancel', () => { }]]));
    }]);
    items.push(['Cancel', () => { }]);
    this.app.dialog(this.plane ? 'Load plane' : 'Load rocket', items, '<p>★ stock examples · 💾 saved on this device</p>');
  }
  launch() {
    if (!this.inst.length) { this.hint('Build something first!'); return; }
    this.app.startFlight(clone(this.craft));
  }
  enter(mode) { if (mode && mode !== this.mode) this.setMode(mode); this.ui.classList.remove('hidden'); this.rebuild(true); this.app.renderer.setClearColor(0x1a202b); }
  exit() { this.ui.classList.add('hidden'); }
  update(dt) {
    const c = this.cam;
    const off = new V3(Math.cos(c.pitch) * Math.sin(c.yaw), Math.sin(c.pitch), Math.cos(c.pitch) * Math.cos(c.yaw)).multiplyScalar(c.dist);
    this.camera.position.set(0, c.ty, 0).add(off); this.camera.lookAt(0, c.ty, 0);
    const pulse = 0.7 + 0.3 * Math.sin(performance.now() / 200);
    this.markerMat.opacity = pulse;
  }
  render(r) { r.render(this.scene, this.camera); }
  resize(w, h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  onDrag(dx, dy) { this.cam.yaw -= dx * 0.008; this.cam.pitch = clamp(this.cam.pitch + dy * 0.006, -0.3, 1.4); }
  onPan(dy) { const h = this.plane ? 6 : this.inst.reduce((m, p) => Math.max(m, p.top), 0); this.cam.ty = clamp(this.cam.ty + dy * this.cam.dist * 0.002, 0.5, Math.max(2, h + 2)); }
  onZoom(f) { this.cam.dist = clamp(this.cam.dist * f, 3, 90); }
  onKey(e, down) {
    if (!down || e.target.tagName === 'INPUT') return;
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { this.undo(); e.preventDefault(); }
    else if (e.code === 'Delete' || e.code === 'Backspace') this.deleteSel();
    else if (e.code === 'KeyX' && !this.plane) { this.symBtn.click(); }
  }
}
