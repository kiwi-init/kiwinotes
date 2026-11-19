// A pessoa editando a planilha na grade (T21109, spec #21065): no app de verdade (o AppEngine headless) e num WebKit
// headless, com duas planilhas e um csv inventados num tmp (o pedido de uma papelaria de exemplo). Nada na tela
// de ninguém; o ⌘V vai por um evento `paste` sintético, sem tocar no clipboard do Mac. Cada passo confere o arquivo
// gravado no disco.
//
// - Digitar numa célula grava, e o total, que é fórmula, recalcula na grade e no arquivo; a fórmula continua lá.
// - ⌘Z desfaz e grava o arquivo como estava; ⌘⇧Z refaz.
// - Colar um bloco do Excel (tabs e quebras) preenche a área.
// - O menu do botão direito insere e apaga linhas; ordenar muda só a vista, e o arquivo fica igual.
// - ⌘F acha as células, sem ligar para acento e maiúscula.
// - O csv grava com o mesmo separador, e as linhas que não mudaram ficam como estavam.
// - A planilha com macro abre só para leitura e diz por quê.
// - Os prints, em WebP, no claro e no escuro.
//
//   bun scripts/planilha-edita-check.ts [pasta]
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { type Page, webkit } from "playwright-core";
import * as XLSX from "xlsx";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T21109-edita"));
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-edita-"));
const vault = join(data, "vault");

const put = (rel: string, bytes: Uint8Array | string) => {
  mkdirSync(dirname(join(vault, rel)), { recursive: true });
  writeFileSync(join(vault, rel), bytes);
};

// O pedido da papelaria de exemplo: quantidade × preço no total, e a soma embaixo.
const pedido = XLSX.utils.aoa_to_sheet([
  ["Produto", "Qtd", "Preço", "Total"],
  ["Caneca", 2, 30, null],
  ["Caderno", 3, 20, null],
  ["Lápis", 10, 2, null],
  ["Soma", null, null, null],
]);
for (const r of [2, 3, 4]) pedido[`D${r}`] = { t: "n", f: `B${r}*C${r}`, v: Number(pedido[`B${r}`].v) * Number(pedido[`C${r}`].v) };
pedido.D5 = { t: "n", f: "SUM(D2:D4)", v: 140 };
const book = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(book, pedido, "Pedido");
const xlsxBytes = new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx", compression: true }) as ArrayBuffer);
put("Papelaria/pedido.xlsx", xlsxBytes);
// Uma planilha com macro (o vbaProject.bin), mesmo com o nome .xlsx: abre só para leitura.
const macroBook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(macroBook, XLSX.utils.aoa_to_sheet([["Produto", "Qtd"], ["Caneca", 2]]), "Pedido");
(macroBook as XLSX.WorkBook & { vbaraw?: Uint8Array }).vbaraw = new Uint8Array(512);
put("Papelaria/macro.xlsx", new Uint8Array(XLSX.write(macroBook, { type: "array", bookType: "xlsm", bookVBA: true }) as ArrayBuffer));
const CSV = "Código;Produto;Preço\r\n1001;Caneca;\"29,90\"\r\n1002;Caderno;18,00\r\n";
put("Papelaria/precos.csv", CSV);

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

const cellAt = (row: number, col: number) => `.kn-grid-row[aria-rowindex='${row}'] [aria-colindex='${col + 1}']`;
const text = (p: Page, row: number, col: number) => p.locator(cellAt(row, col)).textContent();
/** A planilha como está no disco: as células da primeira aba, com a fórmula quando tem. */
const onDisk = () => {
  const wb = XLSX.read(readFileSync(join(vault, "Papelaria/pedido.xlsx")), { type: "buffer" });
  return wb.Sheets[wb.SheetNames[0]!]!;
};
/** Espera o arquivo no disco chegar ao que se quer (a gravação vai um instante depois da edição). */
async function until(what: string, ok: () => boolean, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if (ok()) return;
    } catch {}
    await Bun.sleep(100);
  }
  assert.fail(`o disco não chegou a: ${what}`);
}
const paste = (p: Page, tsv: string) =>
  p.evaluate((t) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", t);
    document.body.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt }));
  }, tsv);
const shot = async (p: Page, name: string) => {
  const png = join(out, `${name}.png`);
  await p.screenshot({ path: png });
  const r = spawnSync("cwebp", ["-quiet", "-q", "85", png, "-o", join(out, `${name}.webp`)]);
  if (r.status === 0) rmSync(png);
};
const open = (theme: "light" | "dark", note: string) =>
  openWindow(browser, ctx, { window: "notes", scale: 2, theme, width: 900, height: 520, motion: false, browser: "webkit", query: { note } });

let failed = false;
await cli(["start", "--no-helper"]);
const browser = await webkit.launch({ headless: true });
try {
  {
    const w = await open("light", "Papelaria/pedido.xlsx");
    const p = w.page;
    try {
      await p.waitForSelector(".kn-file[data-state='ready'] .kn-grid .kn-grid-cell", { timeout: 15000 });
      assert.equal(await text(p, 2, 4), "60");
      assert.equal(await text(p, 5, 4), "140");

      // 1. Digitar 5 na quantidade da caneca: o total e a soma recalculam, e o arquivo grava com a fórmula.
      await p.click(cellAt(2, 2));
      await p.keyboard.press("5");
      await p.waitForSelector(".kn-grid-editor");
      assert.equal(await p.locator(".kn-grid-editor").inputValue(), "5", "digitar abre a célula com a tecla");
      await p.keyboard.press("Enter");
      await p.waitForFunction(() => document.querySelector(".kn-grid-row[aria-rowindex='2'] [aria-colindex='5']")?.textContent === "150");
      assert.equal(await text(p, 5, 4), "230");
      assert.equal(await p.locator(".kn-grid-addr").textContent(), "B3", "o Enter desce");
      await until("B2 = 5 e D2 = 150, com a fórmula", () => {
        const s = onDisk();
        return s.B2.v === 5 && s.D2.v === 150 && s.D2.f === "B2*C2" && s.D5.v === 230;
      });
      console.log("ok     digitar grava; o total e a soma recalculam na grade e no disco, e a fórmula continua");

      // A fórmula aparece em português na barra e na caixa.
      await p.click(cellAt(5, 4));
      assert.equal(await p.locator(".kn-grid-value").textContent(), "=SOMA(D2:D4)");
      await p.keyboard.press("Enter");
      assert.equal(await p.locator(".kn-grid-editor").inputValue(), "=SOMA(D2:D4)");
      await shot(p, "01-editando-claro");
      await p.keyboard.press("Escape");
      assert.equal(await p.locator(".kn-grid-editor").count(), 0);

      // 2. ⌘Z desfaz, ⌘⇧Z refaz, e o disco acompanha.
      await p.keyboard.press("Meta+z");
      await until("B2 de volta a 2", () => onDisk().B2.v === 2 && onDisk().D5.v === 140);
      assert.equal(await text(p, 2, 4), "60");
      await p.keyboard.press("Meta+Shift+z");
      await until("B2 de novo 5", () => onDisk().B2.v === 5);
      console.log("ok     ⌘Z desfaz e ⌘⇧Z refaz, gravando");

      // 3. Colar um bloco 2×2 em B3: as quantidades e os preços de caderno e lápis.
      await p.click(cellAt(3, 2));
      await paste(p, "4\t25\r\n6\t3\r\n");
      await until("o bloco colado", () => {
        const s = onDisk();
        return s.B3.v === 4 && s.C3.v === 25 && s.B4.v === 6 && s.C4.v === 3 && s.D5.v === 150 + 100 + 18;
      });
      assert.equal(await p.locator(".kn-grid-addr").textContent(), "B3:C4", "a área colada fica selecionada");
      console.log("ok     colar um bloco do Excel preenche a área e recalcula");

      // 4. O botão direito na linha do lápis: inserir uma linha acima; a soma acompanha.
      await p.click(cellAt(4, 1), { button: "right" });
      await p.click(".kn-menu-item:has-text('Inserir linha acima')");
      await until("a linha nova e a soma em D6", () => onDisk().A5.v === "Lápis" && onDisk().D6?.f === "SUM(D2:D5)");
      await p.click(cellAt(4, 1), { button: "right" });
      await p.click(".kn-menu-item:has-text('Apagar linha')");
      await until("a linha apagada", () => onDisk().A4.v === "Lápis" && onDisk().D5.f === "SUM(D2:D4)");
      console.log("ok     inserir e apagar linha pelo botão direito, e a soma acompanha");

      // 5. Ordenar de Z a A pela coluna A: muda a vista, e o arquivo fica igual.
      const before = readFileSync(join(vault, "Papelaria/pedido.xlsx"));
      await p.click(cellAt(2, 1), { button: "right" });
      await p.waitForSelector(".kn-menu .kn-menu-item");
      await p.waitForTimeout(200);
      await shot(p, "02-menu-claro");
      await p.click(".kn-menu-item:has-text('Ordenar de Z a A')");
      assert.equal(await text(p, 2, 1), "Soma");
      assert.equal(await p.locator(".kn-grid-row[aria-rowindex='2'] .kn-grid-n").textContent(), "5", "a linha mostra o número dela no arquivo");
      assert.match((await p.locator(".kn-file-table-foot").textContent()) ?? "", /o arquivo não muda/);
      await Bun.sleep(800);
      assert.deepEqual(readFileSync(join(vault, "Papelaria/pedido.xlsx")), before, "ordenar não grava");
      await p.click(cellAt(2, 1), { button: "right" });
      await p.click(".kn-menu-item:has-text('Mostrar todas as linhas')");
      assert.equal(await text(p, 2, 1), "Caneca");
      console.log("ok     ordenar muda só a vista; o arquivo fica igual");

      // 6. ⌘F: "LAPIS" acha Lápis.
      await p.click(cellAt(2, 1));
      await p.keyboard.press("Meta+f");
      await p.waitForSelector(".kn-grid-find input");
      await p.keyboard.type("LAPIS");
      await p.keyboard.press("Enter");
      assert.equal(await p.locator(".kn-grid-find input").inputValue(), "LAPIS");
      assert.equal(await p.locator(".kn-grid-find-count").textContent(), "1 de 1");
      assert.equal(await p.locator(".kn-grid-addr").textContent(), "A4");
      await p.mouse.move(0, 0);
      await shot(p, "03-procurar-claro");
      console.log("ok     ⌘F acha sem ligar para acento e maiúscula");
    } finally {
      await w.close();
    }
  }

  // 7. O escuro, com uma área selecionada.
  {
    const w = await open("dark", "Papelaria/pedido.xlsx");
    const p = w.page;
    try {
      await p.waitForSelector(".kn-file[data-state='ready'] .kn-grid .kn-grid-cell", { timeout: 15000 });
      await p.click(cellAt(2, 2));
      await p.click(cellAt(4, 3), { modifiers: ["Shift"] });
      assert.equal(await p.locator(".kn-grid-addr").textContent(), "B2:C4");
      assert.equal(await p.locator(".kn-grid-cell[data-area]").count(), 6);
      await shot(p, "04-area-escuro");
      console.log("ok     Shift + clique seleciona a área");
    } finally {
      await w.close();
    }
  }

  // 8. O csv: grava com ; e as linhas que não mudaram ficam iguais (as aspas do "29,90" também).
  {
    const w = await open("light", "Papelaria/precos.csv");
    const p = w.page;
    try {
      await p.waitForSelector(".kn-file[data-state='ready'] .kn-grid .kn-grid-cell", { timeout: 15000 });
      assert.match((await p.locator(".kn-file-table-foot").textContent()) ?? "", /^2 linhas, 3 colunas/);
      await p.dblclick(cellAt(3, 3));
      await p.locator(".kn-grid-editor").fill("19,50");
      await p.keyboard.press("Enter");
      const want = "Código;Produto;Preço\r\n1001;Caneca;\"29,90\"\r\n1002;Caderno;19,50\r\n";
      await until("o csv gravado", () => readFileSync(join(vault, "Papelaria/precos.csv"), "utf8") === want);
      console.log("ok     csv: grava com o mesmo separador, e o resto fica como estava");
    } finally {
      await w.close();
    }
  }

  // 9. A planilha com macro: só leitura, e diz por quê.
  {
    const w = await open("light", "Papelaria/macro.xlsx");
    const p = w.page;
    try {
      await p.waitForSelector(".kn-file[data-state='ready'] .kn-grid .kn-grid-cell", { timeout: 15000 });
      assert.match((await p.locator(".kn-file-sheet-note").textContent()) ?? "", /Só leitura: a planilha tem macros/);
      await p.dblclick(cellAt(2, 2));
      assert.equal(await p.locator(".kn-grid-editor").count(), 0);
      console.log("ok     com macro: só leitura, com o aviso");
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
