// Functional snapshots on a controlled clock; never a CPU benchmark.
import { webkit } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { serveFogDemo } from "./kiwicat-demo";
const out = resolve(process.argv[2] ?? "/tmp/kiwi-T8487-long-time");
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
  await page.goto(server.url + "/?state=ouvindo");
  await page.waitForFunction(() => (window as any).kiwiFogReady);
  for (const time of [8, 3600]) {
    await page.evaluate(
      (t) => (window as any).sweep(1, t, { volume: 1, upper: 0 }),
      time,
    );
    await page.screenshot({ path: join(out, `${time}s.png`) });
  }
} finally {
  await browser.close();
  server.close();
  writeFileSync(
    join(out, "report.json"),
    JSON.stringify(
      {
        scope: "controlled8s/1h functional snapshots, not performance",
        errors,
      },
      null,
      2,
    ) + "\n",
  );
}
if (errors.length) process.exitCode = 1;
