// Compare the scalar noise target at fixed seed/time; never an app window.
import { webkit } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { serveFogDemo } from "./kiwicat-demo";
const out = resolve(process.argv[2] ?? "/tmp/kiwi-T8487-scales");
mkdirSync(out, { recursive: true });
const server = await serveFogDemo();
const browser = await webkit.launch({ headless: true }).catch((error) => {
  server.close();
  throw error;
});
const report: any[] = [];
try {
  for (const scale of [1, 0.5, 0.25]) {
    const context = await browser.newContext({
      viewport: { width: 640, height: 800 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(
      `${server.url}/?mode=capture&densityScale=${scale}&seed=17&variant=${process.env.KIWI_FOG_VARIANT ?? "B2"}`,
    );
    await page.waitForFunction(() => (window as any).kiwiFogReady);
    let start = 0;
    for (const state of ["repouso", "ouvindo", "thinking"]) {
      await page.evaluate(
        (s) =>
          (window as any).kiwiFog.update({
            estado: s,
            voz: s === "ouvindo" ? 0.7 : null,
          }),
        state,
      );
      for (let i = 0; i <= 180; i++)
        await page.evaluate(
          (t) => (window as any).kiwiFog.capture(t),
          start + i / 30,
        );
      start += 6;
      await page.screenshot({ path: join(out, `${state}-${scale}.png`) });
    }
    report.push({
      scale,
      errors,
      stats: await page.evaluate(() => (window as any).kiwiFog.stats),
    });
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
if (report.some((r) => r.errors.length || r.stats.backend !== "webgpu"))
  process.exitCode = 1;
