// T3720: actual WebKit frames, normalized only to the 1024px logical stage.
// kiwi lock bench first. KIWI_IMAGE_PYTHON=... bun docs/brand/intro/comparar.ts [out]
import { mkdirSync } from "node:fs";
import path from "node:path";
const here=import.meta.dirname;
const out=path.resolve(process.argv[2] ?? "/tmp/T3720-comparacao");
mkdirSync(out,{recursive:true});
const {webkit}=await import(path.join(here,"../../../app/node_modules/playwright-core/index.mjs"));
const browser=await webkit.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1024,height:1024},deviceScaleFactor:1,reducedMotion:"no-preference"});
  await page.route(/^https?:/, r=>r.abort());
  for (const frame of [0,48,112,126,150,176,190,220,268,336,390,480]) {
    await page.goto(`file://${path.join(here,"intro.html")}?t=${3.7+frame/60}`);
    await page.evaluate(async()=>{
      await Promise.all([...document.images].map(img=>img.decode()));
      document.getElementById("fit")!.style.transform="none";
    });
    await page.screenshot({path:path.join(out,`f${frame}.png`)});
    console.log(`WebKit f${frame}`);
  }
} finally {await browser.close();}
const result=Bun.spawnSync([process.env.KIWI_IMAGE_PYTHON ?? "python3",path.join(here,"comparar.py"),out],{stdout:"inherit",stderr:"inherit"});
if(result.exitCode)process.exit(result.exitCode);
