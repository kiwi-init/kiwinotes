// O gato tocando as mudanças dele no docx aberto (T21231, spec #21155), no WebKit headless: as operações que o
// `docx_edit` deu (o agente falso, sem tela) tocadas pelo `mountDocx` deixam a tela com o mesmo texto que o arquivo
// gravado, sem contar como edição da pessoa. As que a tela não sabe tocar dizem `false`, e o `DocxViewer` abre o do
// disco. Tudo inventado: o relatório de uma loja. Precisa do WebKit do Playwright (`bunx playwright-core install webkit`).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from "docx";
import { type Browser, webkit } from "playwright-core";

import { applyDocxChanges, type DocxChange, DocxDoc } from "../src/agent/tools/docx.ts";
import type { DocxOp } from "../src/shared/docx/ops.ts";
import { docxBodyParagraphs, sameText } from "../ui/notes/files/docxText.ts";

const hasWebkit = (() => {
  try {
    return existsSync(webkit.executablePath());
  } catch {
    return false;
  }
})();

async function relatorio(): Promise<Uint8Array> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: "Relatório da loja", heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ children: [new TextRun("A loja vendeu "), new TextRun({ text: "40 canecas", bold: true }), new TextRun(" em março.")] }),
          new Table({ rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph("Caderno")] }), new TableCell({ children: [new Paragraph("12")] })] })] }),
          new Paragraph(""),
          new Paragraph("Ana revisa na sexta."),
          new Paragraph("Beto fecha o caixa."),
        ],
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

/** O que o agente faz: as mudanças sobre o arquivo, os bytes gravados e as operações para a tela. */
async function agent(mudancas: DocxChange[]): Promise<{ before: Uint8Array; after: Uint8Array; ops: DocxOp[] }> {
  const before = await relatorio();
  const d = DocxDoc.open(before, "x.docx");
  try {
    const ops = applyDocxChanges(d, mudancas, (s) => s);
    return { before, after: d.bytes("x.docx"), ops };
  } finally {
    d.close();
  }
}

describe.skipIf(!hasWebkit)("o gato toca no docx aberto", () => {
  let dist = "";
  let browser: Browser;
  let server: ReturnType<typeof Bun.serve>;
  let doc: Uint8Array = new Uint8Array();
  let opsJson = "";

  beforeAll(async () => {
    dist = mkdtempSync(path.join(tmpdir(), "kn-docx-kiwi-"));
    const built = await Bun.build({ entrypoints: [path.join(import.meta.dir, "docx-kiwi/entry.ts")], outdir: dist, target: "browser" });
    if (!built.success) throw new Error(built.logs.join("\n"));
    const css = built.outputs.filter((o) => o.path.endsWith(".css")).map((o) => `<link rel="stylesheet" href="/${path.basename(o.path)}">`).join("");
    const html = `<!doctype html><meta charset="utf-8">${css}<div class="docx-editor docx-editor__scroll-container" style="height:900px;overflow:auto"><div id="doc" class="docx-paginated-surface"></div></div><script type="module" src="/entry.js"></script>`;
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const p = new URL(req.url).pathname;
        if (p === "/") return new Response(html, { headers: { "content-type": "text/html" } });
        if (p === "/doc.docx") return new Response(new Blob([doc as Uint8Array<ArrayBuffer>]));
        if (p === "/ops.json") return new Response(opsJson, { headers: { "content-type": "application/json" } });
        return new Response(Bun.file(path.join(dist, p)));
      },
    });
    browser = await webkit.launch();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    server?.stop(true);
    if (dist) rmSync(dist, { recursive: true, force: true });
  });

  const play = async (bytes: Uint8Array, ops: DocxOp[], reduced = true) => {
    doc = bytes;
    opsJson = JSON.stringify({ ops, reduced });
    const page = await browser.newPage();
    try {
      await page.route("**/*", (r) => (r.request().url().startsWith(`http://localhost:${server.port}`) ? r.continue() : r.abort()));
      await page.goto(`http://localhost:${server.port}/`);
      await page.waitForFunction(() => window.__play, null, { timeout: 30_000 });
      const r = await page.evaluate(() => window.__play);
      if ("error" in r) throw new Error(r.error);
      return { ...r, saved: new Uint8Array(Buffer.from(r.saved, "base64")) };
    } finally {
      await page.close();
    }
  };

  const same = (screen: Uint8Array, disk: Uint8Array) => sameText(docxBodyParagraphs(screen), docxBodyParagraphs(disk), { pending: false, touched: [], gone: [] });

  test("trocar, inserir e apagar no meio: a tela fica com o texto do arquivo, e nada conta como edição da pessoa", async () => {
    const a = await agent([
      { tipo: "trocar", paragrafo: 2, de: "40 canecas", para: "52 canecas" },
      { tipo: "inserir", depois_de: 6, texto: "Carla abre a loja." },
      { tipo: "apagar", paragrafo: 7 },
      { tipo: "reescrever", paragrafo: 1, texto: "Relatório de março" },
    ]);
    expect(a.ops.map((o) => o.op)).toEqual(["replace", "insert", "delete", "replace"]);
    const r = await play(a.before, a.ops);
    expect(r.played).toBe(true);
    expect(docxBodyParagraphs(r.saved).map((p) => p.text)).toEqual(docxBodyParagraphs(a.after).map((p) => p.text));
    expect(same(r.saved, a.after)).toBe(true);
    expect(r.edits).toBe(0);
    // O cursor da pessoa (no título, onde o documento abriu) volta para ela; o gato nunca aparece como o cursor dela.
    const d = DocxDoc.open(a.before, "x.docx");
    const title = d.id(d.paragraphs()[0]!);
    d.close();
    expect(r.carets).toEqual([title]);
  }, 60_000);

  test("com a animação (o texto entrando aos pedaços): o mesmo fim", async () => {
    const a = await agent([
      { tipo: "trocar", paragrafo: 6, de: "sexta", para: "quinta-feira de manhã" },
      { tipo: "inserir", depois_de: 2, texto: "As canecas azuis saíram mais." },
    ]);
    const r = await play(a.before, a.ops, false);
    expect(r.played).toBe(true);
    expect(same(r.saved, a.after)).toBe(true);
  }, 60_000);

  test("apagar o primeiro parágrafo: toca, e o texto bate", async () => {
    const a = await agent([{ tipo: "apagar", paragrafo: 1 }]);
    const r = await play(a.before, a.ops);
    expect(r.played).toBe(true);
    expect(same(r.saved, a.after)).toBe(true);
  }, 60_000);

  test("inserir no início do documento: a tela não toca, e o visualizador abre o do disco", async () => {
    const a = await agent([{ tipo: "inserir", depois_de: 0, texto: "Rascunho" }]);
    const r = await play(a.before, a.ops);
    expect(r.played).toBe(false);
  }, 60_000);

  test("uma operação que não bate com a tela (o parágrafo não existe nela): false", async () => {
    const r = await play(await relatorio(), [{ op: "replace", paragraphId: "0BADF00D", from: 0, to: 1, text: "x" }]);
    expect(r.played).toBe(false);
  }, 60_000);

  // Revisão #23268, item 3: a tabela. Cada caso termina com a tela igual ao disco: tocado, ou aberto do disco (false).
  describe("na tabela", () => {
    const ends = async (mudancas: DocxChange[]) => {
      const a = await agent(mudancas);
      const r = await play(a.before, a.ops);
      if (r.played) expect(same(r.saved, a.after)).toBe(true);
      return r.played;
    };
    test("trocar num parágrafo de uma célula", async () => {
      expect(await ends([{ tipo: "trocar", paragrafo: 3, de: "Caderno", para: "Caderno azul" }])).toBe(true);
    }, 60_000);
    test("apagar o parágrafo logo depois da tabela: a tela não toca (juntaria com a célula), e abre o do disco", async () => {
      expect(await ends([{ tipo: "apagar", paragrafo: 5 }])).toBe(false);
    }, 60_000);
    test("inserir depois do último parágrafo de uma célula", async () => {
      expect(await ends([{ tipo: "inserir", depois_de: 4, texto: "unidades" }])).toBe(true);
    }, 60_000);
  });
});
