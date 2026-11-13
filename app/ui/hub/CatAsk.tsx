// Falar por texto (spec #9878, T10872): o campo que abre ao lado do gato, no formato do balão (a casca
// `.kn-bubble-shell`, a mesma do balão da resposta, T10832). A pessoa escreve o pedido ao agente: Enter manda,
// Shift+Enter quebra a linha, Esc fecha. Com um pedido em andamento, o campo aceita o texto mas não manda, e oferece
// cancelar o pedido.

import { useLayoutEffect, useRef } from "react";

/** O mesmo limite do "Testar" de Ajustes (spec #9878, #10878). Passou, o campo avisa e não manda; a colagem não é cortada. */
export const ASK_MAX = 500;

/** O que o campo pode mandar: um texto com conteúdo, dentro do limite, e sem pedido em andamento. */
export function canSend(text: string, busy: boolean): boolean {
  return !busy && text.trim().length > 0 && text.length <= ASK_MAX;
}

export function CatAsk(p: {
  draft: string;
  busy: boolean;
  onDraft(text: string): void;
  onSend(text: string): void;
  onClose(): void;
  onCancelRequest(): void;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  // Abre já recebendo as teclas, com o cursor no fim do rascunho que voltou.
  useLayoutEffect(() => {
    const t = field.current;
    if (!t) return;
    t.focus();
    t.setSelectionRange(t.value.length, t.value.length);
  }, []);
  // Cresce com o texto até 5 linhas (o `max-height` do CSS); depois rola.
  useLayoutEffect(() => {
    const t = field.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${t.scrollHeight}px`;
  }, [p.draft]);
  const tooLong = p.draft.length > ASK_MAX;
  const ok = canSend(p.draft, p.busy);
  const send = () => {
    if (ok) p.onSend(p.draft.trim());
  };
  return (
    <div
      className="kn-bubble-shell kn-cat-ask"
      role="dialog"
      aria-label="Falar com o agente"
      // Esc fecha de qualquer ponto do campo (o texto, o "Mandar", o "Cancelar o pedido"), não só do texto.
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        p.onClose();
      }}
    >
      <textarea
        ref={field}
        className="kn-cat-ask-field"
        aria-label="O pedido ao agente"
        placeholder="Peça algo ao agente…"
        rows={1}
        value={p.draft}
        onChange={(e) => p.onDraft(e.target.value)}
        onKeyDown={(e) => {
          // Enter manda; Shift+Enter quebra a linha; durante a composição (acentos, IME) o Enter é da composição.
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
      />
      {p.busy ? (
        <p className="kn-cat-ask-note" role="status">
          Há um pedido em andamento.{" "}
          <button
            type="button"
            className="kn-cat-ask-link"
            tabIndex={0}
            onClick={() => {
              p.onCancelRequest();
              // O aviso some com o pedido cancelado, e o botão com ele: o foco volta ao texto, e o Esc segue fechando.
              field.current?.focus();
            }}
          >
            Cancelar o pedido
          </button>
        </p>
      ) : null}
      {tooLong ? (
        <p className="kn-cat-ask-note" role="status">
          O pedido passa de {ASK_MAX} caracteres: encurte para mandar. O texto longo fica nas notas, que o agente lê.
        </p>
      ) : null}
      <div className="kn-cat-ask-actions">
        <button type="button" className="kn-cat-ask-send" tabIndex={0} disabled={!ok} onClick={send}>
          Mandar
        </button>
      </div>
    </div>
  );
}
