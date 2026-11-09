// Orbit Forge - app shell: renderer, screens, input, adaptive quality
import * as THREE from './vendor/three.module.min.js';
import { Builder } from './builder.js';
import { Flight } from './flight.js';

const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
class App {
  constructor() {
    this.canvas = document.getElementById('c');
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: !isTouch || devicePixelRatio < 2.5, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    } catch (e) {
      document.getElementById('boot').innerHTML = '<h2>WebGL is not available</h2><p>Orbit Forge needs WebGL. On iPhone, update iOS and make sure Safari isn\'t in Lockdown Mode.</p>';
      throw e;
    }
    this.renderer = renderer;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.maxPR = Math.min(window.devicePixelRatio || 1, isTouch ? 2 : 2);
    this.pr = Math.min(this.maxPR, isTouch ? 1.5 : 2);
    this.quality = localStorage.getItem('orbitforge.quality') || 'auto';
    const L = window.__loader || { set() { }, done(cb) { cb && cb(); } };
    L.set(0.72, 'Building the Forge and the Hangar…');
    this.builder = new Builder(this);
    L.set(0.84, 'Rolling out the runway…');
    this.flight = new Flight(this);
    L.set(0.95, 'Warming up the shaders…');
    this.mode = 'menu';
    this.resize();
    addEventListener('resize', () => this.resize());
    addEventListener('orientationchange', () => setTimeout(() => this.resize(), 200));
    this.bindInput();
    this.buildMenu();
    this.frames = []; this.lastQ = performance.now();
    this.last = performance.now();
    try { this.renderer.compile(this.builder.scene, this.builder.camera); } catch (e) { }
    L.set(1, 'Ready');
    L.done(() => this.rotateHint());
    const loop = (now) => { requestAnimationFrame(loop); this.tick(now); };
    requestAnimationFrame(loop);
  }
  resize() {
    const w = window.innerWidth, h = window.innerHeight; this.W = w; this.H = h;
    this.renderer.setPixelRatio(this.pr); this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
    this.builder.resize(w, h); this.flight.resize(w, h);
    document.body.classList.toggle('landscape', w > h); document.body.classList.toggle('portrait', w <= h);
  }
  tick(now) {
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    const t0 = performance.now();
    if (this.mode === 'builder') { this.builder.update(dt); this.builder.render(this.renderer); }
    else if (this.mode === 'flight') { this.flight.update(dt); this.flight.render(this.renderer); }
    else { this.menuSpin = (this.menuSpin || 0) + dt; this.builder.cam.yaw += dt * 0.15; this.builder.update(dt); this.builder.render(this.renderer); }
    this.frames.push(dt * 1000);
    if (this.frames.length > 90) this.frames.shift();
    this.cpuMs = performance.now() - t0;
    // adaptive resolution
    if (this.quality === 'auto' && now - this.lastQ > 2500 && this.frames.length >= 60) {
      const avg = this.frames.reduce((a, b) => a + b, 0) / this.frames.length;
      let npr = this.pr;
      if (avg > 26 && this.pr > 0.75) npr = Math.max(0.75, this.pr - 0.25);
      else if (avg < 15 && this.pr < this.maxPR) npr = Math.min(this.maxPR, this.pr + 0.25);
      if (npr !== this.pr) { this.pr = npr; this.resize(); this.frames = []; }
      this.lastQ = now;
    }
    this.fps = 1000 / (this.frames.reduce((a, b) => a + b, 0) / Math.max(1, this.frames.length));
  }
  setQuality(q) {
    this.quality = q; localStorage.setItem('orbitforge.quality', q);
    if (q === 'low') this.pr = 1; else if (q === 'high') this.pr = this.maxPR; else this.pr = Math.min(this.maxPR, 1.5);
    this.resize();
  }
  // ---------- screens ----------
  buildMenu() {
    const m = this.menuEl = document.getElementById('menu');
    m.innerHTML = `<div class="mcard"><h1>ORBIT<span>FORGE</span></h1><p class="tag">Build rockets. Reach orbit. Land on Lumo.</p>
      <div class="mrow"><button data-a="build" class="mb go">🚀 Forge<small>build rockets</small></button>
      <button data-a="hangar" class="mb go">✈ Hangar<small>build spaceplanes</small></button></div>
      <div class="mrow"><button data-a="quick" class="mb">Quick launch<small>Forge-1 Orbiter</small></button>
      <button data-a="quickp" class="mb">Quick takeoff<small>Kestrel Jet</small></button></div>
      <button data-a="help" class="mb">❓ How to Fly</button>
      <button data-a="settings" class="mb">⚙ Graphics: <span id="qlab"></span></button>
      <button data-a="credits" class="mb">✨ Credits</button>
      <p class="by">By: Kampfguy</p></div>`;
    document.getElementById('qlab').textContent = this.quality;
    m.addEventListener('click', e => {
      const a = e.target.closest('button')?.dataset.a; if (!a) return;
      if (a === 'build') this.toBuilder('vab');
      if (a === 'hangar') this.toBuilder('sph');
      if (a === 'quickp') { import('./craft.js').then(c => this.startFlight(c.clone(c.PLANE_EXAMPLES[0]))); }
      if (a === 'quick') { import('./craft.js').then(c => this.startFlight(c.clone(c.EXAMPLES[1]))); }
      if (a === 'credits') this.dialog('Credits', [['Close', () => { }]], `<div class="credits"><h2>Orbit Forge</h2><p class="big">By: Kampfguy</p><p>An original rocket-building and orbital flight game.<br>Home world Kampa, moons Lumo and Pip.</p><p>3D engine: three.js (MIT licence)</p></div>`);
      if (a === 'settings') { const o = ['auto', 'low', 'high']; this.setQuality(o[(o.indexOf(this.quality) + 1) % 3]); document.getElementById('qlab').textContent = this.quality; }
      if (a === 'help') this.dialog('How to fly', [['Got it', () => { }]], `<div class="help">
        <p><b>Build:</b> pick a part tab, tap a part, then tap a green dot. Side Splitters + boosters use symmetry (Sym button). Stages are worked out automatically; Δv and TWR show live.</p>
        <p><b>Launch:</b> throttle to max (slider / Shift / Z), press STAGE (Space). Turn SAS on (T).</p>
        <p><b>Gravity turn:</b> at ~250 m/s (≈ 8 km) tilt east (D key / joystick right) to ~45° by 15 km, then lower. Aim for Ap 80 km, cut throttle, coast, and burn prograde at Ap to circularise.</p>
        <p><b>Map (M):</b> tap your orbit line or press + Node to make a maneuver node. Use the panel to add prograde/normal/radial Δv. Point SAS at ◆ and burn when the timer says.</p>
        <p><b>Keys:</b> W/S pitch · A/D yaw · Q/E roll · Shift/Ctrl throttle · Z max · X cut · Space stage · T SAS · M map · , . warp · Esc menu</p>
        <p><b>Planes (Hangar):</b> cockpit at the front, wings mirrored, main gear just behind the yellow CoM, blue CoL behind it. On the runway: STAGE starts the jet, full throttle, hold the stick down (S) at ~70 m/s to rotate. G = gear, B = brakes. The stick banks the plane in the air and steers it on the ground.</p>
        <p><b>Spaceplanes:</b> the Twinmode Hybrid breathes air up to about 25 km and Mach 5, then switches to rocket mode on its own.</p>
        <p><b>Landing:</b> stage the parachute before 20 km on the way down; touch down under ${11} m/s. Recover on Kampa.</p></div>`);
    });
  }
  show(mode, sub) {
    this.mode = mode;
    this.menuEl.classList.toggle('hidden', mode !== 'menu');
    if (mode === 'builder') this.builder.enter(sub); else this.builder.exit();
    if (mode !== 'flight') this.flight.stop();
    if (mode !== 'flight') this.renderer.setClearColor(0x1a202b);
  }
  toMenu() { this.closeDialog(); this.show('menu'); }
  toBuilder(sub) { if (!sub && this.mode === 'flight' && this.flight.craft) sub = this.flight.craft.kind === 'plane' ? 'sph' : 'vab'; this.closeDialog(); this.show('builder', sub); }
  rotateHint() {
    if (!isTouch || localStorage.getItem('orbitforge.rotateHint') === 'off') return;
    const d = document.createElement('div'); d.className = 'rotate';
    d.innerHTML = '<span class="ph">📱</span><span>Turn your phone sideways for the full cockpit</span><button aria-label="Dismiss">✕</button>';
    d.querySelector('button').addEventListener('click', () => { localStorage.setItem('orbitforge.rotateHint', 'off'); d.remove(); });
    document.body.appendChild(d); setTimeout(() => d.remove(), 7000);
  }
  startFlight(craft) { this.closeDialog(); this.show('flight'); this.flight.start(craft); }
  dialog(title, buttons, html = '') {
    const d = document.getElementById('dialog');
    d.innerHTML = `<div class="dcard scrolly"><h2>${title}</h2>${html}<div class="dbtns"></div></div>`;
    const bx = d.querySelector('.dbtns');
    for (const [lab, fn] of buttons) { const b = document.createElement('button'); b.className = 'mb'; b.textContent = lab; b.addEventListener('click', () => { this.closeDialog(); fn(); }); bx.appendChild(b); }
    d.classList.remove('hidden');
  }
  closeDialog() { document.getElementById('dialog').classList.add('hidden'); }
  // ---------- input ----------
  bindInput() {
    const c = this.canvas, ptrs = new Map();
    let tapStart = null, lastPinch = null, lastMid = null;
    const target = () => this.mode === 'flight' ? this.flight : this.builder;
    c.addEventListener('pointerdown', e => {
      c.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 1) tapStart = { x: e.clientX, y: e.clientY, t: performance.now() }; else tapStart = null;
      lastPinch = null; lastMid = null;
    });
    c.addEventListener('pointermove', e => {
      const p = ptrs.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
      if (ptrs.size === 1) { if (tapStart && Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y) > 9) tapStart = null; if (!tapStart) target().onDrag(dx, dy); }
      else if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y), mid = (a.y + b.y) / 2;
        if (lastPinch) target().onZoom(lastPinch / d);
        if (lastMid !== null && target().onPan) target().onPan(mid - lastMid);
        lastPinch = d; lastMid = mid;
      }
    });
    const up = e => {
      if (tapStart && ptrs.size === 1 && performance.now() - tapStart.t < 500) target().onTap ? target().onTap(e.clientX, e.clientY) : target().tap(e.clientX, e.clientY);
      ptrs.delete(e.pointerId); tapStart = null; lastPinch = null; lastMid = null;
    };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', e => { ptrs.delete(e.pointerId); tapStart = null; });
    c.addEventListener('wheel', e => { e.preventDefault(); target().onZoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
    addEventListener('keydown', e => { if (e.target.tagName === 'INPUT') return; if (this.mode === 'flight') this.flight.onKey(e, true); else if (this.mode === 'builder') this.builder.onKey(e, true); if (e.code === 'Space') e.preventDefault(); });
    addEventListener('keyup', e => { if (this.mode === 'flight') this.flight.onKey(e, false); });
    addEventListener('blur', () => { this.flight.keys = {}; });
    // iOS: block pinch-zoom / double-tap zoom / bounce
    for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, e => e.preventDefault(), { passive: false });
    document.addEventListener('touchmove', e => { if (!e.target.closest('.scrolly')) e.preventDefault(); }, { passive: false });
    document.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('visibilitychange', () => { this.last = performance.now(); });
  }
}
window.OF = new App();
window.OF.show('menu');
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => { });
