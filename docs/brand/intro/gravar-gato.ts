// WebKit headless only. Record the actual f0–f480 animations at normal speed.
// kiwi lock bench first; bun docs/brand/intro/gravar-gato.ts [out]
import {mkdirSync} from "node:fs";
import path from "node:path";
const here=import.meta.dirname;
const out=path.resolve(process.argv[2] ?? "/tmp/T3720-video");
mkdirSync(out,{recursive:true});
const record=!process.argv.includes("--sem-video");
const {webkit}=await import(path.join(here,"../../../app/node_modules/playwright-core/index.mjs"));
const browser=await webkit.launch({headless:true});
try {
  const context=await browser.newContext({viewport:{width:600,height:600},deviceScaleFactor:2,
    reducedMotion:"no-preference",...(record ? {recordVideo:{dir:out,size:{width:600,height:600}}} : {})});
  const page=await context.newPage();
  await page.route(/^https?:/,r=>r.abort());
  await page.goto(`file://${path.join(here,"intro.html")}?t=3.7`);
  await page.evaluate(async()=>{await Promise.all([...document.images].map(img=>img.decode()));});
  const report=await page.evaluate(()=>new Promise(resolve=>{
    const times:number[]=[];
    const cat=document.getElementById("cat-layer")!;
    const animations=cat.getAnimations({subtree:true});
    for(const a of animations){a.currentTime=0;a.play();}
    const started=performance.now();
    const tick=(t:number)=>{
      times.push(t);
      if(t-started<8100)requestAnimationFrame(tick);
      else {
        const intervals=times.slice(1).map((t,i)=>t-times[i]).sort((a,b)=>a-b);
        resolve({milliseconds:t-started,frames:times.length,
          median:intervals[Math.floor(intervals.length*.5)],p95:intervals[Math.floor(intervals.length*.95)],
          worst:Math.max(...intervals),animationTimes:animations.map(a=>a.currentTime)});
      }
    };
    requestAnimationFrame(tick);
  }));
  await page.screenshot({path:path.join(out,"final.png")});
  const video=page.video();
  await context.close();
  if(video)await video.saveAs(path.join(out,"gato.webm"));
  await Bun.write(path.join(out,"medida.json"),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify(report));
}finally{await browser.close();}
if(!record)process.exit(0);
// Playwright starts recording before navigation; discard its blank white lead-in.
const probe=Bun.spawnSync(["ffmpeg","-v","error","-i",path.join(out,"gato.webm"),"-vf","crop=2:2:0:0","-f","rawvideo","-pix_fmt","rgb24","-"],{stdout:"pipe",stderr:"pipe"});
if(probe.exitCode)throw new Error(probe.stderr.toString());
let first=0;
for(let i=0;i<probe.stdout.length/12;i++)if(probe.stdout[i*12]<24){first=i;break;}
const result=Bun.spawnSync(["ffmpeg","-y","-ss",String(first/25),"-i",path.join(out,"gato.webm"),"-c:v","libx264","-pix_fmt","yuv420p","-crf","18","-movflags","+faststart",path.join(out,"gato.mp4")],{stdout:"ignore",stderr:"pipe"});
if(result.exitCode)throw new Error(result.stderr.toString());
console.log(path.join(out,"gato.mp4"));
