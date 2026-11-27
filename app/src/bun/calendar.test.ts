// O Calendário (T32154, spec #32129): os itens lidos das notas e das reuniões, criar, mudar a linha e os avisos. Um
// vault de verdade num tmp, com notas inventadas (Ana, Projeto X), para o `save` pela versão e o `create` serem os do
// app.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Vault } from "../notes/vault.ts";
import { type CalendarItem, notifyAt, parseWhen, rewriteWhen, toMs } from "../shared/calendar.ts";
import { tempDir } from "../../test/tmp.ts";
import { alertsBetween, calendarService, occurrences, setFrontmatter } from "./calendar.ts";

const dirs: string[] = [];
const vaults: Vault[] = [];
afterEach(() => {
  for (const v of vaults.splice(0)) v.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function open(files: Record<string, string>, opts: { meetings?: Record<string, string>; locale?: "pt" | "en"; live?: string | null } = {}) {
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
  const cal = calendarService(async () => ({ notes: notes.v, meetings: meetings.v, liveSession: opts.live ?? null, locale: opts.locale ?? "pt" }));
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

  test("numa repetição: mover uma vez move a série; Feito passa para a próxima vez", async () => {
    const { cal, read } = await open({ "Projeto X/Planejamento.md": PROJETO });
    const rep = (await cal.items({ from: "2026-12-01", to: "2026-12-02" })).items.find((i) => i.title === "Bloco de escrita")!;
    expect(rep.id).toMatch(/~2026-12-01$/);
    await cal.update({ id: rep.id, start: "2026-12-01T09:00", end: "2026-12-01T10:00" });
    expect(read("Projeto X/Planejamento.md")).toContain("- [ ] Bloco de escrita @ 2026-11-24 09:00-10:00 #foco 🔁 semana\n");
    const again = (await cal.items({ from: "2026-12-01", to: "2026-12-02" })).items.find((i) => i.title === "Bloco de escrita")!;
    await cal.update({ id: again.id, done: true });
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
