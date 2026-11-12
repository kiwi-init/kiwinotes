// GPU integration evidence only, never a real app window.
import { webkit } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { serveFogDemo } from "./kiwicat-demo";
const out = resolve(process.argv[2] ?? "/tmp/kiwi-T8487-demo-check");
mkdirSync(out, { recursive: true });
const server = await serveFogDemo(),
  browser = await webkit.launch({ headless: true }).catch((error) => {
    server.close();
    throw error;
  });
const report: Record<string, any> = {
  browser: browser.version(),
  viewport: [640, 800],
  cases: [],
};
try {
  for (const backend of ["auto", "webgl2", "none", "unavailable"]) {
    const context = await browser.newContext({
      viewport: { width: 640, height: 800 },
      deviceScaleFactor: 1,
      reducedMotion: "no-preference",
    });
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === server.url
        ? route.continue()
        : route.abort(),
    );
    if (backend === "unavailable")
      await context.addInitScript(() => {
        Object.defineProperty(navigator, "gpu", { value: undefined });
        const original = HTMLCanvasElement.prototype.getContext;
        (HTMLCanvasElement.prototype as any).getContext = function (
          type: string,
          ...args: any[]
        ) {
          return type === "webgpu" || type === "webgl2"
            ? null
            : (original as any).call(this, type, ...args);
        };
      });
    await context.addInitScript(() => {
      const request = window.requestAnimationFrame.bind(window);
      (window as any).rafCallbacks = 0;
      window.requestAnimationFrame = (callback) =>
        request((t) => {
          (window as any).rafCallbacks++;
          callback(t);
        });
    });
    const page = await context.newPage(),
      errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.goto(
      server.url +
        "/?mode=capture&backend=" +
        (backend === "unavailable" ? "auto" : backend) +
        "&variant=" +
        "B1",
    );
    await page.waitForFunction(() => (window as any).kiwiFogReady, null, {
      timeout: 30000,
    });
    await page.waitForFunction(() => {
      const image = document.querySelector("img");
      return !image || (image.complete && image.naturalWidth > 0);
    });
    const first = await page.evaluate(() => (window as any).kiwiFog.stats);
    await page.screenshot({ path: join(out, backend + "-reference.png") });
    await page.evaluate(() => (window as any).kiwiFog.capture(12));
    await page.screenshot({ path: join(out, backend + "-12s.png") });
    const entry: Record<string, any> = { requested: backend, first, errors };
    if (backend === "auto" && first.backend !== "static") {
      const count = () =>
        page.evaluate(() => (window as any).kiwiFog.stats.draws);
      await page.evaluate(() => (window as any).kiwiFog.visibility(true));
      const hidden = await count();
      await page.evaluate(() => (window as any).kiwiFog.capture(13));
      await page.waitForTimeout(100);
      entry.hiddenNoDraw = hidden === (await count());
      const callbacks = await page.evaluate(() => (window as any).rafCallbacks);
      await page.waitForTimeout(100);
      entry.hiddenNoCallbacks =
        callbacks === (await page.evaluate(() => (window as any).rafCallbacks));
      await page.evaluate(() => (window as any).kiwiFog.visibility(false));
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.waitForTimeout(50);
      const reduced = await count();
      await page.evaluate(() => (window as any).kiwiFog.capture(14));
      await page.waitForTimeout(100);
      entry.reducedNoDraw = reduced === (await count());
      await page.evaluate(() => (window as any).kiwiFog.update({ voz: 0.8 }));
      const silent = await count();
      await page.evaluate(() => (window as any).kiwiFog.update({ voz: 0.9 }));
      entry.numericVoiceNoDraw = silent === (await count());
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.waitForTimeout(30);
      const beforeResume = await count();
      await page.evaluate(() => (window as any).kiwiFog.capture(16));
      entry.reducedResume = (await count()) > beforeResume;
      await page.evaluate(() => {
        for (let i = 0; i < 61; i++)
          (window as any).kiwiFog.observeCadence(i * 0.05);
      });
      const slow = await count();
      await page.evaluate(() => (window as any).kiwiFog.capture(17));
      entry.slowNoDraw = slow === (await count());
      entry.final = await page.evaluate(() => (window as any).kiwiFog.stats);
    }
    await page.evaluate(() => (window as any).kiwiFog.dispose());
    entry.disposed = (await page.locator("#fog > *").count()) === 0;
    report.cases.push(entry);
    console.log(JSON.stringify(entry));
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
  writeFileSync(
    join(out, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
}
const main = report.cases[0];
if (
  main.first.backend !== "webgpu" ||
  main.errors.length ||
  !main.hiddenNoDraw ||
  !main.hiddenNoCallbacks ||
  !main.reducedNoDraw ||
  !main.numericVoiceNoDraw ||
  !main.reducedResume ||
  !main.slowNoDraw ||
  report.cases[1].first.backend !== "webgl2" ||
  report.cases
    .slice(2)
    .some(
      (c: any) =>
        c.first.backend !== "static" || c.errors.length || !c.disposed,
    )
)
  process.exitCode = 1;
