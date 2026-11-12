// Native-size reference roundtrip; no screenshots of the real application.
import { webkit } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { serveFogDemo } from "./kiwicat-demo";
const out = resolve(process.argv[2] ?? "/tmp/kiwi-T8487-reference");
mkdirSync(out, { recursive: true });
const server = await serveFogDemo(),
  browser = await webkit.launch({ headless: true }).catch((error) => {
    server.close();
    throw error;
  });
try {
  const context = await browser.newContext({
    viewport: { width: 2048, height: 2560 },
    deviceScaleFactor: 1,
    reducedMotion: "no-preference",
  });
  const page = await context.newPage(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(server.url + "/?mode=capture&width=2048&height=2560&seed=17");
  await page.waitForFunction(() => (window as any).kiwiFogReady, null, {
    timeout: 30000,
  });
  await page.screenshot({ path: join(out, "reference.png") });
  writeFileSync(
    join(out, "report.json"),
    JSON.stringify(
      {
        backend: await page.evaluate(
          () => (window as any).kiwiFog.stats.backend,
        ),
        size: [2048, 2560],
        seed: 17,
        time: 0,
        colour: "padrao",
        errors,
      },
      null,
      2,
    ) + "\n",
  );
  await context.close();
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
