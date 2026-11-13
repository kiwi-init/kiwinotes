// Diagnostic only: unchanged production modules, fixed seed, pre-gesture windows.
import { webkit } from 'playwright-core';
import { mkdirSync,readFileSync,writeFileSync,existsSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { serveFogDemo } from './kiwicat-demo';
const app=resolve(import.meta.dir,'..');
const out=resolve(process.argv[2]??join(app,'../docs/brand/kiwi-cat/caretas/desempenho/sem-gestos'));
if(existsSync(join(out,'resumo.json')))throw new Error('Choose a new output directory to preserve existing evidence');
mkdirSync(out,{recursive:true});
const head=new TextDecoder().decode(Bun.spawnSync(['git','rev-parse','HEAD'],{cwd:app}).stdout).trim();
const source=Object.fromEntries(['index.ts','shader.ts','state.ts','cat-demo.ts','cat.ts','gestures.ts','vectors.ts','assets/reference-no-eyes.webp','assets/source.json'].map(file=>[file,new Bun.CryptoHasher('sha256').update(readFileSync(join(app,'ui/kiwicat',file))).digest('hex')]));
function processes(){return new TextDecoder().decode(Bun.spawnSync(['ps','-Ao','pid=,ppid=,time=,command=']).stdout).trim().split('\n').flatMap(line=>{const m=/^\s*(\d+)\s+(\d+)\s+([\d:.]+)\s+(.*)$/.exec(line);if(!m)return[];let cpu=0;for(const v of m[3]!.split(':').map(Number))cpu=cpu*60+v;return[{pid:Number(m[1]),ppid:Number(m[2]),cpu,command:m[4]!}];});}
const server=await serveFogDemo('cat-demo.ts');
const result:any={task:'T8959',measuredCommit:head,source_sha256:source,scope:'no-gesture diagnostic; 12 separate pre-gesture windows, not CPU acceptance',seed:386,expectedFirstBlinkSeconds:8.993828538805246,expectedFirstLookSeconds:11.62525993771851,nominalWindowSeconds:5,variantWarmupSeconds:10,noRecorder:true,variants:[]};
try{
for(const variant of ['fog','faces']){
 const before=new Set(processes().map(p=>p.pid));
 const instance=await webkit.launchServer({headless:true}),root=instance.process().pid!;
 const browser=await webkit.connect(instance.wsEndpoint());
 const report:any={variant,windows:[],errors:[]};
 function discover(){const all=processes(),owned=new Set<number>([root]);for(let i=0;i<10;i++)for(const p of all)if(owned.has(p.ppid))owned.add(p.pid);for(const p of all)if(!before.has(p.pid)&&p.ppid===1&&/ms-playwright\/webkit-/.test(p.command))owned.add(p.pid);const cohort=all.filter(p=>owned.has(p.pid));if(cohort.length!==5)throw new Error('Ambiguous owned browser cohort: '+cohort.length);return cohort;}
 async function open(){const context=await browser.newContext({viewport:{width:640,height:800},deviceScaleFactor:1,reducedMotion:'no-preference'});await context.route('**/*',(r:any)=>new URL(r.request().url()).origin===server.url?r.continue():r.abort());const page=await context.newPage();page.on('pageerror',(e:any)=>report.errors.push(String(e)));await page.goto(server.url+'/?mode=measure&seed=386&fogOnly='+(variant==='fog'?'1':'0'));await page.waitForFunction(()=>(window as any).kiwiCatReady);await page.waitForTimeout(150);return{context,page};}
 async function read(page:any){return page.evaluate(()=>{const a=(window as any).kiwiCat;return{state:a.visualState??'repouso',faceUpdates:a.stats.faceUpdates??null,quietPlans:a.stats.quietPlans??null,animations:document.getAnimations().length,draws:(a.fogStats??a.stats).draws,reduced:(a.fogStats??a.stats).reduced,slow:(a.fogStats??a.stats).slow};});}
 try{
  const warm=await open();await warm.page.waitForTimeout(10000);await warm.page.evaluate(()=>(window as any).kiwiCat.dispose());await warm.context.close();
  for(let index=0;index<12;index++){
   const {context,page}=await open();const initial=await read(page),first=discover(),ids=new Set(first.map(p=>p.pid)),started=performance.now();
   const pageWindow=await page.evaluate(async()=>{const start=performance.now();await new Promise(resolve=>setTimeout(resolve,5000));return{elapsedMs:performance.now()-start};});
   const last=processes().filter(p=>ids.has(p.pid)),elapsed=(performance.now()-started)/1000,final=await read(page);
   if(last.length!==5)throw new Error('Measured cohort changed');
   const cpu=last.map(p=>({...p,cpuSecondsSampled:Math.max(0,p.cpu-first.find(q=>q.pid===p.pid)!.cpu)}));
   const noGestures=variant==='fog'||initial.faceUpdates===final.faceUpdates&&initial.quietPlans===0&&final.quietPlans===0&&initial.animations===0&&final.animations===0;
   const item={index:index+1,elapsedSeconds:elapsed,pageWindow,initial,final,noGestures,cpuSeconds:cpu.reduce((s,p)=>s+p.cpuSecondsSampled,0),processes:cpu};report.windows.push(item);
   if(!noGestures||initial.state!=='repouso'||final.state!=='repouso'||initial.reduced||final.reduced||final.slow||final.draws-initial.draws<8)throw new Error('No-gesture diagnostic guard failed: '+JSON.stringify(item));
   await page.evaluate(()=>(window as any).kiwiCat.dispose());await context.close();console.log(variant,'window',index+1,item.cpuSeconds,elapsed);
  }
  report.elapsedSeconds=report.windows.reduce((s:any,w:any)=>s+w.elapsedSeconds,0);report.cpuSeconds=report.windows.reduce((s:any,w:any)=>s+w.cpuSeconds,0);report.cpuMean=report.cpuSeconds/report.elapsedSeconds*100;
  if(report.errors.length)throw new Error(report.errors.join('\n'));
 }finally{await browser.close();await instance.close();result.variants.push(report);writeFileSync(join(out,variant+'.json'),JSON.stringify(report,null,2)+'\n');}
 console.log('VARIANT',variant,report.cpuMean);
}
result.delta=result.variants[1].cpuMean-result.variants[0].cpuMean;console.log('DELTA',result.delta);
}finally{server.close();writeFileSync(join(out,'resumo.json'),JSON.stringify(result,null,2)+'\n');}
