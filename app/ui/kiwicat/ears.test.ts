import { expect, test } from 'bun:test';
import { GestureMachine, seededRandom, type GestureEvent } from './gestures';
import { fixedEars } from './ears';
import { STATES, type FogState } from './state';
function make(state: FogState='repouso') {
 const events:GestureEvent[]=[];
 const cat=new GestureMachine({estado:state},{clock:()=>0,random:seededRandom(71),earRandom:seededRandom(37),sleepSeconds:()=>1e9,onEvent:e=>events.push(e)});
 return {cat,events};
}
test('ears use elapsed time: identical events and poses at 30/60/120 Hz',()=>{
 const results=[30,60,120].map(hz=>{const m=make();for(let n=0;n<=120*hz;n++)m.cat.sample(n/hz);return {events:m.events,pose:m.cat.sample(120).ears};});
 expect(results[0]).toEqual(results[1]);expect(results[1]).toEqual(results[2]);
});
test('idle twitch chooses only one ear, stays in bounds and leaves 600ms around gaze',()=>{
 const m=make();m.cat.sample(220);
 const twitches=m.events.filter(e=>e.kind==='tique_orelha');expect(twitches.length).toBeGreaterThan(5);
 for(let i=0;i<twitches.length;i++) {
  const e=twitches[i]!,[side,angle,go,hold,back]=e.values;
  expect([0,1]).toContain(side!);expect(Math.abs(angle!)).toBeGreaterThanOrEqual(10);expect(Math.abs(angle!)).toBeLessThanOrEqual(22);
  expect(angle!*(side===0?1:-1)).toBeGreaterThan(0);
  expect(go!).toBeGreaterThanOrEqual(.12);expect(go!).toBeLessThanOrEqual(.18);
  expect(hold!).toBeGreaterThanOrEqual(.05);expect(hold!).toBeLessThanOrEqual(.1);
  expect(back!).toBeGreaterThanOrEqual(.22);expect(back!).toBeLessThanOrEqual(.36);
  // The event log checks exclusion without projecting a discarded past gesture.
  const end=e.at+go!+hold!+back!;
  for(const look of m.events.filter(e=>e.kind==='olhar_lateral')) {
   const lookEnd=look.at+look.values.slice(1).reduce((a,b)=>a+b,0);
   expect(look.at>=end+.6-1e-8 || e.at>=lookEnd+.6-1e-8).toBe(true);
  }
  if(i) {const p=twitches[i-1]!,gap=e.at-p.at-p.values.slice(2).reduce((a,b)=>a+b,0);expect(gap).toBeGreaterThanOrEqual(7-1e-8);}
 }
 const n=make();let saw=false;
 for(let t=0;t<80;t+=1/120){const p=n.cat.sample(t).ears;if(Math.max(...p.map(Math.abs))>.01){saw=true;expect(p[0]===0||p[1]===0).toBe(true);}expect(Math.max(...p.map(Math.abs))).toBeLessThanOrEqual(25);}
 expect(saw).toBe(true);
});
test('entry gestures and fixed frames use the roteiro angles and exact phases',()=>{
 for(const state of STATES) {
  const {cat}=make(state);cat.update({parado:true},0);expect(cat.sample(100).ears).toEqual(fixedEars(state));
 }
 const awake=make('acordou').cat;expect(awake.sample(.2).ears).toEqual([0,0]);expect(awake.sample(.53).ears).toEqual([-25,25]);expect(awake.sample(.72).ears).toEqual([-25,25]);expect(awake.sample(1.4).ears).toEqual([0,0]);
 expect(make('dormindo').cat.sample(.7).ears).toEqual([12,-12]);expect(make('agindo').cat.sample(.32).ears).toEqual([-10,10]);
 const ready=make('pronto').cat;expect(ready.sample(.26).ears).toEqual([8,-8]);expect(ready.sample(.42).ears).toEqual([8,-8]);expect(ready.sample(.84).ears).toEqual([0,0]);
 const error=make('erro').cat;expect(error.sample(.12).ears).toEqual([0,0]);expect(error.sample(.82).ears).toEqual([20,-20]);expect(error.sample(120).ears).toEqual([20,-20]);
});
test('all interruptions start at the displayed angle, never from neutral',()=>{
 for(const from of STATES) for(const to of STATES) if(from!==to) {
  const {cat}=make(from);const before=cat.sample(.4).ears;
  expect(cat.update({estado:to},.4).ears).toEqual(before);
  for(let t=.4;t<2;t+=.013)expect(Math.max(...cat.sample(t).ears.map(Math.abs))).toBeLessThanOrEqual(25);
 }
});
test('leaving reduced motion settles from its fixed pose without replaying surprise',()=>{
 const {cat}=make('acordou');cat.update({parado:true},0);
 expect(cat.update({parado:false},10).ears).toEqual([-25,25]);
 const middle=cat.sample(10.12).ears;expect(middle[0]).toBeCloseTo(-12.5,8);expect(cat.sample(10.24).ears).toEqual([0,0]);
});
test('listening orientations are unilateral inward and independent of voice levels',()=>{
 const a=make('ouvindo'),b=make('ouvindo');
 for(let n=0;n<=1200;n++){const t=n/30;a.cat.update({voz:n%2},t);b.cat.update({voz:null},t);expect(a.cat.sample(t).ears).toEqual(b.cat.sample(t).ears);}
 const gestures=a.events.filter(e=>e.kind==='orientar_orelha');expect(gestures.length).toBeGreaterThan(3);
 for(const e of gestures){const [side,angle,go,hold,back]=e.values;expect(angle!*(side===0?-1:1)).toBeGreaterThanOrEqual(12);expect(Math.abs(angle!)).toBeLessThanOrEqual(25);expect(go).toBe(.18);expect(hold!).toBeGreaterThanOrEqual(.35);expect(hold!).toBeLessThanOrEqual(.7);expect(back).toBe(.36);}
});
