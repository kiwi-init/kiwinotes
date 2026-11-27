// De onde a aba Calendário lê e para onde escreve (T32155). No app, as capacidades `calendar.*` do main (T32154); nos
// testes, uma lista na memória. A tela só conhece esta interface.

import type { CalendarCreate, CalendarItem, CalendarItems, CalendarSource, CalendarUpdate } from "../../src/shared/calendar.ts";
import { dayOf, toMs } from "../../src/shared/calendar.ts";
import { api } from "../src/api.ts";

export interface CalendarStore {
  items(from: string, to: string): Promise<CalendarItems>;
  update(u: CalendarUpdate): Promise<CalendarItem>;
  create(c: CalendarCreate): Promise<CalendarItem>;
  /** O texto da nota de onde o item veio, para a aba "Nota" do painel largo. */
  source(id: string): Promise<CalendarSource | null>;
  /** O caminho de uma nota pelo nome de um `[[link]]`, para a aba "Ligações"; `null` sem nota. */
  resolve(link: string): Promise<string | null>;
  onChanged(fn: () => void): () => void;
}

/** Uma fonte na memória: os testes da tela e o print sem o main. `texts` é o conteúdo de cada nota, por caminho. */
export function memorySource(seed: CalendarItem[], texts: Record<string, string> = {}): CalendarStore & { list: CalendarItem[] } {
  const list = seed.map((i) => ({ ...i }));
  const subs = new Set<() => void>();
  const changed = () => subs.forEach((f) => f());
  let n = 0;
  return {
    list,
    async items(from, to) {
      const a = toMs(from);
      const b = toMs(to);
      const items = list.filter((i) => {
        const s = toMs(i.start);
        return s < b && (i.end ? toMs(i.end) : s) >= a;
      });
      return { items, undated: [], projects: [...new Set(list.map((i) => i.project).filter((p): p is string => !!p))].sort() };
    },
    async update(u) {
      const i = list.find((x) => x.id === u.id);
      if (!i) throw Object.assign(new Error("mudou"), { code: "E_CONFLICT" });
      const { id: _id, repeat, ...rest } = u;
      Object.assign(i, rest, repeat === null ? { repeat: undefined } : repeat ? { repeat } : {});
      changed();
      return { ...i };
    },
    async create(c) {
      const item: CalendarItem = {
        id: `n:Calendário.md#${list.length}:${++n}`,
        kind: c.kind,
        title: c.title,
        project: c.project ?? null,
        start: c.start,
        end: c.end ?? null,
        allDay: c.allDay ?? c.start.length === 10,
        notify: c.notify ?? "none",
        readOnly: false,
        source: { path: c.project ? `${c.project}/Pendências.md` : "Calendário.md", line: 0, internal: false },
      };
      list.push(item);
      changed();
      return { ...item };
    },
    async source(id) {
      const i = list.find((x) => x.id === id);
      if (!i?.source) return null;
      return { ...i.source, text: texts[i.source.path] ?? "" };
    },
    async resolve(link) {
      const hit = Object.keys(texts).find((p) => p.replace(/\.md$/, "").split("/").pop() === link);
      return hit ?? null;
    },
    onChanged(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

/** O main (T32154): as capacidades `calendar.*` e o `notes.resolve` para os `[[links]]`. */
export function apiStore(): CalendarStore {
  return {
    items: (from, to) => api.calendar.items(from, to),
    update: (u) => api.calendar.update(u),
    create: (c) => api.calendar.create(c),
    source: (id) => api.calendar.source(id),
    resolve: (link) => api.notes.resolve(link),
    onChanged: (fn) => api.calendar.onChanged(fn),
  };
}

/** Hoje, `AAAA-MM-DD`; a CLI e o print fixam o dia com `?day=`. */
export function todayOf(now = Date.now()): string {
  const q = typeof location !== "undefined" ? new URLSearchParams(location.search).get("day") : null;
  return q && /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : dayOf(now);
}
