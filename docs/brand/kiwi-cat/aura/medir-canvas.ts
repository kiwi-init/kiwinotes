// The aura on a 512 canvas scaled to the 1024 stage: two poses per frame, additive (lighter), in WebKit headless 600pt@2x.
import path from "node:path";
import {readdirSync, readFileSync} from "node:fs";
const [app, dir, mode] = process.argv.slice(2) as [string, string, string];
const poses = readdirSync(dir).filter(f => /^pose-\d+\.webp$/.test(f)).sort().map(f => "data:image/webp;base64," + readFileSync(path.join(dir, f)).toString("base64"));
const {webkit} = await import(path.join(app, "node_modules/playwright-core/index.mjs"));
const b = await webkit.launch({headless: true});
try {
  const page = await (await b.newContext({viewport: {width: 600, height: 600}, deviceScaleFactor: 2})).newPage();
  await page.setContent(`<body style="margin:0;background:#000"><div id=fit style="transform:scale(${600*0.86/1024});transform-origin:0 0">
    <canvas id=c width=512 height=512 style="width:1024px;height:1024px"></canvas></div></body>`);
  const r = await page.evaluate(async ([poses, mode]: [string[], string]) => {
    const imgs = await Promise.all(poses.map(async s => { const i = new Image(); i.src = s; await i.decode(); return mode === "bitmap" ? createImageBitmap(i) : i; }));
    const g = (document.getElementById("c") as HTMLCanvasElement).getContext("2d")!;
    const n = imgs.length, times: number[] = [], work: number[] = [];
    return await new Promise(res => {
      const s = performance.now();
      const tick = (t: number) => {
        const w0 = performance.now();
        const e = Math.min(1, ((t - s) / 6000)), x = e * (n - 1), i = Math.min(n - 2, Math.floor(x)), w = x - i;
        g.globalCompositeOperation = "copy"; g.globalAlpha = 1 - w; g.drawImage(imgs[i] as any, 0, 0);
        g.globalCompositeOperation = "lighter"; g.globalAlpha = w; g.drawImage(imgs[i + 1] as any, 0, 0);
        work.push(performance.now() - w0); times.push(t);
        if (t - s < 6100) requestAnimationFrame(tick); else {
          const iv = times.slice(1).map((t, k) => t - times[k]).sort((a, b) => a - b), wk = work.sort((a, b) => a - b);
          res({frames: times.length, median: iv[iv.length >> 1], p95: iv[Math.floor(iv.length * .95)], worst: iv.at(-1), drawMedian: +wk[wk.length >> 1].toFixed(2), drawP95: +wk[Math.floor(wk.length * .95)].toFixed(2)});
        }
      };
      requestAnimationFrame(tick);
    });
  }, [poses, mode ?? "img"]);
  console.log(mode ?? "img", JSON.stringify(r));
} finally { await b.close(); }
