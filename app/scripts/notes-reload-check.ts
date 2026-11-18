// T20167 (spec #20118): a janela das Notas recarrega uma vez só por operação, e as fixadas acompanham o que o engine
// corrige, venha de onde vier. Headless (WebKit), nada na tela; o cofre é inventado (spec #17952).
//
// - renomear uma nota, criar e renomear uma pasta, apagar e desfazer pela janela: uma `notes.list` por operação (antes
//   eram duas: o `after()` e o `notes.changed` da mesma operação);
// - o agente (a capacidade direta no engine) renomeia uma nota fixada: as Fixadas mostram o nome novo, sem a janela
//   fazer nada (o `settings.changed` traz as fixadas corrigidas);
// - a rolagem da árvore fica onde estava depois de renomear uma pasta.
//
//   bun scripts/notes-reload-check.ts [pasta dos prints]
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Page } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T20167"));
mkdirSync(out, { recursive: true });

const data = mkdtempSync(join(tmpdir(), "kiwi-T20167-"));
const vault = join(data, "vault");
for (let a = 1; a <= 8; a++) for (let b = 1; b <= 6; b++) {
  const dir = join(vault, `Área ${a}`, `Grupo ${b}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "Nota.md"), `# Nota\n\nTexto de exemplo ${a}.${b}.\n`);
}
mkdirSync(join(vault, "Projeto X"), { recursive: true });
writeFileSync(join(vault, "Projeto X", "Plano.md"), "# Plano\n\nAna escreve aqui.\n");
for (const n of ["Ideias", "Lista", "Rascunho"]) writeFileSync(join(vault, `${n}.md`), `# ${n}\n\nTexto de exemplo.\n`);

async function cli(args: string[]) {
  const p = Bun.spawn([process.execPath, join(app, "scripts/cli.ts"), ...args, "--data", data], { cwd: app, stdout: "pipe", stderr: "pipe" });
  const text = await new Response(p.stdout).text();
  assert.equal(await p.exited, 0, text + (await new Response(p.stderr).text()));
}

const calls: string[] = [];
let inflight = 0;
const ctx: UiContext = {
  data,
  send: async (msg) => {
    inflight++;
    const r = await request(data, msg).finally(() => inflight--);
    assert.ok(r);
    if (msg.cmd === "invoke") calls.push(String(msg.cap));
    return r;
  },
  subscribe: async (topics, onMsg) => {
    const c = await connect(data, (line) => { if (!("id" in line)) onMsg(line); });
    assert.ok(c);
    c.write({ id: 0, cmd: "subscribe", topics, follow: true, backlog: false });
    return () => c.close();
  },
};
async function invoke(cap: string, args: unknown = {}) {
  const r = await request(data, { cmd: "invoke", cap, args });
  assert.equal(r?.ok, true, JSON.stringify(r));
  return r!.value as any;
}
/** Até a janela parar de pedir: nenhum invoke novo por 700 ms. */
async function quiet() {
  for (let last = -1; last !== calls.length || inflight; ) {
    last = calls.length;
    await Bun.sleep(700);
  }
}
/** As `notes.list` que a janela pediu durante `act`. */
async function lists(act: () => Promise<void>) {
  await quiet();
  const from = calls.length;
  await act();
  await quiet();
  return calls.slice(from).filter((c) => c === "notes.list").length;
}

const TREE = ".kn-tree-pop";
async function openTree(p: Page) {
  if (!(await p.locator(`${TREE}:visible`).count())) await p.click(".kn-crumb-bt");
  await p.waitForSelector(`${TREE}:visible .kn-side-item`);
  await Bun.sleep(250);
}
const item = (kind: "note" | "folder", path: string) => `${TREE} .kn-side-item[data-kind='${kind}'][data-path='${path}']`;
async function menu(p: Page, target: string, label: string) {
  await openTree(p);
  await p.locator(target).first().click({ button: "right" });
  await p.locator(`.kn-menu .kn-menu-item:has-text('${label}')`).first().click();
}
async function rename(p: Page, target: string, name: string) {
  await menu(p, target, "Renomear");
  await p.locator(".kn-side-rename").fill(name);
  await p.locator(".kn-side-rename").press("Enter");
}
/** Os caminhos na seção Fixadas, na ordem. */
const pinnedInTree = (p: Page) =>
  p.evaluate((tree) => {
    const head = document.querySelector(`${tree} .kn-side-head[data-section='pinned']`);
    const got: string[] = [];
    for (let el = head?.nextElementSibling; el && !el.classList.contains("kn-side-gap"); el = el.nextElementSibling) {
      const path = (el as HTMLElement).dataset.path ?? el.querySelector<HTMLElement>("[data-path]")?.dataset.path;
      if (path) got.push(path);
    }
    return got;
  }, TREE);
const scrollTop = (p: Page) => p.evaluate((tree) => document.querySelector(`${tree} .kn-side`)?.scrollTop ?? -1, TREE);

const browser = await webkit.launch({ headless: true });
const checks: string[] = [];
try {
  await cli(["start", "--no-helper"]);
  await invoke("settings.set", { pinned: ["Projeto X/Plano.md", "Ideias.md"] });
  const w = await openWindow(browser, ctx, { window: "notes", scale: 2, theme: "light", width: 1100, height: 760, motion: false, browser: "webkit", query: {} });
  const p = w.page;
  try {
    await p.waitForSelector(".kn-crumb-bt");
    await openTree(p);
    assert.deepEqual(await pinnedInTree(p), ["Projeto X/Plano.md", "Ideias.md"]);

    assert.equal(await lists(() => rename(p, item("note", "Lista.md"), "Lista dois")), 1, "renomear nota: uma lista");
    await p.waitForSelector(item("note", "Lista dois.md"));
    checks.push("renomear uma nota pela janela: 1 notes.list (eram 2)");

    assert.equal(await lists(async () => { await openTree(p); await p.locator(`${TREE} .kn-side-new[data-new='folder']`).first().click(); await p.keyboard.press("Escape"); }), 1, "criar pasta: uma lista");
    checks.push("criar uma pasta: 1 notes.list (eram 2)");

    assert.equal(await lists(() => menu(p, item("note", "Rascunho.md"), "Apagar")), 1, "apagar: uma lista");
    assert.equal(await lists(async () => { await p.click(".kn-toast button:has-text('Desfazer')"); }), 1, "desfazer: uma lista");
    checks.push("apagar uma nota e desfazer: 1 notes.list cada (eram 2)");

    // A rolagem: abre duas áreas, desce até o meio e renomeia uma pasta que está à vista.
    await openTree(p);
    for (const a of ["Área 3", "Área 4"]) {
      await p.evaluate((sel) => (document.querySelector(sel) as HTMLElement).click(), item("folder", a));
      await p.waitForSelector(`${item("folder", a)}[aria-expanded='true']`);
    }
    await p.evaluate((tree) => { const s = document.querySelector(`${tree} .kn-side`); if (s) s.scrollTop = 200; }, TREE);
    await Bun.sleep(200);
    const top = await scrollTop(p);
    assert.ok(top > 0, "a árvore tem rolagem");
    const folderLists = await lists(() => rename(p, item("folder", "Área 4/Grupo 2"), "Grupo dois"));
    await p.waitForSelector(item("folder", "Área 4/Grupo dois"));
    assert.ok(folderLists <= 2, `renomear pasta: ${folderLists} listas`);
    assert.equal(await scrollTop(p), top, "a rolagem não pulou");
    checks.push(`renomear uma pasta: ${folderLists} notes.list (eram 4; o que sobra é o eco do watcher no engine), e a rolagem fica em ${top}`);

    // O agente renomeia uma nota fixada direto no engine: as Fixadas acompanham sem a janela fazer nada.
    await invoke("notes.rename", { path: "Projeto X/Plano.md", newPath: "Projeto X/Plano novo.md" });
    for (let n = 0; (await pinnedInTree(p))[0] !== "Projeto X/Plano novo.md"; n++) {
      assert.ok(n < 50, `as Fixadas não acompanharam: ${JSON.stringify(await pinnedInTree(p))}`);
      await Bun.sleep(100);
    }
    assert.deepEqual(await pinnedInTree(p), ["Projeto X/Plano novo.md", "Ideias.md"]);
    await p.evaluate((tree) => { const s = document.querySelector(`${tree} .kn-side`); if (s) s.scrollTop = 0; }, TREE);
    await Bun.sleep(300);
    await p.screenshot({ path: join(out, "01-fixada-renomeada-pelo-agente.png") });
    checks.push("o agente renomeia uma nota fixada: as Fixadas mostram o nome novo (pelo settings.changed)");
    assert.deepEqual(w.report.problems, [], "problemas na página");
  } finally {
    await w.close();
  }
  spawnSync("cwebp", ["-quiet", "-q", "85", join(out, "01-fixada-renomeada-pelo-agente.png"), "-o", join(out, "01-fixada-renomeada-pelo-agente.webp")]);
  for (const c of checks) console.log(`ok  ${c}`);
  console.log(`os prints em ${out}`);
} finally {
  await browser.close();
  await cli(["stop"]).catch(() => {});
}
