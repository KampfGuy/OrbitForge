globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
import { layout, buildEvents, stageStats, PLANE_EXAMPLES, centers, craftMass, eventLabel } from '../js/craft.js';
for (const c of PLANE_EXAMPLES) { const inst=layout(c), ev=buildEvents(inst), st=stageStats(inst,ev), ce=centers(inst,true);
  console.log(c.name, craftMass(inst).toFixed(2), 'parts', inst.length, 'CoM y', ce.com.y.toFixed(2), 'CoL y', ce.col.y.toFixed(2), 'CoT', ce.cot.y.toFixed(2));
  const g = inst.filter(p=>p.def.gear).map(p=>[p.id, p.com.y.toFixed(2), (p.pos.z+p.dir.z*p.def.gear.len).toFixed(2)]); console.log(' gear', JSON.stringify(g));
  ev.forEach((e,i)=>console.log('  ', eventLabel(inst,e), st[i].dvVac.toFixed(0), st[i].twr.toFixed(2))); }
