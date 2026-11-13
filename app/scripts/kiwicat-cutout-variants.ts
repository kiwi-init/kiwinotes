// T9708 taste proofs, not final videos or performance measurements.
import { webkit } from "playwright-core";
import { mkdirSync } from "node:fs";
import { serveFogDemo } from "./kiwicat-demo";
const out = process.argv[2] ?? "/tmp/kiwi-T9708-variants"; mkdirSync(out, { recursive: true });
const server = await serveFogDemo("cat-demo.ts"), browser = await webkit.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 800, height: 960 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  for (const [variant, backing, outline] of [["leve", .5, 1], ["forte", .35, 1], ["sem-apoio", .5, 0]] as const) {
    for (const state of (variant === "sem-apoio" ? ["thinking"] : ["repouso", "dormindo", "acordou", "ouvindo", "thinking", "agindo", "pronto", "erro"])) {
      for (const background of ["000000", "ffffff", "367a8e"]) {
        await page.goto(server.url + `/?state=${state}&parado=1&cutout=1&backing=${backing}&outline=${outline}&edgeBand=.08&background=%23${background}`);
        await page.evaluate(() => { document.getElementById("fog")!.style.margin = "80px"; });
        await page.waitForFunction(() => (window as any).kiwiCatReady);
        await page.screenshot({ path: `${out}/${variant}-${state}-${background}.png` });
      }
    }
    console.log(variant);
  }
} finally { await browser.close(); server.close(); }
