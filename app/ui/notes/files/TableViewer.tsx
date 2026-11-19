// csv e tsv dentro das Notas (T7107, spec #7079): a grade da planilha (`TableGrid`, T21038), com a linha do cabeçalho
// como a linha 1. Só leitura: para editar, o botão "Abrir no app padrão". Um csv que não é UTF-8 (o do Excel no
// Windows) é lido de novo pelos bytes.

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import { bytesOf, columnName, decodeText, parseTable } from "./csv.ts";
import { CELL_PAD, columnWidths, isNumeric, offsetsOf, ROW_H, trimEmpty, visibleRange, type Viewport } from "./grid.ts";
import { type Cell, cellAddress, cellText, clampCell, dragWidth, firstVisible, fitWidth, moveCell, scrollToShow, withCustom } from "./selection.ts";
import type { FileViewerProps } from "./viewers.ts";

const ENCODINGS = { "utf-8": "UTF-8", "utf-16": "UTF-16", "windows-1252": "Windows-1252" } as const;

export function TableViewer({ path, file, files }: FileViewerProps) {
  const utf8 = "text" in file && !file.readOnly;
  // O texto que não é UTF-8 veio com os acentos trocados: os bytes dizem a codificação certa (revisão do T7107).
  const [decoded, setDecoded] = useState<{ version: string; text: string; encoding: keyof typeof ENCODINGS } | "error" | null>(null);
  useEffect(() => {
    if (utf8) return;
    let alive = true;
    files.read(path, "binary").then(
      (binary) => {
        if (!alive) return;
        if (!("base64" in binary)) return setDecoded("error");
        setDecoded({ version: binary.version, ...decodeText(bytesOf(binary.base64)) });
      },
      () => alive && setDecoded("error"),
    );
    return () => {
      alive = false;
    };
  }, [files, path, utf8, file.version]);

  const text = utf8 ? file.text : decoded && decoded !== "error" ? decoded.text : null;
  const table = useMemo(() => (text === null ? null : parseTable(text, path)), [text, path]);
  // As larguras que a pessoa arrastou valem enquanto o arquivo está aberto, mesmo quando ele recarrega (T21040).
  const widthMemory = useMemo(() => new Map<string, Record<number, number>>(), [path]);

  if (decoded === "error" && !utf8) {
    return (
      <div className="kn-file-notice" role="status">
        <p>Não deu para ler este arquivo como tabela.</p>
      </div>
    );
  }
  if (!table) return <div className="kn-file-table-wrap" aria-busy="true" />;
  if (!table.columns) {
    return (
      <div className="kn-file-notice" role="status">
        <p>Este arquivo está vazio.</p>
      </div>
    );
  }

  const encoding = !utf8 && decoded && decoded !== "error" ? ENCODINGS[decoded.encoding] : null;
  return <TableGrid header={table.header} rows={table.rows} columns={table.columns} firstRow={2} widthMemory={widthMemory} foot={encoding ? `lido como ${encoding}` : null} />;
}

interface GridProps {
  /** A linha de cima, parada ao rolar: os nomes das colunas do csv, ou a linha 1 da planilha. */
  header: string[];
  rows: string[][];
  columns: number;
  /** Um trecho a mais no rodapé, depois de "N linhas, M colunas". */
  foot?: string | null;
  /** O número da primeira linha de `rows` (a de cima, `header`, é a anterior). */
  firstRow?: number;
  /** As linhas que o rodapé conta, quando não são as de `rows` (a planilha conta a linha 1 também). */
  rowTotal?: number;
  /**
   * Onde guardar as larguras que a pessoa mudou, por `name` (a aba): a largura vale enquanto o arquivo está aberto,
   * mesmo trocando de aba (T21040). Sem ela, vale enquanto a grade está na tela.
   */
  widthMemory?: Map<string, Record<number, number>>;
  name?: string;
}

/** A coluna dos números das linhas: no mínimo esta largura (px). */
const MIN_NUM = 44;

/** Um texto de régua: letras, números e acentos, para comparar o canvas com a página. */
const RULER = "Código Produto Observação R$ 1.234,56 0123456789 ABCDEFGHIJ abcdefghij";

/**
 * A medida do texto na fonte da grade: um canvas, sem montar nada, acertado por uma régua medida uma vez na página (o
 * canvas pode não achar a fonte do sistema e medir com outra, e o texto sairia cortado).
 */
function measurer(el: HTMLElement): (text: string, bold: boolean) => number {
  const css = getComputedStyle(el);
  const ctx = document.createElement("canvas").getContext("2d");
  const probe = document.createElement("span");
  probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;left:0;top:0";
  el.appendChild(probe);
  const fit = (weight: number) => {
    probe.style.fontWeight = String(weight);
    probe.textContent = RULER;
    const page = probe.getBoundingClientRect().width;
    if (!ctx) return { font: "", scale: page / RULER.length };
    ctx.font = `${weight} ${css.fontSize} ${css.fontFamily}`;
    const font = ctx.font;
    return { font, scale: page / Math.max(1, ctx.measureText(RULER).width) };
  };
  const regular = fit(400);
  const bold = fit(600);
  // O número fica em algarismos de largura fixa (tabular-nums), mais largos que os do canvas: a largura de um vem da página.
  probe.style.fontWeight = "400";
  probe.style.fontVariantNumeric = "tabular-nums";
  probe.textContent = "0123456789";
  const digit = probe.getBoundingClientRect().width / 10;
  probe.remove();
  const width = (text: string, f: { font: string; scale: number }) => {
    if (!ctx) return text.length * f.scale;
    ctx.font = f.font;
    return ctx.measureText(text).width * f.scale;
  };
  return (text, isBold) => {
    if (isBold || !isNumeric(text)) return width(text, isBold ? bold : regular);
    const digits = text.replace(/\D/g, "").length;
    return width(text.replace(/\d/g, ""), regular) + digits * digit;
  };
}

/**
 * A grade da planilha (T21038, spec #21008), para o csv e para o xlsx: cada coluna da largura do conteúdo, uma linha
 * por célula com "…" no que não cabe, a rolagem para os dois lados com a linha das letras, a linha de cima e a coluna
 * dos números paradas. Todas as linhas e colunas: só as células que estão na tela são montadas, e a rolagem segue lisa
 * com 256 colunas e 100.000 linhas. As linhas e colunas vazias do fim não contam.
 */
export function TableGrid({ header: rawHeader, rows: rawRows, columns: rawColumns, foot, firstRow = 1, rowTotal, widthMemory, name = "" }: GridProps) {
  const { rows, columns } = useMemo(() => trimEmpty(rawHeader, rawRows, rawColumns), [rawHeader, rawRows, rawColumns]);
  const header = rawHeader;
  const scroll = useRef<HTMLDivElement>(null);
  // As larguras ficam no estado: a de abertura, pelo conteúdo, e por cima as que a pessoa arrastou (T21040).
  const [baseWidths, setWidths] = useState<number[] | null>(null);
  const [custom, setCustomState] = useState<Record<number, number>>(() => widthMemory?.get(name) ?? {});
  const setCustom = useCallback(
    (col: number, w: number) =>
      setCustomState((prev) => {
        const next = { ...prev, [col]: w };
        widthMemory?.set(name, next);
        return next;
      }),
    [widthMemory, name],
  );
  const widths = useMemo(() => (baseWidths ? withCustom(baseWidths, custom) : null), [baseWidths, custom]);
  const measureRef = useRef<((text: string, bold: boolean) => number) | null>(null);
  // A célula selecionada (T21040): o endereço e o conteúdo inteiro na barra de cima, as setas e o ⌘C.
  const [selected, setSelected] = useState<Cell | null>(null);
  const id = useId();
  const [numW, setNumW] = useState(MIN_NUM);
  const [view, setView] = useState<Viewport>({ left: 0, top: 0, width: 1200, height: 800 });

  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el) return;
    let live = true;
    const fit = () => {
      const measure = measurer(el);
      measureRef.current = measure;
      setWidths(columnWidths(header, rows, columns, measure));
      setNumW(Math.max(MIN_NUM, Math.ceil(measure(String(firstRow + rows.length), false) + CELL_PAD)));
    };
    fit();
    // A fonte pode chegar depois da primeira medida (medida com a reserva, o texto sairia cortado): mede de novo.
    if (document.fonts && document.fonts.status !== "loaded") void document.fonts.ready.then(() => live && fit());
    return () => {
      live = false;
    };
  }, [header, rows, columns, firstRow]);

  const head = 2 * ROW_H;
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      setView({ left: el.scrollLeft, top: el.scrollTop, width: el.clientWidth - numW, height: el.clientHeight - head });
    };
    const later = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    el.addEventListener("scroll", later, { passive: true });
    const ro = new ResizeObserver(later);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", later);
      ro.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [numW, head]);

  const offsets = useMemo(() => (widths ? offsetsOf(widths) : null), [widths]);
  const n = (value: number) => value.toLocaleString("pt-BR");
  const total = rowTotal ?? rows.length;
  const width = numW + (offsets?.[columns] ?? 0);
  const range = offsets ? visibleRange(view, offsets, rows.length) : { row0: 0, row1: 0, col0: 0, col1: 0 };
  const cols: number[] = [];
  for (let c = range.col0; c < range.col1; c++) cols.push(c);

  // O arquivo mudou e ficou menor: a seleção volta para dentro.
  const sel = selected && columns ? clampCell(selected, rows.length, columns) : null;
  const selText = sel ? cellText(sel, header, rows) : "";
  const cellId = (r: number, c: number) => `${id}-${r}-${c}`;

  /** A área das células agora (sem as partes paradas), lida da rolagem e não do estado, que chega um quadro depois. */
  const liveView = (): Viewport | null => {
    const el = scroll.current;
    return el ? { left: el.scrollLeft, top: el.scrollTop, width: el.clientWidth - numW, height: el.clientHeight - head } : null;
  };
  const select = (cell: Cell, byKey = false) => {
    setSelected(cell);
    const el = scroll.current;
    const v = liveView();
    if (!el || !v || !offsets) return;
    const to = scrollToShow(cell, offsets, v, byKey);
    if (to.left !== v.left || to.top !== v.top) el.scrollTo(to.left, to.top);
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const at = (e.target as HTMLElement).closest<HTMLElement>("[data-r]");
    if (!at) return;
    select({ row: Number(at.dataset.r), col: Number(at.dataset.c) });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!offsets || !columns || e.altKey || e.ctrlKey) return;
    const v = liveView();
    if (!v) return;
    const page = Math.max(1, Math.floor(v.height / ROW_H));
    // A primeira seta começa no canto da tela, sem pular a rolagem para o A1.
    const from = sel ?? (e.key.startsWith("Arrow") ? firstVisible(offsets, v, rows.length) : null);
    if (!from) return;
    const to = sel ? moveCell(from, { key: e.key, meta: e.metaKey }, rows.length, columns, page) : from;
    if (!to) return;
    e.preventDefault();
    select(to, true);
  };

  // ⌘C copia o conteúdo da célula selecionada. Vai pelo "Copiar" do menu Editar do app, que manda o evento `copy` da
  // página: o `beforecopy` cancelado liga o item sem texto selecionado. Um texto selecionado (o da barra) copia ele mesmo.
  useEffect(() => {
    if (!sel) return;
    const mine = () => {
      const el = scroll.current;
      if (!el || !el.contains(document.activeElement)) return false;
      const s = document.getSelection();
      return !s || s.isCollapsed || !s.toString();
    };
    const before = (e: Event) => {
      if (mine()) e.preventDefault();
    };
    const copy = (e: ClipboardEvent) => {
      if (!mine() || !e.clipboardData) return;
      e.clipboardData.setData("text/plain", selText);
      e.preventDefault();
    };
    document.addEventListener("beforecopy", before);
    document.addEventListener("copy", copy);
    return () => {
      document.removeEventListener("beforecopy", before);
      document.removeEventListener("copy", copy);
    };
  }, [sel !== null, selText]);

  // A borda do cabeçalho: arrastar muda a largura daquela coluna; dois cliques ajustam ao conteúdo.
  const drag = useRef<{ col: number; x0: number; start: number } | null>(null);
  const [resizing, setResizing] = useState(false);
  const onResizeDown = (c: number) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !widths) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { col: c, x0: e.clientX, start: widths[c]! };
    setResizing(true);
  };
  const onResizeMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d) setCustom(d.col, dragWidth(d.start, e.clientX - d.x0));
  };
  const onResizeUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    setResizing(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const onResizeFit = (c: number) => () => {
    const measure = measureRef.current;
    if (measure) setCustom(c, fitWidth(c, header, rows, measure));
  };

  const cell = (text: string, r: number, c: number, role: "gridcell" | "columnheader") => {
    const on = sel?.row === r && sel.col === c;
    return (
      <div
        key={c}
        id={cellId(r, c)}
        role={role}
        aria-colindex={c + 2}
        aria-selected={on}
        data-r={r}
        data-c={c}
        className="kn-grid-cell"
        data-num={role === "gridcell" && isNumeric(text) ? "" : undefined}
        style={{ left: numW + offsets![c]!, width: widths![c] }}
      >
        {text}
      </div>
    );
  };

  return (
    <div className="kn-file-table-wrap">
      <div className="kn-grid-bar">
        <span className="kn-grid-addr" aria-label="Célula selecionada">
          {sel ? cellAddress(sel, firstRow) : ""}
        </span>
        <div className="kn-grid-value" aria-label="Conteúdo da célula" data-empty={sel ? undefined : ""}>
          {sel ? selText : "Clique numa célula para ver o conteúdo inteiro"}
        </div>
      </div>
      <div
        ref={scroll}
        className="kn-grid"
        role="grid"
        aria-label="Tabela"
        aria-readonly="true"
        aria-rowcount={rows.length + 1}
        aria-colcount={columns + 1}
        aria-activedescendant={sel ? cellId(sel.row, sel.col) : undefined}
        data-resizing={resizing ? "" : undefined}
        tabIndex={0}
        onMouseDown={onMouseDown}
        onKeyDown={onKeyDown}
      >
        <div className="kn-grid-canvas" style={{ width, height: head + rows.length * ROW_H }}>
          <div className="kn-grid-head" role="rowgroup" style={{ width, height: head }}>
            <div className="kn-grid-letters" aria-hidden="true" style={{ width }}>
              <div className="kn-grid-n kn-grid-corner" style={{ width: numW }} />
              {offsets
                ? cols.map((c) => (
                    <div key={c} className="kn-grid-cell kn-grid-letter" data-on={sel?.col === c ? "" : undefined} style={{ left: numW + offsets[c]!, width: widths![c] }}>
                      {/* Grudada na área das células: a coluna cortada na borda mostra a letra na parte que aparece. */}
                      <span className="kn-grid-letter-name" style={{ left: numW }}>
                        {columnName(c)}
                      </span>
                    </div>
                  ))
                : null}
              {offsets
                ? cols.map((c) => (
                    <div
                      key={`r${c}`}
                      className="kn-grid-resize"
                      data-col={c}
                      title="Arraste para mudar a largura; dois cliques ajustam ao conteúdo"
                      style={{ left: numW + offsets[c + 1]! - 4 }}
                      onPointerDown={onResizeDown(c)}
                      onPointerMove={onResizeMove}
                      onPointerUp={onResizeUp}
                      onPointerCancel={onResizeUp}
                      onDoubleClick={onResizeFit(c)}
                    />
                  ))
                : null}
            </div>
            <div className="kn-grid-row kn-grid-top" role="row" aria-rowindex={1} style={{ top: ROW_H, width }}>
              <div className="kn-grid-n" role="rowheader" data-on={sel?.row === 0 ? "" : undefined} style={{ width: numW }}>
                {firstRow - 1}
              </div>
              {offsets ? cols.map((c) => cell(header[c] ?? "", 0, c, "columnheader")) : null}
            </div>
          </div>
          {offsets
            ? Array.from({ length: range.row1 - range.row0 }, (_, i) => {
                const r = range.row0 + i;
                const row = rows[r]!;
                return (
                  <div key={r} className="kn-grid-row" role="row" aria-rowindex={r + 2} style={{ top: head + r * ROW_H, width }}>
                    <div className="kn-grid-n" role="rowheader" data-on={sel?.row === r + 1 ? "" : undefined} style={{ width: numW }}>
                      {r + firstRow}
                    </div>
                    {cols.map((c) => cell(row[c] ?? "", r + 1, c, "gridcell"))}
                  </div>
                );
              })
            : null}
        </div>
      </div>
      <div className="kn-file-table-foot" aria-live="polite">
        {`${n(total)} ${total === 1 ? "linha" : "linhas"}, ${n(columns)} ${columns === 1 ? "coluna" : "colunas"}`}
        {foot ? `, ${foot}` : ""}
      </div>
    </div>
  );
}
