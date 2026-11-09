// Orbit Forge - 3D navball (rendered into its own viewport)
import * as THREE from './vendor/three.module.min.js';
const V3 = THREE.Vector3;

function ballTexture() {
  const W = 1024, H = 512, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, H / 2); sky.addColorStop(0, '#1d5fb8'); sky.addColorStop(1, '#4a9ae8');
  g.fillStyle = sky; g.fillRect(0, 0, W, H / 2);
  const gnd = g.createLinearGradient(0, H / 2, 0, H); gnd.addColorStop(0, '#c07a3a'); gnd.addColorStop(1, '#7a4720');
  g.fillStyle = gnd; g.fillRect(0, H / 2, W, H / 2);
  g.strokeStyle = 'rgba(255,255,255,0.85)'; g.fillStyle = '#fff'; g.font = 'bold 22px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let lat = -80; lat <= 80; lat += 10) { const y = H / 2 - lat / 180 * H; g.lineWidth = lat === 0 ? 4 : 1.5; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  const labels = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
  for (let hd = 0; hd < 360; hd += 15) {
    const x = ((0.75 - hd / 360) % 1 + 1) % 1 * W;
    g.lineWidth = hd % 90 === 0 ? 3 : 1; g.beginPath(); g.moveTo(x, 10); g.lineTo(x, H - 10); g.stroke();
    const t = labels[hd] || (hd % 45 === 0 ? String(hd) : '');
    if (t) for (const lat of [-30, 30]) { const y = H / 2 - lat / 180 * H; g.save(); g.fillStyle = labels[hd] ? '#ffe680' : '#fff'; g.fillText(t, x + 0, y); g.restore(); }
  }
  for (const lat of [-60, -30, 30, 60]) { const y = H / 2 - lat / 180 * H; for (let k = 0; k < 4; k++) g.fillText(String(Math.abs(lat)), (k * 0.25 + 0.125) * W, y - 14); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function glyph(kind) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d');
  const col = { pro: '#d8f03a', retro: '#d8f03a', norm: '#d14cf0', anti: '#d14cf0', radOut: '#3ae0f0', radIn: '#3ae0f0', node: '#3a8cff' }[kind];
  g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 6; g.lineCap = 'round';
  g.shadowColor = '#000'; g.shadowBlur = 4;
  const ring = (r) => { g.beginPath(); g.arc(32, 32, r, 0, Math.PI * 2); g.stroke(); };
  if (kind === 'pro') { ring(13); g.beginPath(); g.moveTo(32, 19); g.lineTo(32, 6); g.moveTo(19, 32); g.lineTo(6, 32); g.moveTo(45, 32); g.lineTo(58, 32); g.stroke(); g.beginPath(); g.arc(32, 32, 3, 0, 7); g.fill(); }
  if (kind === 'retro') { ring(13); g.beginPath(); g.moveTo(23, 23); g.lineTo(41, 41); g.moveTo(41, 23); g.lineTo(23, 41); g.moveTo(32, 45); g.lineTo(32, 58); g.stroke(); }
  if (kind === 'norm' || kind === 'anti') { g.beginPath(); if (kind === 'norm') { g.moveTo(32, 12); g.lineTo(52, 46); g.lineTo(12, 46); } else { g.moveTo(32, 52); g.lineTo(52, 18); g.lineTo(12, 18); } g.closePath(); g.stroke(); g.beginPath(); g.arc(32, 34, 3, 0, 7); g.fill(); }
  if (kind === 'radOut' || kind === 'radIn') { ring(12); if (kind === 'radOut') { for (const a of [0, 1, 2, 3]) { const c = Math.cos(a * Math.PI / 2 + Math.PI / 4), s = Math.sin(a * Math.PI / 2 + Math.PI / 4); g.beginPath(); g.moveTo(32 + c * 14, 32 + s * 14); g.lineTo(32 + c * 26, 32 + s * 26); g.stroke(); } } else { for (const a of [0, 1, 2, 3]) { const c = Math.cos(a * Math.PI / 2 + Math.PI / 4), s = Math.sin(a * Math.PI / 2 + Math.PI / 4); g.beginPath(); g.moveTo(32 + c * 4, 32 + s * 4); g.lineTo(32 + c * 10, 32 + s * 10); g.stroke(); } } }
  if (kind === 'node') { g.lineWidth = 7; g.beginPath(); g.moveTo(12, 20); g.lineTo(32, 44); g.lineTo(52, 20); g.stroke(); ring(8); }
  const tx = new THREE.CanvasTexture(cv);
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, depthTest: false, transparent: true }));
}

export class Navball {
  constructor() {
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(30, 1, 0.1, 10); this.cam.position.set(0, 0, 4.0);
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24), new THREE.MeshBasicMaterial({ map: ballTexture() }));
    this.scene.add(this.ball);
    // bezel
    const bz = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.12, 48), new THREE.MeshBasicMaterial({ color: 0x2a2e36 }));
    bz.position.z = 0.6; bz.scale.setScalar(0.84); this.scene.add(bz);
    this.markers = {};
    for (const k of ['pro', 'retro', 'norm', 'anti', 'radOut', 'radIn', 'node']) { const s = glyph(k); s.scale.setScalar(0.32); s.renderOrder = 5; this.markers[k] = s; this.scene.add(s); }
    // centre reticle
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64; const g = cv.getContext('2d');
    g.strokeStyle = '#ff9a1a'; g.lineWidth = 7; g.lineCap = 'round'; g.beginPath(); g.moveTo(10, 32); g.lineTo(44, 32); g.lineTo(64, 48); g.lineTo(84, 32); g.lineTo(118, 32); g.stroke();
    g.beginPath(); g.arc(64, 32, 4, 0, 7); g.fillStyle = '#ff9a1a'; g.fill();
    const ret = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false, transparent: true }));
    ret.scale.set(0.9, 0.45, 1); ret.position.z = 1.3; ret.renderOrder = 6; this.scene.add(ret);
    this._m = new THREE.Matrix4();
  }
  // q: vessel attitude (local->world), frame {up,east,north}; dirs: {pro, norm, radOut, node} world unit vectors (or null)
  update(q, frame, dirs) {
    const right = new V3(1, 0, 0).applyQuaternion(q), dorsal = new V3(0, 0, -1).applyQuaternion(q), nose = new V3(0, 1, 0).applyQuaternion(q);
    const E = frame.east, U = frame.up, Nn = frame.north;
    const row = v => [v.dot(E), v.dot(U), -v.dot(Nn)];
    const a = row(right), b = row(dorsal), c = row(nose);
    this._m.set(a[0], a[1], a[2], 0, b[0], b[1], b[2], 0, c[0], c[1], c[2], 0, 0, 0, 0, 1);
    this.ball.quaternion.setFromRotationMatrix(this._m);
    const place = (k, d) => {
      const s = this.markers[k];
      if (!d) { s.visible = false; return; }
      const x = right.dot(d), y = dorsal.dot(d), z = nose.dot(d);
      s.visible = z > -0.02; s.position.set(x, y, z);
    };
    const neg = v => v ? v.clone().negate() : null;
    place('pro', dirs.pro); place('retro', neg(dirs.pro)); place('norm', dirs.norm); place('anti', neg(dirs.norm));
    place('radOut', dirs.radOut); place('radIn', neg(dirs.radOut)); place('node', dirs.node);
    const pitch = Math.asin(Math.max(-1, Math.min(1, nose.dot(U)))) * 180 / Math.PI;
    let hdg = Math.atan2(nose.dot(E), nose.dot(Nn)) * 180 / Math.PI; if (hdg < 0) hdg += 360;
    return { pitch, hdg };
  }
  render(renderer, rect, H) {
    const s = Math.min(rect.width, rect.height);
    if (s < 10) return;
    const x = rect.left + (rect.width - s) / 2, y = H - rect.bottom + (rect.height - s) / 2;
    renderer.setViewport(x, y, s, s); renderer.setScissor(x, y, s, s); renderer.setScissorTest(true);
    renderer.clearDepth();
    renderer.render(this.scene, this.cam);
    renderer.setScissorTest(false);
  }
}
