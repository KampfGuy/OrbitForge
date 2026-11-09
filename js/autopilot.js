// Orbit Forge - simple autopilots: gravity-turn ascent, plane heading/altitude hold, reentry attitude, runway auto-land
import * as THREE from './vendor/three.module.min.js';
import { elements, clamp, fmtDist, fmtTime, G0 } from './orbit.js';
const V3 = THREE.Vector3, RAD = Math.PI / 180;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

export class Autopilot {
  constructor(F) { this.F = F; this.active = false; this.mode = null; this.target = null; this.targetAlt = 80000; this.msg = ''; }
  toggle(m) { if (this.active && this.mode === m) this.off(); else this.engage(m); }
  off(silent) { const was = this.active; this.active = false; this.target = null; this.F.apSteer = 0; if (was && !silent) { this.F.toast('Autopilot off', 1200); this.F.sas = true; this.F.sasMode = 'stab'; this.F.holdQ = this.F.holdPB = null; } }
  engage(m) {
    const F = this.F;
    if (F.destroyed) return;
    if ((m === 'hold' || m === 'land' || m === 'reentry') && !F.winged) { F.toast('That autopilot needs wings'); return; }
    if (m === 'land' && F.body.name !== 'Kampa') { F.toast('No runway on ' + F.body.name); return; }
    if (m === 'hold' && (F.contact || !F.body.atm)) { F.toast('Heading/altitude hold works in flight, in the air'); return; }
    this.mode = m; this.active = true; this.phase = null; this._lastStage = null; this.td = null; this.phaseFlare = false; this.t0 = F.t; this.vsI = 0; this.aoaF = (F.aoa || 0) * RAD; F.apSteer = 0;
    F.sas = true; F.holdQ = F.holdPB = null;
    const s = this.sense();
    if (m === 'ascent') { this.phase = F.contact || F.landed ? 'launch' : 'ascent'; F.toast(`Ascent autopilot: gravity turn to a ${fmtDist(this.targetAlt)} orbit. It stages for you.`, 3000); }
    if (m === 'hold') { this.hdgT = s.track; this.altT = s.alt; F.toast(`Holding ${Math.round(((s.track / RAD) + 360) % 360)}° at ${fmtDist(s.alt)} (move the stick to change)`, 2500); }
    if (m === 'reentry') F.toast('Reentry: nose high, wings level, bleeding speed. Hands off!', 2500);
    if (m === 'land') { this.pickRunway(s); F.toast('Auto-land: lining up with the runway', 2500); }
  }
  onPilot() { this._pilotSeen = this.F.t; }
  // ---- shared state ----
  sense() {
    const F = this.F, f = F.frame(), vs = F.v.clone().sub(F.groundVel(F.r, new V3())), spd = Math.max(vs.length(), 0.1);
    const alt = F.r.length() - F.body.radius, vsUp = vs.dot(f.up);
    return { f, vs, spd, alt, vsUp, track: Math.atan2(vs.dot(f.east), vs.dot(f.north)), gamma: Math.asin(clamp(vsUp / spd, -1, 1)), el: elements(F.r, F.v, F.body.mu) };
  }
  dirPH(pitch, hdg, f) { return f.up.clone().multiplyScalar(Math.sin(pitch)).addScaledVector(f.north, Math.cos(pitch) * Math.cos(hdg)).addScaledVector(f.east, Math.cos(pitch) * Math.sin(hdg)); }
  status() {
    if (!this.active) return 'off';
    return this.msg;
  }
  // called every rendered frame (also during rails warp) to stop warp ahead of burns
  tick() {
    const F = this.F;
    if (this.active && this.mode === 'ascent' && this.phase === 'coast' && F.warpIdx > 0) { const e = elements(F.r, F.v, F.body.mu); if (e.tAp < (this.lead || 30) + 25) { F.warpIdx = 0; F.toast('Warp stopped for the circularisation burn', 1800); } }
  }
  autostage() {
    const F = this.F, P = F.prop, b = F._lastBurn, nextEv = F.events[P.next];
    if (!nextEv || nextEv.chute || F.t - (this._lastStage ?? -9) < 1.2) return;
    const pools = P.pools();
    const srbDry = [...P.active].some(u => P.alive.has(u) && P.by.get(u).def.srb && P.fuel.get(u) <= 1e-7);
    const firing = b ? b.firing.length : 0;
    let go = false;
    if (F.throttle > 0 && firing === 0) go = true;                       // flameout
    if (srbDry && nextEv.drop) go = true;                                 // burnt-out boosters
    if (nextEv.drop && !go) { // empty drop tank that feeds the core (external tank)
      const gk = nextEv.drop, tanks = F.inst.filter(p => p.groupKey && gk.includes(p.groupKey) && P.alive.has(p.uid));
      if (tanks.length && !tanks.some(p => p.def.engine) && tanks.every(p => !(p.def.fuel > 0) || P.fuel.get(p.uid) <= 1e-6)) go = true;
    }
    if (go) { F.doStage(); this._lastStage = F.t; }
  }
  step(dt) {
    const F = this.F; if (!this.active || F.destroyed) return;
    const s = this.sense();
    if (this.mode === 'ascent') return this.ascent(s, dt);
    if (this.mode === 'hold') return this.hold(s, dt);
    if (this.mode === 'reentry') return this.reentry(s, dt);
    if (this.mode === 'land') return this.land(s, dt);
  }
  // ---------- rockets & shuttles: gravity turn, MECO at the target apoapsis, coast, circularise ----------
  ascent(s, dt) {
    const F = this.F, b = F.body, atmTop = b.atm ? b.atm.height : 0, el = s.el, T = this.targetAlt;
    const ap = el.ecc < 1 ? el.ra - b.radius : Infinity, pe = el.rp - b.radius;
    if (this.phase === 'launch') { F.setThrottle(1); if (F.prop.next === 0 || !(F._lastBurn && F._lastBurn.F > 0)) { F.doStage(); this._lastStage = F.t; } this.phase = 'ascent'; }
    if (this.phase !== 'done') this.autostage();
    const srbOn = [...F.prop.active].some(u => F.prop.alive.has(u) && F.prop.by.get(u).def.srb && F.prop.fuel.get(u) > 1e-7);
    if (this.phase === 'ascent') {
      const k = clamp(Math.max((s.alt - 600) / (0.4 * T), (s.spd - 60) / 2200), 0, 1), pitch = 90 - 88 * Math.pow(k, 0.45);
      // never point far below the actual flight path once moving fast (keeps the stack out of high angle of attack)
      let p = pitch * RAD; if (s.spd > 90 && b.atm && s.alt < atmTop) { const mg = clamp(0.08 + 0.3 * (1 - (F.q_dyn || 0) / 25000), 0.08, 0.38); p = clamp(p, s.gamma - mg, s.gamma + mg); }
      if (s.spd < 60) p = Math.max(p, 85 * RAD);
      // low-thrust stacks: keep climbing out of the thick air instead of skimming it
      if (b.atm && s.alt < atmTop && ap < atmTop + 5000 && s.vsUp < 150) p = Math.max(p, Math.min(30, 8 + (150 - s.vsUp) * 0.12) * RAD);
      if (ap >= T && srbOn) { F.setThrottle(0); p = Math.max(0, Math.min(p, s.gamma - 0.2)); } // boosters can't be throttled: cut the core and fly flatter until they burn out
      else F.setThrottle(1);
      this.target = { dir: this.dirPH(p, 90 * RAD, s.f) };
      this.msg = `ASCENT → ${fmtDist(T)} · pitch ${Math.round(p / RAD)}° · Ap ${isFinite(ap) ? fmtDist(Math.max(0, ap)) : '∞'}`;
      if (ap >= T && !srbOn) { F.setThrottle(0); this.phase = 'coast'; F.toast('MECO: coasting to apoapsis', 1800); }
      return;
    }
    if (this.phase === 'coast') {
      const pro = F.v.clone().normalize();
      this.target = { dir: pro };
      // keep the apoapsis up against drag while still in the air
      F.setThrottle(b.atm && s.alt < atmTop && ap < T - 300 ? 0.3 : 0);
      // drop an external tank once the main burn is done
      const nextEv = F.events[F.prop.next];
      if (nextEv && nextEv.drop && F.t - (this._lastStage || -9) > 1.5) { const tanks = F.inst.filter(p => p.groupKey && nextEv.drop.includes(p.groupKey) && F.prop.alive.has(p.uid)); if (tanks.length && !tanks.some(p => p.def.engine)) { F.doStage(); this._lastStage = F.t; } }
      const B = F.prop.burn(1, 0, 0);
      if (!(B.F > 0)) { if (F.prop.next < F.events.length && !F.events[F.prop.next].chute) { F.doStage(); this._lastStage = F.t; } }
      const ve = B.F > 0 ? B.F / B.mdot : 3000, rAp = el.ra, vAp = Math.sqrt(b.mu * (2 / rAp - 1 / el.a)), vc = Math.sqrt(b.mu / rAp), dv = Math.max(0, vc - vAp);
      const bt = B.F > 0 ? F.mass * (1 - Math.exp(-dv / ve)) / B.mdot : 60;
      this.lead = bt / 2 + 1;
      this.msg = `COAST to Ap ${fmtDist(ap)} in ${fmtTime(el.tAp)} · burn ${fmtTime(bt)}`;
      if ((!b.atm || s.alt > atmTop) && el.tAp < this.lead) { this.phase = 'circ'; F.setThrottle(1); }
      if (el.tAp > el.period / 2 && s.alt > atmTop) { this.phase = 'circ'; F.setThrottle(1); }
      return;
    }
    if (this.phase === 'circ') {
      const h = F.v.clone().addScaledVector(s.f.up, -F.v.dot(s.f.up));
      const vr = F.v.dot(s.f.up);
      // horizontal burn, tipped up a little if we are already falling
      const dir = h.clone().normalize().addScaledVector(s.f.up, clamp(-vr / 200, -0.15, 0.3)).normalize();
      this.target = { dir };
      const vc = Math.sqrt(b.mu / F.r.length()), rem = vc - h.length();
      const B = F.prop.burn(1, 0, 0), aMax = B.F > 0 ? B.F / F.mass : 1;
      F.setThrottle(clamp(rem / (aMax * 1.5), 0.05, 1));
      if (!(B.F > 0)) { if (F.prop.next < F.events.length && !F.events[F.prop.next].chute) { F.doStage(); this._lastStage = F.t; } else { F.setThrottle(0); this.finish('Out of fuel before a full orbit: Pe ' + fmtDist(pe)); return; } }
      this.msg = `CIRCULARISE · Pe ${fmtDist(pe)} · Ap ${fmtDist(ap)}`;
      if (pe > Math.min(T - 3000, ap - 2500) || rem < 0.5 || (pe > atmTop + 3000 && el.ecc < 0.004)) { F.setThrottle(0); this.finish(`In orbit! Ap ${fmtDist(ap)} · Pe ${fmtDist(pe)}`); }
    }
  }
  finish(msg) { const F = this.F; this.active = false; this.target = null; this.phase = 'done'; F.sas = true; F.sasMode = 'pro'; F.navMode = 'orbit'; F.toast(msg, 4000); }
  // ---------- planes: hold heading + altitude by banking and pitching ----------
  pitchFor(s, vsCmd, dt) {
    const F = this.F;
    // slow trim estimate of the angle of attack (a fast one feeds back into itself and porpoises)
    this.aoaF += ((F.aoa || 0) * RAD - this.aoaF) * Math.min(1, dt * 0.25);
    const ve = vsCmd - s.vsUp;
    this.vsI = clamp(this.vsI + ve * 0.003 * dt, -0.1, 0.1);
    const g = Math.asin(clamp(vsCmd / s.spd, -0.6, 0.6));
    return clamp(g + clamp(this.aoaF, -0.05, 0.25) + clamp(ve / s.spd * 0.8, -0.08, 0.08) + this.vsI, g - 0.12, g + 0.28);
  }
  bankFor(s, hdgCmd, lim = 0.5) { return clamp(wrap(hdgCmd - s.track) * 1.6, -lim, lim); }
  hold(s, dt) {
    const F = this.F;
    if (F.t - (this._pilotSeen || -99) < 0.4) { this.hdgT = s.track; this.altT = s.alt; this.vsI = 0; }
    if (F.contact) { this.off(); return; }
    const vmax = clamp(0.2 * s.spd, 5, 50), vsCmd = clamp((this.altT - s.alt) * 0.12, -vmax, vmax);
    this.target = { q: F.planeAttitude(this.pitchFor(s, vsCmd, dt), this.bankFor(s, this.hdgT, 0.45)) };
    this.msg = `HOLD ${String(Math.round(((this.hdgT / RAD) + 360) % 360)).padStart(3, '0')}° · ${fmtDist(this.altT)}`;
  }
  // ---------- winged reentry: high angle of attack, wings level, steer gently toward the runway ----------
  reentry(s, dt) {
    const F = this.F, M = s.spd / 340;
    const aoa = clamp(14 + (M - 2) * 4, 14, 38) * RAD;
    let bank = 0;
    if (F.body.name === 'Kampa' && s.alt < 65000 && !this.noSteer) {
      // energy management: bank to bleed off energy we don't need for the remaining distance, with roll reversals so the
      // heading swings either side of the runway bearing (S-turns); wings level when short of energy (max range)
      const rw = F.runwayEnds(), d = rw.mid.clone().sub(F.r); const brg = Math.atan2(d.dot(s.f.east), d.dot(s.f.north));
      this.dist = d.addScaledVector(s.f.up, -d.dot(s.f.up)).length();
      const E = s.alt + s.spd * s.spd / (2 * 9.81), Ereq = 9000 + this.dist * 0.2; // energy height the glide home needs (L/D ~5)
      this.excess = E - Ereq;
      const he = wrap(brg - s.track);
      const mag = clamp(this.excess / 15000, 0, 1) * 1.15;
      if (!this.revSide) this.revSide = Math.sign(he) || 1;
      if (Math.abs(he) > 0.45) this.revSide = Math.sign(he); // too far off the bearing: turn back toward it
      else if (he * this.revSide < -0.3) this.revSide = -this.revSide; // swung past by ~17°: reverse
      bank = mag > 0.05 ? this.revSide * Math.max(mag, Math.min(0.6, Math.abs(he) * 1.6)) : clamp(he * 1.6, -0.6, 0.6);
    }
    const pitch = s.alt > (F.body.atm ? F.body.atm.height : 0) ? s.gamma + aoa : s.gamma + aoa;
    this.target = { q: F.planeAttitude(pitch, bank) };
    this.msg = `REENTRY · AoA ${Math.round(aoa / RAD)}° · Mach ${M.toFixed(1)}${this.dist ? ' · runway ' + fmtDist(this.dist) + (this.excess > 3000 ? ' · S-turn' : this.excess < -3000 ? ' · short' : '') : ''}`;
    if (F.body.name === 'Kampa' && !this.noSteer && s.alt < 30000 && (s.spd < 480 || (this.dist < 70000 && s.spd < 800))) { this.engage('land'); }
  }
  // ---------- auto-land on the runway ----------
  pickRunway(s) {
    const F = this.F, rw = F.runwayEnds(), up = s.f.up, P = F.r.clone();
    const flat = v => v.clone().addScaledVector(up, -v.dot(up));
    const dirA = flat(rw.b.clone().sub(rw.a)).normalize();
    const sA = flat(P.clone().sub(rw.a)).dot(dirA), sB = flat(P.clone().sub(rw.b)).dot(dirA.clone().negate());
    let useA = sA < sB;
    if (sA > -500 && sB > -500) useA = s.vs.dot(dirA) > 0; // already over the runway: keep going the way we fly
    this.rwEnd = useA ? 'a' : 'b';
    const m = s.spd; const S = Math.max(F.wingArea, 1);
    this.vStall = Math.sqrt(2 * F.mass * 9.81 / (1.225 * S * 1.3));
    let thrust = 0; for (const u of F.prop.active) if (F.prop.alive.has(u)) { const d = F.prop.by.get(u).def; if (d.thrust && !d.srb) thrust += d.thrust * 1000; }
    this.powered = thrust > F.mass * 9.81 * 0.2;
    this.phase = 'nav';
  }
  land(s, dt) {
    const F = this.F, rw = F.runwayEnds(), up = s.f.up;
    const thr = this.rwEnd === 'a' ? rw.a : rw.b, oth = this.rwEnd === 'a' ? rw.b : rw.a;
    const flat = v => v.clone().addScaledVector(up, -v.dot(up));
    const dir = flat(oth.clone().sub(thr)).normalize(), side = new V3().crossVectors(up, dir).normalize();
    const rel = flat(F.r.clone().sub(thr)), along = rel.dot(dir), cross = rel.dot(side);
    const crossRate = s.vs.dot(side);
    const rwHdg = Math.atan2(dir.dot(s.f.east), dir.dot(s.f.north));
    const sideR = Math.sign(wrap(Math.atan2(side.dot(s.f.east), side.dot(s.f.north)) - rwHdg)) || 1; // +1 when "side" points right of the runway heading
    const h = F.r.length() - thr.length(), radar = Math.max(0, F.lowestAlt());
    const D = -along; this.dbg = { along: Math.round(along), cross: Math.round(cross), crossRate: +crossRate.toFixed(1) };
    const glide = !this.powered, gs = glide ? 0.2 : 0.07;
    const vApp = this.vStall * (glide ? 1.35 : 1.2);
    let hdgCmd, vsCmd, bankLim = 0.5;
    if (F.contact) {
      // rollout: nose down, wheels steer to the centreline, brakes once the nose wheel is down
      F.setThrottle(0); this.phase = 'rollout';
      if (!this.td && !this.powered && s.spd > 40) { F.dragChute = true; F.toast('Drag chute out', 1500); }
      if (s.spd < 15) F.dragChute = false;
      if (!this.td) this.td = { along: Math.round(along), spd: Math.round(s.spd), vs: +s.vsUp.toFixed(1), len: Math.round(rw.len) };
      const he = wrap(rwHdg - s.track);
      F.apSteer = clamp(he * 2.5 - sideR * (cross * 0.012 + crossRate * 0.04), -1, 1) * clamp(30 / Math.max(s.spd, 1), 0.15, 1);
      if (F.t - (this.tdT || (this.tdT = F.t)) > 1.5 && s.spd < 95) F.brakes = true;
      this.target = { q: F.planeAttitude(-0.02, 0, rwHdg) };
      this.msg = `ROLLOUT · ${Math.round(s.spd)} m/s · ${Math.abs(cross).toFixed(0)} m off centre`;
      if (s.spd < 1.0) { const c = Math.abs(cross), onRw = c < 20 && along > -30 && along < rw.len + 30; this.active = false; this.target = null; F.apSteer = 0; F.sas = true; F.sasMode = 'stab'; F.toast(onRw ? `Landed on the runway ✓ (${c.toFixed(1)} m off the centreline)` : `Stopped ${fmtDist(Math.max(c, Math.abs(along)))} from the runway`, 5000); this.result = { onRunway: onRw, cross: c, along }; }
      return;
    }
    this.tdT = null; F.apSteer = 0;
    const far = along < -18000 || (along < 0 && Math.abs(cross) > 0.35 * Math.abs(along) + 1500) || along > rw.len;
    if (far && this.phase !== 'flare') {
      // fly to a fix 12 km out on the extended centreline
      const fix = thr.clone().addScaledVector(dir, -12000);
      const d = flat(fix.clone().sub(F.r));
      hdgCmd = Math.atan2(d.dot(s.f.east), d.dot(s.f.north));
      const hFix = 12300 * Math.tan(gs);
      if (glide) { // energy management: glide down a path that arrives at the fix, no steeper; airbrake only when well above it
        const dFix = Math.max(d.length(), 500), need = hFix + dFix * 0.18;
        const E = h + (s.spd * s.spd - vApp * vApp) / (2 * 9.81); // energy height above what the approach needs
        const gam = clamp(Math.atan2(h - hFix, dFix), 0.03, 0.35);
        vsCmd = -s.spd * Math.sin(gam) - clamp((h - need) * 0.01, 0, 25);
        this.navHigh = E > need + 2500;
      } else vsCmd = clamp((hFix - h) * 0.05, -25, 20);
      this.phase = 'nav'; bankLim = 0.6;
      this.msg = `LAND · to final fix ${fmtDist(d.length())} · ${fmtDist(h)}`;
    } else {
      hdgCmd = rwHdg - sideR * (clamp(cross / 900, -1, 1) * 0.5 + clamp(crossRate / 35, -1, 1) * 0.3);
      let g = gs; const hgs = (D + (glide ? -500 : 300)) * Math.tan(gs); this.navHigh = false;
      if (glide && h < 200) g = 0.05 + (gs - 0.05) * clamp((h - 25) / 175, 0, 1);
      vsCmd = -s.spd * Math.sin(g) + clamp((hgs - h) * 0.12, -25, 25);
      this.phase = 'final';
      if (radar < Math.max(12, 3 * -s.vsUp) || this.phaseFlare) { this.phaseFlare = true; vsCmd = -0.6 - radar * 0.08; hdgCmd = rwHdg - sideR * clamp(cross / 300, -1, 1) * 0.08; bankLim = 0.12; this.phase = 'flare'; }
      this.msg = `LAND · ${fmtDist(D)} to go · ${fmtDist(h)} ${this.phase === 'flare' ? '· FLARE' : (h > hgs + 60 ? '· high' : h < hgs - 60 ? '· low' : '· on slope')}`;
    }
    if (h < 700) F.gearDown = true;
    // speed: throttle when powered, airbrake when a glider is too fast
    if (this.powered) F.setThrottle(this.phase === 'flare' ? 0 : clamp(0.35 + (vApp - s.spd) * 0.05, 0, 1)); else F.setThrottle(0);
    F.brakes = !F.contact && (s.spd > vApp + (this.phase === 'flare' ? 5 : 25) || (this.navHigh && s.spd > vApp + 10));
    // speed protection: never trade the last of the airspeed for height (gliders especially)
    if (this.phase !== 'flare' && s.spd < vApp) vsCmd -= (vApp - s.spd) * (glide ? 1.5 : 0.8);
    let pitch = this.pitchFor(s, vsCmd, dt);
    if (this.dbg) { this.dbg.pt = +(pitch / RAD).toFixed(1); this.dbg.vsCmd = +vsCmd.toFixed(1); this.dbg.vApp = Math.round(vApp); this.dbg.aoa = +(this.aoaF / RAD).toFixed(1); }
    this.target = { q: F.planeAttitude(pitch, this.bankFor(s, hdgCmd, bankLim)) };
  }
}
