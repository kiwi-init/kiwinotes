// T19969 (spec #19269): "esse arquivo" no pedido ao Kiwi-cat é o que está aberto nas Notas, mesmo com outra aba do Hub
// na frente. No headless, com o agente falso; nunca abre janela nem liga o agente de verdade:
//
// - nada aberto nas Notas: "nesse arquivo…" e o agente pergunta qual;
// - o `dados-exemplo.csv` aberto nas Notas, e a aba Início na frente: o agente diz "No dados-exemplo.csv:" e lê o
//   arquivo pelo `files_read`.
//
// Tudo inventado: a pasta "Dados" e o `dados-exemplo.csv`, com três pessoas fictícias.
//
//   bun scripts/open-file-agent-check.ts [pasta]
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Page } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";
import { fakeRegistry } from "../src/agent/fake/registry";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T19969-aberto"));
mkdirSync(out, { recursive: true });

const CSV = "nome,cidade,total\nAna,Recife,120\nBruno,Natal,80\nCarla,Belém,95\n";

const data = mkdtempSync(join(tmpdir(), "kiwi-aberto-"));
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
  const err = await new Response(p.stderr).text();
  assert.equal(await p.exited, 0, text + err);
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

const BUBBLE = ".kn-bubble-slot:not([data-phase='exit']) .kn-bubble";
/** Pede ao agente falso e devolve o balão pequeno quando ele para de digitar. */
async function ask(p: Page, text: string, expect: RegExp) {
  await invoke("agent.ask", { text });
  for (let n = 0; ; n++) {
    const now = (await p.locator(`${BUBBLE} .kn-bubble-typed`).allInnerTexts()).join("");
    if (expect.test(now)) break;
    assert.ok(n < 120, `o balão não disse ${expect} (disse "${now}")`);
    await Bun.sleep(150);
  }
  await p.waitForFunction(() => document.querySelector<HTMLElement>(".kn-kiwicat")?.dataset.state !== "agindo");
  await Bun.sleep(300);
}

const browser = await webkit.launch({ headless: true });
const checks: string[] = [];
try {
  await cli(["start", "--no-helper"]);
  await invoke("files.create", { folder: "Dados", name: "dados-exemplo.csv", base64: Buffer.from(CSV).toString("base64") });
  await invoke("agent.enable", { consent: true });
  await invoke("agent.download");
  await invoke("agent.configure", { onboarding: { state: "done" } });
  await invoke("settings.set", { kiwicat: { overlay: false, show: true } });
  for (let n = 0; (await invoke("agent.status")).adapter.phase !== "ready"; n++) { assert.ok(n < 200); await Bun.sleep(100); }

  const w = await openWindow(browser, ctx, { window: "hub", scale: 2, theme: "light", width: 1000, height: 740, motion: false, browser: "webkit", query: {} });
  const p = w.page;
  try {
    await p.waitForSelector(".kn-hub");
    // ---- Nada aberto nas Notas: o agente pergunta qual. ----
    await ask(p, "nesse arquivo, quantas linhas tem a tabela?", /Qual nota ou arquivo\? Nada está aberto nas Notas agora\./);
    await p.screenshot({ path: join(out, "01-nada-aberto-pergunta.png") });
    checks.push("nada aberto: \"nesse arquivo\" e o agente pergunta qual, sem chutar");

    // ---- O csv aberto nas Notas. ----
    await invoke("notes.openPath", { path: "Dados/dados-exemplo.csv" });
    await p.waitForSelector(".kn-file");
    assert.equal((await p.locator(".kn-file-title").innerText()).trim(), "dados-exemplo.csv");
    await Bun.sleep(300);
    await p.screenshot({ path: join(out, "02-csv-aberto-nas-notas.png") });

    // ---- Outra aba na frente (o Início): o aberto continua valendo. ----
    await p.locator('.kn-hub [role="tab"][data-section="home"]').click();
    await p.waitForSelector('.kn-hub-pane[data-section="notes"][hidden]', { state: "attached" });
    await ask(p, "tá vendo esse arquivo aberto? quantas linhas tem a tabela?", /No dados-exemplo\.csv: li o arquivo, a tabela tem 4 linhas, com o cabeçalho\./);
    const said = (await p.locator(`${BUBBLE} .kn-bubble-typed`).allInnerTexts()).join("");
    await p.screenshot({ path: join(out, "03-aberto-com-outra-aba.png") });
    checks.push(`o csv aberto, com o Início na frente: "${said.trim()}"`);
    assert.deepEqual(w.report.problems, [], "problemas na página");
  } finally {
    await w.close();
  }
  console.log(JSON.stringify({ ok: true, out, checks }, null, 2));
} finally {
  await browser.close();
  await cli(["stop"]).catch(() => {});
}
