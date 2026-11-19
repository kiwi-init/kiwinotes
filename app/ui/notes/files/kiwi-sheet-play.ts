// O Kiwi Cat tocando as mudanças dele na grade (T21114, spec #21033; o desenho, #21997): o arquivo do disco já está na
// tela, e por cima, célula por célula, o gato rola até ela, digita o texto com a etiqueta dele e deixa a célula
// realçada, que some sozinha. Com Reduzir movimento, tudo de uma vez com o realce. Um clique ou uma tecla pula para o fim.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { KIWI_GAP_MS, KIWI_HOLD_MS, KIWI_TYPED_MAX, typingFrames } from "./kiwi-sheet.ts";

/** Uma célula do gato na grade (a linha 0 é a de cima), com o texto que ela tem no fim e o de antes, se ainda vale. */
export interface KiwiPlayCell {
  row: number;
  col: number;
  text: string;
  before?: string;
}

export interface KiwiPlayInput {
  cells: KiwiPlayCell[];
  /** As que só recalcularam: realçam no fim. */
  recalc: { row: number; col: number }[];
  rowsIn: number[];
  colsIn: number[];
}

/** O que a grade mostra agora. */
export interface GridKiwi {
  /** O texto da célula enquanto o gato não passou (o de antes) ou digita (um pedaço); `undefined` é o do arquivo. */
  text(row: number, col: number): string | undefined;
  mark(row: number, col: number): "typing" | "done" | undefined;
  /** A linha ou a coluna que o gato inseriu. */
  isNew(row: number, col: number): boolean;
  /** Onde ele digita agora (a etiqueta e a rolagem), ou `null`. */
  at: { row: number; col: number } | null;
  /** O fim: o realce esmaece. */
  fading: boolean;
  /** A etiqueta entra devagar só na primeira célula; nas outras ela só muda de lugar, sem piscar. */
  tagStill: boolean;
  face: string;
  skip(): void;
}

const key = (r: number, c: number) => `${r}:${c}`;

/** `input` muda de identidade a cada toque novo (um `sheets_edit` novo): o anterior acaba na hora. */
export function useKiwiPlay(input: KiwiPlayInput | null, opts: { reduced: boolean; face: string; onEnd(): void }): GridKiwi | null {
  // `i`: a célula da vez (`cells.length` = todas prontas); `f`: o pedaço do texto dela.
  const [pos, setPos] = useState({ i: 0, f: 0 });
  const end = useRef(opts.onEnd);
  end.current = opts.onEnd;
  const typed = input ? Math.min(input.cells.length, KIWI_TYPED_MAX) : 0;
  const n = input?.cells.length ?? 0;

  useEffect(() => {
    setPos({ i: input && !opts.reduced ? 0 : n, f: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  const frames = useMemo(() => (input && pos.i < typed ? typingFrames(input.cells[pos.i]!.text) : null), [input, pos.i, typed]);

  useEffect(() => {
    if (!input) return;
    let ms: number;
    let next: { i: number; f: number } | null;
    if (pos.i >= n) {
      ms = KIWI_HOLD_MS;
      next = null;
    } else if (pos.i >= typed) {
      // Passou do quanto o gato digita: o resto aparece de uma vez.
      ms = KIWI_GAP_MS;
      next = { i: n, f: 0 };
    } else if (frames && pos.f < frames.frames.length - 1) {
      ms = frames.stepMs;
      next = { i: pos.i, f: pos.f + 1 };
    } else {
      ms = KIWI_GAP_MS;
      next = { i: pos.i + 1, f: 0 };
    }
    const t = setTimeout(() => (next ? setPos(next) : end.current()), ms);
    return () => clearTimeout(t);
  }, [input, pos, n, typed, frames]);

  const skip = useCallback(() => setPos((p) => (p.i >= n ? p : { i: n, f: 0 })), [n]);

  return useMemo(() => {
    if (!input) return null;
    const index = new Map(input.cells.map((c, i) => [key(c.row, c.col), i]));
    const recalc = new Set(input.recalc.map((c) => key(c.row, c.col)));
    const rowsIn = new Set(input.rowsIn);
    const colsIn = new Set(input.colsIn);
    const done = pos.i >= n;
    const at = !done && pos.i < typed ? input.cells[pos.i]! : null;
    return {
      text(row, col) {
        const i = index.get(key(row, col));
        if (i === undefined || i < pos.i) return undefined;
        if (i === pos.i && frames) return frames.frames[pos.f];
        // Ainda não chegou: o texto de antes, ou vazia quando não dá para saber (uma linha entrou ou saiu).
        return input.cells[i]!.before ?? "";
      },
      mark(row, col) {
        const k = key(row, col);
        const i = index.get(k);
        if (i !== undefined) return i < pos.i ? "done" : i === pos.i && at ? "typing" : undefined;
        return done && recalc.has(k) ? "done" : undefined;
      },
      isNew: (row, col) => rowsIn.has(row) || colsIn.has(col),
      at: at ? { row: at.row, col: at.col } : null,
      fading: done,
      tagStill: pos.i > 0,
      face: opts.face,
      skip,
    };
  }, [input, pos, n, typed, frames, opts.face, skip]);
}
