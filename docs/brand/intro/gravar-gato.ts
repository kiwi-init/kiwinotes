// WebKit headless only. Record the actual f0–f480 animations at normal speed.
// kiwi lock bench first; bun docs/brand/intro/gravar-gato.ts [out]
import {accessSync, constants, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync} from "node:fs";
import {homedir, tmpdir} from "node:os";
import {inflateSync} from "node:zlib";
import path from "node:path";
const here=import.meta.dirname;
const out=path.resolve(process.argv[2] ?? "/tmp/T3720-video");
mkdirSync(out,{recursive:true});
const record=!process.argv.includes("--sem-video");
// The ffmpeg Playwright downloads is enough to crop and re-encode, and it is
// there even when the Mac has no system ffmpeg (the one Homebrew installs).
// It only decodes webm/mjpeg and only encodes png/VP9, and it takes the input
// as `-i file:<path>`: `-` and `pipe:` do not work.
function ffmpegDoPlaywright():string|null {
  const raiz=path.join(homedir(),"Library/Caches/ms-playwright");
  let nomes:string[];
  try {nomes=readdirSync(raiz);} catch {return null;}
  const versoes=nomes.flatMap(n=>{const m=/^ffmpeg-(\d+)$/.exec(n);return m?[Number(m[1])]:[];}).sort((a,b)=>b-a);
  for(const v of versoes){
    const bin=path.join(raiz,`ffmpeg-${v}`,`ffmpeg-${process.platform==="win32"?"win64":"mac"}`);
    try {accessSync(bin,constants.X_OK);return bin;} catch {}
  }
  return null;
}
// First pixel of a grayscale PNG: on the first row the left and upper
// neighbours are 0, so every PNG filter leaves that byte untouched. A 2×2 crop
// is enough to tell the white lead-in from the first real frame.
function cinza(arquivo:string):number {
  const png=readFileSync(arquivo);
  let pos=8,idat:Buffer[]=[];
  while(pos+8<=png.length){
    const tamanho=png.readUInt32BE(pos),tipo=png.toString("latin1",pos+4,pos+8);
    if(tipo==="IDAT")idat.push(png.subarray(pos+8,pos+8+tamanho));
    else if(tipo==="IEND")break;
    pos+=12+tamanho;
  }
  return inflateSync(Buffer.concat(idat))[1];
}
// Playwright starts recording before navigation; discard its blank white lead-in.
const sistema=record?Bun.which("ffmpeg"):null;
const ffmpeg=record?(sistema ?? ffmpegDoPlaywright()):null;
if(record&&!ffmpeg)throw new Error("sem ffmpeg: nem no PATH, nem em ~/Library/Caches/ms-playwright/ffmpeg-*/ffmpeg-mac");
// The Playwright one writes `gato.webm` already cropped, so its raw take needs
// another name; with the system ffmpeg the mp4 goes beside the raw take.
const bruto=path.join(out,sistema?"gato.webm":"gato-bruto.webm");
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
  if(video)await video.saveAs(bruto);
  await Bun.write(path.join(out,"medida.json"),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify(report));
}finally{await browser.close();}
if(!record)process.exit(0);
if(sistema){
  const probe=Bun.spawnSync(["ffmpeg","-v","error","-i",bruto,"-vf","crop=2:2:0:0","-f","rawvideo","-pix_fmt","rgb24","-"],{stdout:"pipe",stderr:"pipe"});
  if(probe.exitCode)throw new Error(probe.stderr.toString());
  let first=0;
  for(let i=0;i<probe.stdout.length/12;i++)if(probe.stdout[i*12]<24){first=i;break;}
  const result=Bun.spawnSync(["ffmpeg","-y","-ss",String(first/25),"-i",bruto,"-c:v","libx264","-pix_fmt","yuv420p","-crf","18","-movflags","+faststart",path.join(out,"gato.mp4")],{stdout:"ignore",stderr:"pipe"});
  if(result.exitCode)throw new Error(result.stderr.toString());
  console.log(path.join(out,"gato.mp4"));
}else{
  const bin=ffmpeg!;
  const temp=mkdtempSync(path.join(tmpdir(),"kiwi-gato-"));
  try {
    const px=path.join(temp,"px");
    mkdirSync(px);
    const cortes=Bun.spawnSync([bin,"-v","error","-y","-i",`file:${bruto}`,"-vf","crop=2:2:0:0","-pix_fmt","gray",path.join(px,"%04d.png")],{stdout:"pipe",stderr:"pipe"});
    if(cortes.exitCode)throw new Error(cortes.stderr.toString());
    const quadros=readdirSync(px).sort();
    let first=0;
    for(const [i,nome] of quadros.entries())if(cinza(path.join(px,nome))<24){first=i;break;}
    const saida=path.join(out,"gato.webm");
    const resultado=Bun.spawnSync([bin,"-y","-v","error","-ss",String(first/25),"-i",`file:${bruto}`,"-c:v","libvpx-vp9","-pix_fmt","yuv420p","-crf","18","-b:v","0",saida],{stdout:"ignore",stderr:"pipe"});
    if(resultado.exitCode)throw new Error(resultado.stderr.toString());
    rmSync(bruto);
    console.log(saida);
  }finally{rmSync(temp,{recursive:true,force:true});}
}
