// Os arquivos inventados do roteiro `ui-scripts/busca-documentos.json` (T22218): um pdf, um docx e um xlsx com a
// palavra "graviola" longe do começo, para a busca achar o lugar e o visualizador abrir nele. Rode antes do
// `cli start`, na pasta de dados vazia:
//
//   bun scripts/busca-documentos-seed.ts DIR
//   bun run cli start --data DIR --no-helper
//   bun run cli ui notes --script scripts/ui-scripts/busca-documentos.json --out DIR/prints --data DIR

import { Document, Packer, Paragraph, TextRun } from "docx";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import * as XLSX from "xlsx";


const dir = process.argv[2];
if (!dir) throw new Error("uso: bun scripts/busca-documentos-seed.ts DIR");
const vault = path.join(dir, "vault");

// O pdf: a palavra só na página 3 de 4.
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
for (let n = 1; n <= 4; n++) {
  const page = pdf.addPage([595, 842]);
  page.drawText(`Feira de exemplo, página ${n}`, { x: 50, y: 780, size: 18, font });
  for (let l = 0; l < 30; l++) page.drawText(`Banca ${n}.${l + 1}: caju, manga e acerola.`, { x: 50, y: 740 - l * 22, size: 11, font });
  if (n === 3) page.drawText("A graviola chegou na sexta.", { x: 50, y: 60, size: 14, font });
}

// O docx: a palavra no parágrafo 30, depois de um título e de 28 itens. Um docx inteiro (o pacote `docx`, como o do
// docx-check), que o motor do visualizador abre.
const par = (t: string) => new Paragraph({ children: [new TextRun(t)] });
const docx = new Uint8Array(
  await Packer.toBuffer(
    new Document({
      sections: [
        {
          children: [
            par("Relatório da feira"),
            ...Array.from({ length: 28 }, (_, i) => par(`Item ${i + 1}: a banca de caju abriu cedo e fechou às seis.`)),
            par("A graviola chegou na sexta, e a banca dela fechou mais tarde."),
            ...Array.from({ length: 20 }, (_, i) => par(`Nota ${i + 1}: sem novidade.`)),
          ],
        },
      ],
    }),
  ),
);

// O xlsx: a palavra na aba de trás, na C40.
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Fruta", "kg"], ["caju", 3], ["manga", 5]]), "Resumo");
const aoa: (string | number)[][] = [["Banca", "Fruta", "Nota"]];
for (let i = 2; i <= 60; i++) aoa.push([`Banca ${i}`, i % 2 ? "caju" : "manga", i === 40 ? "graviola madura" : "ok"]);
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Contagem");
const xlsx = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);

const files: Record<string, Uint8Array> = { "Feira/folheto.pdf": await pdf.save(), "Feira/relatorio.docx": docx, "Feira/bancas.xlsx": xlsx };
for (const [rel, bytes] of Object.entries(files)) {
  mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
  writeFileSync(path.join(vault, rel), bytes);
}
console.log(`${Object.keys(files).length} arquivos em ${vault}`);
