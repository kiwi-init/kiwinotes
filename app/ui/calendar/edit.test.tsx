// Editar e apagar à mão (T34745, spec #34706): os campos viram o `calendar.update` certo, cada tipo de item mostra só o
// que pode mudar, e a fonte na memória apaga e desfaz. O clique, o teclado e o Desfazer na tela viva são do roteiro
// `calendar-ui-check`.

import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { CalendarItem } from "../../src/shared/calendar.ts";
import { setAppLocale } from "../src/i18n.ts";
import { type DetailActions, WidePanel } from "./Detail.tsx";
import { editable, fieldsOf, isOccurrence, typing, whenPatch } from "./edit.ts";
import { ItemEditor } from "./Editor.tsx";
import { memorySource } from "./source.ts";

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

const a: DetailActions = { openNote() {}, snooze() {}, toggleDone() {}, setNotify() {}, edit: async () => {}, remove() {} };
const source = memorySource([]);
const editor = (it: CalendarItem, compact = false) => renderToStaticMarkup(<ItemEditor item={it} projects={["Projeto X", "Projeto Y"]} source={source} a={a} compact={compact} />);

describe("os campos de data e hora (whenPatch)", () => {
  const timed = item();
  test("os campos mostram o item; sem mudança, nada a gravar", () => {
    expect(fieldsOf(timed)).toEqual({ day: "2026-11-25", from: "10:00", to: "11:00", allDay: false });
    expect(fieldsOf(item({ start: "2026-11-26", end: null, allDay: true }))).toEqual({ day: "2026-11-26", from: "", to: "", allDay: true });
    expect(whenPatch(timed, fieldsOf(timed))).toEqual({});
  });

  test("o dia, o início e o fim; o fim antes do início é no dia seguinte; o fim vazio tira o fim", () => {
    expect(whenPatch(timed, { day: "2026-11-27", from: "10:00", to: "11:00", allDay: false })).toEqual({ start: "2026-11-27T10:00", end: "2026-11-27T11:00", allDay: false });
    expect(whenPatch(timed, { day: "2026-11-25", from: "09:15", to: "11:00", allDay: false })).toEqual({ start: "2026-11-25T09:15", end: "2026-11-25T11:00", allDay: false });
    expect(whenPatch(timed, { day: "2026-11-25", from: "23:30", to: "00:30", allDay: false })).toEqual({ start: "2026-11-25T23:30", end: "2026-11-26T00:30", allDay: false });
    expect(whenPatch(timed, { day: "2026-11-25", from: "10:00", to: "", allDay: false })).toEqual({ start: "2026-11-25T10:00", end: null, allDay: false });
  });

  test("o que não fecha dá null: dia que não existe, hora pela metade, fim igual ao início", () => {
    expect(whenPatch(timed, { day: "2026-02-30", from: "10:00", to: "", allDay: false })).toBeNull();
    expect(whenPatch(timed, { day: "", from: "10:00", to: "", allDay: false })).toBeNull();
    expect(whenPatch(timed, { day: "2026-11-25", from: "10:0", to: "", allDay: false })).toBeNull();
    expect(whenPatch(timed, { day: "2026-11-25", from: "10:00", to: "10:00", allDay: false })).toBeNull();
  });

  test("dia todo: liga sem hora; desliga com as 09:00; o de vários dias leva o fim junto", () => {
    expect(whenPatch(timed, { day: "2026-11-25", from: "", to: "", allDay: true })).toEqual({ start: "2026-11-25", end: null, allDay: true });
    const feira = item({ start: "2026-11-26", end: null, allDay: true });
    expect(whenPatch(feira, { day: "2026-11-26", from: "", to: "", allDay: false })).toEqual({ start: "2026-11-26T09:00", end: null, allDay: false });
    expect(whenPatch(feira, { day: "2026-11-26", from: "", to: "", allDay: true })).toEqual({});
    const viagem = item({ start: "2026-11-26", end: "2026-11-28", allDay: true });
    expect(whenPatch(viagem, { day: "2026-11-30", from: "", to: "", allDay: true })).toEqual({ start: "2026-11-30", end: "2026-12-02", allDay: true });
  });

  test("quem edita e a tecla Delete", () => {
    expect(editable(item())).toEqual({ any: true, line: true });
    expect(editable(item({ id: "f:Projeto X/Pauta.md", kind: "note" }))).toEqual({ any: true, line: false });
    expect(editable(item({ id: "m:r", readOnly: true }))).toEqual({ any: false, line: false });
    expect(isOccurrence("n:a.md#1:abcdef12~2026-12-01")).toBe(true);
    expect(isOccurrence("n:a.md#1:abcdef12")).toBe(false);
    expect(typing(null)).toBe(false);
    expect(typing({ closest: (q: string) => (q.includes("input") ? {} : null) } as unknown as EventTarget)).toBe(true);
    expect(typing({ closest: () => null } as unknown as EventTarget)).toBe(false);
  });
});

describe("o editor no cartão e no painel largo", () => {
  test("uma linha: título, tipo, projeto, dia, início, fim, dia todo, repetição, texto e Apagar", () => {
    const html = editor(item({ repeat: "weekly" }));
    expect(html).toContain('name="title" value="Plano do jardim"');
    expect(html).toMatch(/role="radio" data-kind="meeting" aria-checked="true"/);
    expect(html.match(/data-kind="/g)?.length).toBe(4);
    expect(html).toMatch(/<select name="project">[\s\S]*Sem projeto[\s\S]*Projeto X[\s\S]*Projeto Y/);
    expect(html).toContain('type="date" required="" name="day" value="2026-11-25"');
    expect(html).toContain('type="time" step="300" name="from" value="10:00"');
    expect(html).toContain('type="time" step="300" name="to" value="11:00"');
    expect(html).toContain('type="checkbox" name="allDay"');
    expect(html).toMatch(/<select name="repeat">[\s\S]*não repete[\s\S]*toda semana/);
    expect(html).toContain('name="text"');
    expect(html).toContain('data-delete="item"');
    // Os avisos ficam no fim do painel largo; no cartão, o editor os traz.
    expect(html).not.toContain("data-notify");
    expect(editor(item(), true)).toContain('data-notify="10m"');
  });

  test("uma vez da repetição: apagar esta vez ou a série", () => {
    const html = editor(item({ id: "n:Projeto X/Pendências.md#4:abc~2026-12-02", repeat: "weekly" }));
    expect(html).toContain('data-delete="once"');
    expect(html).toContain('data-delete="series"');
    expect(html).not.toContain('data-delete="item"');
  });

  test("a nota com agenda: o título é o da nota; sem tipo, projeto nem repetição; o apagar só a tira do calendário", () => {
    const html = editor(item({ id: "f:Projeto X/Pauta.md", kind: "note", title: "Pauta", source: { path: "Projeto X/Pauta.md", line: null as unknown as number, internal: false } }));
    expect(html).toMatch(/<input[^>]*disabled=""[^>]*name="title"/);
    expect(html).not.toContain('name="project"');
    expect(html).not.toContain('name="repeat"');
    expect(html).not.toContain("data-kind=");
    expect(html).toContain('name="day" value="2026-11-25"');
    expect(html).toContain("Tirar do calendário");
  });

  test("a reunião gravada não tem editor; o painel largo mostra o editor só no que se edita", () => {
    expect(editor(item({ id: "m:r", readOnly: true }))).toBe("");
    const wide = (it: CalendarItem) =>
      renderToStaticMarkup(
        <WidePanel item={it} from={{ left: 0, top: 0, width: 300, height: 200 }} to={{ left: 0, top: 0, width: 540, height: 600 }} state="open" back={() => null} face={null} a={a} items={[it]} projects={["Projeto X"]} source={source} openPath={() => {}} openItem={() => {}} onOpened={() => {}} onClosed={() => {}} onCollapse={() => {}} />,
      );
    expect(wide(item())).toContain("kn-cal-editor");
    const rec = wide(item({ id: "m:r", readOnly: true, source: { path: "Reuniões/Conversa.md", line: 0, internal: true } }));
    expect(rec).not.toContain("kn-cal-editor");
    expect(rec).toContain("Reunião gravada");
  });

  test("em inglês, nada em português", () => {
    english();
    const html = editor(item({ id: "n:a#1:abc~2026-12-02", repeat: "weekly" }), true);
    for (const text of ["Title", "Project", "No project", "Start", "End", "All day", "every week", "Text", "Delete this time", "Delete the series"]) expect(html).toContain(text);
    for (const text of ["Título", "Sem projeto", "Início", "Dia todo", "Apagar", "não repete"]) expect(html).not.toContain(text);
  });
});

describe("a fonte na memória: apagar e desfazer", () => {
  const seed = () => [item(), item({ id: "n:b#2:def", title: "Feira", kind: "reminder", repeat: "weekly", project: null })];

  test("apaga o item e o Desfazer o põe de volta no mesmo lugar", async () => {
    const m = memorySource(seed());
    const undo = await m.remove({ id: "n:Projeto X/Pendências.md#4:abc" });
    expect(m.list.map((i) => i.title)).toEqual(["Feira"]);
    await m.restore(undo);
    expect(m.list.map((i) => i.title)).toEqual(["Plano do jardim", "Feira"]);
  });

  test("só esta vez: a série fica com o ⏭ daquele dia; o Desfazer tira o ⏭", async () => {
    const m = memorySource(seed());
    const undo = await m.remove({ id: "n:b#2:def~2026-12-02", only: true });
    expect(m.list.find((i) => i.title === "Feira")?.skip).toEqual(["2026-12-02"]);
    await m.restore(undo);
    expect(m.list.find((i) => i.title === "Feira")?.skip).toBeUndefined();
  });

  test("o projeto troca a nota do item; a reunião gravada não se apaga", async () => {
    const m = memorySource([...seed(), item({ id: "m:r", readOnly: true })]);
    const moved = await m.update({ id: "n:b#2:def", project: "Projeto X" });
    expect(moved).toMatchObject({ project: "Projeto X", source: { path: "Projeto X/Pendências.md" } });
    expect(await m.remove({ id: "m:r" }).catch((e: { code?: string }) => e.code)).toBe("E_READONLY");
  });
});

describe("a fonte na memória: o texto do item", () => {
  test("numa linha, as de baixo com recuo; na nota com agenda:, o corpo; o item não ganha um campo text", async () => {
    const texts = { "Projeto X/Pendências.md": "# Pendências\n\n- [ ] Plano do jardim @ 2026-11-25 10:00\n  - velho\n- [ ] Outro\n", "Projeto X/Pauta.md": "---\nagenda: 2026-11-25\n---\n\nvelho\n" };
    const m = memorySource([item({ source: { path: "Projeto X/Pendências.md", line: 2, internal: false } }), item({ id: "f:Projeto X/Pauta.md", kind: "note", title: "Pauta", source: { path: "Projeto X/Pauta.md", line: 0, internal: false } })], texts);
    const got = await m.update({ id: "n:Projeto X/Pendências.md#4:abc", text: "comprar sementes\n\nregar" });
    expect(got).not.toHaveProperty("text");
    expect(texts["Projeto X/Pendências.md"]).toBe("# Pendências\n\n- [ ] Plano do jardim @ 2026-11-25 10:00\n  comprar sementes\n  regar\n- [ ] Outro\n");
    await m.update({ id: "f:Projeto X/Pauta.md", text: "novo" });
    expect(texts["Projeto X/Pauta.md"]).toBe("---\nagenda: 2026-11-25\n---\n\nnovo\n");
  });
});
