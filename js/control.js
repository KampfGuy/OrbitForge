// Orbit Forge - pilot input: settings, stick shaping, keyboard easing, tilt-to-steer
const KEY = 'orbitforge.controls';
const DEF = { sens: 1.0, assist: true, feel: 'auto', tilt: false, sound: true, volume: 0.7 };
export const CTRL = Object.assign({}, DEF, (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } })());
CTRL.tilt = false; // tilt always starts off: iOS needs a fresh permission tap each visit
export function saveCtrl() { try { const o = Object.assign({}, CTRL); delete o.tilt; localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { } }

// dead zone + expo curve: small deflections are gentle, full deflection is still full
export function shapeStick(x, dz = 0.1, expo = 0.55) {
  const a = Math.abs(x); if (a < dz) return 0;
  const t = Math.min(1, (a - dz) / (1 - dz));
  return Math.sign(x) * (t * (1 - expo) + t * t * t * expo);
}
// keys ease in (instead of slamming full deflection) and let go quickly
export function easeKey(cur, target, dt, fine) {
  const rate = target === 0 ? 7 : (fine ? 1.6 : 3.2);
  return cur + Math.max(-rate * dt, Math.min(rate * dt, target - cur));
}

// ---- tilt-to-steer (DeviceOrientation). Must be enabled from a tap so iOS can ask for permission ----
export const TILT = { on: false, x: 0, y: 0, base: null, last: null };
function screenAngle() { const a = (screen.orientation && screen.orientation.angle !== undefined) ? screen.orientation.angle : (window.orientation || 0); return ((a % 360) + 360) % 360; }
function onOrient(e) {
  if (e.beta === null || e.gamma === null) return;
  const ang = screenAngle();
  let x, y; // x = tilt right, y = tilt toward the player (top edge comes closer)
  if (ang === 90) { x = e.beta; y = -e.gamma; } else if (ang === 270) { x = -e.beta; y = e.gamma; } else if (ang === 180) { x = -e.gamma; y = -e.beta; } else { x = e.gamma; y = e.beta; }
  TILT.last = { x, y, ang };
  if (!TILT.base || TILT.base.ang !== ang) TILT.base = { x, y, ang };
  const R = 22, dz = 2.5;
  const f = d => { const a = Math.abs(d); return a < dz ? 0 : Math.sign(d) * Math.min(1, (a - dz) / R); };
  TILT.x = f(x - TILT.base.x); TILT.y = f(y - TILT.base.y);
}
export async function enableTilt() {
  if (typeof DeviceOrientationEvent === 'undefined') return 'This device has no motion sensor';
  try { if (typeof DeviceOrientationEvent.requestPermission === 'function') { const r = await DeviceOrientationEvent.requestPermission(); if (r !== 'granted') return 'Motion access was not allowed'; } }
  catch (e) { return 'Motion access failed: ' + e.message; }
  window.addEventListener('deviceorientation', onOrient); TILT.on = true; TILT.base = null; CTRL.tilt = true; return null;
}
export function disableTilt() { window.removeEventListener('deviceorientation', onOrient); TILT.on = false; TILT.x = TILT.y = 0; CTRL.tilt = false; }
export function recenterTilt() { if (TILT.last) TILT.base = Object.assign({}, TILT.last); }
