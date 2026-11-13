// T10437: controlled 30Hz RGBA export from the actual module, never interpolation.
import assert from 'node:assert/strict';
import { webkit } from 'playwright-core';
import { mkdirSync,mkdtempSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve,join } from 'node:path';
import { serveFogDemo } from './kiwicat-demo';
const out=resolve(process.argv[2]??'../docs/brand/kiwi-cat/simbolos/videos');mkdirSync(out,{recursive:true});
const raw=mkdtempSync(join(tmpdir(),'kiwi-T10437-video-')),fps=30;
const manifestFile=join(raw,'capture-full.json');
const server=await serveFogDemo('cat-demo.ts'),browser=await webkit.launch({headless:true});
const manifest:any={task:'T10437',scope:'actual module RGBA at controlled 30Hz, two theme renderers sampled sequentially; not performance',fps,seed:17,raw,scenes:[],errors:[]};
try {
 for(const [state,seconds] of [['dormindo',6],['acordou',3],['ouvindo',8],['thinking',6],['agindo',6],['pronto',2.4],['erro',6]] as const){
  const themes:any[]=[];
  for(const theme of ['dark','light']){
   const dir=join(raw,`${state}-${theme}`);mkdirSync(dir,{recursive:true});
   const context=await browser.newContext({viewport:{width:720,height:880},deviceScaleFactor:1});
   await context.route('**/*',async r=>{
    const u=new URL(r.request().url());if(u.origin!==server.url){await r.abort();return;}
    if(u.pathname==='/'){const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('background:#000','background:transparent').replace('<div id="fog"></div>','<div style="padding:40px"><div id="fog"></div></div>')});}
    else await r.continue();
   });
   const page=await context.newPage();page.on('pageerror',e=>manifest.errors.push(String(e)));
   await page.goto(`${server.url}/?state=repouso&cutout=1&outline=1&symbolTheme=${theme}&background=transparent&seed=17`);await page.waitForFunction(()=>(window as any).kiwiCatReady);
   await page.evaluate(state=>{(window as any).kiwiCat.update({estado:state,voz:state==='ouvindo'?0:null});(window as any).proofVoice=state==='ouvindo'?0:null;(window as any).proofExit=false;},state);
   const frames:string[]=[],timeline:any[]=[];let signature='',previous='';
   for(let n=0;n<Math.round(seconds*fps);n++){
    const data=await page.evaluate(({t,state,seconds})=>{
     const a=(window as any).kiwiCat;a.capture(t);
     if(state!=='pronto'&&t>=seconds-1&&!(window as any).proofExit){a.update({estado:'repouso',voz:null});(window as any).proofExit=true;}
     if(state==='ouvindo'&&!(window as any).proofExit){const voice=t<1?0:t<2?.5:t<3?1:t<4?null:t<6?.7:0;if(voice!==(window as any).proofVoice){a.update({voz:voice});(window as any).proofVoice=voice;}}
     a.capture(t);
     return {signature:`${a.fogStats.draws}/${a.stats.faceUpdates}`,backend:a.fogStats.backend,frame:a.frame};
    },{t:n/fps,state,seconds});
    assert.equal(data.backend,'webgpu');
    if(data.signature!==signature||!previous){previous=`${String(n).padStart(6,'0')}.png`;signature=data.signature;await page.screenshot({path:join(dir,previous),omitBackground:true});}
    frames.push(previous);timeline.push(data.frame);
   }
   await context.close();themes.push({theme,dir,frames,timeline,uniqueFrames:new Set(frames).size});console.log(state,theme,'RGBA',new Set(frames).size,'/',frames.length);
  }
  assert.deepEqual(themes[0].timeline,themes[1].timeline,'theme must not change poses or timing');
  manifest.scenes.push({state,seconds,themes});
 }
}finally{await browser.close();server.close();writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n');}
assert.deepEqual(manifest.errors,[]);
const p=Bun.spawn([process.env.KIWI_CUTOUT_PYTHON??'python3',resolve(import.meta.dir,'kiwicat-symbol-video-compose.py'),manifestFile,out],{stdout:'inherit',stderr:'inherit'});assert.equal(await p.exited,0);

writeFileSync(join(out,'capture-index.json'),JSON.stringify({task:manifest.task,scope:manifest.scope,fps,seed:17,rawManifest:manifestFile,rawManifestSHA256:new Bun.CryptoHasher('sha256').update(await Bun.file(manifestFile).arrayBuffer()).digest('hex'),sameTimelineVerified:true,scenes:manifest.scenes.map((s:any)=>({state:s.state,seconds:s.seconds,themes:s.themes.map((t:any)=>({theme:t.theme,dir:t.dir,frames:t.frames,uniqueFrames:t.uniqueFrames}))}))},null,2)+'\n');
