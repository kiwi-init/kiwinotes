// T9708 renderer parity and real alpha captures; baseline extracted at approved d2df9d3.
import { webkit } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { serveFogDemo } from "./kiwicat-demo";
const baseline = process.env.KIWI_CAT_BASELINE ?? "/tmp/kiwi-T9708-baseline";
const { serveFogDemo: serveBaseline } = await import(`${baseline}/app/scripts/kiwicat-demo.ts`);
const out = process.argv[2] ?? "/tmp/kiwi-T9708-pixels"; mkdirSync(out, { recursive: true });
const current = await serveFogDemo("cat-demo.ts"), old = await serveBaseline("cat-demo.ts"), browser = await webkit.launch({ headless: true });
const report: any = { baseline: "d2df9d3", edgeBand: .08, backing: .5, errors: [], rows: [] };
try {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage(); page.on("pageerror", e => report.errors.push(String(e)));
  for (const backend of ["auto", "webgl2", "none"]) for (const state of ["repouso", "dormindo", "acordou", "ouvindo", "thinking", "agindo", "pronto", "erro"]) {
    for (const variant of ["baseline", "opaque", "cutout"]) {
      const url = variant === "baseline" ? old.url : current.url;
      await page.goto(`${url}/?state=${state}&parado=1&backend=${backend}&cutout=${variant === "cutout" ? 1 : 0}&outline=1&background=%23000`);
      await page.waitForFunction(() => (window as any).kiwiCatReady);
      const prefix = `${out}/${backend}-${state}-${variant}`;
      await page.screenshot({ path: prefix + ".png" });
      if (variant === "cutout") {
        await page.evaluate(() => { document.body.style.background = "transparent"; document.documentElement.style.background = "transparent"; });
        await page.screenshot({ path: prefix + "-alpha.png", omitBackground: true });
      }
      report.rows.push({ backend, state, variant, actual: await page.evaluate(() => (window as any).kiwiCat.fogStats.backend) });
    }
    console.log(backend, state);
  }
} finally {
  await browser.close(); current.close(); old.close();
  writeFileSync(`${out}/renderer.json`, JSON.stringify(report, null, 2) + "\n");
}
if (report.errors.length) throw new Error(report.errors.join("\n"));
