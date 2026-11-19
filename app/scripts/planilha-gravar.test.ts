// A planilha gravada reabre (T23457, spec #21065, a última caixa): no WebKit headless, o visualizador de verdade das
// Notas (`XlsxViewer` e `TableViewer`, com a grade, o recálculo e a gravação do app) abre um arquivo inventado e
// difícil; o teste edita uma célula pela grade, como a pessoa (clica, digita, Enter), e pega os bytes que a grade
// grava. O gravado reabre no Kiwi (a mesma página, e o leitor da grade) e numa segunda biblioteca, o SheetJS (já no
// lock, só lendo), com as abas, os valores, as fórmulas, os formatos e as mesclagens iguais, mais a edição e o que ela
// recalcula. O csv e o tsv, o mesmo, com aspas, separador e quebra de linha no campo. As mutações no gravado provam que
// a comparação pega o que um gravador perdesse. Precisa do WebKit do Playwright (`bunx playwright-core install webkit`).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { type Browser, type Page, webkit } from "playwright-core";

import { partText, readZip, writeZip } from "../src/shared/sheet/zip.ts";
import {
  ABAS,
  delimitado,
  diferencas,
  EDICAO_TEXTO,
  EDICAO_XLSX,
  LINHAS,
  linhasPelaSegunda,
  linhasPeloKiwi,
  pelaSegunda,
  peloKiwi,
  type Planilha,
  xlsxDificil,
} from "./planilha-gravar/dificil.ts";

const hasWebkit = (() => {
  try {
    return existsSync(webkit.executablePath());
  } catch {
    return false;
  }
})();

/** Troca uma parte do xlsx (ou tira, com `null`): o gravador que perde algo. */
function mudar(bytes: Uint8Array, name: string, fn: ((xml: string) => string) | null): Uint8Array {
  const parts = readZip(bytes);
  const part = parts.find((p) => p.name === name)!;
  if (!fn) return writeZip(bytes, parts.filter((p) => p !== part), new Map(), new Set([name]));
  return writeZip(bytes, parts, new Map([[name, new TextEncoder().encode(fn(partText(bytes, part)))]]));
}

/** Sem o formato: o nome que cada biblioteca dá ao formato de data embutido (o 14) não é o mesmo. */
const semFormato = (p: Partial<Planilha>) => ({ ...p, mesclas: undefined, celulas: Object.fromEntries(Object.entries(p.celulas ?? {}).map(([k, c]) => [k, { v: c.v, f: c.f }])) });

const ARQUIVOS: Record<string, Uint8Array> = {
  "pedidos.xlsx": xlsxDificil(),
  "pedidos.csv": delimitado(","),
  "pedidos.tsv": delimitado("\t"),
};

describe.skipIf(!hasWebkit)("a planilha gravada reabre no Kiwi e por outra biblioteca", () => {
  let dist = "";
  let browser: Browser;
  let server: ReturnType<typeof Bun.serve>;
  const gravado: Record<string, Uint8Array> = {};
  const atual: Record<string, Uint8Array> = { ...ARQUIVOS };

  const cell = (row: number, col: number) => `.kn-grid-row[aria-rowindex='${row}'] [aria-colindex='${col + 2}']`;
  const open = async (name: string): Promise<Page> => {
    const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
    const problems: string[] = [];
    page.on("pageerror", (e) => problems.push(e.message));
    await page.route("**/*", (r) => (r.request().url().startsWith(`http://localhost:${server.port}`) ? r.continue() : r.abort()));
    await page.goto(`http://localhost:${server.port}/?arquivo=${encodeURIComponent(name)}`);
    await page.waitForSelector(".kn-grid .kn-grid-cell", { timeout: 20_000 }).catch((e) => {
      throw new Error(`${(e as Error).message.split("\n")[0]} ${problems.join(" | ")}`);
    });
    return page;
  };
  /** Clica na célula, digita e dá Enter, como a pessoa; depois o "grava antes de sair" e os bytes gravados. */
  const edit = async (page: Page, row: number, col: number, typed: string): Promise<Uint8Array> => {
    await page.dblclick(cell(row, col));
    await page.waitForSelector(".kn-grid-editor");
    await page.locator(".kn-grid-editor").fill(typed);
    await page.keyboard.press("Enter");
    await page.waitForSelector(".kn-grid-editor", { state: "detached" });
    await page.waitForFunction(() => window.__kiwiSheet.flush().then(() => window.__kiwiSheet.saved.length > 0), null, { timeout: 10_000 });
    return new Uint8Array(Buffer.from(await page.evaluate(() => window.__kiwiSheet.saved.at(-1)!), "base64"));
  };
  /** O texto que a grade mostra, linha a linha (a linha do arquivo, 1 em diante). */
  const screen = (page: Page) =>
    page.evaluate(() =>
      [...document.querySelectorAll(".kn-grid-row[aria-rowindex]")].map((r) => [...r.querySelectorAll("[aria-colindex]")].map((c) => (c.textContent ?? "").trim())),
    );

  beforeAll(async () => {
    dist = mkdtempSync(path.join(tmpdir(), "kiwi-planilha-gravar-"));
    const built = await Bun.build({ entrypoints: [path.join(import.meta.dir, "planilha-gravar/entry.tsx")], outdir: dist, target: "browser", naming: "entry.[ext]" });
    if (!built.success) throw new Error(built.logs.join("\n"));
    const css = built.outputs.filter((o) => o.path.endsWith(".css")).map((o) => `<link rel="stylesheet" href="/${path.basename(o.path)}">`).join("");
    const html = `<!doctype html><meta charset="utf-8">${css}<div id="root"></div><script type="module" src="/entry.js"></script>`;
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const p = decodeURIComponent(new URL(req.url).pathname);
        if (p === "/") return new Response(html, { headers: { "content-type": "text/html" } });
        if (p.startsWith("/arquivo/")) return new Response(new Blob([atual[p.slice(9)] as Uint8Array<ArrayBuffer>]));
        return new Response(Bun.file(path.join(dist, p)));
      },
    });
    browser = await webkit.launch();
    for (const [name, linha, coluna, texto] of [
      ["pedidos.xlsx", EDICAO_XLSX.linha, EDICAO_XLSX.coluna, String(EDICAO_XLSX.depois)],
      ["pedidos.csv", EDICAO_TEXTO.linha, EDICAO_TEXTO.coluna, EDICAO_TEXTO.depois],
      ["pedidos.tsv", EDICAO_TEXTO.linha, EDICAO_TEXTO.coluna, EDICAO_TEXTO.depois],
    ] as const) {
      const page = await open(name);
      try {
        gravado[name] = await edit(page, linha + 1, coluna, texto);
      } finally {
        await page.close();
      }
    }
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    server?.stop(true);
    if (dist) rmSync(dist, { recursive: true, force: true });
  });

  // O que a edição muda: o preço (com o formato de moeda igual), o total da linha, a soma dos totais e o total do Resumo.
  const MUDA = ["Pedidos!C3.v", "Pedidos!D3.v", "Pedidos!D6.v", "Resumo!B1.v"];

  describe("o xlsx", () => {
    test("o inventado é difícil: três abas, fórmulas (uma de outra aba), moeda, data e mesclagem; as duas bibliotecas o leem igual", () => {
      const a = pelaSegunda(ARQUIVOS["pedidos.xlsx"]!);
      expect(a.abas).toEqual(ABAS);
      expect(a.mesclas).toEqual(["Pedidos!A1:E1"]);
      expect(a.celulas["Resumo!B1"]).toMatchObject({ f: "Pedidos!D6", v: 272 });
      expect(a.celulas["Pedidos!C3"]!.z).toContain("R$");
      expect(a.celulas["Pedidos!E3"]!.z).toMatch(/[dmy]/);
      expect(diferencas(semFormato(a), semFormato(peloKiwi(ARQUIVOS["pedidos.xlsx"]!)))).toEqual([]);
    });

    test("pela segunda biblioteca (SheetJS): as abas, as fórmulas, os formatos e a mesclagem iguais; mudam só a edição e o que ela recalcula", () => {
      const a = pelaSegunda(ARQUIVOS["pedidos.xlsx"]!);
      const b = pelaSegunda(gravado["pedidos.xlsx"]!);
      expect(diferencas(a, b)).toEqual(MUDA);
      expect(b.celulas["Pedidos!C3"]).toEqual({ v: EDICAO_XLSX.depois, z: a.celulas["Pedidos!C3"]!.z! });
      expect(b.celulas["Pedidos!D3"]).toEqual({ v: 200, f: "B3*C3", z: a.celulas["Pedidos!D3"]!.z! });
      expect(b.celulas["Pedidos!D6"]!.v).toBe(287);
      expect(b.celulas["Resumo!B1"]).toEqual({ v: 287, f: "Pedidos!D6", z: a.celulas["Resumo!B1"]!.z! });
    });

    test("pelo leitor do Kiwi: o mesmo, e as duas bibliotecas leem o gravado igual", () => {
      const a = peloKiwi(ARQUIVOS["pedidos.xlsx"]!);
      const b = peloKiwi(gravado["pedidos.xlsx"]!);
      expect(diferencas(a, b)).toEqual(MUDA);
      expect(diferencas(semFormato(b), semFormato(pelaSegunda(gravado["pedidos.xlsx"]!)))).toEqual([]);
    });

    test("reabre na grade do Kiwi com a edição e o recálculo na tela", async () => {
      atual["pedidos.xlsx"] = gravado["pedidos.xlsx"]!;
      const page = await open("pedidos.xlsx");
      try {
        // O print do PR: `PLANILHA_PRINT=<arquivo.png>`.
        if (process.env.PLANILHA_PRINT) await page.screenshot({ path: process.env.PLANILHA_PRINT });
        const rows = await screen(page);
        expect(rows[2]![EDICAO_XLSX.coluna]).toMatch(/R\$ ?20[.,]00/);
        expect(rows[2]!.join(" ")).toMatch(/R\$ ?200[.,]00/);
        expect(rows[5]!.join(" ")).toMatch(/R\$ ?287[.,]00/);
        expect(await page.locator(".kn-file-sheet [role='tab']").allTextContents()).toEqual(ABAS);
      } finally {
        await page.close();
        atual["pedidos.xlsx"] = ARQUIVOS["pedidos.xlsx"]!;
      }
    }, 30_000);

    test("a comparação pega o gravador que perde uma aba, uma fórmula, um formato ou a mesclagem", () => {
      const g = gravado["pedidos.xlsx"]!;
      const base = pelaSegunda(g);
      const semAba = mudar(mudar(g, "xl/workbook.xml", (x) => x.replace(/<sheet name="Observações"[^>]*\/>/, "")), "xl/worksheets/sheet3.xml", null);
      expect(diferencas(base, pelaSegunda(semAba))).toContain(`abas: ${JSON.stringify(ABAS)} → ${JSON.stringify(ABAS.slice(0, 2))}`);
      const semFormula = mudar(g, "xl/worksheets/sheet2.xml", (x) => x.replace(/<f>Pedidos!D6<\/f>/, ""));
      expect(diferencas(base, pelaSegunda(semFormula))).toEqual(["Resumo!B1.f"]);
      expect(diferencas(peloKiwi(g), peloKiwi(semFormula))).toEqual(["Resumo!B1.f"]);
      const semEstilo = mudar(g, "xl/worksheets/sheet1.xml", (x) => x.replace(/(<c r="E3") s="\d+"/, "$1"));
      expect(diferencas(base, pelaSegunda(semEstilo))).toEqual(["Pedidos!E3.z"]);
      const semMescla = mudar(g, "xl/worksheets/sheet1.xml", (x) => x.replace(/<mergeCells[\s\S]*?<\/mergeCells>/, ""));
      expect(diferencas(base, pelaSegunda(semMescla))).toEqual([`mesclas: ["Pedidos!A1:E1"] → []`]);
    });
  });

  for (const [name, sep] of [
    ["pedidos.csv", ","],
    ["pedidos.tsv", "\t"],
  ] as const) {
    describe(`o ${name.slice(-3)}`, () => {
      const esperado = () => LINHAS.map((r, i) => (i === EDICAO_TEXTO.linha ? r.map((c, k) => (k === EDICAO_TEXTO.coluna ? EDICAO_TEXTO.depois : c)) : r));

      test("o inventado tem aspas, o separador e a quebra de linha no campo; as duas bibliotecas o leem igual", () => {
        const text = new TextDecoder().decode(ARQUIVOS[name]!);
        expect(text).toContain('""amanhã""');
        expect(text).toContain('"Linha 1\nLinha 2"');
        expect(linhasPelaSegunda(ARQUIVOS[name]!, sep)).toEqual(LINHAS);
        expect(linhasPeloKiwi(ARQUIVOS[name]!, name)).toEqual(LINHAS);
      });

      test("o gravado reabre igual pelas duas bibliotecas, só com a edição; as outras linhas ficam byte a byte", () => {
        const g = gravado[name]!;
        expect(linhasPelaSegunda(g, sep)).toEqual(esperado());
        expect(linhasPeloKiwi(g, name)).toEqual(esperado());
        const antes = new TextDecoder().decode(ARQUIVOS[name]!);
        const depois = new TextDecoder().decode(g);
        const linhaEditada = (t: string) => t.split("\r\n").find((l) => l.startsWith("Bruno"))!;
        expect(depois.replace(linhaEditada(depois), "")).toBe(antes.replace(linhaEditada(antes), ""));
      });

      test("reabre na grade do Kiwi com a edição na tela", async () => {
        atual[name] = gravado[name]!;
        const page = await open(name);
        try {
          const rows = await screen(page);
          expect(rows[EDICAO_TEXTO.linha]![EDICAO_TEXTO.coluna]!.replace(/\s+/g, " ")).toBe(EDICAO_TEXTO.depois.replace(/\s+/g, " "));
          // A grade completa a tela com linhas vazias: contam as que têm texto.
          expect(rows.filter((r) => r.some((c) => c !== "")).length).toBe(LINHAS.length);
        } finally {
          await page.close();
          atual[name] = ARQUIVOS[name]!;
        }
      }, 30_000);

      test("a comparação pega o gravador que perde as aspas, uma linha ou a quebra no campo", () => {
        const g = new TextDecoder().decode(gravado[name]!);
        const enc = (t: string) => new TextEncoder().encode(t);
        const semAspas = enc(g.replace(`"Caderno, capa dura"`, "Caderno, capa dura").replace(`"Borracha\tbranca"`, "Borracha\tbranca"));
        const semLinha = enc(g.replace(/Carla[^\r\n]*\r\n/, ""));
        const semQuebra = enc(g.replace("Linha 1\nLinha 2", "Linha 1 Linha 2"));
        for (const m of [semAspas, semLinha, semQuebra]) {
          expect(linhasPelaSegunda(m, sep)).not.toEqual(esperado());
          expect(linhasPeloKiwi(m, name)).not.toEqual(esperado());
        }
      });
    });
  }
});
