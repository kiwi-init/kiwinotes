// A Semana da aba Início (T15875): notas, histórico e reuniões falsos, em memória, com dados inventados. O "agora" é
// fixo e os dias são os locais de quem roda.
import { expect, test } from "bun:test";

import type { HistoryEntry } from "../store/history.ts";
import type { NoteMeta } from "../notes/vault.ts";
import { WEEK_LIMITS } from "../shared/home.ts";
import type { HomeNotes, HomeSources } from "./home.ts";
import { homeWeek, wordsOf } from "./home-week.ts";

/** Terça, 17 de novembro, às 15h locais. */
const NOW = new Date(2026, 10, 17, 15).getTime();
const at = (day: number, h = 10, m = 0) => new Date(2026, 10, day, h, m).toISOString();

function notes(files: Record<string, { content: string; mtime: string }>): HomeNotes {
  const meta = (p: string): NoteMeta => {
    const parts = p.replace(/\.md$/, "").split("/");
    return { path: p, title: parts.at(-1)!, folder: parts.slice(0, -1).join("/"), mtime: files[p]!.mtime, ctime: files[p]!.mtime, size: 1, version: "v", tags: [] };
  };
  return {
    list: () => ({ notes: Object.keys(files).map(meta) }),
    get: async (p: string) => {
      if (!files[p]) throw new Error("sumiu");
      return { ...meta(p), content: files[p]!.content };
    },
    notesContaining: (text: string) => Object.keys(files).filter((p) => files[p]!.content.includes(text)).map(meta),
  };
}

/** O histórico, do mais novo para o mais velho, em páginas de `pageSize`. */
function history(entries: Partial<HistoryEntry>[], pageSize = 200) {
  const all = entries.map((e, i) => ({ id: `${e.at}-${i}`, raw: "", text: "", ...e }) as HistoryEntry);
  let pages = 0;
  return {
    get pages() {
      return pages;
    },
    search: async ({ limit = 30, before }: { limit?: number; before?: string }) => {
      pages++;
      const start = before ? all.findIndex((e) => e.id === before) + 1 : 0;
      const n = Math.min(limit, pageSize);
      const page = all.slice(start, start + n);
      return { entries: page, nextBefore: start + n < all.length ? page.at(-1)!.id : undefined };
    },
  };
}

const meeting = (day: number, h: number, duration: number | null, session = `s${day}`) => `---
type: meeting
session: ${session}
date: "2026-11-${day}"
start: "${at(day, h)}"
${duration === null ? "" : `duration: ${duration}\n`}participants: [Ana]
---

## Transcrição

Ana: oi.
`;

function sources(o: Partial<HomeSources>): HomeSources {
  const empty = notes({});
  return { notes: empty, meetings: empty, history: history([]), liveSession: null, now: NOW, ...o };
}

test("os 7 dias até hoje, de hoje para trás", async () => {
  const w = await homeWeek(sources({}));
  expect(w.days.map((d) => d.date)).toEqual(["2026-11-17", "2026-11-16", "2026-11-15", "2026-11-14", "2026-11-13", "2026-11-12", "2026-11-11"]);
  expect(w.totals).toEqual({ notes: 0, meetings: 0, meetingMin: 0, dictations: 0, words: 0 });
});

test("as notas no dia da última edição, sem as de reunião e sem as de antes da semana", async () => {
  const v = notes({
    "Projeto X/Plano.md": { content: "texto", mtime: at(17, 11) },
    "Ideias.md": { content: "type: ideia no texto", mtime: at(17, 9) },
    "Mercado.md": { content: "ovos", mtime: at(13) },
    "Antiga.md": { content: "velha", mtime: at(10) },
    "Reuniões/Café.md": { content: meeting(16, 9, 600), mtime: at(16, 10) },
  });
  const w = await homeWeek(sources({ notes: v, meetings: v }));
  expect(w.days[0]!.notes.map((n) => [n.title, n.folder])).toEqual([["Plano", "Projeto X"], ["Ideias", null]]);
  expect(w.days[4]!.notes.map((n) => n.path)).toEqual(["Mercado.md"]);
  expect(w.days[1]!.notes).toEqual([]);
  expect(w.totals.notes).toBe(3);
});

test("um dia com notas demais mostra até o limite e conta o resto", async () => {
  const files = Object.fromEntries(Array.from({ length: WEEK_LIMITS.notesPerDay + 2 }, (_, i) => [`n${i}.md`, { content: "x", mtime: at(15, 8, i) }]));
  const w = await homeWeek(sources({ notes: notes(files) }));
  expect(w.days[2]!.notes).toHaveLength(WEEK_LIMITS.notesPerDay);
  expect(w.days[2]!.moreNotes).toBe(2);
  expect(w.totals.notes).toBe(WEEK_LIMITS.notesPerDay + 2);
});

test("as reuniões no dia em que começaram, com a duração; a que grava agora fica de fora", async () => {
  const m = notes({
    "Reuniões/Planejamento.md": { content: meeting(17, 9, 2520), mtime: at(17, 10) },
    "Reuniões/Escrita à mão.md": { content: meeting(14, 16, null), mtime: at(14, 17) },
    "Reuniões/Agora.md": { content: meeting(17, 14, null, "ao-vivo"), mtime: at(17, 14) },
    "Reuniões/Mês passado.md": { content: meeting(3, 9, 600).replace('"2026-11-3"', '"2026-11-03"'), mtime: at(3) },
  });
  const w = await homeWeek(sources({ meetings: m, liveSession: "ao-vivo" }));
  expect(w.days[0]!.meetings.map((x) => [x.title, x.durationMin])).toEqual([["Planejamento", 42]]);
  expect(w.days[3]!.meetings.map((x) => [x.title, x.durationMin])).toEqual([["Escrita à mão", null]]);
  expect(w.totals.meetings).toBe(2);
  expect(w.totals.meetingMin).toBe(42);
});

test("os ditados por dia, com as palavras; o que falhou e o vazio não contam, e a busca para antes da semana", async () => {
  const h = history(
    [
      { at: at(17, 14), text: "Bom dia, Ana." },
      { at: at(17, 13), text: "  " },
      { at: at(17, 12), text: "mandar o relatório", recoveryError: "falhou" },
      { at: at(16, 9), text: "comprar pão e café — 2 pacotes" },
      { at: at(11, 8), text: "um" },
      { at: at(10, 8), text: "antes da semana" },
      { at: at(9, 8), text: "bem antes" },
    ],
    2,
  );
  const w = await homeWeek(sources({ history: h }));
  expect([w.days[0]!.dictations, w.days[0]!.words]).toEqual([1, 3]);
  expect([w.days[1]!.dictations, w.days[1]!.words]).toEqual([1, 6]);
  expect([w.days[6]!.dictations, w.days[6]!.words]).toEqual([1, 1]);
  expect(w.totals.dictations).toBe(3);
  expect(w.totals.words).toBe(10);
  // Páginas de 2: a 3ª tem o dia 11 e o dia 10, e para ali.
  expect(h.pages).toBe(3);
});

test("palavras: só o que tem letra ou número", () => {
  expect(wordsOf("Olá — tudo bem? 3 vezes!")).toBe(5);
  expect(wordsOf("   ")).toBe(0);
});
