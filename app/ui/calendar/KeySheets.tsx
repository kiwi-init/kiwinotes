// As duas folhas do teclado do Calendário (T34762): a lista dos atalhos (`?`) e o "ir para uma data" (`G`). Abrem por
// cima da grade, levam o foco, fecham com o Esc e com o clique fora, e devolvem o foco para onde estava.

import { type KeyboardEvent as ReactKeyboardEvent, type RefObject, useEffect, useRef, useState } from "react";

import { useT } from "../src/i18n.ts";
import { shownShortcuts } from "./keys.ts";

/** Fecha com o clique fora e devolve o foco para onde estava ao abrir. */
function useSheet(box: RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const down = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) onClose();
    };
    addEventListener("pointerdown", down, true);
    return () => {
      removeEventListener("pointerdown", down, true);
      if (before && before.isConnected && typeof before.focus === "function") before.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

const escToClose = (onClose: () => void) => (e: ReactKeyboardEvent) => {
  if (e.key !== "Escape") return;
  e.preventDefault();
  e.stopPropagation();
  onClose();
};

export function KeysHelp({ onClose }: { onClose(): void }) {
  const { t } = useT();
  const box = useRef<HTMLDivElement>(null);
  useSheet(box, onClose);
  useEffect(() => box.current?.focus(), []);
  return (
    <div ref={box} className="kn-cal-sheet kn-cal-keys" role="dialog" aria-modal="true" aria-labelledby="kn-cal-keys-title" tabIndex={-1} onKeyDown={escToClose(onClose)}>
      <h3 id="kn-cal-keys-title">{t("calendar.keys.title")}</h3>
      <dl>
        {shownShortcuts().map((s) => (
          <div key={s.label} data-shortcut={s.keys[0]}>
            <dt>
              {s.keys.map((k, i) => (
                <span key={k}>
                  {i ? <span className="kn-cal-muted"> {t("calendar.keys.or")} </span> : null}
                  <kbd>{k}</kbd>
                </span>
              ))}
            </dt>
            <dd>{t(s.label)}</dd>
          </div>
        ))}
      </dl>
      <p className="kn-cal-muted">{t("calendar.keys.where")}</p>
    </div>
  );
}

export function GoToDate({ day, onGo, onClose }: { day: string; onGo(day: string): void; onClose(): void }) {
  const { t } = useT();
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(day);
  useSheet(box, onClose);
  useEffect(() => field.current?.focus(), []);
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(value);
  return (
    <div ref={box} className="kn-cal-sheet kn-cal-goto" role="dialog" aria-modal="true" aria-labelledby="kn-cal-goto-title" onKeyDown={escToClose(onClose)}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) onGo(value);
        }}
      >
        <h3 id="kn-cal-goto-title">{t("calendar.goto.title")}</h3>
        <input ref={field} type="date" name="goto" aria-label={t("calendar.goto.title")} value={value} onChange={(e) => setValue(e.target.value)} />
        <div className="kn-cal-acts">
          <button type="button" className="kn-cal-btn" onClick={onClose}>
            {t("calendar.new.cancel")}
          </button>
          <button type="submit" className="kn-cal-btn kn-cal-primary" disabled={!ok}>
            {t("calendar.goto.go")}
          </button>
        </div>
      </form>
    </div>
  );
}
