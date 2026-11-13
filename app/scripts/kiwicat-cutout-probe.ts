import { webkit } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { serveFogDemo } from "./kiwicat-demo";
const backing = Number(process.env.KIWI_CUTOUT_BACKING ?? .5);
const outline = process.argv.includes("--outline");
const out = process.argv[2] ?? "/tmp/kiwi-T9708-probe"; mkdirSync(out, { recursive: true });
const server = await serveFogDemo("cat-demo.ts"), browser = await webkit.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 640, height: 800 }, deviceScaleFactor: 1 });
  const page = await context.newPage(); const errors: string[] = []; page.on("pageerror", e => errors.push(String(e)));
  for (const backend of ["auto", "webgl2", "none"]) {
    for (const cutout of [0, 1]) {
      for (const background of ["#000", "#fff", "#367a8e"]) {
        if (!cutout && background !== "#000") continue;
        await page.goto(server.url + `/?state=thinking&parado=1&backing=${backing}&backend=${backend}&cutout=${cutout}&outline=${outline ? 1 : 0}&background=${encodeURIComponent(background)}`);
        await page.waitForFunction(() => (window as any).kiwiCatReady);
        const name = `${backend}-${cutout}-${background.slice(1)}`;
        await page.screenshot({ path: `${out}/${name}.png` });
        await page.evaluate(() => { document.documentElement.style.background = "transparent"; document.body.style.background = "transparent"; });
        await page.screenshot({ path: `${out}/${name}-alpha.png`, omitBackground: true });
        const data = await page.evaluate(() => { const a = (window as any).kiwiCat; return { backend: a.fogStats.backend, reason: a.fogStats.fallbackReason }; });
        console.log(name, data);
      }
    }
  }
  writeFileSync(`${out}/errors.json`, JSON.stringify(errors));
  if (errors.length) throw new Error(errors.join("\n"));
} finally { await browser.close(); server.close(); }
