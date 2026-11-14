// A memória do agente (spec #11469, T11665): o "Anotei" no balão do gato, o [Desfazer] e a Atividade, no hub de
// verdade com o AppEngine headless e o agente falso, num WebKit headless. Nada na tela de ninguém.
//
//   bun scripts/agent-memory-check.ts [pasta]
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Page } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";
import { fakeRegistry } from "../src/agent/fake/registry";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T11665-memory"));
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-memory-"));
const registry = fakeRegistry([
  { name: "@agentclientprotocol/claude-agent-acp", version: "0.106.0", files: { "dist/index.js": "" } },
  { name: "zod", version: "4.6.7", files: { "index.js": "" } },
]);
const packages = join(data, "packages.json");
writeFileSync(packages, JSON.stringify(registry.pinned));
async function cli(args: string[]) {
  const p = Bun.spawn([process.execPath, join(app, "scripts/cli.ts"), ...args, "--data", data], {
    cwd: app, stdout: "pipe", stderr: "pipe", env: { ...process.env, KIWI_FAKE_AGENT: "1", KIWI_ADAPTER_REGISTRY: registry.url, KIWI_ADAPTER_PACKAGES: packages },
  });
  const text = await new Response(p.stdout).text();
  assert.equal(await p.exited, 0, text + (await new Response(p.stderr).text()));
  return text;
}
const ctx: UiContext = {
  data,
  send: async (msg) => { const r = await request(data, msg); assert.ok(r); return r; },
  subscribe: async (topics, onMsg) => {
    const c = await connect(data, (line) => { if (!("id" in line)) onMsg(line); });
    assert.ok(c);
    c.write({ id: 0, cmd: "subscribe", topics, follow: true, backlog: false });
    return () => c.close();
  },
};
async function invoke(cap: string, args: unknown = {}) {
  const r = await ctx.send({ cmd: "invoke", cap, args });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.value as any;
}
async function idle() {
  for (let n = 0; (await invoke("agent.status")).busy; n++) { assert.ok(n < 300); await Bun.sleep(100); }
}


/** O recorte do canto do gato: o balão e o gato juntos. */
async function cornerShot(p: Page, sel: string, file: string) {
  await Bun.sleep(300);
  const b = await p.locator(sel).boundingBox();
  const c = await p.locator(".kn-kiwicat").boundingBox();
  assert.ok(b && c, `${sel} e o gato na tela`);
  const x = Math.min(b.x, c.x) - 16;
  const y = Math.min(b.y, c.y) - 16;
  await p.screenshot({ path: join(out, file), clip: { x, y, width: Math.max(b.x + b.width, c.x + c.width) - x + 16, height: Math.max(b.y + b.height, c.y + c.height) - y + 16 } });
}

const browser = await webkit.launch({ headless: true });
const report: { checks: string[]; problems: string[] } = { checks: [], problems: [] };
try {
  await cli(["start", "--no-helper"]);
  await invoke("notes.create", { title: "Ideias", content: "# Ideias\n" });
  await invoke("agent.enable", { consent: true });
  await invoke("agent.download");
  for (let n = 0; (await invoke("agent.status")).adapter.phase !== "ready"; n++) { assert.ok(n < 200); await Bun.sleep(100); }

  const h = await openWindow(browser, ctx, { window: "hub", scale: 2, theme: "light", width: 980, height: 720, motion: false, browser: "webkit", query: { section: "about" } });
  const q = h.page;
  await q.waitForSelector('.kn-kiwicat[data-ready="true"]', { timeout: 15000 });

  // 1. "lembra que…": o agente anota, e o balão mostra "Anotei" com o [Desfazer] depois da resposta.
  await invoke("agent.ask", { text: "lembra que eu prefiro respostas curtas" });
  await idle();
  await q.waitForSelector(".kn-memory-bubble", { timeout: 30000 });
  const text = (await q.locator(".kn-memory-bubble").textContent()) ?? "";
  assert.ok(text.includes("Anotei: eu prefiro respostas curtas") && text.includes("Desfazer"), text);
  assert.deepEqual((await invoke("agent.memory")).facts, ["eu prefiro respostas curtas"]);
  await cornerShot(q, ".kn-memory-bubble", "1-anotei.png");
  report.checks.push("\"lembra que…\": the fact goes into .kiwi/agente/sobre-mim.md and the bubble says \"Anotei\" with [Desfazer]");

  // 2. [Desfazer]: o fato sai da memória.
  await q.locator(".kn-memory-bubble button:has-text('Desfazer')").click();
  await q.waitForFunction(() => document.querySelector(".kn-memory-bubble")?.textContent?.includes("Desfeito"), undefined, { timeout: 15000 });
  assert.deepEqual((await invoke("agent.memory")).facts, []);
  await cornerShot(q, ".kn-memory-bubble", "2-desfeito.png");
  report.checks.push("[Desfazer] takes the fact out of the memory");
  report.problems.push(...h.report.problems);
  await h.close();

  // 3. A Atividade do agente registra a anotação.
  await invoke("agent.ask", { text: "lembra que trabalho com migração de PACS" });
  await idle();
  const s = await openWindow(browser, ctx, { window: "hub", scale: 2, theme: "light", width: 900, height: 1400, motion: false, browser: "webkit", query: { section: "settings" } });
  const p = s.page;
  const line = ".kn-activity-memory";
  await p.waitForSelector(line, { timeout: 15000 });
  assert.ok(((await p.locator(line).first().textContent()) ?? "").includes("Anotou na memória: “trabalho com migração de PACS”"));
  const req = p.locator(".kn-activity-req").filter({ has: p.locator(line) }).first();
  await req.scrollIntoViewIfNeeded();
  await Bun.sleep(300);
  await req.screenshot({ path: join(out, "3-atividade.png") });
  report.checks.push("Atividade do agente: \"Anotou na memória: …\"");
  report.problems.push(...s.report.problems);
  await s.close();
  assert.deepEqual(report.problems, []);
  console.log(JSON.stringify({ ok: true, ...report }, null, 2));
} finally {
  await browser.close().catch(() => {});
  await cli(["stop"]).catch(() => {});
  registry.stop();
  rmSync(data, { recursive: true, force: true });
}
