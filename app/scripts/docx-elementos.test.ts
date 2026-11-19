// A escrita do gato não estraga o resto do docx (T23627, spec #21155 caixa 6): as garantias do 3a (spec #21080) depois
// de um `docx_edit` com todos os tipos de mudança. O documento inventado tem cabeçalho e rodapé com o número da página,
// título, negrito, itálico, cor, fonte, lista, alinhamento, quebra de página, link, nota de rodapé, comentário, uma
// imagem e uma tabela sombreada. O resumo é o mesmo da prova do 3a (`docx-prova/resumo.ts`): só o que o gato mudou muda.

import { describe, expect, test } from "bun:test";
import {
  AlignmentType, CommentRangeEnd, CommentRangeStart, CommentReference, Document, ExternalHyperlink, Footer, FootnoteReferenceRun, Header,
  HeadingLevel, ImageRun, LevelFormat, Packer, PageNumber, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun,
} from "docx";

import { applyDocxChanges, type DocxChange, DocxDoc } from "../src/agent/tools/docx.ts";
import { diff, summarize } from "./docx-prova/resumo.ts";

/** Um PNG de 1×1, azul. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

async function completo(): Promise<Uint8Array> {
  const cell = (t: string, fill?: string) =>
    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: t, bold: !!fill })] })], ...(fill ? { shading: { type: ShadingType.CLEAR, fill, color: "auto" } } : {}) });
  const doc = new Document({
    numbering: { config: [{ reference: "itens", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.START }] }] },
    footnotes: { 1: { children: [new Paragraph("Contagem feita pela Ana.")] } },
    comments: { children: [{ id: 0, author: "Bruno", date: new Date("2026-11-19T12:00:00Z"), children: [new Paragraph("Conferir com o caixa.")] }] },
    sections: [
      {
        headers: { default: new Header({ children: [new Paragraph("Loja de exemplo")] }) },
        footers: { default: new Footer({ children: [new Paragraph({ children: [new TextRun("Página "), new TextRun({ children: [PageNumber.CURRENT] })] })] }) },
        children: [
          new Paragraph({ text: "Estoque do mês", heading: HeadingLevel.HEADING_1 }),
          new Paragraph({
            children: [
              new TextRun("A loja vendeu "),
              new TextRun({ text: "40 canecas", bold: true }),
              new TextRun({ text: " azuis", italics: true, color: "1F6FEB", font: "Georgia" }),
              new TextRun(" em março"),
              new FootnoteReferenceRun(1),
              new TextRun("."),
            ],
          }),
          new Paragraph({ text: "Conferir as prateleiras.", numbering: { reference: "itens", level: 0 } }),
          new Paragraph({ text: "Repor os cadernos.", numbering: { reference: "itens", level: 0 } }),
          new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: "png", data: PNG, transformation: { width: 40, height: 40 } })] }),
          new Table({ rows: [new TableRow({ children: [cell("Produto", "D9E2F3"), cell("Estoque", "D9E2F3")] }), new TableRow({ children: [cell("Canecas"), cell("12")] })] }),
          new Paragraph({ children: [new CommentRangeStart(0), new TextRun("Carla fecha o caixa no sábado."), new CommentRangeEnd(0), new TextRun({ children: [new CommentReference(0)] })] }),
          new Paragraph({ children: [new ExternalHyperlink({ link: "https://exemplo.com/estoque", children: [new TextRun("A planilha do estoque")] })] }),
          new Paragraph({ pageBreakBefore: true, alignment: AlignmentType.RIGHT, text: "Anexo: o inventário." }),
          new Paragraph("Um parágrafo que sai."),
        ],
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

function write(bytes: Uint8Array, mudancas: DocxChange[]): Uint8Array {
  const d = DocxDoc.open(bytes, "x.docx");
  try {
    applyDocxChanges(d, mudancas, (s) => s);
    return d.bytes("x.docx");
  } finally {
    d.close();
  }
}

describe("os elementos do docx depois da escrita do gato (caixa 6 do #21155)", () => {
  test("trocar, reescrever, inserir, apagar e inserir_linha: só os parágrafos e a linha nova mudam", async () => {
    const before = await completo();
    const d = DocxDoc.open(before, "x.docx");
    const textos = d.paragraphs().map((p) => d.text(p));
    d.close();
    const n = (t: string) => {
      const i = textos.findIndex((x) => x.startsWith(t));
      if (i < 0) throw new Error(`não achei "${t}" em ${JSON.stringify(textos)}`);
      return i + 1;
    };
    const after = write(before, [
      // Dentro do parágrafo com negrito, itálico, cor, fonte e a nota: o resto dele fica.
      { tipo: "trocar", paragrafo: n("A loja vendeu 40 canecas"), de: "março", para: "abril" },
      { tipo: "reescrever", paragrafo: n("Repor os cadernos."), texto: "Repor os cadernos e os lápis." },
      { tipo: "inserir", depois_de: n("Carla fecha o caixa no sábado."), texto: "Beto confere no domingo." },
      { tipo: "apagar", paragrafo: n("Um parágrafo que sai.") },
      { tipo: "inserir_linha", depois_de: n("12"), celulas: ["Cadernos", "20"] },
    ]);
    const a = await summarize(before);
    const b = await summarize(after);
    const mudou = diff(a, b);
    // A linha nova: uma linha e duas células a mais; nada mais além dos parágrafos.
    expect(Object.keys(mudou).sort()).toEqual(["celulas", "linhas", "paragrafos"]);
    expect([a.linhas, b.linhas]).toEqual([2, 3]);
    expect([a.celulas, b.celulas]).toEqual([4, 6]);
    const sem = (xs: string[]) => xs.filter(Boolean);
    expect(sem(b.paragrafos)).toEqual(
      sem(a.paragrafos)
        .filter((t) => t !== "Um parágrafo que sai.")
        .map((t) => t.replace("março", "abril").replace("Repor os cadernos.", "Repor os cadernos e os lápis."))
        .flatMap((t) => (t === "12" ? [t, "Cadernos", "20"] : t === "Carla fecha o caixa no sábado." ? [t, "Beto confere no domingo."] : [t])),
    );
    // O que o 3a promete, um por um (o resumo inteiro já está acima; aqui, que o documento tem mesmo cada coisa).
    expect([...b.cabecalhoERodape].sort()).toEqual(["Loja de exemplo", "Página "]);
    expect(b.camposNoCabecalhoERodape).toEqual(["PAGE"]);
    expect(b.negrito).toBeGreaterThan(0);
    expect(b.italico).toBe(1);
    expect(b.cores).toEqual({ "1F6FEB": 1 });
    expect(b.fontes).toEqual({ Georgia: 1 });
    expect(b.listas).toBe(2);
    expect(b.imagens).toBe(1);
    expect(b.sombreamento).toEqual({ D9E2F3: 2 });
    expect(b.quebraDePagina).toBe(1);
    expect(b.links).toBe(1);
    expect(b.notasDeRodape).toContain("Contagem feita pela Ana.");
    expect(b.chamadasDeNota).toBe(1);
    expect(b.comentarios).toEqual(["Conferir com o caixa."]);
    expect(b.marcasDeComentario).toEqual([1, 1, 1]);
  });
});
