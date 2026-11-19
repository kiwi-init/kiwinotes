// A medida do teto do histórico em bytes (T21239, spec #21160): 50 versões de um xlsx e de um docx de tamanho de
// verdade, inventados (as vendas de uma loja e o relatório de um projeto de exemplo), pelo `NoteVersions` num tmp.
// Cada versão muda uma célula ou um parágrafo, como a pessoa ou o gato fariam, com o relógio andando 3 min entre elas.
// Diz o tamanho de cada arquivo, quanto as 50 ocupam, quantas o teto deixa e quanto leva gravar uma.
//
//   bun scripts/historico-medida.ts            (o teto de agora, MAX_BINARY_BYTES)
//   TETO_MB=100 bun scripts/historico-medida.ts

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";

import { Document, ImageRun, Packer, Paragraph, HeadingLevel } from "docx";
import * as XLSX from "xlsx";

import { MAX_BINARY_BYTES, NoteVersions } from "../src/notes/versions.ts";

const MB = 1024 * 1024;
const cap = process.env.TETO_MB ? Number(process.env.TETO_MB) * MB : MAX_BINARY_BYTES;

/** Uma planilha de vendas inventada: 20.000 linhas, 14 colunas, com texto, números, datas e fórmulas. */
function xlsx(edit: number): Uint8Array {
  const produtos = ["Café", "Açúcar", "Farinha", "Arroz", "Feijão", "Leite", "Pão", "Manteiga", "Queijo", "Suco"];
  const rows: unknown[][] = [["Pedido", "Data", "Loja", "Produto", "Qtd", "Preço", "Desconto", "Total", "Vendedor", "Cidade", "Pago", "Entrega", "Nota", "Margem"]];
  for (let i = 1; i <= 20_000; i++) {
    const qtd = (i * 7) % 40 + 1;
    const preco = ((i * 13) % 900) / 10 + 1;
    rows.push([
      i,
      new Date(Date.UTC(2026, i % 12, (i % 28) + 1)),
      `Loja ${(i % 9) + 1}`,
      produtos[i % produtos.length],
      i === edit ? qtd + 1 : qtd,
      preco,
      (i % 5) / 100,
      { f: `E${i + 1}*F${i + 1}*(1-G${i + 1})` },
      `Vendedor ${(i % 23) + 1}`,
      `Cidade ${String.fromCharCode(65 + (i % 12))}`,
      i % 3 ? "sim" : "não",
      `${(i % 10) + 1} dias`,
      i % 17 ? "" : `pedido de exemplo ${i}`,
      { f: `H${i + 1}*0.18` },
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(rows, { cellDates: true });
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, ws, "Vendas");
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Resumo"], ["Total", { f: "SUM(Vendas!H2:H20001)" }]]), "Resumo");
  return new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx", compression: true }) as ArrayBuffer);
}

/** Um PNG de `w`×`h` com ruído (como uma foto, não comprime): o peso de uma imagem colada num relatório. */
function png(w: number, h: number, seed: number): Uint8Array {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) >>> 16) & 0xff;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w * 3; x++) raw[y * (w * 3 + 1) + 1 + x] = (rnd() & 0x3f) + ((x / 3 + y) % 128);
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

const fotos = [png(900, 600, 7), png(900, 600, 11)];

/** Um relatório inventado: 30 seções de texto e duas imagens, umas 25 páginas. */
async function docx(edit: number): Promise<Uint8Array> {
  const children: Paragraph[] = [new Paragraph({ text: "Relatório do Projeto X", heading: HeadingLevel.TITLE })];
  for (let s = 1; s <= 30; s++) {
    children.push(new Paragraph({ text: `Seção ${s}: andamento`, heading: HeadingLevel.HEADING_1 }));
    for (let p = 0; p < 6; p++)
      children.push(
        new Paragraph(
          `${s === edit && p === 0 ? "(revisado) " : ""}A equipe de exemplo revisou a etapa ${s}.${p} com a Ana e o Bruno. ` +
            "O cronograma segue o combinado, os custos ficaram dentro do previsto e os próximos passos estão na lista abaixo. ".repeat(3),
        ),
      );
    if (s === 10 || s === 20)
      children.push(new Paragraph({ children: [new ImageRun({ type: "png", data: fotos[s === 10 ? 0 : 1]!, transformation: { width: 450, height: 300 } })] }));
  }
  return new Uint8Array(await Packer.toBuffer(new Document({ sections: [{ children }] })));
}

async function measure(name: string, make: (i: number) => Promise<Uint8Array> | Uint8Array) {
  const dir = mkdtempSync(path.join(tmpdir(), "kn-21239-medida-"));
  try {
    let t = Date.parse("2026-11-04T10:00:00.000Z");
    const v = new NoteVersions({ dir, now: () => t, maxBinaryBytes: cap });
    const files: Uint8Array[] = [];
    for (let i = 0; i <= 50; i++) files.push(await make(i + 1));
    const sizes = files.map((f) => f.byteLength);
    let ms = 0;
    for (let i = 1; i <= 50; i++) {
      const start = performance.now();
      await v.record(`Loja/${name}`, files[i]!, i === 1 ? files[0] : undefined);
      ms += performance.now() - start;
      t += 180_000;
    }
    await v.flush(`Loja/${name}`);
    const list = await v.list(`Loja/${name}`);
    const kept = list.reduce((n, x) => n + x.size, 0);
    const all = sizes.reduce((n, x) => n + x, 0);
    const f = (b: number) => `${(b / MB).toFixed(1)} MB`;
    console.log(
      `${name}: ${f(sizes[0]!)} cada; 51 cópias (o original e 50 mudanças) = ${f(all)}; ` +
        `com o teto de ${f(cap)}: ${list.length} versões, ${f(kept)}; ${(ms / 50).toFixed(0)} ms por gravação`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

await measure("vendas.xlsx", xlsx);
await measure("relatorio.docx", docx);
