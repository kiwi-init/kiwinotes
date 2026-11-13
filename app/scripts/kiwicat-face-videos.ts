// T8959: native headless WebKit recordings, never performance data.
import { webkit } from 'playwright-core';
import { mkdirSync,mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve,join } from 'node:path';
import { serveFogDemo } from './kiwicat-demo';
const out=resolve(process.argv[2]??'../docs/brand/kiwi-cat/caretas/videos');mkdirSync(out,{recursive:true});
const rawDir=mkdtempSync(join(tmpdir(),'kiwi-T8959-videos-'));
const server=await serveFogDemo('cat-demo.ts'), browser=await webkit.launch({headless:true});
const report:any={task:'T8959',scope:'native WebKit recording, not performance',colour:'padrao',voice:'synthetic numeric input; no microphone',scenes:[]};
if(process.argv[3] && existsSync(join(out,'manifest.json'))) report.scenes=JSON.parse(readFileSync(join(out,'manifest.json'),'utf8')).scenes.filter((scene:any)=>scene.state!==process.argv[3]);
try {
 for(const state of ['repouso','dormindo','acordou','ouvindo','thinking','agindo','pronto','erro'].filter(state=>!process.argv[3]||state===process.argv[3])) {
  const seconds=state==='repouso'?16:state==='pronto'?2:state==='acordou'?3:6;
  const context=await browser.newContext({viewport:{width:640,height:800},deviceScaleFactor:1,recordVideo:{dir:rawDir,size:{width:640,height:800}}});
  await context.route('**/*',r=>new URL(r.request().url()).origin===server.url?r.continue():r.abort());
  const page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(server.url+'/?mode=measure&state=repouso');await page.waitForFunction(()=>(window as any).kiwiCatReady);
  await page.waitForFunction(()=>(window as any).kiwiCat.fogStats.draws>0);
  // Record a solid green marker only in the disposable raw recording. Its last
  // frame gives an exact trim boundary, independent of page-loading latency.
  await page.evaluate(()=>{const m=document.createElement('div');m.id='recording-marker';m.style.cssText='position:fixed;left:0;top:0;width:100vw;height:100vh;background:#00ff00;z-index:9999';document.body.append(m);});
  await page.waitForTimeout(400);
  await page.evaluate(s=>{document.getElementById('recording-marker')!.remove();const a=(window as any).kiwiCat;a.update({estado:s,voz:s==='ouvindo'?.8:null});},state);
  if(state==='ouvindo') await page.evaluate(()=>{let t=0;(window as any).voiceTimer=setInterval(()=>{t+=.08;(window as any).kiwiCat.update({voz:.1+.8*Math.max(0,Math.sin(t*2))});},80);});
  await page.waitForTimeout(seconds*1000);
  const data=await page.evaluate(()=>{const a=(window as any).kiwiCat;clearInterval((window as any).voiceTimer);return {visualState:a.visualState,stats:a.stats,fog:a.fogStats};});
  const video=page.video()!;await page.evaluate(()=>(window as any).kiwiCat.dispose());await context.close();
  const raw=join(rawDir,state+'.webm');await video.saveAs(raw);
  const marker=Bun.spawnSync(['ffmpeg','-v','error','-i',raw,'-vf','crop=16:16:312:392,scale=2:2','-f','rawvideo','-pix_fmt','rgb24','pipe:1']);
  if(marker.exitCode)throw new Error('Cannot inspect recording marker');
  const pixels=marker.stdout;let lastGreen=-1;
  for(let i=0;i<pixels.length;i+=12)if(pixels[i+1]!>180&&pixels[i+1]!>pixels[i]!+70&&pixels[i+1]!>pixels[i+2]!+70)lastGreen=i/12;
  if(lastGreen<0){writeFileSync('/tmp/kiwi-T8959-marker-pixels.bin',pixels);throw new Error('No recording trim marker found');}
  const trimFrame=lastGreen+1;
  const enc=Bun.spawnSync(['ffmpeg','-v','error','-y','-i',raw,'-vf',`trim=start_frame=${trimFrame},setpts=PTS-STARTPTS`,'-an','-c:v','libx264','-preset','medium','-crf','23','-threads','2','-pix_fmt','yuv420p','-movflags','+faststart',join(out,state+'.mp4')]);
  if(enc.exitCode||errors.length)throw new Error(state+': '+errors.join(',')+new TextDecoder().decode(enc.stderr));
  report.scenes.push({state,seconds,removedLeadingFrames:trimFrame,errors,...data});console.log(state,'recorded');
 }
}finally{if(report.scenes.length===8)rmSync(rawDir,{recursive:true,force:true});await browser.close();server.close();writeFileSync(join(out,'manifest.json'),JSON.stringify(report,null,2)+'\n');}
