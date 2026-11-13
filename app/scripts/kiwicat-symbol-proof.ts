// T10437: full-size and actual 120px module captures. No real app or agent.
import assert from 'node:assert/strict';
import { webkit } from 'playwright-core';
import { mkdirSync,writeFileSync } from 'node:fs';
import { serveFogDemo } from './kiwicat-demo';
const out=process.argv[2]??'/tmp/kiwi-T10437-symbols';mkdirSync(out,{recursive:true});
const server=await serveFogDemo('cat-demo.ts'),browser=await webkit.launch({headless:true});
const states=['dormindo','acordou','ouvindo','thinking','agindo','pronto','erro'];
const report:any={task:'T10437',seed:17,scope:'real module, unchanged fog/eyes, approved symbols; headless only',rows:[],errors:[]};
try {
 for(const size of [800,120]) for(const theme of ['dark','light']) for(const state of states){
  const large=size===800,width=large?640:96,height=size,pad=large?'80px':'20px 32px',viewport=large?{width:800,height:960}:{width:160,height:160};
  const color=theme==='light'?'#fff':'#111113';
  const context=await browser.newContext({viewport,deviceScaleFactor:1});
  await context.route('**/*',async r=>{
   const u=new URL(r.request().url());if(u.origin!==server.url){await r.abort();return;}
   if(u.pathname==='/'){
    const response=await r.fetch();const html=(await response.text()).replace('background:#000',`background:${color}`).replace('<div id="fog"></div>',`<div style="padding:${pad}"><div id="fog"></div></div>`);
    await r.fulfill({response,body:html});
   }else await r.continue();
  });
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)));
  await page.goto(`${server.url}/?state=${state}&parado=1&cutout=1&outline=1&width=${width}&height=${height}&symbolTheme=${theme}&background=${encodeURIComponent(color)}&voice=1`);
  await page.waitForFunction(()=>(window as any).kiwiCatReady);
  assert.equal(await page.evaluate(()=>(window as any).kiwiCat.fogStats.backend),'webgpu');
  const data=await page.evaluate(()=>{
   const root=document.getElementById('fog')!;
   const active=[...root.querySelectorAll<HTMLElement>('[data-symbol]')].filter(e=>Number(getComputedStyle(e).opacity)>0);
   const foreground=root.lastElementChild as HTMLElement;
   return {state:(window as any).kiwiCat.visualState,ink:getComputedStyle(foreground).color,
    backing:root.querySelectorAll('.kn-cat-backdrop').length,
    symbols:active.map(e=>({state:e.dataset.symbol,box:e.getBoundingClientRect().toJSON()}))};
  });
  assert.equal(data.backing,0);assert.equal(data.state,state);assert.equal(data.ink,theme==='light'?'rgb(23, 23, 28)':'rgb(255, 255, 255)');
  await page.screenshot({path:`${out}/${size}-${theme}-${state}.png`});
  report.rows.push({size,theme,...data});await context.close();
 }
}finally{await browser.close();server.close();writeFileSync(`${out}/capture.json`,JSON.stringify(report,null,2)+'\n');}
assert.deepEqual(report.errors,[]);console.log('42 module symbol captures saved',out);
