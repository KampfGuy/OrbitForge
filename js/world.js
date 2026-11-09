// Orbit Forge - planets, terrain patches, sky
import * as THREE from './vendor/three.module.min.js';
import { BODIES, HOME } from './orbit.js';
const V3 = THREE.Vector3;

// --- small deterministic value-noise ---
function hash(x, y, z, s) { let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647) ^ Math.imul(s, 1274126177); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function vnoise(x, y, z, s) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (i, j, k) => hash(xi + i, yi + j, zi + k, s);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v), l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
function fbm(d, f, oct, s) { let a = 0, amp = 0.5, tot = 0; for (let i = 0; i < oct; i++) { a += amp * vnoise(d.x * f + 13.1, d.y * f + 7.7, d.z * f + 3.3, s + i); tot += amp; f *= 2.03; amp *= 0.5; } return a / tot; }

const SITE = new V3(1, 0, 0);
const C = (r, g, b) => new THREE.Color(r, g, b);
export function surfaceColor(body, d, out, detail = 0) {
  const oct = detail ? 9 : 6;
  if (body.kind === 'home') {
    let n = fbm(d, 2.2, oct, 1);
    const site = d.distanceToSquared(SITE), sw = Math.exp(-site / 0.004);
    n = n * (1 - sw) + 0.56 * sw;
    const ice = Math.abs(d.y) + (fbm(d, 6, 3, 9) - 0.5) * 0.15;
    if (ice > 0.88) return out.setRGB(0.92, 0.95, 0.98);
    if (n < 0.5) { const deep = Math.min(1, (0.5 - n) * 6); return out.setRGB(0.08, 0.28 - deep * 0.1, 0.55 - deep * 0.15); }
    if (n < 0.515) return out.setRGB(0.76, 0.72, 0.52);
    const m = fbm(d, 9, detail ? 6 : 3, 4);
    const hi = Math.min(1, Math.max(0, (n - 0.6) * 5));
    out.setRGB(0.22 + 0.15 * m, 0.46 + 0.12 * m, 0.2 + 0.05 * m);
    if (hi > 0) out.lerp(C(0.45, 0.4, 0.33), hi);
    return out;
  }
  if (body.kind === 'lumo') {
    const n = fbm(d, 3, oct, 21), cr = fbm(d, 14, 3, 33);
    const v = 0.42 + 0.3 * n - (cr > 0.62 ? (cr - 0.62) * 1.4 : 0);
    return out.setRGB(v, v, v * 1.02);
  }
  const n = fbm(d, 4, oct, 41);
  return out.setRGB(0.55 + 0.25 * n, 0.8 + 0.12 * n, 0.72 + 0.15 * n);
}

function colorizeSphere(geo, body) {
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3), d = new V3(), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) { d.fromBufferAttribute(pos, i).normalize(); surfaceColor(body, d, c); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

let groundTex = null;
function makeGroundTex() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g = cv.getContext('2d'); const img = g.createImageData(128, 128);
  for (let i = 0; i < 128 * 128; i++) { const v = 200 + Math.floor(55 * hash(i % 128, (i / 128) | 0, 0, 77)); img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 2; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class BodyView {
  constructor(body, quality) {
    this.body = body;
    this.group = new THREE.Group(); // positioned camera-relative, rotated with body spin
    const seg = body === HOME ? 192 : 128;
    const off = body === HOME ? 140 : 80;
    const geo = new THREE.SphereGeometry(body.radius - off, seg, seg / 2);
    colorizeSphere(geo, body);
    this.sphere = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.group.add(this.sphere);
    if (!groundTex) groundTex = makeGroundTex();
    this.patchMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: groundTex });
    this.patch = null; this.patchCenter = null;
    if (body.atm) {
      const ag = new THREE.SphereGeometry(body.radius + body.atm.height, 64, 32);
      this.atmo = new THREE.Mesh(ag, new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
        uniforms: { sunDir: { value: new V3(1, 0, 0) } },
        vertexShader: `#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vN; varying vec3 vV; varying vec3 vW;
void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); vW = normalize((modelMatrix*vec4(position,0.0)).xyz); gl_Position = projectionMatrix*mv;
#include <logdepthbuf_vertex>
}`,
        fragmentShader: `#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 sunDir; varying vec3 vN; varying vec3 vV; varying vec3 vW;
void main(){
#include <logdepthbuf_fragment>
float rim = 1.0 - max(dot(vN, vV), 0.0); float lit = clamp(dot(vW, sunDir)*0.8+0.4, 0.05, 1.0);
gl_FragColor = vec4(vec3(0.35,0.6,1.0)*pow(rim,2.5)*1.3*lit, 1.0); }`,
      }));
      this.group.add(this.atmo);
    }
    if (body === HOME) this.addSpaceCenter();
  }
  addSpaceCenter() {
    const g = new THREE.Group();
    const conc = new THREE.MeshLambertMaterial({ color: 0x8d8f93 }), dark = new THREE.MeshLambertMaterial({ color: 0x45484e }),
      wall = new THREE.MeshLambertMaterial({ color: 0xd9d4c7 }), stripe = new THREE.MeshLambertMaterial({ color: 0xe0a020 });
    const box = (w, h, d, m, x, y, z) => { const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); me.position.set(x, y, z); g.add(me); return me; };
    box(30, 4, 30, conc, 0, -2, 0);               // pad (top at local y=0)
    box(10, 0.1, 10, dark, 0, 0.05, 0);
    box(1.6, 34, 1.6, stripe, -5, 15, 11);           // service tower (behind the rocket from the default camera)
    box(1.0, 0.5, 7, stripe, -4.2, 24, 7.5);
    box(60, 0.2, 8, dark, 50, 0.1, 0);              // road
    box(40, 26, 30, wall, 110, 13, -30);           // assembly hall
    box(30, 10, 20, wall, 110, 5, 40);
    box(6, 40, 6, wall, 160, 20, 10);               // control tower
    box(10, 4, 10, new THREE.MeshLambertMaterial({ color: 0x4a7fbf, emissive: 0x0a1a30 }), 160, 41, 10);
    box(700, 0.15, 40, dark, 0, 0.08, 400);         // runway
    g.position.copy(SITE).multiplyScalar(this.body.radius);
    g.quaternion.setFromUnitVectors(new V3(0, 1, 0), SITE);
    this.siteGroup = g;
    this.group.add(g);
  }
  // high-res curved patch under the vessel (dirFixed = vessel direction in body-fixed frame)
  updatePatch(dirFixed, alt) {
    const need = alt < 90000;
    if (!need) { if (this.patch) this.patch.visible = false; return; }
    if (this.patch && this.patchCenter.distanceTo(dirFixed) * this.body.radius < 18000) { this.patch.visible = true; return; }
    const R = this.body.radius, N = 72, S = 90000;
    const c = dirFixed.clone().normalize();
    let u = new V3(0, 1, 0).cross(c); if (u.lengthSq() < 1e-8) u.set(1, 0, 0); u.normalize();
    const w = new V3().crossVectors(c, u);
    const center = c.clone().multiplyScalar(R);
    const pos = new Float32Array((N + 1) * (N + 1) * 3), col = new Float32Array(pos.length), uv = new Float32Array((N + 1) * (N + 1) * 2);
    const d = new V3(), cc = new THREE.Color(), dd = new V3();
    for (let j = 0, k = 0; j <= N; j++) for (let i = 0; i <= N; i++, k++) {
      const x = (i / N - 0.5) * S, y = (j / N - 0.5) * S;
      d.copy(center).addScaledVector(u, x).addScaledVector(w, y).normalize();
      dd.copy(d).multiplyScalar(R).sub(center);
      pos[k * 3] = dd.x; pos[k * 3 + 1] = dd.y; pos[k * 3 + 2] = dd.z;
      surfaceColor(this.body, d, cc, 1);
      col[k * 3] = cc.r; col[k * 3 + 1] = cc.g; col[k * 3 + 2] = cc.b;
      uv[k * 2] = x / 90; uv[k * 2 + 1] = y / 90;
    }
    const idx = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i, b = a + 1, c2 = a + N + 1, d2 = c2 + 1; idx.push(a, b, c2, b, d2, c2); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    if (this.patch) { this.group.remove(this.patch); this.patch.geometry.dispose(); }
    this.patch = new THREE.Mesh(geo, this.patchMat);
    this.patch.position.copy(center);
    this.group.add(this.patch);
    this.patchCenter = c;
  }
}

export function makeStars() {
  const n = 1400, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = hash(i, 1, 2, 5) * 2 - 1, th = hash(i, 3, 4, 6) * Math.PI * 2, s = Math.sqrt(1 - u * u);
    const R = 4e9; pos[i * 3] = R * s * Math.cos(th); pos[i * 3 + 1] = R * u; pos[i * 3 + 2] = R * s * Math.sin(th);
    const b = 0.4 + 0.6 * hash(i, 9, 9, 9); col[i * 3] = b; col[i * 3 + 1] = b; col[i * 3 + 2] = b * (0.9 + 0.2 * hash(i, 2, 2, 2));
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false });
  const p = new THREE.Points(g, m); p.frustumCulled = false; p.renderOrder = -10;
  return p;
}
export function makeSun() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,240,1)'); gr.addColorStop(0.2, 'rgba(255,240,200,0.9)'); gr.addColorStop(1, 'rgba(255,200,120,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthWrite: false, transparent: true, sizeAttenuation: false, blending: THREE.AdditiveBlending }));
  s.scale.set(0.12, 0.12, 1); s.frustumCulled = false;
  return s;
}
export const SUN_DIR = new V3(1, 0.08, 0.15).normalize();
