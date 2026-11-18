// A nota não muda de cara quando a pessoa clica para escrever (spec #17690, T17785): com o cursor dentro e fora de um
// item de lista e do título, as linhas ficam no mesmo lugar (a mesma altura e o mesmo recuo), os outros itens continuam
// desenhados, sem `**`, `[[ ]]` nem `- ` à mostra, e digitar `- ` e `**` no começo de uma linha ainda forma a lista e o
// negrito. As Notas de verdade, com o AppEngine headless e uma nota inventada num tmp, num WebKit headless. Nada na
// tela de ninguém.
//
//   bun scripts/editor-jump-check.ts [pasta]
//
// Sai na pasta: `medidas.json` e os prints `0-sem-foco.png`, `1-cursor-fora.png` (no parágrafo de antes da lista),
// `2-cursor-no-item.png` (no "banana"), `3-cursor-no-negrito.png` (no "maçã"), `4-seta-para-baixo.png` e
// `4b-seta-para-cima.png` (as setas andam item a item),
// `5-cursor-no-titulo.png`, `6-cursor-depois.png` e `7-digitado.png`. A posição de cada palavra vem de um `Range` no
// texto da página: não importa se a linha está desenhada pela lib ou pelas decorações do editor.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Page } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T17785-editor"));
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-editor-jump-"));
const vault = join(data, "vault");
mkdirSync(vault, { recursive: true });

// Uma nota inventada: um parágrafo, um título, uma lista com negrito e um link, e outro parágrafo.
const NOTE = "Compras.md";
const ITEMS = ["- **maçã** verde e **pera** madura", "- banana da [[Feira]]", "- cereja e **uva** roxa"];
writeFileSync(
  join(vault, NOTE),
  ["Um parágrafo antes da lista.", "", "## Frutas da semana", "", ...ITEMS, "", "Depois da lista, um parágrafo que não pode pular.", ""].join("\n"),
);
/** As palavras medidas, e a linha do `.md` de cada uma (o cursor numa delas mexe só a própria linha). */
const PROBES: Record<string, number> = { antes: 0, Frutas: 2, maçã: 4, pera: 4, banana: 5, Feira: 5, cereja: 6, uva: 6, Depois: 8 };
/** Quanto uma palavra pode andar, em px: o arredondamento do WebKit, e nada mais. */
const TOLERANCE = 1;

async function cli(args: string[]) {
  const p = Bun.spawn([process.execPath, join(app, "scripts/cli.ts"), ...args, "--data", data], { cwd: app, stdout: "pipe", stderr: "pipe" });
  const text = await new Response(p.stdout).text();
  assert.equal(await p.exited, 0, text + (await new Response(p.stderr).text()));
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

interface Spot {
  x: number;
  y: number;
  h: number;
  /** O texto à mostra da linha da palavra (o item, o parágrafo, o título), sem o que está escondido. */
  line: string;
  /** O peso da fonte na palavra. */
  weight: number;
}

/**
 * Onde cada palavra está na tela: a primeira vez que ela aparece no texto do editor, por um `Range` só nela. A linha é
 * o bloco mais perto em volta (o `li`, o `p`, o título desenhado, ou a `.cm-line` crua).
 */
async function measure(p: Page, words: string[]): Promise<Record<string, Spot | null>> {
  return p.evaluate((words) => {
    const root = document.querySelector(".kn-note-editor .cm-content")!;
    // Do canto do texto do editor: rolar a página ou mudar o que está em cima dele não conta como pulo.
    const origin = root.getBoundingClientRect();
    const visible = (n: Node) => {
      const el = n.parentElement;
      if (!el) return false;
      const s = getComputedStyle(el);
      return s.display !== "none" && s.visibility !== "hidden" && el.getClientRects().length > 0;
    };
    const out: Record<string, unknown> = {};
    for (const w of words) {
      out[w] = null;
      const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = it.nextNode(); n; n = it.nextNode()) {
        const at = n.textContent!.indexOf(w);
        if (at < 0 || !visible(n)) continue;
        const r = document.createRange();
        r.setStart(n, at);
        r.setEnd(n, at + w.length);
        const box = r.getBoundingClientRect();
        if (!box.width) continue;
        const block = n.parentElement!.closest("li, p, h1, h2, h3, h4, h5, h6, .cm-line") as HTMLElement | null;
        out[w] = { x: box.left - origin.left, y: box.top - origin.top, h: box.height, line: (block?.innerText ?? "").replace(/\u200b/g, "").trim(), weight: Number(getComputedStyle(n.parentElement!).fontWeight) || 400 };
        break;
      }
    }
    return out;
  }, words) as Promise<Record<string, Spot | null>>;
}

/** Dois quadros e um respiro: o editor redesenha as decorações um quadro depois da seleção. */
async function settle(p: Page) {
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await Bun.sleep(200);
}

interface Cursor {
  /** A linha do `.md`, a partir de 1. */
  line: number;
  /** A coluna do cursor na linha, a partir de 0. */
  col: number;
  text: string;
}

/**
 * Onde está o cursor no `.md`, pelo próprio editor: a `EditorView` que o CodeMirror pendura no DOM (`cmTile.root.view`,
 * o que o `EditorView.findFromDOM` lê; a página não importa módulos).
 */
async function cursorAt(p: Page): Promise<Cursor | null> {
  return p.evaluate(() => {
    const dom = document.querySelector(".kn-note-editor .cm-content") as unknown as { cmTile?: { root?: { view?: { state: { doc: { lineAt(n: number): { number: number; from: number; text: string } }; selection: { main: { head: number } } } } } } };
    const view = dom.cmTile?.root?.view;
    if (!view) return null;
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head);
    return { line: line.number, col: head - line.from, text: line.text };
  });
}

/** O cursor está dentro da palavra (do começo ao fim dela, na primeira vez que ela aparece na linha). */
function insideWord(c: Cursor | null, word: string): boolean {
  if (!c) return false;
  const at = c.text.indexOf(word);
  return at >= 0 && c.col >= at && c.col <= at + word.length;
}

/** Clica no meio da palavra, como a pessoa faz para escrever ali. */
async function clickWord(p: Page, word: string) {
  const s = (await measure(p, [word]))[word];
  assert.ok(s, `a palavra "${word}" não está na tela`);
  const origin = (await p.locator(".kn-note-editor .cm-content").boundingBox())!;
  await p.mouse.click(origin.x + s.x + Math.min(6, s.h / 3), origin.y + s.y + s.h / 2);
  await settle(p);
}

const result: Record<string, unknown> = {};
let ok = true;
const check = (name: string, cond: boolean, detail?: unknown) => {
  (result.checks as Record<string, unknown>)[name] = detail === undefined ? cond : { ok: cond, ...((typeof detail === "object" ? detail : { detail }) as object) };
  if (!cond) ok = false;
};
result.checks = {};

/**
 * Compara com a nota sem foco: nenhuma palavra muda de altura, e as de fora da linha do cursor nem de recuo. Na linha do
 * cursor, a marca que aparece (`**`) empurra para o lado o que vem depois dela: ali o recuo só conta nas palavras de
 * `keepX`, as que não têm marca à mostra antes delas. É o recuo do item cru, o pulo que o harry viu.
 */
function sameSpots(name: string, base: Record<string, Spot | null>, now: Record<string, Spot | null>, cursorLine: number, keepX: string[]) {
  const moved: Record<string, { dx: number; dy: number }> = {};
  for (const w of Object.keys(PROBES)) {
    const a = base[w];
    const b = now[w];
    if (!a || !b) {
      moved[w] = { dx: NaN, dy: NaN };
      continue;
    }
    const dx = Math.round((b.x - a.x) * 10) / 10;
    const dy = Math.round((b.y - a.y) * 10) / 10;
    const xCounts = PROBES[w] !== cursorLine || keepX.includes(w);
    if (Math.abs(dy) > TOLERANCE || (xCounts && Math.abs(dx) > TOLERANCE)) moved[w] = { dx, dy };
  }
  check(`${name}: nenhuma linha muda de lugar`, Object.keys(moved).length === 0, Object.keys(moved).length ? { moved } : undefined);
}

/** Os itens fora da linha do cursor continuam desenhados: sem `**`, `[[ ]]` nem `- ` à mostra. */
function othersDrawn(name: string, now: Record<string, Spot | null>, cursorLine: number) {
  const raw: Record<string, string> = {};
  for (const w of ["maçã", "banana", "cereja"]) {
    if (PROBES[w] === cursorLine) continue;
    const line = now[w]?.line ?? "";
    if (/\*\*|\[\[|\]\]|^[-*+] /.test(line)) raw[w] = line;
  }
  check(`${name}: os outros itens continuam desenhados`, Object.keys(raw).length === 0, Object.keys(raw).length ? { raw } : undefined);
}

const browser = await webkit.launch({ headless: true });
try {
  await cli(["start", "--no-helper"]);
  const w = await openWindow(browser, ctx, { window: "notes", scale: 2, theme: "light", width: 900, height: 700, motion: false, browser: "webkit", query: { note: NOTE } });
  const p = w.page;
  await p.locator(".kn-note-editor .cm-content").waitFor({ timeout: 20000 });
  await Bun.sleep(600);
  const shot = (file: string) => p.locator(".kn-note-editor").screenshot({ path: join(out, file) });
  const words = Object.keys(PROBES);

  // 0. A nota aberta, sem o cursor: a cara de referência.
  const base = await measure(p, words);
  result["0-sem-foco"] = base;
  await shot("0-sem-foco.png");
  const missing = words.filter((x) => !base[x]);
  check("a nota abre com todas as palavras à mostra", missing.length === 0, missing.length ? { missing } : undefined);
  check("sem foco, a lista está desenhada", ["maçã", "banana", "cereja"].every((x) => !/\*\*|\[\[|^[-*+] /.test(base[x]?.line ?? "")));

  // Os estados: onde o cursor vai, como, a linha do `.md` em que ele fica, a palavra em que ele tem de estar e as palavras
  // da linha dele que não podem andar para o lado (nenhuma marca à mostra antes delas).
  const states: { name: string; file: string; go: () => Promise<void>; line: number; at: string; keepX: string[] }[] = [
    { name: "1-cursor-fora", file: "1-cursor-fora.png", go: () => clickWord(p, "antes"), line: 0, at: "antes", keepX: ["antes"] },
    { name: "2-cursor-no-item", file: "2-cursor-no-item.png", go: () => clickWord(p, "banana"), line: 5, at: "banana", keepX: ["banana", "Feira"] },
    { name: "3-cursor-no-negrito", file: "3-cursor-no-negrito.png", go: () => clickWord(p, "maçã"), line: 4, at: "maçã", keepX: [] },
    { name: "4-seta-para-baixo", file: "4-seta-para-baixo.png", go: async () => { await p.keyboard.press("ArrowDown"); await settle(p); }, line: 5, at: "banana", keepX: ["banana", "Feira"] },
    { name: "4b-seta-para-cima", file: "4b-seta-para-cima.png", go: async () => { await clickWord(p, "cereja"); await p.keyboard.press("ArrowUp"); await settle(p); }, line: 5, at: "banana", keepX: ["banana", "Feira"] },
    { name: "5-cursor-no-titulo", file: "5-cursor-no-titulo.png", go: () => clickWord(p, "Frutas"), line: 2, at: "Frutas", keepX: ["Frutas"] },
    { name: "6-cursor-depois", file: "6-cursor-depois.png", go: () => clickWord(p, "Depois"), line: 8, at: "Depois", keepX: ["Depois"] },
  ];
  for (const s of states) {
    await s.go();
    const now = await measure(p, words);
    result[s.name] = now;
    // O cursor foi mesmo para dentro da palavra: na linha certa, mas no começo dela, nenhuma marca apareceria e o estado
    // passaria sem provar nada (revisão do T17785).
    const c = await cursorAt(p);
    check(`${s.name}: o cursor está dentro do "${s.at}"`, insideWord(c, s.at), { cursor: c && `${c.line}:${c.col}: ${c.text}` });
    await shot(s.file);
    sameSpots(s.name, base, now, s.line, s.keepX);
    othersDrawn(s.name, now, s.line);
  }
  // No item do cursor, só a marca debaixo dele: com o cursor no "maçã", o `**maçã**` à mostra, e o "pera" da mesma linha
  // continua sem `**`.
  const onBold = result["3-cursor-no-negrito"] as Record<string, Spot | null>;
  check("3-cursor-no-negrito: a marca debaixo do cursor aparece", /\*\*maçã\*\*/.test(onBold.maçã?.line ?? ""), { line: onBold.maçã?.line });
  check("3-cursor-no-negrito: o outro negrito da linha continua desenhado", !/\*\*pera\*\*/.test(onBold.pera?.line ?? ""), { line: onBold.pera?.line });
  check("3-cursor-no-negrito: o negrito continua negrito", (onBold.maçã?.weight ?? 0) >= 600 && (onBold.pera?.weight ?? 0) >= 600, { maçã: onBold.maçã?.weight, pera: onBold.pera?.weight });
  // Com o cursor no "banana", o link do mesmo item fica desenhado: o cursor não está nele.
  const onItem = result["2-cursor-no-item"] as Record<string, Spot | null>;
  check("2-cursor-no-item: o link fora do cursor continua desenhado", !/\[\[|\]\]/.test(onItem.Feira?.line ?? ""), { line: onItem.Feira?.line });

  // 7. Digitar no fim da nota: `- ` e `**` no começo de uma linha ainda formam a lista e o negrito.
  await clickWord(p, "Depois");
  await p.keyboard.press("End");
  await p.keyboard.type("\n\n- kiwi novo\n");
  // O Enter num item vazio sai da lista (o Enter do editor): a linha seguinte é um parágrafo.
  await p.keyboard.press("Enter");
  await p.keyboard.type("**forte** no fim");
  await settle(p);
  const typing = await measure(p, ["kiwi", "forte", "cereja", "Depois"]);
  result["7-digitando"] = typing;
  check("7: com o cursor na linha, o negrito digitado já é negrito", (typing.forte?.weight ?? 0) >= 600, { weight: typing.forte?.weight });
  await clickWord(p, "antes");
  const typed = await measure(p, ["kiwi", "forte", "cereja", "Depois"]);
  result["7-digitado"] = typed;
  await shot("7-digitado.png");
  check("7: o `- ` digitado vira item, sem o `- ` à mostra", !!typed.kiwi && !/^[-*+] /.test(typed.kiwi.line), { line: typed.kiwi?.line });
  check("7: o item novo tem o recuo dos outros itens", !!typed.kiwi && !!typed.cereja && Math.abs(typed.kiwi.x - typed.cereja.x) <= TOLERANCE, { kiwi: typed.kiwi?.x, cereja: typed.cereja?.x });
  check("7: o `**` digitado vira negrito, sem o `**` à mostra", (typed.forte?.weight ?? 0) >= 600 && !/\*\*/.test(typed.forte?.line ?? ""), { weight: typed.forte?.weight, line: typed.forte?.line });
  check("7: o parágrafo digitado tem o recuo de um parágrafo", !!typed.forte && !!typed.Depois && Math.abs(typed.forte.x - typed.Depois.x) <= TOLERANCE, { forte: typed.forte?.x, Depois: typed.Depois?.x });
  // E vai assim para o arquivo, depois da pausa da gravação.
  let disk = "";
  for (let i = 0; i < 30 && !disk.includes("**forte** no fim"); i++) {
    await Bun.sleep(100);
    disk = readFileSync(join(vault, NOTE), "utf8");
  }
  check("7: o arquivo tem a lista e o negrito digitados", disk.includes("\n- kiwi novo\n") && disk.includes("**forte** no fim"));
  result.problemasDaPagina = w.report.problems;
  check("a página sem erros", w.report.problems.length === 0, w.report.problems.length ? { problems: w.report.problems } : undefined);
  await w.close();
} finally {
  await browser.close();
  await cli(["stop"]).catch(() => {});
  rmSync(data, { recursive: true, force: true });
}
result.ok = ok;
writeFileSync(join(out, "medidas.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result.checks, null, 2));
console.log(ok ? "ok" : "FALHOU");
process.exit(ok ? 0 : 1);
