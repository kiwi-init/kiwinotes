// A tela do Calendário desenhada (T32155): os ganchos que os roteiros da parte 4 usam (#32168), a caixa só com o
// fundo na cor do tipo, o cartão com um só ⤢, e o inglês sem sobra de português. A animação e o arrastar são da
// tela viva: o roteiro `cli ui` da T32157 os prova.

import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { type CalendarItem, parseWhen } from "../../src/shared/calendar.ts";
import { setAppLocale } from "../src/i18n.ts";
import { type DetailActions, HoverCard } from "./Detail.tsx";
import { memorySource } from "./source.ts";
import { AgendaList, cascadeStyle, type ItemHandlers, type ItemState, MonthGrid, TimeGrid } from "./views.tsx";
import { viewRange } from "./model.ts";

const english = () => setAppLocale({ setting: "en", locale: "en", system: "en" });
afterEach(() => setAppLocale({ setting: "auto", locale: "pt", system: "pt" }));

const item = (over: Partial<CalendarItem> = {}): CalendarItem => ({
  id: "n:Projeto X/Pendências.md#4:abc",
  kind: "meeting",
  title: "Plano do jardim",
  project: "Projeto X",
  start: "2026-11-25T10:00",
  end: "2026-11-25T11:00",
  allDay: false,
  notify: "10m",
  readOnly: false,
  source: { path: "Projeto X/Pendências.md", line: 4, internal: false },
  ...over,
});

const items: CalendarItem[] = [
  item(),
  item({ id: "n:a#1:x", kind: "task", title: "Regar as mudas", start: "2026-11-25T10:30", end: null, notify: "none" }),
  item({ id: "n:a#2:y", kind: "reminder", title: "Feira", start: "2026-11-26", end: null, allDay: true, notify: "atTime", source: null }),
  item({ id: "m:r", kind: "meeting", title: "Conversa com a Ana", start: "2026-11-27T15:00", end: "2026-11-27T15:30", readOnly: true, source: { path: "Reuniões/Conversa.md", line: 0, internal: true } }),
];

const h: ItemHandlers = { onEnter() {}, onLeave() {}, onPointerDown() {}, onOpen() {} };
const s: ItemState = { openId: null, dragId: null, pulseId: null, kiwiFace: "data:image/png;base64,AA==" };
const a: DetailActions = { openNote() {}, snooze() {}, toggleDone() {}, setNotify() {}, edit: async () => {}, remove() {} };
const ctx = { projects: ["Projeto X"], source: memorySource([]) };
const week = viewRange("week", "2026-11-25");
const now = Date.parse("2026-11-25T12:00");

describe("as vistas do Calendário", () => {
  test("a Semana: sete colunas, o hoje, a faixa do dia todo, a linha do agora e os ganchos do item", () => {
    const html = renderToStaticMarkup(<TimeGrid days={week.days} items={items} today="2026-11-25" now={now} h={h} s={s} />);
    expect(html.match(/class="kn-cal-col"/g)?.length).toBe(7);
    expect(html).toContain('class="kn-cal-col" data-day="2026-11-25" data-today=""');
    expect(html).toContain('class="kn-cal-now"');
    expect(html).toMatch(/kn-cal-allday-cell" data-day="2026-11-26">.*Feira/);
    // O item leva o tipo, a nota e a linha 1-based dela (a mesma que as Notas marcam com `data-flash-line`).
    expect(html).toContain('data-kind="meeting" data-path="Projeto X/Pendências.md" data-line="5"');
    // As duas coisas das 10h ficam em cascata: a segunda por cima, deslocada, sem partir a coluna (lead #32229).
    expect(html).toMatch(/Plano do jardim[\s\S]*kn-cal-resize/);
    expect(html.match(/data-depth="1"/g)?.length).toBe(1);
    expect(html).toMatch(/data-depth="1"[^>]*style="[^"]*width:calc\(100% - min\(16px, 45%\) \* 1 - 6px\)/);
    expect(html).toMatch(/data-id="m:r"[^>]*data-readonly=""/);
    expect(html.match(/kn-cal-resize/g)?.length).toBe(2);
    // O Kiwi marca só o que ele avisa.
    expect(html.match(/kn-cal-kiwi-mark/g)?.length).toBe(3);
  });

  test("o Mês e a Agenda", () => {
    const month = viewRange("month", "2026-11-25");
    const html = renderToStaticMarkup(<MonthGrid days={month.days} anchor="2026-11-25" items={items} today="2026-11-25" h={h} s={s} onDay={() => {}} />);
    expect(html.match(/class="kn-cal-cell"/g)?.length).toBe(42);
    expect(html).toContain('data-day="2026-12-01" data-out=""');
    const agenda = renderToStaticMarkup(<AgendaList days={viewRange("agenda", "2026-11-25").days} items={items} today="2026-11-25" h={h} s={s} />);
    expect(agenda.match(/kn-cal-agenda-day/g)?.length).toBe(3);
    expect(agenda).toContain("kn-cal-row");
  });

  test("o cartão: um só ⤢, no canto, e o link da nota com a linha", () => {
    const html = renderToStaticMarkup(<HoverCard item={items[0]!} at={{ left: 0, top: 0, width: 300, height: 0 }} face={null} a={a} ctx={ctx} onExpand={() => {}} onEnter={() => {}} onLeave={() => {}} />);
    expect(html.match(/kn-cal-expand/g)?.length).toBe(1);
    expect(html.match(/⤢/g)?.length).toBe(1);
    expect(html).toContain('data-note-link="Projeto X/Pendências.md"');
    expect(html).toContain("Projeto X / Pendências");
    expect(html).toContain("10 min antes");
  });

  test("em inglês, nada em português", () => {
    english();
    const html =
      renderToStaticMarkup(<TimeGrid days={week.days} items={items} today="2026-11-25" now={now} h={h} s={s} />) +
      renderToStaticMarkup(<HoverCard item={items[0]!} at={{ left: 0, top: 0, width: 300, height: 0 }} face={null} a={a} ctx={ctx} onExpand={() => {}} onEnter={() => {}} onLeave={() => {}} />);
    for (const text of ["all day", "Meeting", "Open the note", "10 min before"]) expect(html).toContain(text);
    for (const text of ["Dia todo", "Reunião", "Abrir a nota"]) expect(html).not.toContain(text);
  });
});

test("a cascata: o nível 0 tem a coluna inteira, e cada nível desce para a direita sem passar de 45%", () => {
  expect(cascadeStyle(0, 1)).toEqual({ left: "calc(0px * 0 + 3px)", width: "calc(100% - 0px * 0 - 6px)", zIndex: 1 });
  expect(cascadeStyle(2, 3).left).toBe("calc(min(16px, 22.5%) * 2 + 3px)");
  expect(cascadeStyle(2, 3).zIndex).toBe(3);
});

describe("a fonte na memória", () => {
  test("lê o período, muda, avisa e dá E_CONFLICT num id que sumiu", async () => {
    const src = memorySource(items, { "Projeto X/Pendências.md": "# Pendências\n\n- [ ] Plano do jardim" });
    let calls = 0;
    const off = src.onChanged(() => calls++);
    const r = await src.items("2026-11-25", "2026-11-26");
    expect(r.items.map((i) => i.title)).toEqual(["Plano do jardim", "Regar as mudas"]);
    expect((await src.update({ id: items[0]!.id, notify: "30m" })).notify).toBe("30m");
    expect(calls).toBe(1);
    await expect(src.update({ id: "n:sumiu#1:z", notify: "none" })).rejects.toMatchObject({ code: "E_CONFLICT" });
    expect((await src.source(items[0]!.id))?.text).toContain("Plano do jardim");
    expect(await src.resolve("Pendências")).toBe("Projeto X/Pendências.md");
    off();
  });
});

test("o cartão de uma repetição com vezes feitas não mostra o ⏭ (#450)", () => {
  const w = parseWhen("Regar as plantas @ 2026-11-25 10:00 🔁 dia ⏭ 2026-11-26 ⏭️ 2026-11-27")!;
  const rep = item({ id: "n:a#3:z~2026-11-25", title: w.title, repeat: "daily", skip: w.skip });
  const agenda = renderToStaticMarkup(<AgendaList days={viewRange("agenda", "2026-11-25").days} items={[rep]} today="2026-11-25" h={h} s={s} />);
  expect(agenda).toContain("Regar as plantas");
  expect(agenda).not.toContain("⏭");
});
