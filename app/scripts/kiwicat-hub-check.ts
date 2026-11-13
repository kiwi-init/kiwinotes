// T9567: real hub + real headless AppEngine + ACP fake. Never launches a native window.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";
import { fakeRegistry } from "../src/agent/fake/registry";
const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? "/tmp/kiwi-T9567-hub"); mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-cat-hub-"));
const registry = fakeRegistry([
  { name: "@agentclientprotocol/claude-agent-acp", version: "0.106.0", files: { "dist/index.js": "" } },
  { name: "zod", version: "4.6.7", files: { "index.js": "" } },
]);
const packages = join(data, "packages.json"); writeFileSync(packages, JSON.stringify(registry.pinned));
async function cli(args: string[]) {
  const p = Bun.spawn([process.execPath, join(app, "scripts/cli.ts"), ...args, "--data", data], {
    cwd: app, stdout: "pipe", stderr: "pipe", env: { ...process.env, KIWI_FAKE_AGENT: "1", KIWI_ADAPTER_REGISTRY: registry.url, KIWI_ADAPTER_PACKAGES: packages },
  });
  const text = await new Response(p.stdout).text(); const err = await new Response(p.stderr).text();
  assert.equal(await p.exited, 0, text + err); return text;
}
const ctx: UiContext = { data, send: async msg => { const r = await request(data, msg); assert.ok(r); return r; },
  subscribe: async (topics, onMsg) => {
    const c = await connect(data, line => { if (!("id" in line)) onMsg(line); }); assert.ok(c);
    c.write({ id: 0, cmd: "subscribe", topics, follow: true, backlog: false }); return () => c.close();
  } };
async function invoke(cap: string, args: unknown = {}) { const r = await ctx.send({ cmd: "invoke", cap, args }); assert.equal(r.ok, true, JSON.stringify(r)); return r.value as any; }
const browser = await webkit.launch({ headless: true });
const report: any = { scope: "WebKit headless hub with fake ACP agent; no native app", checks: [] };
try {
  await cli(["start", "--no-helper"]);
  const w = await openWindow(browser, ctx, { window: "hub", scale: 1, theme: "dark", width: 1000, height: 740, motion: true, browser: "webkit", query: { section: "about" } });
  const p = w.page;
  const requested: string[] = []; p.on("request", r => requested.push(r.url()));
  await p.waitForTimeout(200);
  assert.equal(await p.locator(".kn-kiwicat").count(), 0); report.checks.push("agent off: no renderer");
  await invoke("agent.enable", { consent: true }); await invoke("agent.download");
  for (let n = 0; (await invoke("agent.status")).adapter.phase !== "ready"; n++) { assert.ok(n < 200); await Bun.sleep(100); }
  await p.waitForSelector('.kn-kiwicat[data-ready="true"]');
  const identity = await p.locator(".kn-kiwicat canvas").evaluate(c => { (window as any).__catCanvas = c; return c.getBoundingClientRect().height; });
  assert.equal(identity, 120);
  for (const section of ["notes", "meetings", "dictation", "settings", "about"]) {
    await p.locator(`.kn-tab[data-section=${section}]`).click();
    assert.ok(await p.evaluate(() => (window as any).__catCanvas === document.querySelector(".kn-kiwicat canvas")));
    const hit = await p.locator(".kn-kiwicat").evaluate(c => { const r = c.getBoundingClientRect(); return c.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); });
    assert.equal(hit, false);
    await p.screenshot({ path: join(out, `${section}.png`) });
  }
  report.checks.push("120px, five sections, same canvas, click-through");
  await invoke("agent.ask", { text: "/lento" });
  await p.waitForSelector('.kn-kiwicat[data-state="agindo"]');
  await p.screenshot({ path: join(out, "agindo.png") });
  await p.waitForSelector('.kn-kiwicat[data-state="pronto"]');
  await p.screenshot({ path: join(out, "pronto.png") });
  await p.waitForTimeout(1400);
  await invoke("agent.ask", { text: "/sem-rede" });
  await p.waitForSelector('.kn-kiwicat[data-state="erro"]');
  await p.screenshot({ path: join(out, "erro.png") });
  await invoke("agent.ask", { text: "/lento" }); await p.waitForSelector('.kn-kiwicat[data-state="agindo"]');
  await invoke("agent.cancel"); await p.waitForSelector('.kn-kiwicat[data-state="repouso"]');
  report.checks.push("fake tool, ready, error, cancellation");
  await invoke("settings.set", { kiwicat: { show: false } }); await p.waitForSelector(".kn-kiwicat", { state: "detached" });
  await invoke("settings.set", { kiwicat: { show: true } }); await p.waitForSelector('.kn-kiwicat[data-ready="true"]');
  await invoke("agent.disable"); await p.waitForSelector(".kn-kiwicat", { state: "detached" });
  report.checks.push("show switch and agent disable unmount");
  report.page = w.report; report.requests = requested; assert.deepEqual(w.report.problems, []);
  await w.close();
} finally {
  await browser.close(); await cli(["stop"]); registry.stop();
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
  rmSync(data, { recursive: true, force: true });
}
console.log(JSON.stringify(report));
