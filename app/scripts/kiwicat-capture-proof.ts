// T8487/spec7549 gate1: minimal GPU clears, not the fog shader or a benchmark.
// Own loopback server, production CSP, WebKit headless; no engine/helper/mic.
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { webkit } from 'playwright-core';
import { VIEWS_CSP } from '../src/bun/window-security.ts';
const out=resolve(process.argv[2]??'docs/brand/kiwi-cat/nevoa/prova-captura');
mkdirSync(out,{recursive:true});
const source=String.raw`
const r=window.__proof={status:'initializing',backend:null,accelerated:null,evidence:null,phase:.15,frames:0,diagnostics:[],errors:[],webgpuAvailable:!!navigator.gpu,userAgent:navigator.userAgent};
const software=/swiftshader|llvmpipe|softpipe|software|lavapipe/i;
let canvas=document.querySelector('canvas'),render;
async function gpu(){
 if(!navigator.gpu){r.diagnostics.push('navigator.gpu unavailable');return false;}
 const adapter=await navigator.gpu.requestAdapter({powerPreference:'low-power',forceFallbackAdapter:false});
 if(!adapter){r.diagnostics.push('WebGPU requestAdapter returned null');return false;}
 const info=adapter.info||(adapter.requestAdapterInfo?await adapter.requestAdapterInfo():{});
 const fallback=info.isFallbackAdapter??adapter.isFallbackAdapter??null;
 const description=[info.vendor,info.architecture,info.device,info.description].filter(Boolean).join(' / ');
 const device=await adapter.requestDevice();
 device.addEventListener('uncapturederror',e=>{r.errors.push(String(e.error));r.status='failed';});
 device.pushErrorScope('validation');
 const context=canvas.getContext('webgpu');if(!context)throw new Error('WebGPU canvas context unavailable');
 const format=navigator.gpu.getPreferredCanvasFormat();context.configure({device,format,alphaMode:'opaque'});
 render=()=>{const encoder=device.createCommandEncoder();const pass=encoder.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),clearValue:{r:.25,g:r.phase,b:.85,a:1},loadOp:'clear',storeOp:'store'}]});pass.end();device.queue.submit([encoder.finish()]);};
 render();await device.queue.onSubmittedWorkDone();const error=await device.popErrorScope();if(error)throw new Error(error.message);
 r.backend='webgpu';r.evidence={fallbackAdapter:fallback,description,format};
 r.accelerated=software.test(description)||fallback===true?false:fallback===false||/apple|metal|intel|amd|nvidia/i.test(description)?true:null;
 return true;
}
function gl2(){
 const gl=canvas.getContext('webgl2',{alpha:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true});
 if(!gl){r.diagnostics.push('WebGL2 context unavailable');return false;}
 const debug=gl.getExtension('WEBGL_debug_renderer_info');
 const renderer=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
 const vendor=debug?gl.getParameter(debug.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR);
 render=()=>{gl.clearColor(.25,r.phase,.85,1);gl.clear(gl.COLOR_BUFFER_BIT);gl.finish();};
 render();const error=gl.getError();if(error!==gl.NO_ERROR)throw new Error('WebGL error '+error);
 r.backend='webgl2';r.evidence={renderer,vendor,version:gl.getParameter(gl.VERSION),debugExtension:!!debug,contextAttributes:gl.getContextAttributes()};
 const identity=String(renderer)+' / '+String(vendor);
 r.accelerated=software.test(identity)?false:/apple|metal|intel|amd|nvidia/i.test(identity)?true:null;
 return true;
}
(async()=>{
 let ready=false;
 try{ready=await gpu();}catch(e){r.diagnostics.push('WebGPU failed: '+String(e));const replacement=canvas.cloneNode();canvas.replaceWith(replacement);canvas=replacement;}
 if(!ready){try{ready=gl2();}catch(e){r.errors.push('WebGL2 failed: '+String(e));}}
 if(!ready){r.status='failed';return;}
 r.status='ready';
 function draw(){if(r.status!=='ready')return;try{render();r.frames++;requestAnimationFrame(draw);}catch(e){r.errors.push(String(e));r.status='failed';}}
 requestAnimationFrame(draw);
})().catch(e=>{r.errors.push(String(e));r.status='failed';});
`;
const html='<!doctype html><meta charset="utf-8"><title>Kiwi capture proof</title><style>html,body{margin:0;background:#000;overflow:hidden}canvas{display:block;width:640px;height:800px}</style><canvas width="640" height="800"></canvas><script src="/proof.js"></script>';
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){const path=new URL(req.url).pathname;return new Response(path==='/proof.js'?source:path==='/'?html:'not found',{status:path==='/'||path==='/proof.js'?200:404,headers:{'Content-Type':path==='/proof.js'?'text/javascript':'text/html','Content-Security-Policy':VIEWS_CSP}});}});
const origin=`http://127.0.0.1:${server.port}`;
const report:Record<string,any>={task:'T8487',spec:'#7549',stage:'capture feasibility only; GPU clears, not fog',browser:'Playwright WebKit',headless:true,viewport:{width:640,height:800},deviceScaleFactor:1,performanceClaim:false,passed:false,problems:[]};
let browser:Awaited<ReturnType<typeof webkit.launch>>|undefined;
try{
 browser=await webkit.launch({headless:true});report.browserVersion=browser.version();
 const context=await browser.newContext({viewport:{width:640,height:800},deviceScaleFactor:1,reducedMotion:'no-preference',permissions:[],recordVideo:{dir:out,size:{width:640,height:800}}});
 await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 const page=await context.newPage();page.on('pageerror',e=>report.problems.push(String(e)));
 page.on('dialog',dialog=>{report.problems.push('Unexpected browser dialog: '+dialog.type());void dialog.dismiss();});
 await page.goto(origin,{waitUntil:'load',timeout:15000});
 await page.waitForFunction(()=>['ready','failed'].includes((window as any).__proof?.status),null,{timeout:15000});
 report.initial=await page.evaluate(()=>(window as any).__proof);
 if(report.initial.status==='ready'){
  await page.waitForFunction(()=>(window as any).__proof.frames>=2,null,{timeout:5000});
  await page.screenshot({path:join(out,'phase-a.png')});await page.waitForTimeout(900);
  await page.evaluate(()=>{(window as any).__proof.phase=.8;});const before=await page.evaluate(()=>(window as any).__proof.frames);
  await page.waitForFunction(n=>(window as any).__proof.frames>=n+2,before,{timeout:5000});
  await page.screenshot({path:join(out,'phase-b.png')});await page.waitForTimeout(900);
 }else await page.screenshot({path:join(out,'failed.png')});
 report.final=await page.evaluate(()=>(window as any).__proof);
 const video=page.video();await context.close();
 if(video){const saved=await video.path(),dest=join(out,'capture.webm');if(saved!==dest)renameSync(saved,dest);report.video='capture.webm';}
}catch(e){report.problems.push(String(e));}finally{await browser?.close();server.stop(true);}
function run(args:string[]){const r=Bun.spawnSync(args,{stdout:'pipe',stderr:'pipe'});if(r.exitCode!==0)throw new Error(new TextDecoder().decode(r.stderr));return r.stdout;}
function sample(file:string,time:number){const bytes=run(['ffmpeg','-v','error','-ss',String(time),'-i',join(out,file),'-vf','scale=32:40','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1']);if(bytes.length!==3840)throw new Error('Incomplete decoded frame');return bytes;}
try{
 if(report.video){
  run(['ffmpeg','-v','error','-y','-i',join(out,'capture.webm'),'-an','-c:v','libx264','-preset','medium','-crf','18','-threads','2','-pix_fmt','yuv420p','-movflags','+faststart',join(out,'capture.mp4')]);
  if(report.final?.status==='ready'){
   const a=sample('capture.mp4',.5),b=sample('capture.mp4',1.5),mean=(v:Uint8Array)=>v.reduce((sum,n)=>sum+n,0)/v.length;
   report.decodedVideo={meanA:mean(a),meanB:mean(b),meanAbsoluteDifference:a.reduce((sum,n,i)=>sum+Math.abs(n-b[i]!),0)/a.length};
   report.passed=report.final.accelerated===true&&report.problems.length===0&&report.final.errors.length===0&&report.decodedVideo.meanA>15&&report.decodedVideo.meanB>15&&report.decodedVideo.meanAbsoluteDifference>8;
  }
  report.videoProbe=JSON.parse(new TextDecoder().decode(run(['ffprobe','-v','error','-show_streams','-show_format','-of','json',join(out,'capture.mp4')])));
 }
}catch(e){report.problems.push('Decode verification: '+String(e));report.passed=false;}
writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));process.exitCode=report.passed?0:1;
