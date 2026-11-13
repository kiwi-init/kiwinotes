// T9708: host typography must not move the eye or symbol SVG within its box.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { webkit } from 'playwright-core';
import { serveFogDemo } from './kiwicat-demo';
const out = process.argv[2] ?? '/tmp/kiwi-T9708-vector-layout'; mkdirSync(out,{recursive:true});
const server = await serveFogDemo('cat-demo.ts'), browser = await webkit.launch({headless:true});
const rows: any[] = [];
try {
 const page = await browser.newPage({viewport:{width:640,height:800}});
 for (const state of ['repouso','dormindo','pronto','thinking','agindo','erro']) {
  await page.goto(`${server.url}/?state=${state}&parado=1&backend=none&width=96&height=120&cutout=1&outline=1`);
  await page.waitForFunction(() => (window as any).kiwiCatReady);
  const row = await page.evaluate(state => {
   const root=document.getElementById('fog')!;root.style.lineHeight='200px';
   const cat=root.getBoundingClientRect();
   const eyes=[...root.querySelectorAll('[data-eye] svg circle')].map(eye=>{ const b=eye.getBoundingClientRect();return {left:b.left-cat.left,top:b.top-cat.top,right:b.right-cat.left,bottom:b.bottom-cat.top}; });
   const boxes=[...root.querySelectorAll('svg')].map(svg=>{
    const a=svg.getBoundingClientRect(),b=svg.parentElement!.getBoundingClientRect();
    return {eye:!!svg.closest('[data-eye]'),x:a.x-b.x,y:a.y-b.y,width:a.width,height:a.height,parentWidth:b.width,parentHeight:b.height};
   });
   return {state,boxes,eyes,cat:{width:cat.width,height:cat.height}};
  },state);
  rows.push(row); await page.screenshot({path:`${out}/${state}.png`});
 }
} finally {await browser.close();server.close();writeFileSync(`${out}/report.json`,JSON.stringify(rows,null,2)+'\n');}
for(const row of rows) for(const box of row.boxes) {
 assert.ok(Math.abs(box.x)<.5 && Math.abs(box.y)<.5,`${row.state}: SVG outside own box ${JSON.stringify(box)}`);
 assert.ok(box.width>0 && box.height>0,'empty vector');
 assert.ok(Math.abs(box.width-box.parentWidth)<.5 && Math.abs(box.height-box.parentHeight)<.5,'wrong vector size');
}
for(const row of rows) {
 assert.equal(row.eyes.length,2,'both eyes mounted');
 for(const eye of row.eyes) assert.ok(eye.left>=0 && eye.top>=0 && eye.right<=row.cat.width && eye.bottom<=row.cat.height,'eye outside cat box');
}
console.log('Host line-height 200px: all eye and symbol SVGs aligned within 0.5px');
