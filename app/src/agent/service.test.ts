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

function make(o: { data?: string; reg?: FakeRegistry; idleMs?: number; model?: string; host?: (dir: string) => AgentHost } = {}): Made {
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
    openHost: async ({ configOptions }) =>
      o.host?.(agentDir(data)) ??
      new AgentHost({
        name: "Claude Code",
        command: FAKE_AGENT_COMMAND,
        dir: agentDir(data),
        configOptions,
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

