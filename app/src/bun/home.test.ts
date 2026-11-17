// Os dados da tela de Início (T15847): o `home.today` com notas, histórico e reuniões falsos, em memória. Dados
// inventados; o "agora" é fixo e o dia é o local de quem roda.
import { expect, test } from "bun:test";

import type { HistoryEntry } from "../store/history.ts";
import type { NoteMeta } from "../notes/vault.ts";
import { excerptOf, HomeChanges, type HomeNotes, homeToday, summaryOf } from "./home.ts";

/** Hoje às 15h, no fuso de quem roda: o "dia" do teste é sempre o local. */
const NOW = new Date(2026, 10, 17, 15, 0, 0).getTime();
const at = (h: number, m = 0, dayOffset = 0) => new Date(2026, 10, 17 + dayOffset, h, m).toISOString();

function notes(files: Record<string, { content: string; mtime: string }>): HomeNotes & { read: string[] } {
  const read: string[] = [];
  const meta = (p: string): NoteMeta => {
    const parts = p.replace(/\.md$/, "").split("/");
    return { path: p, title: parts.at(-1)!, folder: parts.slice(0, -1).join("/"), mtime: files[p]!.mtime, ctime: files[p]!.mtime, size: 1, version: "v", tags: [] };
  };
  return {
    read,
    list: () => ({ notes: Object.keys(files).map(meta) }),
    get: async (p: string) => {
      read.push(p);
      if (!files[p]) throw new Error("sumiu");
      return { ...meta(p), content: files[p]!.content };
    },
    notesContaining: (text: string) => Object.keys(files).filter((p) => files[p]!.content.includes(text)).map(meta),
  };
}

function history(entries: Partial<HistoryEntry>[], pageSize = 30) {
  const all = entries.map((e, i) => ({ id: `${e.at}-${i}`, raw: e.text ?? "", text: "", ...e }) as HistoryEntry);
  return {
    search: async ({ limit = 30, before }: { limit?: number; before?: string }) => {
      const start = before ? all.findIndex((e) => e.id === before) + 1 : 0;
      const n = Math.min(limit, pageSize);
      const page = all.slice(start, start + n);
      return { entries: page, nextBefore: start + n < all.length ? page.at(-1)!.id : undefined };
    },
  };
}

const MEETING = `---
type: meeting
session: s1
date: "2026-11-17"
start: "${at(14)}"
end: "${at(14, 42)}"
duration: 2520
participants: [Ana, Bruno, Carla]
---

## Minhas notas

## Transcrição

Ana: oi.
`;

const ATA = `---
data: 2026-11-17
reuniao: "[[Reuniões/Planejamento do Projeto X|Planejamento do Projeto X]]"
tags: [reuniao]
---
# Planejamento do Projeto X

## 1. Resumo

- A data do lançamento fica para 2 de dezembro.
- A Ana revisa o texto da página até quinta.
- O Bruno fecha o orçamento com o fornecedor.
- Um quarto item que não aparece.

## 2. Decisões

- Outra coisa.
`;

test("o continuar é a nota mais nova, as editadas são as outras de hoje, e as de reunião ficam de fora", async () => {
  const n = notes({
    "Projeto X/Lançamento.md": { content: "# Lançamento\n\nFalta **fechar** a data com a [[Ana]] e revisar o texto.", mtime: at(14, 50) },
    "Reuniões/Planejamento do Projeto X.md": { content: MEETING, mtime: at(14, 55) },
    "Casa/Lista da mudança.md": { content: "- [ ] Comprar fita", mtime: at(9, 15) },
    "Ideias.md": { content: "type: rascunho, mas não é frontmatter", mtime: at(10, 40) },
    "Pessoal/Leituras.md": { content: "livros", mtime: at(20, 0, -1) },
  });
  const got = await homeToday({ notes: n, meetings: n, history: history([]), liveSession: null, now: NOW });
  expect(got.continue).toEqual({
    path: "Projeto X/Lançamento.md",
    title: "Lançamento",
    folder: "Projeto X",
    editedAt: Date.parse(at(14, 50)),
    excerpt: "Falta fechar a data com a Ana e revisar o texto.",
  });
  expect(got.editedToday.map((x) => [x.title, x.folder])).toEqual([["Ideias", null], ["Lista da mudança", "Casa"]]);
  // Lê só a do continuar e as que podem ser de reunião (têm `type:`), não a lista inteira (a reunião relê as suas).
  expect([...new Set(n.read)].sort()).toEqual(["Ideias.md", "Projeto X/Lançamento.md", "Reuniões/Planejamento do Projeto X.md"]);
});

test("o continuar pode ser de outro dia; as editadas hoje, não; e no máximo 5", async () => {
  const old = notes({ "Velha.md": { content: "de ontem", mtime: at(18, 0, -1) } });
  const got = await homeToday({ notes: old, meetings: old, history: history([]), liveSession: null, now: NOW });
  expect(got.continue?.title).toBe("Velha");
  expect(got.editedToday).toEqual([]);

  const many: Record<string, { content: string; mtime: string }> = {};
  for (let i = 0; i < 9; i++) many[`N${i}.md`] = { content: `nota ${i}`, mtime: at(8 + i) };
  const lots = notes(many);
  const got2 = await homeToday({ notes: lots, meetings: lots, history: history([]), liveSession: null, now: NOW });
  expect(got2.continue?.title).toBe("N8");
  expect(got2.editedToday.map((x) => x.title)).toEqual(["N7", "N6", "N5", "N4", "N3"]);
});

test("pasta vazia: tudo vazio ou null", async () => {
  const n = notes({});
  expect(await homeToday({ notes: n, meetings: n, history: history([]), liveSession: null, now: NOW })).toEqual({
    continue: null,
    editedToday: [],
    dictationsToday: [],
    lastMeeting: null,
  });
});

test("os ditados de hoje: até 3, sem os que falharam nem os vazios, e para no primeiro de ontem", async () => {
  const h = history(
    [
      { at: at(14, 30), text: " Lembrar de mandar o convite ", app: { name: "Mensagens", bundleId: "x" } },
      { at: at(14, 0), text: "", recoveryError: "stt" },
      { at: at(13, 0), text: "   " },
      { at: at(11, 5), text: "O texto da página" },
      { at: at(9, 10), text: "Comprar fita", app: { bundleId: "só.o.id" } },
      { at: at(8, 0), text: "quarto de hoje" },
      { at: at(22, 0, -1), text: "ontem" },
    ],
    2, // páginas pequenas: tem que seguir o `nextBefore`
  );
  const n = notes({});
  const got = await homeToday({ notes: n, meetings: n, history: h, liveSession: null, now: NOW });
  expect(got.dictationsToday.map(({ text, app, at: t }) => [text, app, t])).toEqual([
    ["Lembrar de mandar o convite", "Mensagens", Date.parse(at(14, 30))],
    ["O texto da página", null, Date.parse(at(11, 5))],
    ["Comprar fita", null, Date.parse(at(9, 10))],
  ]);
  const yesterday = await homeToday({ notes: n, meetings: n, history: history([{ at: at(22, 0, -1), text: "ontem" }]), liveSession: null, now: NOW });
  expect(yesterday.dictationsToday).toEqual([]);
});

test("a última reunião: com a ata, o resumo e o caminho dela; a que grava agora fica de fora", async () => {
  const meetings = notes({
    "Reuniões/Planejamento do Projeto X.md": { content: MEETING, mtime: at(14, 43) },
    "Reuniões/Agora.md": { content: MEETING.replace("session: s1", "session: s2").replace(/end: .*\n/, "").replace(/duration: .*\n/, "").replace(at(14), at(14, 58)), mtime: at(14, 59) },
  });
  // A ata está na pasta aberta (outra), não na das reuniões.
  const open = notes({ "Projeto X/Ata do planejamento.md": { content: ATA, mtime: at(14, 50) } });
  const got = await homeToday({ notes: open, meetings, history: history([]), liveSession: "s2", now: NOW });
  expect(got.lastMeeting).toEqual({
    path: "Reuniões/Planejamento do Projeto X.md",
    title: "Planejamento do Projeto X",
    startedAt: Date.parse(at(14)),
    durationMin: 42,
    people: ["Ana", "Bruno", "Carla"],
    summary: ["A data do lançamento fica para 2 de dezembro.", "A Ana revisa o texto da página até quinta.", "O Bruno fecha o orçamento com o fornecedor."],
    minutesPath: "Projeto X/Ata do planejamento.md",
    minutesInternal: false,
  });
  // A mesma ata na pasta das reuniões: o clique abre na interna.
  const inMeetings = notes({
    "Reuniões/Planejamento do Projeto X.md": { content: MEETING, mtime: at(14, 43) },
    "Reuniões/Ata.md": { content: ATA, mtime: at(14, 50) },
  });
  const got2 = await homeToday({ notes: notes({}), meetings: inMeetings, history: history([]), liveSession: null, now: NOW });
  expect(got2.lastMeeting).toMatchObject({ minutesPath: "Reuniões/Ata.md", minutesInternal: true });
});

test("reunião escrita à mão, sem ata: sem duração, sem resumo, começa no dia dela", async () => {
  const m = notes({ "Reuniões/Café.md": { content: "---\ntype: meeting\ndate: 2026-11-16\n---\n\nanotações", mtime: at(9, 0, -1) } });
  const got = await homeToday({ notes: m, meetings: m, history: history([]), liveSession: null, now: NOW });
  expect(got.lastMeeting).toMatchObject({ title: "Café", durationMin: null, people: [], summary: [], minutesPath: null, minutesInternal: false, startedAt: Date.parse("2026-11-16T00:00:00") });
});

test("o resumo da ata: tópicos, prosa em frases, ou as Decisões sem resumo", () => {
  expect(summaryOf(ATA)).toHaveLength(3);
  expect(summaryOf("# X\n\n## Resumo\n\nA data mudou. O Bruno fecha o orçamento! E a Ana revisa?\nUma quarta.\n\n## Ações\n- a")).toEqual([
    "A data mudou.",
    "O Bruno fecha o orçamento!",
    "E a Ana revisa?",
  ]);
  expect(summaryOf("## Decisões\n\n- Fica para dezembro.\n- [x] Ana revisa.\n")).toEqual(["Fica para dezembro.", "Ana revisa."]);
  // Número no meio da frase não corta nem perde texto (lucid-raven, T15847 round 1).
  expect(summaryOf("## Resumo\n\nO custo foi R$ 1.500 e a versão 2.0 sai.")).toEqual(["O custo foi R$ 1.500 e a versão 2.0 sai."]);
  expect(summaryOf("## Resumo\n\nA Ana fechou o prazo. O time revisa sexta. Vai em 2026.11.2! Extra.")).toEqual([
    "A Ana fechou o prazo.",
    "O time revisa sexta.",
    "Vai em 2026.11.2!",
  ]);
  expect(summaryOf("## Resumo\n\nCombinado em 17.11 com a Ana… Depois a gente vê")).toEqual(["Combinado em 17.11 com a Ana…", "Depois a gente vê"]);
  expect(summaryOf("só texto")).toEqual([]);
});

test("o trecho: sem frontmatter, títulos, marcação nem o título repetido, e corta numa palavra", () => {
  expect(excerptOf("# Planejamento\n\n## Resumo\n\n- A data fica para dezembro.\n\n## Decisões\n- Ana revisa.")).toBe("A data fica para dezembro. Ana revisa.");
  expect(excerptOf("Lista da mudança\ncomprar fita", "Lista da mudança")).toBe("comprar fita");
  expect(excerptOf("---\ntags: [a]\n---\n# Lançamento\n\n> Uma **citação** com [link](http://exemplo.local) e ![[img.png]]\n\n- [ ] Fechar a data", "Lançamento")).toBe(
    "Uma citação com link e Fechar a data",
  );
  const long = excerptOf("palavra ".repeat(60));
  expect(long.length).toBeLessThanOrEqual(141);
  expect(long.endsWith("palavra…")).toBe(true);
  expect(excerptOf("")).toBe("");
});

test("o home.changed sai uma vez depois da rajada, e o stop cancela", async () => {
  let sent = 0;
  const h = new HomeChanges(() => sent++, 20);
  h.poke();
  h.poke();
  await Bun.sleep(10);
  h.poke();
  expect(sent).toBe(0);
  await Bun.sleep(40);
  expect(sent).toBe(1);
  h.poke();
  h.stop();
  await Bun.sleep(40);
  expect(sent).toBe(1);
});

test("T16434: o trecho sem os comentários %%…%% nem o carimbo do ditado", () => {
  const nota = "Ideia nova. Revisar o orçamento.\n\n*🎙 ditado às 03:27* %%dictation:2026-11-17T06:27:00.931Z-ab12%%\n";
  expect(excerptOf(nota)).toBe("Ideia nova. Revisar o orçamento.");
  expect(excerptOf("Antes %%um\ncomentário\nlongo%% depois")).toBe("Antes depois");
  // O texto que só fala de um ditado fica.
  expect(excerptOf("O ditado às vezes falha.")).toBe("O ditado às vezes falha.");
});
