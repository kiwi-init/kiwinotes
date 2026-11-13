// T10727: the hub with the agent off (no cat), dark and light, to paste the candidates at 120 px. Headless WebKit,
// headless AppEngine, data in a tmp: nothing native, nothing on screen.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const app = "/Users/davivicente/Documents/personal-projects/code-projects/kiwinotes-wt/T10727/app";
const { webkit } = await import(`${app}/node_modules/playwright-core`);
const { request } = await import(`${app}/scripts/cli`);
const { openWindow } = await import(`${app}/scripts/ui-page`);
const OUT = process.argv[2]!;
const data = mkdtempSync(join(tmpdir(), "kiwi-art-bg-"));
async function cli(args: string[]) {
  const p = Bun.spawn([process.execPath, join(app, "scripts/cli.ts"), ...args, "--data", data], { cwd: app, stdout: "pipe", stderr: "pipe" });
  const t = await new Response(p.stdout).text(); const e = await new Response(p.stderr).text(); assert.equal(await p.exited, 0, t + e);
}
const ctx = { data, send: async (m: any) => { const r = await request(data, m); assert.ok(r); return r; }, subscribe: async () => () => {} };
const browser = await webkit.launch({ headless: true });
try {
  await cli(["start", "--no-helper"]);
  for (const theme of ["dark", "light"] as const) {
    const w = await openWindow(browser, ctx as any, { window: "hub", scale: 2, theme, width: 1000, height: 740, motion: false, browser: "webkit", query: { section: "notes" } });
    await Bun.sleep(1500);
    await w.page.screenshot({ path: `${OUT}/hub-${theme}.png` });
  }
} finally {
  await browser.close(); await cli(["stop"]).catch(() => {}); rmSync(data, { recursive: true, force: true });
}
