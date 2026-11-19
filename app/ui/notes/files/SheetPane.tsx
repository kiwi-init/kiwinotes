// Uma aba da planilha na grade (T21109, spec #21065): as linhas do arquivo na ordem da vista (ordenada ou filtrada, sem
// gravar), a folga embaixo e à direita para digitar além dos dados, e cada edição da grade traduzida para as linhas do
// arquivo e entregue à sessão (`useSheetSession`), que grava.

import { useMemo, useState } from "react";

import { kiwiFaceUrl } from "../editor/kiwi-face.ts";
import { reducedMotion } from "../kiwiWrite.ts";
import { columnName } from "./csv.ts";
import { kiwiSteps } from "./kiwi-sheet.ts";
import { type KiwiPlayInput, useKiwiPlay } from "./kiwi-sheet-play.ts";
import type { GridSheet, SheetOp } from "../../../src/shared/sheet/ops.ts";
import { clearOps, type Decimal, editText, inputOp, pasteOps, type SheetDoc, sheetTexts, type ViewSpec, viewRows } from "./sheet-doc.ts";
import type { SheetSession } from "./sheet-session.ts";
import { type GridEdit, type GridView, TableGrid } from "./TableGrid.tsx";

/** A folga da grade que edita: linhas e colunas vazias depois dos dados, para a pessoa digitar além deles. */
export const EXTRA_ROWS = 50;
export const EXTRA_COLS = 6;

interface Props {
  session: SheetSession;
  doc: SheetDoc;
  sheet: GridSheet;
  decimal: Decimal;
  widthMemory: Map<string, Record<number, number>>;
  foot?: string | null;
  /** O csv conta as linhas sem a dos nomes das colunas, como antes; a planilha conta a linha 1 também. */
  countHeader?: boolean;
  /** O arquivo, para o zoom da grade ficar guardado por ele (T21238). */
  zoomKey?: string;
}

export function SheetPane({ session, doc, sheet, decimal, widthMemory, foot, countHeader = true, zoomKey }: Props) {
  const editable = !session.readOnly;
  const [spec, setSpec] = useState<ViewSpec>({});
  const texts = useMemo(() => sheetTexts(sheet), [sheet]);
  // Os dados vão até a última linha e a última coluna com texto; o resto é folga.
  const { dataRows, dataCols } = useMemo(() => {
    let rows = texts.length;
    while (rows > 0 && texts[rows - 1]!.every((t) => t === "")) rows--;
    let cols = 0;
    for (let r = 0; r < rows; r++) for (let c = texts[r]!.length - 1; c >= cols; c--) if (texts[r]![c] !== "") cols = c + 1;
    return { dataRows: rows, dataCols: cols };
  }, [texts]);
  const columns = editable ? dataCols + EXTRA_COLS : dataCols;
  const order = useMemo(() => {
    const data = viewRows(sheet, dataRows, spec);
    if (!editable || spec.filter) return data;
    return [...data, ...Array.from({ length: EXTRA_ROWS }, (_, i) => Math.max(dataRows, 1) + i)];
  }, [sheet, dataRows, spec, editable]);
  const pad = (r: string[] | undefined) => Array.from({ length: columns }, (_, c) => r?.[c] ?? "");
  const header = useMemo(() => pad(texts[0]), [texts, columns]);
  const rows = useMemo(() => order.map((r) => pad(texts[r])), [order, texts, columns]);
  const rowNumbers = useMemo(() => order.map((r) => r + 1), [order]);

  /** A linha do arquivo de uma linha da grade (a 0 é a de cima); depois da última, as seguintes. */
  const fileRow = (r: number) => (r === 0 ? 0 : r <= order.length ? order[r - 1]! : (order.at(-1) ?? 0) + (r - order.length));
  const cellOf = (r: number, c: number) => sheet.rows[fileRow(r)]?.[c];

  // O Kiwi Cat gravou (T21114): as células dele, das linhas do arquivo para as da grade (a vista ordenada ou filtrada
  // tem outra ordem; a linha que o filtro esconde fica de fora). Só muda com um toque novo.
  const kiwiInput = useMemo((): KiwiPlayInput | null => {
    const play = session.kiwi;
    if (!play) return null;
    const s = kiwiSteps(play.ops, sheet.name);
    const gridRow = (fr: number) => (fr === 0 ? 0 : order.indexOf(fr) + 1 || -1);
    const was = !s.shifted ? play.before?.sheets.find((x) => x.name === sheet.name) : undefined;
    const cells = s.cells
      .map((c) => ({ row: gridRow(c.row), col: c.col, text: texts[c.row]?.[c.col] ?? "", before: was ? (was.rows[c.row]?.[c.col]?.text ?? "") : undefined }))
      .filter((c) => c.row >= 0 && c.col < columns);
    const recalc = s.recalc.map((c) => ({ row: gridRow(c.row), col: c.col })).filter((c) => c.row >= 0);
    const rowsIn = s.rowsIn.map(gridRow).filter((r) => r >= 0);
    if (!cells.length && !recalc.length && !rowsIn.length && !s.colsIn.length) return null;
    return { cells, recalc, rowsIn, colsIn: s.colsIn };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.kiwi]);
  const kiwi = useKiwiPlay(kiwiInput, { reduced: useMemo(reducedMotion, [session.kiwi]), face: session.kiwi ? kiwiFaceUrl(session.kiwi.cor) : "", onEnd: session.kiwiEnd });

  const edit: GridEdit | undefined = editable
    ? {
        textOf: (r, c) => editText(cellOf(r, c), decimal),
        commit: (r, c, text) => session.edit([inputOp(doc, sheet.name, fileRow(r), c, text, cellOf(r, c), decimal)]),
        paste: (r, c, block) => session.edit(block.flatMap((line, i) => pasteOps(doc, sheet, fileRow(r + i), c, [line], decimal))),
        clear: (a) => session.edit(clearOps(sheet, Array.from({ length: a.r1 - a.r0 + 1 }, (_, i) => fileRow(a.r0 + i)), a.c0, a.c1)),
        insertRows: (before, count) => {
          const at = before <= order.length ? fileRow(before) : fileRow(order.length) + 1;
          session.edit([{ op: "insertRows", sheet: sheet.name, at, count }]);
        },
        deleteRows: (viewRowsToDelete) => {
          // De baixo para cima, para cada posição ainda valer; as seguidas viram uma operação só.
          const list = [...new Set(viewRowsToDelete.map(fileRow))].sort((a, b) => b - a);
          const ops: SheetOp[] = [];
          for (const r of list) {
            const last = ops.at(-1);
            if (last && last.op === "deleteRows" && last.at === r + 1) ops[ops.length - 1] = { ...last, at: r, count: last.count + 1 };
            else ops.push({ op: "deleteRows", sheet: sheet.name, at: r, count: 1 });
          }
          session.edit(ops);
        },
        insertCols: (before, count) => session.edit([{ op: "insertCols", sheet: sheet.name, at: before, count }]),
        deleteCols: (c0, c1) => session.edit([{ op: "deleteCols", sheet: sheet.name, at: c0, count: c1 - c0 + 1 }]),
        undo: session.undo,
        redo: session.redo,
        staleAt: (r, c) => !!cellOf(r, c)?.stale,
      }
    : undefined;

  const parts = [
    spec.filter ? `só “${spec.filter.values[0] || "vazias"}” na ${columnName(spec.filter.col)}` : "",
    spec.sort ? `pela ${columnName(spec.sort.col)}, de ${spec.sort.dir === 1 ? "A a Z" : "Z a A"}` : "",
  ].filter(Boolean);
  const view: GridView = {
    sort: (col, dir) => setSpec((s) => ({ ...s, sort: { col, dir } })),
    filterTo: (col, text) => setSpec((s) => ({ ...s, filter: { col, values: [text] } })),
    clear: () => setSpec({}),
    label: parts.length ? `vista ${parts.join(", ")} (o arquivo não muda)` : null,
  };

  return (
    <TableGrid
      name={sheet.name}
      widthMemory={widthMemory}
      zoomKey={zoomKey}
      header={header}
      rows={rows}
      columns={columns}
      firstRow={2}
      rowTotal={countHeader ? dataRows : Math.max(0, dataRows - 1)}
      columnTotal={dataCols}
      rowNumbers={rowNumbers}
      edit={edit}
      view={view}
      foot={foot}
      kiwi={kiwi}
    />
  );
}
