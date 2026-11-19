// O docx inventado com comentários, controle de alterações e notas de rodapé (T21152, spec #21080), para a ida e volta
// do gravar.ts. Tudo inventado (#17952). bun scripts/docx-prova/make-extras.ts <saida.docx>
import { writeFileSync } from "node:fs";

import {
  CommentRangeEnd, CommentRangeStart, CommentReference, DeletedTextRun, Document, FootnoteReferenceRun, HeadingLevel,
  InsertedTextRun, Packer, Paragraph, TextRun,
} from "docx";

const out = process.argv[2];
if (!out) throw new Error("uso: make-extras.ts <saida.docx>");

const date = "2026-03-02T10:00:00Z";
const comment = (id: number, author: string, text: string) => ({ id, author, initials: author.slice(0, 2).toUpperCase(), date: new Date(date), children: [new Paragraph({ children: [new TextRun(text)] })] });

const doc = new Document({
  creator: "Loja de exemplo",
  comments: { children: [
    comment(0, "Ana", "Confirmar o número com o depósito."),
    comment(1, "Bruno", "Prefiro dizer a semana certa."),
  ] },
  footnotes: {
    1: { children: [new Paragraph("Contagem feita pela Ana na sexta de manhã.")] },
    2: { children: [new Paragraph("Valores sem o frete do fornecedor.")] },
  },
  sections: [{
    children: [
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Revisão do estoque de março")] }),
      new Paragraph({ children: [
        new TextRun("A loja de exemplo recebeu "),
        new CommentRangeStart(0),
        new TextRun("320 cadernos"),
        new CommentRangeEnd(0),
        new TextRun({ children: [new CommentReference(0)] }),
        new TextRun(" e vendeu quase todos"),
        new FootnoteReferenceRun(1),
        new TextRun(". O pedido novo sai "),
        new DeletedTextRun({ id: 10, author: "Bruno", date, text: "na semana que vem" }),
        new InsertedTextRun({ id: 11, author: "Bruno", date, text: "na terça-feira" }),
        new TextRun("."),
      ] }),
      new Paragraph({ children: [
        new TextRun("O orçamento da reposição ficou em R$ 4.800,00"),
        new FootnoteReferenceRun(2),
        new TextRun(", "),
        new CommentRangeStart(1),
        new TextRun("dentro do previsto para o mês"),
        new CommentRangeEnd(1),
        new TextRun({ children: [new CommentReference(1)] }),
        new TextRun("."),
        new InsertedTextRun({ id: 12, author: "Ana", date, text: " A Ana confere as notas fiscais." }),
      ] }),
      new Paragraph({ children: [new TextRun("O depósito dos fundos ganhou duas prateleiras novas para a papelaria.")] }),
    ],
  }],
});
writeFileSync(out, await Packer.toBuffer(doc));
console.log(`ok: ${out}`);
