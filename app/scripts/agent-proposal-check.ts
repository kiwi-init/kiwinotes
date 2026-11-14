// A reunião vira nota do projeto (spec #8360, T11293): a proposta no balão do gato e na Atividade do agente, no hub de
// verdade com o AppEngine headless e o agente falso, num WebKit headless. As reuniões são notas de teste num tmp, nunca
// uma reunião de verdade; nada na tela de ninguém, nada no Claude Code de verdade.
//
//   bun scripts/agent-proposal-check.ts [pasta]
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Page } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";
import { fakeRegistry } from "../src/agent/fake/registry";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T11293-proposal"));
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-proposal-"));
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

// As reuniões de teste: a transcrição é inventada aqui, nunca de uma reunião de verdade.
const meeting = (date: string, start: string, who: string, said: string) =>
  `---\ntype: meeting\ndate: ${date}\nstart: ${date}T${start}:00.000Z\nend: ${date}T${start.replace(/:\d\d$/, ":45")}:00.000Z\nduration: 2700\napp: Zoom\nparticipants:\n  - ${who}\n---\n\n## Transcrição\n\n**${who}** (00:00): ${said}\n`;
const MAIN = "# Migração\n\nA migração do arquivo antigo para o PACS novo.\n\n## Pendências\n\n- [ ] Pedir o acesso ao bucket\n\n## Notas\n\nO arquivo de 2019 é o maior.\n";

/** O recorte do canto do gato: o balão (ou o painel) e o gato juntos. */
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
  await invoke("notes.create", { folder: "Projetos/Migração", title: "Migração", content: MAIN });
  await invoke("projects.mark", { folder: "Projetos/Migração" });
  await invoke("notes.create", { folder: "Reuniões", title: "2026-11-11 10h00 Zoom", content: meeting("2026-11-11", "10:00", "Ana", "Vamos começar a migração pelo arquivo de 2019.") });
  await invoke("agent.enable", { consent: true });
  await invoke("agent.download");
  for (let n = 0; (await invoke("agent.status")).adapter.phase !== "ready"; n++) { assert.ok(n < 200); await Bun.sleep(100); }

  // O vídeo do balão: o pedido, [Ver], [Aplicar], [Desfazer] e a pergunta do projeto (o WebKit grava a janela).
  const videoDir = join(out, "video");
  const h = await openWindow(browser, ctx, { window: "hub", scale: 2, theme: "light", width: 980, height: 720, motion: false, browser: "webkit", query: { section: "about" }, video: videoDir });
  const q = h.page;
  await q.waitForSelector('.kn-kiwicat[data-ready="true"]', { timeout: 15000 });

  // 1. A pedido: o agente prepara a proposta, e nada é escrito. O balão da proposta vem depois da resposta.
  const before = await note("Projetos/Migração/Migração.md");
  await invoke("agent.ask", { text: "atualiza o projeto com a reunião que eu acabei de ter" });
  await idle();
  await q.waitForSelector(".kn-proposal-bubble", { timeout: 30000 });
  assert.equal(await note("Projetos/Migração/Migração.md"), before, "nada escrito antes do [Aplicar]");
  const bubble = (await q.locator(".kn-proposal-bubble").textContent()) ?? "";
  assert.ok(bubble.includes("está pronta") && bubble.includes("Ver a proposta") && bubble.includes("Aplicar") && bubble.includes("Descartar"), bubble);
  await cornerShot(q, ".kn-proposal-bubble", "1-balao-proposta.png");
  await Bun.sleep(1500);
  report.checks.push("on request: the proposal in the cat's bubble with [Ver a proposta] [Aplicar] [Descartar], and nothing written");

  // 2. [Ver a proposta]: a nota nova e as linhas que entram na nota principal.
  await q.locator(".kn-proposal-bubble button:has-text('Ver a proposta')").click();
  await q.waitForSelector(".kn-proposal-big .kn-proposal-view", { timeout: 15000 });
  const big = (await q.locator(".kn-proposal-big").textContent()) ?? "";
  assert.ok(big.includes("2026-11-11 · Cronograma da migração.md") && big.includes("Confirmar a janela de manutenção"), big);
  await cornerShot(q, ".kn-proposal-big", "2-ver-proposta.png");
  await q.locator(".kn-proposal-big").evaluate((el) => el.scrollTo({ top: el.scrollHeight, behavior: "instant" as ScrollBehavior }));
  await Bun.sleep(1500);
  report.checks.push("[Ver a proposta]: the new note and the lines added to the main note");

  // 3. [Aplicar]: as duas notas escritas, e o [Desfazer] no balão.
  await q.locator(".kn-proposal-big button:has-text('Aplicar')").click();
  await q.waitForSelector(".kn-proposal-bubble button:has-text('Desfazer')", { timeout: 15000 });
  const after = await note("Projetos/Migração/Migração.md");
  assert.ok(after.includes("- [ ] Pedir o acesso ao bucket\n- [ ] Confirmar a janela de manutenção"), after);
  assert.ok((await note("Projetos/Migração/2026-11-11 · Cronograma da migração.md")).includes("## Decisões"));
  await cornerShot(q, ".kn-proposal-bubble", "3-aplicada.png");
  await Bun.sleep(1500);
  report.checks.push("[Aplicar] writes the meeting note and the main note, and the bubble offers [Desfazer]");
  await q.locator(".kn-proposal-bubble button:has-text('Desfazer')").click();
  await q.waitForFunction(() => document.querySelector(".kn-proposal-bubble")?.textContent?.includes("Desfeito"), undefined, { timeout: 15000 });
  assert.equal(await note("Projetos/Migração/Migração.md"), before, "o [Desfazer] volta a nota principal");
  report.checks.push("[Desfazer] restores the main note");
  await q.locator(".kn-proposal-bubble .kn-proposal-later").click();

  // 4. Dois projetos parecidos: a proposta pergunta com botões.
  await invoke("notes.create", { folder: "Projetos/VNA Fuji", title: "VNA Fuji", content: "# VNA Fuji\n" });
  await invoke("projects.mark", { folder: "Projetos/VNA Fuji" });
  await invoke("notes.create", { folder: "Reuniões", title: "2026-11-12 09h00 Zoom", content: meeting("2026-11-12", "09:00", "Bruno", "O VNA precisa do mesmo bucket da migração.") });
  await invoke("agent.ask", { text: "atualiza o projeto com a reunião que eu acabei de ter" });
  await idle();
  await q.waitForFunction(() => document.querySelector(".kn-proposal-bubble")?.textContent?.includes("É do"), undefined, { timeout: 30000 });
  const ask = (await q.locator(".kn-proposal-bubble").textContent()) ?? "";
  assert.ok(ask.includes("Migração") && ask.includes("VNA Fuji") && ask.includes("Nenhum: só a nota da reunião"), ask);
  await cornerShot(q, ".kn-proposal-bubble", "4-pergunta-projeto.png");
  await Bun.sleep(1500);
  report.checks.push("two similar projects: the bubble asks with a button for each, and 'Nenhum: só a nota da reunião'");
  report.problems.push(...h.report.problems);
  await h.close();

  // 5. A pergunta do modo econômico e a proposta em dúvida, na Atividade do agente. A pergunta vem do fim de uma
  // reunião (o helper de verdade); aqui ela entra direto no arquivo das propostas, como o serviço a grava.
  await invoke("notes.create", { folder: "Reuniões", title: "2026-11-12 14h00 Meet", content: meeting("2026-11-12", "14:00", "Carla", "Revisamos os laudos.") });
  const file = join(data, "agent", "proposals.json");
  const stored = JSON.parse(readFileSync(file, "utf8"));
  stored.proposals.push({
    id: "oferta-de-teste",
    at: Date.now(),
    request: "",
    meeting: { path: "Reuniões/2026-11-12 14h00 Meet.md", title: "2026-11-12 14h00 Meet", date: "2026-11-12" },
    project: null,
    candidates: [],
    fields: null,
    status: "offer",
  });
  writeFileSync(file, JSON.stringify(stored), { mode: 0o600 });
  const s = await openWindow(browser, ctx, { window: "hub", scale: 2, theme: "light", width: 900, height: 1400, motion: false, browser: "webkit", query: { section: "settings" } });
  const p = s.page;
  const list = ".kn-activity-proposals";
  await p.waitForSelector(list, { timeout: 15000 });
  const text = (await p.locator(list).textContent()) ?? "";
  assert.ok(text.includes("Preparar") && text.includes("Agora não") && text.includes("É do"), text);
  await p.locator(list).scrollIntoViewIfNeeded();
  await Bun.sleep(300);
  await p.locator(list).screenshot({ path: join(out, "5-atividade.png") });
  report.checks.push("Atividade do agente: the open proposals, the economy question ([Preparar] [Agora não]) and the project choice");

  // 6. "Suas reuniões" em Ajustes › Agente: tema · data, com a prévia, e sem o bloco Ações. A próxima proposta segue.
  const rows = ".kn-agent-meetings";
  await p.waitForSelector(rows, { timeout: 15000 });
  await p.locator(`${rows} [role=radiogroup][aria-label='O nome do arquivo'] button:has-text('tema · data')`).click();
  await p.waitForFunction((sel) => document.querySelector(sel)?.textContent?.includes("Prévia: Cronograma da migração · "), rows, { timeout: 15000 });
  await p.locator(`${rows} [role=switch][aria-label='Ações']`).click();
  await p.waitForSelector(`${rows} [role=switch][aria-label='Ações'][aria-checked=false]`);
  await p.locator(rows).scrollIntoViewIfNeeded();
  await Bun.sleep(300);
  await p.locator(rows).screenshot({ path: join(out, "6-suas-reunioes.png") });
  const m = (await invoke("agent.status")).meetings;
  assert.equal(m.name, "theme-date");
  assert.equal(m.blocks.actions, false);
  // A proposta da reunião das 14h00 (a pergunta do modo econômico sai, e a proposta toma o lugar dela).
  await invoke("agent.ask", { text: "atualiza o projeto com a reunião que eu acabei de ter" });
  await idle();
  const fresh = (await invoke("agent.proposals")).proposals.find((x: any) => x.meeting.title === "2026-11-12 14h00 Meet" && x.status === "pending");
  assert.ok(fresh, "a proposta da reunião das 14h00");
  await invoke("agent.proposalChoose", { id: fresh.id, folder: "Projetos/Migração" });
  const view = await invoke("agent.proposal", { id: fresh.id });
  assert.equal(view.note.title, "Cronograma da migração · 2026-11-12");
  assert.ok(view.noteContent.includes("## Decisões") && !view.noteContent.includes("## Ações"), view.noteContent);
  report.checks.push("Suas reuniões: the file name with a live preview and the summary blocks; the next proposal follows them");
  report.problems.push(...s.report.problems);
  await s.close();
  // O vídeo do balão em mp4 (o WebKit grava em webm).
  const webm = [...new Bun.Glob("*.webm").scanSync(videoDir)][0];
  if (webm) {
    const ff = Bun.spawnSync(["ffmpeg", "-y", "-loglevel", "error", "-i", join(videoDir, webm), "-vf", "scale=980:-2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", join(out, "reuniao-projeto.mp4")]);
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
