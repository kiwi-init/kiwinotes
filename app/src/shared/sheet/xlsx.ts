// Ler e gravar um xlsx sem perda (T21107, spec #21065, parte 2). O arquivo é um zip de partes XML; gravar reaplica as
// operações sobre o original e troca só o XML que elas tocam: a aba editada, e o `styles.xml` só quando um formato de
// número novo entra. As outras partes saem com os mesmos bytes (o registro do zip copiado cru, `zip.ts`). O XML é
// editado como texto, elemento por elemento, para o que o Kiwi não conhece (gráficos, extensões, atributos de outros
// programas) atravessar a gravação intacto.
//
// O que não dá para gravar sem perder algo abre só para leitura, com o motivo: senha, macro, ou uma estrutura que o
// Kiwi não conhece. Uma operação que não cabe numa planilha (apagar linha numa aba com comentários) é recusada sozinha,
// com o motivo, e o resto da planilha continua editável.

import { flatOps, shiftOf, type CellValue, checkOp, type SheetOp, SheetOpError } from "./ops.ts";
import { cellName, colIndex, parseCell, renameInFormula, type Shift, shiftFormula, shiftRange, shiftSpan, shiftSqref, moveFormula } from "./refs.ts";
import { partText, readZip, writeZip, type ZipPart, ZipError } from "./zip.ts";

export type ReadOnlyReason = "password" | "macro" | "unknown";

export type Inspection = { editable: true } | { editable: false; reason: ReadOnlyReason; detail: string };

/** O arquivo abre só para leitura; `detail` é a frase que a tela mostra. */
export class XlsxReadOnly extends Error {
  constructor(
    readonly reason: ReadOnlyReason,
    readonly detail: string,
  ) {
    super(detail);
  }
}

/** Se o arquivo pode ser editado, ou por que não. */
export function inspectXlsx(bytes: Uint8Array, name = ""): Inspection {
  try {
    Book.open(bytes, name, true);
    return { editable: true };
  } catch (e) {
    if (e instanceof XlsxReadOnly) return { editable: false, reason: e.reason, detail: e.detail };
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Ler

export interface XlsxCell {
  value: CellValue;
  formula?: string;
  /** O código do formato de número; sem ele, Geral. */
  format?: string;
}

export interface XlsxSheet {
  name: string;
  /** Linha a linha, a partir de 0; o que falta é vazio. */
  rows: (XlsxCell | undefined)[][];
}

export interface XlsxBook {
  sheets: XlsxSheet[];
  names: { name: string; formula: string; sheet?: string }[];
}

/** As abas de planilha (as de gráfico ficam de fora), com as fórmulas compartilhadas abertas, e os nomes definidos. */
export function readXlsx(bytes: Uint8Array, name = ""): XlsxBook {
  const book = Book.open(bytes, name, false);
  const strings = book.sharedStrings();
  const formats = book.cellFormats();
  const sheets: XlsxSheet[] = [];
  const infos = book.sheets();
  for (const info of infos) {
    if (info.kind !== "worksheet") continue;
    const model = parseSheet(expandShared(book.text(info.path)));
    const rows: XlsxSheet["rows"] = [];
    for (const row of model.rows) {
      const out: (XlsxCell | undefined)[] = [];
      for (const c of row.cells) {
        const cell = readCell(c, strings, formats);
        if (cell) out[c.col] = cell;
      }
      rows[row.r] = Array.from(out);
    }
    sheets.push({ name: info.name, rows: Array.from(rows, (r) => r ?? []) });
  }
  const names = elements(book.text(book.workbook), "definedName").map((d) => {
    const local = attr(d.attrs, "localSheetId");
    return { name: unescapeXml(attr(d.attrs, "name") ?? ""), formula: unescapeXml(d.inner ?? ""), ...(local !== null ? { sheet: infos[Number(local)]?.name } : {}) };
  });
  return { sheets, names };
}

function readCell(c: CellM, strings: string[], formats: (string | undefined)[]): XlsxCell | null {
  const t = attr(c.attrs, "t") ?? "n";
  const inner = c.inner ?? "";
  const f = /<f\b[^>]*?(?:\/>|>([\s\S]*?)<\/f>)/.exec(inner);
  const v = /<v\b[^>]*?(?:\/>|>([\s\S]*?)<\/v>)/.exec(inner)?.[1];
  let value: CellValue = null;
  if (t === "inlineStr") value = richText(/<is>([\s\S]*?)<\/is>/.exec(inner)?.[1] ?? "");
  else if (v !== undefined && v !== "") {
    const raw = unescapeXml(v);
    if (t === "s") value = strings[Number(raw)] ?? "";
    else if (t === "b") value = raw === "1";
    else if (t === "str" || t === "e" || t === "d") value = raw;
    else value = Number(raw);
  }
  const s = attr(c.attrs, "s");
  const format = formats[s === null ? 0 : Number(s)];
  const formula = f?.[1] !== undefined && f[1] !== "" ? unescapeXml(f[1]) : undefined;
  if (value === null && formula === undefined && !format) return null;
  return { value, ...(formula !== undefined ? { formula } : {}), ...(format ? { format } : {}) };
}

/** O texto de um `<si>` ou `<is>`: os `<t>`, sem a fonética. */
function richText(xml: string): string {
  let out = "";
  for (const m of xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) out += unescapeXml(m[1] ?? "");
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Gravar

/** O xlsx com as operações aplicadas sobre o original. Lança `XlsxReadOnly` ou `SheetOpError` com o motivo. */
export function patchXlsx(original: Uint8Array, ops: readonly SheetOp[], name = ""): Uint8Array {
  const book = Book.open(original, name, true);
  for (const op of flatOps(ops)) applyOp(book, op);
  return book.save();
}

function applyOp(book: Book, op: Exclude<SheetOp, { op: "batch" }>): void {
  const infos = book.sheets();
  checkOp(op, infos.map((s) => s.name));
  if (op.op === "addSheet") return addSheet(book, op.name);
  const info = infos.find((s) => s.name.toLowerCase() === op.sheet.toLowerCase())!;
  if (op.op === "renameSheet") return renameSheet(book, info, op.name);
  if (info.kind !== "worksheet") throw new SheetOpError(`${info.name} é uma aba de gráfico`);
  if (op.op === "set") return setCell(book, info, op);
  return shiftSheet(book, info, shiftOf(op)!);
}

function setCell(book: Book, info: SheetInfo, input: Extract<SheetOp, { op: "set" }>): void {
  const op = tableHeader(book, info, input);
  let xml = expandShared(book.text(info.path));
  const here = { row: op.row, col: op.col };
  for (const f of elements(xml, "f")) {
    const ref = attr(f.attrs, "ref");
    if (attr(f.attrs, "t") === "array" && ref && inRange(here, ref) && ref.includes(":")) throw new SheetOpError("a célula faz parte de uma fórmula de matriz");
  }
  for (const m of elements(xml, "mergeCell")) {
    const ref = attr(m.attrs, "ref") ?? "";
    const top = parseCell(ref.split(":")[0]!);
    if (inRange(here, ref) && top && (top.row !== op.row || top.col !== op.col)) throw new SheetOpError("a célula está dentro de uma mescla");
  }
  const model = parseSheet(xml);
  let row = model.rows.find((r) => r.r === op.row);
  if (!row) {
    row = { r: op.row, attrs: ` r="${op.row + 1}"`, cells: [], selfClosing: false };
    model.rows.push(row);
    model.rows.sort((a, b) => a.r - b.r);
  }
  let cell = row.cells.find((c) => c.col === op.col);
  const hadFormula = !!cell && /<f\b/.test(cell.inner ?? "");
  if (!cell) {
    cell = { col: op.col, attrs: "", inner: null };
    row.cells.push(cell);
    row.cells.sort((a, b) => a.col - b.col);
    row.attrs = delAttr(row.attrs, "spans");
  }
  let style = attr(cell.attrs, "s");
  if (op.format) style = String(book.ensureFormat(style === null ? 0 : Number(style), op.format));
  const written = cellContent(op.value, op.formula);
  if (!written && (style === null || style === "0")) row.cells.splice(row.cells.indexOf(cell), 1);
  else {
    let attrs = delAttr(delAttr(delAttr(cell.attrs, "t"), "cm"), "vm");
    attrs = style === null ? delAttr(attrs, "s") : setAttr(attrs, "s", style);
    if (written?.t) attrs = setAttr(attrs, "t", written.t);
    cell.attrs = attrs;
    cell.inner = written?.inner ?? null;
  }
  model.head = model.head.replace(/<dimension\b([^>]*?)\/>/, (m, attrs: string) => {
    const ref = attr(attrs, "ref");
    return ref ? `<dimension${setAttr(attrs, "ref", growRange(ref, here))}/>` : m;
  });
  book.setText(info.path, serializeSheet(model));
  if (hadFormula || op.formula !== undefined) book.formulasChanged();
}

/**
 * A célula é o cabeçalho de uma tabela (revisão do T21107): o Excel exige que ela bata com o `tableColumn name`, senão
 * repara o arquivo. O nome novo vai para a tabela e para as referências estruturadas (`Tabela1[Nome]`) das fórmulas, dos
 * nomes definidos, das colunas calculadas e dos gráficos. Como no Excel, o cabeçalho é texto (número vira texto), e um
 * nome repetido na tabela ganha um número (`Qtd2`). Vazio ou fórmula no cabeçalho são recusados com o motivo.
 */
function tableHeader(book: Book, info: SheetInfo, op: Extract<SheetOp, { op: "set" }>): Extract<SheetOp, { op: "set" }> {
  for (const r of book.rels(info.path).filter((r) => r.type.endsWith("/table"))) {
    const t = book.text(r.path);
    const tAttrs = /<table\b([^>]*)>/.exec(t)?.[1] ?? "";
    const ends = rangeEnds(attr(tAttrs, "ref") ?? "");
    if (!ends || attr(tAttrs, "headerRowCount") === "0") continue;
    const [p, q] = ends;
    if (op.row !== p.row || op.col < p.col! || op.col > q.col!) continue;
    if (op.formula !== undefined) throw new SheetOpError("o cabeçalho de uma tabela não leva fórmula");
    const typed = op.value === null ? "" : typeof op.value === "boolean" ? (op.value ? "VERDADEIRO" : "FALSO") : String(op.value);
    if (!typed.trim()) throw new SheetOpError("o cabeçalho de uma tabela não pode ficar vazio");
    const columns = elements(t, "tableColumn").map((c) => unescapeXml(attr(c.attrs, "name") ?? ""));
    const index = op.col - p.col!;
    const from = columns[index];
    if (from === undefined) continue;
    const taken = new Set(columns.filter((_, i) => i !== index).map((c) => c.toLowerCase()));
    let name = typed;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${typed}${n}`;
    if (name !== from) {
      let i = 0;
      const attrValue = escapeXml(name).replace(/\n/g, "&#10;").replace(/\r/g, "&#13;");
      book.setText(r.path, editTags(t, ["tableColumn"], (a) => (i++ === index ? setAttr(a, "name", attrValue) : a)));
      renameColumnEverywhere(book, unescapeXml(attr(tAttrs, "displayName") ?? attr(tAttrs, "name") ?? ""), from, name);
    }
    return { op: "set", sheet: op.sheet, row: op.row, col: op.col, value: name, ...(op.format ? { format: op.format } : {}) };
  }
  return op;
}

function renameColumnEverywhere(book: Book, table: string, from: string, to: string): void {
  if (!table) return;
  const f = (x: string) => renameTableColumn(x, table, from, to);
  let changed = false;
  const edit = (path: string, next: (xml: string) => string) => {
    const before = book.text(path);
    const after = next(before);
    if (after !== before) {
      book.setText(path, after);
      changed = true;
    }
  };
  edit(book.workbook, (xml) => mapElements(xml, "definedName", (_, inner) => escapeXml(f(unescapeXml(inner)))));
  for (const sheet of book.sheets()) {
    if (sheet.kind !== "worksheet") continue;
    edit(sheet.path, (xml) => mapFormulas(xml, f));
    for (const r of book.rels(sheet.path).filter((r) => r.type.endsWith("/table"))) {
      edit(r.path, (xml) => ["calculatedColumnFormula", "totalsRowFormula"].reduce((x, tag) => mapElements(x, tag, (_, inner) => escapeXml(f(unescapeXml(inner)))), xml));
    }
  }
  for (const chart of book.charts()) edit(chart, (xml) => mapFormulas(xml, f));
  if (changed) book.formulasChanged();
}

/**
 * Troca a coluna `from` por `to` nas referências estruturadas da tabela `table` (`Tabela1[Nome]`,
 * `Tabela1[[#This Row],[Nome]]`, `Tabela1[[Nome]:[Qtd]]`), fora do texto entre aspas. Dentro dos colchetes, `'` escapa
 * o caractere seguinte (`[`, `]`, `#` e `'`).
 */
export function renameTableColumn(formula: string, table: string, from: string, to: string): string {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const unesc = (n: string) => n.replace(/'(.)/g, "$1");
  const esc = (n: string) => n.replace(/['#[\]]/g, "'$&");
  const close = (text: string, open: number) => {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
      if (text[i] === "'") i++;
      else if (text[i] === "[") depth++;
      else if (text[i] === "]" && --depth === 0) return i;
    }
    return -1;
  };
  const column = (spec: string) => (!spec.startsWith("#") && same(unesc(spec), from) ? esc(to) : spec);
  let out = "";
  for (let i = 0; i < formula.length; ) {
    if (formula[i] === '"') {
      let j = i + 1;
      while (j < formula.length && !(formula[j] === '"' && formula[j + 1] !== '"')) j += formula[j] === '"' ? 2 : 1;
      out += formula.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    const open = i + table.length;
    if (same(formula.slice(i, open), table) && formula[open] === "[" && !/[\w.\\]/.test(formula[i - 1] ?? "")) {
      const end = close(formula, open);
      if (end < 0) return out + formula.slice(i);
      const inner = formula.slice(open + 1, end);
      let next = "";
      if (!inner.startsWith("[")) next = column(inner);
      else
        for (let k = 0; k < inner.length; ) {
          if (inner[k] !== "[") {
            next += inner[k++];
            continue;
          }
          const e = close(inner, k);
          if (e < 0) {
            next += inner.slice(k);
            break;
          }
          next += `[${column(inner.slice(k + 1, e))}]`;
          k = e + 1;
        }
      out += `${formula.slice(i, open)}[${next}]`;
      i = end + 1;
      continue;
    }
    out += formula[i++];
  }
  return out;
}

/** O conteúdo de uma célula nova: os filhos e o tipo; `null` para a vazia. */
function cellContent(value: CellValue, formula?: string): { inner: string; t?: string } | null {
  const v = (s: string) => `<v>${s}</v>`;
  if (formula !== undefined) {
    const f = `<f>${escapeXml(formula)}</f>`;
    if (value === null) return { inner: f };
    if (typeof value === "number") return { inner: f + v(numberText(value)) };
    if (typeof value === "boolean") return { inner: f + v(value ? "1" : "0"), t: "b" };
    return { inner: f + v(escapeXml(value)), t: ERRORS.has(value) ? "e" : "str" };
  }
  if (value === null) return null;
  if (typeof value === "number") return { inner: v(numberText(value)) };
  if (typeof value === "boolean") return { inner: v(value ? "1" : "0"), t: "b" };
  const space = /^\s|\s$|\n/.test(value) ? ' xml:space="preserve"' : "";
  return { inner: `<is><t${space}>${escapeXml(value)}</t></is>`, t: "inlineStr" };
}

const ERRORS = new Set(["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A", "#GETTING_DATA", "#SPILL!", "#CALC!"]);

function numberText(n: number): string {
  return String(n).replace("e", "E");
}

/** Linhas ou colunas entrando ou saindo de uma aba: as células, e tudo que aponta para elas no arquivo. */
function shiftSheet(book: Book, info: SheetInfo, s: Shift): void {
  const what = s.axis === "row" ? (s.count > 0 ? "inserir linhas" : "apagar linhas") : s.count > 0 ? "inserir colunas" : "apagar colunas";
  const rels = book.rels(info.path);
  let xml = expandShared(book.text(info.path));
  // O que o Kiwi não sabe mover junto: recusa a operação, e a planilha continua editável.
  if (book.has(/^xl\/pivot(Cache|Table)s\//)) throw new SheetOpError(`não dá para ${what}: a planilha tem tabela dinâmica`);
  if (/<legacyDrawing\b/.test(xml) || rels.some((r) => /\/(comments|threadedComment)s?$/.test(r.type))) throw new SheetOpError(`não dá para ${what}: a aba tem comentários`);
  if (/<f\b[^>]*\bt="dataTable"/.test(xml)) throw new SheetOpError(`não dá para ${what}: a aba tem tabela de dados (teste de hipóteses)`);
  for (const f of elements(xml, "f")) {
    const ref = attr(f.attrs, "ref");
    if (attr(f.attrs, "t") !== "array" || !ref) continue;
    const next = shiftRange(ref, s);
    if (next !== null && spanOf(next, s.axis) !== spanOf(ref, s.axis)) throw new SheetOpError(`não dá para ${what} no meio de uma fórmula de matriz`);
  }
  const filter = elements(xml, "autoFilter")[0];
  if (s.axis === "col" && filter?.inner && crosses(attr(filter.attrs, "ref") ?? "", s)) throw new SheetOpError(`não dá para ${what} dentro de um filtro aplicado`);
  const tables = rels.filter((r) => r.type.endsWith("/table")).map((r) => r.path);
  const tableXml = new Map<string, string>();
  for (const path of tables) {
    const t = book.text(path);
    const ref = attr(/<table\b([^>]*)>/.exec(t)?.[1] ?? "", "ref") ?? "";
    if (s.axis === "col" && crosses(ref, s)) throw new SheetOpError(`não dá para ${what} dentro de uma tabela`);
    const next = shiftRange(ref, s);
    if (next === null || spanOf(next, "row") < 2) throw new SheetOpError(`não dá para ${what}: uma tabela ficaria sem linhas`);
    // O cabeçalho e a linha de totais só saem com a tabela inteira (revisão do T21107): sem eles, a primeira linha de dados
    // viraria o cabeçalho, e os `tableColumn` não bateriam mais.
    const tAttrs = /<table\b([^>]*)>/.exec(t)?.[1] ?? "";
    const ends = rangeEnds(ref);
    const gone = (row: number | undefined) => s.axis === "row" && s.count < 0 && row !== undefined && row >= s.at && row <= s.at - s.count - 1;
    if (attr(tAttrs, "headerRowCount") !== "0" && gone(ends?.[0].row)) throw new SheetOpError(`não dá para ${what}: o cabeçalho de uma tabela sairia sem ela`);
    if (Number(attr(tAttrs, "totalsRowCount") ?? "0") > 0 && gone(ends?.[1].row)) throw new SheetOpError(`não dá para ${what}: a linha de totais de uma tabela sairia sem ela`);
    tableXml.set(path, editTags(t, ["table", "autoFilter", "sortState"], (attrs) => mapAttr(attrs, "ref", (r) => shiftRange(r, s) ?? r)));
  }

  // As fórmulas desta aba (e o `ref` das de matriz).
  xml = mapFormulas(xml, (f) => shiftFormula(f, info.name, info.name, s), (attrs) => mapAttr(attrs, "ref", (r) => shiftRange(r, s) ?? r));
  xml = mapElements(xml, "xm:sqref", (_, inner) => shiftSqref(inner, s));

  const model = parseSheet(xml);
  model.rows = moveRows(model.rows, s);
  model.head = editSheetHead(model.head, s);
  model.tail = editSheetTail(model.tail, s);
  book.setText(info.path, serializeSheet(model));
  for (const [path, t] of tableXml) book.setText(path, t);

  // Os desenhos (gráficos e imagens) ancorados na aba andam junto.
  for (const r of rels.filter((r) => r.type.endsWith("/drawing"))) book.setText(r.path, shiftAnchors(book.text(r.path), s));

  // Tudo que aponta para esta aba de fora: as outras abas, os nomes definidos e os gráficos.
  for (const other of book.sheets()) {
    if (other.kind !== "worksheet" || other.path === info.path) continue;
    const before = expandShared(book.text(other.path));
    const after = mapFormulas(before, (f) => shiftFormula(f, other.name, info.name, s));
    if (after !== before) book.setText(other.path, after);
  }
  book.setText(book.workbook, mapElements(book.text(book.workbook), "definedName", (_, inner) => escapeXml(shiftFormula(unescapeXml(inner), null, info.name, s))));
  for (const chart of book.charts()) book.setText(chart, mapFormulas(book.text(chart), (f) => shiftFormula(f, null, info.name, s)));
  book.formulasChanged();
}

function moveRows(rows: RowM[], s: Shift): RowM[] {
  const n = Math.abs(s.count);
  const gone = (i: number) => s.count < 0 && i >= s.at && i < s.at + n;
  const moved = (i: number) => (i >= s.at ? i + s.count : i);
  if (s.axis === "row") {
    return rows.filter((r) => !gone(r.r)).map((r) => ({ ...r, r: moved(r.r) }));
  }
  return rows.map((r) => ({
    ...r,
    attrs: delAttr(r.attrs, "spans"),
    cells: r.cells.filter((c) => !gone(c.col)).map((c) => ({ ...c, col: moved(c.col) })),
  }));
}

/** O que vem antes de `<sheetData>`: a dimensão, o painel congelado, a seleção e as larguras das colunas. */
function editSheetHead(head: string, s: Shift): string {
  head = editTags(head, ["dimension"], (attrs) => mapAttr(attrs, "ref", (r) => shiftRange(r, s) ?? "A1"));
  head = editTags(head, ["pane"], (attrs) => mapAttr(attrs, "topLeftCell", (r) => shiftRange(r, s) ?? r));
  head = editTags(head, ["selection"], (attrs) => mapAttr(mapAttr(attrs, "activeCell", (r) => shiftRange(r, s) ?? r), "sqref", (r) => shiftSqref(r, s) || r));
  if (s.axis === "col") {
    head = mapElementsWhole(head, "col", (attrs) => {
      const min = Number(attr(attrs, "min"));
      const max = Number(attr(attrs, "max"));
      if (!min || !max) return null;
      const span = shiftSpan(min - 1, max - 1, s);
      if (!span) return "";
      return `<col${setAttr(setAttr(attrs, "min", String(span[0] + 1)), "max", String(span[1] + 1))}/>`;
    });
    head = head.replace(/<cols\b[^>]*>\s*<\/cols>/, "");
  }
  return head;
}

/** O que vem depois de `<sheetData>`: filtro, mesclas, formatação condicional, validação, links e erros ignorados. */
function editSheetTail(tail: string, s: Shift): string {
  tail = mapElementsWhole(tail, "autoFilter", (attrs, _inner, whole) => {
    const ref = attr(attrs, "ref");
    if (!ref) return null;
    const next = shiftRange(ref, s);
    return next === null ? "" : whole.replace(attrs, setAttr(attrs, "ref", next));
  });
  tail = mapElementsWhole(tail, "mergeCell", (attrs) => {
    const next = shiftRange(attr(attrs, "ref") ?? "", s);
    if (next === null) return "";
    const [a, b] = next.split(":");
    return a === b || !b ? "" : `<mergeCell${setAttr(attrs, "ref", next)}/>`;
  });
  tail = recount(tail, "mergeCells", "mergeCell");
  for (const name of ["conditionalFormatting", "dataValidation", "hyperlink", "ignoredError", "protectedRange"]) {
    const key = name === "hyperlink" ? "ref" : "sqref";
    tail = mapElementsWhole(tail, name, (attrs, _inner, whole) => {
      const value = attr(attrs, key);
      if (value === null) return null;
      const next = key === "ref" ? (shiftRange(value, s) ?? "") : shiftSqref(value, s);
      return next === "" ? "" : whole.replace(attrs, setAttr(attrs, key, next));
    });
  }
  tail = recount(tail, "dataValidations", "dataValidation");
  tail = tail.replace(/<hyperlinks\b[^>]*>\s*<\/hyperlinks>/, "").replace(/<ignoredErrors\b[^>]*>\s*<\/ignoredErrors>/, "").replace(/<protectedRanges\b[^>]*>\s*<\/protectedRanges>/, "");
  return tail;
}

/** O `count` de um contêiner depois de tirar filhos; sem filho nenhum, o contêiner sai (o esquema pede ao menos um). */
function recount(xml: string, container: string, child: string): string {
  return mapElementsWhole(xml, container, (attrs, inner) => {
    const n = elements(inner ?? "", child).length;
    if (!n) return "";
    return `<${container}${attr(attrs, "count") !== null ? setAttr(attrs, "count", String(n)) : attrs}>${inner}</${container}>`;
  });
}

/** As âncoras de um desenho: `<from>` e `<to>` andam com as linhas ou colunas; o que caía no que saiu para no ponto. */
function shiftAnchors(xml: string, s: Shift): string {
  const tag = s.axis === "row" ? "row" : "col";
  return xml.replace(/<((?:\w+:)?)(from|to)>([\s\S]*?)<\/\1\2>/g, (_whole, p: string, which: string, inner: string) => {
    const next = inner.replace(new RegExp(`<(${escapeRe(p)}${tag})>(\\d+)</\\1>`), (_, t: string, v: string) => {
      const i = Number(v);
      const n = Math.abs(s.count);
      const out = s.count > 0 ? (i >= s.at ? i + n : i) : i >= s.at + n ? i - n : i >= s.at ? s.at : i;
      return `<${t}>${out}</${t}>`;
    });
    return `<${p}${which}>${next}</${p}${which}>`;
  });
}

function renameSheet(book: Book, info: SheetInfo, name: string): void {
  if (info.name === name) return;
  const from = info.name;
  book.setText(
    book.workbook,
    mapElementsWhole(book.text(book.workbook), "sheet", (attrs) => (unescapeXml(attr(attrs, "name") ?? "") === from ? `<sheet${setAttr(attrs, "name", escapeXml(name))}/>` : null)),
  );
  book.setText(book.workbook, mapElements(book.text(book.workbook), "definedName", (_, inner) => escapeXml(renameInFormula(unescapeXml(inner), from, name))));
  for (const other of book.sheets()) {
    if (other.kind !== "worksheet") continue;
    const before = book.text(other.path);
    const after = mapFormulas(before, (f) => renameInFormula(f, from, name));
    if (after !== before) book.setText(other.path, after);
  }
  for (const chart of book.charts()) book.setText(chart, mapFormulas(book.text(chart), (f) => renameInFormula(f, from, name)));
}

const WORKSHEET_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function addSheet(book: Book, name: string): void {
  let n = 1;
  while (book.exists(`xl/worksheets/sheet${n}.xml`)) n++;
  const path = `xl/worksheets/sheet${n}.xml`;
  book.setText(
    path,
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL_NS}"><dimension ref="A1"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><sheetData/><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`,
  );
  book.setText("[Content_Types].xml", book.text("[Content_Types].xml").replace("</Types>", `<Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`));
  const relsPath = relsOf(book.workbook);
  const rels = book.text(relsPath);
  const ids = new Set([...rels.matchAll(/\bId="([^"]*)"/g)].map((m) => m[1]!));
  let k = ids.size + 1;
  while (ids.has(`rId${k}`)) k++;
  const id = `rId${k}`;
  const base = book.workbook.slice(0, book.workbook.lastIndexOf("/") + 1);
  const target = path.startsWith(base) ? path.slice(base.length) : `/${path}`;
  book.setText(relsPath, rels.replace("</Relationships>", `<Relationship Id="${id}" Type="${WORKSHEET_TYPE}" Target="${target}"/></Relationships>`));
  const wb = book.text(book.workbook);
  const sheetIds = [...wb.matchAll(/<sheet\b[^>]*?\ssheetId="(\d+)"/g)].map((m) => Number(m[1]));
  const prefix = new RegExp(`xmlns:(\\w+)="${escapeRe(REL_NS)}"`).exec(/<workbook\b[^>]*>/.exec(wb)?.[0] ?? "")?.[1];
  const idAttr = prefix ? `${prefix}:id="${id}"` : `xmlns:r="${REL_NS}" r:id="${id}"`;
  const sheet = `<sheet name="${escapeXml(name)}" sheetId="${Math.max(0, ...sheetIds) + 1}" ${idAttr}/>`;
  book.setText(book.workbook, wb.replace(/<\/sheets>/, `${sheet}</sheets>`));
}

// ---------------------------------------------------------------------------------------------------------------------
// O pacote

interface SheetInfo {
  name: string;
  path: string;
  kind: "worksheet" | "chartsheet" | "other";
}

interface Rel {
  id: string;
  type: string;
  path: string;
  external: boolean;
}

/** A pasta aberta: as partes do zip, o texto de cada uma (lido quando precisa) e o que mudou. */
class Book {
  private readonly byName: Map<string, ZipPart>;
  private readonly cache = new Map<string, string>();
  private readonly dirty = new Map<string, string>();
  private readonly removed = new Set<string>();
  readonly workbook: string;

  private constructor(
    private readonly bytes: Uint8Array,
    private readonly parts: ZipPart[],
  ) {
    this.byName = new Map(parts.map((p) => [p.name, p]));
    const root = this.relsAt("_rels/.rels", "").find((r) => r.type.endsWith("/officeDocument"));
    if (!root || !this.byName.has(root.path)) throw new XlsxReadOnly("unknown", "a planilha não tem a parte principal (workbook)");
    this.workbook = root.path;
  }

  /** `check`: confere tudo o que impede gravar sem perda (senha, macro, estrutura); sem ele, só o que impede ler. */
  static open(bytes: Uint8Array, name: string, check: boolean): Book {
    if (bytes.length >= 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
      throw new XlsxReadOnly("password", "a planilha tem senha para abrir");
    }
    if (check && /\.(xlsm|xltm|xlam)$/i.test(name)) throw new XlsxReadOnly("macro", "a planilha tem macros");
    let parts: ZipPart[];
    try {
      parts = readZip(bytes);
    } catch (e) {
      if (e instanceof ZipError) throw new XlsxReadOnly("unknown", "o arquivo não é um xlsx que o Kiwi saiba ler");
      throw e;
    }
    let book: Book;
    try {
      if (!parts.some((p) => p.name === "[Content_Types].xml")) throw new XlsxReadOnly("unknown", "a planilha não tem a lista de partes ([Content_Types].xml)");
      book = new Book(bytes, parts);
      const wb = book.text(book.workbook);
      if (/purl\.oclc\.org\/ooxml/.test(wb)) throw new XlsxReadOnly("unknown", "a planilha está no formato Strict, que o Kiwi não grava");
      if (!/^(<\?xml[^>]*\?>\s*)?<workbook[\s>]/.test(wb.replace(/^﻿/, ""))) throw new XlsxReadOnly("unknown", "a planilha usa uma estrutura que o Kiwi não conhece");
      if (!check) return book;
      if (parts.some((p) => /vbaProject\.bin$/i.test(p.name)) || /macroEnabled/i.test(book.text("[Content_Types].xml"))) {
        throw new XlsxReadOnly("macro", "a planilha tem macros");
      }
      const protection = /<workbookProtection\b([^>]*)>/.exec(wb)?.[1] ?? "";
      if (/\b(lockStructure|lockWindows)="(1|true)"/.test(protection) || /\b(workbookPassword|workbookHashValue)=/.test(protection)) {
        throw new XlsxReadOnly("password", "a estrutura da planilha está protegida por senha");
      }
      for (const s of book.sheets()) {
        if (s.kind !== "worksheet") continue;
        const x = book.text(s.path);
        if (!/^(<\?xml[^>]*\?>\s*)?<worksheet[\s>]/.test(x.replace(/^﻿/, ""))) throw new XlsxReadOnly("unknown", `a aba ${s.name} usa uma estrutura que o Kiwi não conhece`);
        const sp = /<sheetProtection\b([^>]*)>/.exec(x)?.[1];
        if (sp !== undefined && /\bsheet="(1|true)"/.test(sp)) throw new XlsxReadOnly("password", `a aba ${s.name} está protegida`);
      }
    } catch (e) {
      if (e instanceof ZipError) throw new XlsxReadOnly("unknown", "uma parte da planilha está danificada");
      throw e;
    }
    return book;
  }

  exists(name: string): boolean {
    return !this.removed.has(name) && (this.dirty.has(name) || this.byName.has(name));
  }

  has(pattern: RegExp): boolean {
    return this.parts.some((p) => pattern.test(p.name) && !this.removed.has(p.name));
  }

  text(name: string): string {
    const d = this.dirty.get(name);
    if (d !== undefined) return d;
    let t = this.cache.get(name);
    if (t === undefined) {
      const part = this.byName.get(name);
      if (!part || this.removed.has(name)) throw new XlsxReadOnly("unknown", `a planilha não tem a parte ${name}`);
      t = partText(this.bytes, part);
      this.cache.set(name, t);
    }
    return t;
  }

  setText(name: string, text: string): void {
    this.dirty.set(name, text);
  }

  remove(name: string): void {
    this.removed.add(name);
    this.dirty.delete(name);
  }

  rels(source: string): Rel[] {
    const path = relsOf(source);
    if (!this.exists(path)) return [];
    return this.relsAt(path, source.slice(0, source.lastIndexOf("/") + 1));
  }

  private relsAt(path: string, base: string): Rel[] {
    if (!this.exists(path)) return [];
    return elements(this.text(path), "Relationship").map((r) => {
      const target = unescapeXml(attr(r.attrs, "Target") ?? "");
      const external = attr(r.attrs, "TargetMode") === "External";
      return { id: attr(r.attrs, "Id") ?? "", type: attr(r.attrs, "Type") ?? "", path: external ? target : resolvePath(base, target), external };
    });
  }

  sheets(): SheetInfo[] {
    const rels = this.rels(this.workbook);
    return elements(this.text(this.workbook), "sheet").map((s) => {
      const id = /\s[\w]+:id="([^"]*)"/.exec(s.attrs)?.[1];
      const rel = rels.find((r) => r.id === id);
      const kind = rel?.type.endsWith("/worksheet") ? "worksheet" : rel?.type.endsWith("/chartsheet") ? "chartsheet" : "other";
      return { name: unescapeXml(attr(s.attrs, "name") ?? ""), path: rel?.path ?? "", kind };
    });
  }

  charts(): string[] {
    return this.parts.map((p) => p.name).filter((n) => /^xl\/charts\/chart[^/]*\.xml$/.test(n) && !this.removed.has(n));
  }

  private stylesPath(): string | null {
    return this.rels(this.workbook).find((r) => r.type.endsWith("/styles"))?.path ?? null;
  }

  sharedStrings(): string[] {
    const path = this.rels(this.workbook).find((r) => r.type.endsWith("/sharedStrings"))?.path;
    if (!path || !this.exists(path)) return [];
    return elements(this.text(path), "si").map((si) => richText(si.inner ?? ""));
  }

  /** O código do formato de cada estilo de célula (`s`), `undefined` para o Geral. */
  cellFormats(): (string | undefined)[] {
    const path = this.stylesPath();
    if (!path) return [];
    const xml = this.text(path);
    const custom = new Map(elements(xml, "numFmt").map((f) => [Number(attr(f.attrs, "numFmtId")), unescapeXml(attr(f.attrs, "formatCode") ?? "")]));
    const xfs = elements(/<cellXfs\b[\s\S]*?<\/cellXfs>/.exec(xml)?.[0] ?? "", "xf");
    return xfs.map((xf) => {
      const id = Number(attr(xf.attrs, "numFmtId") ?? 0);
      return id === 0 ? undefined : (custom.get(id) ?? BUILTIN_FORMATS[id]);
    });
  }

  /**
   * O estilo de célula igual a `base`, mas com o formato de número `code`: reaproveita um que já existe, ou cria (e um
   * `numFmt` com id ≥ 164 se o código não é um dos embutidos).
   */
  ensureFormat(base: number, code: string): number {
    const path = this.stylesPath();
    if (!path) throw new SheetOpError("a planilha não tem estilos para guardar o formato");
    let xml = this.text(path);
    let id = Number(Object.entries(BUILTIN_FORMATS).find(([, c]) => c === code)?.[0] ?? NaN);
    if (Number.isNaN(id)) {
      const fmts = elements(xml, "numFmt");
      const same = fmts.find((f) => unescapeXml(attr(f.attrs, "formatCode") ?? "") === code);
      if (same) id = Number(attr(same.attrs, "numFmtId"));
      else {
        id = Math.max(163, ...fmts.map((f) => Number(attr(f.attrs, "numFmtId")))) + 1;
        const fmt = `<numFmt numFmtId="${id}" formatCode="${escapeXml(code)}"/>`;
        if (/<numFmts\b/.test(xml)) {
          xml = xml.replace(/<numFmts\b([^>]*?)(\/>|>([\s\S]*?)<\/numFmts>)/, (_, attrs: string, _end: string, inner = "") => `<numFmts${setAttr(attrs, "count", String(fmts.length + 1))}>${inner}${fmt}</numFmts>`);
        } else xml = xml.replace(/(<styleSheet\b[^>]*>)/, `$1<numFmts count="1">${fmt}</numFmts>`);
      }
    }
    const block = /<cellXfs\b([^>]*)>([\s\S]*?)<\/cellXfs>/.exec(xml);
    if (!block) throw new SheetOpError("a planilha não tem estilos de célula");
    const xfs = elements(block[2]!, "xf");
    const from = xfs[base] ?? xfs[0]!;
    if (Number(attr(from.attrs, "numFmtId") ?? 0) === id) {
      this.setText(path, xml);
      return xfs[base] ? base : 0;
    }
    const attrs = setAttr(setAttr(from.attrs, "numFmtId", String(id)), "applyNumberFormat", "1");
    const next = from.inner === null ? `<xf${attrs}/>` : `<xf${attrs}>${from.inner}</xf>`;
    const same = xfs.findIndex((x) => x.whole === next);
    if (same >= 0) {
      this.setText(path, xml);
      return same;
    }
    xml = xml.replace(block[0], `<cellXfs${setAttr(block[1]!, "count", String(xfs.length + 1))}>${block[2]}${next}</cellXfs>`);
    this.setText(path, xml);
    return xfs.length;
  }

  /** Uma fórmula mudou: a cadeia de cálculo sai (o Excel pediria reparo) e o cálculo roda ao abrir. */
  formulasChanged(): void {
    const relsPath = relsOf(this.workbook);
    const chain = this.rels(this.workbook).find((r) => r.type.endsWith("/calcChain"));
    if (chain) {
      this.remove(chain.path);
      this.setText("[Content_Types].xml", this.text("[Content_Types].xml").replace(new RegExp(`<Override\\b[^>]*PartName="/${escapeRe(chain.path)}"[^>]*/>`), ""));
      this.setText(relsPath, mapElementsWhole(this.text(relsPath), "Relationship", (attrs) => (attr(attrs, "Id") === chain.id ? "" : null)));
    }
    const wb = this.text(this.workbook);
    if (/<calcPr\b[^>]*\bfullCalcOnLoad="(1|true)"/.test(wb)) return;
    if (/<calcPr\b/.test(wb)) this.setText(this.workbook, editTags(wb, ["calcPr"], (a) => setAttr(a, "fullCalcOnLoad", "1")));
    else {
      const anchor = ["</definedNames>", "</externalReferences>", "</sheets>"].find((t) => wb.includes(t))!;
      this.setText(this.workbook, wb.replace(anchor, `${anchor}<calcPr fullCalcOnLoad="1"/>`));
    }
  }

  save(): Uint8Array {
    const changed = new Map<string, Uint8Array>();
    for (const [name, text] of this.dirty) {
      // Uma parte que voltou ao texto original (desfazer dentro do mesmo lote) sai crua, como as outras.
      const part = this.byName.get(name);
      if (part && text === (this.cache.get(name) ?? partText(this.bytes, part))) continue;
      changed.set(name, new TextEncoder().encode(text));
    }
    return writeZip(this.bytes, this.parts, changed, this.removed);
  }
}

/** A parte de relações de uma parte: `xl/workbook.xml` → `xl/_rels/workbook.xml.rels`. */
function relsOf(path: string): string {
  const i = path.lastIndexOf("/");
  return `${path.slice(0, i + 1)}_rels/${path.slice(i + 1)}.rels`;
}

function resolvePath(base: string, target: string): string {
  const parts = (target.startsWith("/") ? target.slice(1) : base + target).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p !== "." && p !== "") out.push(p);
  }
  return out.join("/");
}

const BUILTIN_FORMATS: Record<number, string> = {
  1: "0",
  2: "0.00",
  3: "#,##0",
  4: "#,##0.00",
  9: "0%",
  10: "0.00%",
  11: "0.00E+00",
  12: "# ?/?",
  13: "# ??/??",
  14: "mm-dd-yy",
  15: "d-mmm-yy",
  16: "d-mmm",
  17: "mmm-yy",
  18: "h:mm AM/PM",
  19: "h:mm:ss AM/PM",
  20: "h:mm",
  21: "h:mm:ss",
  22: "m/d/yy h:mm",
  37: "#,##0 ;(#,##0)",
  38: "#,##0 ;[Red](#,##0)",
  39: "#,##0.00;(#,##0.00)",
  40: "#,##0.00;[Red](#,##0.00)",
  45: "mm:ss",
  46: "[h]:mm:ss",
  47: "mmss.0",
  48: "##0.0E+0",
  49: "@",
};

// ---------------------------------------------------------------------------------------------------------------------
// A aba como texto: as linhas e as células de `<sheetData>`, e o resto como estava

interface CellM {
  col: number;
  attrs: string;
  /** Os filhos; `null` numa célula `<c …/>`. */
  inner: string | null;
}

interface RowM {
  r: number;
  attrs: string;
  cells: CellM[];
  selfClosing: boolean;
}

interface SheetM {
  head: string;
  rows: RowM[];
  tail: string;
}

function parseSheet(xml: string): SheetM {
  const empty = /<sheetData\b([^>]*?)\/>/.exec(xml);
  const open = /<sheetData\b[^>]*>/.exec(xml);
  if (empty && (!open || empty.index <= open.index)) {
    return { head: `${xml.slice(0, empty.index)}<sheetData${empty[1]}>`, rows: [], tail: `</sheetData>${xml.slice(empty.index + empty[0].length)}` };
  }
  if (!open) throw new XlsxReadOnly("unknown", "uma aba não tem as células (sheetData)");
  const start = open.index + open[0].length;
  const end = xml.indexOf("</sheetData>", start);
  const rows: RowM[] = [];
  let last = -1;
  for (const m of xml.slice(start, end).matchAll(/<row\b([^>]*?)(\/>|>([\s\S]*?)<\/row>)/g)) {
    const attrs = m[1]!;
    const r = attr(attrs, "r");
    const index = r === null ? last + 1 : Number(r) - 1;
    last = index;
    const cells: CellM[] = [];
    let lastCol = -1;
    for (const c of (m[3] ?? "").matchAll(/<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(c[1]!, "r");
      const col = ref === null ? lastCol + 1 : colIndex(/^\$?([A-Za-z]+)/.exec(ref)?.[1] ?? "A");
      lastCol = col;
      cells.push({ col, attrs: c[1]!, inner: c[2] === "/>" ? null : c[3]! });
    }
    rows.push({ r: index, attrs, cells, selfClosing: m[2] === "/>" });
  }
  return { head: xml.slice(0, start), rows, tail: xml.slice(end) };
}

function serializeSheet(m: SheetM): string {
  let out = m.head;
  for (const row of m.rows) {
    const attrs = setAttr(row.attrs, "r", String(row.r + 1));
    if (!row.cells.length) {
      // Uma linha sem célula só fica se tem algo seu (altura, estilo, oculta).
      if (delAttr(delAttr(attrs, "r"), "spans").trim() === "") continue;
      out += `<row${attrs}/>`;
      continue;
    }
    out += `<row${attrs}>`;
    for (const c of row.cells) {
      const a = setAttr(c.attrs, "r", cellName({ row: row.r, col: c.col }));
      out += c.inner === null ? `<c${a}/>` : `<c${a}>${c.inner}</c>`;
    }
    out += "</row>";
  }
  return out + m.tail;
}

/** As fórmulas compartilhadas (`t="shared"`) escritas em cada célula, para editar uma sem desfazer as outras. */
function expandShared(xml: string): string {
  if (!/<f\b[^>]*\bt="shared"/.test(xml)) return xml;
  const masters = new Map<string, { text: string; row: number; col: number }>();
  const model = parseSheet(xml);
  for (const row of model.rows) {
    for (const c of row.cells) {
      const m = /<f\b([^>]*?)>([\s\S]*?)<\/f>/.exec(c.inner ?? "");
      if (m && attr(m[1]!, "t") === "shared" && m[2]) masters.set(attr(m[1]!, "si") ?? "", { text: m[2], row: row.r, col: c.col });
    }
  }
  for (const row of model.rows) {
    for (const c of row.cells) {
      if (!c.inner) continue;
      c.inner = c.inner.replace(/<f\b([^>]*?)(\/>|>([\s\S]*?)<\/f>)/, (whole, attrs: string, _e: string, text = "") => {
        if (attr(attrs, "t") !== "shared") return whole;
        const master = masters.get(attr(attrs, "si") ?? "");
        const formula = text || (master ? escapeXml(moveFormula(unescapeXml(master.text), row.r - master.row, c.col - master.col)) : "");
        const rest = delAttr(delAttr(delAttr(attrs, "t"), "si"), "ref");
        return `<f${rest}>${formula}</f>`;
      });
    }
  }
  return serializeSheet(model);
}

// ---------------------------------------------------------------------------------------------------------------------
// XML como texto

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[e]!;
  });
}

/** O valor de um atributo (ainda com as entidades), ou `null`. */
function attr(attrs: string, name: string): string | null {
  return new RegExp(`(?:^|\\s)${escapeRe(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attrs)?.slice(1).find((v) => v !== undefined) ?? null;
}

function setAttr(attrs: string, name: string, value: string): string {
  const re = new RegExp(`(^|\\s)(${escapeRe(name)}\\s*=\\s*)(?:"[^"]*"|'[^']*')`);
  return re.test(attrs) ? attrs.replace(re, (_, a: string, b: string) => `${a}${b}"${value}"`) : `${attrs.replace(/\s*$/, "")} ${name}="${value}"`;
}

function delAttr(attrs: string, name: string): string {
  return attrs.replace(new RegExp(`\\s${escapeRe(name)}\\s*=\\s*(?:"[^"]*"|'[^']*')`), "");
}

function mapAttr(attrs: string, name: string, f: (value: string) => string): string {
  const v = attr(attrs, name);
  return v === null ? attrs : setAttr(attrs, name, f(v));
}

/** Os elementos `<name …/>` ou `<name …>…</name>` (sem aninhar o mesmo nome). */
function elements(xml: string, name: string): { attrs: string; inner: string | null; whole: string }[] {
  const re = new RegExp(`<${escapeRe(name)}(\\s[^>]*?)?(\\/>|>([\\s\\S]*?)<\\/${escapeRe(name)}>)`, "g");
  return [...xml.matchAll(re)].map((m) => ({ attrs: m[1] ?? "", inner: m[2] === "/>" ? null : m[3]!, whole: m[0] }));
}

/** Troca cada elemento inteiro; `null` mantém, `""` tira. */
function mapElementsWhole(xml: string, name: string, f: (attrs: string, inner: string | null, whole: string) => string | null): string {
  const re = new RegExp(`<${escapeRe(name)}(\\s[^>]*?)?(\\/>|>([\\s\\S]*?)<\\/${escapeRe(name)}>)`, "g");
  return xml.replace(re, (whole, attrs: string | undefined, end: string, inner: string | undefined) => f(attrs ?? "", end === "/>" ? null : inner!, whole) ?? whole);
}

/** Troca o texto de cada elemento `<name>texto</name>`. */
function mapElements(xml: string, name: string, f: (attrs: string, inner: string) => string): string {
  return mapElementsWhole(xml, name, (attrs, inner) => (inner === null ? null : `<${name}${attrs}>${f(attrs, inner)}</${name}>`));
}

/** Os atributos de cada tag de abertura (ou vazia) com um destes nomes. */
function editTags(xml: string, names: string[], f: (attrs: string) => string): string {
  const re = new RegExp(`<(${names.map(escapeRe).join("|")})(\\s[^>]*?)?(\\/?)>`, "g");
  return xml.replace(re, (_, name: string, attrs = "", slash: string) => `<${name}${f(attrs)}${slash}>`);
}

/**
 * Cada fórmula de uma parte: `<f>` das células e dos gráficos (`<c:f>`), `<formula>` da formatação condicional,
 * `<formula1>`/`<formula2>` da validação e o `<xm:f>` das extensões. `fAttrs` mexe nos atributos de `<f>` (o `ref`).
 */
function mapFormulas(xml: string, f: (formula: string) => string, fAttrs?: (attrs: string) => string): string {
  const re = /<((?:\w+:)?)(formula1|formula2|formula|f)(\s[^>]*?)?(\/>|>([\s\S]*?)<\/\1\2>)/g;
  return xml.replace(re, (whole, p: string, name: string, attrs = "", end: string, inner: string | undefined) => {
    const a = name === "f" && fAttrs ? fAttrs(attrs) : attrs;
    if (end === "/>") return a === attrs ? whole : `<${p}${name}${a}/>`;
    const text = inner ? escapeXml(f(unescapeXml(inner))) : "";
    return text === inner && a === attrs ? whole : `<${p}${name}${a}>${text}</${p}${name}>`;
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Faixas

function rangeEnds(ref: string): [{ row?: number; col?: number }, { row?: number; col?: number }] | null {
  const parse = (t: string) => {
    const m = /^\$?([A-Za-z]{1,3})?\$?(\d+)?$/.exec(t);
    if (!m || (!m[1] && !m[2])) return null;
    return { col: m[1] ? colIndex(m[1]) : undefined, row: m[2] ? Number(m[2]) - 1 : undefined };
  };
  const [a, b = a] = ref.split(":");
  const p = parse(a!);
  const q = parse(b!);
  return p && q ? [p, q] : null;
}

function inRange(cell: { row: number; col: number }, ref: string): boolean {
  const ends = rangeEnds(ref);
  if (!ends) return false;
  const [p, q] = ends;
  const rowOk = p.row === undefined || (cell.row >= p.row && cell.row <= q.row!);
  const colOk = p.col === undefined || (cell.col >= p.col && cell.col <= q.col!);
  return rowOk && colOk;
}

/** O tamanho de uma faixa num eixo. */
function spanOf(ref: string, axis: "row" | "col"): number {
  const ends = rangeEnds(ref);
  const a = ends?.[0][axis];
  const b = ends?.[1][axis];
  return a === undefined || b === undefined ? Infinity : b - a + 1;
}

/** A mudança cai dentro da faixa (não só antes ou depois dela) no eixo da mudança. */
function crosses(ref: string, s: Shift): boolean {
  const ends = rangeEnds(ref);
  const a = ends?.[0][s.axis];
  const b = ends?.[1][s.axis];
  if (a === undefined || b === undefined) return false;
  return s.count > 0 ? s.at > a && s.at <= b : s.at <= b && s.at - s.count - 1 >= a;
}

function growRange(ref: string, cell: { row: number; col: number }): string {
  const ends = rangeEnds(ref);
  if (!ends || ends[0].row === undefined || ends[0].col === undefined) return ref;
  const [p, q] = ends;
  const r1 = Math.min(p.row!, cell.row);
  const c1 = Math.min(p.col!, cell.col);
  const r2 = Math.max(q.row!, cell.row);
  const c2 = Math.max(q.col!, cell.col);
  const a = cellName({ row: r1, col: c1 });
  const b = cellName({ row: r2, col: c2 });
  return a === b ? a : `${a}:${b}`;
}

