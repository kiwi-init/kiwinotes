// T9708 taste proofs, not final videos or performance measurements.
import { webkit } from "playwright-core";
import { mkdirSync } from "node:fs";
import { serveFogDemo } from "./kiwicat-demo";
const out = process.argv[2] ?? "/tmp/kiwi-T9708-variants"; mkdirSync(out, { recursive: true });
const server = await serveFogDemo("cat-demo.ts"), browser = await webkit.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 800, height: 960 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  for (const [variant, edgeBand, backing] of [["8-leve", .08, .5], ["8-forte", .08, .35], ["12-leve", .12, .5], ["12-forte", .12, .35]] as const) {
    for (const state of ["repouso", "agindo"]) {
      for (const background of ["000000", "ffffff", "367a8e"]) {
        await page.goto(server.url + `/?state=${state}&parado=1&cutout=1&backing=${backing}&outline=1&edgeBand=${edgeBand}&background=%23${background}`);
        await page.evaluate(() => { document.getElementById("fog")!.style.margin = "80px"; });
        await page.waitForFunction(() => (window as any).kiwiCatReady);
        await page.screenshot({ path: `${out}/${variant}-${state}-${background}.png` });
      }
    }
    console.log(variant);
  }
} finally { await browser.close(); server.close(); }
