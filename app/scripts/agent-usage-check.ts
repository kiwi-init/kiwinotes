// O agente econômico (spec #11084, T11114): o medidor, o modo econômico e o limite no balão, no hub de verdade com o
// AppEngine headless e o agente falso, num WebKit headless. Nada na tela de ninguém, nada no Claude Code de verdade.
//
//   bun scripts/agent-usage-check.ts [pasta]
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Page } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";
import { fakeRegistry } from "../src/agent/fake/registry";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T11114-usage"));
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-usage-"));
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
const meter = ".kn-section:has(h2:text-is('O gasto do agente'))";
/** Espera o texto aparecer no medidor (o `:text-is` é só do Playwright, não do `querySelector`). */
const meterText = (p: Page) =>
  p.evaluate(() => [...document.querySelectorAll(".kn-section")].find((s) => s.querySelector("h2")?.textContent === "O gasto do agente")?.textContent ?? "(sem medidor)");
const meterHas = async (p: Page, text: string) => {
  try {
    await p.waitForFunction(
      (want) => [...document.querySelectorAll(".kn-section")].find((s) => s.querySelector("h2")?.textContent === "O gasto do agente")?.textContent?.includes(want),
      text,
      { timeout: 15000 },
    );
  } catch (e) {
    throw new Error(`o medidor não mostrou "${text}": ${await meterText(p)}`);
  }
};
const shot = async (p: Page, sel: string, file: string) => {
  await p.locator(sel).scrollIntoViewIfNeeded();
  await Bun.sleep(300);
  await p.locator(sel).screenshot({ path: join(out, file) });
};

const browser = await webkit.launch({ headless: true });
const report: { checks: string[]; problems: string[] } = { checks: [], problems: [] };
try {
  await cli(["start", "--no-helper"]);
  await invoke("agent.enable", { consent: true });
  await invoke("agent.download");
  for (let n = 0; (await invoke("agent.status")).adapter.phase !== "ready"; n++) { assert.ok(n < 200); await Bun.sleep(100); }
  // Três pedidos, de tamanhos diferentes: o gasto que o agente falso informa.
  for (const text of ["Qual é o prazo do Kiwi?", `Resuma as reuniões da semana. ${"Com detalhes. ".repeat(80)}`, "Obrigado"]) {
    await invoke("agent.ask", { text });
    await idle();
  }

  const w = await openWindow(browser, ctx, { window: "hub", scale: 2, theme: "light", width: 900, height: 1400, motion: false, browser: "webkit", query: { section: "settings" } });
  const p = w.page;
  // 1. O medidor: o gasto do Kiwi e, ao abrir, o uso da assinatura pelo /usage.
  await p.waitForSelector(meter, { timeout: 15000 });
  await meterHas(p, "5 horas: 37%");
  const text = (await p.locator(meter).textContent()) ?? "";
  assert.ok(text.includes("3 pedidos"), "o gasto da semana");
  assert.ok(text.includes("lidos do cache"), "o quanto o cache serviu");
  assert.ok(text.includes("Resuma as reuniões"), "o pedido mais caro na lista");
  assert.ok(!/US\$|\$|USD|dólar/i.test(text), "nada em dinheiro");
  const usageCalls = w.report.invokes["agent.usageRefresh"] ?? 0;
  assert.equal(usageCalls, 1, "o /usage só ao abrir");
  await shot(p, meter, "1-medidor.png");
  report.checks.push("the meter: the Kiwi's spend in 5 hours and the week, the most expensive, the cache, and /usage once on opening");

  // 2. O modo econômico, em Ajustes › Agente.
  const eco = ".kn-row:has(.kn-row-label:text-is('Modo econômico'))";
  await p.waitForSelector(eco);
  await p.locator(`${eco} [role=switch]`).click();
  await p.waitForSelector(`${eco} [role=switch][aria-checked=true]`);
  assert.ok(((await p.locator(eco).textContent()) ?? "").includes("Trocar de modelo começa um cache novo"));
  await shot(p, eco, "2-modo-economico.png");
  report.checks.push("the economy mode switch, with the cache warning");

  // 3. O limite acabado: a linha no medidor, com a hora de volta que o agente informou.
  await invoke("agent.ask", { text: "/limite-com-hora" });
  await idle();
  await meterHas(p, "O limite acabou. Ele volta");
  await shot(p, meter, "3-medidor-limite.png");
  report.checks.push("the meter says the limit is over, with the return time");

  // 4. "Atualizar" pede o /usage de novo; "Apagar" leva só o gasto.
  await p.locator(`${meter} button:has-text('Atualizar')`).click();
  await p.locator(`${meter} button:has-text('Atualizar')`).waitFor();
  await p.locator(`${meter} button:has-text('Apagar')`).click();
  await meterHas(p, "Nenhum pedido.");
  report.checks.push("Atualizar asks /usage again; Apagar clears the spend");
  report.problems.push(...w.report.problems);
  await w.close();

  // 5. O balão: o aviso do agente e o limite acabado, no hub com o gato.
  const h = await openWindow(browser, ctx, { window: "hub", scale: 2, theme: "dark", width: 900, height: 620, motion: false, browser: "webkit", query: { section: "about" } });
  const q = h.page;
  await q.waitForSelector('.kn-kiwicat[data-ready="true"]', { timeout: 15000 });
  await invoke("agent.ask", { text: "/aviso" });
  // O trecho do aviso inteiro e já digitado.
  await q.waitForFunction(
    () => {
      const ghost = document.querySelector(".kn-bubble-ghost")?.textContent ?? "";
      return ghost.includes("do seu limite") && document.querySelector(".kn-bubble-typed")?.textContent === ghost;
    },
    undefined,
    { timeout: 15000 },
  );
  await Bun.sleep(250);
  const b = await q.locator(".kn-bubble").boundingBox();
  const c = await q.locator(".kn-kiwicat").boundingBox();
  assert.ok(b && c);
  const clip = { x: b.x - 16, y: Math.min(b.y, c.y) - 16, width: c.x + c.width - b.x + 32, height: Math.max(b.y + b.height, c.y + c.height) - Math.min(b.y, c.y) + 32 };
  await q.screenshot({ path: join(out, "4-balao-aviso.png"), clip });
  await idle();
  report.checks.push("the agent's warning in the balloon, without stopping the answer");
  await invoke("agent.ask", { text: "/limite-com-hora" });
  await q.waitForFunction(() => document.querySelector(".kn-bubble-ghost")?.textContent?.includes("O seu limite acabou. Ele volta"), undefined, { timeout: 15000 });
  const b2 = await q.locator(".kn-bubble").boundingBox();
  assert.ok(b2);
  await q.screenshot({ path: join(out, "5-balao-limite.png"), clip: { ...clip, x: b2.x - 16, width: c.x + c.width - b2.x + 32 } });
  report.checks.push("the limit over in the balloon, with the return time");
  report.problems.push(...h.report.problems);
  await h.close();
  assert.deepEqual(report.problems, []);
  console.log(JSON.stringify({ ok: true, ...report }, null, 2));
} finally {
  await browser.close().catch(() => {});
  await cli(["stop"]).catch(() => {});
  registry.stop();
  rmSync(data, { recursive: true, force: true });
}
