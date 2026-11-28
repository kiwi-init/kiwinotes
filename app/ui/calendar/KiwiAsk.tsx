// A barra "Peça ao Kiwi" do Calendário (T32156, spec #32129; ponto 7 do spec #34706, T34755). A pessoa escreve nela e
// manda com Enter (o ⌘K põe o foco); o pedido vai pelo mesmo `agent.ask` do gato do canto. A barra tem a animação dela
// (ouvindo, pensando, respondendo) e mostra a resposta debaixo dela, em vez de só abrir o campo do gato. Sem o agente
// ligado (ou sem o gato), ela não aparece. As fases e os eventos ficam no `ask-bar.ts`.

import { useEffect, useReducer, useRef, useState } from "react";

import { api } from "../src/api.ts";
import { useT } from "../src/i18n.ts";
import { useKiwiAskAvailable } from "../hub/kiwi-ask.ts";
import { ASK_IDLE, type AskBar, askBarStep, askBusy, askShown } from "./ask-bar.ts";

const ASK_KEYS = "⌘K"; // i18n-ok: o desenho da tecla, igual nas duas línguas

/** O ⌘K (o Ctrl+K fora do Mac), sem outro modificador. */
export const isAskShortcut = (e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">) =>
  (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k";

export function KiwiAskBox({ active, face, available: given, initial }: { active: boolean; face: string | null; available?: boolean; initial?: AskBar }) {
  const { t } = useT();
  const live = useKiwiAskAvailable();
  const available = given ?? live;
  const [bar, dispatch] = useReducer(askBarStep, initial ?? ASK_IDLE);
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!active || !available) return;
    const key = (e: KeyboardEvent) => {
      if (!isAskShortcut(e)) return;
      e.preventDefault();
      input.current?.focus();
      input.current?.select();
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [active, available]);

  useEffect(() => (available ? api.agent.onTurn((event) => dispatch({ type: "turn", event })) : undefined), [available]);

  if (!available) return null;
  const busy = askBusy(bar);
  const send = () => {
    const text = draft.trim();
    if (!text || busy) return;
    dispatch({ type: "sent", text });
    setDraft("");
    api.agent.ask(text).then(
      (r) => dispatch({ type: "id", id: r.id }),
      () => dispatch({ type: "failed", message: t("calendarKiwi.ask.failed") }),
    );
  };
  const shown = askShown(bar);
  const open = bar.phase !== "idle" && (bar.phase !== "listening" || !!shown);
  return (
    <div className="kn-cal-ask" data-phase={bar.phase}>
      <span className="kn-cal-ask-face" aria-hidden="true">
        {face ? <img src={face} alt="" /> : null}
      </span>
      <input
        ref={input}
        className="kn-cal-ask-input"
        value={draft}
        placeholder={t("calendarKiwi.ask.placeholder")}
        aria-label={t("calendarKiwi.ask.label")}
        aria-keyshortcuts="Meta+K"
        enterKeyHint="send"
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => dispatch({ type: "focus" })}
        onBlur={() => dispatch({ type: "blur", draft })}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          } else if (e.key === "Escape") {
            if (draft) setDraft("");
            else {
              dispatch({ type: "close" });
              input.current?.blur();
            }
          }
        }}
      />
      {busy ? (
        <span className="kn-cal-ask-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      ) : (
        <kbd>{ASK_KEYS}</kbd>
      )}
      {open ? (
        <div className="kn-cal-ask-answer" data-phase={bar.phase}>
          {bar.asked ? <p className="kn-cal-ask-asked">{bar.asked}</p> : null}
          <p className="kn-cal-ask-text" role="status" aria-live="polite">
            {bar.phase === "thinking"
              ? t("calendarKiwi.ask.thinking")
              : bar.phase === "error"
                ? shown || t("calendarKiwi.ask.failed")
                : shown}
          </p>
          {busy ? (
            <button type="button" className="kn-cal-ask-act" onClick={() => void api.agent.cancel().catch(() => {})}>
              {t("calendarKiwi.ask.stop")}
            </button>
          ) : (
            <button type="button" className="kn-cal-ask-act" aria-label={t("calendarKiwi.ask.close")} onClick={() => dispatch({ type: "close" })}>
              ×
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
