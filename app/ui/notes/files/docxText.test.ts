// O texto dos parágrafos do docx (T21231), para conferir a tela com o disco depois de o gato tocar. Docx inventados.

import { describe, expect, test } from "bun:test";
import { Document, Packer, Paragraph, Table, TableCell, TableRow, TabStopType, TextRun } from "docx";

import { docxOpsResult } from "../../../src/shared/docx/ops.ts";
import { docxBodyParagraphs, sameText } from "./docxText.ts";

async function doc(): Promise<Uint8Array> {
  const d = new Document({
    sections: [
      {
        children: [
          new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: 9000 }], children: [new TextRun("Caneca"), new TextRun({ text: "R$ 30 & <frete>", break: 0 }), new TextRun({ children: ["\t", "fim"] })] }),
          new Table({ rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph("Caderno")] })] })] }),
          new Paragraph(""),
          new Paragraph({ children: [new TextRun("Linha 1"), new TextRun({ text: "Linha 2", break: 1 })] }),
        ],
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(d));
}

describe("docxBodyParagraphs", () => {
  test("o texto de cada parágrafo, com as tabelas, os vazios, o tab e a quebra; a parada de tab não conta", async () => {
    expect(docxBodyParagraphs(await doc()).map((p) => p.text)).toEqual(["CanecaR$ 30 & <frete>\tfim", "Caderno", "", "Linha 1\nLinha 2"]);
  });
});

describe("sameText", () => {
  const p = (id: string, text: string) => ({ id, text });
  const disk = [p("A1", "Título"), p("B2", "A loja vendeu 52"), p("C3", "Novo")];
  test("sem edição por gravar: tudo igual, na ordem", () => {
    expect(sameText([...disk], disk, { pending: false, touched: [], gone: [] })).toBe(true);
    expect(sameText([p("A1", "Título!"), disk[1]!, disk[2]!], disk, { pending: false, touched: [], gone: [] })).toBe(false);
    expect(sameText(disk.slice(0, 2), disk, { pending: false, touched: [], gone: [] })).toBe(false);
  });
  test("com a edição da pessoa por gravar: só o que o gato tocou, e o que ele apagou não pode estar na tela", () => {
    const screen = [p("A1", "Título que a Ana mudou"), p("B2", "A loja vendeu 52"), p("C3", "Novo"), p("D4", "Sai")];
    expect(sameText(screen, disk, { pending: true, touched: ["B2", "c3"], gone: [] })).toBe(true);
    expect(sameText(screen, disk, { pending: true, touched: ["B2"], gone: ["D4"] })).toBe(false);
    expect(sameText(screen, disk, { pending: true, touched: ["A1"], gone: [] })).toBe(false);
  });
});

describe("docxOpsResult", () => {
  test("o que fica com o texto do gato e o que ele apagou; inserir e apagar o mesmo não sobra", () => {
    expect(
      docxOpsResult([
        { op: "replace", paragraphId: "A1", from: 0, to: 1, text: "x" },
        { op: "insert", after: "A1", paragraphId: "N1", text: "novo" },
        { op: "insert", after: "N1", paragraphId: "N2", text: "outro" },
        { op: "delete", paragraphId: "N2" },
        { op: "delete", paragraphId: "B2" },
      ]),
    ).toEqual({ touched: ["A1", "N1"], gone: ["N2", "B2"] });
  });

  test("a linha nova da tabela: cada célula dela fica realçada (T23627)", () => {
    expect(
      docxOpsResult([
        { op: "insertRow", after: "C1", cells: [{ paragraphId: "R1", text: "Borrachas" }, { paragraphId: "R2", text: "30" }] },
      ]),
    ).toEqual({ touched: ["R1", "R2"], gone: [] });
  });
});
