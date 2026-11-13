// T10437: exercise actual SVG channels and host theme metadata in WebKit.
import assert from 'node:assert/strict';
import { webkit } from 'playwright-core';
import { mkdirSync,writeFileSync } from 'node:fs';
import { serveFogDemo } from './kiwicat-demo';
const out=process.argv[2]??'/tmp/kiwi-T10437-runtime';mkdirSync(out,{recursive:true});
const server=await serveFogDemo('cat-demo.ts'),browser=await webkit.launch({headless:true});
const report:any={task:'T10437',checks:[],errors:[]};
try {
 const page=await browser.newPage({viewport:{width:640,height:800}});page.on('pageerror',e=>report.errors.push(String(e)));
 await page.goto(`${server.url}/?state=ouvindo&cutout=1&outline=1`);await page.waitForFunction(()=>(window as any).kiwiCatReady);
 const metadata=await page.evaluate(()=>{
  const a=(window as any).kiwiCat,before=JSON.stringify(a.frame),draws=a.fogStats.draws;
  const layer=document.getElementById('fog')!.lastElementChild!;
  const colors=[getComputedStyle(layer).color];a.setBackground('light');colors.push(getComputedStyle(layer).color);a.setBackground('dark');colors.push(getComputedStyle(layer).color);
  return {colors,sameFrame:JSON.stringify(a.frame)===before,sameDraws:draws===a.fogStats.draws,backing:document.querySelectorAll('.kn-cat-backdrop').length};
 });
 assert.deepEqual(metadata.colors,['rgb(255, 255, 255)','rgb(23, 23, 28)','rgb(255, 255, 255)']);assert.ok(metadata.sameFrame&&metadata.sameDraws);assert.equal(metadata.backing,0);report.checks.push({name:'host metadata changes only symbol ink',...metadata});
 for(const [voice,expected,time] of [[0,1,1],[.5,2,2],[1,3,3],[null,0,3.1]] as const){
  const wave=await page.evaluate(({voice,time})=>{
   const a=(window as any).kiwiCat;a.update({voz:voice});a.capture(time);
   const nodes=[...document.querySelectorAll<HTMLElement>('[data-symbol="ouvindo"]')];
   return {count:nodes.filter(e=>Number(getComputedStyle(e).opacity)>.01).length,parts:nodes.map(e=>e.dataset.part)};
  },{voice,time});
  assert.equal(wave.count,expected);assert.deepEqual(wave.parts,['0','1','2']);report.checks.push({name:'voice waves',voice,...wave});
 }
 await page.goto(`${server.url}/?state=erro&cutout=1`);await page.waitForFunction(()=>(window as any).kiwiCatReady);
 const trace=[];
 for(const time of [.1,.3,.6,.85,1.2])trace.push(await page.evaluate(time=>{
  const a=(window as any).kiwiCat;a.capture(time);const p=document.querySelector<SVGPathElement>('[data-scribble]')!;
  return {time,d:p.getAttribute('d'),length:p.getTotalLength(),offset:Number(p.style.strokeDashoffset),progress:a.frame.progress};
 },time));
 for(const row of trace){assert.ok(Number.isFinite(row.length)&&row.length>0);assert.ok(Math.abs(row.offset-row.length*(1-row.progress))<.0001);assert.equal(row.d,trace[0]!.d);}
 assert.ok(trace[1]!.offset>trace[2]!.offset&&trace[2]!.offset>trace[3]!.offset);report.checks.push({name:'fixed error curve traced by dash without reshaping',trace});
 await page.evaluate(()=>(window as any).kiwiCat.dispose());assert.equal(await page.locator('#fog > *').count(),0);report.checks.push({name:'dispose empties module'});
}finally{await browser.close();server.close();writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2)+'\n');}
assert.deepEqual(report.errors,[]);console.log('Symbol theme, wave channels, trace and lifecycle passed');
