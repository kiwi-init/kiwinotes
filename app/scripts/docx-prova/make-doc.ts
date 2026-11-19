// O documento inventado da prova do docx (T21151, spec #21080): o relatório de estoque de uma loja de exemplo, com umas
// 20 páginas de título, texto com fonte e cor, lista, tabelas, um gráfico (imagem), cabeçalho e rodapé com o número da
// página. Tudo inventado (#17952). bun scripts/docx-prova/make-doc.ts <saida.docx>
import { writeFileSync } from "node:fs";

import { webkit } from "playwright-core";

import { meses, num, produtos, relatorioDocx } from "./relatorio.ts";

const out = process.argv[2];
if (!out) throw new Error("uso: make-doc.ts <saida.docx>");

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

writeFileSync(out, await relatorioDocx(await charts()));
console.log(`ok: ${out}`);
