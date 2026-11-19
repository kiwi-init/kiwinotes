// A grade da planilha (T21038, spec #21008), para o csv e para o xlsx, e a edição nela (T21109, spec #21065): dois
// cliques, Enter ou começar a digitar abrem a célula; Enter, Tab e Esc fecham; colar e copiar um bloco do Excel e do
// Numbers; inserir e apagar linhas e colunas pelo menu do botão direito; ⌘F; ordenar e filtrar só na vista. Sem `edit`,
// é só leitura, como antes.

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import { NO_TEXT_ASSIST } from "../../src/textAssist.ts";
import { ContextMenu, type MenuItem } from "../ContextMenu.tsx";
import { columnName } from "./csv.ts";
import type { GridKiwi } from "./kiwi-sheet-play.ts";
import { CELL_PAD, columnWidths, isNumeric, offsetsOf, ROW_H, trimEmpty, visibleRange, type Viewport } from "./grid.ts";
import { clipboardText, findCells, parseClipboard, type Range, rangeOf } from "./sheet-doc.ts";
import { type Cell, cellAddress, cellText, clampCell, dragWidth, firstVisible, fitWidth, moveCell, scrollToShow, withCustom } from "./selection.ts";
import { useViewerZoom } from "./useViewerZoom.ts";
import { recallZoom } from "./zoom.ts";

/**
 * O que a grade pede a quem edita, nas coordenadas da grade: a linha 0 é a de cima (parada), a `r` é `rows[r - 1]`. Quem
 * passa o `edit` traduz para as linhas do arquivo (a vista pode estar ordenada ou filtrada).
 */
export interface GridEdit {
  /** O texto da caixa ao abrir a célula: a fórmula em português, o número como se digita. */
  textOf(r: number, c: number): string;
  commit(r: number, c: number, text: string): void;
  paste(r: number, c: number, block: string[][]): void;
  clear(range: Range): void;
  insertRows(before: number, count: number): void;
  deleteRows(rows: number[]): void;
  insertCols(before: number, count: number): void;
  deleteCols(c0: number, c1: number): void;
  undo(): void;
  redo(): void;
  /** A fórmula que o Kiwi não sabe refazer: a célula fica marcada, e a barra diz por quê. */
  staleAt?(r: number, c: number): boolean;
  /** A caixa de digitar abriu nesta célula, ou fechou (`null`), depois de gravar (T21114: o Kiwi Cat espera). */
  editing?(cell: Cell | null): void;
}

/** A ordem e o filtro da vista (nada grava). `label`: o que está valendo, para o rodapé; `null` sem nenhum. */
export interface GridView {
  sort(col: number, dir: 1 | -1): void;
  filterTo(col: number, text: string): void;
  clear(): void;
  label: string | null;
}

/** Os limites do zoom da grade (T21238). */
const GRID_ZOOM = { min: 0.5, max: 3 };

interface GridProps {
  /** O arquivo, para o zoom ficar guardado por ele (T21238). Sem ele, o zoom vale enquanto a grade está na tela. */
  zoomKey?: string;
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
  /** As colunas que o rodapé conta, quando a grade tem folga para digitar além dos dados. */
  columnTotal?: number;
  /**
   * Onde guardar as larguras que a pessoa mudou, por `name` (a aba): a largura vale enquanto o arquivo está aberto,
   * mesmo trocando de aba (T21040). Sem ela, vale enquanto a grade está na tela.
   */
  widthMemory?: Map<string, Record<number, number>>;
  name?: string;
  /** O número de cada linha de `rows` (a vista ordenada ou filtrada mostra o da linha no arquivo). */
  rowNumbers?: number[];
  edit?: GridEdit;
  view?: GridView;
  /** O Kiwi Cat tocando a gravação dele por cima (T21114): o texto que ele digita, a etiqueta e o realce. */
  kiwi?: GridKiwi | null;
  /** O Kiwi Cat inseriu ou apagou linhas: a caixa aberta vai para esta célula (`row` -1: ela saiu). `n` muda a cada vez. */
  moveEditing?: { row: number; col: number; n: number } | null;
  /** Abrir com a seleção nesta linha do arquivo (a busca achou o termo nela, T21240). */
  goTo?: { line: number };
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

/** A célula aberta para digitar: onde, o texto e se a pessoa começou digitando (a seta então fecha e anda, como no Excel). */
interface Editing {
  row: number;
  col: number;
  text: string;
  typed: boolean;
}

/**
 * A grade da planilha (T21038, spec #21008), para o csv e para o xlsx: cada coluna da largura do conteúdo, uma linha
 * por célula com "…" no que não cabe, a rolagem para os dois lados com a linha das letras, a linha de cima e a coluna
 * dos números paradas. Todas as linhas e colunas: só as células que estão na tela são montadas, e a rolagem segue lisa
 * com 256 colunas e 100.000 linhas. As linhas e colunas vazias do fim não contam (na grade que edita, a folga fica).
 */
export function TableGrid({ header: rawHeader, rows: rawRows, columns: rawColumns, foot, firstRow = 1, rowTotal, columnTotal, widthMemory, name = "", rowNumbers, edit, view: viewSpec, zoomKey = "", kiwi, moveEditing, goTo }: GridProps) {
  const editable = !!edit;
  const { rows, columns } = useMemo(
    () => (editable ? { rows: rawRows, columns: rawColumns } : trimEmpty(rawHeader, rawRows, rawColumns)),
    [editable, rawHeader, rawRows, rawColumns],
  );
  const header = rawHeader;
  // Até onde vão os dados na grade que edita (o resto é a folga para digitar).
  const dataExtent = useMemo(() => {
    if (!editable) return null;
    const t = trimEmpty(rawHeader, rawRows, rawColumns);
    return { rows: t.rows.length, columns: Math.max(1, t.columns) };
  }, [editable, rawHeader, rawRows, rawColumns]);
  const scroll = useRef<HTMLDivElement>(null);
  // O zoom (T21238): o `zoom` do CSS na grade inteira, e as contas seguem em px de 100%. A rolagem, em px da tela, vai
  // dividida por ele. `null` é 100%.
  const [zoomState, setZoom] = useState<number | null>(() => recallZoom(zoomKey));
  useEffect(() => setZoom(recallZoom(zoomKey)), [zoomKey]);
  const z = zoomState ?? 1;
  useViewerZoom({ path: zoomKey, target: scroll, scale: z, set: setZoom, ...GRID_ZOOM });
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
  // A célula selecionada (T21040): o endereço e o conteúdo inteiro na barra de cima, as setas e o ⌘C. A ponta fixa da
  // área (T21109): Shift + seta ou Shift + clique estendem a seleção a partir dela.
  const [selected, setSelected] = useState<Cell | null>(null);
  const [anchor, setAnchor] = useState<Cell | null>(null);
  const [editing, setEditingState] = useState<Editing | null>(null);
  // A caixa aberta agora, sem esperar o render: o Enter fecha, e o `blur` que vem logo depois não grava de novo.
  const editingRef = useRef<Editing | null>(null);
  const setEditing = (e: Editing | null) => {
    editingRef.current = e;
    setEditingState(e);
  };
  // O app sabe qual célula tem a caixa aberta (T21114). Fechar já gravou: a edição entrou antes deste aviso.
  const editingAt = editing ? `${editing.row}:${editing.col}` : "";
  const reportEditing = edit?.editing;
  useEffect(() => {
    const e = editingRef.current;
    reportEditing?.(e ? { row: e.row, col: e.col } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingAt]);
  // A linha da caixa andou com a gravação do gato: a caixa vai junto, com o que a pessoa já digitou.
  useEffect(() => {
    const e = editingRef.current;
    if (!moveEditing || !e) return;
    if (moveEditing.row < 0) setEditing(null);
    else if (moveEditing.row !== e.row || moveEditing.col !== e.col) {
      setEditing({ ...e, row: moveEditing.row, col: moveEditing.col });
      setSelected({ row: moveEditing.row, col: moveEditing.col });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveEditing?.n]);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [find, setFind] = useState<{ query: string; index: number } | null>(null);
  const findInput = useRef<HTMLInputElement>(null);
  const id = useId();
  const [numW, setNumW] = useState(MIN_NUM);
  const [view, setView] = useState<Viewport>({ left: 0, top: 0, width: 1200, height: 800 });

  // Na grade que edita, as larguras se medem na abertura e quando o número de colunas muda: digitar não mexe nelas.
  const fitKey = editable ? columns : rows;
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el) return;
    let live = true;
    const fit = () => {
      const measure = measurer(el);
      measureRef.current = measure;
      // A amostra das larguras pega a última linha: na grade que edita, a última com dados, não a da folga.
      setWidths(columnWidths(header, editable ? trimEmpty(header, rows, columns).rows : rows, columns, measure));
      setNumW(Math.max(MIN_NUM, Math.ceil(measure(String(firstRow + rows.length), false) + CELL_PAD)));
    };
    fit();
    // A fonte pode chegar depois da primeira medida (medida com a reserva, o texto sairia cortado): mede de novo.
    if (document.fonts && document.fonts.status !== "loaded") void document.fonts.ready.then(() => live && fit());
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, columns, firstRow, editable ? null : header]);

  const head = 2 * ROW_H;
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      setView({ left: el.scrollLeft / z, top: el.scrollTop / z, width: el.clientWidth / z - numW, height: el.clientHeight / z - head });
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
  }, [numW, head, z]);

  const offsets = useMemo(() => (widths && widths.length === columns ? offsetsOf(widths) : null), [widths, columns]);
  const n = (value: number) => value.toLocaleString("pt-BR");
  const total = rowTotal ?? rows.length;
  const colTotal = columnTotal ?? columns;
  const width = numW + (offsets?.[columns] ?? 0);
  const range = offsets ? visibleRange(view, offsets, rows.length) : { row0: 0, row1: 0, col0: 0, col1: 0 };
  const cols: number[] = [];
  for (let c = range.col0; c < range.col1; c++) cols.push(c);

  // O arquivo mudou e ficou menor: a seleção volta para dentro.
  const sel = selected && columns ? clampCell(selected, rows.length, columns) : null;
  const area = sel ? rangeOf(anchor ? clampCell(anchor, rows.length, columns) : sel, sel) : null;
  const multi = !!area && (area.r0 !== area.r1 || area.c0 !== area.c1);
  const selText = sel ? cellText(sel, header, rows) : "";
  const barText = sel && edit ? edit.textOf(sel.row, sel.col) : selText;
  const stale = sel && edit?.staleAt?.(sel.row, sel.col);
  const cellId = (r: number, c: number) => `${id}-${r}-${c}`;
  const label = (r: number) => (r === 0 ? firstRow - 1 : (rowNumbers?.[r - 1] ?? r - 1 + firstRow));
  const inArea = (r: number, c: number) => !!area && multi && r >= area.r0 && r <= area.r1 && c >= area.c0 && c <= area.c1;

  /** A área das células agora (sem as partes paradas), lida da rolagem e não do estado, que chega um quadro depois. */
  const liveView = (): Viewport | null => {
    const el = scroll.current;
    return el ? { left: el.scrollLeft / z, top: el.scrollTop / z, width: el.clientWidth / z - numW, height: el.clientHeight / z - head } : null;
  };
  // O gato rola até a célula que ele digita, como a pessoa veria um colega digitando.
  const kiwiAt = kiwi?.at ? `${kiwi.at.row}:${kiwi.at.col}` : "";
  useEffect(() => {
    const el = scroll.current;
    const v = liveView();
    if (!kiwi?.at || !el || !v || !offsets) return;
    const to = scrollToShow(kiwi.at, offsets, v, true);
    if (to.left !== v.left || to.top !== v.top) el.scrollTo(to.left * z, to.top * z);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kiwiAt, !!offsets]);
  const select = (cell: Cell, byKey = false, extend = false) => {
    setSelected(cell);
    if (!extend) setAnchor(null);
    else if (!anchor) setAnchor(sel ?? cell);
    const el = scroll.current;
    const v = liveView();
    if (!el || !v || !offsets) return;
    const to = scrollToShow(cell, offsets, v, byKey);
    if (to.left !== v.left || to.top !== v.top) el.scrollTo(to.left * z, to.top * z);
  };

  // A busca abriu o arquivo numa linha (T21240): a seleção vai para ela uma vez, quando a grade já tem as medidas. A
  // linha da grade é a que mostra o número dela, para valer na vista ordenada ou filtrada também.
  const went = useRef<{ line: number } | null>(null);
  useEffect(() => {
    if (!goTo || !offsets || !columns || went.current === goTo) return;
    went.current = goTo;
    let row = goTo.line - firstRow + 1;
    if (goTo.line === firstRow - 1) row = 0;
    else if (rowNumbers) row = rowNumbers.indexOf(goTo.line) + 1;
    if (row < 0 || row > rows.length) return;
    select({ row, col: 0 });
  }, [goTo, offsets, columns, rows.length, firstRow, rowNumbers]);

  // A caixa de digitar: fechar grava (o Esc não), e a seleção anda como no Excel.
  const close = (save: boolean, move?: { dr: number; dc: number }) => {
    const e = editingRef.current;
    if (!e) return;
    setEditing(null);
    if (save && edit && e.text !== edit.textOf(e.row, e.col)) edit.commit(e.row, e.col, e.text);
    if (move && columns) select(clampCell({ row: e.row + move.dr, col: e.col + move.dc }, rows.length, columns), true);
    scroll.current?.focus({ preventScroll: true });
  };
  const open = (cell: Cell, text?: string) => {
    if (!edit) return;
    setAnchor(null);
    setSelected(cell);
    setEditing({ row: cell.row, col: cell.col, text: text ?? edit.textOf(cell.row, cell.col), typed: text !== undefined });
  };

  const cellAtEvent = (e: React.MouseEvent): Cell | null => {
    const at = (e.target as HTMLElement).closest<HTMLElement>("[data-r]");
    return at ? { row: Number(at.dataset.r), col: Number(at.dataset.c) } : null;
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".kn-grid-editor")) return;
    const cell = cellAtEvent(e);
    if (!cell) return;
    if (editing) close(true);
    select(cell, false, e.shiftKey);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const cell = cellAtEvent(e);
    if (cell && edit && !(e.target as HTMLElement).closest(".kn-grid-editor")) open(cell);
  };

  // A barra nova abre com o foco (autoFocus); a que já estava aberta seleciona o que tinha, para digitar por cima.
  const openFind = () => {
    if (find) findInput.current?.select();
    else setFind({ query: "", index: -1 });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest(".kn-grid-editor, .kn-grid-find")) return;
    if (e.metaKey && !e.altKey && !e.ctrlKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      openFind();
      return;
    }
    if (edit && e.metaKey && !e.altKey && !e.ctrlKey && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) edit.redo();
      else edit.undo();
      return;
    }
    if (!offsets || !columns || e.altKey || e.ctrlKey) return;
    if (edit && sel && !e.metaKey) {
      if (e.key === "Enter" || e.key === "F2") {
        e.preventDefault();
        open(sel);
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        edit.clear(area!);
        return;
      }
      // Começar a digitar abre a célula com a letra, por cima do que tinha.
      if (e.key.length === 1 && e.key !== " ") {
        e.preventDefault();
        open(sel, e.key);
        return;
      }
    }
    if (sel && e.key === "Tab") {
      e.preventDefault();
      select(clampCell({ row: sel.row, col: sel.col + (e.shiftKey ? -1 : 1) }, rows.length, columns), true);
      return;
    }
    const v = liveView();
    if (!v) return;
    const page = Math.max(1, Math.floor(v.height / ROW_H));
    // A primeira seta começa no canto da tela, sem pular a rolagem para o A1.
    const from = sel ?? (e.key.startsWith("Arrow") ? firstVisible(offsets, v, rows.length) : null);
    if (!from) return;
    // ⌘ + seta e End param no fim dos dados, como no Excel, e não no fim da folga; fora dos dados, vão até a borda.
    const toEdge = e.metaKey || e.key === "End";
    const lim = toEdge && dataExtent && sel && sel.row <= dataExtent.rows && sel.col < dataExtent.columns ? dataExtent : { rows: rows.length, columns };
    const to = sel ? moveCell(from, { key: e.key, meta: e.metaKey }, lim.rows, lim.columns, page) : from;
    if (!to) return;
    e.preventDefault();
    select(to, true, e.shiftKey && !!sel);
  };

  const onEditorKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      close(false);
    } else if (e.key === "Enter") {
      e.preventDefault();
      close(true, { dr: e.shiftKey ? -1 : 1, dc: 0 });
    } else if (e.key === "Tab") {
      e.preventDefault();
      close(true, { dr: 0, dc: e.shiftKey ? -1 : 1 });
    } else if (editing?.typed && e.key.startsWith("Arrow") && !e.shiftKey && !e.metaKey) {
      e.preventDefault();
      const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key]!;
      close(true, { dr: d[0]!, dc: d[1]! });
    }
  };

  // O texto da área, para o ⌘C: o bloco com tabs e quebras, como o Excel e o Numbers colam.
  const copyText = () => {
    if (!area || !multi) return selText;
    const block: string[][] = [];
    for (let r = area.r0; r <= area.r1; r++) {
      const line: string[] = [];
      for (let c = area.c0; c <= area.c1; c++) line.push(cellText({ row: r, col: c }, header, rows));
      block.push(line);
    }
    return clipboardText(block);
  };

  // ⌘C copia o conteúdo da célula selecionada (ou da área). Vai pelo "Copiar" do menu Editar do app, que manda o evento
  // `copy` da página: o `beforecopy` cancelado liga o item sem texto selecionado. Um texto selecionado (o da barra) copia
  // ele mesmo. O ⌘V vem do mesmo jeito, pelo `paste` (T21109).
  const copyRef = useRef(copyText);
  copyRef.current = copyText;
  const pasteRef = useRef<(text: string) => void>(() => {});
  pasteRef.current = (text) => {
    if (!edit || !area) return;
    const block = parseClipboard(text);
    if (!block.length) return;
    // Uma célula só, colada numa área: vai em todas, como no Excel.
    if (multi && block.length === 1 && block[0]!.length === 1) {
      const fill = Array.from({ length: area.r1 - area.r0 + 1 }, () => Array.from({ length: area.c1 - area.c0 + 1 }, () => block[0]![0]!));
      edit.paste(area.r0, area.c0, fill);
      return;
    }
    edit.paste(area.r0, area.c0, block);
    const last = clampCell({ row: area.r0 + block.length - 1, col: area.c0 + Math.max(...block.map((r) => r.length)) - 1 }, rows.length, columns);
    setSelected(last);
    setAnchor({ row: area.r0, col: area.c0 });
  };
  const hasSel = sel !== null;
  useEffect(() => {
    if (!hasSel) return;
    const mine = () => {
      const el = scroll.current;
      if (!el || !el.contains(document.activeElement) || document.activeElement?.closest(".kn-grid-editor, .kn-grid-find")) return false;
      const s = document.getSelection();
      return !s || s.isCollapsed || !s.toString();
    };
    const before = (e: Event) => {
      if (mine()) e.preventDefault();
    };
    const copy = (e: ClipboardEvent) => {
      if (!mine() || !e.clipboardData) return;
      e.clipboardData.setData("text/plain", copyRef.current());
      e.preventDefault();
    };
    const paste = (e: ClipboardEvent) => {
      if (!editable || !mine() || !e.clipboardData) return;
      e.preventDefault();
      pasteRef.current(e.clipboardData.getData("text/plain"));
    };
    document.addEventListener("beforecopy", before);
    document.addEventListener("copy", copy);
    if (editable) document.addEventListener("beforepaste", before);
    document.addEventListener("paste", paste);
    return () => {
      document.removeEventListener("beforecopy", before);
      document.removeEventListener("copy", copy);
      document.removeEventListener("beforepaste", before);
      document.removeEventListener("paste", paste);
    };
  }, [hasSel, editable]);

  // ⌘F: as células com o texto, na ordem da vista; Enter vai à próxima, Shift + Enter à anterior.
  const texts = useMemo(() => (find ? [header, ...rows] : null), [find !== null, header, rows]);
  const hits = useMemo(() => (texts && find ? findCells(texts, find.query) : []), [texts, find?.query]);
  const goFind = (dir: 1 | -1) => {
    if (!find || !hits.length) return;
    const index = (find.index + dir + hits.length) % hits.length;
    setFind({ ...find, index });
    select(hits[index]!, true);
  };
  const onFindKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      goFind(e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setFind(null);
      scroll.current?.focus({ preventScroll: true });
    } else if (e.metaKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      findInput.current?.select();
    }
  };

  // O menu do botão direito: linhas e colunas (na grade que edita), a ordem e o filtro da vista.
  const onContextMenu = (e: React.MouseEvent) => {
    const at = (e.target as HTMLElement).closest<HTMLElement>("[data-r], [data-letter]");
    if (!at || (!edit && !viewSpec)) return;
    e.preventDefault();
    if (editing) close(true);
    const col = Number(at.dataset.c ?? at.dataset.letter);
    const row = at.dataset.r !== undefined ? Number(at.dataset.r) : null;
    // O clique fora da área seleciona a célula; dentro, o menu vale para a área inteira.
    let a = area;
    if (row !== null && !inArea(row, col)) {
      select({ row, col });
      a = { r0: row, c0: col, r1: row, c1: col };
    }
    const rs = a ? a.r1 - a.r0 + 1 : 1;
    const linhas = (k: number) => (k === 1 ? "linha" : `${k} linhas`);
    const colunas = (k: number) => (k === 1 ? "coluna" : `${k} colunas`);
    const items: MenuItem[] = [];
    if (edit) {
      if (row !== null && a) {
        items.push(
          { label: `Inserir ${linhas(rs)} acima`, onSelect: () => edit.insertRows(a.r0, rs) },
          { label: `Inserir ${linhas(rs)} abaixo`, onSelect: () => edit.insertRows(a.r1 + 1, rs) },
          { label: `Apagar ${linhas(rs)}`, danger: true, onSelect: () => edit.deleteRows(Array.from({ length: rs }, (_, i) => a.r0 + i)) },
          { kind: "separator" },
        );
      }
      const c0 = row !== null && a ? a.c0 : col;
      const c1 = row !== null && a ? a.c1 : col;
      const k = c1 - c0 + 1;
      items.push(
        { label: `Inserir ${colunas(k)} à esquerda`, onSelect: () => edit.insertCols(c0, k) },
        { label: `Inserir ${colunas(k)} à direita`, onSelect: () => edit.insertCols(c1 + 1, k) },
        { label: `Apagar ${colunas(k)}`, danger: true, onSelect: () => edit.deleteCols(c0, c1) },
      );
    }
    if (viewSpec) {
      if (items.length) items.push({ kind: "separator" });
      const value = row !== null && row > 0 ? cellText({ row, col }, header, rows) : null;
      items.push(
        { label: "Ordenar de A a Z", onSelect: () => viewSpec.sort(col, 1) },
        { label: "Ordenar de Z a A", onSelect: () => viewSpec.sort(col, -1) },
        ...(value !== null ? [{ label: value ? `Mostrar só “${value.length > 30 ? `${value.slice(0, 30)}…` : value}”` : "Mostrar só as vazias", onSelect: () => viewSpec.filterTo(col, value) }] : []),
        ...(viewSpec.label ? [{ label: "Mostrar todas as linhas, na ordem do arquivo", onSelect: () => viewSpec.clear() }] : []),
      );
    }
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

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
    if (d) setCustom(d.col, dragWidth(d.start, (e.clientX - d.x0) / z));
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

  const cell = (fileText: string, r: number, c: number, role: "gridcell" | "columnheader") => {
    const on = sel?.row === r && sel.col === c;
    const isOpen = editing && editing.row === r && editing.col === c;
    const text = kiwi?.text(r, c) ?? fileText;
    const kiwiMark = kiwi?.mark(r, c);
    return (
      <div
        key={c}
        id={cellId(r, c)}
        role={role}
        aria-colindex={c + 2}
        aria-selected={on || inArea(r, c)}
        data-r={r}
        data-c={c}
        className="kn-grid-cell"
        data-num={role === "gridcell" && isNumeric(text) ? "" : undefined}
        data-area={inArea(r, c) ? "" : undefined}
        data-active={on && multi ? "" : undefined}
        data-stale={edit?.staleAt?.(r, c) ? "" : undefined}
        data-editing={isOpen ? "" : undefined}
        data-kiwi={kiwiMark}
        data-kiwi-new={kiwi?.isNew(r, c) ? "" : undefined}
        data-kiwi-below={kiwiMark === "typing" && r <= 1 ? "" : undefined}
        style={{ left: numW + offsets![c]!, width: widths![c] }}
      >
        {isOpen ? (
          <input
            className="kn-grid-editor"
            aria-label={`Editar ${cellAddress({ row: r, col: c }, firstRow)}`}
            autoFocus
            {...NO_TEXT_ASSIST}
            value={editing.text}
            // A caixa cresce com o texto, por cima das vizinhas, como no Excel.
            style={{ width: `max(100%, calc(${editing.text.length + 1}ch + 24px))` }}
            onChange={(e) => setEditing({ ...editing, text: e.target.value })}
            onKeyDown={onEditorKey}
            onBlur={() => close(true)}
          />
        ) : kiwiMark === "typing" ? (
          <>
            {text}
            <span className="kn-kiwi-cursor" aria-hidden="true">
              <span className="kn-kiwi-caret" />
              <span className={kiwi!.tagStill ? "kn-kiwi-tag kn-kiwi-tag-still" : "kn-kiwi-tag"}>
                {kiwi!.face ? <img className="kn-kiwi-face" src={kiwi!.face} alt="" draggable={false} /> : <span className="kn-kiwi-face" />}
                Kiwi
              </span>
            </span>
          </>
        ) : (
          text
        )}
      </div>
    );
  };

  const findCount = find && find.query.trim() ? (hits.length ? `${find.index >= 0 ? find.index + 1 : 0} de ${hits.length}` : "nada") : "";

  return (
    <div
      className="kn-file-table-wrap"
      data-kiwi-play={kiwi ? (kiwi.fading ? "fading" : "on") : undefined}
      // Um clique ou uma tecla durante o toque do gato pula para o fim (e faz o que faria).
      onPointerDownCapture={kiwi && !kiwi.fading ? kiwi.skip : undefined}
      onKeyDownCapture={kiwi && !kiwi.fading ? kiwi.skip : undefined}
    >
      <div className="kn-grid-bar">
        <span className="kn-grid-addr" aria-label="Célula selecionada">
          {sel ? (multi && area ? `${cellAddress({ row: area.r0, col: area.c0 }, firstRow)}:${cellAddress({ row: area.r1, col: area.c1 }, firstRow)}` : cellAddress(sel, firstRow)) : ""}
        </span>
        <div className="kn-grid-value" aria-label="Conteúdo da célula" data-empty={sel ? undefined : ""}>
          {sel ? barText : "Clique numa célula para ver o conteúdo inteiro"}
          {stale ? <span className="kn-grid-stale-note"> O Kiwi não sabe refazer esta fórmula: o valor é o que o arquivo tinha, e o Excel recalcula ao abrir.</span> : null}
        </div>
        {find ? (
          <div className="kn-grid-find" role="search">
            <input
              ref={findInput}
              type="search"
              {...NO_TEXT_ASSIST}
              aria-label="Procurar na planilha"
              placeholder="Procurar"
              value={find.query}
              autoFocus
              onChange={(e) => setFind({ query: e.target.value, index: -1 })}
              onKeyDown={onFindKey}
            />
            <span className="kn-grid-find-count" aria-live="polite">
              {findCount}
            </span>
          </div>
        ) : null}
      </div>
      <div
        ref={scroll}
        className="kn-grid"
        role="grid"
        aria-label="Tabela"
        aria-readonly={editable ? undefined : "true"}
        aria-multiselectable={editable ? "true" : undefined}
        aria-rowcount={rows.length + 1}
        aria-colcount={columns + 1}
        aria-activedescendant={sel ? cellId(sel.row, sel.col) : undefined}
        data-resizing={resizing ? "" : undefined}
        tabIndex={0}
        onMouseDown={onMouseDown}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
        onContextMenu={onContextMenu}
      >
        <div className="kn-grid-canvas" style={{ width, height: head + rows.length * ROW_H, zoom: z === 1 ? undefined : z }}>
          <div className="kn-grid-head" role="rowgroup" style={{ width, height: head }}>
            <div className="kn-grid-letters" aria-hidden="true" style={{ width }}>
              <div className="kn-grid-n kn-grid-corner" style={{ width: numW }} />
              {offsets
                ? cols.map((c) => (
                    <div
                      key={c}
                      className="kn-grid-cell kn-grid-letter"
                      data-letter={c}
                      data-on={sel?.col === c || (multi && area && c >= area.c0 && c <= area.c1) ? "" : undefined}
                      style={{ left: numW + offsets[c]!, width: widths![c] }}
                    >
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
                {label(0)}
              </div>
              {offsets ? cols.map((c) => cell(header[c] ?? "", 0, c, "columnheader")) : null}
            </div>
          </div>
          {offsets
            ? Array.from({ length: range.row1 - range.row0 }, (_, i) => {
                const r = range.row0 + i;
                const row = rows[r]!;
                const on = sel?.row === r + 1 || (multi && area && r + 1 >= area.r0 && r + 1 <= area.r1);
                return (
                  <div key={r} className="kn-grid-row" role="row" aria-rowindex={r + 2} style={{ top: head + r * ROW_H, width }}>
                    <div className="kn-grid-n" role="rowheader" data-on={on ? "" : undefined} style={{ width: numW }}>
                      {label(r + 1)}
                    </div>
                    {cols.map((c) => cell(row[c] ?? "", r + 1, c, "gridcell"))}
                  </div>
                );
              })
            : null}
        </div>
      </div>
      <div className="kn-file-table-foot" aria-live="polite">
        {`${n(total)} ${total === 1 ? "linha" : "linhas"}, ${n(colTotal)} ${colTotal === 1 ? "coluna" : "colunas"}`}
        {viewSpec?.label ? `, ${viewSpec.label}` : ""}
        {foot ? `, ${foot}` : ""}
      </div>
      {menu ? <ContextMenu {...menu} onClose={() => setMenu(null)} onRestoreFocus={() => scroll.current?.focus({ preventScroll: true })} /> : null}
    </div>
  );
}
