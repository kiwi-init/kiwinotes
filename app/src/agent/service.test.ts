// O agente dentro do app (spec #8339, T8678): o serviço que as capacidades `agent.*` chamam, com o agente falso, um
// registro do npm falso e local e os ajustes de verdade numa pasta tmp. Nada aqui abre o Claude Code nem vai à internet.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { AgentMemoryView, AgentStatus, AgentTurnEvent } from "../shared/ui-contract.ts";
import { SettingsStore, type AgentSettings } from "../store/settings.ts";
import { adapterRoot, agentDir } from "./adapter/open.ts";
import { fakeNotices } from "./fake/notices.ts";
import { FAKE_AGENT_COMMAND, FAKE_CLAUDE } from "./fake/index.ts";
import { fakeRegistry, type FakeRegistry } from "./fake/registry.ts";
import { AgentHost } from "./host.ts";
import { AgentService, AgentServiceError, cheapestModel, ECONOMY_INSTRUCTIONS, SUMMARY_ECONOMY_QUESTION } from "./service.ts";
import { DEFAULT_NOTE_MODEL, noteModelText, sanitizeNoteModel } from "./note-model.ts";
import { EMPTY_READER, type VaultReader } from "./tools/reader.ts";
import type { VaultWriter } from "./tools/writer.ts";
import { AgentActivity } from "./activity.ts";
import type { UndoNotes } from "./undo.ts";
import { createHash } from "node:crypto";
import { tempDir } from "../../test/tmp.ts";

const services: AgentService[] = [];
const registries: FakeRegistry[] = [];
afterEach(async () => {
  for (const s of services.splice(0)) await s.close();
  for (const r of registries.splice(0)) r.stop();
});

function tmp(): string {
  return tempDir("kiwi-agent-svc-");
}

/** Um registro com o "adaptador" (bytes aleatórios não comprimem: o .tgz tem ~256 KB). */
function registry(slow?: { chunk: number; delayMs: number }): FakeRegistry {
  const r = fakeRegistry(
    [
      { name: "@agentclientprotocol/claude-agent-acp", version: "0.106.0", files: { "dist/index.js": crypto.getRandomValues(new Uint8Array(64 * 1024)) } },
      { name: "zod", version: "4.6.7", files: { "blob.bin": crypto.getRandomValues(new Uint8Array(64 * 1024)) } },
    ],
    slow ? { slow } : {},
  );
  registries.push(r);
  return r;
}

interface Made {
  svc: AgentService;
  data: string;
  reg: FakeRegistry;
  statuses: AgentStatus[];
  turns: AgentTurnEvent[];
  claudeChecks: () => number;
  log: () => { method: string; params: Record<string, unknown> }[];
  pid: () => number | null;
}

function make(o: { data?: string; reg?: FakeRegistry; idleMs?: number; model?: string; host?: (dir: string) => AgentHost; reader?: VaultReader; writer?: VaultWriter; doubtTimeoutMs?: number } = {}): Made {
  const data = o.data ?? tmp();
  const reg = o.reg ?? registry();
  const store = new SettingsStore(data);
  let checks = 0;
  const logFile = path.join(data, "fake-agent.jsonl");
  const svc = new AgentService({
    data,
    settings: {
      load: async () => (await store.load()).agent,
      save: async (patch) => (await store.save({ agent: { ...(await store.load()).agent, ...patch } })).agent,
    },
    claude: () => {
      checks++;
      return FAKE_CLAUDE;
    },
    ...(o.reader ? { reader: o.reader } : {}),
    ...(o.writer ? { writer: o.writer } : {}),
    ...(o.doubtTimeoutMs ? { doubtTimeoutMs: o.doubtTimeoutMs } : {}),
    openHost: async ({ configOptions, kiwiTools, onExit }) =>
      o.host?.(agentDir(data)) ??
      new AgentHost({
        name: "Claude Code",
        command: FAKE_AGENT_COMMAND,
        dir: agentDir(data),
        configOptions,
        onExit,
        ...(kiwiTools ? { kiwiTools } : {}),
        env: { ...process.env, KIWI_FAKE_AGENT_LOG: logFile, ...(o.model ? { KIWI_FAKE_AGENT_MODEL: o.model } : {}) },
      }),
    registry: reg.url,
    packages: reg.pinned,
    idleMs: o.idleMs ?? 60_000,
  });
  services.push(svc);
  const statuses: AgentStatus[] = [];
  const turns: AgentTurnEvent[] = [];
  svc.onStatus((s) => statuses.push(s));
  svc.onTurn((e) => turns.push(e));
  return {
    svc,
    data,
    reg,
    statuses,
    turns,
    claudeChecks: () => checks,
    log: () =>
      existsSync(logFile)
        ? readFileSync(logFile, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { method: string; params: Record<string, unknown> })
        : [],
    pid: () => {
      const f = path.join(agentDir(data), "work", ".fake-agent.pid");
      return existsSync(f) ? Number(readFileSync(f, "utf8")) : null;
    },
  };
}

async function until<T>(get: () => T | undefined | null | false, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = get();
    if (v) return v;
    if (Date.now() > end) throw new Error("demorou demais");
    await Bun.sleep(10);
  }
}

async function rejection(p: Promise<unknown>): Promise<AgentServiceError> {
  try {
    await p;
  } catch (e) {
    return e as AgentServiceError;
  }
  throw new Error("era para falhar");
}

const alive = (pid: number | null) => {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Liga, baixa e espera o adaptador ficar pronto. */
async function readyNow(m: Made): Promise<void> {
  await m.svc.enable(true);
  await m.svc.startDownload();
  await until(() => m.statuses.some((s) => s.adapter.phase === "ready"));
}

/** Manda um pedido e espera o fim dele (done ou error). */
async function askAndWait(m: Made, text: string): Promise<AgentTurnEvent[]> {
  const { id } = await m.svc.ask(text);
  await until(() => m.turns.some((e) => e.id === id && (e.type === "done" || e.type === "error")));
  return m.turns.filter((e) => e.id === id);
}

describe("desligado, nada abre nem vai à rede", () => {
  test("de fábrica: desligado, sem aceite, e o estado sem refresh não confere nada", async () => {
    const m = make();
    const s = await m.svc.status();
    expect(s).toMatchObject({ name: "Claude Code", enabled: false, consented: false, claude: null, program: "closed", busy: false, model: "default", effort: "default", session: null });
    expect(s.adapter).toEqual({ version: "0.106.0", phase: "missing" });
    expect(m.claudeChecks()).toBe(0);
  });

  test("pedir e baixar desligado: E_AGENT_DISABLED, e nem o registro nem o agente foram chamados", async () => {
    const m = make();
    expect((await rejection(m.svc.ask("oi"))).code).toBe("E_AGENT_DISABLED");
    expect((await rejection(m.svc.startDownload())).code).toBe("E_AGENT_DISABLED");
    expect(m.reg.requests).toEqual([]);
    expect(m.log()).toEqual([]);
    expect(m.pid()).toBeNull();
  });

  test("ligar na primeira vez pede o aceite da tela do ADR 0011; ligar não baixa nem abre nada", async () => {
    const m = make();
    expect((await rejection(m.svc.enable())).code).toBe("E_AGENT_CONSENT");
    const s = await m.svc.enable(true);
    expect(s).toMatchObject({ enabled: true, consented: true, program: "closed" });
    expect(m.reg.requests).toEqual([]);
    expect(m.pid()).toBeNull();
    await m.svc.disable();
    expect((await m.svc.enable()).enabled).toBe(true); // a segunda vez não pede o aceite de novo
  });

  test("o refresh confere o Claude Code (a versão, o login e a régua), sem a conta", async () => {
    const m = make();
    const s = await m.svc.status(true);
    expect(s.claude).toEqual({ installed: true, version: "2.1.322", loggedIn: true, method: "claude.ai", versionOk: true });
    expect(m.claudeChecks()).toBe(1);
    expect(JSON.stringify(s)).not.toContain("exemplo");
  });
});

describe("o app lembra entre uma abertura e outra", () => {
  test("ligado, o aceite, o modelo e o esforço ficam nos ajustes; o adaptador baixado é achado no disco", async () => {
    const data = tmp();
    const first = make({ data });
    await readyNow(first);
    await first.svc.configure({ model: "opus", effort: "low" });
    await first.svc.close();
    const again = make({ data, reg: first.reg });
    expect(await again.svc.status()).toMatchObject({ enabled: true, consented: true, model: "opus", effort: "low", adapter: { phase: "ready" } });
  });
});

describe("o download", () => {
  test("o progresso em bytes, subindo até o total, e no fim pronto", async () => {
    const m = make({ reg: registry({ chunk: 8 * 1024, delayMs: 30 }) });
    await m.svc.enable(true);
    const started = await m.svc.startDownload();
    expect(started.adapter.phase).toBe("downloading");
    await until(() => m.statuses.some((s) => s.adapter.phase === "ready"));
    const steps = m.statuses.filter((s) => s.adapter.phase === "downloading").map((s) => s.adapter.done!);
    const total = m.reg.pinned.reduce((sum, p) => sum + p.size, 0);
    expect(m.statuses.find((s) => s.adapter.phase === "downloading")!.adapter.total).toBe(total);
    expect(steps.filter((d) => d > 0 && d < total).length).toBeGreaterThan(2);
    for (let i = 1; i < steps.length; i++) expect(steps[i]!).toBeGreaterThanOrEqual(steps[i - 1]!);
  });

  test("cancelar no meio apaga o que ficou pela metade, e o erro diz que foi cancelado", async () => {
    const m = make({ reg: registry({ chunk: 8 * 1024, delayMs: 30 }) });
    await m.svc.enable(true);
    await m.svc.startDownload();
    await until(() => m.statuses.some((s) => s.adapter.phase === "downloading" && (s.adapter.done ?? 0) > 0));
    await m.svc.cancel();
    const end = await until(() => m.statuses.find((s) => s.adapter.phase === "error"));
    expect(end.adapter.error).toEqual({ code: "E_ADAPTER_CANCELLED", message: "O download do adaptador do Claude Code foi cancelado. Nada foi instalado." });
    const root = adapterRoot(m.data);
    expect(existsSync(root) ? readdirSync(root) : []).toEqual([]);
  });
});

describe("o pedido, ao vivo", () => {
  test("volta logo com o id; a resposta chega em eventos: começou, abrindo, thinking, o texto e o fim", async () => {
    const m = make();
    await readyNow(m);
    const events = await askAndWait(m, "oi");
    expect(events.map((e) => e.type === "status" ? `status:${e.status}` : e.type)).toEqual([
      "started",
      "status:opening",
      "status:thinking",
      "text",
      "text",
      "done",
    ]);
    expect(events.at(-1)).toMatchObject({ type: "done", stopReason: "end_turn", text: 'Você disse: "oi". Este é o turno 1 desta sessão.' });
  });

  test("o programa abre no primeiro pedido e fica aberto: o segundo não abre de novo", async () => {
    const m = make();
    await readyNow(m);
    await askAndWait(m, "um");
    expect((await m.svc.status()).program).toBe("open");
    const second = await askAndWait(m, "dois");
    expect(second.some((e) => e.type === "status" && e.status === "opening")).toBe(false);
    expect(second.at(-1)).toMatchObject({ type: "done", text: expect.stringContaining("turno 2") });
    expect(m.log().filter((l) => l.method === "session/new")).toHaveLength(1);
  });

  test("cancelar termina o pedido com cancelled; um por vez", async () => {
    const m = make();
    await readyNow(m);
    const { id } = await m.svc.ask("/lento");
    expect((await rejection(m.svc.ask("outro"))).code).toBe("E_AGENT_BUSY");
    await until(() => m.turns.some((e) => e.id === id && e.type === "text"));
    await m.svc.cancel();
    const done = await until(() => m.turns.find((e) => e.id === id && e.type === "done"));
    expect(done).toMatchObject({ stopReason: "cancelled" });
    expect((await m.svc.status()).busy).toBe(false);
  });

  test("os erros do agente chegam no evento, com o código e a mensagem", async () => {
    const m = make();
    await readyNow(m);
    const events = await askAndWait(m, "/limite");
    expect(events.at(-1)).toMatchObject({ type: "error", code: "E_AGENT_LIMIT" });
  });

  test("sem o adaptador baixado: E_ADAPTER_MISSING antes de abrir qualquer coisa", async () => {
    const m = make();
    await m.svc.enable(true);
    expect((await rejection(m.svc.ask("oi"))).code).toBe("E_ADAPTER_MISSING");
    expect(m.pid()).toBeNull();
  });
});

describe("o modelo e o esforço são do app", () => {
  test("o agente abre com os do terminal (fable, high), e o app troca pelos dele antes do primeiro pedido", async () => {
    const m = make({ model: "fable" });
    await readyNow(m);
    await askAndWait(m, "oi");
    const sets = m.log().filter((l) => l.method === "session/set_config_option").map((l) => [l.params.configId, l.params.value]);
    expect(sets).toEqual([
      ["model", "default"],
      ["effort", "default"],
    ]);
    expect((await m.svc.status()).session).toEqual({ model: "default", effort: "default" });
  });

  test("trocar o modelo vale no próximo pedido, com o programa já aberto", async () => {
    const m = make();
    await readyNow(m);
    await askAndWait(m, "um");
    await m.svc.configure({ model: "opus" });
    await askAndWait(m, "dois");
    expect((await m.svc.status()).session).toEqual({ model: "opus", effort: "default" });
  });
});

describe("os modelos que o agente oferece (T8762)", () => {
  test("vazio até o programa abrir; depois, a lista do agente, que fica guardada para a próxima abertura do app", async () => {
    const data = tmp();
    const m = make({ data });
    expect((await m.svc.status()).models).toEqual([]);
    await readyNow(m);
    await askAndWait(m, "oi");
    const models = (await m.svc.status()).models;
    expect(models.map((x) => x.value)).toEqual(["default", "opus", "fable", "sonnet", "haiku"]);
    expect(models[0]).toEqual({ value: "default", name: "Default (recommended)", description: "Sonnet · o padrão da sua conta" });
    await m.svc.close();

    // O app abriu de novo: a lista está lá, sem abrir o programa.
    const again = make({ data, reg: m.reg });
    const st = await again.svc.status();
    expect(st.program).toBe("closed");
    expect(st.models.map((x) => x.value)).toEqual(["default", "opus", "fable", "sonnet", "haiku"]);
  });
});

describe("o programa do agente fecha", () => {
  test("ao desligar, na hora, e o processo some", async () => {
    const m = make();
    await readyNow(m);
    await askAndWait(m, "oi");
    const pid = m.pid();
    expect(alive(pid)).toBe(true);
    const s = await m.svc.disable();
    expect(s).toMatchObject({ enabled: false, program: "closed" });
    await until(() => !alive(pid));
  });

  test("desligar no meio de um pedido termina ele como cancelado", async () => {
    const m = make();
    await readyNow(m);
    const { id } = await m.svc.ask("/lento");
    await until(() => m.turns.some((e) => e.id === id && e.type === "text"));
    await m.svc.disable();
    expect(await until(() => m.turns.find((e) => e.id === id && (e.type === "done" || e.type === "error")))).toMatchObject({ type: "done", stopReason: "cancelled" });
  });

  test("depois do tempo sem uso, e o próximo pedido abre de novo e retoma a sessão", async () => {
    const m = make({ idleMs: 300 });
    await readyNow(m);
    await askAndWait(m, "um");
    const pid = m.pid();
    await until(() => !alive(pid), 5000);
    expect((await m.svc.status()).program).toBe("closed");
    const again = await askAndWait(m, "dois");
    expect(again.some((e) => e.type === "status" && e.status === "opening")).toBe(true);
    expect(again.at(-1)).toMatchObject({ type: "done", text: expect.stringContaining("turno 2") });
    expect(m.log().map((l) => l.method)).toContain("session/resume");
  });

  test("quando o app sai: o close() fecha e espera o processo sair", async () => {
    const m = make();
    await readyNow(m);
    await askAndWait(m, "oi");
    const pid = m.pid();
    await m.svc.close();
    expect(alive(pid)).toBe(false);
  });

  test("na saída do processo, o killNow() manda o SIGTERM na hora", async () => {
    const m = make();
    await readyNow(m);
    await askAndWait(m, "oi");
    const pid = m.pid();
    m.svc.killNow();
    await until(() => !alive(pid));
  });
});

describe("um agente que não responde ao abrir (revisão do T8678)", () => {
  /** No lugar do adaptador, um programa que nunca responde o `initialize`. */
  function hanging() {
    const hosts: AgentHost[] = [];
    const host = (dir: string) => {
      const h = new AgentHost({ name: "Claude Code", command: ["/bin/sleep", "30"], dir });
      hosts.push(h);
      return h;
    };
    return { host, pid: () => hosts.at(-1)?.pid ?? null };
  }

  test("o desligar volta logo, mata o programa que estava abrindo, e o pedido acaba cancelado", async () => {
    const hang = hanging();
    const m = make({ host: hang.host });
    await readyNow(m);
    const { id } = await m.svc.ask("oi");
    const pid = await until(() => hang.pid());
    expect(alive(pid)).toBe(true);
    expect((await m.svc.status()).program).toBe("opening");
    const t0 = Date.now();
    const s = await m.svc.disable();
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(s).toMatchObject({ enabled: false, program: "closed" });
    await until(() => !alive(pid));
    expect(await until(() => m.turns.find((e) => e.id === id && (e.type === "done" || e.type === "error")))).toMatchObject({ type: "done", stopReason: "cancelled" });
  });

  test("a saída do app (killNow) mata o programa que estava abrindo", async () => {
    const hang = hanging();
    const m = make({ host: hang.host });
    await readyNow(m);
    await m.svc.ask("oi");
    const pid = await until(() => hang.pid());
    m.svc.killNow();
    await until(() => !alive(pid));
  });

  test("o close() (o quit do app) também volta logo", async () => {
    const hang = hanging();
    const m = make({ host: hang.host });
    await readyNow(m);
    await m.svc.ask("oi");
    const pid = await until(() => hang.pid());
    const t0 = Date.now();
    await m.svc.close();
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(alive(pid)).toBe(false);
  });
});

describe("remover o adaptador", () => {
  test("fecha o programa e apaga o download; o próximo pedido diz que falta baixar", async () => {
    const m = make();
    await readyNow(m);
    await askAndWait(m, "oi");
    const pid = m.pid();
    const s = await m.svc.remove();
    expect(s).toMatchObject({ program: "closed", adapter: { phase: "missing" }, enabled: true });
    expect(existsSync(adapterRoot(m.data))).toBe(false);
    await until(() => !alive(pid));
    expect((await rejection(m.svc.ask("oi"))).code).toBe("E_ADAPTER_MISSING");
  });
});


/** Um cofre de mentira, na memória: a semântica das ferramentas é provada em `tools/tools.test.ts`. */
function memoryReader(notes: Record<string, string>): VaultReader {
  const meta = (p: string) => ({ path: p, title: path.basename(p, ".md"), folder: path.dirname(p) === "." ? "" : path.dirname(p), size: notes[p]!.length, mtime: "2026-11-12T00:00:00.000Z" });
  return {
    search: async (query) =>
      Object.keys(notes)
        .filter((p) => notes[p]!.toLowerCase().includes(query.toLowerCase()))
        .map((p) => ({ path: p, title: meta(p).title, snippet: notes[p]!.slice(0, 40) })),
    list: async () => ({ folders: [...new Set(Object.keys(notes).map((p) => meta(p).folder).filter(Boolean))], notes: Object.keys(notes).map(meta) }),
    get: async (p) => {
      if (!(p in notes)) throw Object.assign(new Error(`no note ${p}`), { code: "E_NOT_FOUND" });
      return { ...meta(p), content: notes[p]! };
    },
    meetings: async () => [],
    projects: EMPTY_READER.projects,
    projectStatus: EMPTY_READER.projectStatus,
  };
}

const NOTES = { "Projetos/Kiwi.md": "# Kiwi\n\n## Prazo\n\nO prazo do Kiwi é março.\n", "Ideias.md": "gatos" };

type KiwiServer = { type: string; name: string; url: string; headers: { name: string; value: string }[] };
const opened = (m: Made) =>
  m.log().filter((l) => l.method === "session/new" || l.method === "session/resume" || l.method === "session/load");

describe("as ferramentas do Kiwi (spec #7496)", () => {
  test("o agente recebe o servidor do Kiwi ao abrir a sessão, com a senha, e só as ferramentas dele são liberadas", async () => {
    const m = make({ reader: memoryReader(NOTES) });
    await readyNow(m);
    const turn = await askAndWait(m, "/ferramentas");
    expect(turn.at(-1)).toMatchObject({ type: "done", text: "ferramentas: notes_search, notes_outline, notes_read, notes_list, meetings_list, meetings_get, projects_list, project_status" });
    const params = opened(m)[0]!.params as { mcpServers: KiwiServer[]; _meta: { claudeCode: { options: Record<string, unknown> } } };
    expect(params.mcpServers).toHaveLength(1);
    expect(params.mcpServers[0]).toMatchObject({ type: "http", name: "kiwi" });
    expect(params.mcpServers[0]!.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    expect(params.mcpServers[0]!.headers[0]!.name).toBe("X-Kiwi-Token");
    const options = params._meta.claudeCode.options;
    expect(options.allowedTools).toEqual(["mcp__kiwi__*"]);
    // O isolamento continua: nenhuma ferramenta embutida, nenhuma configuração pessoal, só os servidores do Kiwi.
    expect(options).toMatchObject({ tools: [], settingSources: [], strictMcpConfig: true, allowDangerouslySkipPermissions: false });
  });

  test("sem o leitor do cofre, nenhum servidor vai e nada é liberado", async () => {
    const m = make();
    await readyNow(m);
    await askAndWait(m, "oi");
    const params = opened(m)[0]!.params as { mcpServers: unknown[]; _meta: { claudeCode: { options: Record<string, unknown> } } };
    expect(params.mcpServers).toEqual([]);
    expect(params._meta.claudeCode.options.allowedTools).toBeUndefined();
  });

  test("cada uso de ferramenta vira um status ao vivo, com o que foi lido", async () => {
    const m = make({ reader: memoryReader(NOTES) });
    await readyNow(m);
    const turn = await askAndWait(m, '/tool notes_read {"path":"Projetos/Kiwi.md"}');
    expect(turn).toContainEqual(expect.objectContaining({ type: "status", status: "running", tool: "notes_read", target: "Projetos/Kiwi.md" }));
    // O `tool_call` cru do agente (`mcp__kiwi__notes_read`) nunca aparece: no começo da ferramenta sai o nome limpo, sem o
    // que foi lido (spec #9510, o gato entra em `agindo`), e no fim o servidor manda o mesmo nome com o `target`; quando
    // ela acaba, o host volta a `thinking`.
    expect(turn.some((e) => e.type === "status" && e.status === "running" && e.tool.startsWith("mcp__kiwi__"))).toBe(false);
    const statuses = turn.filter((e) => e.type === "status").map((e) => (e.status === "running" ? `running:${e.tool}:${e.target ?? ""}` : e.status));
    const first = statuses.indexOf("running:notes_read:");
    expect(first).toBeGreaterThanOrEqual(0);
    expect(statuses.slice(first)).toEqual(expect.arrayContaining(["running:notes_read:Projetos/Kiwi.md", "thinking"]));
    expect(statuses.lastIndexOf("thinking")).toBeGreaterThan(statuses.indexOf("running:notes_read:Projetos/Kiwi.md"));
    expect((turn.at(-1) as { text: string }).text).toContain("O prazo do Kiwi é março.");
    const search = await askAndWait(m, '/tool notes_search {"query":"gatos"}');
    expect(search).toContainEqual(expect.objectContaining({ type: "status", status: "running", tool: "notes_search", target: '"gatos"' }));
  });

  test("o agente falso responde a uma pergunta sobre uma nota, procurando e lendo pelas ferramentas", async () => {
    const m = make({ reader: memoryReader(NOTES) });
    await readyNow(m);
    const turn = await askAndWait(m, "Qual é o prazo do Kiwi?");
    const done = turn.at(-1) as { type: string; text: string };
    expect(done.type).toBe("done");
    expect(done.text).toContain("Pela nota Projetos/Kiwi.md");
    expect(done.text).toContain("março");
    const used = turn.filter((e) => e.type === "status" && e.status === "running").map((e) => (e as { tool: string }).tool);
    expect(used).toEqual(expect.arrayContaining(["notes_search", "notes_read"]));
  });

  test("a permissão: a ferramenta do Kiwi é aceita, e qualquer outra continua recusada", async () => {
    const m = make({ reader: memoryReader(NOTES) });
    await readyNow(m);
    expect((await askAndWait(m, "/permissao-kiwi")).at(-1)).toMatchObject({ type: "done", text: "permissão: allow" });
    const bash = await askAndWait(m, "/permissao");
    expect(bash).toContainEqual(expect.objectContaining({ type: "permission", tool: "Bash", decision: "denied" }));
    expect(bash.at(-1)).toMatchObject({ type: "done", text: "permissão: reject" });
  });

  test("sem o leitor, nem a do Kiwi é aceita", async () => {
    const m = make();
    await readyNow(m);
    expect((await askAndWait(m, "/permissao-kiwi")).at(-1)).toMatchObject({ type: "done", text: "permissão: reject" });
  });

  test("o servidor só existe com o programa aberto: desligar fecha, e a próxima abertura vem com outra senha", async () => {
    const m = make({ reader: memoryReader(NOTES) });
    await readyNow(m);
    await askAndWait(m, "/ferramentas");
    const first = (opened(m)[0]!.params as { mcpServers: KiwiServer[] }).mcpServers[0]!;
    const call = (s: KiwiServer) =>
      fetch(s.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", [s.headers[0]!.name]: s.headers[0]!.value },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
    expect((await call(first)).status).toBe(200);
    await m.svc.disable();
    await expect(call(first)).rejects.toThrow(); // ninguém escuta mais
    await m.svc.enable();
    await askAndWait(m, "/ferramentas");
    const second = (opened(m).at(-1)!.params as { mcpServers: KiwiServer[] }).mcpServers[0]!;
    expect(second.headers[0]!.value).not.toBe(first.headers[0]!.value);
    // A senha velha não abre o servidor novo.
    expect((await call({ ...second, headers: first.headers })).status).toBe(401);
  });

  test("o servidor fecha também depois do tempo sem uso e na saída do app", async () => {
    const m = make({ reader: memoryReader(NOTES), idleMs: 150 });
    await readyNow(m);
    await askAndWait(m, "/ferramentas");
    const s = (opened(m)[0]!.params as { mcpServers: KiwiServer[] }).mcpServers[0]!;
    const ping = () =>
      fetch(s.url, { method: "POST", headers: { [s.headers[0]!.name]: s.headers[0]!.value }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) });
    expect((await ping()).status).toBe(200);
    const closed = async () => {
      for (const end = Date.now() + 5000; Date.now() < end; await Bun.sleep(20)) {
        if ((await m.svc.status()).program === "closed" && (await ping().then(() => false, () => true))) return true;
      }
      return false;
    };
    expect(await closed()).toBe(true);
    const m2 = make({ reader: memoryReader(NOTES) });
    await readyNow(m2);
    await askAndWait(m2, "/ferramentas");
    const s2 = (opened(m2)[0]!.params as { mcpServers: KiwiServer[] }).mcpServers[0]!;
    m2.svc.killNow();
    await expect(fetch(s2.url, { method: "POST", headers: { [s2.headers[0]!.name]: s2.headers[0]!.value }, body: "{}" })).rejects.toThrow();
  });
});

describe("o agente que cai sozinho não deixa o servidor aberto (revisão do T8956)", () => {
  test("depois do /cai, a senha velha não responde mais; a nova abertura tem outro servidor, e Desligar fecha tudo", async () => {
    const m = make({ reader: memoryReader(NOTES) });
    await readyNow(m);
    await askAndWait(m, "/ferramentas");
    const first = (opened(m)[0]!.params as { mcpServers: KiwiServer[] }).mcpServers[0]!;
    const ping = (s: KiwiServer) =>
      fetch(s.url, { method: "POST", headers: { [s.headers[0]!.name]: s.headers[0]!.value }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) }).then(
        (r) => r.status,
        () => "fechado",
      );
    expect(await ping(first)).toBe(200);
    const crash = await askAndWait(m, "/cai");
    expect(crash.at(-1)!.type).toBe("error");
    // Logo depois da queda, o servidor daquela abertura já fechou.
    expect(await ping(first)).toBe("fechado");
    await askAndWait(m, "/ferramentas");
    const second = (opened(m).at(-1)!.params as { mcpServers: KiwiServer[] }).mcpServers[0]!;
    expect(second.headers[0]!.value).not.toBe(first.headers[0]!.value);
    expect(await ping(first)).toBe("fechado");
    expect(await ping(second)).toBe(200);
    await m.svc.disable();
    expect(await ping(first)).toBe("fechado");
    expect(await ping(second)).toBe("fechado");
  });
});

/** O escritor de mentira, sobre o mesmo cofre na memória do `memoryReader` (a semântica está em `tools/write.test.ts`). */
const versionOf = (c: string) => createHash("sha256").update(c).digest("hex").slice(0, 16);
function memoryWriter(notes: Record<string, string>): VaultWriter {
  const note = (p: string) => ({ path: p, title: path.basename(p, ".md"), content: notes[p]!, version: versionOf(notes[p]!) });
  return {
    get: async (p) => {
      if (!(p in notes)) throw Object.assign(new Error(`no note ${p}`), { code: "E_NOT_FOUND" });
      return note(p);
    },
    save: async (p, content, base) => {
      if (versionOf(notes[p]!) !== base) return { saved: false };
      notes[p] = content;
      return { saved: true, path: p, version: versionOf(content) };
    },
    create: async (folder, title, content) => {
      const p = `${folder ? `${folder}/` : ""}${title}.md`;
      notes[p] = content;
      return note(p);
    },
    folder: async () => null,
  };
}

describe("a escrita e o registro do agente (spec #8356)", () => {
  test("com o escritor, as três de escrita aparecem; cada pedido entra no registro com o que leu e mudou, e a cópia de antes", async () => {
    const notes: Record<string, string> = { ...NOTES };
    const m = make({ reader: memoryReader(notes), writer: memoryWriter(notes) });
    await readyNow(m);
    expect((await askAndWait(m, "/ferramentas")).at(-1)).toMatchObject({
      type: "done",
      text: "ferramentas: notes_search, notes_outline, notes_read, notes_list, meetings_list, meetings_get, projects_list, project_status, notes_create, notes_append, notes_write, notes_organize_folder, meeting_propose, project_summary_propose",
    });
    await askAndWait(m, '/tool notes_read {"path":"Ideias.md"}');
    const turn = await askAndWait(m, '/tool notes_append {"path":"Ideias.md","text":"e cachorros"}');
    expect(notes["Ideias.md"]).toBe("gatos\ne cachorros\n");
    // A escrita aparece no status ao vivo, como a leitura.
    expect(turn).toContainEqual(expect.objectContaining({ type: "status", status: "running", tool: "notes_append", target: "Ideias.md" }));
    const log = await m.svc.activityLog();
    expect(log.map((r) => r.request)).toEqual(['/tool notes_append {"path":"Ideias.md","text":"e cachorros"}', '/tool notes_read {"path":"Ideias.md"}', "/ferramentas"]);
    expect(log[1]!.reads).toEqual([expect.objectContaining({ tool: "notes_read", target: "Ideias.md" })]);
    expect(log[0]!.changes).toEqual([
      expect.objectContaining({ kind: "appended", path: "Ideias.md", before: 5, after: 18, version: versionOf("gatos\ne cachorros\n") }),
    ]);
    // A cópia de antes está no registro, nos dados do app, e o registro é o mesmo que a CLI lê.
    const copy = log[0]!.changes[0]!.copy!;
    const fromDisk = new AgentActivity({ dir: path.join(agentDir(m.data), "activity") });
    expect(await fromDisk.copy(copy)).toBe("gatos");
    expect((await fromDisk.list()).map((r) => r.id)).toEqual(log.map((r) => r.id));
  });

  test("uma escrita recusada não entra no registro, e não deixa cópia", async () => {
    const notes: Record<string, string> = { ...NOTES };
    const m = make({ reader: memoryReader(notes), writer: memoryWriter(notes) });
    await readyNow(m);
    const turn = await askAndWait(m, '/tool notes_write {"path":"Ideias.md","text":"x","version":"velha"}');
    expect((turn.at(-1) as { text: string }).text).toMatch(/^erro da ferramenta: E_CHANGED/);
    expect(notes["Ideias.md"]).toBe("gatos");
    const [r] = await m.svc.activityLog();
    expect(r!.changes).toEqual([]);
    const dir = path.join(agentDir(m.data), "activity");
    expect(readdirSync(path.join(dir, readdirSync(dir)[0]!))).toEqual(["request.json"]);
  });

  test("o desfazer (spec #9353): sem o agente ligado, um por vez, e sem as notas do desfazer é E_NO_UNDO", async () => {
    const notes: Record<string, string> = { ...NOTES };
    const m = make({ reader: memoryReader(notes), writer: memoryWriter(notes) });
    await readyNow(m);
    await askAndWait(m, '/tool notes_append {"path":"Ideias.md","text":"e cachorros"}');
    const [r] = await m.svc.activityLog();
    await expect(m.svc.undo(r!.id)).rejects.toMatchObject({ code: "E_NO_UNDO" });
    await expect(m.svc.changeView(r!.id, 1)).rejects.toMatchObject({ code: "E_NO_UNDO" });
    const seen: string[] = [];
    const off = m.svc.onActivity((id) => seen.push(id));
    const undoNotes: UndoNotes = {
      folder: async () => null,
      get: async (p) => (notes[p] === undefined ? null : { content: notes[p]!, version: versionOf(notes[p]!) }),
      save: async (p, content, base) => {
        if (notes[p] === undefined || versionOf(notes[p]!) !== base) return false;
        notes[p] = content;
        return true;
      },
      trash: async () => "gone",
    };
    m.svc.useUndo(undoNotes);
    const pid = m.pid();
    expect((await m.svc.disable()).program).toBe("closed");
    await until(() => !alive(pid));
    // Dois ao mesmo tempo: um volta a nota, o outro vê que já foi.
    const both = await Promise.all([m.svc.undo(r!.id), m.svc.undo(r!.id)]);
    expect(both.map((x) => x.notes[0]!.result).sort()).toEqual(["already", "restored"]);
    expect(notes["Ideias.md"]).toBe("gatos");
    // O registro avisou o desfazer (spec #9480), e o [Ver] mostra o antes, também com o agente desligado.
    expect(seen).toEqual([r!.id]);
    off();
    expect(await m.svc.changeView(r!.id, 1)).toMatchObject({ before: "gatos", state: "undone" });
    await expect(m.svc.changeView("nao-existe", 1)).rejects.toMatchObject({ code: "E_NOT_FOUND" });
    // Nada abriu o programa do agente de novo.
    expect(m.pid()).toBe(pid);
    expect(alive(pid)).toBe(false);
    expect((await m.svc.status()).program).toBe("closed");
    await expect(m.svc.undo("nao-existe")).rejects.toMatchObject({ code: "E_NOT_FOUND" });
  });

  test("sem o escritor, só as oito de leitura", async () => {
    const m = make({ reader: memoryReader(NOTES) });
    await readyNow(m);
    expect((await askAndWait(m, "/ferramentas")).at(-1)).toMatchObject({ text: "ferramentas: notes_search, notes_outline, notes_read, notes_list, meetings_list, meetings_get, projects_list, project_status" });
    expect((await askAndWait(m, '/tool notes_append {"path":"Ideias.md","text":"x"}')).at(-1)).toMatchObject({ text: expect.stringContaining("não tem a ferramenta") });
  });

  test("o filtro do guardrail (spec #9818): o pedido e as leituras saem sem o segredo, e a escrita o põe de volta", async () => {
    const GH = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";
    const notes: Record<string, string> = { ...NOTES, "Acessos.md": `# Acessos\n\ntoken: ${GH}\n` };
    const m = make({ reader: memoryReader(notes), writer: memoryWriter(notes) });
    await readyNow(m);
    // O pedido com um token colado: o agente recebe o marcador, e o registro guarda o pedido já filtrado.
    const said = (await askAndWait(m, `Guarde o token ${GH} na nota`)).at(-1) as { text: string };
    expect(said.text).not.toContain(GH);
    expect(said.text).toMatch(/‹segredo \d+ · [a-z0-9]{4}›/);
    // A leitura: o agente vê o marcador, e o registro conta.
    const read = (await askAndWait(m, '/tool notes_read {"path":"Acessos.md"}')).at(-1) as { text: string };
    expect(read.text).not.toContain(GH);
    const marker = /‹segredo \d+ · [a-z0-9]{4}›/.exec(read.text)![0];
    // A escrita com o marcador da própria nota: o original volta.
    await askAndWait(m, `/tool notes_append ${JSON.stringify({ path: "Acessos.md", text: `de novo: ${marker}` })}`);
    expect(notes["Acessos.md"]).toContain(`de novo: ${GH}`);
    const log = await m.svc.activityLog();
    const asked = log.find((r) => r.request.startsWith("Guarde o token"))!;
    expect(asked.request).not.toContain(GH);
    expect(asked.requestHeld).toBe(1);
    expect(log.find((r) => r.reads.some((x) => x.tool === "notes_read"))!.reads[0]!.held).toBe(1);
    // O segredo não está em nenhuma linha do registro no disco (a cópia de antes é a exceção, e fica fora daqui).
    const dir = path.join(agentDir(m.data), "activity");
    for (const f of new Bun.Glob("*/request.json").scanSync(dir)) expect(readFileSync(path.join(dir, f), "utf8")).not.toContain(GH);
  });

  test("a pergunta na dúvida (spec #9873): o pedido espera, Pode mandar entrega o trecho, a resposta fica lembrada, e o prazo segura", async () => {
    const DOUBT = "Qx7Lm2Vb9Rt4Wz8Np3Kd6Hs1Fg5Jc0Ya";
    const notes: Record<string, string> = { ...NOTES, "Notas.md": `anotei ${DOUBT} aqui\n` };
    const m = make({ reader: memoryReader(notes), writer: memoryWriter(notes), doubtTimeoutMs: 600 });
    await readyNow(m);
    const read = '/tool notes_read {"path":"Notas.md"}';
    // O pedido espera a pessoa: o status diz, e o cartão tem o trecho e a nota.
    const { id } = await m.svc.ask(read);
    await until(() => m.turns.some((e) => e.id === id && e.type === "status" && e.status === "waiting" && e.target === "Notas.md"));
    const card = m.svc.question()!;
    expect(card.items).toEqual([expect.objectContaining({ value: DOUBT, path: "Notas.md" })]);
    await m.svc.answerDoubt({ card: card.id, fingerprint: card.items[0]!.fingerprint, answer: "send" });
    await until(() => m.turns.some((e) => e.id === id && e.type === "done"));
    expect((m.turns.findLast((e) => e.id === id && e.type === "done") as { text: string }).text).toContain(DOUBT);
    // De novo: não pergunta, e passa.
    const again = await askAndWait(m, read);
    expect(again.some((e) => e.type === "status" && e.status === "waiting")).toBe(false);
    expect((again.at(-1) as { text: string }).text).toContain(DOUBT);
    expect(m.svc.answersList()).toEqual([expect.objectContaining({ answer: "send" })]);
    // Esquecida a resposta e sem resposta no prazo: o trecho é segurado, o pedido segue, e a dúvida fica pendente.
    expect(m.svc.forgetAnswer(card.items[0]!.fingerprint)).toBe(true);
    const timeout = await askAndWait(m, read);
    expect((timeout.at(-1) as { type: string; text: string }).type).toBe("done");
    expect((timeout.at(-1) as { text: string }).text).not.toContain(DOUBT);
    await until(async () => (await m.svc.activityLog())[0]!.doubts?.length === 1);
    const [last] = await m.svc.activityLog();
    expect(JSON.stringify(last)).not.toContain(DOUBT);
    // A pessoa responde depois, na Atividade, pela impressão digital.
    await m.svc.answerDoubt({ request: last!.id, fingerprint: last!.doubts![0]!.fingerprint, answer: "hold" });
    expect(m.svc.answersList()).toEqual([expect.objectContaining({ answer: "hold" })]);
    expect((await m.svc.activityLog())[0]!.doubts![0]!.answered).toBe("hold");
    // O trecho não está em nenhum arquivo do registro nem das respostas.
    const dir = agentDir(m.data);
    for (const f of new Bun.Glob("**/*.json").scanSync(dir)) expect(readFileSync(path.join(dir, f), "utf8")).not.toContain(DOUBT);
  });

  test("a notificação quando o agente espera (spec #9839): uma por cartão, sem o trecho, sai na resposta e no prazo; o clique traz a janela", async () => {
    const A = "Qx7Lm2Vb9Rt4Wz8Np3Kd6Hs1Fg5Jc0Ya";
    const B = "Zp4Rt8Kw2Mn6Vb1Xc5Hj9Ld3Fs7Gq0Ue";
    const notes: Record<string, string> = { ...NOTES, "Projetos/Kiwi.md": `um ${A} e outro ${B}\n`, "Outra.md": `só ${A}\n` };
    const m = make({ reader: memoryReader(notes), writer: memoryWriter(notes), doubtTimeoutMs: 600 });
    const notices = fakeNotices({ permission: "allowed" });
    let inView = false;
    let shows = 0;
    m.svc.attachNotice({ notices, inView: () => inView, show: () => void shows++ });
    await readyNow(m);
    // Duas dúvidas na mesma leitura, com a janela fora da vista: um cartão, uma notificação, com a nota e sem os trechos.
    const { id } = await m.svc.ask('/tool notes_read {"path":"Projetos/Kiwi.md"}');
    await until(() => m.turns.some((e) => e.id === id && e.type === "status" && e.status === "waiting"));
    const card = m.svc.question()!;
    expect(card.items.length).toBe(2);
    await until(() => notices.calls.length > 0);
    expect(notices.calls).toEqual([
      { op: "post", id: `kiwi.doubt.${card.id}`, title: "O agente espera uma resposta sua", body: "Dúvida em Projetos/Kiwi. Clique para responder." },
    ]);
    // Responder um trecho não repete a notificação; o clique traz a janela.
    await m.svc.answerDoubt({ card: card.id, fingerprint: card.items[0]!.fingerprint, answer: "hold" });
    m.svc.noticeResponse({ id: `kiwi.doubt.${card.id}`, action: "default" });
    expect(shows).toBe(1);
    // Responder o último fecha o cartão e retira a notificação.
    await m.svc.answerDoubt({ card: card.id, fingerprint: card.items[1]!.fingerprint, answer: "hold" });
    await until(() => m.turns.some((e) => e.id === id && e.type === "done"));
    await until(() => notices.calls.some((c) => c.op === "remove"));
    expect(notices.calls.map((c) => c.op)).toEqual(["post", "remove"]);
    // Sem resposta no prazo: a notificação também sai.
    await m.svc.forgetAnswer(card.items[0]!.fingerprint);
    const late = await askAndWait(m, '/tool notes_read {"path":"Outra.md"}');
    expect(late.at(-1)!.type).toBe("done");
    await until(() => notices.calls.length === 4);
    expect(notices.calls.slice(2).map((c) => c.op)).toEqual(["post", "remove"]);
    // Com a janela na vista: nada.
    inView = true;
    const seen = await askAndWait(m, '/tool notes_read {"path":"Outra.md"}');
    expect(seen.some((e) => e.type === "status" && e.status === "waiting")).toBe(true);
    expect(notices.calls.length).toBe(4);
    // Nenhum trecho em nenhum pedido de notificação, e nada pediu a permissão.
    expect(JSON.stringify(notices.calls)).not.toContain(A);
    expect(JSON.stringify(notices.calls)).not.toContain(B);
    expect(notices.calls.some((c) => c.op === "request")).toBe(false);
  });

  test("a linha de Ajustes (spec #9839): sem o aviso ligado ao app a permissão é unavailable; o liga/desliga fica nas settings", async () => {
    const m = make();
    expect(await m.svc.noticeState()).toEqual({ permission: "unavailable", enabled: true });
    expect(await m.svc.noticeAllow()).toEqual({ permission: "unavailable", enabled: true });
    expect(await m.svc.noticeSet(false)).toEqual({ permission: "unavailable", enabled: false });
    const notices = fakeNotices({ permission: "notDetermined" });
    const changes: unknown[] = [];
    m.svc.onNoticeChanged((s) => changes.push(s));
    m.svc.attachNotice({ notices, inView: () => false, show: () => {} });
    expect(await m.svc.noticeState()).toEqual({ permission: "notDetermined", enabled: false });
    await m.svc.noticeAllow();
    await until(() => changes.length > 0);
    expect(changes).toEqual([{ permission: "allowed", enabled: false }]);
    expect(await m.svc.noticeSet(true)).toEqual({ permission: "allowed", enabled: true });
    expect(notices.calls).toEqual([{ op: "request" }]);
  });

  test("o medidor (spec #11084): o gasto que o agente informa por pedido, os mais caros e o cache, sem dinheiro", async () => {
    const m = make();
    await readyNow(m);
    const usage: unknown[] = [];
    m.svc.onUsageChanged((v) => usage.push(v));
    await askAndWait(m, "Primeiro pedido, curto");
    await askAndWait(m, `Segundo pedido, bem mais longo: ${"palavra ".repeat(200)}`);
    const v = m.svc.usageView();
    expect(v.fiveHours.requests).toBe(2);
    expect(v.week.requests).toBe(2);
    expect(v.fiveHours.cacheRead).toBe(6000);
    expect(v.top[0]!.question.startsWith("Segundo pedido")).toBe(true);
    expect(v.top[0]!.tokens).toBeGreaterThan(v.top[1]!.tokens);
    expect(usage.length).toBe(2);
    expect(JSON.stringify(v)).not.toMatch(/cost|usd/i);
    // "Apagar o gasto guardado": só o gasto; o registro do agente fica.
    expect(m.svc.usageClear().week.requests).toBe(0);
    expect((await m.svc.activityLog()).length).toBe(2);
  });

  test("o aviso do próprio agente (allowed_warning) vai ao balão uma vez por janela, sem parar o pedido", async () => {
    const m = make();
    await readyNow(m);
    const first = await askAndWait(m, "/aviso");
    expect(first.filter((e) => e.type === "limit")).toEqual([expect.objectContaining({ type: "limit", status: "warning", percent: 82 })]);
    expect(first.at(-1)).toMatchObject({ type: "done", stopReason: "end_turn", text: "Começando. E terminando." });
    const second = await askAndWait(m, "/aviso");
    expect(second.some((e) => e.type === "limit")).toBe(false);
    expect(m.svc.usageView().limit).toMatchObject({ status: "allowed_warning", window: "five_hour", percent: 82 });
  });

  test("o limite acabado: a hora de volta do agente (rateLimit ou a frase do erro); sem ela, só que acabou", async () => {
    const m = make();
    await readyNow(m);
    const withTime = await askAndWait(m, "/limite-com-hora");
    const out = withTime.find((e) => e.type === "limit") as { status: string; resetsAt?: string };
    expect(out.status).toBe("out");
    expect(Date.parse(out.resetsAt!)).toBeGreaterThan(Date.now() + 2.5 * 3_600_000);
    expect(withTime.at(-1)).toMatchObject({ type: "error", code: "E_AGENT_LIMIT" });
    expect(m.svc.usageView().out!.resetsAt).toBe(out.resetsAt);
    // A frase da mensagem ("will reset at 5pm") também vale.
    const m2 = make();
    await readyNow(m2);
    const phrase = await askAndWait(m2, "/limite");
    const o2 = phrase.find((e) => e.type === "limit") as { resetsAt?: string };
    expect(new Date(o2.resetsAt!).getHours()).toBe(17);
  });

  test("o /usage só sob demanda: fica fora do registro, sem evento de pedido, e mostra as janelas da assinatura", async () => {
    const m = make();
    await readyNow(m);
    const before = m.turns.length;
    const v = await m.svc.usageRefresh();
    expect(v.subscription).toMatchObject({ fiveHour: { percent: 37 }, week: { percent: 12 } });
    // A hora de volta veio e é uma data. A hora exata é do `usage.test.ts`: aqui o `bun test` roda em UTC e o agente
    // falso, noutro processo, no fuso do Mac (no app de verdade os dois estão no mesmo fuso).
    expect(Number.isFinite(Date.parse(v.subscription!.fiveHour!.resetsAt!))).toBe(true);
    expect(m.turns.length).toBe(before);
    expect(await m.svc.activityLog()).toEqual([]);
    expect(v.week.requests).toBe(0);
  });

  test("com o agente falso, uma nota criada segue a ordem e os blocos do modelo, e organizar uma nota passa pelo [Desfazer] (spec #11102)", async () => {
    const notes: Record<string, string> = { "Ideias.md": "# Ideias\n\nGatos dormem muito.\nO Kiwi anota.\n" };
    // O leitor com a versão, como o de verdade: o notes_write pede a versão que o notes_read devolveu.
    const base = memoryReader(notes);
    const reader: VaultReader = { ...base, get: async (p) => ({ ...(await base.get(p)), version: versionOf(notes[p]!) }) };
    const m = make({ reader, writer: memoryWriter(notes) });
    await readyNow(m);
    // O modelo da pessoa: a introdução antes do título, sem o sumário nem as propriedades, e o corpo em tópicos.
    m.svc.useNoteModel(async () =>
      sanitizeNoteModel({
        blocks: [
          { block: "introducao", on: true },
          { block: "titulo", on: true },
          { block: "corpo", on: true },
          { block: "fechamento", on: true },
          { block: "sumario", on: false },
          { block: "propriedades", on: false },
        ],
        body: "topicos",
      }),
    );
    await askAndWait(m, "/nota-modelo Viagem");
    const created = Object.keys(notes).find((p) => p.includes("Viagem"))!;
    const text = notes[created]!;
    const at = (s: string) => text.indexOf(s);
    expect(at("Esta nota resume")).toBeLessThan(at("# Viagem"));
    expect(at("# Viagem")).toBeLessThan(at("## Assunto"));
    expect(at("## Assunto")).toBeLessThan(at("## Próximos passos"));
    expect(text).not.toContain("## Sumário");
    expect(text).not.toContain("tags:");
    expect(text).toContain("- Primeira parte do assunto.");
    // Organizar uma nota que já existe: no modelo, sem perder o conteúdo, e com o [Desfazer] no registro.
    const org = (await askAndWait(m, "/organiza Ideias.md")).at(-1) as { text: string };
    expect(org.text).toBe("Organizei Ideias.md no Modelo de nota.");
    expect(notes["Ideias.md"]).toContain("- Gatos dormem muito.");
    expect(notes["Ideias.md"]).toContain("- O Kiwi anota.");
    expect(notes["Ideias.md"]!.indexOf("Esta nota resume")).toBeLessThan(notes["Ideias.md"]!.indexOf("# Ideias"));
    const [r] = await m.svc.activityLog();
    expect(r!.changes.map((c) => c.path)).toContain("Ideias.md");
    const undoNotes: UndoNotes = {
      folder: async () => null,
      get: async (p) => (notes[p] === undefined ? null : { content: notes[p]!, version: versionOf(notes[p]!) }),
      save: async (p, content, base) => {
        if (notes[p] === undefined || versionOf(notes[p]!) !== base) return false;
        notes[p] = content;
        return true;
      },
      trash: async () => "gone",
    };
    m.svc.useUndo(undoNotes);
    const back = await m.svc.undo(r!.id);
    expect(back.notes[0]!.result).toBe("restored");
    expect(notes["Ideias.md"]).toBe("# Ideias\n\nGatos dormem muito.\nO Kiwi anota.\n");
  });

  test("o Modelo de nota (spec #11102) vai no começo fixo do pedido, com os mesmos bytes entre dois pedidos com o mesmo modelo", async () => {
    const m = make();
    await readyNow(m);
    let model = sanitizeNoteModel({ ...DEFAULT_NOTE_MODEL, body: "topicos" });
    m.svc.useNoteModel(async () => model);
    await askAndWait(m, "oi");
    await askAndWait(m, "outra coisa");
    const prompts = () => m.log().filter((l) => l.method === "session/prompt").map((l) => (l.params.prompt as { text: string }[])[0]!.text);
    const [a, b] = prompts().slice(-2);
    const fixed = noteModelText(model);
    expect(a!.startsWith(fixed)).toBe(true);
    expect(b!.startsWith(fixed)).toBe(true);
    expect(a!.slice(fixed.length)).toBe("oi");
    // Com o modo econômico, o modelo vem antes, e as instruções econômicas depois: os dois sempre na mesma ordem.
    await m.svc.configure({ economy: true });
    await askAndWait(m, "oi");
    expect(prompts().at(-1)).toBe(fixed + ECONOMY_INSTRUCTIONS + "oi");
    // Mudar o modelo muda o começo fixo (vale para o que vem depois); um erro ao ler não derruba o pedido.
    model = sanitizeNoteModel({ ...DEFAULT_NOTE_MODEL, numbered: true });
    await askAndWait(m, "oi");
    expect(prompts().at(-1)!.startsWith(noteModelText(model))).toBe(true);
    m.svc.useNoteModel(async () => { throw new Error("sem cofre"); });
    await askAndWait(m, "oi");
    expect(prompts().at(-1)).toBe(ECONOMY_INSTRUCTIONS + "oi");
  });

  test("o modo econômico (spec #11084): as instruções e a lista das ferramentas idênticas, byte a byte, entre dois pedidos", async () => {
    const notes: Record<string, string> = { ...NOTES, "Longa.md": `# Longa\n\n## Um\n\n${"um texto ".repeat(600)}\n\n## Dois\n\n${"outro texto ".repeat(600)}\n` };
    const m = make({ reader: memoryReader(notes), writer: memoryWriter(notes) });
    await readyNow(m);
    const plain = (await askAndWait(m, "/ferramentas-cru")).at(-1) as { text: string };
    expect((await m.svc.configure({ economy: true })).economy).toBe(true);
    const a = (await askAndWait(m, "/ferramentas-cru")).at(-1) as { text: string };
    const b = (await askAndWait(m, "/ferramentas-cru")).at(-1) as { text: string };
    // A lista das ferramentas é a mesma nos dois pedidos, e a mesma sem o modo econômico (as descrições não mudam).
    expect(a.text).toBe(b.text);
    expect(a.text).toBe(plain.text);
    // As instruções vão na frente, com os mesmos bytes, nos dois pedidos.
    const prompts = m.log().filter((l) => l.method === "session/prompt").map((l) => (l.params.prompt as { text: string }[])[0]!.text);
    const eco = prompts.slice(-2);
    for (const p of eco) expect(p.startsWith(ECONOMY_INSTRUCTIONS)).toBe(true);
    expect(eco[0]!.slice(0, ECONOMY_INSTRUCTIONS.length)).toBe(eco[1]!.slice(0, ECONOMY_INSTRUCTIONS.length));
    expect(prompts[0]!.startsWith("[Modo econômico")).toBe(false);
    // A nota longa, sem seção: o sumário e o "há mais", nunca a nota inteira; com a seção, em pedaços menores.
    const read = (await askAndWait(m, '/tool notes_read {"path":"Longa.md"}')).at(-1) as { text: string };
    expect(read.text).toContain("Modo econômico: a nota é longa");
    expect(read.text).toContain('"titulo":"Um"');
    expect(read.text).not.toContain("um texto um texto um texto");
    const sec = (await askAndWait(m, '/tool notes_read {"path":"Longa.md","section":"Um"}')).at(-1) as { text: string };
    expect(sec.text).toContain('"proximoOffset"');
    // Desligado, volta ao de sempre: sem instruções e a nota inteira (até o teto normal).
    await m.svc.configure({ economy: false });
    const full = (await askAndWait(m, '/tool notes_read {"path":"Longa.md"}')).at(-1) as { text: string };
    expect(full.text).toContain("um texto um texto");
    expect(m.log().filter((l) => l.method === "session/prompt").at(-1)!.params.prompt).not.toMatchObject([{ text: expect.stringContaining("Modo econômico") }]);
  });

  test("o modelo mais barato que o agente oferece: Haiku, depois Sonnet; sem nenhum, nada muda", () => {
    expect(cheapestModel([{ value: "default", name: "Padrão" }, { value: "opus", name: "Opus" }, { value: "haiku", name: "Haiku" }])).toBe("haiku");
    expect(cheapestModel([{ value: "opus", name: "Opus" }, { value: "claude-sonnet-5", name: "Sonnet 5" }])).toBe("claude-sonnet-5");
    expect(cheapestModel([{ value: "default", name: "Padrão" }])).toBeNull();
  });
});

describe("a reunião vira nota do projeto (spec #8360)", () => {
  const MEETING_PATH = "Reuniões/2026-11-11 10h00 Zoom.md";
  // A transcrição de teste: nunca uma reunião de verdade.
  const MEETING_NOTE = "---\ntype: meeting\ndate: 2026-11-11\n---\n\n## Transcrição\n\n**Ana** (00:00): Vamos começar pelo arquivo de 2019.\n";
  // Uma segunda reunião de teste, com um segredo dito na transcrição: o guardrail o segura antes de ir ao agente.
  const SECRET = "ghp_0123456789abcdefghijABCDEFGHIJ012345";
  const MEETING2_PATH = "Reuniões/2026-11-11 15h00 Meet.md";
  const MEETING2_NOTE = `---\ntype: meeting\ndate: 2026-11-11\n---\n\n## Transcrição\n\n**Bruno** (00:00): O token do CI é ${SECRET}.\n`;
  const MAIN = "Projetos/Migração/Migração.md";
  const MAIN_TEXT = "# Migração\n\n## Pendências\n\n- [ ] Pedir o acesso\n";
  const project = (folder: string, name: string, main: string | null) => ({ folder, name, main, updated: null, notes: 1 });
  function vault(projects: ReturnType<typeof project>[]) {
    const notes: Record<string, string> = { ...NOTES, [MEETING_PATH]: MEETING_NOTE, [MEETING2_PATH]: MEETING2_NOTE, [MAIN]: MAIN_TEXT };
    const reader: VaultReader = {
      ...memoryReader(notes),
      meetings: async () => [
        { path: MEETING_PATH, title: "2026-11-11 10h00 Zoom", date: "2026-11-11", start: null, end: null, duration: 1800, app: "Zoom", participants: ["Ana"], live: false, mtime: "2026-11-11T11:00:00.000Z" },
        { path: MEETING2_PATH, title: "2026-11-11 15h00 Meet", date: "2026-11-11", start: null, end: null, duration: 900, app: "Meet", participants: ["Bruno"], live: false, mtime: "2026-11-11T15:20:00.000Z" },
      ],
      projects: async () => projects,
    };
    return { notes, reader, writer: memoryWriter(notes) };
  }
  const ASK = "atualiza o projeto com a reunião que eu acabei de ter";
  const NOTE = "Projetos/Migração/2026-11-11 · Cronograma da migração.md";

  test("a pedido: a proposta fica pendente sem escrever nada; [Ver] mostra a nota nova e a diferença; [Aplicar] escreve as duas, com [Desfazer]", async () => {
    const v = vault([project("Projetos/Migração", "Migração", MAIN)]);
    const m = make({ reader: v.reader, writer: v.writer });
    const events: unknown[] = [];
    m.svc.onProposalsChanged((list) => events.push(list.map((p) => p.status)));
    await readyNow(m);
    const before = { ...v.notes };
    const turn = await askAndWait(m, ASK);
    expect(turn.at(-1)).toMatchObject({ type: "done", text: 'Preparei a proposta da reunião "2026-11-11 10h00 Zoom". Veja e aplique no Kiwi.' });
    // Nada foi escrito antes do [Aplicar].
    expect(v.notes).toEqual(before);
    const [p] = (await m.svc.proposalsList());
    expect(p).toMatchObject({
      status: "pending",
      meeting: { path: MEETING_PATH },
      project: { folder: "Projetos/Migração", name: "Migração" },
      candidates: [],
      note: { folder: "Projetos/Migração", title: "2026-11-11 · Cronograma da migração" },
    });
    const view = await m.svc.proposalView(p!.id);
    expect(view.noteContent).toContain(`[[Reuniões/2026-11-11 10h00 Zoom|`);
    expect(view.noteContent).toContain("## Decisões\n\n- A migração começa pelo arquivo de 2019");
    expect(view.main!.path).toBe(MAIN);
    expect(view.main!.lines.filter((l) => l.added).map((l) => l.text)).toContain("- [ ] Confirmar a janela de manutenção");
    expect(view.main!.lines.filter((l) => !l.added).map((l) => l.text)).toEqual(MAIN_TEXT.split("\n"));
    // [Ver] também não escreve.
    expect(v.notes).toEqual(before);

    const applied = await m.svc.proposalApply(p!.id);
    expect(applied).toMatchObject({ status: "applied", notePath: NOTE });
    expect(v.notes[NOTE]).toBe(view.noteContent);
    expect(v.notes[MAIN]).toBe(view.main!.lines.map((l) => l.text).join("\n"));
    await expect(m.svc.proposalApply(p!.id)).rejects.toMatchObject({ code: "E_BAD_ARGS" });
    expect(events).toEqual([["pending"], ["applied"]]);
    // O [Aplicar] é um pedido do registro, com a cópia de antes: o [Desfazer] volta a nota principal.
    const r = (await m.svc.activityLog()).find((x) => x.id === applied.applyRequest)!;
    expect(r.changes.map((c) => [c.kind, c.path])).toEqual([
      ["created", NOTE],
      ["appended", MAIN],
    ]);
    const trashed: string[] = [];
    m.svc.useUndo({
      folder: async () => null,
      get: async (q) => (v.notes[q] === undefined ? null : { content: v.notes[q]!, version: versionOf(v.notes[q]!) }),
      save: async (q, content, base) => {
        if (v.notes[q] === undefined || versionOf(v.notes[q]!) !== base) return false;
        v.notes[q] = content;
        return true;
      },
      trash: async (q) => {
        trashed.push(q);
        delete v.notes[q];
        return "trashed";
      },
    });
    await m.svc.undo(applied.applyRequest!);
    expect(v.notes).toEqual(before);
    expect(trashed).toEqual([NOTE]);
    // A proposta sabe que foi desfeita: as duas telas dizem "Desfeito" e não oferecem o [Desfazer] de novo.
    expect((await m.svc.proposalsList())[0]).toMatchObject({ status: "applied", undoneAt: expect.any(String) });
    expect(events.at(-1)).toEqual(["applied"]);
  });

  test("com dois projetos parecidos, a proposta pergunta; escolhido, aplica; [Descartar] não muda nada; sem projeto, só a nota da reunião", async () => {
    const v = vault([project("Projetos/Migração", "Migração", MAIN), project("Projetos/VNA", "VNA Fuji", null)]);
    const m = make({ reader: v.reader, writer: v.writer });
    await readyNow(m);
    const before = { ...v.notes };
    await askAndWait(m, ASK);
    const [p] = (await m.svc.proposalsList());
    expect(p).toMatchObject({ project: null, candidates: [{ folder: "Projetos/Migração", name: "Migração" }, { folder: "Projetos/VNA", name: "VNA Fuji" }] });
    await expect(m.svc.proposalApply(p!.id)).rejects.toMatchObject({ code: "E_BAD_ARGS" });
    await expect(m.svc.proposalChoose(p!.id, "Projetos/Outro")).rejects.toMatchObject({ code: "E_BAD_ARGS" });
    expect(await m.svc.proposalChoose(p!.id, "Projetos/VNA")).toMatchObject({ project: { name: "VNA Fuji" }, candidates: [], note: { folder: "Projetos/VNA" } });
    // Um projeto sem nota principal: a proposta é só a nota da reunião.
    expect((await m.svc.proposalView(p!.id)).main).toBeNull();
    // A nota segue o Modelo de nota do cofre (T11478): com títulos numerados, o [Ver] já mostra a numeração.
    expect((await m.svc.proposalView(p!.id)).noteContent).toContain("## Resumo");
    m.svc.useNoteModel(async () => ({ ...DEFAULT_NOTE_MODEL, numbered: true }));
    const numbered = (await m.svc.proposalView(p!.id)).noteContent;
    expect(numbered).toContain("## 1. Resumo");
    expect(numbered).toContain('projeto: "VNA Fuji"');
    expect(await m.svc.proposalDiscard(p!.id)).toMatchObject({ status: "discarded" });
    expect(v.notes).toEqual(before);
    await expect(m.svc.proposalApply(p!.id)).rejects.toMatchObject({ code: "E_BAD_ARGS" });

    // De novo, e "Nenhum: só a nota da reunião": a nota vai para a raiz, e a nota principal não muda.
    await askAndWait(m, ASK);
    const [q] = (await m.svc.proposalsList()).filter((x) => x.status === "pending");
    expect(await m.svc.proposalChoose(q!.id, null)).toMatchObject({ project: null, candidates: [], note: { folder: "" } });
    expect(await m.svc.proposalApply(q!.id)).toMatchObject({ status: "applied", notePath: "2026-11-11 · Cronograma da migração.md" });
    expect(v.notes[MAIN]).toBe(MAIN_TEXT);
    await expect(m.svc.proposalView("nao-existe")).rejects.toMatchObject({ code: "E_NOT_FOUND" });
  });

  test("um [Aplicar] que parou depois de gravar a nota principal não repete a reunião nela no [Aplicar] seguinte", async () => {
    const v = vault([project("Projetos/Migração", "Migração", MAIN)]);
    // O app "cai" logo depois de gravar a principal: a gravação acontece, e a chamada falha.
    let crash = true;
    const writer: VaultWriter = {
      ...v.writer,
      save: async (q, content, base) => {
        const r = await v.writer.save(q, content, base);
        if (crash && q === MAIN) {
          crash = false;
          throw new Error("o app caiu");
        }
        return r;
      },
    };
    const m = make({ reader: v.reader, writer });
    await readyNow(m);
    await askAndWait(m, ASK);
    const [p] = (await m.svc.proposalsList());
    await expect(m.svc.proposalApply(p!.id)).rejects.toThrow("o app caiu");
    expect((await m.svc.proposalsList())[0]).toMatchObject({ status: "pending", notePath: NOTE });
    expect(await m.svc.proposalApply(p!.id)).toMatchObject({ status: "applied" });
    expect(v.notes[MAIN]!.match(/Cronograma da migração\]\]/g)).toHaveLength(1);
    expect(v.notes[MAIN]!.match(/Confirmar a janela de manutenção/g)).toHaveLength(1);
    expect(Object.keys(v.notes).filter((k) => k.includes("Cronograma"))).toEqual([NOTE]);
  });

  /** Muda "Suas reuniões" e o modo econômico direto nos ajustes da pasta do teste. */
  async function setMeetings(m: Made, meetings: Partial<AgentSettings["meetings"]>, economy = false) {
    const store = new SettingsStore(m.data);
    const agent = (await store.load()).agent;
    await store.save({ agent: { ...agent, economy, meetings: { ...agent.meetings, ...meetings } } });
  }
  const started = (m: Made) => m.turns.filter((e) => e.type === "started").length;
  async function untilAsync<T>(get: () => Promise<T | undefined | null | false>, ms = 10_000): Promise<T> {
    const end = Date.now() + ms;
    for (;;) {
      const v = await get();
      if (v) return v;
      if (Date.now() > end) throw new Error("demorou demais");
      await Bun.sleep(10);
    }
  }

  test("a transcrição pronta: a proposta sai sem pedido, nada é escrito, a transcrição passa pelo guardrail, o áudio não vai, e uma reunião só gera uma", async () => {
    const v = vault([project("Projetos/Migração", "Migração", MAIN)]);
    const m = make({ reader: v.reader, writer: v.writer });
    await readyNow(m);
    const before = { ...v.notes };
    await m.svc.meetingReady(MEETING2_PATH);
    const p = await untilAsync(async () => (await m.svc.proposalsList()).find((x) => x.status === "pending"));
    expect(p).toMatchObject({ meeting: { path: MEETING2_PATH }, project: { name: "Migração" } });
    await until(() => m.turns.some((e) => e.type === "done"));
    expect(v.notes).toEqual(before);
    // O pedido é o automático, e a leitura da transcrição segurou o segredo (o filtro do guardrail).
    const [r] = await m.svc.activityLog();
    expect(r!.request).toStartWith("[Pedido automático do Kiwi] A reunião gravada");
    expect(r!.reads.find((x) => x.tool === "meetings_get")).toMatchObject({ target: MEETING2_PATH, held: 1 });
    // O que foi ao agente: só texto, sem o segredo e sem áudio.
    const prompts = m.log().filter((l) => l.method === "session/prompt").map((l) => l.params.prompt as { type: string }[]);
    expect(prompts.flat().map((b) => b.type)).toEqual(["text"]);
    expect(JSON.stringify(m.log())).not.toContain(SECRET);
    // De novo, a mesma reunião: nada novo.
    const count = started(m);
    await m.svc.meetingReady(MEETING2_PATH);
    await Bun.sleep(50);
    expect(started(m)).toBe(count);
    expect(await m.svc.proposalsList()).toHaveLength(1);
  });

  test("só quando eu pedir: nada sozinho. Com o modo econômico, pergunta antes de gastar. Com o agente ocupado, espera", async () => {
    const v = vault([project("Projetos/Migração", "Migração", MAIN)]);
    const m = make({ reader: v.reader, writer: v.writer });
    await readyNow(m);
    await setMeetings(m, { propose: "on-request" });
    await m.svc.meetingReady(MEETING_PATH);
    await Bun.sleep(50);
    expect(started(m)).toBe(0);
    expect(await m.svc.proposalsList()).toEqual([]);

    // O modo econômico: a pergunta, sem gastar; "Preparar" gasta o pedido e a proposta toma o lugar dela.
    await setMeetings(m, { propose: "auto" }, true);
    await m.svc.meetingReady(MEETING_PATH);
    const [offer] = await m.svc.proposalsList();
    expect(offer).toMatchObject({ status: "offer", meeting: { path: MEETING_PATH }, theme: "" });
    expect(started(m)).toBe(0);
    await expect(m.svc.proposalApply(offer!.id)).rejects.toMatchObject({ code: "E_BAD_ARGS" });
    await expect(m.svc.proposalView(offer!.id)).rejects.toMatchObject({ code: "E_BAD_ARGS" });
    await m.svc.proposalPrepare(offer!.id);
    const ready = await untilAsync(async () => (await m.svc.proposalsList()).find((x) => x.status === "pending"));
    expect(ready.meeting?.path).toBe(MEETING_PATH);
    expect((await m.svc.proposalsList()).map((x) => x.status)).toEqual(["pending"]);
    await until(() => m.turns.filter((e) => e.type === "done").length === 1);

    // Ocupado: o pedido da reunião espera o de agora acabar.
    await setMeetings(m, { propose: "auto" }, false);
    const slow = await m.svc.ask("/lento");
    await m.svc.meetingReady(MEETING2_PATH);
    expect(started(m)).toBe(2);
    const next = await untilAsync(async () => (await m.svc.proposalsList()).find((x) => x.meeting?.path === MEETING2_PATH));
    expect(next.status).toBe("pending");
    await until(() => m.turns.filter((e) => e.type === "done").length === 3);
    const order = m.turns.filter((e) => e.type === "started" || e.type === "done").map((e) => `${e.type}:${e.id === slow.id ? "lento" : "outro"}`);
    expect(order.slice(-4)).toEqual(["started:lento", "done:lento", "started:outro", "done:outro"]);
  });
});

describe("o resumo executivo de um projeto (spec #11546)", () => {
  const MAIN = "Projetos/Migração/Migração.md";
  const MEETING = "Projetos/Migração/2026-11-10 · Cronograma.md";
  const MAIN_TEXT = "# Migração\n\nO projeto da migração do PACS.\n\n## Pendências\n\n- [ ] Pedir o acesso\n";
  const OLD = "# Migração\n\n## Resumo executivo\n\n**Situação:** 🟢 No rumo · 01/11/2026\n\n### Decisões\n\n- Uma decisão velha ([[Projetos/Migração/Migração|Migração]])\n\n## Pendências\n\n- [ ] Pedir o acesso\n";
  const project = (folder: string, name: string, main: string | null) => ({ folder, name, main, updated: null, notes: 2 });
  function vault(main: string, projects = [project("Projetos/Migração", "Migração", MAIN)]) {
    const notes: Record<string, string> = { ...NOTES, [MAIN]: main, [MEETING]: "---\ntype: meeting\ndate: 2026-11-10\n---\n\n## Transcrição\n\n**Ana** (00:00): Começamos por 2019.\n" };
    const reader: VaultReader = {
      ...memoryReader(notes),
      meetings: async () => [
        { path: MEETING, title: "Cronograma", date: "2026-11-10", start: null, end: null, duration: 1800, app: "Zoom", participants: ["Ana"], live: false, mtime: "2026-11-10T11:00:00.000Z" },
      ],
      projects: async () => projects,
      projectStatus: async (folder) => {
        const p = projects.find((x) => x.folder === folder)!;
        return { project: p, outline: [], outlineTotal: 0, recent: [], openTasks: 0, taskNotes: 0, tasks: [] };
      },
    };
    return { notes, reader, writer: memoryWriter(notes) };
  }
  const ASK = "faz o resumo executivo do projeto Migração";
  const day = (d: Date) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  const undoer = (notes: Record<string, string>) => ({
    folder: async () => null,
    get: async (q: string) => (notes[q] === undefined ? null : { content: notes[q]!, version: versionOf(notes[q]!) }),
    save: async (q: string, content: string, base: string) => {
      if (notes[q] === undefined || versionOf(notes[q]!) !== base) return false;
      notes[q] = content;
      return true;
    },
    trash: async () => "trashed" as const,
  });

  test("a pedido: os 6 blocos na ordem fixa, com as fontes; nada é escrito antes; [Aplicar] escreve no topo da nota principal, com [Desfazer]", async () => {
    const v = vault(MAIN_TEXT);
    const m = make({ reader: v.reader, writer: v.writer });
    await readyNow(m);
    const before = { ...v.notes };
    const turn = await askAndWait(m, ASK);
    expect(turn.at(-1)).toMatchObject({ type: "done", text: 'Preparei o resumo executivo de "Migração". Veja e aplique no Kiwi.' });
    expect(v.notes).toEqual(before);
    const [p] = await m.svc.proposalsList();
    // O primeiro resumo conta os últimos 14 dias (o padrão de Ajustes).
    const since = new Date(Date.now() - 14 * 86_400_000);
    const sinceIso = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, "0")}-${String(since.getDate()).padStart(2, "0")}`;
    expect(p).toMatchObject({ kind: "summary", status: "pending", meeting: null, note: null, project: { folder: "Projetos/Migração" }, summary: { signal: "amarelo", since: sinceIso } });
    const view = await m.svc.proposalView(p!.id);
    const s = view.noteContent;
    const order = [
      "## Resumo executivo",
      `**Situação:** 🟡 Atenção · ${day(new Date())} · a migração atrasou uma semana`,
      `### O que andou desde ${day(since)}`,
      "### Decisões",
      "### Riscos e bloqueios",
      "### Próximos passos",
      "### Reuniões recentes",
    ].map((x) => s.indexOf(x));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(s).toContain("- A migração começa pelo arquivo de 2019 (10/11/2026, [[Projetos/Migração/2026-11-10 · Cronograma|2026-11-10 · Cronograma]])");
    expect(s).toContain("- [ ] Confirmar a janela de manutenção (Ana, sexta) · [[Projetos/Migração/Migração|Migração]]");
    expect(s).toContain("- 10/11/2026 · [[Projetos/Migração/2026-11-10 · Cronograma|Cronograma]]");
    expect(view.replaces).toBeUndefined();
    expect(view.main!.lines.filter((l) => !l.added).map((l) => l.text)).toEqual(MAIN_TEXT.split("\n"));
    expect(v.notes).toEqual(before);

    const applied = await m.svc.proposalApply(p!.id);
    expect(applied).toMatchObject({ kind: "summary", status: "applied" });
    expect(v.notes[MAIN]!.startsWith(`# Migração\n\n${s}\nO projeto da migração do PACS.`)).toBe(true);
    // Só a nota principal muda: nenhuma nota nova.
    expect(Object.keys(v.notes).sort()).toEqual(Object.keys(before).sort());
    const r = (await m.svc.activityLog()).find((x) => x.id === applied.applyRequest)!;
    expect(r.changes.map((c) => [c.kind, c.path, c.section])).toEqual([["replaced", MAIN, "Resumo executivo"]]);
    m.svc.useUndo(undoer(v.notes));
    await m.svc.undo(applied.applyRequest!);
    expect(v.notes).toEqual(before);
    expect((await m.svc.proposalsList())[0]).toMatchObject({ status: "applied", undoneAt: expect.any(String) });
  });

  test("um resumo novo substitui o anterior, que volta com o [Desfazer]; o período conta desde ele", async () => {
    const v = vault(OLD);
    const m = make({ reader: v.reader, writer: v.writer });
    await readyNow(m);
    await askAndWait(m, ASK);
    const [p] = await m.svc.proposalsList();
    expect(p!.summary).toMatchObject({ since: "2026-11-01" });
    const view = await m.svc.proposalView(p!.id);
    expect(view.replaces).toBe("2026-11-01");
    expect(view.noteContent).toContain("### O que andou desde 01/11/2026");
    const applied = await m.svc.proposalApply(p!.id);
    expect(v.notes[MAIN]!.match(/## Resumo executivo/g)).toHaveLength(1);
    expect(v.notes[MAIN]).not.toContain("Uma decisão velha");
    expect(v.notes[MAIN]!.endsWith("## Pendências\n\n- [ ] Pedir o acesso\n")).toBe(true);
    m.svc.useUndo(undoer(v.notes));
    await m.svc.undo(applied.applyRequest!);
    expect(v.notes[MAIN]).toBe(OLD);
  });

  test("os blocos desligados em Ajustes não entram", async () => {
    const v = vault(MAIN_TEXT);
    const m = make({ reader: v.reader, writer: v.writer });
    await readyNow(m);
    const st = await m.svc.configure({ summary: { blocks: { decisoes: false, reunioes: false }, firstDays: 7 } });
    expect(st.summary).toEqual({ blocks: { situacao: true, andou: true, decisoes: false, riscos: true, proximos: true, reunioes: false }, firstDays: 7 });
    await askAndWait(m, ASK);
    const [p] = await m.svc.proposalsList();
    const s = (await m.svc.proposalView(p!.id)).noteContent;
    expect(s).toContain("### Próximos passos");
    expect(s).not.toContain("### Decisões");
    expect(s).not.toContain("### Reuniões recentes");
    await m.svc.proposalApply(p!.id);
    expect(v.notes[MAIN]).not.toContain("### Decisões");
  });

  test("com o projeto ambíguo, o resumo pergunta; escolhido, conta o período e aplica; sem projeto ou sem nota principal não dá", async () => {
    const v = vault(MAIN_TEXT, [project("Projetos/Migração", "Migração", MAIN), project("Projetos/Migração VNA", "Migração VNA", null)]);
    const m = make({ reader: v.reader, writer: v.writer });
    await readyNow(m);
    await askAndWait(m, ASK);
    const [p] = await m.svc.proposalsList();
    expect(p).toMatchObject({ kind: "summary", project: null, candidates: [{ folder: "Projetos/Migração" }, { folder: "Projetos/Migração VNA" }], summary: { since: "" } });
    await expect(m.svc.proposalApply(p!.id)).rejects.toMatchObject({ code: "E_BAD_ARGS" });
    await expect(m.svc.proposalChoose(p!.id, null)).rejects.toMatchObject({ code: "E_BAD_ARGS" });
    // Um candidato sem nota principal é recusado na escolha, não no [Aplicar]; a pergunta continua aberta.
    await expect(m.svc.proposalChoose(p!.id, "Projetos/Migração VNA")).rejects.toThrow("não tem nota principal");
    expect((await m.svc.proposalsList())[0]).toMatchObject({ project: null, candidates: [{}, {}] });
    const chosen = await m.svc.proposalChoose(p!.id, "Projetos/Migração");
    expect(chosen).toMatchObject({ project: { folder: "Projetos/Migração" }, candidates: [] });
    expect(chosen.summary!.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await m.svc.proposalApply(p!.id);
    expect(v.notes[MAIN]).toContain("## Resumo executivo");
  });

  test("um projeto sem nota principal: a ferramenta recusa, o agente diz, e nenhum balão nasce", async () => {
    const v = vault(MAIN_TEXT, [project("Projetos/Migração", "Migração", null)]);
    const m = make({ reader: v.reader, writer: v.writer });
    await readyNow(m);
    const turn = await askAndWait(m, ASK);
    expect((turn.at(-1) as { text: string }).text).toContain("não tem nota principal");
    expect(await m.svc.proposalsList()).toEqual([]);
  });

  test("com o modo econômico, pergunta antes de gastar: o não para tudo, o sim segue", async () => {
    const v = vault(MAIN_TEXT);
    const m = make({ reader: v.reader, writer: v.writer });
    await readyNow(m);
    await m.svc.configure({ economy: true });
    const ask = async (answer: "send" | "hold") => {
      const { id } = await m.svc.ask(ASK);
      await until(() => !!m.svc.question());
      const card = m.svc.question()!;
      expect(card.items).toEqual([expect.objectContaining({ kind: "confirm", value: SUMMARY_ECONOMY_QUESTION })]);
      await m.svc.answerDoubt({ card: card.id, fingerprint: card.items[0]!.fingerprint, answer });
      await until(() => m.turns.some((e) => e.id === id && e.type === "done"));
      return m.turns.findLast((e) => e.id === id && e.type === "done") as { text: string; stopReason: string };
    };
    expect(await ask("hold")).toMatchObject({ stopReason: "cancelled", text: "Tudo bem, não fiz o resumo: nada foi lido." });
    expect(await m.svc.proposalsList()).toEqual([]);
    expect((await ask("send")).text).toContain("Preparei o resumo executivo");
    expect(await m.svc.proposalsList()).toHaveLength(1);
    // Outro pedido não pergunta.
    const other = await askAndWait(m, "oi");
    expect(other.at(-1)).toMatchObject({ type: "done" });
  });
});

describe("a memória do agente (spec #11469)", () => {
  test("\"lembra que…\" anota no cofre, avisa o balão com o [Desfazer], entra na Atividade e vai no começo do pedido seguinte", async () => {
    const root = tmp();
    const notes: Record<string, string> = { ...NOTES };
    const m = make({ reader: memoryReader(notes), writer: memoryWriter(notes) });
    m.svc.useVaultRoot(async () => root);
    const seen: AgentMemoryView[] = [];
    m.svc.onMemoryChanged((v) => seen.push(v));
    await readyNow(m);
    const turn = await askAndWait(m, "lembra que eu prefiro respostas curtas");
    expect(turn.at(-1)).toMatchObject({ type: "done", text: "Anotei: eu prefiro respostas curtas." });
    expect(readFileSync(path.join(root, ".kiwi/agente/sobre-mim.md"), "utf8")).toContain("- eu prefiro respostas curtas\n");
    expect(seen.at(-1)).toMatchObject({ facts: ["eu prefiro respostas curtas"], max: 60, last: { action: "remember", fact: "eu prefiro respostas curtas" } });
    const [r] = await m.svc.activityLog();
    expect(r!.reads).toContainEqual(expect.objectContaining({ tool: "memory_remember", target: "eu prefiro respostas curtas" }));
    // O pedido seguinte leva a memória no começo fixo, e dois pedidos seguidos levam os mesmos bytes.
    await askAndWait(m, "Oi");
    await askAndWait(m, "Oi de novo");
    const prompts = m.log().filter((l) => l.method === "session/prompt").map((l) => (l.params.prompt as { text: string }[])[0]!.text);
    const head = (t: string) => t.slice(0, t.indexOf("]\n\n") + 3);
    expect(prompts.at(-2)).toStartWith("[O que você sabe sobre a pessoa (a memória do Kiwi).");
    expect(head(prompts.at(-1)!)).toBe(head(prompts.at(-2)!));
    expect(prompts.at(-2)).toContain("- eu prefiro respostas curtas\n]");
    // O [Desfazer] do balão tira o fato, e o balão sabe que foi desfeito.
    const undone = await m.svc.memoryUndo(seen.at(-1)!.last!.id);
    expect(undone).toMatchObject({ facts: [], last: { undone: true } });
    expect(await m.svc.memoryView()).toMatchObject({ facts: [] });
    await expect(m.svc.memoryUndo("nao-existe")).rejects.toMatchObject({ code: "E_NOT_FOUND" });
    // "esquece que…" com o fato de volta, e o [Desfazer] traz o fato no mesmo lugar.
    await askAndWait(m, "lembra que trabalho com PACS");
    await askAndWait(m, "lembra que uso o Mac");
    await askAndWait(m, "esquece que trabalho com PACS");
    expect((await m.svc.memoryView()).facts).toEqual(["uso o Mac"]);
    await m.svc.memoryUndo((await m.svc.memoryView()).last!.id);
    expect((await m.svc.memoryView()).facts).toEqual(["trabalho com PACS", "uso o Mac"]);
  });

  test("sem a raiz do cofre, as ferramentas da memória não aparecem e o pedido vai sem a memória", async () => {
    const notes: Record<string, string> = { ...NOTES };
    const m = make({ reader: memoryReader(notes), writer: memoryWriter(notes) });
    await readyNow(m);
    const listed = (await askAndWait(m, "/ferramentas")).at(-1) as { text: string };
    expect(listed.text).not.toContain("memory_remember");
    await expect(m.svc.memoryView()).rejects.toMatchObject({ code: "E_NO_UNDO" });
  });
});
