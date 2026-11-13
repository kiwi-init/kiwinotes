// T8959: native headless WebKit recordings, never performance data.
import { webkit } from 'playwright-core';
import { mkdirSync,mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve,join } from 'node:path';
import { serveFogDemo } from './kiwicat-demo';
const out=resolve(process.argv[2]??'../docs/brand/kiwi-cat/caretas/videos');mkdirSync(out,{recursive:true});
const rawDir=mkdtempSync(join(tmpdir(),'kiwi-T8959-videos-'));
const server=await serveFogDemo('cat-demo.ts'), browser=await webkit.launch({headless:true});
const report:any={task:'T8959',scope:'native WebKit recording, not performance',colour:'padrao',voice:'synthetic numeric input; no microphone',scenes:[]};
try {
 for(const state of ['repouso','dormindo','acordou','ouvindo','thinking','agindo','pronto','erro']) {
  const seconds=state==='repouso'?16:state==='pronto'?2:state==='acordou'?3:6;
  const context=await browser.newContext({viewport:{width:640,height:800},deviceScaleFactor:1,recordVideo:{dir:rawDir,size:{width:640,height:800}}});
  await context.route('**/*',r=>new URL(r.request().url()).origin===server.url?r.continue():r.abort());
  const page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(server.url+'/?mode=measure&state=repouso');await page.waitForFunction(()=>(window as any).kiwiCatReady);
  await page.evaluate(s=>{const a=(window as any).kiwiCat;a.update({estado:s,voz:s==='ouvindo'?.8:null});},state);
  if(state==='ouvindo') await page.evaluate(()=>{let t=0;(window as any).voiceTimer=setInterval(()=>{t+=.08;(window as any).kiwiCat.update({voz:.1+.8*Math.max(0,Math.sin(t*2))});},80);});
  await page.waitForTimeout(seconds*1000);
  const data=await page.evaluate(()=>{const a=(window as any).kiwiCat;clearInterval((window as any).voiceTimer);return {visualState:a.visualState,stats:a.stats,fog:a.fogStats};});
  const video=page.video()!;await page.evaluate(()=>(window as any).kiwiCat.dispose());await context.close();
  const raw=join(rawDir,state+'.webm');await video.saveAs(raw);
  const enc=Bun.spawnSync(['ffmpeg','-v','error','-y','-i',raw,'-an','-c:v','libx264','-preset','medium','-crf','23','-threads','2','-pix_fmt','yuv420p','-movflags','+faststart',join(out,state+'.mp4')]);
  if(enc.exitCode||errors.length)throw new Error(state+': '+errors.join(',')+new TextDecoder().decode(enc.stderr));
  report.scenes.push({state,seconds,errors,...data});console.log(state,'recorded');
 }
}finally{rmSync(rawDir,{recursive:true,force:true});await browser.close();server.close();writeFileSync(join(out,'manifest.json'),JSON.stringify(report,null,2)+'\n');}
