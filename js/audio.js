// Orbit Forge - synthesized sound (WebAudio only, no recorded audio): engine rumble, jet whine, wind, reentry roar, staging thumps
import { CTRL } from './control.js';
class Synth {
  constructor() { this.ctx = null; this.on = CTRL.sound !== false; }
  unlock() {
    if (!this.on) return;
    try {
      if (!this.ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; this.ctx = new AC(); this.build(); }
      if (this.ctx.state === 'suspended') { const pr = this.ctx.resume(); if (pr && pr.catch) pr.catch(() => { }); }
    } catch (e) { this.ctx = null; }
  }
  setOn(on) { this.on = on; if (!on && this.ctx) this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05); if (on) { this.unlock(); if (this.ctx) this.master.gain.setTargetAtTime(CTRL.volume, this.ctx.currentTime, 0.05); } }
  build() {
    const c = this.ctx, n = c.sampleRate * 2, buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    let b = 0; for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; b = (b + 0.02 * w) / 1.02; d[i] = w * 0.5 + b * 3; } // white + brown-ish
    this.noiseBuf = buf;
    this.master = c.createGain(); this.master.gain.value = CTRL.volume; this.master.connect(c.destination);
    const loop = (type, f, q) => { const s = c.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = 0.7 + Math.random() * 0.3; const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = c.createGain(); g.gain.value = 0; s.connect(fl); fl.connect(g); g.connect(this.master); s.start(); return { s, fl, g }; };
    this.rumble = loop('lowpass', 160, 0.8);
    this.crackle = loop('bandpass', 900, 1.2);
    this.wind = loop('bandpass', 500, 0.6);
    this.roar = loop('lowpass', 700, 0.5);
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 300; const of = c.createBiquadFilter(); of.type = 'bandpass'; of.frequency.value = 1200; of.Q.value = 3; const og = c.createGain(); og.gain.value = 0;
    o.connect(of); of.connect(og); og.connect(this.master); o.start(); this.whine = { o, fl: of, g: og };
  }
  set(node, v, tc = 0.12) { node.g.gain.setTargetAtTime(v, this.ctx.currentTime, tc); }
  reset() { if (this.ctx) for (const k of ['rumble', 'crackle', 'wind', 'roar', 'whine']) this.set(this[k], 0, 0.05); }
  update(F, dt) {
    if (!this.ctx || !this.on || this.ctx.state !== 'running') return;
    const vis = F.app.mode === 'flight' && !F.destroyed;
    const b = F._lastBurn; let rocket = 0, jet = 0, spool = 0;
    if (vis && b) for (const u of b.firing) { const p = F.prop.by.get(u), f = (b.perF[u] || 0); const air = p.def.air && F.prop.lastModes && F.prop.lastModes[u] === 'air'; if (air) { jet += f; spool = Math.max(spool, F.prop.spool.get(u) || 0); } else rocket += f; }
    const m = Math.max(F.mass, 1), atmP = F.q_dyn > 0 ? 1 : 0.35;
    const rk = Math.min(1, Math.sqrt(rocket / (m * 9.81 * 1.5))) * (vis ? 1 : 0);
    const warp = F.warpFactor() > 4 ? 0 : 1;
    this.set(this.rumble, rk * 0.9 * warp * (0.6 + 0.4 * atmP)); this.rumble.fl.frequency.setTargetAtTime(110 + 220 * rk, this.ctx.currentTime, 0.2);
    this.set(this.crackle, rk * 0.18 * warp);
    this.set(this.whine, jet > 0 ? 0.05 + 0.08 * spool : 0); this.whine.o.frequency.setTargetAtTime(220 + 900 * spool, this.ctx.currentTime, 0.3);
    const q = vis ? F.q_dyn || 0 : 0; this.set(this.wind, Math.min(0.5, Math.sqrt(q / 40000)) * warp * (F.contact ? 0.2 : 1)); this.wind.fl.frequency.setTargetAtTime(300 + Math.min(1500, Math.sqrt(q) * 4), this.ctx.currentTime, 0.3);
    this.set(this.roar, vis ? Math.min(0.7, (F.heatFlux || 0) / 3e5) * warp : 0);
  }
  burst(dur, f0, f1, vol, type = 'lowpass') {
    if (!this.ctx || !this.on) return; const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f0, t); fl.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(fl); fl.connect(g); g.connect(this.master); s.start(t); s.stop(t + dur + 0.05);
  }
  stage(ignite, sep) { if (sep) this.burst(0.35, 900, 120, 0.7); if (ignite) this.burst(0.8, 400, 80, 0.6); if (!sep && !ignite) this.click(); }
  click() { if (!this.ctx || !this.on) return; const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain(); o.frequency.setValueAtTime(1400, t); o.frequency.exponentialRampToValueAtTime(500, t + 0.05); g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.07); o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.1); }
  boom(k = 1) { this.burst(1.8 * k + 0.3, 600, 40, 0.9 * k); }
}
export const AUDIO = new Synth();
addEventListener('pointerdown', () => AUDIO.unlock(), { capture: true });
addEventListener('keydown', () => AUDIO.unlock(), { capture: true });
