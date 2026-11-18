// O menu do botão direito (spec #13385, T13775): quanto ele leva para abrir numa nota .md grande, e se ele existe e
// formata num .txt. As Notas de verdade, com o AppEngine headless e o cofre num tmp, num WebKit headless. Nada na tela
// de ninguém.
//
//   bun scripts/context-menu-check.ts [pasta]
//
// Sai na pasta: `medidas.json` e os prints `menu-md.png`, `menu-txt.png` e `menu-txt-escuro.png`. No Parágrafo, nos dois
// temas, confere a cascata dos títulos e os ícones (spec #17703).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Page } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T13775-menu"));
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-menu-"));
const vault = join(data, "vault");
mkdirSync(vault, { recursive: true });

/** A meta do spec #13385: o menu abre em até 100 ms numa nota .md grande. */
const OPEN_GOAL_MS = 100;
const OPENS = 12;

// Uma nota .md grande (~400 KB): títulos, listas, tabelas e callouts, como uma nota de projeto que cresceu.
let md = "# Projeto grande\n\n";
for (let i = 0; md.length < 400 * 1024; i++) {
  md += `## Seção ${i}\n\nO prazo do depósito ficou para março, e a mudança das caixas antigas começa depois do teste com a equipe.\n\n`;
  md += `- item ${i} da lista\n- outro item com **negrito** e [[Outra nota]]\n\n`;
  if (i % 10 === 0) md += `| a | b |\n|---|---|\n| ${i} | x |\n\n> [!note] Lembrete ${i}\n> texto do callout\n\n`;
}
writeFileSync(join(vault, "Grande.md"), md);
writeFileSync(join(vault, "Outra nota.md"), "# Outra nota\n");
const TXT = "Anotações da reunião\nmudar o legado até março\nrevisar os PRs abertos\n";
writeFileSync(join(vault, "anotacoes.txt"), TXT);

async function cli(args: string[]) {
  const p = Bun.spawn([process.execPath, join(app, "scripts/cli.ts"), ...args, "--data", data], { cwd: app, stdout: "pipe", stderr: "pipe" });
  const text = await new Response(p.stdout).text();
  assert.equal(await p.exited, 0, text + (await new Response(p.stderr).text()));
  return text;
}
const ctx: UiContext = {
  data,
  send: async (msg) => { const r = await request(data, msg); assert.ok(r); return r; },
  subscribe: async (topics, onMsg) => {
    const c = await connect(data, (l) => { if (!("id" in l)) onMsg(l); });
    assert.ok(c);
    c.write({ id: 0, cmd: "subscribe", topics, follow: true, backlog: false });
    return () => c.close();
  },
};

/** Do clique com o botão direito até o menu na tela (o quadro em que ele aparece). */
async function openTime(p: Page, target: string, at?: { x: number; y: number }): Promise<number> {
  const box = (await p.locator(target).boundingBox())!;
  await p.evaluate(() => {
    const w = window as unknown as { menuAt: number; menuT0: number };
    w.menuAt = 0;
    document.addEventListener("contextmenu", () => (w.menuT0 = performance.now()), { capture: true, once: true });
    const mo = new MutationObserver(() => {
      if (document.querySelector(".kn-menu")) {
        requestAnimationFrame(() => (w.menuAt = performance.now() - w.menuT0));
        mo.disconnect();
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  });
  await p.mouse.click(box.x + (at?.x ?? box.width / 2), box.y + (at?.y ?? Math.min(box.height / 2, 200)), { button: "right" });
  const opened = await p.waitForFunction(() => (window as unknown as { menuAt: number }).menuAt > 0, undefined, { timeout: 3000 }).then(() => true, () => false);
  // Sem menu: -1 (no .txt da main, o botão direito não abre nada).
  return opened ? p.evaluate(() => (window as unknown as { menuAt: number }).menuAt) : -1;
}

/** Escolhe um item do menu aberto pelo caminho ("Parágrafo", "Título 1"). */
async function choose(p: Page, ...path: string[]) {
  for (const label of path) {
    const item = p.locator(".kn-menu .kn-menu-item", { has: p.locator(".kn-menu-label", { hasText: new RegExp(`^${label}$`) }) }).last();
    await item.hover();
    await item.click();
  }
}

/**
 * O Parágrafo aberto (spec #17703, T18385): o tamanho e o peso de cada rótulo, o ícone, e a largura do submenu. Os
 * títulos descem do 1 ao 6, as listas, a citação e o marcar tarefa têm ícone, e o submenu não fica largo demais.
 */
async function paragraphLook(p: Page, theme: string) {
  const look = await p.evaluate(() => {
    const menu = [...document.querySelectorAll<HTMLElement>(".kn-menu")].at(-1)!;
    const items = [...menu.querySelectorAll<HTMLElement>(".kn-menu-item")].map((row) => {
      const label = row.querySelector<HTMLElement>(".kn-menu-label")!;
      const cs = getComputedStyle(label);
      const icon = row.querySelector<SVGElement>("svg.kn-menu-icon");
      return { label: label.textContent, size: parseFloat(cs.fontSize), weight: cs.fontWeight, icon: icon?.dataset.icon ?? null,
        iconColor: icon ? getComputedStyle(icon).color : null, h: row.getBoundingClientRect().height };
    });
    return { width: Math.round(menu.getBoundingClientRect().width), items };
  });
  const titles = look.items.filter((it) => it.label?.startsWith("Título"));
  const problems: string[] = [];
  if (titles.length !== 6 || titles.some((t, i) => i > 0 && t.size >= titles[i - 1]!.size)) problems.push(`os títulos não descem: ${titles.map((t) => t.size)}`);
  if (titles.some((t) => t.weight !== "600")) problems.push("título sem o peso 600");
  const corpo = look.items.find((it) => it.label === "Corpo");
  if (!corpo || corpo.weight === "600" || corpo.size > titles.at(-1)!.size) problems.push("o Corpo não está no normal");
  for (const [label, icon] of [["Lista", "bullet"], ["Lista numerada", "numbered"], ["Lista de tarefas", "task"], ["Citação", "quote"], ["Marcar tarefa", "check"]]) {
    if (look.items.find((it) => it.label === label)?.icon !== icon) problems.push(`${label} sem o ícone ${icon}`);
  }
  if (look.width > 280) problems.push(`o Parágrafo ficou largo: ${look.width} px`);
  return { theme, width: look.width, titles: titles.map((t) => t.size), icons: look.items.filter((it) => it.icon).map((it) => `${it.label}: ${it.icon} ${it.iconColor}`), problems };
}

const pct = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * q))]!;
const browser = await webkit.launch({ headless: true });
const result: Record<string, unknown> = {};
let ok = true;
try {
  await cli(["start", "--no-helper"]);

  // 1. O .md grande: o menu abre em até 100 ms.
  const m = await openWindow(browser, ctx, { window: "notes", scale: 2, theme: "light", width: 1000, height: 760, motion: true, browser: "webkit", query: { note: "Grande.md" } });
  await m.page.locator(".kn-note-editor .cm-content").waitFor({ timeout: 20000 });
  await Bun.sleep(500);
  const times: number[] = [];
  for (let i = 0; i < OPENS; i++) {
    // Cada clique num lugar diferente, como uma pessoa: o cursor anda até ali antes de o menu abrir.
    times.push(await openTime(m.page, ".kn-note-editor .cm-content", { x: 200, y: 120 + (i % 6) * 60 }));
    if (i === 0) await m.page.screenshot({ path: join(out, "menu-md.png") });
    await m.page.keyboard.press("Escape");
    await Bun.sleep(150);
  }
  if (times.some((x) => x < 0)) ok = false;
  result.mdTempos = times.map((x) => Math.round(x));
  result.md = { aberturas: times.length, mediana: Math.round(pct(times, 0.5)), pior: Math.round(Math.max(...times)), meta: OPEN_GOAL_MS };
  if (pct(times, 0.5) > OPEN_GOAL_MS || Math.max(...times) > OPEN_GOAL_MS * 1.5) ok = false;
  await m.close();

  // 2. O .txt: o mesmo menu, e a formatação entra como Markdown simples.
  for (const theme of ["light", "dark"] as const) {
    const t = await openWindow(browser, ctx, { window: "notes", scale: 2, theme, width: 1000, height: 640, motion: false, browser: "webkit", query: { note: "anotacoes.txt" } });
    const area = t.page.locator(".kn-file-text-area");
    await area.waitFor({ timeout: 20000 });
    const first = t.page.locator(".kn-file-text-area .cm-line").first();
    if (theme === "dark") {
      await openTime(t.page, ".kn-file-text-area .cm-line >> nth=0");
      await t.page.locator(".kn-menu .kn-menu-item", { hasText: "Parágrafo" }).hover();
      await Bun.sleep(200);
      const look = await paragraphLook(t.page, theme);
      result.paragrafoEscuro = look;
      if (look.problems.length) ok = false;
      await t.page.screenshot({ path: join(out, "menu-txt-escuro.png") });
      await t.close();
      continue;
    }
    // Título na 1ª linha.
    await first.click();
    result.txtAbre = (await openTime(t.page, ".kn-file-text-area .cm-line >> nth=0")) >= 0;
    if (!result.txtAbre) {
      ok = false;
      await t.close();
      break;
    }
    result.txtMenu = await t.page.locator(".kn-menu .kn-menu-item").allTextContents();
    await t.page.locator(".kn-menu .kn-menu-item", { hasText: "Parágrafo" }).hover();
    await Bun.sleep(200);
    const look = await paragraphLook(t.page, theme);
    result.paragrafo = look;
    if (look.problems.length) ok = false;
    await t.page.screenshot({ path: join(out, "menu-txt.png") });
    await choose(t.page, "Título 1");
    // Lista na 2ª linha.
    await t.page.locator(".kn-file-text-area .cm-line").nth(1).click();
    await openTime(t.page, ".kn-file-text-area .cm-line >> nth=1");
    await choose(t.page, "Parágrafo", "Lista");
    // Negrito numa palavra da 3ª linha (duplo clique seleciona a palavra).
    await t.page.locator(".kn-file-text-area .cm-line").nth(2).dblclick({ position: { x: 20, y: 8 } });
    // O botão direito em cima da palavra selecionada: a seleção fica.
    await openTime(t.page, ".kn-file-text-area .cm-line >> nth=2", { x: 20, y: 8 });
    await choose(t.page, "Formatar", "Negrito");
    await t.page.waitForSelector(".kn-file-text[data-save='saved']", { timeout: 5000 });
    const disk = readFileSync(join(vault, "anotacoes.txt"), "utf8");
    result.txtDepois = disk;
    const want = "# Anotações da reunião\n- mudar o legado até março\n**revisar** os PRs abertos\n";
    result.txtFormata = disk === want;
    if (disk !== want) ok = false;
    await t.close();
  }
} finally {
  await browser.close();
  await cli(["stop"]).catch(() => {});
  rmSync(data, { recursive: true, force: true });
}
result.ok = ok;
writeFileSync(join(out, "medidas.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
process.exit(ok ? 0 : 1);
