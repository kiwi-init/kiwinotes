// T10437: state-local cutout FPS, no recorder or CPU probe can overrun Pronto.
import { webkit } from "playwright-core";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { serveFogDemo } from "./kiwicat-demo";

const variant = process.argv[3] ?? "symbols";
if (!["symbols", "baseline"].includes(variant)) throw new Error("expected baseline|symbols");
const out = resolve(process.argv[2] ?? "../docs/brand/kiwi-cat/caretas/desempenho");
mkdirSync(out, { recursive: true });
const baseline = process.argv.includes("--baseline");
const baselineRoot = process.env.KIWI_CAT_BASELINE ?? "/tmp/kiwi-T10437-baseline";
const serve = baseline ? (await import(`${baselineRoot}/app/scripts/kiwicat-demo.ts`)).serveFogDemo : serveFogDemo;
const server = await serve("cat-demo.ts");
const browser = await webkit.launch({ headless: true });
const report: any = {
  task: "T10437", variant, baseline, failures: [] as string[], scope: "state-local Playwright WebKit FPS, not CPU",
  measuredCommit: new TextDecoder().decode(Bun.spawnSync(["git", "rev-parse", "HEAD"]).stdout).trim(),
  source_sha256: Object.fromEntries(["index.ts", "shader.ts", "state.ts", "cat-demo.ts", "cat.ts", "gestures.ts", "vectors.ts", "assets/reference-no-eyes.webp", "assets/source.json", ...(baseline ? [] : ["symbols.ts", "assets/cutout-mask.webp", "assets/cutout-source.json"])].map(file => [file, new Bun.CryptoHasher("sha256").update(readFileSync(baseline ? resolve(baselineRoot, "app/ui/kiwicat", file) : resolve(import.meta.dir, "../ui/kiwicat", file))).digest("hex")])),
  browser: browser.version(), noRecorder: true, size: [640, 800], states: [], errors: [],
};
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 800 }, deviceScaleFactor: 1 });
  await page.route("**/*", route => new URL(route.request().url()).origin === server.url ? route.continue() : route.abort());
  page.on("pageerror", error => report.errors.push(String(error)));
  await page.goto(server.url + `/?mode=measure&cutout=1&outline=1&edgeBand=.08&backing=.5`);
  await page.waitForFunction(() => (window as any).kiwiCatReady);
  await page.waitForTimeout(2000);
  for (const state of ["acordou", "ouvindo", "thinking", "agindo", "pronto", "erro"]) {
    const result = await page.evaluate(async state => {
      const api = (window as any).kiwiCat;
      const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
      const fps = (intervals: number[]) => intervals.length / intervals.reduce((a, b) => a + b, 0);
      api.update({ estado: state, voz: state === "ouvindo" ? .7 : null });
      const entered = performance.now();
      await wait(state === "pronto" ? 100 : 1000);
      const stateAtStart = api.visualState;
      const start = performance.now(), fogStart = api.fogStats.intervals.length, vectorStart = api.stats.activeIntervals.length;
      await wait(state === "pronto" ? 700 : 3000);
      const end = performance.now(), stateAtEnd = api.visualState;
      const fogIntervals = api.fogStats.intervals.slice(fogStart);
      const vectorIntervals = api.stats.activeIntervals.slice(vectorStart);
      return { state, stateAtStart, stateAtEnd, startAfterEntryMs: start - entered,
        endAfterEntryMs: end - entered, windowMs: end - start,
        fogFrames: fogIntervals.length, fogFPS: fps(fogIntervals),
        vectorFrames: vectorIntervals.length, vectorFPS: fps(vectorIntervals.map((v: any) => v.seconds)),
        vectorStates: [...new Set(vectorIntervals.map((v: any) => v.state))], slow: api.fogStats.slow };
    }, state);
    report.states.push(result);
    console.log(JSON.stringify(result));
    if (result.stateAtStart !== state || result.stateAtEnd !== state || result.slow ||
      result.fogFrames < 1 || result.vectorFrames < 1 || result.fogFPS < 55 || result.vectorFPS < 55)
      report.failures.push(state);
  }
  if (report.failures.length) throw new Error("State FPS windows failed: " + report.failures.join(","));
  if (report.errors.length) throw new Error(report.errors.join("\n"));
} finally {
  await browser.close(); server.close();
  writeFileSync(join(out, "fps-por-estado.json"), JSON.stringify(report, null, 2) + "\n");
}
