// O id do parágrafo é o mesmo no agente e na tela (T21231, spec #21155): o mesmo docx inventado (título, tabela,
// parágrafos vazios), com e sem `w14:paraId`, dá os mesmos paraIds no motor sem tela (`DocxDoc`) e na superfície do
// WebKit headless, pela tradução do `ui/notes/files/docxIds.ts`, que está fora dos tipos públicos do motor. Uma versão
// nova do @docx-editor.dev/core que a tire ou mude quebra aqui, no CI, e não o gato mudando o parágrafo errado.
// Precisa do WebKit do Playwright (`bunx playwright-core install webkit`).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from "docx";
import { type Browser, webkit } from "playwright-core";

import { DocxDoc } from "../src/agent/tools/docx.ts";

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
          new Paragraph({ children: [new TextRun("A loja vendeu "), new TextRun({ text: "40 canecas", bold: true })] }),
          new Table({ rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph("Caderno")] }), new TableCell({ children: [new Paragraph("12")] })] })] }),
          new Paragraph(""),
          new Paragraph("Ana revisa na sexta."),
          new Paragraph(""),
        ],
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

function agentIds(bytes: Uint8Array): string[] {
  const d = DocxDoc.open(bytes, "x.docx");
  try {
    return d.paragraphs().map((p) => d.id(p));
  } finally {
    d.close();
  }
}

describe.skipIf(!hasWebkit)("o paraId no agente e na tela", () => {
  let dist = "";
  let browser: Browser;
  let server: ReturnType<typeof Bun.serve>;
  let doc: Uint8Array = new Uint8Array();

  beforeAll(async () => {
    dist = mkdtempSync(path.join(tmpdir(), "kn-docx-ids-"));
    const built = await Bun.build({ entrypoints: [path.join(import.meta.dir, "docx-ids/entry.ts")], outdir: dist, target: "browser" });
    if (!built.success) throw new Error(built.logs.join("\n"));
    const html = `<!doctype html><meta charset="utf-8"><div class="docx-editor docx-editor__scroll-container" style="height:900px;overflow:auto"><div id="doc" class="docx-paginated-surface"></div></div><script type="module" src="/entry.js"></script>`;
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const p = new URL(req.url).pathname;
        if (p === "/") return new Response(html, { headers: { "content-type": "text/html" } });
        if (p === "/doc.docx") return new Response(new Blob([doc as Uint8Array<ArrayBuffer>]));
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

  const screenIds = async (bytes: Uint8Array) => {
    doc = bytes;
    const page = await browser.newPage();
    try {
      await page.route("**/*", (r) => (r.request().url().startsWith(`http://localhost:${server.port}`) ? r.continue() : r.abort()));
      await page.goto(`http://localhost:${server.port}/`);
      await page.waitForFunction(() => window.__ids, null, { timeout: 30_000 });
      return await page.evaluate(() => window.__ids);
    } finally {
      await page.close();
    }
  };

  test("sem w14:paraId no arquivo: os mesmos ids nos dois, e a volta pelo nodeIdOf", async () => {
    const bytes = await relatorio();
    const agent = agentIds(bytes);
    expect(agent).toHaveLength(7);
    expect(await screenIds(bytes)).toEqual({ ok: true, paraIds: agent, back: true });
  }, 60_000);

  test("depois de o agente gravar (o arquivo com os ids): os mesmos", async () => {
    const d = DocxDoc.open(await relatorio(), "x.docx");
    const saved = d.bytes("x.docx");
    d.close();
    const agent = agentIds(saved);
    expect(await screenIds(saved)).toEqual({ ok: true, paraIds: agent, back: true });
  }, 60_000);
});
