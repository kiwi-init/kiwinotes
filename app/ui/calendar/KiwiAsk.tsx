// A busca do Kiwi na barra do Calendário (T32156, spec #32129), como a `.ask` do protótipo do harry: um pedido ao Kiwi
// ("me lembra da entrega amanhã às 9h") pelo clique ou pelo ⌘K. Ela abre o campo do gato no canto (`kiwi-ask.ts`), o
// mesmo caminho de sempre até o agente; sem o agente ligado (ou sem o gato), ela não aparece.

import { useEffect } from "react";

import { useT } from "../src/i18n.ts";
import { openKiwiAsk, useKiwiAskAvailable } from "../hub/kiwi-ask.ts";

const ASK_KEYS = "⌘K"; // i18n-ok: o desenho da tecla, igual nas duas línguas

/** O ⌘K (o Ctrl+K fora do Mac), sem outro modificador. */
export const isAskShortcut = (e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">) =>
  (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k";

export function KiwiAskBox({ active, face, available: given }: { active: boolean; face: string | null; available?: boolean }) {
  const { t } = useT();
  const live = useKiwiAskAvailable();
  const available = given ?? live;

  useEffect(() => {
    if (!active || !available) return;
    const key = (e: KeyboardEvent) => {
      if (!isAskShortcut(e)) return;
      e.preventDefault();
      openKiwiAsk();
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [active, available]);

  if (!available) return null;
  return (
    <button type="button" className="kn-cal-ask" aria-keyshortcuts="Meta+K" onClick={() => openKiwiAsk()}>
      {face ? <img src={face} alt="" /> : null}
      <span>{t("calendarKiwi.ask.placeholder")}</span>
      <kbd>{ASK_KEYS}</kbd>
    </button>
  );
}
