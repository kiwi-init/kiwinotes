// A barra de formatação do docx (T23238, spec #21080): a mesma das Notas (`kn-fmt`), que flutua em cima do texto
// selecionado, com o que o Word tem a mais (o sublinhado, as listas e o alinhamento). Os botões acendem com o que já
// está na seleção. O clique não tira o foco das páginas, e a seleção fica.

import type { DocxHandle } from "./docxEngine.ts";
import { DOCX_FORMAT_BUTTONS, type DocxFormatAction, type DocxFormatState, isActive } from "./docxFormat.ts";

export interface DocxBarSpot {
  top: number;
  left: number;
  state: DocxFormatState;
}

/** Onde a barra fica, em relação a `frame`: em cima da seleção, sem sair da janela. `null` sem seleção. */
export function barSpot(engine: DocxHandle | null, frame: HTMLElement | null): DocxBarSpot | null {
  const rect = engine?.selectionRect();
  const state = engine?.formatState();
  if (!rect || !state || !frame) return null;
  const box = frame.getBoundingClientRect();
  // A barra tem 32 px; embaixo da seleção quando não cabe em cima (a 1ª linha à vista).
  const above = rect.top - box.top - 40;
  const top = above >= 44 ? above : rect.bottom - box.top + 8;
  const left = Math.min(Math.max(8, rect.left - box.left), Math.max(8, box.width - 360));
  if (rect.bottom < box.top || rect.top > box.bottom) return null;
  return { top, left, state };
}

const ALIGN: Partial<Record<DocxFormatAction, string>> = {
  left: "M3 4h14M3 8h9M3 12h14M3 16h9",
  center: "M3 4h14M5.5 8h9M3 12h14M5.5 16h9",
  right: "M3 4h14M8 8h9M3 12h14M8 16h9",
  justify: "M3 4h14M3 8h14M3 12h14M3 16h14",
};

export function DocxFormatBar({ spot, onFormat }: { spot: DocxBarSpot; onFormat(action: DocxFormatAction): void }) {
  let group = 0;
  return (
    <div className="kn-fmt kn-file-docx-fmt" role="toolbar" aria-label="Formatação" style={{ top: spot.top, left: spot.left }}>
      {DOCX_FORMAT_BUTTONS.map((b) => {
        const gap = b.group !== group;
        group = b.group;
        const path = ALIGN[b.action];
        return (
          <span key={b.action} className="kn-fmt-cell">
            {gap ? <span className="kn-fmt-sep" aria-hidden="true" /> : null}
            <button
              type="button"
              className={`kn-fmt-bt kn-fmt-${b.action}`}
              title={b.title}
              aria-label={b.title.replace(/ \(.*\)$/, "")}
              aria-pressed={isActive(b.action, spot.state)}
              // O mousedown tiraria a seleção das páginas: a barra age sem pegar o foco.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onFormat(b.action)}
            >
              {path ? (
                <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">
                  <path d={path} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
                </svg>
              ) : (
                b.label
              )}
            </button>
          </span>
        );
      })}
    </div>
  );
}
