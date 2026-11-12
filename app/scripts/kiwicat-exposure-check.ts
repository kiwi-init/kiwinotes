import { webkit } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { serveFogDemo } from "./kiwicat-demo";
const out = resolve(process.argv[2] ?? "/tmp/kiwi-T8487-exposure");
mkdirSync(out, { recursive: true });
const server = await serveFogDemo("exposure-demo.ts");
const browser = await webkit.launch({ headless: true }).catch((e) => {
  server.close();
  throw e;
});
const errors: string[] = [];
try {
  const page = await browser.newPage({
    viewport: { width: 640, height: 800 },
    deviceScaleFactor: 1,
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(server.url);
  await page.waitForFunction(() => (window as any).kiwiFogReady);
  for (let i = 0; i <= 90; i++) {
    const exposure = 0.5 + i * 0.01;
    await page.evaluate((e) => (window as any).sweep(e), exposure);
    await page.screenshot({
      path: join(out, `exposure-${exposure.toFixed(2)}.png`),
    });
  }
} finally {
  await browser.close();
  server.close();
  writeFileSync(
    join(out, "report.json"),
    JSON.stringify({ range: [0.5, 1.4], step: 0.01, errors }, null, 2) + "\n",
  );
}
if (errors.length) process.exitCode = 1;
