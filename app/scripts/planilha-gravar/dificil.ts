// As planilhas difíceis do `planilha-gravar.test.ts` (T23457, spec #21065), todas inventadas: os pedidos de uma
// papelaria. O xlsx é feito à mão no OOXML (como o Excel grava: strings compartilhadas, estilos, fórmulas com o valor
// guardado), com três abas, uma mesclagem, um formato de moeda, uma data e uma fórmula que lê outra aba. O csv e o tsv
// têm aspas, o separador dentro do campo e quebra de linha dentro do campo.

import * as XLSX from "xlsx";

import { readDelimited } from "../../src/shared/sheet/delimited.ts";
import { readXlsx } from "../../src/shared/sheet/xlsx.ts";
import { zipBytes } from "../../test/office-files.ts";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** As abas, na ordem do arquivo. */
export const ABAS = ["Pedidos", "Resumo", "Observações"];

/**
 * A edição pela grade no xlsx: o preço do caderno (C3, na aba Pedidos, com o formato de moeda) passa de 18,50 para 20.
 * Uma célula com estilo: o gravador que perde o estilo do que a pessoa editou não passa.
 */
export const EDICAO_XLSX = { aba: "Pedidos", linha: 2, coluna: 2, antes: 18.5, depois: 20 };

/** O xlsx difícil. */
export function xlsxDificil(): Uint8Array {
  const strings = ["Pedidos da papelaria", "Produto", "Quantidade", "Preço", "Total", "Data", "Caderno", "Caneta azul", "Régua de 30 cm", "Soma", "Total geral", "Itens", "Pedido da Ana, entregue às 9h", "Conferido por Bruno & Carla"];
  const s = (t: string) => strings.indexOf(t);
  // Estilos: 0 geral, 1 negrito, 2 moeda (formato 164), 3 data (formato 14), 4 moeda em negrito.
  const styles =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;R$&quot;\\ #,##0.00"/></numFmts>` +
    `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
    `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/></cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const str = (ref: string, t: string, st = 0) => `<c r="${ref}"${st ? ` s="${st}"` : ""} t="s"><v>${s(t)}</v></c>`;
  const num = (ref: string, v: number, st = 0) => `<c r="${ref}"${st ? ` s="${st}"` : ""}><v>${v}</v></c>`;
  const fx = (ref: string, f: string, v: number, st = 0) => `<c r="${ref}"${st ? ` s="${st}"` : ""}><f>${esc(f)}</f><v>${v}</v></c>`;
  // 2026-03-02, 03 e 04 no número de série do Excel.
  const itens: [string, number, number, number][] = [
    ["Caderno", 10, 18.5, 46083],
    ["Caneta azul", 25, 2.4, 46084],
    ["Régua de 30 cm", 4, 6.75, 46085],
  ];
  const linhas = itens
    .map(([p, q, v, d], i) => {
      const r = i + 3;
      return `<row r="${r}">${str(`A${r}`, p)}${num(`B${r}`, q)}${num(`C${r}`, v, 2)}${fx(`D${r}`, `B${r}*C${r}`, q * v, 2)}${num(`E${r}`, d, 3)}</row>`;
    })
    .join("");
  const total = itens.reduce((a, [, q, v]) => a + q * v, 0);
  const qtd = itens.reduce((a, [, q]) => a + q, 0);
  const sheet = (data: string, extra = "") =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<cols><col min="1" max="1" width="22" customWidth="1"/></cols><sheetData>${data}</sheetData>${extra}</worksheet>`;
  const pedidos = sheet(
    `<row r="1">${str("A1", "Pedidos da papelaria", 1)}</row>` +
      `<row r="2">${["Produto", "Quantidade", "Preço", "Total", "Data"].map((t, i) => str(`${"ABCDE"[i]}2`, t, 1)).join("")}</row>` +
      linhas +
      `<row r="6">${str("A6", "Soma", 1)}${fx("B6", "SUM(B3:B5)", qtd, 1)}${fx("D6", "SUM(D3:D5)", total, 4)}</row>`,
    `<mergeCells count="1"><mergeCell ref="A1:E1"/></mergeCells>`,
  );
  const resumo = sheet(`<row r="1">${str("A1", "Total geral", 1)}${fx("B1", "Pedidos!D6", total, 4)}</row><row r="2">${str("A2", "Itens")}${fx("B2", "COUNTA(Pedidos!A3:A5)", 3)}</row>`);
  const obs = sheet(`<row r="1">${str("A1", "Pedido da Ana, entregue às 9h")}</row><row r="2">${str("A2", "Conferido por Bruno & Carla")}</row>`);
  const rel = (items: [string, string, string][]) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`).join("")}</Relationships>`;
  const ws = "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml";
  return zipBytes(
    {
      "[Content_Types].xml":
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        [1, 2, 3].map((i) => `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="${ws}"/>`).join("") +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`,
      "_rels/.rels": rel([["rId1", "officeDocument", "xl/workbook.xml"]]),
      "xl/workbook.xml":
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
        ABAS.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
        `</sheets><calcPr calcId="191029"/></workbook>`,
      "xl/_rels/workbook.xml.rels": rel([
        ["rId1", "worksheet", "worksheets/sheet1.xml"],
        ["rId2", "worksheet", "worksheets/sheet2.xml"],
        ["rId3", "worksheet", "worksheets/sheet3.xml"],
        ["rId4", "styles", "styles.xml"],
        ["rId5", "sharedStrings", "sharedStrings.xml"],
      ]),
      "xl/worksheets/sheet1.xml": pedidos,
      "xl/worksheets/sheet2.xml": resumo,
      "xl/worksheets/sheet3.xml": obs,
      "xl/styles.xml": styles,
      "xl/sharedStrings.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((t) => `<si><t>${esc(t)}</t></si>`).join("")}</sst>`,
    },
    { deflate: true },
  );
}

/** As linhas do csv e do tsv: aspas, o separador no campo, quebra de linha no campo e um campo vazio. */
export const LINHAS = [
  ["Cliente", "Pedido", "Observação"],
  ["Ana Lima", "Caderno, capa dura", 'Entregar "amanhã"'],
  ["Bruno", "Lápis", "Linha 1\nLinha 2"],
  ["Carla", "Borracha\tbranca", ""],
];

/** A edição pela grade no csv e no tsv: o pedido do Bruno ganha o separador e aspas. */
export const EDICAO_TEXTO = { linha: 2, coluna: 1, antes: "Lápis", depois: 'Lápis, 2 caixas "HB"\tpretas' };

/** O csv (`,`) ou o tsv (tab), com CRLF e as aspas como o Excel grava. */
export function delimitado(sep: "," | "\t"): Uint8Array {
  const campo = (c: string) => (/[",\t\r\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
  return new TextEncoder().encode(LINHAS.map((r) => r.map(campo).join(sep)).join("\r\n") + "\r\n");
}

/** O que importa de uma planilha: as abas, e em cada célula o valor, a fórmula e o formato; as mesclagens. */
export interface Planilha {
  abas: string[];
  celulas: Record<string, { v: unknown; f?: string; z?: string }>;
  mesclas: string[];
}

/** O xlsx lido pelo SheetJS, a segunda biblioteca (outro leitor, não o do Kiwi). */
export function pelaSegunda(bytes: Uint8Array): Planilha {
  const wb = XLSX.read(bytes, { type: "array", cellFormula: true, cellNF: true, cellDates: false });
  const celulas: Planilha["celulas"] = {};
  const mesclas: string[] = [];
  for (const aba of wb.SheetNames) {
    const ws = wb.Sheets[aba]!;
    for (const [ref, c] of Object.entries(ws)) {
      if (ref.startsWith("!")) continue;
      const cell = c as XLSX.CellObject;
      celulas[`${aba}!${ref}`] = { v: cell.v, ...(cell.f ? { f: cell.f } : {}), ...(cell.z && cell.z !== "General" ? { z: String(cell.z) } : {}) };
    }
    for (const m of ws["!merges"] ?? []) mesclas.push(`${aba}!${XLSX.utils.encode_range(m)}`);
  }
  return { abas: wb.SheetNames, celulas, mesclas };
}

/** O mesmo xlsx lido pelo Kiwi (o `readXlsx` da grade). As mesclagens o Kiwi não mostra: ficam de fora. */
export function peloKiwi(bytes: Uint8Array): Omit<Planilha, "mesclas"> {
  const book = readXlsx(bytes, "pedidos.xlsx");
  const celulas: Planilha["celulas"] = {};
  for (const sh of book.sheets) {
    sh.rows.forEach((row, r) =>
      row.forEach((c, k) => {
        if (!c || c.value === null) return;
        celulas[`${sh.name}!${XLSX.utils.encode_cell({ r, c: k })}`] = { v: c.value, ...(c.formula ? { f: c.formula } : {}), ...(c.format && c.format !== "General" ? { z: c.format } : {}) };
      }),
    );
  }
  return { abas: book.sheets.map((s) => s.name), celulas };
}

/** As células que mudaram de `a` para `b` (o endereço e o que mudou), mais as abas e as mesclagens que mudaram. */
export function diferencas(a: Partial<Planilha>, b: Partial<Planilha>): string[] {
  const out: string[] = [];
  if (JSON.stringify(a.abas) !== JSON.stringify(b.abas)) out.push(`abas: ${JSON.stringify(a.abas)} → ${JSON.stringify(b.abas)}`);
  if (JSON.stringify(a.mesclas) !== JSON.stringify(b.mesclas)) out.push(`mesclas: ${JSON.stringify(a.mesclas)} → ${JSON.stringify(b.mesclas)}`);
  const ca = a.celulas ?? {};
  const cb = b.celulas ?? {};
  for (const ref of [...new Set([...Object.keys(ca), ...Object.keys(cb)])].sort()) {
    const x = ca[ref];
    const y = cb[ref];
    for (const k of ["v", "f", "z"] as const) if (JSON.stringify(x?.[k]) !== JSON.stringify(y?.[k])) out.push(`${ref}.${k}`);
  }
  return out;
}

/** O csv ou tsv lido pelo SheetJS: as linhas, cada campo como texto. */
export function linhasPelaSegunda(bytes: Uint8Array, sep: "," | "\t"): string[][] {
  const wb = XLSX.read(new TextDecoder().decode(bytes), { type: "string", raw: true, FS: sep });
  return (XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]!]!, { header: 1, raw: false, defval: "", blankrows: true }) as string[][]).map((r) => r.map(String));
}

/** O mesmo pelo Kiwi (o `readDelimited` da grade), com a linha completada até a última coluna. */
export function linhasPeloKiwi(bytes: Uint8Array, name: string): string[][] {
  const rows = readDelimited(bytes, name).rows;
  const w = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => Array.from({ length: w }, (_, i) => r[i] ?? ""));
}
