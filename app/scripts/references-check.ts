// As referências (spec #11908, T11986–T11988): a permissão "Pesquisar na web" em Ajustes › Agente (desligada nega a busca
// do agente; ligada libera, e o balão diz "Pesquisando na web…"), e a seção "Referências" que o Kiwi monta com os links
// que o agente manda, com [Ver] [Aplicar] [Descartar] e [Desfazer]. No hub de verdade, com o AppEngine headless e o
// agente falso, num WebKit headless. A nota é de teste, num tmp; o agente falso nunca vai à rede; nada na tela de ninguém.
//
//   bun scripts/references-check.ts [pasta]
//
// Sai na pasta: `referencias.webp` (a folha com os prints) e `referencias.mp4` (o vídeo do balão).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Page } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";
import { fakeRegistry } from "../src/agent/fake/registry";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T11908-references"));
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-references-"));
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
    // A busca do agente falso demora um pouco, para o balão "Pesquisando na web…" aparecer no print.
    env: { ...process.env, KIWI_FAKE_AGENT: "1", KIWI_FAKE_AGENT_TOOL_DELAY_MS: "2500", KIWI_ADAPTER_REGISTRY: registry.url, KIWI_ADAPTER_PACKAGES: packages },
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
/** O texto da resposta de um pedido (o `done` do `agent.turn`, pelos eventos da CLI). */
async function answerOf(id: string): Promise<string> {
  for (const end = Date.now() + 30_000; ; ) {
    const done = (await cli(["events"])).split("\n").find((l) => l.includes('"agent.turn"') && l.includes(`"${id}"`) && /"type":"(done|error)"/.test(l));
    if (done) return (JSON.parse(done.slice(done.indexOf("{"))).payload?.text as string) ?? "";
    assert.ok(Date.now() < end, `o pedido ${id} não terminou`);
    await Bun.sleep(200);
  }
}

const NOTE = "Projetos/PACS/PACS.md";
const TEXT = "# PACS\n\nA migração do arquivo antigo para o PACS novo.\n\n## Referências\n\n- [DICOMweb](https://www.dicomstandard.org/using/dicomweb/): o padrão (já estava)\n";

const shots: { file: string; caption: string }[] = [];
async function cornerShot(p: Page, sel: string, file: string, caption: string) {
  await Bun.sleep(300);
  const b = await p.locator(sel).first().boundingBox();
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
  await invoke("notes.create", { folder: "Projetos/PACS", title: "PACS", content: TEXT });
  await invoke("agent.enable", { consent: true });
  // O onboarding (spec #11955) abre na primeira vez que o agente liga e cobre o hub: aqui ele já foi feito.
  await invoke("agent.configure", { onboarding: { state: "done" } });
  await invoke("agent.download");
  for (let n = 0; (await invoke("agent.status")).adapter.phase !== "ready"; n++) { assert.ok(n < 200); await Bun.sleep(100); }

  // 1. Ajustes › Agente: "Pesquisar na web" nasce desligado, e a busca do agente é negada.
  const s = await openWindow(browser, ctx, { window: "hub", scale: 2, theme: "light", width: 900, height: 1800, motion: false, browser: "webkit", query: { section: "settings", topic: "agent" } });
  const sw = "[role=switch][aria-label='Pesquisar na web']";
  await s.page.waitForSelector(sw, { timeout: 15000 });
  assert.equal(await s.page.locator(sw).getAttribute("aria-checked"), "false");
  assert.equal((await invoke("agent.status")).webSearch, false);
  const off = await answerOf((await invoke("agent.ask", { text: "/web documentação do DICOMweb" })).id);
  assert.equal(off, "web negada: a busca não aconteceu.");
  await idle();
  const row = s.page.locator(`.kn-row:has(${sw})`).first();
  await row.scrollIntoViewIfNeeded();
  await Bun.sleep(300);
  await row.screenshot({ path: join(out, "1-desligado.png") });
  shots.push({ file: "1-desligado.png", caption: "1. \"Pesquisar na web\" nasce desligado: o Kiwi nega a busca do agente" });
  report.checks.push("Pesquisar na web is off by default, and the agent's web search is denied");
  // Ligado pela tela.
  await s.page.locator(sw).click();
  await s.page.waitForSelector(`${sw}[aria-checked=true]`, { timeout: 15000 });
  assert.equal((await invoke("agent.status")).webSearch, true);
  await Bun.sleep(300);
  await row.screenshot({ path: join(out, "2-ligado.png") });
  shots.push({ file: "2-ligado.png", caption: "2. Ligado: o texto diz o que muda, e o Kiwi não chama nenhum serviço" });
  report.problems.push(...s.report.problems);
  await s.close();

  // 2. O balão do gato: "Pesquisando na web…" enquanto o agente busca.
  const videoDir = join(out, "video");
  const h = await openWindow(browser, ctx, { window: "hub", scale: 2, theme: "light", width: 980, height: 760, motion: false, browser: "webkit", query: { section: "about" }, video: videoDir });
  const q = h.page;
  await q.waitForSelector('.kn-kiwicat[data-ready="true"]', { timeout: 15000 });
  // O hub à vista (o WebKit headless não tem foco de janela): o gato fica no canto, com o balão, e não vai ao overlay.
  assert.equal((await ctx.send({ cmd: "hubView", view: true })).ok, true);
  const { id } = await invoke("agent.ask", { text: "/web documentação do DICOMweb" });
  // A linha inteira, já digitada.
  await q.waitForFunction(() => [...document.querySelectorAll(".kn-bubble-typed")].some((e) => e.textContent?.includes("Pesquisando na web…")), undefined, { timeout: 15000 });
  await cornerShot(q, ".kn-bubble", "3-na-web.png", "3. O balão diz que o agente está na web");
  assert.equal(await answerOf(id), "busquei na web: documentação do DICOMweb");
  await idle();
  report.checks.push("with the permission on, the search is allowed and the cat's bubble says Pesquisando na web…");

  // 3. As referências: o balão com [Ver] [Aplicar] [Descartar]; nada escrito antes.
  const before = await note(NOTE);
  await invoke("agent.ask", { text: `/referencias ${NOTE}` });
  await idle();
  await q.waitForFunction(() => document.querySelector(".kn-proposal-bubble")?.textContent?.includes("As referências de"), undefined, { timeout: 30000 });
  assert.equal(await note(NOTE), before, "nada escrito antes do [Aplicar]");
  const bubble = (await q.locator(".kn-proposal-bubble").textContent()) ?? "";
  assert.ok(bubble.includes("1 link no fim da nota") && bubble.includes("Aplicar") && bubble.includes("Descartar"), bubble);
  await q.locator(".kn-proposal-bubble button:has-text('Ver a proposta')").click();
  await q.waitForSelector(".kn-proposal-big .kn-proposal-view", { timeout: 15000 });
  const big = (await q.locator(".kn-proposal-big").textContent()) ?? "";
  assert.ok(big.includes("cloud.google.com") && big.includes("As referências, no fim de"), big);
  await cornerShot(q, ".kn-proposal-big", "4-ver.png", "4. [Ver]: o link novo no fim da seção; o que já estava não se repete");
  report.checks.push("notes_add_references: the proposal shows only the new link, at the end of the Referências section");

  // 4. [Aplicar] escreve; [Desfazer] volta a nota.
  await q.locator(".kn-proposal-big button:has-text('Aplicar')").click();
  await q.waitForSelector(".kn-proposal-bubble button:has-text('Desfazer')", { timeout: 15000 });
  const after = await note(NOTE);
  assert.ok(after.startsWith(TEXT) && after.includes("](https://cloud.google.com/healthcare-api/docs/concepts/dicom): Os dicomStores"), after);
  assert.equal(after.match(/dicomstandard\.org/g)?.length, 1, "o DICOMweb não se repete");
  await cornerShot(q, ".kn-proposal-bubble", "5-aplicado.png", "5. [Aplicar]: a linha entra na nota, com [Desfazer]");
  await q.locator(".kn-proposal-bubble button:has-text('Desfazer')").click();
  await q.waitForFunction(() => document.querySelector(".kn-proposal-bubble")?.textContent?.includes("Desfeito"), undefined, { timeout: 15000 });
  assert.equal(await note(NOTE), before, "o [Desfazer] volta a nota");
  await Bun.sleep(1200);
  report.checks.push("[Aplicar] writes the new line, and [Desfazer] restores the note");
  report.problems.push(...h.report.problems);
  await h.close();

  // A folha em WebP e o vídeo em mp4.
  const sheet = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 1600, height: 900 } });
  const img = (f: string) => `data:image/png;base64,${readFileSync(join(out, f)).toString("base64")}`;
  await sheet.setContent(
    `<body style="margin:0;padding:24px;background:#eceae4;font:600 22px -apple-system,sans-serif;color:#222">` +
      `<h1 style="margin:0 0 16px;font-size:30px">Referências: a web do agente e os links na nota (spec #11908)</h1>` +
      `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:20px;align-items:start">` +
      shots.map((x) => `<figure style="margin:0"><figcaption style="margin-bottom:8px">${x.caption}</figcaption><img src="${img(x.file)}" style="width:100%;border-radius:10px;box-shadow:0 1px 4px #0003"></figure>`).join("") +
      `</div></body>`,
  );
  await Bun.sleep(300);
  await sheet.screenshot({ path: join(out, "folha.png"), fullPage: true });
  await sheet.close();
  const webp = Bun.spawnSync(["cwebp", "-quiet", "-q", "80", join(out, "folha.png"), "-o", join(out, "referencias.webp")]);
  if (webp.exitCode !== 0) report.problems.push(`cwebp: ${webp.stderr.toString()}`);
  const webm = [...new Bun.Glob("*.webm").scanSync(videoDir)][0];
  if (webm) {
    const ff = Bun.spawnSync(["ffmpeg", "-y", "-loglevel", "error", "-i", join(videoDir, webm), "-vf", "scale=980:-2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", join(out, "referencias.mp4")]);
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
