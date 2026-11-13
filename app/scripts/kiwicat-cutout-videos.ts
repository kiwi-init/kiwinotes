// T9708: one RGBA renderer sample per instant; backgrounds use that exact frame.
// Run under the bench lease. This is controlled-frame export, not a FPS benchmark.
import assert from "node:assert/strict";
import { webkit } from "playwright-core";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { serveFogDemo } from "./kiwicat-demo";
const out = resolve(process.argv[2] ?? "../docs/brand/kiwi-cat/recorte/videos"); mkdirSync(out, { recursive: true });
const raw = mkdtempSync(join(tmpdir(), "kiwi-T9708-rgba-"));
const hub = resolve(process.argv[3] ?? "/tmp/kiwi-T9708-hub-composed");
const fps = 30;
const server = await serveFogDemo("cat-demo.ts"), browser = await webkit.launch({ headless: true });
const manifest: any = { task: "T9708", scope: "controlled RGBA frames from one WebKit renderer, composed on synchronized backgrounds; not performance", fps, seed: 17, backing: "leve", edgeBand: .08, weakCurve: [16,32], voice: "synthetic numeric only; no microphone", raw, scenes: [] };
try {
  for (const state of ["repouso", "dormindo", "acordou", "ouvindo", "thinking", "agindo", "pronto", "erro", "hub"]) {
    const hubScene = state === "hub", width = hubScene ? 96 : 640, height = hubScene ? 120 : 800;
    const seconds = hubScene ? 16 : state === "repouso" ? 60 : state === "pronto" ? 2 : state === "acordou" ? 3 : 6;
    const dir = join(raw, state); mkdirSync(dir, { recursive: true });
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    await context.route("**/*", r => new URL(r.request().url()).origin === server.url ? r.continue() : r.abort());
    const page = await context.newPage(), errors: string[] = []; page.on("pageerror", e => errors.push(String(e)));
    await page.goto(server.url + `/?state=repouso&cutout=1&outline=1&backing=.5&edgeBand=.08&width=${width}&height=${height}`);
    await page.waitForFunction(() => (window as any).kiwiCatReady);
    await page.evaluate(state => {
      document.documentElement.style.background = "transparent"; document.body.style.background = "transparent";
      (window as any).kiwiCat.update({ estado: state, voz: state === "ouvindo" ? .8 : null });
    }, hubScene ? "repouso" : state);
    if (state === "repouso") {
      await page.evaluate(() => (window as any).kiwiCat.capture(0));
      for (const [name, color] of [["branco", "#fff"], ["preto", "#000"], ["cor", "#367a8e"]]) {
        await page.evaluate(color => { document.documentElement.style.background = color!; document.body.style.background = color!; }, color);
        await page.screenshot({ path: join(dir, `webkit-${name}.png`) });
      }
      await page.evaluate(() => { document.documentElement.style.background = "transparent"; document.body.style.background = "transparent"; });
    }
    const frames: string[] = []; let signature = "", previous = "";
    for (let i = 0; i < seconds * fps; i++) {
      const data = await page.evaluate(({t, voice}) => {
        const a = (window as any).kiwiCat;
        if (voice) a.update({ voz: .1 + .8 * Math.max(0, Math.sin(t * 2)) });
        a.capture(t);
        return { signature: `${a.fogStats.draws}/${a.stats.faceUpdates}/${a.visualState}`, backend: a.fogStats.backend };
      }, { t: i/fps, voice: state === "ouvindo" });
      assert.equal(data.backend, "webgpu");
      if (data.signature !== signature || !previous) {
        previous = `${i.toString().padStart(6, "0")}.png`; signature = data.signature;
        await page.screenshot({ path: join(dir, previous), omitBackground: true });
      }
      frames.push(previous);
    }
    await context.close(); assert.deepEqual(errors, []);
    const scene = { state, seconds, fps, width, height, frames, errors };
    writeFileSync(join(dir, "frames.json"), JSON.stringify(scene)+"\n"); manifest.scenes.push({ ...scene, uniqueFrames: new Set(frames).size, directory: dir });
    console.log(state, "RGBA captured", new Set(frames).size, "/", frames.length);
  }
} finally { await browser.close(); server.close(); writeFileSync(join(out, "capture.json"), JSON.stringify(manifest, null, 2)+"\n"); }
// Pillow source-over creates each unique background frame once; hardlinks preserve
// the actual repetitions. ffmpeg reads a 30fps PNG sequence, with no interpolation.
const python = process.env.KIWI_CUTOUT_PYTHON ?? "python3";
const compose = Bun.spawn([python, resolve(import.meta.dir, "kiwicat-cutout-video-compose.py"), join(out, "capture.json"), out, hub], { stdout: "inherit", stderr: "inherit" });
assert.equal(await compose.exited, 0, "video composition/validation failed");
