// O resumo executivo de um projeto (spec #11546, T11559): o pedido, o balão com [Ver] [Aplicar] [Descartar], o
// [Desfazer], a troca do resumo anterior, a pergunta do projeto ambíguo e os blocos em Ajustes › Agente, no hub de
// verdade com o AppEngine headless e o agente falso, num WebKit headless. As notas são de teste, num tmp; nada na tela
// de ninguém, nada no Claude Code de verdade.
//
//   bun scripts/summary-check.ts [pasta]
//
// Sai na pasta: `resumo-executivo.webp` (a folha com os prints) e `resumo-executivo.mp4` (o vídeo do balão).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Page } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";
import { fakeRegistry } from "../src/agent/fake/registry";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T11559-summary"));
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-summary-"));
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
const note = async (path: string) => (await invoke("notes.get", { path })).content as string;

// As notas de teste: o projeto, a nota principal e uma reunião inventada aqui, nunca uma reunião de verdade.
const MAIN_PATH = "Projetos/Migração/Migração.md";
const MAIN = "# Migração\n\nA migração do arquivo antigo para o PACS novo.\n\n## Pendências\n\n- [ ] Pedir o acesso ao bucket\n";
const MEETING = "---\ntype: meeting\ndate: 2026-11-10\nstart: 2026-11-10T10:00:00.000Z\nend: 2026-11-10T10:45:00.000Z\nduration: 2700\napp: Zoom\nparticipants:\n  - Ana\n---\n\n## Transcrição\n\n**Ana** (00:00): Começamos a migração pelo arquivo de 2019.\n";
const KIWI_PATH = "Projetos/Kiwi/Kiwi.md";
const KIWI_OLD = "# Kiwi\n\n## Resumo executivo\n\n**Situação:** 🟢 No rumo · 01/11/2026\n\n### Decisões\n\n- Uma decisão do resumo anterior\n\n## Notas\n\nO app de notas.\n";

const shots: { file: string; caption: string }[] = [];
/** O recorte do canto do gato: o balão (ou o painel) e o gato juntos. */
async function cornerShot(p: Page, sel: string, file: string, caption: string) {
  await Bun.sleep(300);
  const b = await p.locator(sel).boundingBox();
  const c = await p.locator(".kn-kiwicat").boundingBox();
  assert.ok(b && c, `${sel} e o gato na tela`);
  const x = Math.min(b.x, c.x) - 16;
  const y = Math.min(b.y, c.y) - 16;
  await p.screenshot({ path: join(out, file), clip: { x, y, width: Math.max(b.x + b.width, c.x + c.width) - x + 16, height: Math.max(b.y + b.height, c.y + c.height) - y + 16 } });
  shots.push({ file, caption });
}

const browser = await webkit.launch({ headless: true });
const report: { checks: string[]; problems: string[] } = { checks: [], problems: [] };
try {
  await cli(["start", "--no-helper"]);
  await invoke("notes.create", { folder: "Projetos/Migração", title: "Migração", content: MAIN });
  await invoke("projects.mark", { folder: "Projetos/Migração" });
  await invoke("notes.create", { folder: "Projetos/Migração", title: "2026-11-10 · Cronograma", content: MEETING });
  await invoke("agent.enable", { consent: true });
  // O onboarding (spec #11955) abre na primeira vez que o agente liga e cobre o hub: aqui ele já foi feito.
  await invoke("agent.configure", { onboarding: { state: "done" } });
  await invoke("agent.download");
  for (let n = 0; (await invoke("agent.status")).adapter.phase !== "ready"; n++) { assert.ok(n < 200); await Bun.sleep(100); }

  const videoDir = join(out, "video");
  const h = await openWindow(browser, ctx, { window: "hub", scale: 2, theme: "light", width: 980, height: 820, motion: false, browser: "webkit", query: { section: "about" }, video: videoDir });
  const q = h.page;
  await q.waitForSelector('.kn-kiwicat[data-ready="true"]', { timeout: 15000 });

  // 1. A pedido: o agente manda os campos, o Kiwi monta o resumo, e nada é escrito antes do [Aplicar].
  const before = await note(MAIN_PATH);
  await invoke("agent.ask", { text: "faz o resumo executivo do projeto Migração" });
  await idle();
  await q.waitForSelector(".kn-proposal-bubble", { timeout: 30000 });
  assert.equal(await note(MAIN_PATH), before, "nada escrito antes do [Aplicar]");
  const bubble = (await q.locator(".kn-proposal-bubble").textContent()) ?? "";
  assert.ok(bubble.includes("O resumo executivo de Migração está pronto") && bubble.includes("Ver a proposta") && bubble.includes("Aplicar") && bubble.includes("Descartar"), bubble);
  await cornerShot(q, ".kn-proposal-bubble", "1-balao.png", "1. O pedido: o balão com [Ver] [Aplicar] [Descartar]; nada escrito");
  await Bun.sleep(1200);
  report.checks.push("on request: the summary in the cat's bubble with [Ver a proposta] [Aplicar] [Descartar], and nothing written");

  // 2. [Ver a proposta]: os 6 blocos na ordem fixa, com os links das fontes.
  await q.locator(".kn-proposal-bubble button:has-text('Ver a proposta')").click();
  await q.waitForSelector(".kn-proposal-big .kn-proposal-view", { timeout: 15000 });
  const big = (await q.locator(".kn-proposal-big").textContent()) ?? "";
  const order = ["Situação:", "O que andou desde", "Decisões", "Riscos e bloqueios", "Próximos passos", "Reuniões recentes"].map((x) => big.indexOf(x));
  assert.ok(order.every((i) => i >= 0) && order.every((v, i) => i === 0 || v > order[i - 1]!), big);
  assert.ok(big.includes("[[Projetos/Migração/2026-11-10 · Cronograma|"), big);
  await cornerShot(q, ".kn-proposal-big", "2-ver.png", "2. [Ver a proposta]: os 6 blocos na ordem fixa, com as fontes");
  await Bun.sleep(1200);
  report.checks.push("[Ver a proposta]: the 6 blocks in the fixed order, with the source links");

  // 3. [Aplicar]: a seção no topo da nota principal, e o [Desfazer] no balão, que volta a nota.
  await q.locator(".kn-proposal-big button:has-text('Aplicar')").click();
  await q.waitForSelector(".kn-proposal-bubble button:has-text('Desfazer')", { timeout: 15000 });
  const after = await note(MAIN_PATH);
  assert.ok(/^# Migração\n\n## Resumo executivo\n<!-- kiwi:resumo \d{4}-\d{2}-\d{2} -->\n\n\*\*Situação:\*\* 🟡 Atenção/.test(after), after);
  assert.ok(after.endsWith("A migração do arquivo antigo para o PACS novo.\n\n## Pendências\n\n- [ ] Pedir o acesso ao bucket\n"), after);
  await cornerShot(q, ".kn-proposal-bubble", "3-aplicado.png", "3. [Aplicar]: a seção no topo da nota principal, com [Desfazer]");
  await Bun.sleep(1200);
  report.checks.push("[Aplicar] writes the section at the top of the main note, and the bubble offers [Desfazer]");
  await q.locator(".kn-proposal-bubble button:has-text('Desfazer')").click();
  await q.waitForFunction(() => document.querySelector(".kn-proposal-bubble")?.textContent?.includes("Desfeito"), undefined, { timeout: 15000 });
  assert.equal(await note(MAIN_PATH), before, "o [Desfazer] volta a nota principal");
  report.checks.push("[Desfazer] restores the main note");
  await q.locator(".kn-proposal-bubble .kn-proposal-later").click();

  // 4. Um resumo novo substitui o anterior (que fica nas Versões): o [Ver] diz de quando é o anterior.
  await invoke("notes.create", { folder: "Projetos/Kiwi", title: "Kiwi", content: KIWI_OLD });
  await invoke("projects.mark", { folder: "Projetos/Kiwi" });
  await invoke("agent.ask", { text: "resumo executivo do Kiwi" });
  await idle();
  await q.waitForFunction(() => document.querySelector(".kn-proposal-bubble")?.textContent?.includes("de Kiwi está pronto"), undefined, { timeout: 30000 });
  await q.locator(".kn-proposal-bubble button:has-text('Ver a proposta')").click();
  await q.waitForSelector(".kn-proposal-big .kn-proposal-view", { timeout: 15000 });
  const swap = (await q.locator(".kn-proposal-big").textContent()) ?? "";
  assert.ok(swap.includes("no lugar do de 01/11/2026 (que fica nas Versões)") && swap.includes("O que andou desde 01/11/2026"), swap);
  await cornerShot(q, ".kn-proposal-big", "4-troca.png", "4. Um resumo novo no lugar do anterior, que fica nas Versões");
  await q.locator(".kn-proposal-big button:has-text('Aplicar')").click();
  await q.waitForSelector(".kn-proposal-bubble button:has-text('Desfazer')", { timeout: 15000 });
  const kiwi = await note(KIWI_PATH);
  assert.equal(kiwi.match(/## Resumo executivo/g)?.length, 1, kiwi);
  assert.ok(!kiwi.includes("Uma decisão do resumo anterior") && kiwi.endsWith("## Notas\n\nO app de notas.\n"), kiwi);
  await Bun.sleep(1200);
  report.checks.push("a new summary replaces the old one (kept in Versões), and the period counts from the old one");
  await q.locator(".kn-proposal-bubble .kn-proposal-later").click();

  // 5. O projeto ambíguo: o resumo pergunta com botões, sem o "Nenhum" (o resumo é sempre de um projeto).
  await invoke("notes.create", { folder: "Projetos/Kiwi Notes", title: "Kiwi Notes", content: "# Kiwi Notes\n" });
  await invoke("projects.mark", { folder: "Projetos/Kiwi Notes" });
  await invoke("agent.ask", { text: "resumo executivo do Kiwi" });
  await idle();
  await q.waitForFunction(() => document.querySelector(".kn-proposal-bubble")?.textContent?.includes("É do"), undefined, { timeout: 30000 });
  const ask = (await q.locator(".kn-proposal-bubble").textContent()) ?? "";
  assert.ok(ask.includes("Kiwi Notes") && !ask.includes("Nenhum"), ask);
  await cornerShot(q, ".kn-proposal-bubble", "5-ambiguo.png", "5. Projeto ambíguo: a pergunta com um botão por projeto");
  await Bun.sleep(1200);
  report.checks.push("an ambiguous project: the bubble asks with a button per project, without 'Nenhum'");
  report.problems.push(...h.report.problems);
  await h.close();

  // 6. Ajustes › Agente: os 6 blocos e o período do primeiro resumo. O próximo resumo segue.
  const s = await openWindow(browser, ctx, { window: "hub", scale: 2, theme: "light", width: 900, height: 2200, motion: false, browser: "webkit", query: { section: "settings", topic: "meetings" } });
  const p = s.page;
  const rows = ".kn-agent-meetings";
  await p.waitForSelector(rows, { timeout: 15000 });
  // Uma mudança por vez: cada uma vai inteira pelo `agent.configure`, com o estado que a tela tem.
  await p.locator(`${rows} [role=radiogroup][aria-label='O primeiro resumo conta'] button:has-text('7 dias')`).click();
  await p.waitForFunction((sel) => document.querySelector(sel)?.textContent?.includes("últimos 7 dias"), rows, { timeout: 15000 });
  await p.locator(`${rows} [role=switch][aria-label='Decisões (resumo executivo)']`).click();
  await p.waitForSelector(`${rows} [role=switch][aria-label='Decisões (resumo executivo)'][aria-checked=false]`);
  const st = (await invoke("agent.status")).summary;
  assert.equal(st.firstDays, 7);
  assert.equal(st.blocks.decisoes, false);
  // Só a parte do resumo executivo: do título dele até o fim do grupo.
  const box = await p.locator(rows).boundingBox();
  const top = await p.locator(`${rows} :text("Resumo executivo do projeto")`).first().boundingBox();
  assert.ok(box && top);
  await p.screenshot({ path: join(out, "6-ajustes.png"), clip: { x: box.x, y: top.y - 12, width: box.width, height: box.y + box.height - top.y + 12 }, fullPage: true });
  shots.push({ file: "6-ajustes.png", caption: "6. Ajustes › Agente: os 6 blocos e o período do primeiro resumo" });
  await invoke("agent.ask", { text: "resumo executivo do Migração" });
  await idle();
  const fresh = (await invoke("agent.proposals")).proposals.find((x: any) => x.kind === "summary" && x.status === "pending" && x.project?.folder === "Projetos/Migração");
  assert.ok(fresh, "o resumo da Migração");
  const view = await invoke("agent.proposal", { id: fresh.id });
  assert.ok(!view.noteContent.includes("### Decisões") && view.noteContent.includes("### Próximos passos"), view.noteContent);
  report.checks.push("Ajustes › Agente: the 6 block switches and the first period; the next summary follows them");
  report.problems.push(...s.report.problems);
  await s.close();

  // A folha com os prints, em WebP, e o vídeo do balão em mp4 (o WebKit grava em webm).
  const sheet = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 1600, height: 900 } });
  const img = (f: string) => `data:image/png;base64,${readFileSync(join(out, f)).toString("base64")}`;
  await sheet.setContent(
    `<body style="margin:0;padding:24px;background:#eceae4;font:600 22px -apple-system,sans-serif;color:#222">` +
      `<h1 style="margin:0 0 16px;font-size:30px">Resumo executivo do projeto (T11559, spec #11546)</h1>` +
      `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:20px;align-items:start">` +
      shots.map((x) => `<figure style="margin:0"><figcaption style="margin-bottom:8px">${x.caption}</figcaption><img src="${img(x.file)}" style="width:100%;border-radius:10px;box-shadow:0 1px 4px #0003"></figure>`).join("") +
      `</div></body>`,
  );
  await Bun.sleep(300);
  await sheet.screenshot({ path: join(out, "folha.png"), fullPage: true });
  await sheet.close();
  const webp = Bun.spawnSync(["cwebp", "-quiet", "-q", "80", join(out, "folha.png"), "-o", join(out, "resumo-executivo.webp")]);
  if (webp.exitCode !== 0) report.problems.push(`cwebp: ${webp.stderr.toString()}`);
  const webm = [...new Bun.Glob("*.webm").scanSync(videoDir)][0];
  if (webm) {
    const ff = Bun.spawnSync(["ffmpeg", "-y", "-loglevel", "error", "-i", join(videoDir, webm), "-vf", "scale=980:-2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", join(out, "resumo-executivo.mp4")]);
    if (ff.exitCode !== 0) report.problems.push(`ffmpeg: ${ff.stderr.toString()}`);
  }
  assert.deepEqual(report.problems, []);
  console.log(JSON.stringify({ ok: true, ...report }, null, 2));
} finally {
  await browser.close().catch(() => {});
  await cli(["stop"]).catch(() => {});
  registry.stop();
  rmSync(data, { recursive: true, force: true });
}
