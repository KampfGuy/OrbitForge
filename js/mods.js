// Orbit Forge - mod loader. Mods are JSON (parts, worlds, crafts, loading tips) with an optional script that uses the small API below.
// See MODDING.md. Script mods run with the same access as the game: only install mods you trust.
import * as THREE from './vendor/three.module.min.js';
import { PARTS, registerPart } from './parts.js';
import { BODIES, registerBody, elements, fmtDist } from './orbit.js';
import { EXAMPLES, PLANE_EXAMPLES } from './craft.js';
export const API_VERSION = 1;
const DBN = 'orbitforge-mods', ST = 'mods', LSK = 'orbitforge.mods.fallback';

// ---- tiny storage layer: IndexedDB, falling back to localStorage ----
function idb() { return new Promise((res, rej) => { if (!window.indexedDB) return rej(new Error('no IndexedDB')); const r = indexedDB.open(DBN, 1); r.onupgradeneeded = () => r.result.createObjectStore(ST, { keyPath: 'id' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function dbAll() { try { const db = await idb(); return await new Promise((res, rej) => { const q = db.transaction(ST).objectStore(ST).getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error); }); } catch (e) { try { return JSON.parse(localStorage.getItem(LSK) || '[]'); } catch (e2) { return []; } } }
async function dbPut(rec) { try { const db = await idb(); await new Promise((res, rej) => { const t = db.transaction(ST, 'readwrite'); t.objectStore(ST).put(rec); t.oncomplete = res; t.onerror = () => rej(t.error); }); } catch (e) { const all = JSON.parse(localStorage.getItem(LSK) || '[]').filter(m => m.id !== rec.id); all.push(rec); localStorage.setItem(LSK, JSON.stringify(all)); } }
async function dbDel(id) { try { const db = await idb(); await new Promise((res, rej) => { const t = db.transaction(ST, 'readwrite'); t.objectStore(ST).delete(id); t.oncomplete = res; t.onerror = () => rej(t.error); }); } catch (e) { localStorage.setItem(LSK, JSON.stringify(JSON.parse(localStorage.getItem(LSK) || '[]').filter(m => m.id !== id))); } }

export function validateMod(m) {
  if (!m || typeof m !== 'object') throw new Error('not a JSON object');
  if (!/^[a-z0-9][a-z0-9._\-]{1,48}$/i.test(m.id || '')) throw new Error('"id" must be 2-48 letters, digits, dots, dashes');
  if (!m.name || typeof m.name !== 'string') throw new Error('"name" is required');
  if (m.api && +m.api > API_VERSION) throw new Error('mod needs a newer Orbit Forge (api ' + m.api + ')');
  if (m.parts && typeof m.parts !== 'object') throw new Error('"parts" must be an object of id → part');
  if (m.planets && !Array.isArray(m.planets)) throw new Error('"planets" must be an array');
  if (m.crafts && !Array.isArray(m.crafts)) throw new Error('"crafts" must be an array');
  if (m.tips && !Array.isArray(m.tips)) throw new Error('"tips" must be an array of strings');
  if (m.script && typeof m.script !== 'string') throw new Error('"script" must be a string of JavaScript');
  return m;
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

class ModManager {
  constructor() { this.records = []; this.loaded = []; this.hooks = { load: [], flightStart: [], update: [], stage: [], crash: [] }; this.btns = []; this.errors = {}; this.apis = {}; this.tips = []; this.changed = false; }
  async init() {
    this.records = await dbAll();
    for (const r of this.records) if (r.enabled) this.apply(r.mod);
    this.emit('load');
  }
  apply(m) {
    const info = { id: m.id, name: m.name, parts: 0, planets: 0, crafts: 0, script: !!m.script, error: null };
    try {
      for (const [id, def] of Object.entries(m.parts || {})) { registerPart(id, Object.assign({}, def, { mod: m.id })); info.parts++; }
      for (const pd of m.planets || []) { registerBody(Object.assign({}, pd, { mod: m.id })); info.planets++; }
      for (const c of m.crafts || []) { this.addCraft(c); info.crafts++; }
      for (const t of m.tips || []) this.addTip(t);
      if (m.script) { const api = this.api(m); new Function('api', '"use strict";\n' + m.script + '\n//# sourceURL=orbitforge-mod-' + m.id + '.js')(api); }
    } catch (e) { info.error = e.message; this.errors[m.id] = e.message; console.warn('[mod ' + m.id + ']', e); }
    this.loaded.push(info);
  }
  addCraft(c) {
    if (!c || !Array.isArray(c.stack) || !c.stack.length) throw new Error('craft needs a "stack" array');
    for (const s of c.stack) { if (!PARTS[s.p]) throw new Error('craft "' + c.name + '" uses unknown part ' + s.p); for (const g of s.radial || []) for (const it of g.items || []) if (!PARTS[it]) throw new Error('craft uses unknown part ' + it); }
    const cc = JSON.parse(JSON.stringify(c)); cc.name = cc.name || 'Mod craft'; cc.fromMod = true;
    (cc.kind === 'plane' ? PLANE_EXAMPLES : EXAMPLES).push(cc);
  }
  addTip(t) { if (typeof t === 'string' && t.length < 140) { this.tips.push(t); if (window.__loader && window.__loader.addTips) window.__loader.addTips([t]); } }
  // the API object handed to mod scripts
  api(m) {
    if (this.apis[m.id]) return this.apis[m.id];
    const self = this, on = k => fn => { if (typeof fn === 'function') self.hooks[k].push({ fn, mod: m.id }); };
    const store = 'orbitforge.mod.' + m.id + '.';
    const a = this.apis[m.id] = {
      version: API_VERSION, THREE, mod: { id: m.id, name: m.name, version: m.version || '' },
      registerPart: (id, def) => registerPart(id, Object.assign({}, def, { mod: m.id })),
      registerPlanet: def => registerBody(Object.assign({}, def, { mod: m.id })),
      registerCraft: c => self.addCraft(c), addTip: t => self.addTip(t),
      onLoad: on('load'), onFlightStart: on('flightStart'), onUpdate: on('update'), onStage: on('stage'), onCrash: on('crash'),
      addUIButton: o => { if (!o || typeof o.onClick !== 'function') throw new Error('addUIButton needs {label, onClick}'); self.btns.push({ label: String(o.label || 'Mod').slice(0, 12), icon: o.icon, where: o.where || 'flight', onClick: o.onClick, mod: m.id }); },
      toast: (msg, ms) => { const F = window.OF && window.OF.flight; if (F && window.OF.mode === 'flight') F.toast(String(msg), ms || 3000); },
      get flight() { return self.view(); },
      ui: { panel(cls) { const d = document.createElement('div'); d.className = 'modpanel ' + (cls || ''); d.dataset.mod = m.id; document.getElementById('ui').appendChild(d); return d; } },
      storage: { get: k => { try { return JSON.parse(localStorage.getItem(store + k)); } catch (e) { return null; } }, set: (k, v) => localStorage.setItem(store + k, JSON.stringify(v)) },
      log: (...x) => console.log('[mod ' + m.id + ']', ...x),
      get game() { return window.OF; },
    };
    return a;
  }
  // read-only snapshot of the flight for scripts
  view() {
    const OF = window.OF, F = OF && OF.flight; if (!F || !F.r || OF.mode !== 'flight') return null;
    const b = F.body, f = F.frame(), vs = F.v.clone().sub(F.groundVel(F.r, new THREE.Vector3())), alt = F.r.length() - b.radius, el = elements(F.r, F.v, b.mu);
    const nose = new THREE.Vector3(0, 1, 0).applyQuaternion(F.q), burn = F._lastBurn, g = b.mu / F.r.lengthSq();
    return {
      body: b.name, alt, radar: F.lowestAlt(), speed: F.v.length(), srfSpeed: vs.length(), vSpeed: vs.dot(f.up), mach: vs.length() / 340, q: (F.q_dyn || 0) / 1000,
      ap: el.ecc < 1 ? el.ra - b.radius : Infinity, pe: el.rp - b.radius, throttle: F.throttle, mass: F.mass, thrust: burn ? burn.F : 0, twr: burn ? burn.F / (F.mass * g) : 0,
      pitch: Math.asin(Math.max(-1, Math.min(1, nose.dot(f.up)))) * 180 / Math.PI, heading: ((Math.atan2(nose.dot(f.east), nose.dot(f.north)) * 180 / Math.PI) + 360) % 360,
      met: F.t - F.t0, landed: F.landed, contact: F.contact, destroyed: F.destroyed, stage: F.events.length - F.prop.next, heat: F.heatMax || 0, craft: F.craft.name,
      situation: F.destroyed ? 'destroyed' : F.landed ? 'landed' : F.contact ? 'ground' : b.atm && alt < b.atm.height ? 'flying' : el.rp < b.radius ? 'suborbital' : el.ecc >= 1 ? 'escaping' : 'orbiting',
      fmtDist,
    };
  }
  emit(name, ...args) {
    const list = this.hooks[name]; if (!list || !list.length) return;
    const v = name === 'update' || name === 'flightStart' || name === 'stage' || name === 'crash' ? this.view() : null;
    for (let i = list.length - 1; i >= 0; i--) {
      const h = list[i];
      try { name === 'update' ? h.fn(args[0], v) : h.fn(v, args[1]); }
      catch (e) { h.err = (h.err || 0) + 1; console.warn('[mod ' + h.mod + ']', e); if (h.err >= 3) { list.splice(i, 1); this.errors[h.mod] = e.message; const F = window.OF && window.OF.flight; if (F && F.toast) F.toast('Mod "' + h.mod + '" keeps failing and was paused: ' + e.message, 4000); } }
    }
  }
  safe(mod, fn) { try { fn(); } catch (e) { console.warn('[mod ' + mod + ']', e); const F = window.OF && window.OF.flight; if (F && F.toast) F.toast('Mod error: ' + e.message, 3000); } }
  buttons(where) { return this.btns.filter(b => b.where === where); }
  // ---------- install / remove ----------
  async install(m, source) { validateMod(m); const rec = { id: m.id, mod: m, enabled: true, source: source || 'file', installed: Date.now() }; await dbPut(rec); this.records = this.records.filter(r => r.id !== m.id).concat([rec]); this.changed = true; }
  async setEnabled(id, on) { const r = this.records.find(x => x.id === id); if (!r) return; r.enabled = on; await dbPut(r); this.changed = true; }
  async remove(id) { await dbDel(id); this.records = this.records.filter(r => r.id !== id); this.changed = true; }
  // ---------- the Mods screen ----------
  async menu(app) {
    let examples = [];
    try { examples = await (await fetch('mods/index.json', { cache: 'no-cache' })).json(); } catch (e) { }
    const loadedIds = new Set(this.loaded.map(l => l.id));
    const rows = this.records.map(r => {
      const m = r.mod, l = this.loaded.find(x => x.id === r.id), err = this.errors[r.id];
      const what = [m.parts ? Object.keys(m.parts).length + ' parts' : '', m.planets ? m.planets.length + ' world' + (m.planets.length > 1 ? 's' : '') : '', m.crafts ? m.crafts.length + ' craft' : '', m.tips ? m.tips.length + ' tips' : '', m.script ? '<b class="scr">script</b>' : ''].filter(Boolean).join(' · ');
      const state = r.enabled !== loadedIds.has(r.id) ? ' <i>(reload to apply)</i>' : '';
      return `<div class="modrow"><div><b>${esc(m.name)}</b> <small>${esc(m.version || '')} ${m.author ? 'by ' + esc(m.author) : ''}</small><br><small>${what}${state}</small>${err ? `<br><small class="warn">⚠ ${esc(err)}</small>` : ''}</div>
        <button data-on="${esc(r.id)}" class="${r.enabled ? 'on' : ''}">${r.enabled ? 'ON' : 'OFF'}</button><button data-del="${esc(r.id)}">🗑</button></div>`;
    }).join('') || '<p class="small">No mods installed yet.</p>';
    const ex = examples.filter(e => !this.records.some(r => r.id === e.id)).map(e => `<div class="modrow"><div><b>${esc(e.name)}</b><br><small>${esc(e.desc || '')}${e.script ? ' · <b class="scr">script</b>' : ''}</small></div><button data-ex="${esc(e.file)}">Install</button></div>`).join('');
    const html = `<p class="modwarn">⚠ Script mods run JavaScript inside the game, with the same access the game has (your saves on this device). Only install mods from people you trust.</p>
      <div class="modlist">${rows}</div>
      <h3>Install a mod</h3><div class="modinst"><label class="mb filebtn">📄 From file…<input type="file" accept=".json,application/json" hidden></label>
      <div class="urlrow"><input type="url" placeholder="https://…/my-mod.json" class="urlin"><button class="urlgo">Get</button></div></div>
      ${ex ? `<h3>Example mods</h3><div class="modlist">${ex}</div>` : ''}
      <p class="small">Make your own: see <a href="https://github.com/KampfGuy/OrbitForge/blob/main/MODDING.md" target="_blank" rel="noopener">MODDING.md</a>. Changes apply after a reload.</p>`;
    const btns = [];
    if (this.changed) btns.push(['⟳ Reload to apply', () => location.reload()]);
    btns.push(['Close', () => { }]);
    app.dialog('🧩 Mods', btns, html);
    const d = document.getElementById('dialog');
    const again = () => this.menu(app);
    const ask = (m, src) => {
      if (!m.script) return this.install(m, src).then(again);
      app.dialog('This mod runs code', [['Install anyway', () => this.install(m, src).then(again)], ['Cancel', again]],
        `<p class="modwarn">"${esc(m.name)}" ${m.author ? 'by ' + esc(m.author) : ''} contains a script. Scripts can do anything the game can do on this device. Only continue if you trust where it came from.</p>`);
    };
    const fail = e => app.dialog('Could not install', [['OK', again]], `<p>${esc(e.message || e)}</p>`);
    const parse = (txt, src) => { let m; try { m = validateMod(JSON.parse(txt)); } catch (e) { return fail(e); } ask(m, src); };
    d.querySelectorAll('[data-on]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); const r = this.records.find(x => x.id === b.dataset.on); this.setEnabled(r.id, !r.enabled).then(again); }));
    d.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); this.remove(b.dataset.del).then(again); }));
    d.querySelectorAll('[data-ex]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); fetch('mods/' + b.dataset.ex).then(r => r.text()).then(t => parse(t, 'example')).catch(fail); }));
    const fi = d.querySelector('input[type=file]'); fi.addEventListener('change', () => { const f = fi.files[0]; if (!f) return; if (f.size > 2e6) return fail(new Error('mod file is larger than 2 MB')); f.text().then(t => parse(t, 'file')); });
    d.querySelector('.urlgo').addEventListener('click', e => { e.stopPropagation(); const u = d.querySelector('.urlin').value.trim(); if (!/^https?:\/\//.test(u)) return fail(new Error('enter a full http(s) URL')); fetch(u).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); }).then(t => parse(t, u)).catch(e => fail(new Error('Download failed (' + e.message + '). The site must allow cross-origin requests (CORS).'))); });
  }
}
export const MODS = new ModManager();
