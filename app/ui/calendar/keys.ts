// O teclado do Calendário (T34762, spec #34706, régua 1.1–1.5 e 1.10): teclas simples, no estilo do Google Agenda,
// sem ⌘ (o ⌘ é das abas e da busca do hub) e só fora de campo de texto (lead #34756). As mesmas em pt e en: a letra é
// a do Google, não a da palavra. A tela (Calendar.tsx) só faz o que sai daqui; os testes ficam em keys.test.ts.

import { type CalendarView, isCalendarView } from "./model.ts";

export type CalendarKeyAction =
  | { type: "today" }
  | { type: "step"; dir: 1 | -1 }
  | { type: "view"; view: CalendarView }
  | { type: "new" }
  | { type: "goto" }
  | { type: "help" };

/** Cada tecla e a vista dela. O `y` (o Ano) só vale quando a vista existir (T34785). */
const VIEW_KEYS: Record<string, string> = { d: "day", w: "week", m: "month", a: "agenda", y: "year" };

/** A tecla de cada vista, para o `aria-keyshortcuts` do botão dela. */
export const VIEW_KEY: Record<string, string> = Object.fromEntries(Object.entries(VIEW_KEYS).map(([k, v]) => [v, k.toUpperCase()]));

/** A lista da folha do `?`, na ordem em que aparece. `keys` são as teclas como se mostram; `label`, a chave do texto. */
export const SHORTCUTS: readonly { keys: readonly string[]; label: string; view?: string }[] = [
  { keys: ["T"], label: "calendar.keys.today" },
  { keys: ["J", "→"], label: "calendar.keys.next" },
  { keys: ["K", "←"], label: "calendar.keys.prev" },
  { keys: ["D"], label: "calendar.keys.day", view: "day" },
  { keys: ["W"], label: "calendar.keys.week", view: "week" },
  { keys: ["M"], label: "calendar.keys.month", view: "month" },
  { keys: ["A"], label: "calendar.keys.agenda", view: "agenda" },
  { keys: ["Y"], label: "calendar.keys.year", view: "year" },
  { keys: ["C"], label: "calendar.keys.new" },
  { keys: ["G"], label: "calendar.keys.goto" },
  { keys: ["?"], label: "calendar.keys.help" },
  { keys: ["Esc"], label: "calendar.keys.close" },
];

/** As linhas da folha que valem hoje: a do Ano só aparece com a vista. */
export const shownShortcuts = () => SHORTCUTS.filter((s) => !s.view || isCalendarView(s.view));

/** Os tipos de `<input>` em que a letra não é texto: neles a tecla é do Calendário. */
const NOT_TEXT = new Set(["button", "checkbox", "radio", "range", "color", "file", "image", "reset", "submit"]);

/** O foco está num lugar em que a letra é texto: um campo, uma caixa de texto, um `select` ou um editor. */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!el || typeof (el as Element).closest !== "function") return false;
  const e = el as HTMLElement;
  if (e.isContentEditable || e.closest("[contenteditable]:not([contenteditable='false'])")) return true;
  const tag = e.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !NOT_TEXT.has(((e as HTMLInputElement).type || "text").toLowerCase());
  return false;
}

/**
 * Os lugares em que as setas já têm dono: a escolha da vista e do tipo (`radiogroup`), o item com o foco (as setas do
 * item são do T34765), o painel do Kiwi e as folhas abertas. Fora deles, ← e → trocam o período.
 */
const ARROW_OWNERS = "[role='radiogroup'], .kn-cal-item, .kn-cal-side, [role='dialog'], .kn-cal-projects-pop";

export interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
  defaultPrevented?: boolean;
  target: EventTarget | null;
}

/** A ação de uma tecla no Calendário, ou `null` se a tecla não é dele. */
export function calendarKey(e: KeyLike): CalendarKeyAction | null {
  if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return null;
  if (isTypingTarget(e.target)) return null;
  // O `?` sai com o Shift (no ABNT2 e no americano); as letras, só sem ele: o ⇧T não é o T.
  if (e.key === "?") return { type: "help" };
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    const t = e.target as Element | null;
    if (e.shiftKey || (t && typeof t.closest === "function" && t.closest(ARROW_OWNERS))) return null;
    return { type: "step", dir: e.key === "ArrowRight" ? 1 : -1 };
  }
  if (e.shiftKey || e.key.length !== 1) return null;
  const k = e.key.toLowerCase();
  if (k === "t") return { type: "today" };
  if (k === "j") return { type: "step", dir: 1 };
  if (k === "k") return { type: "step", dir: -1 };
  if (k === "c") return { type: "new" };
  if (k === "g") return { type: "goto" };
  const v = VIEW_KEYS[k];
  if (v && isCalendarView(v)) return { type: "view", view: v };
  return null;
}
