// Compose the real cat renderer over real hub screenshots from the headless engine.
// This is an explicitly labelled visual composition, not product integration.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit } from "playwright-core";
import { serveFogDemo } from "./kiwicat-demo";
const app = resolve(import.meta.dir, "..");
const data = mkdtempSync(join(tmpdir(), "kiwi-cutout-hub-"));
const out = resolve(process.argv[2] ?? "/tmp/kiwi-T9708-hub"); mkdirSync(out, { recursive: true });
async function cli(args: string[]) {
  const p = Bun.spawn([process.execPath, join(app, "scripts/cli.ts"), ...args, "--data", data], { cwd: app, stdout: "pipe", stderr: "pipe", env: { ...process.env, KIWI_FAKE_AGENT: "1" } });
  const [text, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  assert.equal(await p.exited, 0, text + err); return text;
}
const server = await serveFogDemo("cat-demo.ts"), browser = await webkit.launch({ headless: true });
const report: any = { scope: "real headless hub screenshots + same cat renderer; composition, not integrated app", captures: [] };
try {
  await cli(["start", "--no-helper"]);
  await cli(["invoke", "settings.set", JSON.stringify({ appearance: { darkTheme: "channels-dark" } })]);
  for (const theme of ["light", "dark"]) {
    const screenshot = join(out, `hub-${theme}.png`);
    report.captures.push(JSON.parse(await cli(["screenshot", "hub", "--theme", theme, "--size", "1000x740", "--scale", "1", "--query", "section=settings", "--out", screenshot])));
    const bg = `data:image/png;base64,${readFileSync(screenshot).toString("base64")}`;
    for (const [strength, backing] of [["leve", .5], ["forte", .35]] as const) for (const height of [120, 500]) {
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 740 }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.goto(server.url + `/?state=repouso&parado=1&cutout=1&outline=1&edgeBand=.08&backing=${backing}&width=${height*.8}&height=${height}`);
      await page.waitForFunction(() => (window as any).kiwiCatReady);
      await page.evaluate(async bg => {
        const image = new Image(); image.src = bg; await image.decode();
        document.body.style.width = "1000px"; document.body.style.height = "740px";
        document.body.style.background = `url("${bg}") 0 0 / 1000px 740px no-repeat`;
        const root = document.getElementById("fog")!;
        Object.assign(root.style, { position: "fixed", right: "12px", bottom: "12px" });
      }, bg);
      await page.screenshot({ path: join(out, `${theme}-${strength}-${height}.png`) });
      await ctx.close();
    }
  }
} finally {
  await browser.close(); server.close();
  await cli(["stop"]).catch(e => { report.cleanup = String(e); });
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
  rmSync(data, { recursive: true, force: true });
}
