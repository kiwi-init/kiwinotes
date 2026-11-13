// T8959 functional WebKit checks and controlled poses, never a CPU benchmark.
import { webkit } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { serveFogDemo } from "./kiwicat-demo";
const out = resolve(process.argv[2] ?? "/tmp/kiwi-T8959-faces"); mkdirSync(out, { recursive: true });
const server = await serveFogDemo("cat-demo.ts"), browser = await webkit.launch({ headless: true });
const report: any = { scope: "functional real WebKit renderer, not performance", cases: [] };
try {
  for (const state of ["repouso", "dormindo", "acordou", "ouvindo", "thinking", "agindo", "pronto", "erro"]) {
    const context = await browser.newContext({ viewport: { width: 640, height: 800 }, deviceScaleFactor: 1 });
    const page = await context.newPage(), errors: string[] = [];
    page.on("pageerror", e => errors.push(String(e)));
    await page.goto(`${server.url}/?state=${state}&parado=1${state === "ouvindo" ? "&voice=.8" : ""}`);
    await page.waitForFunction(() => (window as any).kiwiCatReady);
    await page.screenshot({ path: join(out, state + ".png") });
    const data = await page.evaluate(() => { const api = (window as any).kiwiCat; return { state: api.visualState, frame: api.frame, fog: api.fogStats, stats: api.stats }; });
    report.cases.push({ errors, ...data });
    if (errors.length || data.fog.backend !== "webgpu") throw new Error(JSON.stringify(report.cases.at(-1)));
    await page.evaluate(() => (window as any).kiwiCat.dispose()); await context.close();
  }
  for (const backend of ["auto", "webgl2", "none"]) {
    const context = await browser.newContext({ viewport: { width: 640, height: 800 }, deviceScaleFactor: 1 });
    const page = await context.newPage(), errors: string[] = [];
    page.on("pageerror", e => errors.push(String(e)));
    await page.goto(`${server.url}/?backend=${backend}&state=ouvindo&parado=1&voice=0`);
    await page.waitForFunction(() => (window as any).kiwiCatReady);
    const counts = () => page.evaluate(() => { const a = (window as any).kiwiCat; return [a.stats.faceUpdates, a.fogStats.draws]; });
    const before = await counts();
    await page.evaluate(() => { const a = (window as any).kiwiCat; a.update({ voz: 1 }); a.capture(100); });
    const fixedVoiceNoDraw = JSON.stringify(before) === JSON.stringify(await counts());
    await page.evaluate(() => (window as any).kiwiCat.update({ voz: null }));
    const noWaves = await page.locator('[data-symbol="ouvindo"]').evaluateAll(nodes => nodes.every(n => getComputedStyle(n).opacity === "0"));
    await page.evaluate(() => { const a = (window as any).kiwiCat; a.visibility(true); });
    const hidden = await counts();
    await page.evaluate(() => { const a = (window as any).kiwiCat; a.update({ estado: "erro" }); a.capture(200); });
    await page.waitForTimeout(80);
    const hiddenNoDraw = JSON.stringify(hidden) === JSON.stringify(await counts());
    await page.evaluate(() => (window as any).kiwiCat.visibility(false));
    const currentStateOnResume = await page.evaluate(() => (window as any).kiwiCat.visualState === "erro");
    const actualBackend = await page.evaluate(() => (window as any).kiwiCat.fogStats.backend);
    await page.evaluate(() => (window as any).kiwiCat.dispose());
    const disposed = await page.locator("#fog > *").count() === 0;
    report.cases.push({ backend, actualBackend, errors, fixedVoiceNoDraw, noWaves, hiddenNoDraw, currentStateOnResume, disposed });
    await context.close();
    if (errors.length || !fixedVoiceNoDraw || !noWaves || !hiddenNoDraw || !currentStateOnResume || !disposed) throw new Error(JSON.stringify(report.cases.at(-1)));
  }
  const live = await browser.newContext({ viewport: { width: 640, height: 800 }, deviceScaleFactor: 1,
    recordVideo: { dir: join(out, "native"), size: { width: 640, height: 800 } } });
  const page = await live.newPage(), errors: string[] = [];
  page.on("pageerror", e => errors.push(String(e)));
  await page.goto(server.url + "/?mode=measure&state=repouso");
  await page.waitForFunction(() => (window as any).kiwiCatReady);
  await page.waitForTimeout(16000);
  report.native = await page.evaluate(() => { const a = (window as any).kiwiCat; return { frame: a.frame, stats: a.stats, fog: a.fogStats }; });
  const video = page.video()!;
  const count = await page.evaluate(() => { const a = (window as any).kiwiCat; a.visibility(true); return [a.stats.faceUpdates, a.fogStats.draws]; });
  await page.waitForTimeout(300);
  report.native.hiddenNoDraw = await page.evaluate(n => { const a = (window as any).kiwiCat; return a.stats.faceUpdates === n[0] && a.fogStats.draws === n[1]; }, count);
  report.native.errors = errors;
  await page.evaluate(() => (window as any).kiwiCat.dispose());
  await live.close(); await video.saveAs(join(out, "native-idle.webm"));
  if (errors.length || !report.native.hiddenNoDraw || report.native.stats.quietPlans < 1) throw new Error(JSON.stringify(report.native));
} finally {
  await browser.close(); server.close();
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
}
