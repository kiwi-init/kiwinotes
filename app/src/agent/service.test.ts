// O agente dentro do app (spec #8339, T8678): o serviço que as capacidades `agent.*` chamam, com o agente falso, um
// registro do npm falso e local e os ajustes de verdade numa pasta tmp. Nada aqui abre o Claude Code nem vai à internet.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { AgentStatus, AgentTurnEvent } from "../shared/ui-contract.ts";
import { SettingsStore } from "../store/settings.ts";
import { adapterRoot, agentDir } from "./adapter/open.ts";
import { FAKE_AGENT_COMMAND, FAKE_CLAUDE } from "./fake/index.ts";
import { fakeRegistry, type FakeRegistry } from "./fake/registry.ts";
import { AgentHost } from "./host.ts";
import { AgentService, AgentServiceError } from "./service.ts";
import { EMPTY_READER, type VaultReader } from "./tools/reader.ts";
import type { VaultWriter } from "./tools/writer.ts";
import { AgentActivity } from "./activity.ts";
import type { UndoNotes } from "./undo.ts";
import { createHash } from "node:crypto";

const services: AgentService[] = [];
const registries: FakeRegistry[] = [];
afterEach(async () => {
  for (const s of services.splice(0)) await s.close();
  for (const r of registries.splice(0)) r.stop();
});

function tmp(): string {
  return mkdtempSync(path.join(tmpdir(), "kiwi-agent-svc-"));
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

function make(o: { data?: string; reg?: FakeRegistry; idleMs?: number; model?: string; host?: (dir: string) => AgentHost; reader?: VaultReader; writer?: VaultWriter } = {}): Made {
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
    // O `tool_call` cru do agente (`mcp__kiwi__notes_read`) não aparece duas vezes.
    expect(turn.some((e) => e.type === "status" && e.status === "running" && e.tool.startsWith("mcp__kiwi__"))).toBe(false);
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
      text: "ferramentas: notes_search, notes_outline, notes_read, notes_list, meetings_list, meetings_get, projects_list, project_status, notes_create, notes_append, notes_write",
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
});

