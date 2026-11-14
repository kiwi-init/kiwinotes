// A memória escrita à mão (spec #12749, T12771): o aviso em Ajustes › Agente › Memória e o balão do gato quando o agente
// não muda a memória que passou do limite, no claro e no escuro. WebKit headless com o AppEngine headless e o agente
// falso; nada na tela de ninguém.
//
//   bun scripts/memory-handedit-check.ts <pasta>
//
// Sai `memoria.webp`, a folha com os prints.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Page } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";
import { fakeRegistry } from "../src/agent/fake/registry";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-memory-handedit"));
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-memory-handedit-"));
const registry = fakeRegistry([
  { name: "@agentclientprotocol/claude-agent-acp", version: "0.106.0", files: { "dist/index.js": "" } },
  { name: "zod", version: "4.6.7", files: { "index.js": "" } },
]);
const packages = join(data, "packages.json");
writeFileSync(packages, JSON.stringify(registry.pinned));
async function cli(args: string[]) {
  const p = Bun.spawn([process.execPath, join(app, "scripts/cli.ts"), ...args, "--data", data], {
    cwd: app,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, KIWI_FAKE_AGENT: "1", KIWI_ADAPTER_REGISTRY: registry.url, KIWI_ADAPTER_PACKAGES: packages },
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


/** O arquivo escrito à mão: um fato longo e um parágrafo fora da lista. */
const LONG = "Trabalho na migração do PACS antigo para o novo, com o arquivo de 2019 primeiro, fora do horário de pico, e a revisão de segurança antes de abril; a Ana cuida do anonimizador e o Bruno do bucket, e toda sexta tem a reunião de status às 10h com o time inteiro, onde eu levo o andamento de cada fase e os bloqueios da semana.";
const MEMORY = [
  "# O que o agente sabe sobre você",
  "",
  "O agente do Kiwi escreve aqui o que aprende sobre você, um fato por linha. Você vê e muda tudo em Ajustes › Agente › Memória, ou aqui mesmo.",
  "",
  "- prefiro respostas curtas",
  `- ${LONG}`,
  "",
  "Uma observação minha, fora da lista.",
  "",
].join("\n");

const shots: { file: string; caption: string }[] = [];
async function shot(p: Page, file: string, caption: string, clip?: { x: number; y: number; width: number; height: number }) {
  await Bun.sleep(400);
  await p.screenshot({ path: join(out, file), ...(clip ? { clip } : {}) });
  shots.push({ file, caption });
}
/** O canto do gato: o balão e o gato juntos. */
async function corner(p: Page, sel: string) {
  const b = await p.locator(sel).first().boundingBox();
  const c = await p.locator(".kn-kiwicat").boundingBox();
  assert.ok(b && c, `${sel} e o gato na tela`);
  const x = Math.min(b.x, c.x) - 16, y = Math.min(b.y, c.y) - 16;
  return { x, y, width: Math.max(b.x + b.width, c.x + c.width) - x + 16, height: Math.max(b.y + b.height, c.y + c.height) - y + 16 };
}

const browser = await webkit.launch({ headless: true });
const problems: string[] = [];
try {
  await cli(["start", "--no-helper"]);
  await invoke("agent.enable", { consent: true });
  // O onboarding (spec #11955) abre na primeira vez que o agente liga e cobre o hub: aqui ele já foi feito.
  await invoke("agent.configure", { onboarding: { state: "done" } });
  // O headless nunca fica "na frente": sem isso, o gato do hub vai para o overlay no pedido (T12273).
  await invoke("settings.set", { kiwicat: { overlay: false } });
  await invoke("agent.download");
  for (let n = 0; (await invoke("agent.status")).adapter.phase !== "ready"; n++) { assert.ok(n < 200); await Bun.sleep(100); }
  const file = join(data, "vault", ".kiwi", "agente", "sobre-mim.md");
  mkdirSync(join(data, "vault", ".kiwi", "agente"), { recursive: true });
  writeFileSync(file, MEMORY);
  const view = await invoke("agent.memory");
  assert.deepEqual(view.facts, ["prefiro respostas curtas"]);
  assert.equal(view.skipped.length, 1);
  assert.equal(view.outside, 1);

  for (const theme of ["light", "dark"] as const) {
    const t = theme === "light" ? "claro" : "escuro";
    // 1. Ajustes › Agente › Memória: o aviso com o fato de fora e a linha que não é fato.
    const a = await openWindow(browser, ctx, { window: "hub", scale: 2, theme, width: 900, height: 900, motion: false, browser: "webkit", query: { section: "settings", topic: "agent" } });
    const box = a.page.locator(".kn-agent-memory").first();
    await a.page.waitForSelector(".kn-memory-skipped", { timeout: 15000 });
    await box.scrollIntoViewIfNeeded();
    const b = await box.boundingBox();
    assert.ok(b);
    await shot(a.page, `ajustes-${theme}.png`, `Ajustes › Agente › Memória (${t})`, { x: Math.max(0, b.x - 12), y: Math.max(0, b.y - 12), width: Math.min(b.width + 24, 900), height: Math.min(b.height + 24, 900) });
    problems.push(...a.report.problems);
    await a.close();

    // 2. O balão: o agente tenta anotar, e a memória passou do limite.
    const h = await openWindow(browser, ctx, { window: "hub", scale: 2, theme, width: 900, height: 620, motion: false, browser: "webkit", query: { section: "about" } });
    await h.page.waitForSelector('.kn-kiwicat[data-ready="true"]', { timeout: 15000 });
    await ctx.send({ cmd: "hubView", view: true });
    await invoke("agent.ask", { text: "lembra que tem um gato" });
    await idle();
    // O aviso vem depois da resposta (o agente falso responde com o erro cru da ferramenta, "Não deu: E_MEMORY_OVER…"):
    // o print espera o aviso vivo e sozinho, como o settings-topics-check (#12536).
    await h.page.waitForFunction(() => {
      const live = [...document.querySelectorAll(".kn-bubble-slot")].filter((s) => s.getAttribute("data-phase") !== "exit");
      const slot = live.find((s) => s.querySelector(".kn-memory-bubble")?.textContent?.includes("passou do limite"));
      return !!slot && live.length === 1 && Number(getComputedStyle(slot).opacity) > 0.99;
    }, undefined, { timeout: 90000 });
    const line = await h.page.locator(".kn-memory-bubble .kn-memory-line").first().textContent();
    assert.match(line ?? "", /A memória passou do limite: um fato passa de 300 caracteres/);
    assert.equal(readFileSync(file, "utf8"), MEMORY, "o arquivo não muda");
    await shot(h.page, `balao-${theme}.png`, `O balão (${t})`, await corner(h.page, ".kn-memory-bubble"));
    problems.push(...h.report.problems);
    await h.close();
  }

  const sheet = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 1400, height: 900 } });
  const img = (f: string) => `data:image/png;base64,${readFileSync(join(out, f)).toString("base64")}`;
  await sheet.setContent(
    `<body style="margin:0;padding:24px;background:#eceae4;font:600 20px -apple-system,sans-serif;color:#222">` +
      `<h1 style="margin:0 0 16px;font-size:28px">A memória escrita à mão (spec #12749)</h1>` +
      `<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:18px;align-items:start">` +
      shots.map((x) => `<figure style="margin:0"><figcaption style="margin-bottom:6px">${x.caption}</figcaption><img src="${img(x.file)}" style="width:100%;border-radius:10px;box-shadow:0 1px 4px #0003"></figure>`).join("") +
      `</div></body>`,
  );
  await sheet.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0), undefined, { timeout: 30000 });
  await sheet.screenshot({ path: join(out, "memoria.png"), fullPage: true });
  await sheet.close();
  const webp = Bun.spawnSync(["cwebp", "-quiet", "-q", "80", join(out, "memoria.png"), "-o", join(out, "memoria.webp")]);
  if (webp.exitCode !== 0) problems.push(`cwebp: ${webp.stderr.toString()}`);
  assert.deepEqual(problems, []);
  console.log(JSON.stringify({ ok: true, shots: shots.map((s) => s.file) }, null, 2));
} finally {
  await browser.close().catch(() => {});
  await cli(["stop"]).catch(() => {});
  registry.stop();
  rmSync(data, { recursive: true, force: true });
}
