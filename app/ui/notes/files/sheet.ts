// A planilha das Notas (T7111, spec #7079), a parte pura: um xlsx vira as abas, cada uma com as linhas e colunas e o
// valor de cada célula como o Excel mostra (a data, a moeda e a porcentagem já formatadas). Um xlsx guarda o resultado
// de cada fórmula ao lado dela, e é esse valor que aparece: nada é recalculado, e nenhuma fórmula roda aqui.
// O SheetJS entra como parâmetro: a tela o carrega sob demanda, e o teste passa o mesmo módulo.

import type * as Xlsx from "xlsx";

import { checkZip } from "./zipSize.ts";

export interface Sheet {
  name: string;
  rows: string[][];
  columns: number;
}

export interface Workbook {
  sheets: Sheet[];
  /** As abas escondidas no Excel, que ficam de fora (só o número, para a tela dizer). */
  hidden: number;
}

/** Linhas lidas de cada aba, no máximo: uma aba de um milhão de linhas não trava a janela. */
export const MAX_ROWS = 100_000;

/** Um xlsx é um zip: começa por `PK\x03\x04`. */
export const isXlsx = (bytes: Uint8Array): boolean => bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;

/** Uma planilha que abre grande demais (a bomba de zip da revisão do T7110): a tela diz e oferece o app padrão. */
export class TooLarge extends Error {}

/**
 * Os separadores do sistema: num Mac em português, a vírgula é o decimal e o ponto separa os milhares. O código de
 * formato do Excel ("#,##0.00") diz só onde vão os separadores, e o Excel usa os do sistema; o SheetJS escreve sempre
 * os dos EUA ("2,099.40"). `","`: o decimal é a vírgula, e os dois trocam de lugar.
 */
export function systemDecimal(locale?: string): "," | "." {
  const part = new Intl.NumberFormat(locale).formatToParts(1.5).find((p) => p.type === "decimal");
  return part?.value === "," ? "," : ".";
}

/** O texto de um número com os separadores do sistema (a data fica como está). */
export function localizeNumber(text: string, decimal: "," | "."): string {
  return decimal === "." ? text : text.replace(/[.,]/g, (c) => (c === "," ? "." : ","));
}

export function readWorkbook(XLSX: typeof Xlsx, bytes: Uint8Array, decimal: "," | "." = systemDecimal()): Workbook & { truncated: boolean } {
  // O SheetJS lê muitos formatos e adivinha pelo conteúdo (um texto qualquer vira csv). Aqui só entra o xlsx.
  if (!isXlsx(bytes)) throw new Error("not an xlsx file");
  // O tamanho aberto, contado de verdade antes do SheetJS (o que o zip declara não vale).
  const zip = checkZip(bytes);
  if (!zip.ok) throw zip.reason === "too-large" ? new TooLarge("the spreadsheet is too large to open here") : new Error("not an xlsx file");
  const book = XLSX.read(bytes, {
    type: "array",
    // Os valores e o texto formatado; nada de estilos, HTML das células, macros nem fórmulas para recalcular.
    cellFormula: false,
    cellHTML: false,
    cellStyles: false,
    bookVBA: false,
    dense: true,
    sheetRows: MAX_ROWS + 1,
  });
  const meta = book.Workbook?.Sheets ?? [];
  let hidden = 0;
  let truncated = false;
  const sheets: Sheet[] = [];
  book.SheetNames.forEach((name, i) => {
    if (meta[i]?.Hidden) {
      hidden++;
      return;
    }
    const ws = book.Sheets[name];
    if (!ws) return;
    // Os números já formatados (`w`) com os separadores do sistema; a data e o texto ficam como estão.
    const dense = (ws as { "!data"?: (Xlsx.CellObject | undefined)[][] })["!data"] ?? [];
    for (const row of dense) {
      for (const cell of row ?? []) {
        if (cell?.t === "n" && typeof cell.w === "string" && !(cell.z !== undefined && XLSX.SSF.is_date(cell.z))) cell.w = localizeNumber(cell.w, decimal);
      }
    }
    // `raw: false`: o texto como o Excel mostra; `defval`: a célula vazia no meio da linha não some.
    const rows = (XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: "", blankrows: true }) as unknown[][]).map((r) =>
      r.map((v) => (v === null || v === undefined ? "" : String(v))),
    );
    // As linhas vazias do fim não são dados.
    while (rows.length && rows.at(-1)!.every((v) => v === "")) rows.pop();
    if (rows.length > MAX_ROWS) {
      rows.length = MAX_ROWS;
      truncated = true;
    }
    const columns = rows.reduce((n, r) => Math.max(n, r.length), 0);
    // Toda linha com a largura da aba: uma linha toda vazia no meio vem como [] e precisa das células vazias.
    for (const r of rows) while (r.length < columns) r.push("");
    sheets.push({ name, rows, columns });
  });
  return { sheets, hidden, truncated };
}
