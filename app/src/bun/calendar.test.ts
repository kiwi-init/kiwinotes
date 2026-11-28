// O Calendário (T32154, spec #32129): os itens lidos das notas e das reuniões, criar, mudar a linha e os avisos. Um
// vault de verdade num tmp, com notas inventadas (Ana, Projeto X), para o `save` pela versão e o `create` serem os do
// app.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Vault } from "../notes/vault.ts";
import { addDays, type CalendarItem, dayOf, notifyAt, parseWhen, rewriteWhen, toMs } from "../shared/calendar.ts";
import { tempDir } from "../../test/tmp.ts";
import { alertsBetween, calendarService, occurrences, setFrontmatter } from "./calendar.ts";
import { startMs, suggestion } from "../shared/calendar-kiwi.ts";
import { answerYes } from "../../ui/calendar/kiwi-panel.ts";

const dirs: string[] = [];
const vaults: Vault[] = [];
afterEach(() => {
  for (const v of vaults.splice(0)) v.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** O "hoje" fixo dos testes: antes de todas as datas daqui, para nenhum resultado depender do relógio. */
const EARLY = { day: "2026-11-01" };

async function open(files: Record<string, string>, opts: { meetings?: Record<string, string>; locale?: "pt" | "en"; live?: string | null; today?: { day: string } | "relógio" } = {}) {
  const mk = async (fs: Record<string, string>) => {
    const d = tempDir("kiwinotes-calendar-test-");
    dirs.push(d);
    const root = path.join(d, "Notas");
    mkdirSync(root, { recursive: true });
    for (const [rel, content] of Object.entries(fs)) {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      writeFileSync(path.join(root, rel), content);
    }
    const v = new Vault({ root, debounceMs: 20, trash: async (abs) => rmSync(abs, { recursive: true }) });
    vaults.push(v);
    await v.open();
    return { v, root };
  };
  const notes = await mk(files);
  const meetings = opts.meetings ? await mk(opts.meetings) : notes;
  // "relógio": sem o hoje injetado, o serviço usa o padrão dele (a data local de agora).
  const today = opts.today === "relógio" ? undefined : (opts.today ?? EARLY);
  const cal = calendarService(async () => ({ notes: notes.v, meetings: meetings.v, liveSession: opts.live ?? null, locale: opts.locale ?? "pt" }), today && (() => today.day));
  const read = (rel: string) => readFileSync(path.join(notes.root, rel), "utf8");
  const write = async (rel: string, content: string) => {
    const cur = await notes.v.get(rel);
    const r = await notes.v.save(rel, content, cur.version);
    if (!r.saved) throw new Error("não gravou");
  };
  return { cal, read, write, vault: notes.v };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
};

const PROJETO = `# Projeto X

- [ ] Revisar o orçamento @ 2026-11-27 10:00
- [ ] Ligar para a Ana @ 2026-11-27 14:00-14:30 #lembrete 🔔 30m
- [x] Mandar o convite @ 2026-11-26
- Café com a equipe @ 2026-11-28 09:00 #reuniao
- Uma frase qualquer @ 2026-11-28 que não é item
- [ ] Escrever o roteiro
- [ ] Bloco de escrita @ 2026-11-24 08:00-09:00 #foco 🔁 semana
`;

describe("parseWhen e rewriteWhen", () => {
  test("lê a data, o fim, o tipo, o aviso e a repetição, e o título fica sem eles", () => {
    expect(parseWhen("Ligar para a Ana @ 2026-11-27 14:00-14:30 #lembrete 🔔 30m 🔁 semana")).toEqual({
      title: "Ligar para a Ana",
      kind: "reminder",
      start: "2026-11-27T14:00",
      end: "2026-11-27T14:30",
      allDay: false,
      notify: "30m",
      repeat: "weekly",
      skip: [],
    });
    expect(parseWhen("Entrega @ 2026-11-27")).toMatchObject({ allDay: true, start: "2026-11-27", end: null, kind: null, notify: null });
    expect(parseWhen("Plantão @ 2026-11-27 22:00-02:00")?.end).toBe("2026-11-28T02:00");
    expect(parseWhen("Silêncio @ 2026-11-27 🔕")?.notify).toBe("none");
    // Outra tag fica no título; data que não existe não é data.
    expect(parseWhen("Ler o #livro @ 2026-11-27")?.title).toBe("Ler o #livro");
    expect(parseWhen("Nada @ 2026-02-30")).toBeNull();
    expect(parseWhen("Nada @ 2026-11-27 25:00")).toBeNull();
    expect(parseWhen("e-mail ana@2026-11-27.exemplo")).toBeNull();
  });

  test("rewriteWhen troca só o pedaço que mudou e deixa o resto da linha", () => {
    const rest = "Revisar o [[Orçamento]] com **Ana** @ 2026-11-27 10:00 #lembrete #importante";
    expect(rewriteWhen(rest, { start: "2026-11-28T15:30", end: "2026-11-28T16:00" }, "pt")).toBe(
      "Revisar o [[Orçamento]] com **Ana** @ 2026-11-28 15:30-16:00 #lembrete #importante",
    );
    expect(rewriteWhen(rest, { notify: "10m" }, "pt")).toBe(`${rest} 🔔 10m`);
    expect(rewriteWhen(`${rest} 🔔 10m`, { notify: "none" }, "pt")).toBe(`${rest} 🔕`);
    expect(rewriteWhen(rest, { kind: "meeting" }, "en")).toBe("Revisar o [[Orçamento]] com **Ana** @ 2026-11-27 10:00 #meeting #importante");
    expect(rewriteWhen(rest, { kind: "task" }, "pt")).toBe("Revisar o [[Orçamento]] com **Ana** @ 2026-11-27 10:00 #importante");
    expect(rewriteWhen("Sem data", { start: "2026-11-30" }, "pt")).toBe("Sem data @ 2026-11-30");
    expect(rewriteWhen(rest, { allDay: true }, "pt")).toBe("Revisar o [[Orçamento]] com **Ana** @ 2026-11-27 #lembrete #importante");
  });

  test("setFrontmatter troca, põe e tira uma chave sem mexer no resto", () => {
    const n = "---\ntitulo: x\nagenda: 2026-11-27\n---\n\ncorpo\n";
    expect(setFrontmatter(n, "agenda", "2026-11-28 10:00")).toBe('---\ntitulo: x\nagenda: "2026-11-28 10:00"\n---\n\ncorpo\n');
    expect(setFrontmatter(n, "aviso", "10m")).toBe('---\ntitulo: x\nagenda: 2026-11-27\naviso: "10m"\n---\n\ncorpo\n');
    expect(setFrontmatter(n, "agenda", null)).toBe("---\ntitulo: x\n---\n\ncorpo\n");
  });
});

describe("calendar.items", () => {
  test("as linhas com data, o tipo pela tag, o aviso padrão, os projetos e as pendências sem data", async () => {
    const { cal } = await open({ "Projeto X/Planejamento.md": PROJETO, "Ideias.md": "- [ ] Pensar no nome @ 2026-11-29\n", "Projeto Y/.gitkeep.md": "" });
    const r = await cal.items({ from: "2026-11-26", to: "2026-11-30" });
    const by = Object.fromEntries(r.items.map((i) => [i.title, i]));
    expect(Object.keys(by).sort()).toEqual(["Café com a equipe", "Ligar para a Ana", "Mandar o convite", "Pensar no nome", "Revisar o orçamento"].sort());
    expect(by["Revisar o orçamento"]).toMatchObject({ kind: "task", project: "Projeto X", start: "2026-11-27T10:00", end: null, allDay: false, done: false, notify: "none", readOnly: false });
    expect(by["Revisar o orçamento"]!.source).toEqual({ path: "Projeto X/Planejamento.md", line: 2, internal: false });
    expect(by["Ligar para a Ana"]).toMatchObject({ kind: "reminder", notify: "30m", end: "2026-11-27T14:30" });
    expect(by["Mandar o convite"]).toMatchObject({ done: true, allDay: true, start: "2026-11-26" });
    expect(by["Café com a equipe"]).toMatchObject({ kind: "meeting", notify: "10m" });
    expect(by["Café com a equipe"]!.done).toBeUndefined();
    expect(by["Pensar no nome"]!.project).toBeNull();
    // A repetição semanal de 24/11 não tem vez entre 26 e 30.
    expect(r.items.map((i) => i.start)).toEqual([...r.items.map((i) => i.start)].sort((a, b) => toMs(a) - toMs(b)));
    expect(r.undated.map((i) => i.title)).toEqual(["Escrever o roteiro"]);
    expect(r.projects).toEqual(["Projeto X", "Projeto Y"]);
  });

  test("a repetição: cada vez no período, com o dia no id, e nada antes do começo", async () => {
    const { cal } = await open({ "Projeto X/Planejamento.md": PROJETO });
    const r = await cal.items({ from: "2026-11-16", to: "2026-12-15" });
    const reps = r.items.filter((i) => i.title === "Bloco de escrita");
    expect(reps.map((i) => i.start)).toEqual(["2026-11-24T08:00", "2026-12-01T08:00", "2026-12-08T08:00"]);
    expect(reps.map((i) => i.end)).toEqual(["2026-11-24T09:00", "2026-12-01T09:00", "2026-12-08T09:00"]);
    expect(reps[1]!.id).toMatch(/~2026-12-01$/);
    const daily = occurrences({ ...reps[0]!, id: "n:a#0:00000000", repeat: "daily" }, "2027-03-01", "2027-03-04");
    expect(daily.map((i) => i.start)).toEqual(["2027-03-01T08:00", "2027-03-02T08:00", "2027-03-03T08:00"]);
  });

  test("a nota com agenda: e as reuniões gravadas, só leitura, da pasta interna", async () => {
    const start = new Date(2026, 10, 27, 15, 0).toISOString();
    const end = new Date(2026, 10, 27, 15, 45).toISOString();
    const { cal } = await open(
      { "Projeto X/Pauta do lançamento.md": '---\nagenda: "2026-11-27 09:00-09:30"\naviso: "10m"\n---\n\n# Pauta do lançamento\n\nTrazer os números do mês.\n' },
      { meetings: { "Reuniões/Conversa com a Ana.md": `---\ntype: meeting\nstart: ${start}\nend: ${end}\nparticipants: [Ana, Bruno]\n---\n\n- [ ] Mandar o resumo @ 2026-11-28\n` } },
    );
    const r = await cal.items({ from: "2026-11-27", to: "2026-11-29" });
    const nota = r.items.find((i) => i.kind === "note")!;
    expect(nota).toMatchObject({ id: "f:Projeto X/Pauta do lançamento.md", title: "Pauta do lançamento", start: "2026-11-27T09:00", end: "2026-11-27T09:30", notify: "10m", project: "Projeto X" });
    expect(nota.detail).toContain("Trazer os números");
    const reuniao = r.items.find((i) => i.id.startsWith("m:"))!;
    expect(reuniao).toMatchObject({ kind: "meeting", readOnly: true, start: "2026-11-27T15:00", end: "2026-11-27T15:45", people: ["Ana", "Bruno"], project: null, notify: "none" });
    expect(reuniao.source).toEqual({ path: "Reuniões/Conversa com a Ana.md", line: null, internal: true });
    // As linhas de dentro de uma nota de reunião não viram itens.
    expect(r.items.some((i) => i.title === "Mandar o resumo")).toBe(false);
    const src = await cal.source(reuniao.id);
    expect(src).toMatchObject({ path: "Reuniões/Conversa com a Ana.md", internal: true, line: null });
    expect(src.text).toContain("participants");
  });

  test("os limites do período", async () => {
    const { cal } = await open({});
    expect(await code(cal.items({ from: "2026-11-27", to: "2026-11-27" }))).toBe("E_BAD_ARGS");
    expect(await code(cal.items({ from: "2026-11-27", to: "2027-02-27" }))).toBe("E_BAD_ARGS");
    expect(await code(cal.items({ from: "ontem", to: "2026-11-27" }))).toBe("E_BAD_ARGS");
    expect(await cal.items({ from: "2026-11-01", to: "2026-12-01" })).toEqual({ items: [], undated: [], projects: [] });
  });
});

describe("calendar.update", () => {
  test("arrastar muda só a data da linha; o resto da nota fica igual", async () => {
    const { cal, read } = await open({ "Projeto X/Planejamento.md": PROJETO });
    const it = (await cal.items({ from: "2026-11-27", to: "2026-11-28" })).items.find((i) => i.title === "Ligar para a Ana")!;
    const moved = await cal.update({ id: it.id, start: "2026-11-28T16:00", end: "2026-11-28T16:30" });
    expect(moved).toMatchObject({ start: "2026-11-28T16:00", end: "2026-11-28T16:30", kind: "reminder", notify: "30m" });
    expect(read("Projeto X/Planejamento.md")).toBe(PROJETO.replace("@ 2026-11-27 14:00-14:30", "@ 2026-11-28 16:00-16:30"));
  });

  test("Feito marca a caixa; o aviso grava o 🔔 ou o 🔕; uma linha sem caixa ganha uma", async () => {
    const { cal, read } = await open({ "Projeto X/Planejamento.md": PROJETO });
    const items = (await cal.items({ from: "2026-11-27", to: "2026-11-29" })).items;
    const rev = items.find((i) => i.title === "Revisar o orçamento")!;
    expect(await cal.update({ id: rev.id, done: true })).toMatchObject({ done: true });
    expect(read("Projeto X/Planejamento.md")).toContain("- [x] Revisar o orçamento @ 2026-11-27 10:00\n");
    const cafe = items.find((i) => i.title === "Café com a equipe")!;
    expect(await cal.update({ id: cafe.id, notify: "none" })).toMatchObject({ notify: "none" });
    expect(read("Projeto X/Planejamento.md")).toContain("- Café com a equipe @ 2026-11-28 09:00 #reuniao 🔕\n");
    const cafe2 = (await cal.items({ from: "2026-11-28", to: "2026-11-29" })).items.find((i) => i.title === "Café com a equipe")!;
    expect(await cal.update({ id: cafe2.id, done: true })).toMatchObject({ done: true });
    expect(read("Projeto X/Planejamento.md")).toContain("- [x] Café com a equipe @ 2026-11-28 09:00 #reuniao 🔕\n");
  });

  test("o id: a mesma linha, a linha que desceu e a que mudou ou sumiu (#32169)", async () => {
    const { cal, read, write } = await open({ "Projeto X/Planejamento.md": PROJETO });
    const it = (await cal.items({ from: "2026-11-27", to: "2026-11-28" })).items.find((i) => i.title === "Revisar o orçamento")!;
    // Entrou uma linha acima: o hash acha a linha nova.
    await write("Projeto X/Planejamento.md", PROJETO.replace("# Projeto X\n", "# Projeto X\n\nUma linha nova em cima.\n"));
    const moved = await cal.update({ id: it.id, start: "2026-11-27T11:00" });
    expect(moved.source?.line).toBe(4);
    expect(read("Projeto X/Planejamento.md")).toContain("- [ ] Revisar o orçamento @ 2026-11-27 11:00\n");
    // A linha mudou (outro texto): o id velho dá conflito, e a nota não muda.
    const before = read("Projeto X/Planejamento.md");
    expect(await code(cal.update({ id: moved.id.replace(/:[0-9a-f]{8}$/, ":00000000"), done: true }))).toBe("E_CONFLICT");
    await write("Projeto X/Planejamento.md", before.replace("Revisar o orçamento", "Revisar o orçamento de novo"));
    expect(await code(cal.update({ id: moved.id, done: true }))).toBe("E_CONFLICT");
    expect(read("Projeto X/Planejamento.md")).not.toContain("[x] Revisar");
  });

  test("a rebusca só olha os itens: a cópia num bloco de código ou num %% %% não muda (#32219)", async () => {
    const linha = "- [ ] Revisar o orçamento @ 2026-11-27 10:00";
    for (const copia of [`\`\`\`md\n${linha}\n\`\`\``, `%%\n${linha}\n%%`, `~~~~\n${linha}\n~~~~`]) {
      const nota = `# Projeto X\n\n${linha}\n\nExemplo:\n\n${copia}\n`;
      const { cal, read, write } = await open({ "Projeto X/Planejamento.md": nota });
      const its = (await cal.items({ from: "2026-11-27", to: "2026-11-28" })).items;
      expect(its.length).toBe(1);
      const sem = nota.replace(`${linha}\n\nExemplo`, "Exemplo");
      await write("Projeto X/Planejamento.md", sem);
      expect(await code(cal.update({ id: its[0]!.id, done: true }))).toBe("E_CONFLICT");
      expect(read("Projeto X/Planejamento.md")).toBe(sem);
    }
  });

  test("o id que aponta para uma linha que deixou de ser item dá conflito sem gravar", async () => {
    const nota = "# Projeto X\n\n- [ ] Revisar o orçamento @ 2026-11-27 10:00\n";
    const { cal, read, write } = await open({ "Projeto X/Planejamento.md": nota });
    const id = (await cal.items({ from: "2026-11-27", to: "2026-11-28" })).items[0]!.id;
    // A mesma linha, agora dentro de um bloco de código: o índice e o hash batem, mas ela não é item.
    const presa = "# Projeto X\n```\n- [ ] Revisar o orçamento @ 2026-11-27 10:00\n```\n";
    await write("Projeto X/Planejamento.md", presa);
    expect(await code(cal.update({ id, done: true }))).toBe("E_CONFLICT");
    expect(read("Projeto X/Planejamento.md")).toBe(presa);
  });

  test("numa repetição: mover uma vez move a série; Feito na 1ª vez em aberto passa para a próxima", async () => {
    const { cal, read } = await open({ "Projeto X/Planejamento.md": PROJETO });
    const rep = (await cal.items({ from: "2026-12-01", to: "2026-12-02" })).items.find((i) => i.title === "Bloco de escrita")!;
    expect(rep.id).toMatch(/~2026-12-01$/);
    await cal.update({ id: rep.id, start: "2026-12-01T09:00", end: "2026-12-01T10:00" });
    expect(read("Projeto X/Planejamento.md")).toContain("- [ ] Bloco de escrita @ 2026-11-24 09:00-10:00 #foco 🔁 semana\n");
    const again = (await cal.items({ from: "2026-12-01", to: "2026-12-02" })).items.find((i) => i.title === "Bloco de escrita")!;
    await cal.update({ id: again.id, done: true });
    // A 1ª vez (24/11) segue aberta: a de 01/12 sai sozinha (#450).
    expect(read("Projeto X/Planejamento.md")).toContain("- [ ] Bloco de escrita @ 2026-11-24 09:00-10:00 #foco 🔁 semana ⏭ 2026-12-01\n");
    const first = (await cal.items({ from: "2026-11-24", to: "2026-11-25" })).items.find((i) => i.title === "Bloco de escrita")!;
    await cal.update({ id: first.id, done: true });
    expect(read("Projeto X/Planejamento.md")).toContain("- [ ] Bloco de escrita @ 2026-12-08 09:00-10:00 #foco 🔁 semana\n");
  });

  test("a nota com agenda: muda o frontmatter; a reunião gravada não muda", async () => {
    const start = new Date(2026, 10, 27, 15).toISOString();
    const { cal, read } = await open({
      "Pauta.md": "---\nagenda: 2026-11-27\n---\n\n# Pauta\n",
      "Reunião.md": `---\ntype: meeting\nstart: ${start}\nend: ${start}\n---\n`,
    });
    const r = await cal.items({ from: "2026-11-27", to: "2026-11-28" });
    const nota = r.items.find((i) => i.id === "f:Pauta.md")!;
    expect(await cal.update({ id: nota.id, start: "2026-11-27T10:00", end: "2026-11-27T11:00", allDay: false, notify: "30m" })).toMatchObject({
      start: "2026-11-27T10:00",
      end: "2026-11-27T11:00",
      notify: "30m",
    });
    expect(read("Pauta.md")).toBe('---\nagenda: "2026-11-27 10:00-11:00"\naviso: "30m"\n---\n\n# Pauta\n');
    expect(await code(cal.update({ id: nota.id, done: true }))).toBe("E_BAD_ARGS");
    const m = r.items.find((i) => i.id.startsWith("m:"))!;
    expect(await code(cal.update({ id: m.id, start: "2026-11-28T10:00" }))).toBe("E_READONLY");
  });

  test("os argumentos errados", async () => {
    const { cal } = await open({ "Projeto X/Planejamento.md": PROJETO });
    const id = (await cal.items({ from: "2026-11-27", to: "2026-11-28" })).items[0]!.id;
    expect(await code(cal.update({ id }))).toBe("E_BAD_ARGS");
    expect(await code(cal.update({ id, start: "amanhã" }))).toBe("E_BAD_ARGS");
    expect(await code(cal.update({ id, start: "2026-11-27T10:00", end: "2026-11-27T09:00" }))).toBe("E_BAD_ARGS");
    expect(await code(cal.update({ id, notify: "1h" as never }))).toBe("E_BAD_ARGS");
    expect(await code(cal.update({ id, title: "Duas\nlinhas" }))).toBe("E_BAD_ARGS");
    expect(await code(cal.update({ id, title: "Com data @ 2026-11-30" }))).toBe("E_BAD_ARGS");
    expect(await code(cal.update({ id: "n:Nada.md#0:00000000", done: true }))).toBe("E_NOT_FOUND");
    expect(await code(cal.update({ id: "x:qualquer", done: true }))).toBe("E_BAD_ARGS");
  });
});

describe("calendar.update: a duração (#449)", () => {
  const NOTA = "# Projeto X\n\n- Ensaio da banda @ 2026-12-02 10:00-11:00 #reuniao\n";
  const first = async (cal: Awaited<ReturnType<typeof open>>["cal"]) => (await cal.items({ from: "2026-12-01", to: "2026-12-03" })).items[0]!;

  test("mudar só o start (o calendar_update do agente) mantém a duração de 1 h", async () => {
    const { cal, read } = await open({ "Projeto X/Pendências.md": NOTA });
    const moved = await cal.update({ id: (await first(cal)).id, start: "2026-12-02T15:00" });
    expect(moved.end).toBe("2026-12-02T16:00");
    expect(read("Projeto X/Pendências.md")).toContain("@ 2026-12-02 15:00-16:00");
  });

  test("só o start, para tarde da noite: o fim passa da meia-noite com a mesma duração", async () => {
    const { cal, read } = await open({ "Projeto X/Pendências.md": NOTA });
    const moved = await cal.update({ id: (await first(cal)).id, start: "2026-12-02T23:30" });
    expect(moved.end).toBe("2026-12-03T00:30");
    expect(read("Projeto X/Pendências.md")).toContain("@ 2026-12-02 23:30-00:30");
  });

  test("um end a mais de 24 h do começo da linha é recusado, e não vira outro horário calado", async () => {
    const { cal, read } = await open({ "Projeto X/Pendências.md": NOTA });
    expect(await code(cal.update({ id: (await first(cal)).id, end: "2026-12-03T12:00" }))).toBe("E_BAD_ARGS");
    expect(read("Projeto X/Pendências.md")).toBe(NOTA);
  });

  test("um end antes do começo da linha é recusado; um end depois dele, até 24 h, grava", async () => {
    const { cal, read } = await open({ "Projeto X/Pendências.md": NOTA });
    const id = (await first(cal)).id;
    expect(await code(cal.update({ id, end: "2026-12-02T09:00" }))).toBe("E_BAD_ARGS");
    expect(await code(cal.update({ id, end: "2026-12-02T10:00" }))).toBe("E_BAD_ARGS");
    expect(read("Projeto X/Pendências.md")).toBe(NOTA);
    const longer = await cal.update({ id, end: "2026-12-02T12:30" });
    expect(longer).toMatchObject({ start: "2026-12-02T10:00", end: "2026-12-02T12:30" });
    expect(read("Projeto X/Pendências.md")).toContain("@ 2026-12-02 10:00-12:30");
  });

  test("numa repetição, mudar só o start de uma vez move a série e mantém a duração", async () => {
    const { cal, read } = await open({ "Projeto X/Planejamento.md": PROJETO });
    const rep = (await cal.items({ from: "2026-12-01", to: "2026-12-02" })).items.find((i) => i.title === "Bloco de escrita")!;
    const moved = await cal.update({ id: rep.id, start: "2026-12-01T14:00" });
    expect(moved).toMatchObject({ start: "2026-11-24T14:00", end: "2026-11-24T15:00" });
    expect(read("Projeto X/Planejamento.md")).toContain("- [ ] Bloco de escrita @ 2026-11-24 14:00-15:00 #foco 🔁 semana\n");
  });
});

describe("calendar.update numa nota com agenda: a duração (#484)", () => {
  const ENSAIO = `---\nagenda: "2026-12-02 10:00-11:00"\n---\n\n# Ensaio da banda\n`;
  const ID = "f:Ensaio da banda.md";

  test("mudar só o start mantém a duração de 1 h", async () => {
    const { cal, read } = await open({ "Ensaio da banda.md": ENSAIO });
    const moved = await cal.update({ id: ID, start: "2026-12-02T15:00" });
    expect(moved).toMatchObject({ start: "2026-12-02T15:00", end: "2026-12-02T16:00" });
    expect(read("Ensaio da banda.md")).toContain('agenda: "2026-12-02 15:00-16:00"');
  });

  test("só o start, para tarde da noite: o fim passa da meia-noite com a mesma duração", async () => {
    const { cal, read } = await open({ "Ensaio da banda.md": ENSAIO });
    const moved = await cal.update({ id: ID, start: "2026-12-02T23:30" });
    expect(moved.end).toBe("2026-12-03T00:30");
    expect(read("Ensaio da banda.md")).toContain('agenda: "2026-12-02 23:30-00:30"');
  });

  test("um end antes do start da nota, igual a ele ou a mais de 24 h é recusado, e nada muda", async () => {
    const { cal, read } = await open({ "Ensaio da banda.md": ENSAIO });
    for (const end of ["2026-12-02T09:00", "2026-12-02T10:00", "2026-12-03T12:00"]) expect(await code(cal.update({ id: ID, end }))).toBe("E_BAD_ARGS");
    expect(read("Ensaio da banda.md")).toBe(ENSAIO);
  });

  test("start e end juntos gravam os dois (o fim pedido, e não o da nota); a mais de 24 h, recusa", async () => {
    const { cal, read } = await open({ "Ensaio da banda.md": ENSAIO });
    expect(await code(cal.update({ id: ID, start: "2026-12-03T15:00", end: "2026-12-04T16:00" }))).toBe("E_BAD_ARGS");
    expect(read("Ensaio da banda.md")).toBe(ENSAIO);
    expect(await cal.update({ id: ID, start: "2026-12-02T15:00", end: "2026-12-02T17:00" })).toMatchObject({ start: "2026-12-02T15:00", end: "2026-12-02T17:00" });
    expect(read("Ensaio da banda.md")).toContain('agenda: "2026-12-02 15:00-17:00"');
  });

  test("um end depois do start, até 24 h, grava; o aviso sozinho não mexe no horário", async () => {
    const { cal, read } = await open({ "Ensaio da banda.md": ENSAIO });
    expect(await cal.update({ id: ID, end: "2026-12-02T12:30" })).toMatchObject({ start: "2026-12-02T10:00", end: "2026-12-02T12:30" });
    expect(read("Ensaio da banda.md")).toContain('agenda: "2026-12-02 10:00-12:30"');
    await cal.update({ id: ID, notify: "none" });
    expect(read("Ensaio da banda.md")).toContain('agenda: "2026-12-02 10:00-12:30"');
  });

  test("o dia inteiro e a volta para um horário seguem como antes", async () => {
    const { cal, read } = await open({ "Ensaio da banda.md": ENSAIO });
    expect(await cal.update({ id: ID, allDay: true })).toMatchObject({ start: "2026-12-02", end: null, allDay: true });
    expect(await cal.update({ id: ID, allDay: false, start: "2026-12-03T09:00" })).toMatchObject({ start: "2026-12-03T09:00", end: null });
    expect(read("Ensaio da banda.md")).toContain('agenda: "2026-12-03 09:00"');
  });
});

describe("calendar.create", () => {
  test("com projeto vai para Pendências.md; sem, para Calendário.md; a linha na língua do app", async () => {
    const { cal, read } = await open({ "Projeto X/Planejamento.md": PROJETO });
    const a = await cal.create({ kind: "reminder", title: "Pagar a conta", project: "Projeto X", start: "2026-11-30T09:00" });
    expect(a).toMatchObject({ kind: "reminder", title: "Pagar a conta", project: "Projeto X", start: "2026-11-30T09:00", notify: "atTime", done: false });
    expect(read("Projeto X/Pendências.md")).toBe("# Pendências\n\n- [ ] Pagar a conta @ 2026-11-30 09:00 #lembrete\n");
    const b = await cal.create({ kind: "task", title: "Comprar café", project: "Projeto X", start: "2026-12-01", notify: "dayBefore" });
    expect(b).toMatchObject({ allDay: true, notify: "dayBefore", source: { path: "Projeto X/Pendências.md", line: 3, internal: false } });
    expect(read("Projeto X/Pendências.md")).toBe("# Pendências\n\n- [ ] Pagar a conta @ 2026-11-30 09:00 #lembrete\n- [ ] Comprar café @ 2026-12-01 🔔 1d\n");
    await cal.create({ kind: "focus", title: "Estudar", start: "2026-11-30T07:00", end: "2026-11-30T08:00", repeat: "daily" });
    expect(read("Calendário.md")).toBe("# Calendário\n\n- Estudar @ 2026-11-30 07:00-08:00 #foco 🔁 dia\n");
    const r = await cal.items({ from: "2026-11-30", to: "2026-12-02" });
    expect(r.items.filter((i) => i.title === "Estudar").length).toBe(2);
  });

  test("em inglês, as tags em inglês; o tipo nota cria uma nota com agenda:", async () => {
    const { cal, read } = await open({ "Projeto X/a.md": "" }, { locale: "en" });
    await cal.create({ kind: "meeting", title: "Sync with Ana", start: "2026-11-30T10:00", end: "2026-11-30T10:30", notify: "10m" });
    expect(read("Calendário.md")).toContain("- Sync with Ana @ 2026-11-30 10:00-10:30 #meeting\n");
    const n = await cal.create({ kind: "note", title: "Plano do trimestre", project: "Projeto X", start: "2026-12-02T14:00", notify: "30m" });
    expect(n).toMatchObject({ id: "f:Projeto X/Plano do trimestre.md", kind: "note", start: "2026-12-02T14:00", notify: "30m" });
    expect(read("Projeto X/Plano do trimestre.md")).toBe('---\nagenda: "2026-12-02 14:00"\naviso: "30m"\n---\n\n# Plano do trimestre\n');
  });

  test("os argumentos errados e o projeto que não existe", async () => {
    const { cal } = await open({ "Projeto X/a.md": "" });
    expect(await code(cal.create({ kind: "reminder", title: "x", project: "Projeto Z", start: "2026-11-30" }))).toBe("E_NOT_FOUND");
    expect(await code(cal.create({ kind: "outro" as never, title: "x", start: "2026-11-30" }))).toBe("E_BAD_ARGS");
    expect(await code(cal.create({ kind: "task", title: "", start: "2026-11-30" }))).toBe("E_BAD_ARGS");
    expect(await code(cal.create({ kind: "task", title: "x #lembrete", start: "2026-11-30" }))).toBe("E_BAD_ARGS");
    expect(await code(cal.create({ kind: "task", title: "x 🔔 10m", start: "2026-11-30" }))).toBe("E_BAD_ARGS");
    expect(await code(cal.create({ kind: "task", title: "x", start: "2026-11-30T10:00", end: "2026-12-01T12:00" }))).toBe("E_BAD_ARGS");
    expect(await code(cal.create({ kind: "note", title: "x", start: "2026-11-30", repeat: "daily" }))).toBe("E_BAD_ARGS");
    expect(await code(cal.create({ kind: "task", title: "x", project: "a/b", start: "2026-11-30" }))).toBe("E_BAD_ARGS");
  });
});

describe("alertsBetween", () => {
  const item = (o: Partial<CalendarItem>): CalendarItem => ({
    id: "n:a.md#0:00000000",
    kind: "reminder",
    title: "Ligar para a Ana",
    project: null,
    start: "2026-11-27T14:00",
    end: null,
    allDay: false,
    notify: "atTime",
    readOnly: false,
    source: { path: "a.md", line: 0, internal: false },
    ...o,
  });

  test("a hora de cada aviso; sem os feitos, os sem aviso e as reuniões gravadas", () => {
    const day = toMs("2026-11-26T00:00");
    const list = [
      item({}),
      item({ id: "b", title: "Café", notify: "10m", kind: "meeting" }),
      item({ id: "c", title: "Véspera", notify: "dayBefore", start: "2026-11-28T08:00" }),
      item({ id: "d", title: "Dia todo", notify: "30m", allDay: true, start: "2026-11-27" }),
      item({ id: "e", title: "Feito", done: true }),
      item({ id: "f", title: "Mudo", notify: "none" }),
      item({ id: "g", title: "Gravada", readOnly: true, notify: "10m" }),
    ];
    const got = alertsBetween(list, day, day + 3 * 86_400_000);
    expect(got.map((a) => [a.item.title, new Date(a.at).toTimeString().slice(0, 5)])).toEqual([
      ["Véspera", "08:00"],
      ["Dia todo", "08:30"],
      ["Café", "13:50"],
      ["Ligar para a Ana", "14:00"],
    ]);
    // A janela é [from, to).
    const at = notifyAt(list[0]!)!;
    expect(alertsBetween([list[0]!], at, at + 1).length).toBe(1);
    expect(alertsBetween([list[0]!], at - 1, at).length).toBe(0);
  });

  test("a chave do aviso não muda com uma linha acima nem com o 🔔 gravado (#32185)", () => {
    const a = alertsBetween([item({ id: "n:a.md#3:11111111" })], 0, Number.MAX_SAFE_INTEGER)[0]!;
    const b = alertsBetween([item({ id: "n:a.md#5:22222222", source: { path: "a.md", line: 5, internal: false } })], 0, Number.MAX_SAFE_INTEGER)[0]!;
    expect(a.key).toBe(b.key);
    const c = alertsBetween([item({ start: "2026-11-27T15:00" })], 0, Number.MAX_SAFE_INTEGER)[0]!;
    expect(c.key).not.toBe(a.key);
  });
});

describe("calendar.update: a vez esquecida de um lembrete repetido (#483)", () => {
  const REGAR = "# Projeto X\n\n- [ ] Regar as plantas @ 2026-12-07 08:00 #lembrete 🔁 dia\n";
  const vez = async (cal: Awaited<ReturnType<typeof open>>["cal"], day: string) => (await cal.items({ from: day, to: addDays(day, 1) })).items[0]!;

  test("esqueceu o dia 7 e marca o de hoje todo dia: a série anda, e a linha não junta ⏭", async () => {
    const today = { day: "2026-12-08" };
    const { cal, read } = await open({ "Projeto X/Pendências.md": REGAR }, { today });
    for (const day of ["2026-12-08", "2026-12-09", "2026-12-10"]) {
      today.day = day;
      await cal.update({ id: (await vez(cal, day)).id, done: true });
    }
    expect(read("Projeto X/Pendências.md")).toBe("# Projeto X\n\n- [ ] Regar as plantas @ 2026-12-11 08:00 #lembrete 🔁 dia\n");
  });

  test("a linha que já juntou ⏭ antes da correção: o Feito de hoje tira os ⏭ que ficaram para trás", async () => {
    const { cal, read } = await open(
      { "Projeto X/Pendências.md": "# Projeto X\n\n- [ ] Regar as plantas @ 2026-12-07 08:00 #lembrete 🔁 dia ⏭ 2026-12-08 ⏭ 2026-12-09\n" },
      { today: { day: "2026-12-10" } },
    );
    await cal.update({ id: (await vez(cal, "2026-12-10")).id, done: true });
    expect(read("Projeto X/Pendências.md")).toBe("# Projeto X\n\n- [ ] Regar as plantas @ 2026-12-11 08:00 #lembrete 🔁 dia\n");
  });

  test("um Feito adiantado, depois de hoje, ainda vira ⏭: a vez de hoje segue aberta", async () => {
    const { cal, read } = await open({ "Projeto X/Pendências.md": REGAR }, { today: { day: "2026-12-08" } });
    await cal.update({ id: (await vez(cal, "2026-12-10")).id, done: true });
    expect(read("Projeto X/Pendências.md")).toBe("# Projeto X\n\n- [ ] Regar as plantas @ 2026-12-07 08:00 #lembrete 🔁 dia ⏭ 2026-12-10\n");
  });

  test("marcar a própria vez esquecida anda a série a partir dela", async () => {
    const { cal, read } = await open({ "Projeto X/Pendências.md": REGAR }, { today: { day: "2026-12-09" } });
    await cal.update({ id: (await vez(cal, "2026-12-07")).id, done: true });
    expect(read("Projeto X/Pendências.md")).toBe("# Projeto X\n\n- [ ] Regar as plantas @ 2026-12-08 08:00 #lembrete 🔁 dia\n");
  });

  test("com o relógio de verdade (o hoje padrão do serviço): a vez de 3 dias atrás não segura a série", async () => {
    const hoje = dayOf(Date.now());
    const { cal, read } = await open({ "Projeto X/Pendências.md": `# Projeto X\n\n- [ ] Regar as plantas @ ${addDays(hoje, -3)} 08:00 #lembrete 🔁 dia\n` }, { today: "relógio" });
    await cal.update({ id: (await vez(cal, hoje)).id, done: true });
    expect(read("Projeto X/Pendências.md")).toBe(`# Projeto X\n\n- [ ] Regar as plantas @ ${addDays(hoje, 1)} 08:00 #lembrete 🔁 dia\n`);
  });

  test("numa pendência repetida, a vez atrasada continua segurando: o Feito de hoje vira ⏭", async () => {
    const { cal, read } = await open({ "Projeto X/Pendências.md": "# Projeto X\n\n- [ ] Revisar o orçamento @ 2026-12-07 08:00 🔁 dia\n" }, { today: { day: "2026-12-08" } });
    await cal.update({ id: (await vez(cal, "2026-12-08")).id, done: true });
    expect(read("Projeto X/Pendências.md")).toBe("# Projeto X\n\n- [ ] Revisar o orçamento @ 2026-12-07 08:00 🔁 dia ⏭ 2026-12-08\n");
  });
});

describe("o Sim da sugestão atrasada numa repetição (#485)", () => {
  // O painel lê de 13/11 a 02/12 (`panelRange`) com o relógio em 27/11, 12h.
  const NOW = startMs("2026-11-27T12:00");
  const CASA = "# Casa\n\n- [ ] Regar as plantas @ 2026-11-20 08:00 🔁 dia\n";
  const late = async (cal: Awaited<ReturnType<typeof open>>["cal"], answered: Set<string>) =>
    suggestion((await cal.items({ from: "2026-11-13", to: "2026-12-02" })).items, NOW, "pt", answered);
  const yes = (cal: Awaited<ReturnType<typeof open>>["cal"]) => async (u: Parameters<typeof cal.update>[0]) => void (await cal.update(u));

  // Era o teste da issue: ele pedia a série em `@ 2026-11-28 09:00`, o que muda a hora dela. Pelo spec #34320 (#34367), o
  // Sim leva só a vez para amanhã, numa linha avulsa, e a série fica.
  test("o Sim da atrasada numa repetição diária passa só a vez para amanhã, e ela não volta", async () => {
    const { cal, read } = await open({ "Casa.md": CASA });
    const answered = new Set<string>();
    const first = await late(cal, answered);
    expect(first?.rule).toBe("overdue");
    expect(first!.itemId.endsWith("~2026-11-27")).toBe(true);
    expect(first!.accept.patch).toEqual({ start: "2026-11-28T09:00", only: true });
    await answerYes(first!, yes(cal), answered);
    expect((await late(cal, answered))?.rule).not.toBe("overdue");
    expect(read("Casa.md")).toBe("# Casa\n\n- [ ] Regar as plantas @ 2026-11-20 08:00 🔁 dia ⏭ 2026-11-27\n- [ ] Regar as plantas @ 2026-11-28 09:00\n");
  });

  test("a vez do dia anterior, ainda atrasada, não traz a sugestão de volta", async () => {
    const { cal } = await open({ "Casa.md": CASA });
    const answered = new Set<string>();
    await answerYes((await late(cal, answered))!, yes(cal), answered);
    const items = (await cal.items({ from: "2026-11-13", to: "2026-12-02" })).items;
    const de26 = items.find((i) => i.start === "2026-11-26T08:00");
    expect(de26?.done).toBeFalsy();
    // Sem a resposta guardada, a do dia 26 seria a próxima "atrasada"; com ela, a série inteira fica quieta.
    expect(suggestion(items, NOW, "pt")?.itemId).toBe(de26!.id);
    expect(suggestion(items, NOW, "pt", answered)?.rule).not.toBe("overdue");
  });

  test("o Agora não numa vez vale para as outras vezes da série", async () => {
    const { cal } = await open({ "Casa.md": CASA });
    const answered = new Set<string>();
    answered.add((await late(cal, answered))!.key);
    expect((await late(cal, answered))?.rule).not.toBe("overdue");
  });

  test("fora de uma repetição, o Sim continua movendo o item, sem o only", async () => {
    const { cal, read } = await open({ "Casa.md": "# Casa\n\n- [ ] Pagar a conta @ 2026-11-27 08:00\n" });
    const answered = new Set<string>();
    const first = (await late(cal, answered))!;
    expect(first.accept.patch).toEqual({ start: "2026-11-28T09:00" });
    await answerYes(first, yes(cal), answered);
    expect(read("Casa.md")).toBe("# Casa\n\n- [ ] Pagar a conta @ 2026-11-28 09:00\n");
  });
});

describe("calendar.update com only: só esta vez (#485)", () => {
  const vez = async (cal: Awaited<ReturnType<typeof open>>["cal"], day: string) => (await cal.items({ from: day, to: addDays(day, 1) })).items[0]!;

  test("a linha avulsa leva a duração, o tipo e o aviso; a série guarda os ⏭ em ordem", async () => {
    const { cal, read } = await open({ "Projeto X/Plano.md": "# Projeto X\n\n  - [ ] Ligar para a Ana @ 2026-12-07 08:00-08:30 #lembrete 🔔 10m 🔁 semana ⏭ 2026-12-21\n" });
    const item = await cal.update({ id: (await vez(cal, "2026-12-14")).id, start: "2026-12-15T10:00", only: true });
    expect(item.start).toBe("2026-12-15T10:00");
    expect(item.end).toBe("2026-12-15T10:30");
    expect(item.repeat).toBeUndefined();
    expect(read("Projeto X/Plano.md")).toBe(
      "# Projeto X\n\n  - [ ] Ligar para a Ana @ 2026-12-07 08:00-08:30 #lembrete 🔔 10m 🔁 semana ⏭ 2026-12-14 ⏭ 2026-12-21\n  - [ ] Ligar para a Ana @ 2026-12-15 10:00-10:30 #lembrete 🔔 10m\n",
    );
    expect((await cal.items({ from: "2026-12-07", to: "2026-12-29" })).items.map((i) => i.start)).toEqual(["2026-12-07T08:00", "2026-12-15T10:00", "2026-12-28T08:00"]);
  });

  test("a 1ª vez da série também: ela sai, e a série segue nas outras", async () => {
    const { cal, read } = await open({ "Casa.md": "# Casa\n\n- [ ] Regar as plantas @ 2026-12-07 #lembrete 🔁 dia\n" });
    await cal.update({ id: (await vez(cal, "2026-12-07")).id, start: "2026-12-08", only: true });
    expect(read("Casa.md")).toBe("# Casa\n\n- [ ] Regar as plantas @ 2026-12-07 #lembrete 🔁 dia ⏭ 2026-12-07\n- [ ] Regar as plantas @ 2026-12-08 #lembrete\n");
  });

  test("recusa fora de uma repetição, sem start e com outros campos", async () => {
    const { cal, read } = await open({ "Casa.md": "# Casa\n\n- [ ] Pagar a conta @ 2026-12-07 08:00\n- [ ] Regar as plantas @ 2026-12-07 08:00 🔁 dia\n" });
    const items = (await cal.items({ from: "2026-12-07", to: "2026-12-08" })).items;
    const avulsa = items.find((i) => i.title === "Pagar a conta")!;
    const vezDe7 = items.find((i) => i.title === "Regar as plantas")!;
    await expect(cal.update({ id: avulsa.id, start: "2026-12-08T09:00", only: true })).rejects.toThrow("only is for one time of a repetition");
    await expect(cal.update({ id: vezDe7.id, only: true })).rejects.toThrow("only takes start");
    await expect(cal.update({ id: vezDe7.id, start: "2026-12-08T09:00", title: "Outra", only: true })).rejects.toThrow("only takes start");
    expect(read("Casa.md")).toBe("# Casa\n\n- [ ] Pagar a conta @ 2026-12-07 08:00\n- [ ] Regar as plantas @ 2026-12-07 08:00 🔁 dia\n");
  });
});

describe("calendar.update: Feito numa repetição (#450)", () => {
  const REGAR = "# Projeto X\n\n- [ ] Regar as plantas @ 2026-12-07 08:00 #lembrete 🔁 dia\n";
  const starts = async (cal: Awaited<ReturnType<typeof open>>["cal"], from = "2026-12-07", to = "2026-12-10") =>
    (await cal.items({ from, to })).items.map((i) => i.start);

  test("o Feito na 3ª vez não apaga a 1ª e a 2ª, que ainda estão abertas", async () => {
    const { cal, read } = await open({ "Projeto X/Pendências.md": REGAR });
    const vezes = (await cal.items({ from: "2026-12-07", to: "2026-12-10" })).items;
    expect(vezes.map((i) => i.start)).toEqual(["2026-12-07T08:00", "2026-12-08T08:00", "2026-12-09T08:00"]);
    await cal.update({ id: vezes[2]!.id, done: true });
    expect(await starts(cal)).toEqual(["2026-12-07T08:00", "2026-12-08T08:00"]);
    expect(await starts(cal, "2026-12-10", "2026-12-11")).toEqual(["2026-12-10T08:00"]);
    expect(read("Projeto X/Pendências.md")).toBe("# Projeto X\n\n- [ ] Regar as plantas @ 2026-12-07 08:00 #lembrete 🔁 dia ⏭ 2026-12-09\n");
  });

  test("os ⏭ vão em ordem de dia, seja qual for a ordem dos cliques", async () => {
    const { cal, read } = await open({ "Projeto X/Pendências.md": REGAR });
    const vezes = (await cal.items({ from: "2026-12-07", to: "2026-12-10" })).items;
    await cal.update({ id: vezes[2]!.id, done: true });
    const de8 = (await cal.items({ from: "2026-12-08", to: "2026-12-09" })).items[0]!;
    await cal.update({ id: de8.id, done: true });
    expect(read("Projeto X/Pendências.md")).toContain("🔁 dia ⏭ 2026-12-08 ⏭ 2026-12-09\n");
    expect(await starts(cal)).toEqual(["2026-12-07T08:00"]);
  });

  test("o Feito na 1ª vez em aberto anda a série, pula as já feitas e tira os ⏭ que ficaram para trás", async () => {
    const { cal, read } = await open({ "Projeto X/Pendências.md": "# Projeto X\n\n- [ ] Regar as plantas @ 2026-12-07 08:00 #lembrete 🔁 dia ⏭ 2026-12-08 ⏭ 2026-12-10\n" });
    const primeira = (await cal.items({ from: "2026-12-07", to: "2026-12-08" })).items[0]!;
    await cal.update({ id: primeira.id, done: true });
    expect(read("Projeto X/Pendências.md")).toBe("# Projeto X\n\n- [ ] Regar as plantas @ 2026-12-09 08:00 #lembrete 🔁 dia ⏭ 2026-12-10\n");
    expect(await starts(cal, "2026-12-07", "2026-12-12")).toEqual(["2026-12-09T08:00", "2026-12-11T08:00"]);
  });

  test("o ⏭ com e sem U+FE0F, fora de ordem: a linha lê os dois, e o título fica limpo", () => {
    const w = parseWhen("Regar as plantas @ 2026-12-07 08:00 🔁 dia ⏭️ 2026-12-09 ⏭ 2026-12-08")!;
    expect(w.skip).toEqual(["2026-12-08", "2026-12-09"]);
    expect(w.title).toBe("Regar as plantas");
    expect(rewriteWhen("Regar as plantas @ 2026-12-07 08:00 🔁 dia ⏭️ 2026-12-09", { skip: [...w.skip, "2026-12-11"] }, "pt")).toBe(
      "Regar as plantas @ 2026-12-07 08:00 🔁 dia ⏭ 2026-12-08 ⏭ 2026-12-09 ⏭ 2026-12-11",
    );
  });

  test("mover a série leva os ⏭ junto; tirar a repetição tira os ⏭; o título não aceita ⏭", async () => {
    const { cal, read } = await open({ "Projeto X/Pendências.md": "# Projeto X\n\n- [ ] Regar as plantas @ 2026-12-07 08:00 #lembrete 🔁 dia ⏭ 2026-12-09\n" });
    const de8 = (await cal.items({ from: "2026-12-08", to: "2026-12-09" })).items[0]!;
    await cal.update({ id: de8.id, start: "2026-12-09T08:00" });
    expect(read("Projeto X/Pendências.md")).toContain("@ 2026-12-08 08:00 #lembrete 🔁 dia ⏭ 2026-12-10\n");
    const de9 = (await cal.items({ from: "2026-12-09", to: "2026-12-10" })).items[0]!;
    expect(await code(cal.update({ id: de9.id, title: "Regar ⏭ 2026-12-12" }))).toBe("E_BAD_ARGS");
    await cal.update({ id: de9.id, repeat: null });
    expect(read("Projeto X/Pendências.md")).toBe("# Projeto X\n\n- [ ] Regar as plantas @ 2026-12-08 08:00 #lembrete\n");
  });

  test("o cartão do Calendário e a Início não mostram o ⏭", async () => {
    const { cal } = await open({ "Projeto X/Pendências.md": "# Projeto X\n\n- [ ] Regar as plantas @ 2026-12-07 08:00 #lembrete 🔁 dia ⏭ 2026-12-09\n" });
    const its = (await cal.items({ from: "2026-12-07", to: "2026-12-12" })).items;
    expect(its.map((i) => i.title)).toEqual(Array(4).fill("Regar as plantas"));
    expect(its[0]!.skip).toEqual(["2026-12-09"]);
  });
});

// Os avisos conferem a cada 30 s e liam do disco toda nota com caixa aberta (#486): só a nota que mudou é relida.
describe("calendar.items: só relê a nota que mudou (#486)", () => {
  const TAREFAS = "# Tarefas\n\n- [ ] Escolher o fornecedor\n";
  async function counted() {
    const t = await open({ "Projeto X/Pendências.md": PROJETO, "Projeto X/Tarefas.md": TAREFAS, "Casa.md": "# Casa\n\n- [ ] Levar a geladeira\n" });
    const read: string[] = [];
    const get = t.vault.get.bind(t.vault);
    t.vault.get = (p: unknown) => (read.push(String(p)), get(p));
    const items = async () => {
      read.length = 0;
      const r = await t.cal.items({ from: "2026-11-23", to: "2026-11-30" });
      return { r, read: [...read].sort() };
    };
    return { ...t, items };
  }

  test("sem mudança, a conferência seguinte não lê nenhuma nota, e os itens são os mesmos", async () => {
    const { items } = await counted();
    const a = await items();
    expect(a.read).toEqual(["Casa.md", "Projeto X/Pendências.md", "Projeto X/Tarefas.md"]);
    const b = await items();
    expect(b.read).toEqual([]);
    expect(b.r).toEqual(a.r);
  });

  test("a nota gravada pelo app é relida, e só ela", async () => {
    const { items, write } = await counted();
    await items();
    await write("Projeto X/Tarefas.md", "# Tarefas\n\n- [ ] Escolher o fornecedor @ 2026-11-25 09:00\n");
    const b = await items();
    expect(b.read).toEqual(["Projeto X/Tarefas.md"]);
    expect(b.r.items.find((i) => i.title === "Escolher o fornecedor")?.start).toBe("2026-11-25T09:00");
    expect(b.r.undated.map((i) => i.title)).not.toContain("Escolher o fornecedor");
  });

  test("a nota mudada fora do app é relida quando o vigia a vê, e a apagada sai", async () => {
    const t = await counted();
    t.vault.watch(); // o app liga o vigia (stores.ts, folders-workspace.ts)
    await Bun.sleep(1_200); // a conferida do watch(), depois de 1 s (T6412)
    await t.items();
    writeFileSync(path.join(t.vault.root, "Casa.md"), "# Casa\n\n- [ ] Levar a geladeira @ 2026-11-26\n");
    rmSync(path.join(t.vault.root, "Projeto X/Tarefas.md"));
    let b = await t.items();
    for (let n = 0; n < 250 && !b.r.items.some((i) => i.title === "Levar a geladeira"); n++) {
      await Bun.sleep(20);
      b = await t.items();
    }
    expect(b.r.items.find((i) => i.title === "Levar a geladeira")?.start).toBe("2026-11-26");
    for (let n = 0; n < 250 && b.r.undated.some((i) => i.title === "Escolher o fornecedor"); n++) {
      await Bun.sleep(20);
      b = await t.items();
    }
    expect(b.r.undated.map((i) => i.title)).not.toContain("Escolher o fornecedor");
  }, 15_000);

  test("mudar um item devolvido não muda o que a próxima leitura dá", async () => {
    const { items } = await counted();
    const a = await items();
    a.r.items[0]!.title = "Outro";
    a.r.items[0]!.source!.path = "x.md";
    a.r.undated[0]!.title = "Outro";
    const b = await items();
    expect(b.read).toEqual([]);
    expect(b.r.items[0]!.title).not.toBe("Outro");
    expect(b.r.items[0]!.source!.path).not.toBe("x.md");
    expect(b.r.undated.map((i) => i.title)).not.toContain("Outro");
  });
});
