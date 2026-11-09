// Orbit Forge - 3D rocket builder ("the Forge")
import * as THREE from './vendor/three.module.min.js';
import { PARTS, CATS, makePartMesh } from './parts.js';
import { layout, buildEvents, stageStats, eventLabel, craftMass, sideItems, EXAMPLES, savedCrafts, saveCraft, deleteCraft, clone } from './craft.js';
import { HOME, clamp } from './orbit.js';
const V3 = THREE.Vector3, TAU = Math.PI * 2;
function el(tag, cls, html, parent) { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; if (parent) parent.appendChild(e); return e; }
const isRadial = id => !!PARTS[id].radial;

export class Builder {
  constructor(app) {
    this.app = app;
    const s = this.scene = new THREE.Scene();
    s.background = new THREE.Color(0x1a202b);
    s.add(new THREE.HemisphereLight(0xe4ecff, 0x3a3530, 1.4));
    const d = new THREE.DirectionalLight(0xffffff, 1.8); d.position.set(6, 12, 8); s.add(d);
    const d2 = new THREE.DirectionalLight(0x9fb8ff, 0.6); d2.position.set(-8, 4, -6); s.add(d2);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 48), new THREE.MeshLambertMaterial({ color: 0x3b4250 })); floor.rotation.x = -Math.PI / 2; s.add(floor);
    const grid = new THREE.GridHelper(60, 30, 0x5c6778, 0x485160); grid.position.y = 0.01; s.add(grid);
    const pm = new THREE.MeshLambertMaterial({ color: 0x59606c });
    for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; const b = new THREE.Mesh(new THREE.BoxGeometry(1.2, 40, 1.2), pm); b.position.set(Math.cos(a) * 26, 20, Math.sin(a) * 26); s.add(b); }
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(26.5, 26.5, 1.2, 48, 1, true), new THREE.MeshBasicMaterial({ color: 0xe0a020, side: THREE.BackSide })); stripe.position.y = 3; s.add(stripe);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
    this.cam = { yaw: 0.7, pitch: 0.25, dist: 16, ty: 4 };
    this.craftGroup = new THREE.Group(); s.add(this.craftGroup);
    this.markerGroup = new THREE.Group(); s.add(this.markerGroup);
    this.markerMat = new THREE.MeshBasicMaterial({ color: 0x3cff8a, transparent: true, opacity: 0.85, depthTest: false });
    this.markerHit = new THREE.MeshBasicMaterial({ visible: false });
    this.markerGeo = new THREE.SphereGeometry(0.22, 12, 8); this.hitGeo = new THREE.SphereGeometry(0.7, 8, 6);
    this.sel = null; this.held = null; this.sym = 2; this.history = []; this.cat = 'Pods';
    this.selBox = new THREE.BoxHelper(undefined, 0x3cff8a); this.selBox.visible = false; s.add(this.selBox);
    this.ray = new THREE.Raycaster();
    this.buildUI();
    this.craft = this.loadCurrent() || clone(EXAMPLES[1]);
    this.rebuild(true);
  }
  loadCurrent() { try { return JSON.parse(localStorage.getItem('orbitforge.current')); } catch (e) { return null; } }
  buildUI() {
    const ui = this.ui = el('div', 'bui hidden', '', document.getElementById('ui'));
    const top = el('div', 'btop', '', ui);
    const btn = (label, fn, cls) => { const b = el('button', 'bb ' + (cls || ''), label, top); b.addEventListener('click', e => { e.stopPropagation(); fn(b); }); return b; };
    btn('☰', () => this.app.toMenu());
    this.nameIn = el('input', 'bname', '', top); this.nameIn.maxLength = 28; this.nameIn.addEventListener('input', () => { this.craft.name = this.nameIn.value; this.persist(); });
    btn('New', () => { this.push(); this.craft = { name: 'Untitled Rocket', stack: [] }; this.sel = null; this.rebuild(true); });
    btn('Load', () => this.loadDialog());
    btn('Save', () => { saveCraft(clone(this.craft)); this.hint('Saved "' + this.craft.name + '" on this device'); });
    btn('Undo', () => this.undo());
    this.symBtn = btn('Sym ×2', () => { const o = [1, 2, 3, 4, 6]; this.sym = o[(o.indexOf(this.sym) + 1) % o.length]; this.symBtn.textContent = 'Sym ×' + this.sym; this.updateMarkers(); });
    this.delBtn = btn('Delete', () => this.deleteSel(), 'danger');
    btn('LAUNCH ▶', () => this.launch(), 'go');
    this.statsEl = el('div', 'bstats panel scrolly' + (innerWidth < innerHeight ? ' compact' : ''), '', ui);
    this.statsEl.addEventListener('click', () => this.statsEl.classList.toggle('compact'));
    this.hintEl = el('div', 'bhint', '', ui);
    const pal = el('div', 'palette panel', '', ui);
    this.tabs = el('div', 'tabs', '', pal); this.plist = el('div', 'plist scrolly', '', pal);
    for (const c of CATS) { const t = el('button', 'tab', c, this.tabs); t.addEventListener('click', () => { this.cat = c; this.renderPalette(); }); }
    this.renderPalette();
  }
  renderPalette() {
    [...this.tabs.children].forEach(t => t.classList.toggle('on', t.textContent === this.cat));
    this.plist.innerHTML = '';
    for (const [id, p] of Object.entries(PARTS)) {
      if (p.cat !== this.cat) continue;
      let info = `${p.mass.toFixed(2)} t`;
      if (p.thrust) info += ` · ${p.thrust} kN · Isp ${p.ispA}/${p.ispV}`;
      if (p.fuel && !p.srb) info += ` · fuel ${p.fuel.toFixed(2)} t`;
      if (p.crew) info += ` · ${p.crew} crew`;
      const b = el('button', 'pbtn' + (this.held === id ? ' on' : ''), `<b>${p.name}</b><small>${info}</small><small class="desc">${p.desc}</small>`, this.plist);
      b.addEventListener('click', () => { this.held = this.held === id ? null : id; this.sel = null; this.renderPalette(); this.updateMarkers(); this.refreshSel();
        if (this.held) this.hint(this.craft.stack.length || isRadial(id) ? 'Tap a green dot to attach ' + p.name + (isRadial(id) ? ` (symmetry ×${this.sym})` : '') : 'Tap the green dot to place your first part'); });
    }
  }
  hint(t) { this.hintEl.textContent = t; this.hintEl.classList.add('show'); clearTimeout(this._ht); this._ht = setTimeout(() => this.hintEl.classList.remove('show'), 4000); }
  push() { this.history.push(JSON.stringify(this.craft)); if (this.history.length > 60) this.history.shift(); }
  undo() { if (!this.history.length) { this.hint('Nothing to undo'); return; } this.craft = JSON.parse(this.history.pop()); this.sel = null; this.rebuild(); }
  persist() { try { localStorage.setItem('orbitforge.current', JSON.stringify(this.craft)); } catch (e) { } }
  rebuild(frame) {
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
    const h = this.inst.reduce((m, p) => Math.max(m, p.top), 0);
    if (this._lastH !== undefined && Math.abs(h - this._lastH) > 0.4) frame = true;
    this._lastH = h;
    if (frame) { this.cam.ty = Math.max(1.5, h / 2); this.cam.dist = Math.max(9, h * 1.5 + 4); }
    this.updateMarkers(); this.refreshSel(); this.updateStats();
  }
  updateStats() {
    const inst = this.inst;
    if (!inst.length) { this.statsEl.innerHTML = '<b>Empty craft</b><br>Pick a pod from the parts list.'; return; }
    const ev = buildEvents(inst), st = stageStats(inst, ev, HOME.g);
    const total = st.reduce((a, s) => a + s.dvVac, 0);
    const rows = ev.map((e, i) => `<div class="srow"><span class="sn">${i + 1}</span><span class="sl">${eventLabel(inst, e)}</span>${st[i].dvVac > 0.5 ? `<span class="sd">Δv ${st[i].dvVac.toFixed(0)} · TWR ${st[i].twr.toFixed(2)}${st[i].twrAsl ? ' (pad)' : ''} · ${st[i].t.toFixed(0)}s</span>` : ''}</div>`).join('');
    const warn = [];
    if (!inst.some(p => p.def.torque)) warn.push('No control pod/core: steering will be weak');
    const fp = st.find((s, i) => ev[i].ignite && ev[i].ignite.length);
    if (fp && fp.twr < 1) warn.push('First stage TWR &lt; 1: it will not lift off');
    if (!inst.some(p => p.def.engine)) warn.push('No engines');
    this.statsEl.innerHTML = `<div class="stot"><b>${this.craft.name || 'Rocket'}</b><br>${craftMass(inst).toFixed(2)} t · ${inst.length} parts · <b>Δv ${total.toFixed(0)} m/s</b> (vac) <small class="tog">▾ stages</small></div><div class="srows">${rows}</div>${warn.map(w => `<div class="warn">⚠ ${w}</div>`).join('')}`;
  }
  // attach points for the held part
  attachPoints() {
    const id = this.held; if (!id) return [];
    const def = PARTS[id], c = this.craft, pts = [];
    const stackInst = this.inst.filter(p => p.kind === 'stack');
    const angs = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
    if (!isRadial(id)) {
      if (!c.stack.length) { pts.push({ pos: new V3(0, 0.6, 0), act: cr => cr.stack.push({ p: id }) }); return pts; }
      stackInst.forEach((p, i) => pts.push({ pos: new V3(0, p.top, 0), act: cr => cr.stack.splice(p.si, 0, { p: id }) }));
      const last = stackInst[stackInst.length - 1];
      pts.push({ pos: new V3(0, last.bot, 0), act: cr => cr.stack.push({ p: id }) });
      // side stacks of radial groups
      for (const p of this.inst) {
        if (p.kind === 'radial' && p.id === 'rdec' && p.sym === 0) {
          const gr = c.stack[p.si].radial[p.gi]; const side = this.inst.filter(q => q.kind === 'side' && q.si === p.si && q.gi === p.gi && q.sym === 0);
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
      for (const p of stackInst) { if (p.def.r < 0.4) continue; for (const a of angs) { const d = new V3(Math.cos(a), 0, Math.sin(a)); pts.push({ pos: d.multiplyScalar(p.def.r + 0.25).setY(p.top - Math.min(p.def.h, 1.6) / 2), act: cr => { (cr.stack[p.si].radial = cr.stack[p.si].radial || []).push({ sym: this.sym, ang: a, items: ['rdec'] }); } }); } }
    } else if (id === 'fin') {
      for (const p of stackInst) { if (p.def.r < 0.3) continue; for (const a of angs) { const d = new V3(Math.cos(a), 0, Math.sin(a)); pts.push({ pos: d.multiplyScalar(p.def.r + 0.3).setY(p.bot + 0.5), act: cr => { (cr.stack[p.si].radial = cr.stack[p.si].radial || []).push({ sym: this.sym, ang: a, items: ['fin'] }); } }); } }
      for (const p of this.inst) {
        if (p.kind !== 'side' || p.sym !== 0) continue;
        const gr = c.stack[p.si].radial[p.gi]; const side = this.inst.filter(q => q.kind === 'side' && q.si === p.si && q.gi === p.gi && q.sym === 0);
        if (p !== side[side.length - 1] || gr.fins) continue;
        const d = new V3(Math.cos(p.ang), 0, Math.sin(p.ang));
        pts.push({ pos: p.pos.clone().addScaledVector(d, p.def.r + 0.3).setY(p.bot + 0.5), act: cr => { cr.stack[p.si].radial[p.gi].fins = true; } });
      }
    }
    return pts;
  }
  updateMarkers() {
    const g = this.markerGroup; while (g.children.length) g.remove(g.children[0]);
    this.points = this.attachPoints();
    this.points.forEach((pt, i) => {
      const m = new THREE.Mesh(this.markerGeo, this.markerMat); m.position.copy(pt.pos); m.renderOrder = 10; g.add(m);
      const h = new THREE.Mesh(this.hitGeo, this.markerHit); h.position.copy(pt.pos); h.userData.point = i; g.add(h);
    });
  }
  refreshSel() {
    this.delBtn.disabled = !this.sel;
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
    if (this.held) {
      const hits = this.ray.intersectObjects(this.markerGroup.children.filter(m => m.userData.point !== undefined), false);
      if (hits.length) {
        const pt = this.points[hits[0].object.userData.point];
        this.push(); pt.act(this.craft);
        const name = PARTS[this.held].name; this.held = null; this.renderPalette(); this.rebuild(); this.hint('Attached ' + name);
        return;
      }
    }
    const hits = this.ray.intersectObjects(this.craftGroup.children, true);
    if (hits.length) { this.sel = hits[0].object.userData.inst; this.held = null; this.renderPalette(); this.updateMarkers(); this.hint('Selected ' + this.sel.def.name + ' · Delete removes it' + (this.sel.kind !== 'stack' ? ' (and its symmetry copies)' : '')); }
    else { this.sel = null; if (this.held) { this.held = null; this.renderPalette(); this.updateMarkers(); } }
    this.refreshSel();
  }
  loadDialog() {
    const saved = savedCrafts();
    const items = EXAMPLES.map(c => [`★ ${c.name}`, () => { this.push(); this.craft = clone(c); this.sel = null; this.rebuild(true); }]);
    for (const n of Object.keys(saved)) items.push([`💾 ${n}`, () => { this.push(); this.craft = clone(saved[n]); this.sel = null; this.rebuild(true); }]);
    if (Object.keys(saved).length) items.push(['🗑 Delete a saved craft…', () => {
      this.app.dialog('Delete saved craft', Object.keys(saved).map(n => [n, () => { deleteCraft(n); this.hint('Deleted ' + n); }]).concat([['Cancel', () => { }]]));
    }]);
    items.push(['Cancel', () => { }]);
    this.app.dialog('Load craft', items, '<p>★ stock examples · 💾 saved on this device</p>');
  }
  launch() {
    if (!this.inst.length) { this.hint('Build something first!'); return; }
    this.app.startFlight(clone(this.craft));
  }
  enter() { this.ui.classList.remove('hidden'); this.rebuild(); this.app.renderer.setClearColor(0x1a202b); }
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
  onPan(dy) { const h = this.inst.reduce((m, p) => Math.max(m, p.top), 0); this.cam.ty = clamp(this.cam.ty + dy * this.cam.dist * 0.002, 0.5, Math.max(2, h + 2)); }
  onZoom(f) { this.cam.dist = clamp(this.cam.dist * f, 3, 90); }
  onKey(e, down) {
    if (!down || e.target.tagName === 'INPUT') return;
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { this.undo(); e.preventDefault(); }
    else if (e.code === 'Delete' || e.code === 'Backspace') this.deleteSel();
    else if (e.code === 'KeyX') { this.symBtn.click(); }
  }
}
