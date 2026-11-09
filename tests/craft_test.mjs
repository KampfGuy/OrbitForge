globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
import { layout, buildEvents, stageStats, EXAMPLES, eventLabel, craftMass } from '../js/craft.js';
for (const c of EXAMPLES) {
  const inst = layout(c), ev = buildEvents(inst), st = stageStats(inst, ev);
  console.log('==', c.name, 'mass', craftMass(inst).toFixed(2), 'parts', inst.length);
  ev.forEach((e,i)=>console.log(' ', i, eventLabel(inst,e), 'dvVac', st[i].dvVac.toFixed(0), 'dv', st[i].dv.toFixed(0), 'twr', st[i].twr.toFixed(2), 't', st[i].t.toFixed(0)));
  console.log('  total vac', st.reduce((a,s)=>a+s.dvVac,0).toFixed(0));
}
