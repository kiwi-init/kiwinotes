// T10367: one RGBA pose, checked against fresh real WebKit background pages.
import { webkit } from 'playwright-core';
import { mkdirSync,writeFileSync } from 'node:fs';
import { serveFogDemo } from './kiwicat-demo';
const out=process.argv[2]??'/tmp/kiwi-T10367-curves';mkdirSync(out,{recursive:true});
const server=await serveFogDemo('cat-demo.ts'),browser=await webkit.launch({headless:true});
const report:any={task:'T10367',seed:17,size:[640,800],scope:'one real RGBA pose per curve, compared against fresh WebKit background pages',rows:[],errors:[]};
try {
 for(const curve of ['ellipse','superellipse']) for(const [state,time] of [['agindo',1.2],['acordou',.53],['erro',.85]] as const){
  for(const [name,color] of [['rgba','transparent'],['cor','#367a8e'],['branco','#fff']]) {
   const context=await browser.newContext({viewport:{width:640,height:800},deviceScaleFactor:1});
   const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)));
   await page.route('**/*',r=>new URL(r.request().url()).origin===server.url?r.continue():r.abort());
   await page.goto(`${server.url}/?state=${state}&cutout=1&outline=1&backing=.5&edgeCurve=${curve}&seed=17&background=${encodeURIComponent(color!)}`);
   await page.waitForFunction(()=>(window as any).kiwiCatReady);
   await page.evaluate(color=>{document.body.style.background=color!;document.documentElement.style.background=color!;},color);
   const backend=await page.evaluate(()=>(window as any).kiwiCat.fogStats.backend);
   if(backend!=='webgpu')throw new Error('Expected WebGPU, got '+backend);
   await page.evaluate(time=>(window as any).kiwiCat.capture(time),time);
   await page.screenshot({path:`${out}/${curve}-${state}-${name}.png`,omitBackground:name==='rgba'});
   report.rows.push({curve,state,time,background:name,backend});await context.close();
  }
 }
}finally{await browser.close();server.close();writeFileSync(`${out}/capture.json`,JSON.stringify(report,null,2)+'\n');}
if(report.errors.length)throw new Error(report.errors.join('\n'));
console.log('18 synchronized choice/control captures saved',out);
