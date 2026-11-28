// As ferramentas do agente no Calendário (T32156): pelo `kiwi` (achar/agenda, escrever/agendar, escrever/remarcar), com
// o `calendarService` de verdade (T32154) num vault num tmp, e notas inventadas (Ana, Projeto X). O registro da cópia de
// antes é falso: guarda o texto, para conferir o [Desfazer].
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Vault } from "../../notes/vault.ts";
import { calendarService } from "../../bun/calendar.ts";
import { tempDir } from "../../../test/tmp.ts";
import { cardsFor, kiwiCallFor, resolveKiwiCall, runKiwiCall } from "./kiwi-tool.ts";
import { pathOfId } from "./calendar-tools.ts";
import type { KiwiToolContext, ToolChange } from "./tools.ts";
import type { VaultWriter } from "./writer.ts";

const dirs: string[] = [];
const vaults: Vault[] = [];
afterEach(() => {
  for (const v of vaults.splice(0)) v.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const PROJETO = `# Projeto X

- [ ] Revisar o orçamento @ 2026-11-27 10:00
- [ ] Ligar para a Ana @ 2026-11-27 14:00-14:30 #lembrete 🔔 30m
`;

async function rig(files: Record<string, string> = { "Projeto X/Plano.md": PROJETO }) {
  const d = tempDir("kiwinotes-calendar-tools-");
  dirs.push(d);
  const root = path.join(d, "Notas");
  mkdirSync(root, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  }
  const v = new Vault({ root, debounceMs: 20, trash: async (abs) => rmSync(abs, { recursive: true }) });
  vaults.push(v);
  await v.open();
  const calendar = calendarService(async () => ({ notes: v, meetings: v, liveSession: null, locale: "pt" }));
  const writer = {
    get: async (p: string) => {
      const n = await v.get(p);
      return { path: n.path, title: n.title, content: n.content, version: n.version };
    },
    folder: async () => null,
  } as unknown as VaultWriter;
  const copies = new Map<string, string>();
  const dropped: string[] = [];
  const journal = {
    keep: async (_p: string, before: string) => {
      const id = `copia-${copies.size + 1}`;
      copies.set(id, before);
      return id;
    },
    drop: async (id: string) => void dropped.push(id),
  };
  const ctx: KiwiToolContext = { reader: {} as KiwiToolContext["reader"], writer, journal, calendar, now: () => new Date(2026, 10, 26, 15, 0) };
  const call = (args: Record<string, unknown>, allowed = { writes: true, proposes: false, memory: false }) => runKiwiCall(ctx, args, allowed);
  const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
  return { ctx, call, read, copies, dropped, calendar };
}

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
};

describe("kiwi achar/agenda", () => {
  test("a semana a partir de hoje, com o id, o caminho e os projetos", async () => {
    const r = await rig();
    const out = await r.call({ fazer: "achar", opcoes: { como: "agenda" } });
    expect(out.tool).toBe("calendar_list");
    const v = out.value as { from: string; to: string; items: Record<string, unknown>[]; projects: string[] };
    expect(v.from).toBe("2026-11-26");
    expect(v.to).toBe("2026-12-02");
    expect(v.items.map((i) => i.title)).toEqual(["Revisar o orçamento", "Ligar para a Ana"]);
    expect(v.items[1]).toMatchObject({ kind: "reminder", start: "2026-11-27T14:00", end: "2026-11-27T14:30", notify: "30m", project: "Projeto X", path: "Projeto X/Plano.md" });
    expect(String(v.items[0]!.id)).toStartWith("n:Projeto X/Plano.md#2:");
    expect(v.projects).toEqual(["Projeto X"]);
    // Só lê: nada vai ao registro.
    expect(out.change).toBeUndefined();
    expect(r.copies.size).toBe(0);
  });

  test("o período pedido, e o dia mal escrito volta como erro", async () => {
    const r = await rig();
    const out = await r.call({ fazer: "achar", opcoes: { como: "agenda", de: "2026-11-28", ate: "2026-11-30" } });
    expect((out.value as { items: unknown[] }).items).toEqual([]);
    // O `ate` entra: o dia 27 sozinho traz os dois itens dele.
    const dia = await r.call({ fazer: "achar", opcoes: { como: "agenda", de: "2026-11-27", ate: "2026-11-27" } });
    expect((dia.value as { items: unknown[] }).items).toHaveLength(2);
    expect(await codeOf(r.call({ fazer: "achar", opcoes: { como: "agenda", de: "2026-11-28", ate: "2026-11-27" } }))).toBe("E_BAD_ARGS");
    expect(await codeOf(r.call({ fazer: "achar", opcoes: { como: "agenda", de: "amanhã" } }))).toBe("E_BAD_ARGS");
  });

  test("vale numa sessão só de leitura; sem o Calendário, a ação não existe", async () => {
    const r = await rig();
    expect((await r.call({ fazer: "achar", opcoes: { como: "agenda" } }, { writes: false, proposes: false, memory: false })).tool).toBe("calendar_list");
    const { calendar: _, ...semCalendario } = r.ctx;
    expect(await codeOf(runKiwiCall(semCalendario, { fazer: "achar", opcoes: { como: "agenda" } }, { writes: true, proposes: false, memory: false }))).toBe("E_UNKNOWN_TOOL");
  });
});

describe("kiwi escrever/agendar", () => {
  test("um lembrete no projeto: a linha no fim da Pendências, criada, e a mudança vai à Atividade", async () => {
    const r = await rig();
    const out = await r.call({ fazer: "escrever", alvo: "Ligar para a Ana", opcoes: { como: "agendar", tipo: "reminder", inicio: "2026-11-30T09:00", projeto: "projeto x" } });
    expect(out.tool).toBe("calendar_create");
    expect(r.read("Projeto X/Pendências.md")).toContain("- [ ] Ligar para a Ana @ 2026-11-30 09:00 #lembrete");
    expect(out.change).toMatchObject({ kind: "created", path: "Projeto X/Pendências.md", before: 0 } satisfies Partial<ToolChange>);
    expect((out.value as { item: { kind: string } }).item.kind).toBe("reminder");
  });

  test("na nota que já existe: acrescenta, com a cópia de antes para o Desfazer", async () => {
    const r = await rig({ "Projeto X/Pendências.md": "# Pendências\n\n- [ ] Antiga\n" });
    const out = await r.call({ fazer: "escrever", alvo: "Entregar o relatório", opcoes: { como: "agendar", tipo: "task", inicio: "2026-11-28", projeto: "Projeto X" } });
    const ch = out.change!;
    expect(ch.kind).toBe("appended");
    expect(ch.before).toBe("# Pendências\n\n- [ ] Antiga\n".length);
    expect(r.copies.get(ch.copy!)).toBe("# Pendências\n\n- [ ] Antiga\n");
    expect(ch.version).toBeTruthy();
  });

  test("uma nota com data (kind note) é uma nota nova", async () => {
    const r = await rig();
    const out = await r.call({ fazer: "escrever", alvo: "Pauta da revisão", opcoes: { como: "agendar", tipo: "note", inicio: "2026-11-27T10:00", projeto: "Projeto X" } });
    expect(out.change).toMatchObject({ kind: "created", path: "Projeto X/Pauta da revisão.md" });
    expect(r.read("Projeto X/Pauta da revisão.md")).toContain('agenda: "2026-11-27 10:00"');
  });

  test("projeto que não existe e tipo errado: erro que ensina, nada escrito", async () => {
    const r = await rig();
    const e1 = await r.call({ fazer: "escrever", alvo: "X", opcoes: { como: "agendar", tipo: "task", inicio: "2026-11-28", projeto: "Projeto Z" } }).catch((e) => e);
    expect(e1.code).toBe("E_NOT_FOUND");
    expect(e1.message).toContain("Projeto X");
    const e2 = await r.call({ fazer: "escrever", alvo: "X", opcoes: { como: "agendar", tipo: "festa", inicio: "2026-11-28" } }).catch((e) => e);
    expect(e2.code).toBe("E_BAD_ARGS");
    // O erro de forma volta com o cartão (as opções pelos nomes da kiwi).
    expect(e2.message).toContain("kiwi escrever/agendar");
    expect(r.copies.size).toBe(0);
  });

  test("numa sessão só de leitura, não escreve", async () => {
    const r = await rig();
    expect(await codeOf(r.call({ fazer: "escrever", alvo: "X", opcoes: { como: "agendar", tipo: "task", inicio: "2026-11-28" } }, { writes: false, proposes: false, memory: false }))).toBe("E_NOT_ALLOWED");
  });
});

describe("kiwi escrever/remarcar", () => {
  test("move a hora e liga o aviso pelo id do achar/agenda; a cópia de antes guarda a nota", async () => {
    const r = await rig();
    const list = (await r.call({ fazer: "achar", opcoes: { como: "agenda" } })).value as { items: { id: string; title: string }[] };
    const id = list.items.find((i) => i.title === "Revisar o orçamento")!.id;
    const out = await r.call({ fazer: "escrever", alvo: id, opcoes: { como: "remarcar", inicio: "2026-11-27T11:00", aviso: "30m" } });
    expect(out.tool).toBe("calendar_update");
    expect(r.read("Projeto X/Plano.md")).toContain("- [ ] Revisar o orçamento @ 2026-11-27 11:00 🔔 30m");
    expect(out.change).toMatchObject({ kind: "replaced", path: "Projeto X/Plano.md", before: PROJETO.length });
    expect(r.copies.get(out.change!.copy!)).toBe(PROJETO);
  });

  test("o feito marca a caixa", async () => {
    const r = await rig();
    const list = (await r.call({ fazer: "achar", opcoes: { como: "agenda" } })).value as { items: { id: string }[] };
    await r.call({ fazer: "escrever", alvo: list.items[0]!.id, opcoes: { como: "remarcar", feito: true } });
    expect(r.read("Projeto X/Plano.md")).toContain("- [x] Revisar o orçamento");
  });

  test("a linha mudou por fora: E_CONFLICT, e a cópia é solta", async () => {
    const r = await rig();
    const list = (await r.call({ fazer: "achar", opcoes: { como: "agenda" } })).value as { items: { id: string }[] };
    writeFileSync(path.join(dirs[0]!, "Notas", "Projeto X/Plano.md"), "# Projeto X\n\n- [ ] Outra coisa @ 2026-11-27 10:00\n");
    await Bun.sleep(60);
    expect(await codeOf(r.call({ fazer: "escrever", alvo: list.items[0]!.id, opcoes: { como: "remarcar", inicio: "2026-11-28T10:00" } }))).toBe("E_CONFLICT");
    expect(r.dropped).toEqual(["copia-1"]);
  });

  test("a reunião gravada não muda, e um id estranho pede para ler de novo", async () => {
    const r = await rig();
    expect(await codeOf(r.call({ fazer: "escrever", alvo: "m:Reuniões/2026-11-26 Planejamento.md", opcoes: { como: "remarcar", inicio: "2026-11-28T10:00" } }))).toBe("E_READONLY");
    expect(await codeOf(r.call({ fazer: "escrever", alvo: "qualquer", opcoes: { como: "remarcar", feito: true } }))).toBe("E_BAD_ARGS");
  });
});

describe("a ferramenta única", () => {
  test("ida e volta: kiwiCallFor e resolveKiwiCall dão a mesma ação", () => {
    for (const [tool, args] of [
      ["calendar_list", { from: "2026-11-26", to: "2026-11-30" }],
      ["calendar_create", { title: "Ligar para a Ana", kind: "reminder", start: "2026-11-27T09:00", project: "Projeto X", notify: "10m" }],
      ["calendar_update", { id: "n:Projeto X/Plano.md#2:abcdef12", start: "2026-11-28T10:00", done: true, allDay: false }],
    ] as const) {
      const back = resolveKiwiCall(kiwiCallFor(tool, args));
      expect(back.tool).toBe(tool);
      expect(back.args).toEqual(args);
    }
  });

  test("o sinônimo agendar leva ao agendar", () => {
    expect(resolveKiwiCall({ fazer: "agendar", alvo: "Revisão", opcoes: { inicio: "2026-11-28T10:00", tipo: "meeting" } }).tool).toBe("calendar_create");
    expect(resolveKiwiCall({ fazer: "remarcar", alvo: "n:P/x.md#1:abcdef12", opcoes: { inicio: "2026-11-28T10:00" } }).tool).toBe("calendar_update");
  });

  test("o pedido sobre a agenda traz os cartões do agendar e do remarcar; outro pedido, não", () => {
    const tools = (t: string) => cardsFor(t).map((a) => a.tool);
    expect(tools("me lembra amanhã às 9h de ligar para a Ana")).toEqual(expect.arrayContaining(["calendar_create", "calendar_update"]));
    expect(tools("põe na agenda a revisão de sexta")).toContain("calendar_create");
    expect(tools("remarca a reunião do Projeto X para segunda")).toContain("calendar_update");
    expect(tools("resume a nota Ideias")).not.toContain("calendar_create");
    // Em inglês também (#34842): o "schedule" e o "remind me" abrem o agendar.
    expect(tools("schedule a 2 hour meeting tomorrow at 3pm")).toContain("calendar_create");
    expect(tools("remind me to call Ana at 9am")).toContain("calendar_create");
    expect(tools("summarize the Ideas note")).not.toContain("calendar_create");
  });

  test("o caminho de cada id", () => {
    expect(pathOfId("n:Projeto X/Plano.md#2:abcdef12")).toBe("Projeto X/Plano.md");
    expect(pathOfId("n:Projeto X/Plano.md#2:abcdef12~2026-11-27")).toBe("Projeto X/Plano.md");
    expect(pathOfId("f:Projeto X/Pauta.md")).toBe("Projeto X/Pauta.md");
    expect(pathOfId("m:Reuniões/x.md")).toBeNull();
  });
});

describe("o aviso livre e o pedido repetido (spec #34706, T34753)", () => {
  test("o aviso de 50 min: um item só, às 10:00 e sem fim; \"50 min\" vira 50m", async () => {
    const r = await rig();
    const out = await r.call({ fazer: "escrever", alvo: "Ligar para o Bruno", opcoes: { como: "agendar", tipo: "reminder", inicio: "2026-11-27T10:00", aviso: "50 min" } });
    const item = (out.value as { item: Record<string, unknown> }).item;
    expect(item).toMatchObject({ start: "2026-11-27T10:00", notify: "50m" });
    expect(item.end).toBeUndefined(); // sem fim: nunca das 9:10 às 10:00
    expect(r.read("Calendário.md")).toContain("- [ ] Ligar para o Bruno @ 2026-11-27 10:00 #lembrete 🔔 50m");
    const e = await r.call({ fazer: "escrever", alvo: "X", opcoes: { como: "agendar", tipo: "reminder", inicio: "2026-11-27T10:00", aviso: "uma semana" } }).catch((x) => x);
    expect(e.code).toBe("E_BAD_ARGS");
    expect(e.message).toContain("30 dias");
    // A frase inteira, sem um pedaço trocado (#34842).
    expect(e.message).toContain("notify: A antecedência: 50m, 2h, 3d");
  });

  test("o mesmo pedido de novo não cria outro item; com outro aviso, muda o aviso do mesmo", async () => {
    const r = await rig();
    const ask = (aviso: string, alvo = "Ligar para o Bruno") => r.call({ fazer: "escrever", alvo, opcoes: { como: "agendar", tipo: "reminder", inicio: "2026-11-27T10:00", aviso } });
    const a = await ask("50m");
    const b = await ask("50 min", "ligar para o bruno");
    expect((b.value as { item: { id: string } }).item.id).toBe((a.value as { item: { id: string } }).item.id);
    expect((b.value as { mudou: string }).mudou).toContain("já estava");
    expect(b.change).toBeUndefined();
    expect(r.read("Calendário.md").match(/Ligar para o Bruno/g)).toHaveLength(1);
    const c = await ask("1h");
    expect(c.tool).toBe("calendar_create");
    expect(c.change).toMatchObject({ kind: "replaced", path: "Calendário.md" });
    expect(r.read("Calendário.md").match(/Ligar para o Bruno/g)).toHaveLength(1);
    expect(r.read("Calendário.md")).toContain("🔔 1h");
    // Outro horário é outro item.
    await r.call({ fazer: "escrever", alvo: "Ligar para o Bruno", opcoes: { como: "agendar", tipo: "reminder", inicio: "2026-11-28T10:00" } });
    expect(r.read("Calendário.md").match(/Ligar para o Bruno/g)).toHaveLength(2);
  });

  test("o feito não segura o pedido novo: um item fechado com o mesmo título e hora não conta", async () => {
    const r = await rig({ "Calendário.md": "# Calendário\n\n- [x] Ligar para o Bruno @ 2026-11-27 10:00 #lembrete\n" });
    await r.call({ fazer: "escrever", alvo: "Ligar para o Bruno", opcoes: { como: "agendar", tipo: "reminder", inicio: "2026-11-27T10:00" } });
    expect(r.read("Calendário.md").match(/Ligar para o Bruno/g)).toHaveLength(2);
  });
});

describe("kiwi escrever/desmarcar (T34753)", () => {
  test("apaga a linha pelo id; a cópia de antes vai à Atividade para o Desfazer", async () => {
    const r = await rig();
    const list = (await r.call({ fazer: "achar", opcoes: { como: "agenda" } })).value as { items: { id: string; title: string }[] };
    const id = list.items.find((i) => i.title === "Ligar para a Ana")!.id;
    const out = await r.call({ fazer: "escrever", alvo: id, opcoes: { como: "desmarcar" } });
    expect(out.tool).toBe("calendar_delete");
    expect(out.value).toMatchObject({ apagou: id });
    expect(r.read("Projeto X/Plano.md")).toBe("# Projeto X\n\n- [ ] Revisar o orçamento @ 2026-11-27 10:00\n");
    expect(out.change).toMatchObject({ kind: "replaced", path: "Projeto X/Plano.md", before: PROJETO.length });
    expect(r.copies.get(out.change!.copy!)).toBe(PROJETO);
  });

  test("o item que o Kiwi criou também, e o sinônimo desmarcar", async () => {
    const r = await rig();
    const made = await r.call({ fazer: "escrever", alvo: "Ligar para o Bruno", opcoes: { como: "agendar", tipo: "reminder", inicio: "2026-11-27T10:00", aviso: "50m" } });
    const id = (made.value as { item: { id: string } }).item.id;
    expect(resolveKiwiCall({ fazer: "desmarcar", alvo: id }).tool).toBe("calendar_delete");
    await r.call({ fazer: "desmarcar", alvo: id });
    expect(r.read("Calendário.md")).not.toContain("Ligar para o Bruno");
  });

  test("a reunião gravada não se apaga; o id estranho e a sessão de leitura também não", async () => {
    const r = await rig();
    expect(await codeOf(r.call({ fazer: "escrever", alvo: "m:Reuniões/2026-11-26 Planejamento.md", opcoes: { como: "desmarcar" } }))).toBe("E_READONLY");
    expect(await codeOf(r.call({ fazer: "escrever", alvo: "qualquer", opcoes: { como: "desmarcar" } }))).toBe("E_BAD_ARGS");
    const list = (await r.call({ fazer: "achar", opcoes: { como: "agenda" } })).value as { items: { id: string }[] };
    expect(await codeOf(r.call({ fazer: "escrever", alvo: list.items[0]!.id, opcoes: { como: "desmarcar" } }, { writes: false, proposes: false, memory: false }))).toBe("E_NOT_ALLOWED");
    expect(r.read("Projeto X/Plano.md")).toBe(PROJETO);
  });

  test("o pedido de apagar traz o cartão do desmarcar; um apagar de nota, não", () => {
    const tools = (t: string) => cardsFor(t).map((a) => a.tool);
    for (const t of ["desmarca a reunião de sexta", "apaga o lembrete de ligar para o Bruno", "tira da agenda a revisão", "cancela o compromisso das 10h", "delete the reminder about Ana"]) expect(tools(t)).toContain("calendar_delete");
    expect(tools("apaga o parágrafo do fim da nota Ideias")).not.toContain("calendar_delete");
    expect(tools("me lembra às 10h de ligar para a Ana")).not.toContain("calendar_delete");
  });
});

describe("kiwi escrever: as repetições novas (spec #34706, T34775)", () => {
  test("agendar e remarcar aceitam as prontas, a palavra da linha e a regra; a forma curta vai para a nota", async () => {
    const r = await rig();
    await r.call({ fazer: "escrever", alvo: "Pagar a conta", opcoes: { como: "agendar", tipo: "reminder", inicio: "2026-11-30T09:00", projeto: "Projeto X", repetir: "monthly" } });
    await r.call({ fazer: "escrever", alvo: "Escrever", opcoes: { como: "agendar", tipo: "focus", inicio: "2026-11-30T08:00", projeto: "Projeto X", repetir: " 2W:we,mo/10x " } });
    await r.call({ fazer: "escrever", alvo: "Alongar", opcoes: { como: "agendar", tipo: "task", inicio: "2026-11-30", projeto: "Projeto X", repetir: "úteis" } });
    const p = r.read("Projeto X/Pendências.md");
    expect(p).toContain("Pagar a conta @ 2026-11-30 09:00 #lembrete 🔁 mês");
    expect(p).toContain("Escrever @ 2026-11-30 08:00 #foco 🔁 2w:mo,we/10x");
    expect(p).toContain("Alongar @ 2026-11-30 🔁 úteis");
    // O id muda com a linha: o achar/agenda de novo antes de cada remarcar.
    const idOf = async () => ((await r.call({ fazer: "achar", opcoes: { como: "agenda" } })).value as { items: { id: string; title: string }[] }).items.find((i) => i.title === "Revisar o orçamento")!.id;
    await r.call({ fazer: "escrever", alvo: await idOf(), opcoes: { como: "remarcar", repetir: "1y/2030-11-27" } });
    expect(r.read("Projeto X/Plano.md")).toContain("- [ ] Revisar o orçamento @ 2026-11-27 10:00 🔁 1y/2030-11-27");
    await r.call({ fazer: "escrever", alvo: await idOf(), opcoes: { como: "remarcar", repetir: null } });
    expect(r.read("Projeto X/Plano.md")).toContain("- [ ] Revisar o orçamento @ 2026-11-27 10:00\n");
  });

  test("a repetição que não vale: erro que ensina a forma, nada escrito", async () => {
    const r = await rig();
    for (const no of ["a cada 2 semanas", "0d", "1m:mo", "1d/0x"]) {
      const e = await r.call({ fazer: "escrever", alvo: "X", opcoes: { como: "agendar", tipo: "task", inicio: "2026-11-30", repetir: no } }).then(
        () => null,
        (err: Error & { code?: string }) => err,
      );
      expect([no, e?.code, e?.message]).toEqual([no, "E_BAD_ARGS", expect.stringContaining("repeat: daily, weekly, monthly, yearly, weekdays, ou a regra: 2w:mo,we")]);
    }
    expect(() => r.read("Calendário.md")).toThrow();
  });
});
