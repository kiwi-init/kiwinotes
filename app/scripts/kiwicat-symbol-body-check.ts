// T10437: excluding symbols, the real rendered fog/coat/arc/eyes must be identical.
import assert from 'node:assert/strict';
import { webkit } from 'playwright-core';
import { mkdirSync,writeFileSync } from 'node:fs';
import { serveFogDemo } from './kiwicat-demo';
const base=process.env.KIWI_CAT_BASELINE??'/tmp/kiwi-T10437-baseline';
const {serveFogDemo:serveBase}=await import(`${base}/app/scripts/kiwicat-demo.ts`);
const out=process.argv[2]??'/tmp/kiwi-T10437-body';mkdirSync(out,{recursive:true});
const old=await serveBase('cat-demo.ts'),fresh=await serveFogDemo('cat-demo.ts'),browser=await webkit.launch({headless:true});
const report:any={task:'T10437',baseline:'afda4c9',scope:'actual body/fog/arc/eyes with all symbol nodes hidden; fixed states',rows:[],errors:[]};
try{
 for(const backend of ['auto','webgl2','none'])for(const state of ['repouso','dormindo','acordou','ouvindo','thinking','agindo','pronto','erro'])for(const [variant,server]of [['baseline',old],['new',fresh]]as const){
  const context=await browser.newContext({viewport:{width:640,height:800}}),page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)));
  await context.route('**/*',async r=>{if(new URL(r.request().url()).pathname==='/'){const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('<style>','<style>[data-symbol]{visibility:hidden!important} ')});}else await r.continue();});
  await page.goto(`${server.url}/?state=${state}&parado=1&cutout=1&outline=1&backend=${backend}&voice=1`);await page.waitForFunction(()=>(window as any).kiwiCatReady);
  await page.screenshot({path:`${out}/${backend}-${state}-${variant}.png`});
  report.rows.push({backend,state,variant,actual:await page.evaluate(()=>(window as any).kiwiCat.fogStats.backend)});await context.close();
 }
}finally{await browser.close();old.close();fresh.close();writeFileSync(`${out}/capture.json`,JSON.stringify(report,null,2)+'\n');}
assert.deepEqual(report.errors,[]);console.log('48 isolated body/eye captures saved',out);
