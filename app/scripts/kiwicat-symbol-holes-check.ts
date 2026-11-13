// T10437 r2: real mask alpha, non-neutral backdrop, and source pixels for hub proof.
import assert from 'node:assert/strict';
import { webkit } from 'playwright-core';
import { mkdirSync,writeFileSync } from 'node:fs';
import { serveFogDemo } from './kiwicat-demo';
const out=process.argv[2]??'/tmp/kiwi-T10437-holes-r2';mkdirSync(out,{recursive:true});
const server=await serveFogDemo('cat-demo.ts'),browser=await webkit.launch({headless:true});
const report:any={task:'T10437',revision:2,size:[384,464],root:[320,400],rows:[],errors:[]};
try {
 for(const theme of ['dark','light'])for(const kind of ['svg-only','rgba','control','blue']){
  const color=kind==='blue'?'#367a8e':'transparent';
  const css=kind==='svg-only'?'#fog>div:first-child{visibility:hidden!important}':kind==='control'?'[data-symbol]{visibility:hidden!important}':'';
  const context=await browser.newContext({viewport:{width:384,height:464},deviceScaleFactor:1});
  await context.route('**/*',async r=>{const u=new URL(r.request().url());if(u.origin!==server.url){await r.abort();return;}
   if(u.pathname==='/'){const response=await r.fetch();const html=(await response.text()).replace('background:#000',`background:${color}`).replace('<style>',`<style>${css}`).replace('<div id="fog"></div>','<div style="padding:32px"><div id="fog"></div></div>');await r.fulfill({response,body:html});}else await r.continue();});
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)));
  await page.goto(`${server.url}/?state=thinking&parado=1&cutout=1&width=320&height=400&symbolTheme=${theme}&background=${encodeURIComponent(color)}`);await page.waitForFunction(()=>(window as any).kiwiCatReady);
  const data=await page.evaluate(()=>{
   const svg=document.querySelector<SVGSVGElement>('[data-symbol="thinking"] svg')!,g=svg.firstElementChild as SVGGElement,m=g.getScreenCTM()!;
   const dots=[...svg.querySelectorAll<SVGCircleElement>('[data-dot]')];
   const point=(x:number,y:number)=>{const p=new DOMPoint(x,y).matrixTransform(m);return {x:p.x,y:p.y};};
   return {points:dots.map(d=>point(Number(d.getAttribute('cx')),Number(d.getAttribute('cy')))),solid:point(53,60),mask:svg.querySelector('mask')?.id,backend:(window as any).kiwiCat.fogStats.backend};
  });
  assert.equal(data.backend,'webgpu');assert.equal(data.points.length,3);assert.ok(data.mask);
  for(const opacity of kind==='svg-only'?[1,.35,0]:[1]){
   if(kind==='svg-only')await page.evaluate(opacity=>document.querySelectorAll<SVGElement>('[data-dot]').forEach(d=>d.style.opacity=String(opacity)),opacity);
   const file=`${theme}-${kind}-${opacity}.png`;await page.screenshot({path:`${out}/${file}`,omitBackground:kind!=='blue'});
   report.rows.push({theme,kind,opacity,file,...data});
  }
  await context.close();
 }
}finally{await browser.close();server.close();writeFileSync(`${out}/capture.json`,JSON.stringify(report,null,2)+'\n');}
assert.deepEqual(report.errors,[]);console.log('12 mask/background captures saved',out);
