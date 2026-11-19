// csv e tsv dentro das Notas (T7107, spec #7079): a grade da planilha (`TableGrid`, T21038), com a linha do cabeçalho
// como a linha 1. Só leitura: para editar, o botão "Abrir no app padrão". Um csv que não é UTF-8 (o do Excel no
// Windows) é lido de novo pelos bytes.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { bytesOf, columnName, decodeText, parseTable } from "./csv.ts";
import { CELL_PAD, columnWidths, isNumeric, offsetsOf, ROW_H, trimEmpty, visibleRange, type Viewport } from "./grid.ts";
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
  return <TableGrid header={table.header} rows={table.rows} columns={table.columns} firstRow={2} foot={encoding ? `lido como ${encoding}` : null} />;
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
export function TableGrid({ header: rawHeader, rows: rawRows, columns: rawColumns, foot, firstRow = 1, rowTotal }: GridProps) {
  const { rows, columns } = useMemo(() => trimEmpty(rawHeader, rawRows, rawColumns), [rawHeader, rawRows, rawColumns]);
  const header = rawHeader;
  const scroll = useRef<HTMLDivElement>(null);
  // As larguras ficam no estado: a borda arrastável (T21040) muda uma só.
  const [widths, setWidths] = useState<number[] | null>(null);
  const [numW, setNumW] = useState(MIN_NUM);
  const [view, setView] = useState<Viewport>({ left: 0, top: 0, width: 1200, height: 800 });

  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el) return;
    let live = true;
    const fit = () => {
      const measure = measurer(el);
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

  const cell = (text: string, c: number, role: "gridcell" | "columnheader") => (
    <div
      key={c}
      role={role}
      aria-colindex={c + 2}
      className="kn-grid-cell"
      data-num={role === "gridcell" && isNumeric(text) ? "" : undefined}
      style={{ left: numW + offsets![c]!, width: widths![c] }}
    >
      {text}
    </div>
  );

  return (
    <div className="kn-file-table-wrap">
      <div
        ref={scroll}
        className="kn-grid"
        role="grid"
        aria-label="Tabela"
        aria-readonly="true"
        aria-rowcount={rows.length + 1}
        aria-colcount={columns + 1}
        tabIndex={0}
      >
        <div className="kn-grid-canvas" style={{ width, height: head + rows.length * ROW_H }}>
          <div className="kn-grid-head" role="rowgroup" style={{ width, height: head }}>
            <div className="kn-grid-letters" aria-hidden="true" style={{ width }}>
              <div className="kn-grid-n kn-grid-corner" style={{ width: numW }} />
              {offsets
                ? cols.map((c) => (
                    <div key={c} className="kn-grid-cell kn-grid-letter" style={{ left: numW + offsets[c]!, width: widths![c] }}>
                      {columnName(c)}
                    </div>
                  ))
                : null}
            </div>
            <div className="kn-grid-row kn-grid-top" role="row" aria-rowindex={1} style={{ top: ROW_H, width }}>
              <div className="kn-grid-n" role="rowheader" style={{ width: numW }}>
                {firstRow - 1}
              </div>
              {offsets ? cols.map((c) => cell(header[c] ?? "", c, "columnheader")) : null}
            </div>
          </div>
          {offsets
            ? Array.from({ length: range.row1 - range.row0 }, (_, i) => {
                const r = range.row0 + i;
                const row = rows[r]!;
                return (
                  <div key={r} className="kn-grid-row" role="row" aria-rowindex={r + 2} style={{ top: head + r * ROW_H, width }}>
                    <div className="kn-grid-n" role="rowheader" style={{ width: numW }}>
                      {r + firstRow}
                    </div>
                    {cols.map((c) => cell(row[c] ?? "", c, "gridcell"))}
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
