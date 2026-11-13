// Natural gesture CPU profile with matched fog controls; not acceptance.
import { webkit } from 'playwright-core';
import { mkdirSync,readFileSync,writeFileSync,existsSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { serveFogDemo } from './kiwicat-demo';
const app=resolve(import.meta.dir,'..');
const out=resolve(process.argv[2]??join(app,'../docs/brand/kiwi-cat/caretas/desempenho/gestos-isolados'));
if(existsSync(join(out,'resumo.json')))throw new Error('Choose a new output directory to preserve evidence');
mkdirSync(out,{recursive:true});
const head=new TextDecoder().decode(Bun.spawnSync(['git','rev-parse','HEAD'],{cwd:app}).stdout).trim();
const source=Object.fromEntries(['index.ts','shader.ts','state.ts','cat-demo.ts','cat.ts','gestures.ts','vectors.ts','assets/reference-no-eyes.webp','assets/source.json'].map(file=>[file,new Bun.CryptoHasher('sha256').update(readFileSync(join(app,'ui/kiwicat',file))).digest('hex')]));
function processes(){return new TextDecoder().decode(Bun.spawnSync(['ps','-Ao','pid=,ppid=,time=,command=']).stdout).trim().split('\n').flatMap(line=>{const m=/^\s*(\d+)\s+(\d+)\s+([\d:.]+)\s+(.*)$/.exec(line);if(!m)return[];let cpu=0;for(const v of m[3]!.split(':').map(Number))cpu=cpu*60+v;return[{pid:Number(m[1]),ppid:Number(m[2]),cpu,command:m[4]!}];});}
const server=await serveFogDemo('cat-demo.ts');
const result:any={task:'T8959',measuredCommit:head,source_sha256:source,scope:'isolated natural gesture diagnostic; four windows per variant and gesture, not CPU acceptance',variantWarmupSeconds:10,noRecorder:true,variants:[]};
const scenes:any={"blink": {"seed": 3, "start": 4.514717240002938, "end": 5.275265883277171, "events": [{"kind": "piscar_lento", "at": 4.514717240002938, "values": [0.29365856751799585, 0.06419049100019038, 0.4026995847560465]}, {"kind": "olhar_lateral", "at": 10.244024781510234, "values": [-18.223131431266665, 0.2346771454438567, 1.1113725368399172, 0.26771204549819233]}]}, "look": {"seed": 12, "start": 6.265356957912445, "end": 7.645720715438947, "events": [{"kind": "olhar_lateral", "at": 6.265356957912445, "values": [18.245195056311786, 0.2295441146939993, 0.8016356441890821, 0.34918399864342065]}, {"kind": "piscar_lento", "at": 8.767078545992263, "values": [0.28652697686105966, 0.0921011560317129, 0.3092305696150288]}]}, "double": {"seed": 17, "start": 4.8841150312218815, "end": 6.535531696942635, "events": [{"kind": "piscar_lento", "at": 4.8841150312218815, "values": [0.2512040471844375, 0.07878195074386896, 0.3797915653605014]}, {"kind": "piscar_duplo", "at": 5.786671288656071, "values": [0.2441936450265348, 0.07774403749965131, 0.42692272576037793]}, {"kind": "olhar_lateral", "at": 11.953323194757104, "values": [-29.164672918617725, 0.2536132374033332, 1.2734851296292617, 0.3321249826485291]}]}};
try{
for(const [sceneName,scene] of Object.entries(scenes) as any){
for(const variant of ['fog','faces']){
 const before=new Set(processes().map(p=>p.pid));
 const instance=await webkit.launchServer({headless:true}),root=instance.process().pid!;
 const browser=await webkit.connect(instance.wsEndpoint());
 const report:any={scene:sceneName,seed:scene.seed,gestureStart:scene.start,gestureEnd:scene.end,variant,windows:[],errors:[]};
 function discover(){const all=processes(),owned=new Set<number>([root]);for(let i=0;i<10;i++)for(const p of all)if(owned.has(p.ppid))owned.add(p.pid);for(const p of all)if(!before.has(p.pid)&&p.ppid===1&&/ms-playwright\/webkit-/.test(p.command))owned.add(p.pid);const cohort=all.filter(p=>owned.has(p.pid));if(cohort.length!==5)throw new Error('Ambiguous owned browser cohort: '+cohort.length);return cohort;}
 async function open(){const context=await browser.newContext({viewport:{width:640,height:800},deviceScaleFactor:1,reducedMotion:'no-preference'});await context.route('**/*',(r:any)=>new URL(r.request().url()).origin===server.url?r.continue():r.abort());const page=await context.newPage();await page.addInitScript(()=>{let value=false;Object.defineProperty(window,'kiwiCatReady',{get:()=>value,set:v=>{value=v;(window as any).probeReadyAt=performance.now();}});});page.on('pageerror',(e:any)=>report.errors.push(String(e)));await page.goto(server.url+'/?mode=measure&seed='+scene.seed+'&fogOnly='+(variant==='fog'?'1':'0'));await page.waitForFunction(()=>(window as any).kiwiCatReady);await page.waitForTimeout(150);return{context,page};}
 async function read(page:any){return page.evaluate(()=>{const a=(window as any).kiwiCat;return{state:a.visualState??'repouso',faceUpdates:a.stats.faceUpdates??null,quietPlans:a.stats.quietPlans??null,animations:document.getAnimations().length,animationStates:document.getAnimations().map(a=>a.playState),draws:(a.fogStats??a.stats).draws,reduced:(a.fogStats??a.stats).reduced,slow:(a.fogStats??a.stats).slow};});}
 try{
  const warm=await open();await warm.page.waitForTimeout(10000);await warm.page.evaluate(()=>(window as any).kiwiCat.dispose());await warm.context.close();
  for(let index=0;index<4;index++){
   const {context,page}=await open();await page.evaluate(async target=>{await new Promise(resolve=>setTimeout(resolve,Math.max(0,(window as any).probeReadyAt+target*1000-performance.now())));},scene.start-.5);const initial=await read(page),first=discover(),ids=new Set(first.map(p=>p.pid)),started=performance.now();
   const pageWindow=await page.evaluate(async scene=>{const start=performance.now(),relativeStart=(start-(window as any).probeReadyAt)/1000;if(relativeStart>=scene.start)throw new Error('Probe started after gesture');await new Promise(resolve=>setTimeout(resolve,Math.max(0,(window as any).probeReadyAt+(scene.end+.25)*1000-performance.now())));return{elapsedMs:performance.now()-start,relativeStart,relativeEnd:(performance.now()-(window as any).probeReadyAt)/1000};},scene);
   const last=processes().filter(p=>ids.has(p.pid)),elapsed=(performance.now()-started)/1000,final=await read(page);
   if(last.length!==5)throw new Error('Measured cohort changed');
   const cpu=last.map(p=>({...p,cpuSecondsSampled:Math.max(0,p.cpu-first.find(q=>q.pid===p.pid)!.cpu)}));
   const isolatedGesture=variant==='fog'||initial.faceUpdates===1&&initial.quietPlans===0&&final.quietPlans>0&&final.faceUpdates>1&&final.animationStates.every((s:string)=>s!=='running');
   const item={index:index+1,elapsedSeconds:elapsed,pageWindow,initial,final,isolatedGesture,cpuSeconds:cpu.reduce((s,p)=>s+p.cpuSecondsSampled,0),processes:cpu};report.windows.push(item);
   if(!isolatedGesture||initial.state!=='repouso'||final.state!=='repouso'||initial.reduced||final.reduced||final.slow)throw new Error('Isolated gesture diagnostic guard failed: '+JSON.stringify(item));
   await page.evaluate(()=>(window as any).kiwiCat.dispose());await context.close();console.log(variant,'window',index+1,item.cpuSeconds,elapsed);
  }
  report.elapsedSeconds=report.windows.reduce((s:any,w:any)=>s+w.elapsedSeconds,0);report.cpuSeconds=report.windows.reduce((s:any,w:any)=>s+w.cpuSeconds,0);report.cpuMean=report.cpuSeconds/report.elapsedSeconds*100;
  if(report.errors.length)throw new Error(report.errors.join('\n'));
 }finally{await browser.close();await instance.close();result.variants.push(report);writeFileSync(join(out,sceneName+'-'+variant+'.json'),JSON.stringify(report,null,2)+'\n');}
 console.log('VARIANT',sceneName,variant,report.cpuMean);
}
}
result.costs=Object.keys(scenes).map(scene=>{const fog=result.variants.find((v:any)=>v.scene===scene&&v.variant==='fog'),faces=result.variants.find((v:any)=>v.scene===scene&&v.variant==='faces');return{scene,gestureSeconds:scenes[scene].end-scenes[scene].start,netCPUSecondsPerGesture:(faces.cpuSeconds-fog.cpuSeconds/fog.elapsedSeconds*faces.elapsedSeconds)/faces.windows.length,netCPUPercentageDuringGesture:(faces.cpuSeconds-fog.cpuSeconds/fog.elapsedSeconds*faces.elapsedSeconds)/faces.windows.length/(scenes[scene].end-scenes[scene].start)*100};});console.log('COSTS',JSON.stringify(result.costs));
}finally{server.close();writeFileSync(join(out,'resumo.json'),JSON.stringify(result,null,2)+'\n');}
