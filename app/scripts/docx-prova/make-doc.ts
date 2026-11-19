// O documento inventado da prova do docx (T21151, spec #21080): o relatório de estoque de uma loja de exemplo, com umas
// 20 páginas de título, texto com fonte e cor, lista, tabelas, um gráfico (imagem), cabeçalho e rodapé com o número da
// página. Tudo inventado (#17952). bun scripts/docx-prova/make-doc.ts <saida.docx>
import { writeFileSync } from "node:fs";

import {
  AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, ImageRun, PageNumber, Packer, Paragraph, ShadingType,
  Table, TableCell, TableRow, TextRun, WidthType,
} from "docx";
import { webkit } from "playwright-core";

const out = process.argv[2];
if (!out) throw new Error("uso: make-doc.ts <saida.docx>");

const produtos = ["Caneca azul 300 ml", "Caderno A5", "Lápis 6B", "Agenda 2027", "Garrafa térmica", "Mochila verde",
  "Estojo duplo", "Marca-texto", "Régua 30 cm", "Bloco de notas", "Tesoura escolar", "Cola em bastão"];
const meses = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro"];

// Números que parecem de verdade, mas saem de uma conta fixa: o mesmo documento a cada vez.
const num = (i: number, j: number) => ((i * 37 + j * 91) % 180) + 12;

/** O gráfico de barras de um mês, desenhado em SVG e fotografado pelo WebKit headless. */
async function charts(): Promise<Buffer[]> {
  const b = await webkit.launch();
  const p = await b.newPage({ viewport: { width: 640, height: 300 }, deviceScaleFactor: 1 });
  const out: Buffer[] = [];
  for (let m = 0; m < meses.length; m++) {
    const bars = produtos.slice(0, 8).map((nome, i) => {
      const v = num(i, m);
      return `<rect x="${40 + i * 72}" y="${260 - v}" width="48" height="${v}" fill="${i % 2 ? "#2e7d5b" : "#7cb342"}"/>
<text x="${64 + i * 72}" y="280" font-size="11" text-anchor="middle" fill="#333">${nome.split(" ")[0]}</text>`;
    }).join("");
    await p.setContent(`<body style="margin:0;background:#fff"><svg width="640" height="300" font-family="Helvetica">
<text x="20" y="24" font-size="16" fill="#1b4332">Saídas de ${meses[m]} por produto</text>
<line x1="30" y1="260" x2="620" y2="260" stroke="#999"/>${bars}</svg></body>`);
    out.push(await p.screenshot({ type: "png" }));
  }
  await b.close();
  return out;
}

const cell = (text: string, head = false) =>
  new TableCell({
    width: { size: 25, type: WidthType.PERCENTAGE },
    shading: head ? { type: ShadingType.CLEAR, color: "auto", fill: "1B4332" } : undefined,
    children: [new Paragraph({ children: [new TextRun({ text, bold: head, color: head ? "FFFFFF" : undefined, font: "Helvetica", size: 20 })] })],
  });

const imgs = await charts();
const children: (Paragraph | Table)[] = [
  new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: "Relatório de estoque", font: "Georgia", color: "1B4332" })] }),
  new Paragraph({ children: [new TextRun({ text: "Loja de exemplo · Janeiro a outubro", italics: true, color: "555555", size: 26 })] }),
];
for (let m = 0; m < meses.length; m++) {
  children.push(
    new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: m > 0, children: [new TextRun({ text: `${m + 1}. ${meses[m]}`, font: "Georgia", color: "1B4332" })] }),
    new Paragraph({
      spacing: { after: 160 },
      children: [
        new TextRun({ text: "Resumo do mês. ", bold: true, font: "Helvetica", size: 22 }),
        new TextRun({ text: `Em ${meses[m].toLowerCase()}, a loja recebeu ${num(m, 3) * 4} itens e vendeu ${num(m, 5) * 3}. `, font: "Helvetica", size: 22 }),
        new TextRun({ text: "O caderno A5 segue o mais pedido, ", font: "Helvetica", size: 22 }),
        new TextRun({ text: "e a garrafa térmica ficou abaixo do mínimo duas semanas.", color: "B23A48", font: "Helvetica", size: 22 }),
      ],
    }),
    new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: `Reposição pedida: ${num(m, 7)} unidades`, font: "Helvetica", size: 22 })] }),
    new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: `Devoluções: ${num(m, 9) % 9}`, font: "Helvetica", size: 22 })] }),
    new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: "Inventário conferido na última sexta", font: "Helvetica", size: 22 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200, after: 200 }, children: [new ImageRun({ type: "png", data: imgs[m]!, transformation: { width: 480, height: 225 } })] }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" }, insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" } },
      rows: [
        new TableRow({ tableHeader: true, children: ["Produto", "Entrada", "Saída", "Saldo"].map((t) => cell(t, true)) }),
        ...produtos.map((nome, i) => new TableRow({
          children: [cell(nome), cell(String(num(i, m) + 20)), cell(String(num(i, m))), cell(String(20 + ((i * 13 + m * 7) % 60)))],
        })),
      ],
    }),
    new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240 }, children: [new TextRun({ text: "Observações", font: "Georgia", color: "2E7D5B" })] }),
    ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((k) => new Paragraph({
      spacing: { after: 120 },
      alignment: AlignmentType.JUSTIFIED,
      children: [new TextRun({
        text: `A equipe da loja de exemplo anotou que ${produtos[(m + k) % produtos.length]!.toLowerCase()} teve ${num(k, m)} saídas, `
          + "com mais procura no começo do mês. O depósito dos fundos ganhou duas prateleiras novas, e a contagem da Ana "
          + "bateu com o sistema em quase todos os itens; a diferença ficou no estoque de papelaria, que será recontado.",
        font: "Helvetica", size: 22,
      })],
    })),
  );
}

const doc = new Document({
  creator: "Loja de exemplo",
  title: "Relatório de estoque",
  sections: [{
    properties: { page: { margin: { top: 1200, bottom: 1200, left: 1300, right: 1300 } } },
    headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "Loja de exemplo · Relatório de estoque", color: "777777", size: 18, font: "Helvetica" })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [
      new TextRun({ children: ["Página ", PageNumber.CURRENT, " de ", PageNumber.TOTAL_PAGES], color: "777777", size: 18, font: "Helvetica" }),
    ] })] }) },
    children,
  }],
});
writeFileSync(out, await Packer.toBuffer(doc));
console.log(`ok: ${out}`);
