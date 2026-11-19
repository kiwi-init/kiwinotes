// A planilha legível (T21038, spec #21008): o xlsx, o csv e o tsv na grade nova, no app de verdade (o AppEngine
// headless) e num WebKit headless. Os arquivos são inventados aqui, num tmp: o estoque de uma loja de exemplo. Nada na
// tela de ninguém.
//
// - Os roteiros `arquivo-tabela.json` e `arquivo-planilha.json`, com os arquivos que eles pedem.
// - `Loja/estoque.xlsx`: 3 abas; a 1ª com 256 colunas de títulos longos e 45 linhas. Uma linha por célula, "…" no que
//   não cabe, o número à direita, e a linha das letras, a linha 1 e a coluna dos números paradas ao rolar para os dois
//   lados. Só as células da tela estão montadas.
// - `Loja/vendas-do-ano.csv`: 100.000 linhas. Abre sem corte e sem o "Mostrar mais", e a última linha chega na rolagem.
// - Os prints, no claro e no escuro.
//
//   bun scripts/planilha-check.ts [pasta]
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { type Page, webkit } from "playwright-core";
import * as XLSX from "xlsx";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T21038-planilha"));
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-planilha-"));
const vault = join(data, "vault");

const put = (rel: string, bytes: Uint8Array | string) => {
  mkdirSync(dirname(join(vault, rel)), { recursive: true });
  writeFileSync(join(vault, rel), bytes);
};
const xlsx = (sheets: [string, unknown[][], boolean?][]) => {
  const book = XLSX.utils.book_new();
  for (const [name, rows, hidden] of sheets) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
    if (hidden) {
      book.Workbook ??= { Sheets: [] };
      book.Workbook.Sheets ??= [];
      book.Workbook.Sheets[book.SheetNames.length - 1] = { Hidden: 1 };
    }
  }
  return new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx", compression: true }) as ArrayBuffer);
};

// Os arquivos dos roteiros antigos (T7107, T7111).
put("Leia-me.md", "# Leia-me\n\nUma nota de exemplo.\n");
put(
  "Dados/vendas.csv",
  ["Data;Cliente;Valor;Observação", "01/11/2026;Bia;80,00;", '01/11/2026;Ana;120,00;"Sala, com vista; e varanda"', ...Array.from({ length: 1198 }, (_, i) => `02/11/2026;Cliente ${i};${i},50;`)].join("\n") + "\n",
);
put("Dados/contatos.tsv", "Nome\tTelefone\tCidade\nAna\t1111-0000\tCidade A\nBia\t2222-0000\tCidade B\n");
put("Dados/excel.csv", new Uint8Array([...new TextEncoder().encode("sep=;\n"), ...Buffer.from("Código;Descrição;Valor\n1;Ação de exemplo;10\n", "latin1")]));
put("Dados/largo.csv", `${Array.from({ length: 5000 }, (_, i) => `c${i}`).join(",")}\n${Array.from({ length: 5000 }, (_, i) => i).join(",")}\n`);
put("Docs/vendas.xlsx", readFileSync(join(app, "test/fixtures/files/vendas.xlsx")));
put("Docs/enorme.xlsx", xlsx([["Grande", Array.from({ length: 40 }, (_, r) => Array.from({ length: 20 }, (_, c) => `${r}-${c} ${"x".repeat(32_000)}`))]]));

// O estoque da loja de exemplo: 256 colunas com títulos longos, e 45 linhas.
const TITLES = ["Código", "Produto", "Estoque", "Preço", "Fornecedor"];
const header = Array.from({ length: 256 }, (_, c) => TITLES[c] ?? `Observação do estoque na semana ${c - 4} do ano, conferida na loja`);
const products = ["Caneca azul 300 ml", "Caderno A5", "Lápis de cor com 24 cores e apontador de metal", "Garrafa", "Agenda 2027"];
const stock = [
  header,
  ...Array.from({ length: 44 }, (_, r) =>
    Array.from({ length: 256 }, (_, c) =>
      c === 0 ? 1001 + r : c === 1 ? products[r % 5] : c === 2 ? (r * 7) % 50 : c === 3 ? `R$ ${(10 + r).toFixed(2).replace(".", ",")}` : c === 4 ? "Loja Exemplo Papelaria e Presentes" : r % 3 ? `ok ${r}` : "",
    ),
  ),
];
put("Loja/estoque.xlsx", xlsx([["Loja 1", stock], ["Loja 2", [["Código", "Produto"], [2001, "Caneca"]]], ["Loja 3", [["Código"], [3001]]]]));
put("Loja/vendas-do-ano.csv", `Pedido;Produto;Quantidade;Total\n${Array.from({ length: 100_000 }, (_, i) => `${i + 1};${products[i % 5]};${(i % 9) + 1};${i % 997},90`).join("\n")}\n`);

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

/** Onde está um elemento na tela (px). */
const box = async (p: Page, sel: string) => {
  const b = await p.locator(sel).first().boundingBox();
  assert.ok(b, `não achei ${sel}`);
  return b;
};
const scrollTo = async (p: Page, left: number, top: number) => {
  await p.locator(".kn-grid").evaluate((el, [x, y]) => el.scrollTo(x!, y!), [left, top]);
  await p.waitForTimeout(250);
};

let failed = false;
await cli(["start", "--no-helper"]);
const browser = await webkit.launch({ headless: true });
try {
  // 1. Os roteiros antigos, no grid novo.
  for (const script of ["arquivo-tabela.json", "arquivo-planilha.json"]) {
    const shots = join(data, `shots-${script}`);
    const r = await cli(["ui", "--script", join(app, "scripts/ui-scripts", script), "--out", shots]).catch((e: Error) => e.message);
    const report = JSON.parse(r.slice(r.indexOf("{"))) as { ok: boolean; problems?: string[]; steps?: { name?: string; error?: string }[] };
    const bad = report.steps?.findIndex((s) => s.error) ?? -1;
    for (const f of new Bun.Glob("*.png").scanSync(shots)) renameSync(join(shots, f), join(out, `${script.replace(".json", "")}-${f}`));
    const ok = report.ok && !report.problems?.length;
    console.log(`${ok ? "ok    " : "FALHOU"} ${script}${bad >= 0 ? `: passo ${bad + 1}, ${report.steps![bad]!.error}` : ""}${report.problems?.length ? ` · ${report.problems.join(" | ")}` : ""}`);
    failed ||= !ok;
  }

  // 2. A planilha de 256 colunas, nos dois temas.
  for (const theme of ["light", "dark"] as const) {
    const w = await openWindow(browser, ctx, { window: "notes", scale: 2, theme, width: 1000, height: 640, motion: false, browser: "webkit", query: { note: "Loja/estoque.xlsx" } });
    const p = w.page;
    try {
      await p.waitForSelector(".kn-file[data-state='ready'] .kn-grid .kn-grid-cell", { timeout: 15000 });
      assert.match((await p.locator(".kn-file-table-foot").textContent()) ?? "", /^45 linhas, 256 colunas/);
      assert.equal(await p.locator(".kn-file-sheet-tab").count(), 3);
      assert.equal(await p.locator(".kn-file-table-note, .kn-file-table-more").count(), 0, "sem corte de colunas nem Mostrar mais");
      // Uma linha por célula, com "…" no título longo, e a coluna no máximo.
      const long = p.locator(".kn-grid-top [aria-colindex='7']");
      const cell = await long.evaluate((el) => ({ h: el.getBoundingClientRect().height, w: el.getBoundingClientRect().width, cut: el.scrollWidth > el.clientWidth, ov: getComputedStyle(el).textOverflow, ws: getComputedStyle(el).whiteSpace }));
      assert.deepEqual([cell.h, cell.w, cell.cut, cell.ov, cell.ws], [30, 320, true, "ellipsis", "nowrap"], JSON.stringify(cell));
      // O número à direita, o texto à esquerda.
      const code = p.locator(".kn-grid-row[aria-rowindex='2'] [aria-colindex='2']");
      assert.equal(await code.textContent(), "1001");
      assert.equal(await code.evaluate((el) => getComputedStyle(el).textAlign), "right");
      assert.equal(await p.locator(".kn-grid-row[aria-rowindex='2'] [aria-colindex='3']").evaluate((el) => getComputedStyle(el).textAlign), "start");
      // Só um pedaço da grade montado: 256 × 45 seriam 11.520 células.
      const mounted = await p.locator(".kn-grid-cell").count();
      assert.ok(mounted < 1500, `células montadas: ${mounted}`);
      if (theme === "light") {
        await Bun.sleep(300);
        await p.screenshot({ path: join(out, "estoque-light.png") });
      }
      // Dois dedos no trackpad para o lado (harry #21198): eventos `wheel` com deltaX, como o trackpad manda. A grade
      // anda, a coluna dos números e a linha 1 ficam paradas, e não sobra buraco sem célula na borda.
      if (theme === "light") {
        const g = await box(p, ".kn-grid");
        const n0 = await box(p, ".kn-grid-row[aria-rowindex='3'] .kn-grid-n");
        const t0 = await box(p, ".kn-grid-top .kn-grid-n");
        await p.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
        for (let i = 0; i < 30; i++) await p.mouse.wheel(40, 0);
        await p.waitForTimeout(250);
        const left = await p.locator(".kn-grid").evaluate((el) => el.scrollLeft);
        assert.ok(left >= 1000, `a roda para o lado rolou ${left} px`);
        assert.equal(await p.locator(".kn-grid").evaluate((el) => el.scrollTop), 0, "só para o lado");
        assert.equal(Math.round((await box(p, ".kn-grid-row[aria-rowindex='3'] .kn-grid-n")).x), Math.round(n0.x), "os números parados");
        assert.equal(Math.round((await box(p, ".kn-grid-top .kn-grid-n")).y), Math.round(t0.y), "a linha 1 parada");
        const holes = await p.evaluate(([x0, y0, w, h]) => {
          const miss: string[] = [];
          for (const fx of [0.3, 0.6, 0.97]) for (const fy of [0.3, 0.9]) {
            const at = document.elementFromPoint(x0! + w! * fx, y0! + h! * fy);
            if (!at?.closest(".kn-grid-cell, .kn-grid-n")) miss.push(`${fx},${fy}`);
          }
          return miss;
        }, [g.x, g.y, g.width, g.height]);
        assert.deepEqual(holes, [], "a grade montada até a borda depois de rolar para o lado");
        await p.locator(".kn-grid").evaluate((el) => el.scrollTo(0, 0));
        await p.waitForTimeout(250);
        console.log(`ok     estoque.xlsx: dois dedos para o lado (wheel deltaX), ${left} px, números e linha 1 parados`);
      }
      // Rola para os dois lados: as letras, a linha 1 e a coluna dos números ficam no lugar.
      const before = { top: await box(p, ".kn-grid-top [aria-colindex='3']"), n: await box(p, ".kn-grid-row[aria-rowindex='2'] .kn-grid-n") };
      await scrollTo(p, 1_000_000, 400);
      await p.waitForSelector(".kn-grid-letter:text-is('IV')", { timeout: 5000 });
      const top = await box(p, ".kn-grid-top .kn-grid-n");
      const letters = await box(p, ".kn-grid-letters");
      assert.ok(Math.abs(letters.y - (await box(p, ".kn-grid")).y) <= 1.5, "a linha das letras no alto");
      assert.equal(Math.round(top.y), Math.round(before.top.y), "a linha 1 parada");
      const n = await box(p, ".kn-grid-row[aria-rowindex='20'] .kn-grid-n");
      assert.equal(Math.round(n.x), Math.round(before.n.x), "a coluna dos números parada");
      // A linha 1 por cima das outras: o que está no ponto dela é ela.
      const hit = await p.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest(".kn-grid-row")?.getAttribute("aria-rowindex"), [top.x + 200, top.y + 15]);
      assert.equal(hit, "1");
      await p.screenshot({ path: join(out, `estoque-rolada-${theme}.png`) });
      console.log(`ok     estoque.xlsx (${theme}): 256 colunas, ${mounted} células montadas, letras, linha 1 e números parados`);
    } finally {
      await w.close();
    }
  }

  // 3. O csv de 100.000 linhas: abre inteiro, e a última chega na rolagem.
  {
    const t0 = performance.now();
    const w = await openWindow(browser, ctx, { window: "notes", scale: 2, theme: "dark", width: 1000, height: 640, motion: false, browser: "webkit", query: { note: "Loja/vendas-do-ano.csv" } });
    const p = w.page;
    try {
      await p.waitForSelector(".kn-file[data-state='ready'] .kn-grid .kn-grid-cell", { timeout: 30000 });
      const opened = performance.now() - t0;
      assert.match((await p.locator(".kn-file-table-foot").textContent()) ?? "", /^100\.000 linhas, 4 colunas/);
      assert.equal(await p.locator(".kn-file-table-more").count(), 0);
      // A rolagem até o fim, em passos: cada um volta a tempo (nada trava montando 100.000 linhas).
      const steps: number[] = [];
      for (const top of [500_000, 1_500_000, 2_999_000, 4_000_000]) {
        const s = performance.now();
        await scrollTo(p, 0, top);
        steps.push(performance.now() - s);
      }
      await p.waitForSelector(".kn-grid-row[aria-rowindex='100001'] .kn-grid-n:text-is('100001')", { timeout: 5000 });
      assert.ok((await p.locator(".kn-grid-row").count()) < 80, "só as linhas da tela");
      await p.screenshot({ path: join(out, "vendas-fim-dark.png") });
      console.log(`ok     vendas-do-ano.csv: 100.000 linhas, aberto em ${(opened / 1000).toFixed(1)} s, rolagem ${steps.map((s) => s.toFixed(0)).join("/")} ms (com 250 de espera)`);
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
