// O polimento do unslop (spec #12626): as mesmas telas antes e depois, no claro e no escuro, pelo WebKit headless com
// o AppEngine headless e o agente falso. Nada na tela de ninguém.
//
//   bun scripts/unslop-check.ts <pasta> [rótulo]
//
// Rode na main (rótulo "antes") e no branch (rótulo "depois"): sai `<rótulo>.webp`, a folha com a nota aberta (o
// título, a meta, a migalha e os callouts), a Aparência (os grupos de temas) e o balão da proposta.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Page } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";
import { fakeRegistry } from "../src/agent/fake/registry";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-unslop"));
const label = process.argv[3] ?? "depois";
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-unslop-"));
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

/** A nota da prova: começa com o H1 igual ao título, e tem os callouts que o polimento muda. */
const NOTE = [
  "# Plano do trimestre",
  "",
  "A migração termina em abril, com a revisão de segurança antes.",
  "",
  "> [!warning] Atenção",
  "> O prazo do contrato vence no dia 20.",
  "",
  "> [!tip]",
  "> Rever o orçamento junto com o jurídico.",
  "",
  "> [!quote] Citação",
  "> O arquivo de 2019 entra primeiro.",
  "",
  "- [ ] Fechar o contrato",
  "- [ ] Rever o anonimizador",
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
  await invoke("notes.create", { folder: "Projetos/Kiwi", title: "Plano do trimestre", content: NOTE });
  await invoke("notes.create", { folder: "Projetos/Kiwi", title: "Reunião de abril", content: "# Reunião de abril\n\nVer o [[Plano do trimestre]].\n" });
  await invoke("notes.create", { folder: "Projetos/Migração", title: "Migração", content: "# Migração\n\nA migração do arquivo antigo para o PACS novo.\n" });
  await invoke("projects.mark", { folder: "Projetos/Migração" });
  await invoke("agent.enable", { consent: true });
  // O onboarding (spec #11955) abre na primeira vez que o agente liga e cobre o hub: aqui ele já foi feito.
  await invoke("agent.configure", { onboarding: { state: "done" } });
  await invoke("agent.download");
  for (let n = 0; (await invoke("agent.status")).adapter.phase !== "ready"; n++) { assert.ok(n < 200); await Bun.sleep(100); }

  for (const theme of ["light", "dark"] as const) {
    const t = theme === "light" ? "claro" : "escuro";
    // 1. A nota aberta: o título, a meta, a migalha e os callouts.
    const n = await openWindow(browser, ctx, { window: "notes", scale: 2, theme, width: 900, height: 760, motion: false, browser: "webkit", query: { note: "Projetos/Kiwi/Plano do trimestre.md" } });
    await n.page.waitForSelector(".kn-meta", { timeout: 15000 });
    await n.page.waitForSelector(".cm-content", { timeout: 15000 });
    await shot(n.page, `nota-${theme}.png`, `A nota aberta (${t})`);
    problems.push(...n.report.problems);
    await n.close();

    // 2. A Aparência: os grupos de temas, com a contagem.
    const a = await openWindow(browser, ctx, { window: "hub", scale: 2, theme, width: 900, height: 760, motion: false, browser: "webkit", query: { section: "settings", topic: "appearance" } });
    const group = a.page.locator(".kn-prefs-topic[data-topic=appearance] .kn-theme-group-title, .kn-prefs-topic[data-topic=appearance] :text-matches('^(Escuros|Claros)')").first();
    await group.waitFor({ timeout: 15000 });
    await group.scrollIntoViewIfNeeded();
    const g = await group.boundingBox();
    assert.ok(g);
    await shot(a.page, `aparencia-${theme}.png`, `A Aparência (${t})`, { x: Math.max(0, g.x - 24), y: Math.max(0, g.y - 80), width: 760, height: 300 });
    problems.push(...a.report.problems);
    await a.close();

    // 3. O balão da proposta: o resumo executivo do projeto, pelo agente falso.
    const h = await openWindow(browser, ctx, { window: "hub", scale: 2, theme, width: 900, height: 620, motion: false, browser: "webkit", query: { section: "about" } });
    await h.page.waitForSelector('.kn-kiwicat[data-ready="true"]', { timeout: 15000 });
    await ctx.send({ cmd: "hubView", view: true });
    if (theme === "light") {
      await invoke("agent.ask", { text: "faz o resumo executivo do projeto Migração" });
      await idle();
    }
    await h.page.waitForFunction(() => [...document.querySelectorAll(".kn-proposal-bubble")].some((e) => !e.closest('[data-phase="exit"]')), undefined, { timeout: 30000 });
    await Bun.sleep(800);
    await shot(h.page, `balao-${theme}.png`, `O balão da proposta (${t})`, await corner(h.page, ".kn-proposal-bubble"));
    problems.push(...h.report.problems);
    await h.close();
  }

  const sheet = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 1600, height: 900 } });
  const img = (f: string) => `data:image/png;base64,${readFileSync(join(out, f)).toString("base64")}`;
  await sheet.setContent(
    `<body style="margin:0;padding:24px;background:#eceae4;font:600 20px -apple-system,sans-serif;color:#222">` +
      `<h1 style="margin:0 0 16px;font-size:30px">O polimento do unslop (spec #12626): ${label}</h1>` +
      `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:18px;align-items:start">` +
      shots.map((x) => `<figure style="margin:0"><figcaption style="margin-bottom:6px">${x.caption}</figcaption><img src="${img(x.file)}" style="width:100%;border-radius:10px;box-shadow:0 1px 4px #0003"></figure>`).join("") +
      `</div></body>`,
  );
  await sheet.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0), undefined, { timeout: 30000 });
  await sheet.screenshot({ path: join(out, `${label}.png`), fullPage: true });
  await sheet.close();
  const webp = Bun.spawnSync(["cwebp", "-quiet", "-q", "80", join(out, `${label}.png`), "-o", join(out, `${label}.webp`)]);
  if (webp.exitCode !== 0) problems.push(`cwebp: ${webp.stderr.toString()}`);
  assert.deepEqual(problems, []);
  console.log(JSON.stringify({ ok: true, label, shots: shots.map((s) => s.file) }, null, 2));
} finally {
  await browser.close().catch(() => {});
  await cli(["stop"]).catch(() => {});
  registry.stop();
  rmSync(data, { recursive: true, force: true });
}
