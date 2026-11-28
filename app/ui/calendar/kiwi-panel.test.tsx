// O painel do Kiwi no Calendário (T32156): o período que ele lê, o Hoje, a hora onde a pendência cai, o "Agora não"
// guardado, e o painel desenhado (a sugestão com os botões, o Hoje e as sem data), em português e em inglês. O
// arrastar de verdade é da tela viva: o roteiro da T32157 o prova.

import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { CalendarItem, CalendarItems } from "../../src/shared/calendar.ts";
import { suggestion } from "../../src/shared/calendar-kiwi.ts";
import { setAppLocale } from "../src/i18n.ts";
import { DISMISS_KEEP_MS, DISMISS_STORAGE_KEY, dismissedStore, dropStart, dropUpdate, panelRange, todayItems } from "./kiwi-panel.ts";
import { KiwiPanel } from "./KiwiPanel.tsx";
import { isAskShortcut, KiwiAskBox } from "./KiwiAsk.tsx";
import { openKiwiAsk, provideKiwiAsk } from "../hub/kiwi-ask.ts";
import { memorySource } from "./source.ts";

afterEach(() => setAppLocale({ setting: "auto", locale: "pt", system: "pt" }));

const item = (over: Partial<CalendarItem> & Pick<CalendarItem, "id" | "title" | "start">): CalendarItem => ({
  kind: "task",
  project: "Projeto X",
  end: null,
  allDay: over.start.length === 10,
  notify: "none",
  readOnly: false,
  source: { path: "Projeto X/Pendências.md", line: 2, internal: false },
  ...over,
});

const TODAY = "2026-11-26";
const NOW = new Date(2026, 10, 26, 15, 0).getTime();

const data: CalendarItems = {
  items: [
    item({ id: "n:a#1:1", title: "Revisão do Projeto X", kind: "meeting", start: "2026-11-26T10:00", end: "2026-11-26T11:00", notify: "10m" }),
    item({ id: "n:a#2:2", title: "Feira", kind: "reminder", start: "2026-11-26", project: null }),
    item({ id: "n:a#3:3", title: "Entrega do relatório", start: "2026-11-28T09:00" }),
  ],
  undated: [item({ id: "n:a#4:4", title: "Atualizar o README", start: "" }), item({ id: "n:b#1:5", title: "Comprar mudas", start: "", project: null })],
  projects: ["Projeto X"],
};

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe("o lado puro", () => {
  test("o período: duas semanas para trás e os prazos à frente, dentro do limite do main", () => {
    expect(panelRange(TODAY)).toEqual({ from: "2026-11-12", to: "2026-12-01" });
  });

  test("o Hoje: o dia todo primeiro, depois a hora; o de outro dia fica de fora", () => {
    expect(todayItems(data.items, TODAY).map((i) => i.title)).toEqual(["Feira", "Revisão do Projeto X"]);
  });

  test("a hora onde a pendência cai: passos de 15 min, dentro do dia; sem hora, o dia todo", () => {
    expect(dropStart("2026-11-27", 9 * 60 + 7)).toBe("2026-11-27T09:00");
    expect(dropStart("2026-11-27", 9 * 60 + 8)).toBe("2026-11-27T09:15");
    // O allDay vai sempre: sem ele, a pendência sem data cai como "dia todo" mesmo solta às 9h.
    expect(dropUpdate("n:a.md#3:x", "2026-11-27T09:15")).toEqual({ id: "n:a.md#3:x", start: "2026-11-27T09:15", allDay: false });
    expect(dropUpdate("n:a.md#3:x", "2026-11-27")).toEqual({ id: "n:a.md#3:x", start: "2026-11-27", allDay: true });
    expect(dropStart("2026-11-27", -30)).toBe("2026-11-27T00:00");
    expect(dropStart("2026-11-27", 24 * 60 + 40)).toBe("2026-11-27T23:45");
    expect(dropStart("2026-11-27", null)).toBe("2026-11-27");
  });

  test("o \"Agora não\" fica guardado por uma semana, e um valor estragado conta como nada", () => {
    let clock = NOW;
    const s = memory();
    const store = dismissedStore(s, () => clock);
    store.add("deadline|Projeto X/Pendências.md|Entrega");
    expect([...store.keys()]).toEqual(["deadline|Projeto X/Pendências.md|Entrega"]);
    clock += DISMISS_KEEP_MS;
    expect(store.keys().size).toBe(0);
    s.m.set(DISMISS_STORAGE_KEY, "{ estragado");
    expect(store.keys().size).toBe(0);
    expect(dismissedStore(null).keys().size).toBe(0);
  });
});

describe("o painel desenhado", () => {
  const render = (storage = memory()) =>
    renderToStaticMarkup(<KiwiPanel source={memorySource([])} today={TODAY} now={NOW} face="data:image/png;base64,AA==" save={async () => {}} storage={storage} initial={data} />);

  test("a sugestão com os dois botões, o Hoje com o aviso e as sem data com o projeto", () => {
    const html = render();
    expect(html).toContain('class="kn-cal-kiwi"');
    expect(html).toMatch(/kn-cal-kiwi-sug" data-rule="deadline" data-item="n:a#3:3"/);
    expect(html).toContain("“Entrega do relatório” é sábado, 9h. Quer que eu te lembre?");
    expect(html).toMatch(/data-action="accept"[^>]*>Sim, me lembra</);
    expect(html).toMatch(/data-action="dismiss"[^>]*>Agora não</);
    expect(html).toMatch(/Feira[\s\S]*Revisão do Projeto X<small>o Kiwi avisa 10 min antes<\/small>/);
    expect(html).toContain("Projeto X: Atualizar o README");
    expect(html).toContain(">Comprar mudas<");
    expect(html).toContain("Arraste para o calendário para marcar.");
  });

  test("a sugestão dispensada sai, e a próxima regra não aparece sem motivo: o cartão some", () => {
    const s = memory();
    // A chave é a da regra (calendar-kiwi.ts), a mesma que o "Agora não" grava.
    dismissedStore(s).add(suggestion(data.items, NOW, "pt")!.key);
    expect(render(s)).not.toContain("kn-cal-kiwi-sug");
  });

  test("o filtro da tela vale no Hoje e no sem data; o item sem projeto fica (T32408)", () => {
    const html = renderToStaticMarkup(
      <KiwiPanel source={memorySource([])} today={TODAY} now={NOW} face={null} save={async () => {}} storage={memory()} initial={data} filter={{ kinds: [], projects: ["Projeto X"] }} />,
    );
    expect(html).not.toContain("Revisão do Projeto X");
    expect(html).not.toContain("Atualizar o README");
    expect(html).toContain("Feira");
    expect(html).toContain(">Comprar mudas<");
    const byKind = renderToStaticMarkup(
      <KiwiPanel source={memorySource([])} today={TODAY} now={NOW} face={null} save={async () => {}} storage={memory()} initial={data} filter={{ kinds: ["reminder"], projects: [] }} />,
    );
    expect(byKind).not.toContain("Feira");
    expect(byKind).toContain("Revisão do Projeto X");
  });

  test("em inglês, sem sobra de português", () => {
    setAppLocale({ setting: "en", locale: "en", system: "en" });
    const html = render();
    expect(html).toContain("Want me to remind you?");
    expect(html).toContain("Undated tasks");
    expect(html).toContain("Kiwi reminds you 10 min before");
    expect(html).not.toMatch(/Hoje|Pendências sem data|Arraste|o Kiwi avisa/);
  });
});

describe("a busca do Kiwi (⌘K)", () => {
  test("abre o campo do gato que está registrado; sem gato, ninguém atende; a volta só tira o próprio registro", () => {
    expect(openKiwiAsk()).toBe(false);
    const got: (string | undefined)[] = [];
    const off = provideKiwiAsk((d) => void got.push(d));
    expect(openKiwiAsk("me lembra da feira")).toBe(true);
    expect(openKiwiAsk()).toBe(true);
    expect(got).toEqual(["me lembra da feira", undefined]);
    const offOther = provideKiwiAsk(() => {});
    off();
    expect(openKiwiAsk()).toBe(true);
    offOther();
    expect(openKiwiAsk()).toBe(false);
  });

  test("o atalho: ⌘K ou Ctrl+K, sem Shift nem Option", () => {
    const k = (o: Partial<KeyboardEvent>) => isAskShortcut({ key: "k", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...o });
    expect(k({ metaKey: true })).toBe(true);
    expect(k({ ctrlKey: true, key: "K" })).toBe(true);
    expect(k({})).toBe(false);
    expect(k({ metaKey: true, shiftKey: true })).toBe(false);
    expect(k({ metaKey: true, altKey: true })).toBe(false);
    expect(k({ metaKey: true, key: "j" })).toBe(false);
  });

  test("a caixa com o exemplo e o ⌘K; sem o gato, ela não aparece", () => {
    const html = renderToStaticMarkup(<KiwiAskBox active face={null} available />);
    expect(html).toContain('class="kn-cal-ask"');
    expect(html).toContain("Peça ao Kiwi: “me lembra da entrega amanhã às 9h”");
    expect(html).toContain("<kbd>⌘K</kbd>");
    expect(renderToStaticMarkup(<KiwiAskBox active face={null} available={false} />)).toBe("");
    setAppLocale({ setting: "en", locale: "en", system: "en" });
    expect(renderToStaticMarkup(<KiwiAskBox active face={null} available />)).toContain("Ask Kiwi");
  });

  test("a barra é um campo; pensando, os pontos e o Parar; no fim, a resposta debaixo dela e o × (T34755)", () => {
    const idle = renderToStaticMarkup(<KiwiAskBox active face={null} available />);
    expect(idle).toMatch(/<input[^>]*class="kn-cal-ask-input"[^>]*placeholder="Peça ao Kiwi/);
    expect(idle).toContain('aria-label="Pedido ao Kiwi"');
    expect(idle).toContain('data-phase="idle"');
    expect(idle).not.toContain("kn-cal-ask-answer");
    const base = { id: "r1", asked: "o que tenho amanhã?", answer: "", speech: null };
    const thinking = renderToStaticMarkup(<KiwiAskBox active face={null} available initial={{ ...base, phase: "thinking" }} />);
    expect(thinking).toContain('class="kn-cal-ask-dots"');
    expect(thinking).not.toContain("<kbd>");
    expect(thinking).toMatch(/role="status"[^>]*>Pensando…</);
    expect(thinking).toContain(">Parar<");
    const answering = renderToStaticMarkup(<KiwiAskBox active face={null} available initial={{ ...base, phase: "answering", answer: "Amanhã você" }} />);
    expect(answering).toContain('class="kn-cal-ask-answer" data-phase="answering"');
    expect(answering).toMatch(/role="status"[^>]*>Amanhã você</);
    const done = renderToStaticMarkup(<KiwiAskBox active face={null} available initial={{ ...base, phase: "done", answer: "Amanhã você tem a feira." }} />);
    expect(done).toContain("o que tenho amanhã?");
    expect(done).toMatch(/role="status"[^>]*>Amanhã você tem a feira\.</);
    expect(done).toContain('aria-label="Fechar a resposta"');
    expect(done).toContain("<kbd>⌘K</kbd>");
    const error = renderToStaticMarkup(<KiwiAskBox active face={null} available initial={{ ...base, phase: "error" }} />);
    expect(error).toContain("Não deu para pedir agora.");
    setAppLocale({ setting: "en", locale: "en", system: "en" });
    expect(renderToStaticMarkup(<KiwiAskBox active face={null} available initial={{ ...base, phase: "thinking" }} />)).toMatch(/Thinking…[\s\S]*>Stop</);
  });
});
