// A proposta da reunião (spec #8360, T11290): a nota da reunião e a mudança na nota principal que o Kiwi monta, a
// ferramenta `meeting_propose` que confere o que o agente mandou, e as propostas guardadas por 30 dias.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { SecretGuard } from "../guardrail/filter.ts";
import type { MeetingNote } from "../shared/meetings.ts";
import type { NoteModel } from "../shared/note-model.ts";
import {
  addedLines,
  DEFAULT_MEETING_NOTE_SETTINGS,
  mainNoteWithMeeting,
  meetingNoteContent,
  meetingNoteFolder,
  meetingNoteTitle,
  PROPOSAL_KEEP_MS,
  ProposalStore,
  type ProposalFields,
} from "./proposals.ts";
import { EMPTY_READER, type VaultReader } from "./tools/reader.ts";
import { kiwiTools, runKiwiTool, type ProposalDraft, type SummaryDraft } from "./tools/tools.ts";

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

const MEETING = { path: "Reuniões/2026-11-11 10h00 Zoom.md", title: "2026-11-11 10h00 Zoom", date: "2026-11-11" };
const FIELDS: ProposalFields = {
  theme: "Cronograma da migração",
  summary: "Revisamos o cronograma.",
  decisions: ["Começar pelo arquivo de 2019"],
  actions: [{ what: "Mandar o plano de testes", who: "Ana", when: "sexta" }, { what: "Conferir a cota" }],
  participants: ["Ana", "Bruno"],
  nextSteps: ["Rodar a migração de teste"],
  pending: ["Confirmar a janela de manutenção"],
};
const PROJECT = { folder: "Projetos/Migração", name: "Migração", main: "Projetos/Migração/Migração.md" };

describe("a nota da reunião que o Kiwi monta", () => {
  test("o nome, a pasta e os blocos: o link para a transcrição sempre, os outros como Ajustes manda", () => {
    expect(meetingNoteTitle("2026-11-11", "Cronograma: [fase 2]", "date-theme")).toBe("2026-11-11 · Cronograma fase 2");
    expect(meetingNoteTitle("2026-11-11", "Cronograma", "theme-date")).toBe("Cronograma · 2026-11-11");
    expect(meetingNoteTitle("2026-11-11", "  ", "date-theme")).toBe("2026-11-11 · Reunião");
    expect(meetingNoteFolder(PROJECT, DEFAULT_MEETING_NOTE_SETTINGS)).toBe("Projetos/Migração");
    expect(meetingNoteFolder(null, DEFAULT_MEETING_NOTE_SETTINGS)).toBe("");
    expect(meetingNoteFolder(PROJECT, { ...DEFAULT_MEETING_NOTE_SETTINGS, folder: { kind: "single", path: "/Atas/" } })).toBe("Atas");
    // Sem o arquivo do Modelo de nota, vale o padrão dele: as propriedades, o título, a introdução com o link, o
    // sumário, o corpo e o fechamento (os próximos passos).
    expect(meetingNoteContent(MEETING, FIELDS, DEFAULT_MEETING_NOTE_SETTINGS, { project: "Migração" })).toBe(
      [
        "---",
        "data: 2026-11-11",
        'reuniao: "[[Reuniões/2026-11-11 10h00 Zoom|2026-11-11 10h00 Zoom]]"',
        'projeto: "Migração"',
        'participantes: ["Ana", "Bruno"]',
        "tags: [reuniao]",
        "---",
        "",
        "# Cronograma da migração",
        "",
        "Reunião de 11/11/2026, com Ana e Bruno. A transcrição: [[Reuniões/2026-11-11 10h00 Zoom|2026-11-11 10h00 Zoom]].",
        "",
        "- [[#Resumo]]\n- [[#Decisões]]\n- [[#Ações]]\n- [[#Próximos passos]]",
        "",
        "## Resumo\n\nRevisamos o cronograma.",
        "",
        "## Decisões\n\n- Começar pelo arquivo de 2019",
        "",
        "## Ações\n\n- [ ] Mandar o plano de testes (Ana, sexta)\n- [ ] Conferir a cota",
        "",
        "## Próximos passos\n\n- Rodar a migração de teste\n",
      ].join("\n"),
    );
    const only = { ...DEFAULT_MEETING_NOTE_SETTINGS, blocks: { summary: false, decisions: true, actions: false, participants: false, nextSteps: false } };
    const text = meetingNoteContent(MEETING, FIELDS, only);
    expect(text).toContain("## Decisões");
    expect(text).not.toMatch(/Resumo|Ações|Participantes|Próximos/);
    // A transcrição bruta nunca entra: só o link para ela.
    expect(text).toContain("[[Reuniões/2026-11-11 10h00 Zoom|");
  });

  test("o Modelo de nota manda na ordem e na forma; Ajustes, no que entra; o link para a transcrição está sempre lá", () => {
    const model: NoteModel = {
      blocks: [
        { block: "corpo", on: true },
        { block: "titulo", on: true },
        { block: "sumario", on: true },
        { block: "fechamento", on: false },
        { block: "introducao", on: false },
        { block: "propriedades", on: false },
      ],
      body: "topicos",
      numbered: true,
      tocDepth: 2,
    };
    const fields = { ...FIELDS, summary: "Revisamos o cronograma. Começamos em dezembro." };
    const blocks = { ...DEFAULT_MEETING_NOTE_SETTINGS.blocks, actions: false };
    expect(meetingNoteContent(MEETING, fields, { ...DEFAULT_MEETING_NOTE_SETTINGS, blocks }, { model })).toBe(
      [
        "## 1. Resumo\n\n- Revisamos o cronograma.\n- Começamos em dezembro.",
        "",
        "## 2. Decisões\n\n- Começar pelo arquivo de 2019",
        "",
        // Sem o fechamento no modelo, os próximos passos ficam no fim do corpo.
        "## 3. Próximos passos\n\n- Rodar a migração de teste",
        "",
        "# Cronograma da migração",
        "",
        "- [[#1. Resumo]]\n- [[#2. Decisões]]\n- [[#3. Próximos passos]]",
        "",
        // Sem a introdução nem as propriedades, quem participou e o link vão no fim.
        "Com Ana e Bruno. A transcrição: [[Reuniões/2026-11-11 10h00 Zoom|2026-11-11 10h00 Zoom]].\n",
      ].join("\n"),
    );
    // As propriedades vão sempre para o começo (o frontmatter só vale ali), e o sumário até o nível 1 não lista as seções.
    const props: NoteModel = { ...model, blocks: [...model.blocks.filter((b) => b.block !== "propriedades"), { block: "propriedades", on: true }], tocDepth: 1 };
    const text = meetingNoteContent(MEETING, fields, DEFAULT_MEETING_NOTE_SETTINGS, { model: props });
    expect(text).toStartWith("---\ndata: 2026-11-11\n");
    expect(text).not.toContain("[[#");
    expect(text).toContain("A transcrição: [[Reuniões/2026-11-11 10h00 Zoom|");
  });

  test("a nota principal: só acrescenta, nas seções que já existem ou em seções novas no fim", () => {
    const before = "# Migração\n\n## Pendências\n\n- [ ] Pedir o acesso\n\n## Notas\n\nTexto da pessoa.\n";
    const after = mainNoteWithMeeting(before, "Projetos/Migração/2026-11-11 · Cronograma da migração.md", MEETING, FIELDS);
    expect(after).toBe(
      [
        "# Migração",
        "",
        "## Pendências",
        "",
        "- [ ] Pedir o acesso",
        "- [ ] Confirmar a janela de manutenção",
        "",
        "## Notas",
        "",
        "Texto da pessoa.",
        "",
        "## Histórico de reuniões",
        "",
        "- 2026-11-11 · [[Projetos/Migração/2026-11-11 · Cronograma da migração|Cronograma da migração]]",
        "",
        "## Decisões",
        "",
        "- Começar pelo arquivo de 2019 (11/11/2026)",
        "",
      ].join("\n"),
    );
    // A diferença marca só as linhas novas; toda linha de antes continua, na ordem.
    const diff = addedLines(before, after);
    expect(diff.filter((l) => !l.added).map((l) => l.text)).toEqual(before.split("\n"));
    expect(diff.filter((l) => l.added).map((l) => l.text)).toContain("- [ ] Confirmar a janela de manutenção");
    // Os espaços do fim de uma linha (a quebra do Markdown) ficam como estavam.
    expect(mainNoteWithMeeting("## Pendências\n\n- [ ] Pedir  \n", "N.md", MEETING, FIELDS)).toStartWith("## Pendências\n\n- [ ] Pedir  \n- [ ] Confirmar");
    expect(mainNoteWithMeeting("Texto  \n", "N.md", MEETING, { ...FIELDS, decisions: [], pending: [] })).toBe("Texto  \n\n## Histórico de reuniões\n\n- 2026-11-11 · [[N|Cronograma da migração]]\n");
    // Uma segunda reunião entra no mesmo histórico, embaixo da primeira.
    const again = mainNoteWithMeeting(after, "Projetos/Migração/2026-11-12 · Outra.md", { ...MEETING, date: "2026-11-12" }, { ...FIELDS, theme: "Outra", decisions: [], pending: [] });
    expect(again).toContain("[[Projetos/Migração/2026-11-11 · Cronograma da migração|Cronograma da migração]]\n- 2026-11-12 · [[Projetos/Migração/2026-11-12 · Outra|Outra]]\n\n## Decisões");
  });
});

describe("as propostas guardadas", () => {
  function store(start = 1_800_000_000_000) {
    const dir = mkdtempSync(path.join(tmpdir(), "kn-proposals-"));
    roots.push(dir);
    const clock = { now: start };
    return { dir, clock, s: new ProposalStore(dir, () => clock.now) };
  }

  test("0600, uma por reunião enquanto pendente, e os 30 dias valem no disco", () => {
    const { dir, clock, s } = store();
    const a = s.add({ request: "r1", meeting: MEETING, project: PROJECT, candidates: [], fields: FIELDS });
    const b = s.add({ request: "r2", meeting: MEETING, project: PROJECT, candidates: [], fields: { ...FIELDS, theme: "Outro tema" } });
    // A proposta nova da mesma reunião troca a pendente de antes.
    expect(s.list().map((p) => p.id)).toEqual([b.id]);
    expect(s.get(a.id)).toBeNull();
    const file = path.join(dir, "proposals.json");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    clock.now += PROPOSAL_KEEP_MS + 1;
    expect(s.list()).toEqual([]);
    expect(readFileSync(file, "utf8")).not.toContain(b.id);
  });
});

describe("a ferramenta meeting_propose", () => {
  const meetings: MeetingNote[] = [
    { ...MEETING, start: null, end: null, duration: 1800, app: "Zoom", participants: ["Ana"], live: false, mtime: "2026-11-11T11:00:00.000Z" },
    { path: "Reuniões/Agora.md", title: "Agora", date: "2026-11-11", start: null, end: null, duration: null, app: null, participants: [], live: true, mtime: "2026-11-11T12:00:00.000Z" },
  ];
  const project = (folder: string, name: string) => ({ folder, name, main: `${folder}/${name}.md`, updated: null, notes: 1 });
  const reader: VaultReader = {
    ...EMPTY_READER,
    meetings: async () => meetings,
    projects: async () => [project("Projetos/Migração", "Migração"), project("Projetos/VNA", "VNA Fuji"), project("Projetos/Kiwi", "Kiwi")],
  };
  function ctx(guard?: SecretGuard) {
    const got: ProposalDraft[] = [];
    return { got, ctx: { reader, ...(guard ? { guard } : {}), proposals: { propose: async (d: ProposalDraft) => (got.push(d), { id: `p${got.length}` }), summary: async () => ({ id: "s" }), since: async () => "2026-01-01" } } };
  }
  const call = (c: ReturnType<typeof ctx>["ctx"], args: Record<string, unknown>) => runKiwiTool(c, "meeting_propose", { reuniao: MEETING.path, tema: "Tema", ...args });

  test("só aparece com quem guarda a proposta; a proposta guardada leva a reunião, o projeto e os campos limpos", async () => {
    expect(kiwiTools(true).map((t) => t.name)).not.toContain("meeting_propose");
    expect(kiwiTools(true, true).map((t) => t.name)).toContain("meeting_propose");
    await expect(runKiwiTool({ reader }, "meeting_propose", {})).rejects.toMatchObject({ code: "E_UNKNOWN_TOOL" });
    const { got, ctx: c } = ctx();
    const r = await call(c, { projeto: "migração", decisoes: ["  Começar  ", ""], acoes: [{ oque: "Plano", quem: "Ana" }] });
    expect(r.value).toMatchObject({ proposta: "p1", projeto: "Projetos/Migração" });
    expect(r.change).toBeUndefined();
    expect(got[0]).toEqual({
      meeting: MEETING,
      project: { folder: "Projetos/Migração", name: "Migração", main: "Projetos/Migração/Migração.md" },
      candidates: [],
      fields: { theme: "Tema", decisions: ["Começar"], actions: [{ what: "Plano", who: "Ana" }], participants: [], nextSteps: [], pending: [] },
    });
    // Na dúvida, os candidatos; sem nenhum, nem projeto nem candidatos.
    await call(c, { candidatos: ["Projetos/Migração", "VNA Fuji"] });
    expect(got[1]!.candidates.map((p) => p.name)).toEqual(["Migração", "VNA Fuji"]);
    await call(c, {});
    expect(got[2]).toMatchObject({ project: null, candidates: [] });
  });

  test("recusa a reunião que não existe ou ainda grava, o projeto desconhecido, os dois juntos e um candidato só", async () => {
    const { got, ctx: c } = ctx();
    await expect(call(c, { reuniao: "Reuniões/Nada.md" })).rejects.toMatchObject({ code: "E_NOT_FOUND" });
    await expect(call(c, { reuniao: "Reuniões/Agora.md" })).rejects.toMatchObject({ code: "E_BAD_ARGS" });
    await expect(call(c, { projeto: "Outro" })).rejects.toMatchObject({ code: "E_NOT_FOUND" });
    await expect(call(c, { projeto: "Kiwi", candidatos: ["Kiwi", "VNA Fuji"] })).rejects.toMatchObject({ code: "E_BAD_ARGS" });
    await expect(call(c, { candidatos: ["Kiwi", "Projetos/Kiwi"] })).rejects.toMatchObject({ code: "E_BAD_ARGS" });
    await expect(call(c, { tema: "   " })).rejects.toMatchObject({ code: "E_BAD_ARGS" });
    await expect(call(c, { extra: 1 })).rejects.toMatchObject({ code: "E_BAD_ARGS" });
    expect(got).toEqual([]);
  });

  test("um segredo da transcrição (o marcador do filtro) não vai para a nota do projeto", async () => {
    const guard = new SecretGuard();
    const masked = guard.request("a chave é ghp_0123456789abcdefghijABCDEFGHIJ012345 e pronto").text;
    const marker = /‹segredo [^›]+›/.exec(masked)?.[0];
    expect(marker).toBeDefined();
    const { got, ctx: c } = ctx(guard);
    await expect(call(c, { resumo: `Usar ${marker}` })).rejects.toThrow(/marcador/);
    await expect(call(c, { acoes: [{ oque: `Trocar ${marker}` }] })).rejects.toThrow(/marcador/);
    expect(got).toEqual([]);
  });
});

describe("a ferramenta project_summary_propose (spec #11546)", () => {
  const meetings: MeetingNote[] = [
    { ...MEETING, start: null, end: null, duration: 1800, app: "Zoom", participants: ["Ana"], live: false, mtime: "2026-11-11T11:00:00.000Z" },
    { path: "Projetos/Migração/2026-11-12 · Outra.md", title: "Outra", date: "2026-11-12", start: null, end: null, duration: 60, app: null, participants: [], live: false, mtime: "2026-11-12T11:00:00.000Z" },
    { path: "Reuniões/Agora.md", title: "Agora", date: "2026-11-13", start: null, end: null, duration: null, app: null, participants: [], live: true, mtime: "2026-11-13T12:00:00.000Z" },
  ];
  const project = (folder: string, name: string) => ({ folder, name, main: `${folder}/${name}.md`, updated: null, notes: 1 });
  const note = (p: string) => ({ path: p, title: p.split("/").at(-1)!.replace(/\.md$/, ""), folder: p.split("/").slice(0, -1).join("/"), size: 1, mtime: "2026-11-10T00:00:00.000Z" });
  const reader: VaultReader = {
    ...EMPTY_READER,
    list: async () => ({ folders: ["Projetos/Migração"], notes: [note("Projetos/Migração/Migração.md")] }),
    meetings: async () => meetings,
    projects: async () => [project("Projetos/Migração", "Migração"), project("Projetos/VNA", "VNA Fuji"), project("Projetos/Kiwi", "Kiwi")],
  };
  function ctx(guard?: SecretGuard) {
    const got: SummaryDraft[] = [];
    const sink = { propose: async () => ({ id: "m" }), summary: async (d: SummaryDraft) => (got.push(d), { id: `s${got.length}` }), since: async () => "2026-11-01" };
    return { got, ctx: { reader, ...(guard ? { guard } : {}), proposals: sink } };
  }
  const call = (c: ReturnType<typeof ctx>["ctx"], args: Record<string, unknown>) => runKiwiTool(c, "project_summary_propose", { projeto: "Migração", situacao: "amarelo", ...args });

  test("só aparece com quem guarda a proposta; os campos vão com as fontes conferidas, e nada é escrito", async () => {
    expect(kiwiTools(true).map((t) => t.name)).not.toContain("project_summary_propose");
    expect(kiwiTools(true, true).map((t) => t.name)).toContain("project_summary_propose");
    const { got, ctx: c } = ctx();
    const r = await call(c, {
      linha: "  a migração   atrasou ",
      andou: [{ texto: "O cronograma foi revisto", fonte: MEETING.path }],
      decisoes: [{ texto: "Migrar em dezembro", data: "2026-11-11", fonte: MEETING.path.replace(/\.md$/, "") }],
      riscos: [{ texto: "A janela não foi confirmada" }],
      proximosPassos: [{ oque: "Confirmar a janela", quem: "Ana", quando: "sexta", fonte: "Projetos/Migração/Migração.md" }],
      reunioes: [MEETING.path, "Projetos/Migração/2026-11-12 · Outra.md"],
    });
    expect(r.value).toMatchObject({ proposta: "s1", projeto: "Projetos/Migração" });
    expect(r.value.aviso).toContain("Nada foi escrito");
    expect(r.value.foraSemFonte).toBeUndefined();
    expect(got).toHaveLength(1);
    expect(got[0]!.project).toEqual({ folder: "Projetos/Migração", name: "Migração", main: "Projetos/Migração/Migração.md" });
    expect(got[0]!.fields).toEqual({
      signal: "amarelo",
      status: "a migração   atrasou",
      progress: [{ text: "O cronograma foi revisto", source: MEETING.path }],
      // Sem o `.md`, a fonte é achada e guardada com ele.
      decisions: [{ text: "Migrar em dezembro", date: "2026-11-11", source: MEETING.path }],
      risks: [{ text: "A janela não foi confirmada" }],
      nextSteps: [{ text: "Confirmar a janela", who: "Ana", when: "sexta", source: "Projetos/Migração/Migração.md" }],
      // As reuniões, da mais nova para a mais velha.
      meetings: [
        { path: "Projetos/Migração/2026-11-12 · Outra.md", title: "Outra", date: "2026-11-12" },
        { path: MEETING.path, title: MEETING.title, date: MEETING.date },
      ],
    });
  });

  test("o agente não inventa: um item com uma fonte que não existe fica de fora, e a resposta conta", async () => {
    const { got, ctx: c } = ctx();
    const r = await call(c, {
      andou: [{ texto: "Inventado", fonte: "Projetos/Migração/Não existe.md" }],
      decisoes: [{ texto: "Real", fonte: MEETING.path }, { texto: "Inventada", fonte: "Outra coisa.md" }],
      riscos: [{ texto: "Com fonte falsa", fonte: "Nada.md" }, { texto: "Sem fonte" }],
      proximosPassos: [{ oque: "Passo", fonte: "Nada.md" }],
      // Uma reunião ainda gravando não conta.
      reunioes: ["Reuniões/Agora.md"],
    });
    expect(r.value.foraSemFonte).toBe(5);
    expect(r.value.aviso).toContain("5 item(ns) ficaram de fora");
    const f = got[0]!.fields;
    expect([f.progress, f.decisions.map((d) => d.text), f.risks, f.nextSteps, f.meetings]).toEqual([[], ["Real"], [{ text: "Sem fonte" }], [], []]);
    // A fonte é obrigatória no que andou, nas decisões e nos próximos passos.
    await expect(call(c, { decisoes: [{ texto: "Sem fonte" }] })).rejects.toMatchObject({ code: "E_BAD_ARGS" });
  });

  test("o projeto ambíguo vai com os candidatos; os campos errados são recusados", async () => {
    const { got, ctx: c } = ctx();
    const r = await runKiwiTool(c, "project_summary_propose", { candidatos: ["Kiwi", "VNA Fuji"], situacao: "verde" });
    expect(r.value).toMatchObject({ projeto: null, candidatos: ["Projetos/Kiwi", "Projetos/VNA"] });
    expect(got[0]).toMatchObject({ project: null, candidates: [{ folder: "Projetos/Kiwi" }, { folder: "Projetos/VNA" }] });
    await expect(call(c, { situacao: "azul" })).rejects.toMatchObject({ code: "E_BAD_ARGS" });
    await expect(call(c, { situacao: undefined })).rejects.toMatchObject({ code: "E_BAD_ARGS" });
    await expect(call(c, { projeto: "Outro" })).rejects.toMatchObject({ code: "E_NOT_FOUND" });
    await expect(call(c, { candidatos: ["Kiwi", "VNA Fuji"] })).rejects.toMatchObject({ code: "E_BAD_ARGS" });
    await expect(call(c, { decisoes: [{ texto: "X", data: "11/11/2026", fonte: MEETING.path }] })).rejects.toMatchObject({ code: "E_BAD_ARGS" });
    await expect(call(c, { andou: [{ texto: "  ", fonte: MEETING.path }] })).rejects.toMatchObject({ code: "E_BAD_ARGS" });
    await expect(call(c, { extra: 1 })).rejects.toMatchObject({ code: "E_BAD_ARGS" });
    expect(got).toHaveLength(1);
  });

  test("um segredo (o marcador do filtro) não vai para a nota do projeto", async () => {
    const guard = new SecretGuard();
    const marker = /‹segredo [^›]+›/.exec(guard.request("a chave é ghp_0123456789abcdefghijABCDEFGHIJ012345 e pronto").text)?.[0];
    expect(marker).toBeDefined();
    const { got, ctx: c } = ctx(guard);
    await expect(call(c, { linha: `Usar ${marker}` })).rejects.toThrow(/marcador/);
    await expect(call(c, { proximosPassos: [{ oque: `Trocar ${marker}`, fonte: MEETING.path }] })).rejects.toThrow(/marcador/);
    expect(got).toEqual([]);
  });

  test("o project_status diz desde quando o próximo resumo conta, só com quem guarda a proposta", async () => {
    const statusReader: VaultReader = {
      ...reader,
      projectStatus: async (folder) => ({
        project: { folder, name: "Migração", main: `${folder}/Migração.md`, updated: null, notes: 1 },
        outline: [],
        outlineTotal: 0,
        recent: [],
        openTasks: 0,
        taskNotes: 0,
        tasks: [],
      }),
    };
    const { ctx: c } = ctx();
    expect((await runKiwiTool({ ...c, reader: statusReader }, "project_status", { projeto: "Projetos/Migração" })).value.resumoDesde).toBe("2026-11-01");
    expect((await runKiwiTool({ reader: statusReader }, "project_status", { projeto: "Projetos/Migração" })).value.resumoDesde).toBeUndefined();
  });
});
