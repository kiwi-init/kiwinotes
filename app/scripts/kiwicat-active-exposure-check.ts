// Active-field exposure sweep, including maximum synthetic voice. No mic.
import { webkit } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { serveFogDemo } from "./kiwicat-demo";
const out = resolve(process.argv[2] ?? "/tmp/kiwi-T8487-active-exposure");
mkdirSync(out, { recursive: true });
const server = await serveFogDemo("exposure-demo.ts");
const browser = await webkit.launch({ headless: true }).catch((e) => {
  server.close();
  throw e;
});
const report: any = {
  task: "T8487",
  scope: "functional pixel sweep, NOT CPU benchmark",
  time: 6,
  range: [0.5, 1.4],
  step: 0.01,
  cases: [],
};
try {
  for (const variant of ["B1"])
    for (const state of ["ouvindo", "thinking"]) {
      const name = variant + "-" + state,
        folder = join(out, name);
      mkdirSync(folder, { recursive: true });
      const context = await browser.newContext({
        viewport: { width: 640, height: 800 },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage(),
        errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(`${server.url}/?variant=${variant}&state=${state}`);
      await page.waitForFunction(() => (window as any).kiwiFogReady);
      await page.screenshot({ path: join(folder, "reference.png") });
      const controls =
        state === "ouvindo"
          ? { side: 0, upper: 0.1, volume: 1.16 }
          : { side: 0.28, upper: 0.2, volume: 1 };
      for (let i = 0; i <= 90; i++) {
        const exposure = 0.5 + i * 0.01;
        await page.evaluate(
          ({ exposure, controls }) =>
            (window as any).sweep(exposure, 6, controls),
          { exposure, controls },
        );
        await page.screenshot({
          path: join(folder, `exposure-${exposure.toFixed(2)}.png`),
        });
      }
      report.cases.push({ variant, state, controls, frames: 91, errors });
      await context.close();
      console.log("swept", name);
    }
} finally {
  await browser.close();
  server.close();
  writeFileSync(
    join(out, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
}
if (report.cases.some((c: any) => c.errors.length)) process.exitCode = 1;
