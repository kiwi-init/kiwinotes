// A célula selecionada e a largura arrastável (T21040, spec #21008): no app de verdade (o AppEngine headless) e num
// WebKit headless, com uma planilha e um csv inventados num tmp (o estoque de uma loja de exemplo). Nada na tela de
// ninguém, e o ⌘C se confere por um evento `copy` sintético, sem tocar no clipboard do Mac.
//
// - Clicar numa célula mostra o endereço e o conteúdo inteiro na barra de cima; a letra e o número dela acendem.
// - As setas andam entre as células, ⌘ + seta vai até a borda, e a célula fica à vista, fora das partes paradas.
// - ⌘C copia o conteúdo da célula; um texto selecionado na barra copia ele mesmo.
// - Arrastar a borda do cabeçalho muda só aquela coluna; dois cliques ajustam ao conteúdo, além dos 320 px.
// - A largura vale trocando de aba e volta.
// - O csv ganha o mesmo.
// - Os prints, no claro e no escuro.
//
//   bun scripts/celula-check.ts [pasta]
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { type Page, webkit } from "playwright-core";
import * as XLSX from "xlsx";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T21040-celula"));
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-celula-"));
const vault = join(data, "vault");

const put = (rel: string, bytes: Uint8Array | string) => {
  mkdirSync(dirname(join(vault, rel)), { recursive: true });
  writeFileSync(join(vault, rel), bytes);
};

// O estoque da loja de exemplo: 40 colunas, 80 linhas; a coluna F com uma observação longa.
const LONG = "Chegou com a caixa amassada; o fornecedor troca na próxima entrega, sem custo para a loja de exemplo";
const TITLES = ["Código", "Produto", "Estoque", "Preço", "Fornecedor", "Observação"];
const header = Array.from({ length: 40 }, (_, c) => TITLES[c] ?? `Semana ${c - 5}`);
const products = ["Caneca azul 300 ml", "Caderno A5", "Lápis de cor", "Garrafa", "Agenda 2027"];
const stock = [
  header,
  ...Array.from({ length: 79 }, (_, r) =>
    Array.from({ length: 40 }, (_, c) =>
      c === 0 ? 1001 + r : c === 1 ? products[r % 5] : c === 2 ? (r * 7) % 50 : c === 3 ? `R$ ${(10 + r).toFixed(2).replace(".", ",")}` : c === 4 ? "Papelaria Exemplo" : c === 5 ? (r === 0 ? LONG : "ok") : r + c,
    ),
  ),
];
const book = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(stock), "Loja 1");
XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Código", "Produto"], [2001, "Caneca"]]), "Loja 2");
put("Loja/estoque.xlsx", new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx", compression: true }) as ArrayBuffer));
put("Loja/precos.csv", "Código;Produto;Preço\n1001;Caneca azul 300 ml;29,90\n1002;Caderno A5;18,00\n");

async function cli(args: string[]): Promise<string> {
  const p = Bun.spawn([process.execPath, join(app, "scripts/cli.ts"), ...args, "--data", data], { cwd: app, stdout: "pipe", stderr: "pipe" });
  const text = await new Response(p.stdout).text();
  const code = await p.exited;
  return code === 0 ? text : Promise.reject(new Error(text + (await new Response(p.stderr).text())));
}

const ctx: UiContext = {
  data,
  send: async (msg) => {
    const r = await request(data, msg);
    assert.ok(r);
    return r;
  },
  subscribe: async (topics, onMsg) => {
    const c = await connect(data, (line) => {
      if (!("id" in line)) onMsg(line);
    });
    assert.ok(c);
    c.write({ id: 0, cmd: "subscribe", topics, follow: true, backlog: false });
    return () => c.close();
  },
};

const box = async (p: Page, sel: string) => {
  const b = await p.locator(sel).first().boundingBox();
  assert.ok(b, `não achei ${sel}`);
  return b;
};
const bar = async (p: Page) => [await p.locator(".kn-grid-addr").textContent(), await p.locator(".kn-grid-value").textContent()];
const cellAt = (row: number, col: number) => `.kn-grid-row[aria-rowindex='${row}'] [aria-colindex='${col + 1}']`;
/** O que o ⌘C põe no clipboard: o evento `copy` do menu Editar, sintético, com um DataTransfer de mentira. */
const copied = (p: Page) =>
  p.evaluate(() => {
    const before = new Event("beforecopy", { bubbles: true, cancelable: true });
    document.body.dispatchEvent(before);
    const dt = new DataTransfer();
    const e = new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: dt });
    document.body.dispatchEvent(e);
    return { enabled: before.defaultPrevented, handled: e.defaultPrevented, text: dt.getData("text/plain") };
  });
const width = async (p: Page, col: number) => (await box(p, `.kn-grid-top [aria-colindex='${col + 1}']`)).width;

let failed = false;
await cli(["start", "--no-helper"]);
const browser = await webkit.launch({ headless: true });
try {
  for (const theme of ["light", "dark"] as const) {
    const w = await openWindow(browser, ctx, { window: "notes", scale: 2, theme, width: 1000, height: 640, motion: false, browser: "webkit", query: { note: "Loja/estoque.xlsx" } });
    const p = w.page;
    try {
      await p.waitForSelector(".kn-file[data-state='ready'] .kn-grid .kn-grid-cell", { timeout: 15000 });
      assert.deepEqual(await bar(p), ["", "Clique numa célula para ver o conteúdo inteiro"]);
      assert.deepEqual((await copied(p)).handled, false, "sem célula, o ⌘C fica com a página");

      // 1. Clicar seleciona: o endereço e o conteúdo inteiro na barra; a letra e o número acesos.
      await p.click(cellAt(2, 2));
      assert.deepEqual(await bar(p), ["B2", "Caneca azul 300 ml"]);
      assert.equal(await p.locator(cellAt(2, 2)).getAttribute("aria-selected"), "true");
      assert.equal(await p.locator(".kn-grid-cell[aria-selected='true']").count(), 1);
      assert.equal(await p.locator(".kn-grid-letter[data-on]").textContent(), "B");
      assert.equal(await p.locator(".kn-grid-n[data-on]").textContent(), "2");
      assert.equal(await p.locator(".kn-grid").evaluate((el) => el === document.activeElement), true, "o clique dá o foco à grade");
      await p.click(cellAt(1, 1));
      assert.deepEqual(await bar(p), ["A1", "Código"], "a linha 1 também se seleciona");
      // O texto longo, cortado na grade, inteiro na barra.
      await p.click(cellAt(2, 6));
      assert.deepEqual(await bar(p), ["F2", LONG]);
      assert.ok(await p.locator(cellAt(2, 6)).evaluate((el) => el.scrollWidth > el.clientWidth), "na grade ele corta");
      if (theme === "light") console.log("ok     clicar seleciona: B2, A1 e o texto longo inteiro na barra");

      // 2. ⌘C copia a célula; o texto selecionado na barra copia ele mesmo.
      assert.deepEqual(await copied(p), { enabled: true, handled: true, text: LONG });
      await p.locator(".kn-grid-value").evaluate((el) => {
        const r = document.createRange();
        r.setStart(el.firstChild!, 0);
        r.setEnd(el.firstChild!, 6);
        document.getSelection()!.removeAllRanges();
        document.getSelection()!.addRange(r);
      });
      assert.equal((await copied(p)).handled, false, "o texto selecionado na barra fica com a cópia normal");
      await p.evaluate(() => document.getSelection()!.removeAllRanges());
      if (theme === "light") console.log("ok     ⌘C copia a célula (evento copy sintético), e a barra copia o que se seleciona nela");

      // 3. As setas, com a célula à vista fora das partes paradas.
      await p.click(cellAt(2, 2));
      await p.keyboard.press("ArrowRight");
      await p.keyboard.press("ArrowDown");
      assert.deepEqual(await bar(p), ["C3", "7"]);
      await p.keyboard.press("ArrowLeft");
      await p.keyboard.press("ArrowUp");
      await p.keyboard.press("ArrowUp");
      await p.keyboard.press("ArrowUp");
      assert.deepEqual(await bar(p), ["B1", "Produto"], "para na borda de cima");
      await p.keyboard.press("Meta+ArrowDown");
      await p.waitForTimeout(250);
      assert.deepEqual(await bar(p), ["B80", "Garrafa"]);
      await p.keyboard.press("Meta+ArrowRight");
      await p.waitForTimeout(250);
      assert.equal((await bar(p))[0], "AN80");
      const g = await box(p, ".kn-grid");
      const sel = await box(p, ".kn-grid-cell[aria-selected='true']");
      const n = await box(p, ".kn-grid-row[aria-rowindex='80'] .kn-grid-n");
      assert.ok(sel.x >= n.x + n.width - 1 && sel.x + sel.width <= g.x + g.width + 1, `a célula à vista na largura: ${JSON.stringify(sel)}`);
      assert.ok(sel.y + sel.height <= g.y + g.height + 1, "e na altura");
      await p.keyboard.press("Meta+ArrowUp");
      await p.keyboard.press("Home");
      await p.waitForTimeout(250);
      assert.deepEqual(await bar(p), ["A1", "Código"]);
      assert.deepEqual(await p.locator(".kn-grid").evaluate((el) => [el.scrollLeft, el.scrollTop]), [0, 0]);
      if (theme === "light") console.log("ok     setas, ⌘ + seta e Home: C3, B1, B80, AN80 à vista, A1");

      if (theme === "light") {
        // 4. A borda: arrastar muda só aquela coluna.
        const b0 = await width(p, 2);
        const c0 = await box(p, ".kn-grid-top [aria-colindex='4']");
        const handle = await box(p, ".kn-grid-resize[data-col='1']");
        await p.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
        await p.mouse.down();
        await p.mouse.move(handle.x + handle.width / 2 + 40, handle.y + 10, { steps: 4 });
        await p.mouse.move(handle.x + handle.width / 2 + 80, handle.y + 10, { steps: 4 });
        await p.mouse.up();
        await p.waitForTimeout(100);
        const b1 = await width(p, 2);
        const c1 = await box(p, ".kn-grid-top [aria-colindex='4']");
        assert.equal(Math.round(b1 - b0), 80, `a coluna B: ${b0} → ${b1}`);
        assert.equal(Math.round(c1.x - c0.x), 80, "a C anda junto");
        assert.equal(Math.round(c1.width), Math.round(c0.width), "e fica da mesma largura");
        assert.deepEqual(await bar(p), ["A1", "Código"], "arrastar a borda não muda a seleção");
        console.log(`ok     arrastar a borda: B de ${Math.round(b0)} para ${Math.round(b1)} px, só ela`);

        // 5. Dois cliques ajustam ao conteúdo, além dos 320 px da abertura.
        const f0 = await width(p, 6);
        assert.equal(Math.round(f0), 320, "a F abre no máximo");
        await p.dblclick(".kn-grid-resize[data-col='5']");
        await p.waitForTimeout(100);
        const f1 = await width(p, 6);
        assert.ok(f1 > 320, `a F ajustou: ${f1}`);
        assert.equal(await p.locator(cellAt(2, 6)).evaluate((el) => el.scrollWidth > el.clientWidth), false, "o texto longo cabe inteiro");
        await p.dblclick(".kn-grid-resize[data-col='1']");
        await p.waitForTimeout(100);
        const b2 = await width(p, 2);
        assert.ok(b2 < b1 && b2 >= 64, `a B volta ao conteúdo: ${b2}`);
        assert.equal(await p.locator(cellAt(2, 2)).evaluate((el) => el.scrollWidth > el.clientWidth), false);
        console.log(`ok     dois cliques: F de 320 para ${Math.round(f1)} px (o texto inteiro), B de ${Math.round(b1)} para ${Math.round(b2)} px`);

        // 6. A largura vale trocando de aba e voltando.
        await p.click(".kn-file-sheet-tab:has-text('Loja 2')");
        await p.waitForSelector(".kn-file-table-foot:has-text('2 linhas')");
        await p.click(".kn-file-sheet-tab:has-text('Loja 1')");
        await p.waitForSelector(".kn-file-table-foot:has-text('80 linhas')");
        await p.waitForTimeout(150);
        assert.equal(Math.round(await width(p, 6)), Math.round(f1), "a F guardou a largura");
        console.log("ok     a largura vale trocando de aba");

        await p.click(cellAt(2, 2));
        await p.waitForTimeout(150);
        await p.mouse.move(0, 0);
      } else {
        await p.click(cellAt(3, 2));
      }
      await p.waitForTimeout(250);
      await p.screenshot({ path: join(out, `celula-${theme}.png`) });
    } finally {
      await w.close();
    }
  }

  // 7. O csv ganha o mesmo: a linha dos nomes é a 1.
  {
    const w = await openWindow(browser, ctx, { window: "notes", scale: 2, theme: "light", width: 1000, height: 640, motion: false, browser: "webkit", query: { note: "Loja/precos.csv" } });
    const p = w.page;
    try {
      await p.waitForSelector(".kn-file[data-state='ready'] .kn-grid .kn-grid-cell", { timeout: 15000 });
      await p.click(cellAt(3, 3));
      assert.deepEqual(await bar(p), ["C3", "18,00"]);
      await p.keyboard.press("ArrowUp");
      await p.keyboard.press("ArrowUp");
      assert.deepEqual(await bar(p), ["C1", "Preço"]);
      assert.deepEqual(await copied(p), { enabled: true, handled: true, text: "Preço" });
      const before = await width(p, 2);
      await p.dblclick(".kn-grid-resize[data-col='0']");
      assert.equal(Math.round(await width(p, 2)), Math.round(before), "dois cliques numa coluna já ajustada não mudam nada");
      console.log("ok     precos.csv: C3, setas até C1, ⌘C e a borda");
    } finally {
      await w.close();
    }
  }
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  await browser.close();
  await cli(["stop"]).catch(() => {});
}
console.log(failed ? "FALHOU" : `ok: ${out}`);
process.exit(failed ? 1 : 0);
