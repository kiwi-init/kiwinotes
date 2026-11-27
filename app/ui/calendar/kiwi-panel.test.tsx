// O painel do Kiwi no Calendário (T32156): o período que ele lê, o Hoje, a hora onde a pendência cai, o "Agora não"
// guardado, e o painel desenhado (a sugestão com os botões, o Hoje e as sem data), em português e em inglês. O
// arrastar de verdade é da tela viva: o roteiro da T32157 o prova.

import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { CalendarItem, CalendarItems } from "../../src/shared/calendar.ts";
import { suggestion } from "../../src/shared/calendar-kiwi.ts";
import { setAppLocale } from "../src/i18n.ts";
import { DISMISS_KEEP_MS, DISMISS_STORAGE_KEY, dismissedStore, dropStart, panelRange, todayItems } from "./kiwi-panel.ts";
import { KiwiPanel } from "./KiwiPanel.tsx";
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

  test("em inglês, sem sobra de português", () => {
    setAppLocale({ setting: "en", locale: "en", system: "en" });
    const html = render();
    expect(html).toContain("Want me to remind you?");
    expect(html).toContain("Undated tasks");
    expect(html).toContain("Kiwi reminds you 10 min before");
    expect(html).not.toMatch(/Hoje|Pendências sem data|Arraste|o Kiwi avisa/);
  });
});
