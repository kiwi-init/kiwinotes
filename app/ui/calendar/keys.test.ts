// O teclado do Calendário (T34762, régua 1.1–1.5 e 1.10): cada tecla e a ação dela, o que não é dele (com ⌘, ⌃, ⌥ ou
// ⇧, ou com o foco num campo de texto), as setas só fora de quem já as usa, e a folha do `?` em pt e en. A tela viva
// (o foco, as folhas abrindo e fechando) é do roteiro `scripts/calendar-keys-check.ts`.

import { afterEach, describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { setAppLocale } from "../src/i18n.ts";
import { calendarKey, isTypingTarget, type KeyLike, shownShortcuts, VIEW_KEY } from "./keys.ts";
import { GoToDate, KeysHelp } from "./KeySheets.tsx";
import { CALENDAR_VIEWS } from "./model.ts";

afterEach(() => setAppLocale({ setting: "auto", locale: "pt", system: "pt" }));

/** Um alvo falso: a tag, o tipo do input, se edita, e os seletores que o `closest` acha. */
const el = (tagName: string, o: { type?: string; editable?: boolean; inside?: string[] } = {}) => ({
  tagName,
  type: o.type ?? "",
  isContentEditable: !!o.editable,
  closest: (sel: string) => (sel.split(",").some((s) => (o.inside ?? []).some((i) => s.includes(i))) ? {} : null),
});
const body = el("BODY");
const key = (k: string, over: Partial<KeyLike> = {}): KeyLike => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, target: body as never, ...over });

describe("as teclas do Calendário", () => {
  test("cada tecla e a ação dela, em maiúscula ou minúscula (o Caps Lock não muda nada)", () => {
    for (const k of ["t", "T"]) expect(calendarKey(key(k))).toEqual({ type: "today" });
    expect(calendarKey(key("j"))).toEqual({ type: "step", dir: 1 });
    expect(calendarKey(key("k"))).toEqual({ type: "step", dir: -1 });
    expect(calendarKey(key("ArrowRight"))).toEqual({ type: "step", dir: 1 });
    expect(calendarKey(key("ArrowLeft"))).toEqual({ type: "step", dir: -1 });
    expect(calendarKey(key("d"))).toEqual({ type: "view", view: "day" });
    expect(calendarKey(key("w"))).toEqual({ type: "view", view: "week" });
    expect(calendarKey(key("M"))).toEqual({ type: "view", view: "month" });
    expect(calendarKey(key("a"))).toEqual({ type: "view", view: "agenda" });
    expect(calendarKey(key("c"))).toEqual({ type: "new" });
    expect(calendarKey(key("g"))).toEqual({ type: "goto" });
    expect(calendarKey(key("?", { shiftKey: true }))).toEqual({ type: "help" });
  });

  test("o Y só vale quando a vista do Ano existir (T34785)", () => {
    const hasYear = (CALENDAR_VIEWS as readonly string[]).includes("year");
    expect(calendarKey(key("y"))).toEqual(hasYear ? { type: "view", view: "year" as never } : null);
    expect(shownShortcuts().some((s) => s.keys[0] === "Y")).toBe(hasYear);
  });

  test("com ⌘, ⌃, ⌥ ou ⇧ a tecla não é do Calendário: o ⌘T, o ⌘K e as abas do hub ficam como estão", () => {
    for (const k of ["t", "j", "k", "d", "w", "m", "a", "c", "g", "ArrowLeft"]) {
      expect(calendarKey(key(k, { metaKey: true }))).toBeNull();
      expect(calendarKey(key(k, { ctrlKey: true }))).toBeNull();
      expect(calendarKey(key(k, { altKey: true }))).toBeNull();
      expect(calendarKey(key(k, { shiftKey: true }))).toBeNull();
    }
    expect(calendarKey(key("?", { shiftKey: true, metaKey: true }))).toBeNull();
  });

  test("outras teclas, a tecla já tratada e a composição de acento não fazem nada", () => {
    for (const k of ["x", "1", "Enter", " ", "Tab", "Escape", "ArrowUp", "/"]) expect(calendarKey(key(k))).toBeNull();
    expect(calendarKey(key("t", { defaultPrevented: true }))).toBeNull();
    expect(calendarKey(key("t", { isComposing: true }))).toBeNull();
  });

  test("num campo de texto a letra é texto: nada acontece", () => {
    for (const target of [el("INPUT", { type: "text" }), el("INPUT"), el("INPUT", { type: "search" }), el("INPUT", { type: "date" }), el("TEXTAREA"), el("SELECT"), el("DIV", { editable: true }), el("SPAN", { inside: ["[contenteditable]"] })]) {
      expect(isTypingTarget(target as never)).toBe(true);
      for (const k of ["t", "j", "c", "g", "?", "ArrowLeft"]) expect(calendarKey(key(k, { target: target as never, shiftKey: k === "?" }))).toBeNull();
    }
  });

  test("num botão, numa caixa de marcar ou no corpo, a tecla é do Calendário", () => {
    for (const target of [body, el("BUTTON"), el("INPUT", { type: "checkbox" }), el("INPUT", { type: "radio" }), el("A")]) {
      expect(isTypingTarget(target as never)).toBe(false);
      expect(calendarKey(key("t", { target: target as never }))).toEqual({ type: "today" });
    }
    expect(isTypingTarget(null)).toBe(false);
  });

  test("as setas ficam com quem já as usa: as vistas, o item com o foco (T34765), o painel do Kiwi e as folhas", () => {
    for (const owner of ["[role='radiogroup']", ".kn-cal-item", ".kn-cal-side", "[role='dialog']", ".kn-cal-projects-pop"]) {
      const target = el("BUTTON", { inside: [owner] });
      expect(calendarKey(key("ArrowLeft", { target: target as never }))).toBeNull();
      expect(calendarKey(key("ArrowRight", { target: target as never }))).toBeNull();
      // As letras continuam valendo ali: só as setas têm dono.
      expect(calendarKey(key("t", { target: target as never }))).toEqual({ type: "today" });
    }
  });

  test("cada botão de vista tem a tecla dela no aria-keyshortcuts", () => {
    for (const v of CALENDAR_VIEWS) expect(VIEW_KEY[v]).toMatch(/^[A-Z]$/);
    expect(VIEW_KEY).toMatchObject({ day: "D", week: "W", month: "M", agenda: "A" });
  });
});

describe("a folha do ?", () => {
  test("em português: o título, cada tecla com o texto dela, e onde elas valem", () => {
    const html = renderToStaticMarkup(createElement(KeysHelp, { onClose() {} }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Atalhos do teclado");
    for (const k of ["T", "J", "→", "K", "←", "D", "W", "M", "A", "C", "G", "?", "Esc"]) expect(html).toContain(`<kbd>${k}</kbd>`);
    for (const s of ["Hoje", "Próximo período", "Período anterior", "Vista do dia", "Vista da semana", "Vista do mês", "Agenda", "Novo item", "Ir para uma data", "Esta lista"]) expect(html).toContain(s);
    expect(html).toContain("campo de texto");
    expect(html.match(/data-shortcut=/g)?.length).toBe(shownShortcuts().length);
  });

  test("em inglês, sem sobra de português", () => {
    setAppLocale({ setting: "en", locale: "en", system: "en" });
    const html = renderToStaticMarkup(createElement(KeysHelp, { onClose() {} }));
    expect(html).toContain("Keyboard shortcuts");
    for (const s of ["Today", "Next period", "Previous period", "Day view", "Week view", "Month view", "New item", "Go to a date", "This list", "text field"]) expect(html).toContain(s);
    for (const pt of ["Atalhos", "Hoje", "período", "Vista", "campo", " ou "]) expect(html).not.toContain(pt);
  });

  test("o ir para uma data: o campo de data com o dia à vista, e o Ir", () => {
    const html = renderToStaticMarkup(createElement(GoToDate, { day: "2026-11-25", onGo() {}, onClose() {} }));
    expect(html).toContain('type="date"');
    expect(html).toContain('value="2026-11-25"');
    expect(html).toContain("Ir para uma data");
    expect(html).toMatch(/<button type="submit"[^>]*>Ir<\/button>/);
  });
});
