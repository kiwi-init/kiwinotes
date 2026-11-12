// Controlled real-renderer pixels plus native video of a reduced-motion update.
// This is functional evidence, never a performance run.
import { webkit } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { serveFogDemo } from "./kiwicat-demo";
const out = resolve(process.argv[2] ?? "/tmp/kiwi-T8487-renderer-check");
mkdirSync(out, { recursive: true });
const server = await serveFogDemo(),
  browser = await webkit.launch({ headless: true }).catch((e) => {
    server.close();
    throw e;
  });
const report: any = {
  scope: "functional controlled pixels + native video, not performance",
  cases: [],
};
try {
  for (const state of ["repouso", "ouvindo", "thinking"]) {
    const context = await browser.newContext({
      viewport: { width: 640, height: 800 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage(),
      errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(
      `${server.url}/?mode=capture&state=${state}&densityScale=1&seed=17`,
    );
    await page.waitForFunction(() => (window as any).kiwiFogReady);
    for (let i = 0; i <= 480; i++) {
      await page.evaluate(
        ({ t, state }) => {
          const api = (window as any).kiwiFog;
          if (state === "ouvindo")
            api.update({
              voz: 0.9 * Math.pow(Math.max(0, Math.sin(t * 2.4)), 1.8),
            });
          api.capture(t);
        },
        { t: i / 60, state },
      );
      if ([120, 240, 360, 450, 480].includes(i))
        await page.screenshot({ path: join(out, `${state}-${i}.png`) });
    }
    report.cases.push({
      state,
      errors,
      stats: await page.evaluate(() => (window as any).kiwiFog.stats),
    });
    await context.close();
  }
  const context = await browser.newContext({
    viewport: { width: 640, height: 800 },
    deviceScaleFactor: 1,
    recordVideo: {
      dir: join(out, "native"),
      size: { width: 640, height: 800 },
    },
  });
  const page = await context.newPage(),
    start = performance.now();
  await page.goto(server.url + "/?mode=measure&parado=1");
  await page.waitForFunction(() => (window as any).kiwiFogReady);
  const ready = (performance.now() - start) / 1000;
  await page.waitForTimeout(1500);
  await page.evaluate(() => (window as any).kiwiFog.update({ cor: "claude" }));
  const changed = (performance.now() - start) / 1000;
  await page.waitForTimeout(1500);
  report.fixed = {
    ready,
    changed,
    sampleBefore: ready + 0.7,
    sampleAfter: changed + 0.7,
    stats: await page.evaluate(() => (window as any).kiwiFog.stats),
  };
  const video = page.video()!;
  await context.close();
  await video.saveAs(join(out, "reduced-colour.webm"));
  // Native presentation, without screenshots or explicit capture()/render().
  // A timer-driven quiet state must actually present changing frames.
  const live = await browser.newContext({
    viewport: { width: 640, height: 800 },
    deviceScaleFactor: 1,
    recordVideo: { dir: join(out, "native"), size: { width: 640, height: 800 } },
  });
  const livePage = await live.newPage();
  await livePage.goto(server.url + "/?mode=measure&state=repouso&seed=17");
  await livePage.waitForFunction(() => (window as any).kiwiFogReady);
  await livePage.waitForTimeout(6000);
  report.live = await livePage.evaluate(() => (window as any).kiwiFog.stats);
  const liveVideo = livePage.video()!;
  await livePage.evaluate(() => (window as any).kiwiFog.visibility(true));
  const hiddenDraws = report.live.draws;
  await livePage.waitForTimeout(500);
  report.liveHiddenNoDraw = await livePage.evaluate(
    (n) => (window as any).kiwiFog.stats.draws === n,
    hiddenDraws,
  );
  await livePage.evaluate(() => (window as any).kiwiFog.dispose());
  await live.close();
  await liveVideo.saveAs(join(out, "native-idle.webm"));
} finally {
  await browser.close();
  server.close();
  writeFileSync(
    join(out, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
}
if (
  report.cases.some(
    (c: any) => c.errors.length || c.stats.backend !== "webgpu",
  ) ||
  report.fixed.stats.draws !== 2 ||
  report.live.draws < 17 ||
  report.live.draws > 21 ||
  !report.liveHiddenNoDraw
)
  process.exitCode = 1;
