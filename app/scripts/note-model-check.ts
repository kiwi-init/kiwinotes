// O Modelo de nota (spec #11102, T11223): a tela em Ajustes › Agente, o AppEngine headless de verdade e o agente
// falso, num WebKit headless. Nunca abre janela nativa nem chama o macOS. Prints e vídeo na pasta do argumento.
//
//   bun scripts/note-model-check.ts [pasta]
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Page } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";
import { fakeRegistry } from "../src/agent/fake/registry";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T11223-note-model"));
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-note-model-"));
const vault = join(data, "vault");
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
const editor = ".kn-nm";
const order = (p: Page) => p.locator(`${editor} .kn-nm-block`).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.block));
const drawing = (p: Page) => p.locator(`${editor} .kn-nm-part`).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.part));
const shot = async (p: Page, file: string) => {
  await p.locator(editor).scrollIntoViewIfNeeded();
  await Bun.sleep(250);
  await p.locator(editor).screenshot({ path: join(out, file) });
};

const browser = await webkit.launch({ headless: true });
const report: { checks: string[]; problems: string[] } = { checks: [], problems: [] };
try {
  await cli(["start", "--no-helper"]);
  await invoke("agent.enable", { consent: true });
  await invoke("agent.download");
  for (let n = 0; (await invoke("agent.status")).adapter.phase !== "ready"; n++) { assert.ok(n < 200); await Bun.sleep(100); }
  assert.equal((await invoke("agent.noteModel")).saved, false, "o cofre começa sem o arquivo do modelo");

  const videos = join(out, "video-tmp");
  const w = await openWindow(browser, ctx, { window: "hub", scale: 2, theme: "light", width: 980, height: 1500, motion: true, browser: "webkit", query: { section: "settings" }, video: videos });
  const p = w.page;

  // 1. A primeira vez: a tela aberta, depois do Testar, com "Pular"; o desenho é só forma, sem texto.
  await p.waitForSelector(`${editor}[data-first]`, { timeout: 20000 });
  assert.deepEqual(await order(p), ["titulo", "propriedades", "introducao", "sumario", "corpo", "fechamento"]);
  assert.deepEqual(await drawing(p), ["titulo", "propriedades", "introducao", "sumario", "corpo", "fechamento"]);
  assert.equal(((await p.locator(`${editor} .kn-nm-page`).textContent()) ?? "").trim(), "", "o desenho não tem texto");
  assert.ok(await p.locator(`${editor} button:has-text('Pular')`).isVisible());
  await shot(p, "1-primeira-vez-claro.png");
  report.checks.push("first time: the screen is open after Testar, with Pular; the drawing is shapes only, with no text");

  // 2. Arrastar: a introdução para o começo; o desenho segue a ordem, e o arquivo também.
  await p.locator(`${editor} .kn-nm-block[data-block=introducao]`).dragTo(p.locator(`${editor} .kn-nm-block[data-block=titulo]`));
  await p.waitForFunction(() => (document.querySelector(".kn-nm .kn-nm-block") as HTMLElement | null)?.dataset.block === "introducao");
  assert.deepEqual((await drawing(p)).slice(0, 2), ["introducao", "titulo"]);
  // Pelo teclado também: o fechamento sobe um lugar com o botão (Tab chega nele).
  await p.locator(`${editor} button[aria-label='Subir Fechamento']`).focus();
  await p.keyboard.press("Enter");
  await p.waitForFunction(() => [...document.querySelectorAll(".kn-nm .kn-nm-block")].map((e) => (e as HTMLElement).dataset.block).at(-1) === "corpo");
  report.checks.push("blocks drag (mouse) and move (keyboard), and the drawing follows the order");

  // 3. Desligar o sumário: some do desenho.
  await p.locator(`${editor} .kn-nm-block[data-block=sumario] [role=switch]`).click();
  await p.waitForFunction(() => !document.querySelector(".kn-nm .kn-nm-part[data-part=sumario]"));
  report.checks.push("a block switched off leaves the drawing");

  // 4. Os quatro estilos do corpo, cada um com a miniatura; escolher muda o desenho grande na hora.
  assert.equal(await p.locator(`${editor} .kn-nm-body-choice .kn-nm-thumb`).count(), 4);
  const bodyLook = () => p.locator(`${editor} .kn-nm-part[data-part=corpo] .kn-nm-dot`).count();
  await p.locator(`${editor} .kn-nm-body-choice[data-style=longos]`).click();
  await p.waitForFunction(() => !document.querySelector(".kn-nm .kn-nm-part[data-part=corpo] .kn-nm-dot"));
  await p.locator(`${editor} .kn-nm-body-choice[data-style=topicos]`).click();
  await p.waitForFunction(() => document.querySelectorAll(".kn-nm .kn-nm-part[data-part=corpo] .kn-nm-dot").length >= 5);
  assert.ok((await bodyLook()) >= 5);
  await shot(p, "2-montado-claro.png");
  report.checks.push("the four body styles have their thumbnail, and picking one changes the big drawing at once");

  // 5. O arquivo do cofre segue a tela, e "Pronto" fecha a primeira vez.
  await p.locator(`${editor} button:has-text('Pronto')`).click();
  await p.waitForSelector(`${editor}[data-first]`, { state: "detached" });
  const file = readFileSync(join(vault, ".kiwi", "modelo-de-nota.md"), "utf8");
  assert.ok(file.indexOf("- introducao: ligado") < file.indexOf("- titulo: ligado"));
  assert.ok(file.includes("- sumario: desligado"));
  assert.ok(file.includes("corpo: topicos"));
  report.checks.push("the model is saved in .kiwi/modelo-de-nota.md, readable; Pronto closes the first time");

  // 6. O agente segue o modelo: uma nota nova com o agente falso.
  await invoke("agent.ask", { text: "/nota-modelo Viagem" });
  await idle();
  const created = readdirSync(vault).find((f) => f.includes("Viagem"));
  assert.ok(created, "a nota foi criada");
  const note = readFileSync(join(vault, created!), "utf8");
  assert.ok(note.indexOf("Esta nota resume") < note.indexOf("# Viagem"), "a introdução antes do título");
  assert.ok(!note.includes("## Sumário"), "sem o sumário desligado");
  assert.ok(note.includes("- Primeira parte do assunto."), "o corpo em tópicos");
  report.checks.push("with the fake agent, a new note follows the model's order and blocks");

  // 7. Organizar uma pasta: o cartão pergunta quantas notas, e só segue com o clique.
  mkdirSync(join(vault, "Projetos"), { recursive: true });
  for (const n of ["A", "B", "C"]) writeFileSync(join(vault, "Projetos", `${n}.md`), `# ${n}\n\nTexto ${n}.\n`);
  const h = await openWindow(browser, ctx, { window: "hub", scale: 2, theme: "light", width: 900, height: 620, motion: true, browser: "webkit", query: { section: "about" } });
  await invoke("agent.ask", { text: '/tool notes_organize_folder {"folder":"Projetos"}' });
  await h.page.waitForSelector(".kn-confirm-item", { timeout: 20000 });
  assert.ok(((await h.page.locator(".kn-confirm-question").textContent()) ?? "").includes("Organizar 3 notas em Projetos/"));
  await h.page.locator(".kn-doubt").screenshot({ path: join(out, "3-confirmar-pasta.png") });
  await h.page.locator(".kn-confirm-item button:has-text('Agora não')").click();
  await idle();
  for (const n of ["A", "B", "C"]) assert.equal(readFileSync(join(vault, "Projetos", `${n}.md`), "utf8"), `# ${n}\n\nTexto ${n}.\n`);
  // De novo: a resposta não foi lembrada, o cartão pergunta outra vez.
  await invoke("agent.ask", { text: '/tool notes_organize_folder {"folder":"Projetos"}' });
  await h.page.waitForSelector(".kn-confirm-item", { timeout: 20000 });
  await h.page.locator(".kn-confirm-item button:has-text('Organizar')").click();
  await idle();
  report.checks.push("organizing a folder: the card asks how many notes and goes on only with the click; Agora não changes nothing, and the answer is not remembered");
  report.problems.push(...h.report.problems);
  await h.close();

  // 8. O escuro: Ajustes › Agente, com o editor aberto em "Mudar".
  report.problems.push(...w.report.problems);
  await w.close();
  const v = readdirSync(videos).find((f) => f.endsWith(".webm"));
  if (v) renameSync(join(videos, v), join(out, "modelo-de-nota.webm"));
  rmSync(videos, { recursive: true, force: true });
  const d = await openWindow(browser, ctx, { window: "hub", scale: 2, theme: "dark", width: 980, height: 1500, motion: false, browser: "webkit", query: { section: "settings" } });
  await d.page.locator("button:has-text('Mudar')").click();
  await d.page.waitForSelector(editor);
  assert.ok(!(await d.page.locator(`${editor}[data-first]`).count()), "depois do Pronto, a tela não é mais a da primeira vez");
  await shot(d.page, "4-escuro.png");
  report.checks.push("dark theme, with reduced motion: the editor behind Mudar");
  report.problems.push(...d.report.problems);
  await d.close();
  assert.ok(existsSync(join(vault, ".kiwi", "modelo-de-nota.md")));
  assert.deepEqual(report.problems, []);
  console.log(JSON.stringify({ ok: true, ...report }, null, 2));
} finally {
  await browser.close().catch(() => {});
  await cli(["stop"]).catch(() => {});
  registry.stop();
  rmSync(data, { recursive: true, force: true });
}
