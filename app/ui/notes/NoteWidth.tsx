// T5299 (issue #212, pedido do harry no #5278): a coluna da nota fica no meio, e a largura é da pessoa. Uma alça em cada
// borda do texto, logo do lado de fora de onde a linha quebra (spec #13383): com o mouse ali, o cursor de arrastar e a
// barrinha aparecem na hora. Antes, a alça ficava 20 a 28 px para fora do texto e só aparecia depois de o mouse parar
// 600 ms em cima, sem mudar o cursor: quem procurava a borda do texto não achava nada. Arrastar alarga ou estreita a
// coluna dos dois lados, dentro dos limites e nunca além da janela; soltar guarda. Duplo clique volta ao padrão. Pelo
// teclado, as setas mudam de 20 em 20 px. Vale no .md (dentro da `.kn-page`) e no .txt (no `NoteWidthFrame`).

import { type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useRef, useState } from "react";

import { NOTE_WIDTH } from "../../src/shared/note-width.ts";

const STEP = 20;

/** O maior que cabe: o limite, ou a área da nota (a coluna central), o que for menor. */
function widest(page: HTMLElement): number {
  const area = page.parentElement?.clientWidth ?? NOTE_WIDTH.max;
  return Math.max(NOTE_WIDTH.min, Math.min(NOTE_WIDTH.max, area));
}

export const clampNoteWidth = (px: number, max: number = NOTE_WIDTH.max) =>
  Math.round(Math.min(max, Math.max(NOTE_WIDTH.min, px)));

export function NoteWidthHandles({ width, onChange, onCommit }: {
  /** A largura de agora (a salva, ou a do arrastar). */
  width: number;
  onChange(px: number): void;
  onCommit(px: number): void;
}) {
  /** O arrasto em curso; `px` é a última largura calculada, que o soltar grava (o render dela pode não ter chegado). */
  const drag = useRef<{ x: number; start: number; side: 1 | -1; max: number; px?: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [shown, setShown] = useState<"left" | "right" | null>(null);
  const last = useRef(width);
  last.current = width;

  const down = (side: 1 | -1) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const page = e.currentTarget.parentElement;
    if (!page) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    // A largura que se vê, não a salva: numa janela estreita, a coluna já é menor que o máximo.
    const start = Math.min(width, page.getBoundingClientRect().width);
    drag.current = { x: e.clientX, start, side, max: widest(page) };
    setShown(side === 1 ? "right" : "left");
    setDragging(true);
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    // A coluna é centralizada: a borda anda dx, e a largura muda 2·dx.
    d.px = clampNoteWidth(d.start + 2 * d.side * (e.clientX - d.x), d.max);
    onChange(d.px);
  };
  const up = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setDragging(false);
    setShown(null);
    // A última largura do arrasto, e não a do último render: soltar logo depois de mover gravava a anterior, e a coluna
    // pulava para ela quando as settings voltavam (revisão do T13855).
    onCommit(d.px ?? last.current);
  };
  const key = (side: 1 | -1) => (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === "ArrowRight" ? side : e.key === "ArrowLeft" ? -side : 0;
    if (!dir) return;
    e.preventDefault();
    const page = e.currentTarget.parentElement;
    const next = clampNoteWidth(width + dir * STEP, page ? widest(page) : NOTE_WIDTH.max);
    onChange(next);
    onCommit(next);
  };
  const reset = () => {
    onChange(NOTE_WIDTH.default);
    onCommit(NOTE_WIDTH.default);
  };

  return (
    <>
      {([-1, 1] as const).map((side) => {
        const name = side === 1 ? "right" : "left";
        return (
        <div
          key={side}
          className="kn-width-handle"
          data-side={name}
          data-shown={shown === name || undefined}
          data-dragging={(dragging && shown === name) || undefined}
          role="separator"
          aria-orientation="vertical"
          aria-label="Largura da nota"
          aria-valuemin={NOTE_WIDTH.min}
          aria-valuemax={NOTE_WIDTH.max}
          aria-valuenow={width}
          tabIndex={0}
          title="Arraste para mudar a largura da nota (duplo clique volta ao padrão)"
          onPointerEnter={() => setShown(name)}
          onPointerLeave={() => {
            if (!drag.current) setShown(null);
          }}
          onPointerDown={down(side)}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onKeyDown={key(side)}
          onDoubleClick={reset}
        />
        );
      })}
    </>
  );
}

/**
 * A coluna de um texto que não é a `.kn-page` (o .txt, spec #13383): uma moldura por cima, no meio e na largura da nota,
 * que só deixa as alças pegarem o mouse. O texto embaixo segue clicável.
 */
export function NoteWidthFrame({ children }: { children: ReactNode }) {
  return <div className="kn-width-frame">{children}</div>;
}
