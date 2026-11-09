import * as T from '../js/vendor/three.module.min.js';
import { HOME, LUMO, PIP, propagate, elements, predict, moonState } from '../js/orbit.js';
const r = new T.Vector3(680000,0,0), vc=Math.sqrt(HOME.mu/680000);
const v = new T.Vector3(0,0,-vc);
const el = elements(r,v,HOME.mu); console.log('circ', el.ecc, el.period, el.rp-HOME.radius);
const R=new T.Vector3(),VV=new T.Vector3(); propagate(r,v,el.period*0.25,HOME.mu,R,VV); console.log('quarter', R.toArray().map(x=>x.toFixed(1)));
propagate(r,v,el.period*10.5,HOME.mu,R,VV); console.log('10.5', R.toArray().map(x=>x.toFixed(1)));
// hyperbolic
const vh=new T.Vector3(0,0,-vc*1.6); propagate(r,vh,50000,HOME.mu,R,VV); const e2=elements(r,vh,HOME.mu); console.log('hyp e',e2.ecc,'r after',R.length(), 'energy check', VV.lengthSq()/2-HOME.mu/R.length(), e2.energy);
console.log('SOI lumo', LUMO.soi, 'pip', PIP.soi, 'lumo period', LUMO.orbit.period);
// hohmann to lumo: search departure time over one lumo period
const a2=(680000+LUMO.orbit.a)/2, vp=Math.sqrt(HOME.mu*(2/680000-1/a2));
let found=null;
for(let t0=0;t0<LUMO.orbit.period;t0+=200){
  // vessel circular at angle phi = n*t0 starting phase 0
  const n=vc/680000, ph=n*t0; const rr=new T.Vector3(680000*Math.cos(ph),0,-680000*Math.sin(ph)); const dir=new T.Vector3(-Math.sin(ph),0,-Math.cos(ph));
  const pat=predict(HOME, rr, dir.clone().multiplyScalar(vp+5), t0, 3);
  if(pat[0].end==='encounter'){ found={t0,pat}; break; }
}
console.log('encounter', found && found.t0, found && found.pat.map(p=>[p.body.name,p.end,p.pts.length,(p.el.rp-p.body.radius).toFixed(0)]));
const lp=found.pat[1]; console.log(lp.pts.map((p,i)=>[lp.times[i].toFixed(0), (p.length()/1000).toFixed(0)]), lp.el.ecc, lp.el.a, lp.v0.length());
