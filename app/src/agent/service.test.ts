// O agente dentro do app (spec #8339, T8678): o serviço que as capacidades `agent.*` chamam, com o agente falso, um
// registro do npm falso e local e os ajustes de verdade numa pasta tmp. Nada aqui abre o Claude Code nem vai à internet.

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { AgentMemoryView, AgentStatus, AgentTurnEvent } from "../shared/ui-contract.ts";
import { DEFAULT_AGENT_SETTINGS, SettingsStore, type AgentSettings } from "../store/settings.ts";
import { adapterRoot, agentDir } from "./adapter/open.ts";
import { fakeNotices } from "./fake/notices.ts";
import { FAKE_AGENT_COMMAND, FAKE_AGY, FAKE_CLAUDE, FAKE_GEMINI } from "./fake/index.ts";
import { AGY_LOGIN_HELP, GEMINI_NOT_A_COMMAND, geminiHost } from "./gemini-host.ts";
import { fakeRegistry, type FakeRegistry } from "./fake/registry.ts";
import { AgentHost, sessionFileOf, WEB_TOOLS } from "./host.ts";
import { AGENT_NAMES } from "./kinds.ts";
import { AgentService, AgentServiceError, cheapestModel, ECONOMY_INSTRUCTIONS, SUMMARY_ECONOMY_QUESTION } from "./service.ts";
import { ROUTINE_LABELS, routineDeclined, routineEconomyQuestion } from "./routines.ts";
import { DEFAULT_AGENT_ROUTINES } from "../shared/agent-routines.ts";
import type { AgentRoutineEvent } from "../shared/ui-contract.ts";
import { DEFAULT_NOTE_MODEL, noteModelText, sanitizeNoteModel } from "./note-model.ts";
import { PREFIX_RESEND_EVERY } from "./fixed-prefix.ts";
import { instructionsText } from "./memory.ts";
import { PACKAGE_HEAD_NONE } from "./pacote.ts";
import { EMPTY_READER, readerFromCapabilities, type VaultReader } from "./tools/reader.ts";
import { writerFromCapabilities, type VaultWriter } from "./tools/writer.ts";
import { uiCapabilities } from "../bun/ui-capabilities.ts";
import { TextIndex } from "../notes/text-index.ts";
import { Vault } from "../notes/vault.ts";
import { applyLiveEdits } from "../shared/live-edits.ts";
import { DEFAULT_SETTINGS } from "../store/settings.ts";
import { AgentActivity } from "./activity.ts";
import type { UndoNotes } from "./undo.ts";
import { createHash } from "node:crypto";
import { tempDir } from "../../test/tmp.ts";
import { CAPSULE_MAX_TOKENS, modelTokens } from "./window.ts";
import { effortHint, effortOptions, effortValue } from "../../ui/settings/agentText.ts";

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
  /** Os ajustes gravados, para um teste mudar o que o serviço vai ler sem passar pelo `configure`. */
  store: SettingsStore;
}

function make(o: { data?: string; reg?: FakeRegistry; idleMs?: number; model?: string; host?: (dir: string) => AgentHost; reader?: VaultReader; writer?: VaultWriter; doubtTimeoutMs?: number; now?: () => number; limitProbe?: { delayMs?: number; retryMs?: number; everyMs?: number }; window?: { maxTokens?: number; idleMs?: number }; env?: Record<string, string>; agy?: boolean; appLog?: (line: string) => void } = {}): Made {
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
    ...(o.now ? { now: o.now } : {}),
    // O `/usage` de depois do pedido (ADR 0013) só nos testes dele: nos outros, ele não entra no meio.
    limitProbe: o.limitProbe ?? { delayMs: 3_600_000 },
    ...(o.window ? { window: o.window } : {}),
    gemini: () => (o.agy ? FAKE_AGY : FAKE_GEMINI),
    openHost: async ({ kind, configOptions, kiwiTools, webTools, onExit }) =>
      o.host?.(agentDir(data)) ??
      // O Antigravity (spec #25046): o `agy` falso pelo `geminiHost` de verdade, com os argumentos, o ambiente e o
      // loginHelp que o app usa.
      (o.agy && kind === "gemini"
        ? (
            await geminiHost({
              data,
              program: FAKE_AGY,
              env: { ...process.env, KIWI_FAKE_AGENT_LOG: logFile, ...(o.model ? { KIWI_FAKE_AGENT_MODEL: o.model } : {}), ...o.env },
              host: { configOptions, onExit, ...(kiwiTools ? { kiwiTools } : {}), ...(webTools ? { webTools } : {}) },
            })
          ).host
        : null) ??
      new AgentHost({
        name: AGENT_NAMES[kind],
        kind,
        command: FAKE_AGENT_COMMAND,
        dir: agentDir(data),
        configOptions,
        onExit,
        ...(kiwiTools ? { kiwiTools } : {}),
        ...(webTools ? { webTools } : {}),
        // O Gemini é o mesmo agente falso com o jeito dele (T24671): o initialize, o login e as ferramentas do Gemini CLI.
        env: { ...process.env, KIWI_FAKE_AGENT_LOG: logFile, ...(o.model ? { KIWI_FAKE_AGENT_MODEL: o.model } : {}), ...(kind === "gemini" ? { KIWI_FAKE_AGENT_FLAVOR: "gemini" } : {}), ...o.env },
      }),
    registry: reg.url,
    packages: reg.pinned,
    idleMs: o.idleMs ?? 60_000,
    ...(o.appLog ? { log: o.appLog } : {}),
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
    store,
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

/** Até o agente ficar livre: o pedido anterior acabou de vez, e não só mandou o `done` (#13738). */
async function untilIdle(m: Made, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while ((await m.svc.status()).busy) {
    if (Date.now() > end) throw new Error("o agente não ficou livre");
    await Bun.sleep(10);
  }
}

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

describe("o onboarding (spec #11955)", () => {
  test("ligar pela primeira vez o abre no passo 1; o passo fica guardado; fechar o termina; o Refazer abre de novo", async () => {
    const data = tmp();
    const m = make({ data });
    expect((await m.svc.status()).onboarding).toEqual({ state: "pending", step: 1 });
    expect((await m.svc.enable(true)).onboarding).toEqual({ state: "open", step: 1 });
    expect((await m.svc.configure({ onboarding: { step: 4 } })).onboarding).toEqual({ state: "open", step: 4 });
    // Fechar o app no meio: na volta, o mesmo passo.
    await m.svc.close();
    const again = make({ data, reg: m.reg });
    expect((await again.svc.status()).onboarding).toEqual({ state: "open", step: 4 });
    expect((await again.svc.configure({ onboarding: { state: "done" } })).onboarding).toEqual({ state: "done", step: 4 });
    // Desligar e ligar de novo não abre outra vez.
    await again.svc.disable();
    expect((await again.svc.enable()).onboarding.state).toBe("done");
    // O "Refazer o onboarding" em Ajustes: aberto, do passo 1.
    expect((await again.svc.configure({ onboarding: { state: "open", step: 1 } })).onboarding).toEqual({ state: "open", step: 1 });
  });
});

describe("o guardrail na prática (spec #11955, o passo 4)", () => {
  test("o filtro local troca o segredo pelo marcador, sem o agente ligado, sem abrir nada e sem registro", async () => {
    const m = make();
    const r = await m.svc.guardPreview("a senha do servidor é abc123");
    expect(r.held).toBe(1);
    expect(r.text).toMatch(/^a senha do servidor é ‹segredo 1 · [a-z0-9]{4}›$/);
    expect((await m.svc.guardPreview("bom dia")).text).toBe("bom dia");
    expect(m.pid()).toBeNull();
    expect(m.reg.requests).toEqual([]);
    expect(await m.svc.activityLog()).toEqual([]);
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

  test("o done leva os links do que existe na pasta (spec #17683); sem o índice, vai sem links", async () => {
    const m = make();
    m.svc.useLinkResolver(async () => ({ note: (t) => (t === "Plano" || t === "Plano.md" ? "Plano.md" : null), file: () => null }));
    await readyNow(m);
    const done = (await askAndWait(m, "Plano.md e Outra.md")).at(-1)!;
    expect(done).toMatchObject({ type: "done", links: [{ text: "Plano.md", path: "Plano.md", kind: "note" }] });
    if (done.type !== "done") throw new Error("sem done");
    const l = done.links![0]!;
    expect(done.text.slice(l.from, l.to)).toBe("Plano.md");
    // O índice falhou: o pedido termina igual, sem links.
    m.svc.useLinkResolver(async () => { throw new Error("sem pasta"); });
    expect((await askAndWait(m, "Plano.md")).at(-1)).not.toHaveProperty("links");
    const plain = make();
    await readyNow(plain);
    expect((await askAndWait(plain, "Plano.md")).at(-1)).not.toHaveProperty("links");
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
  test("o agente abre com os do terminal (fable, high), e o app troca pelos dele antes do primeiro pedido; sem escolha, o esforço vai no mais baixo (spec #19273)", async () => {
    const m = make({ model: "fable" });
    await readyNow(m);
    await askAndWait(m, "oi");
    const sets = m.log().filter((l) => l.method === "session/set_config_option").map((l) => [l.params.configId, l.params.value]);
    expect(sets).toEqual([
      ["model", "default"],
      ["effort", "low"],
    ]);
    expect((await m.svc.status()).session).toEqual({ model: "default", effort: "low" });
    // Nos Ajustes, a escolha continua "Padrão": o low é o que o Padrão pede.
    expect((await m.svc.status()).effort).toBe("default");
  });

  test("trocar o modelo vale no próximo pedido, com o programa já aberto", async () => {
    const m = make();
    await readyNow(m);
    await askAndWait(m, "um");
    await m.svc.configure({ model: "opus" });
    await askAndWait(m, "dois");
    expect((await m.svc.status()).session).toEqual({ model: "opus", effort: "low" });
  });
});

describe("o esforço de cada modelo (spec #16793)", () => {
  const sets = (m: Made) => m.log().filter((l) => l.method === "session/set_config_option").map((l) => [l.params.configId, l.params.value]);

  test("cada modelo guarda o seu: trocar de modelo e voltar traz o esforço dele, e o host aplica o do modelo atual", async () => {
    const m = make();
    await readyNow(m);
    await m.svc.configure({ model: "opus", effort: "high" });
    await askAndWait(m, "um");
    expect((await m.svc.status()).session).toEqual({ model: "opus", effort: "high" });

    await m.svc.configure({ model: "sonnet" });
    // O sonnet ainda não tem esforço próprio: vale o de antes, "default".
    expect((await m.svc.status()).effort).toBe("default");
    await m.svc.configure({ effort: "low" });
    const before = sets(m).length;
    await askAndWait(m, "dois");
    expect(sets(m).slice(before)).toEqual([
      ["model", "sonnet"],
      ["effort", "low"],
    ]);

    await m.svc.configure({ model: "opus" });
    const st = await m.svc.status();
    expect(st.effort).toBe("high");
    expect(st.effortByModel).toEqual({ opus: "high", sonnet: "low" });
    await askAndWait(m, "três");
    expect((await m.svc.status()).session).toEqual({ model: "opus", effort: "high" });
  });

  test("as escolhas de esforço de cada modelo, como o agente diz, ficam guardadas; um modelo sem esforço fica com []", async () => {
    const data = tmp();
    const m = make({ data });
    expect((await m.svc.status()).efforts).toEqual({});
    await readyNow(m);
    await m.svc.configure({ model: "sonnet" });
    await askAndWait(m, "um");
    await m.svc.configure({ model: "opus-legacy", effort: "high" });
    await askAndWait(m, "dois");
    const st = await m.svc.status();
    expect(st.efforts.sonnet?.map((e) => e.value)).toEqual(["default", "low", "medium", "high"]);
    expect(st.efforts["opus-legacy"]).toEqual([]);
    // Sem a opção, o esforço salvo não vai ao agente, e a sessão segue.
    expect(st.session).toEqual({ model: "opus-legacy" });
    await m.svc.close();

    const again = make({ data, reg: m.reg });
    const st2 = await again.svc.status();
    expect(st2.program).toBe("closed");
    expect(Object.keys(st2.efforts).sort()).toEqual(["opus-legacy", "sonnet"]);
  });

  test("no modo econômico vale o esforço salvo do modelo barato", async () => {
    const m = make();
    await readyNow(m);
    await askAndWait(m, "um");
    await m.svc.configure({ model: "haiku", effort: "low" });
    await m.svc.configure({ model: "opus", effort: "high", economy: true });
    await askAndWait(m, "dois");
    expect((await m.svc.status()).session).toEqual({ model: "haiku", effort: "low" });
    await m.svc.configure({ economy: false });
    await askAndWait(m, "três");
    expect((await m.svc.status()).session).toEqual({ model: "opus", effort: "high" });
  });

  test("\"Mostrar o que eu falei\" (spec #26055): desligado por padrão, o configure grava e o status avisa", async () => {
    const m = make();
    expect((await m.svc.status()).showSpokenText).toBe(false);
    expect((await m.svc.configure({ showSpokenText: true })).showSpokenText).toBe(true);
    expect((await new SettingsStore(m.data).load()).agent.showSpokenText).toBe(true);
    // O status sai na hora: o agent-voice lê dele, e a troca vale sem reiniciar.
    expect(m.statuses.at(-1)?.showSpokenText).toBe(true);
    expect((await m.svc.configure({ showSpokenText: false })).showSpokenText).toBe(false);
    expect(m.statuses.at(-1)?.showSpokenText).toBe(false);
  });

  test("um ajuste antigo, só com o effort, vale para todos os modelos até cada um ter o seu", async () => {
    const data = tmp();
    await new SettingsStore(data).save({ agent: { ...DEFAULT_AGENT_SETTINGS, model: "opus", effort: "medium" } as never });
    const m = make({ data });
    expect((await m.svc.status()).effort).toBe("medium");
    await readyNow(m);
    await askAndWait(m, "um");
    expect((await m.svc.status()).session).toEqual({ model: "opus", effort: "medium" });
    await m.svc.configure({ model: "sonnet", effort: "low" });
    await m.svc.configure({ model: "fable" });
    expect((await m.svc.status()).effort).toBe("medium");
  });

  test("trocar o esforço no meio de uma resposta não a interrompe: vale no pedido seguinte", async () => {
    const m = make();
    await readyNow(m);
    await askAndWait(m, "um");
    const words = Array.from({ length: 12 }, (_, i) => `p${i}`).join(" ");
    const { id } = await m.svc.ask(`/conta ${words}`);
    await until(() => m.turns.some((e) => e.id === id && e.type === "text"));
    const before = sets(m).length;
    await m.svc.configure({ effort: "max" });
    await until(() => m.turns.some((e) => e.id === id && (e.type === "done" || e.type === "error")));
    const done = m.turns.find((e) => e.id === id && (e.type === "done" || e.type === "error"));
    expect(done).toMatchObject({ type: "done", stopReason: "end_turn" });
    expect(sets(m).slice(before)).toEqual([]);
    await askAndWait(m, "dois");
    expect(sets(m).slice(before)).toEqual([["effort", "max"]]);
  });

  test("um esforço salvo que o modelo não tem não vale e não aparece como se valesse: a migração com high e o haiku (revisão #17024)", async () => {
    const data = tmp();
    await new SettingsStore(data).save({ agent: { ...DEFAULT_AGENT_SETTINGS, model: "opus", effort: "high" } as never });
    const m = make({ data });
    await readyNow(m);
    await askAndWait(m, "um");
    await m.svc.configure({ model: "haiku" });
    await askAndWait(m, "dois");
    const st = await m.svc.status();
    // O haiku vai até medium: o high salvo não vai ao agente, e a sessão fica no esforço que ele pôs.
    expect(st.effort).toBe("high");
    expect(st.session).toEqual({ model: "haiku", effort: "medium" });
    expect(sets(m)).not.toContainEqual(["effort", "high"]);
    // O que a tela mostra: o que vale de fato, e a linha que diz que o salvo não existe neste modelo.
    expect(effortOptions(st)?.map((o) => o.value)).not.toContain("high");
    expect(effortValue(st)).toBe("medium");
    expect(effortHint(st)).toContain("O nível salvo, Alto, não existe neste modelo: vale o Médio.");
  }, 30_000);

  test("o Padrão volta mesmo num modelo em que o agente não oferece o default: vale o mais baixo dele (revisão #17024, spec #19273)", async () => {
    const m = make();
    await readyNow(m);
    await m.svc.configure({ model: "haiku" });
    await askAndWait(m, "um");
    const st = await m.svc.status();
    expect(st.efforts.haiku?.map((e) => e.value)).toEqual(["low", "medium"]);
    expect(effortOptions(st)?.map((o) => o.value)).toEqual(["default", "low", "medium"]);
    expect(st.session).toEqual({ model: "haiku", effort: "low" });
    await m.svc.configure({ effort: "medium" });
    await askAndWait(m, "dois");
    expect((await m.svc.status()).session).toEqual({ model: "haiku", effort: "medium" });
    await m.svc.configure({ effort: "default" });
    await askAndWait(m, "três");
    expect((await m.svc.status()).session).toEqual({ model: "haiku", effort: "low" });
  }, 30_000);

  test("o prepare com o /usage do medidor andando só devolve o estado: nada de set_config no meio do /usage (revisão #17024)", async () => {
    const m = make({ env: { KIWI_FAKE_AGENT_USAGE_DELAY_MS: "1500" } });
    await readyNow(m);
    await m.svc.prepare();
    const usages = () => m.log().filter((l) => l.method === "session/usage").length;
    const usage = m.svc.usageRefresh();
    await until(() => usages() === 1);
    await m.svc.configure({ model: "sonnet", effort: "medium" });
    const before = sets(m).length;
    expect((await m.svc.status()).busy).toBe(true);
    await m.svc.prepare();
    expect(sets(m).slice(before)).toEqual([]);
    await usage;
    // Livre de novo, o prepare aplica a escolha.
    await m.svc.prepare();
    expect(sets(m).slice(before)).toEqual([
      ["model", "sonnet"],
      ["effort", "medium"],
    ]);
  }, 30_000);

  test("o onboarding: o prepare abre a sessão sem pedido, lista os esforços do modelo escolhido, e a escolha fica em Ajustes", async () => {
    const m = make();
    await readyNow(m);
    const prompts = () => m.log().filter((l) => l.method === "session/prompt").length;
    const st = await m.svc.prepare();
    expect(st.program).toBe("open");
    expect(st.efforts.default?.length).toBeGreaterThan(0);
    // Trocar o modelo e abrir de novo: a sessão vai para ele, e os esforços dele aparecem, sem pedido nenhum.
    await m.svc.configure({ model: "sonnet" });
    expect((await m.svc.status()).efforts.sonnet).toBeUndefined();
    const st2 = await m.svc.prepare();
    expect(st2.efforts.sonnet?.map((e) => e.value)).toEqual(["default", "low", "medium", "high"]);
    expect(st2.session).toEqual({ model: "sonnet", effort: "low" });
    await m.svc.configure({ effort: "medium" });
    await m.svc.prepare();
    expect(prompts()).toBe(0);
    // O que Ajustes › Agente lê: o mesmo estado, com o modelo e o esforço escolhidos no onboarding.
    const settings = await m.svc.status(true);
    expect(settings.model).toBe("sonnet");
    expect(settings.effort).toBe("medium");
    expect(settings.effortByModel).toEqual({ sonnet: "medium" });
    expect(settings.session).toEqual({ model: "sonnet", effort: "medium" });
  });

  test("o prepare sem estar ligado, sem o aceite ou sem o adaptador falha sem subir processo; com um pedido rodando, só devolve o estado", async () => {
    // ADR 0011: sem estar ligado e sem o aceite, ou sem o adaptador, nenhum processo sobe e nada vai ao agente.
    const off = make();
    expect((await rejection(off.svc.prepare())).code).toBe("E_AGENT_DISABLED");
    const data = tmp();
    await new SettingsStore(data).save({ agent: { ...DEFAULT_AGENT_SETTINGS, enabled: true, consented: false } as never });
    const noConsent = make({ data });
    expect((await rejection(noConsent.svc.prepare())).code).toBe("E_AGENT_DISABLED");
    const noAdapter = make();
    await noAdapter.svc.enable(true);
    expect((await rejection(noAdapter.svc.prepare())).code).toBe("E_ADAPTER_MISSING");
    for (const x of [off, noConsent, noAdapter]) {
      expect(x.pid()).toBeNull();
      expect(x.log().filter((l) => l.method === "session/new")).toEqual([]);
      expect(x.log()).toEqual([]);
    }
    const m = make();
    await readyNow(m);
    await m.svc.prepare();
    const words = Array.from({ length: 12 }, (_, i) => `p${i}`).join(" ");
    const { id } = await m.svc.ask(`/conta ${words}`);
    await until(() => m.turns.some((e) => e.id === id && e.type === "text"));
    await m.svc.configure({ model: "haiku" });
    const before = sets(m).length;
    expect((await m.svc.prepare()).session?.model).toBe("default");
    expect(sets(m).slice(before)).toEqual([]);
    await until(() => m.turns.some((e) => e.id === id && (e.type === "done" || e.type === "error")));
    expect(m.turns.find((e) => e.id === id && (e.type === "done" || e.type === "error"))).toMatchObject({ type: "done", stopReason: "end_turn" });
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
    expect(models.map((x) => x.value)).toEqual(["default", "opus", "fable", "sonnet", "haiku", "opus-legacy"]);
    expect(models[0]).toEqual({ value: "default", name: "Default (recommended)", description: "Sonnet · Best for everyday, complex tasks" });
    await m.svc.close();

    // O app abriu de novo: a lista está lá, sem abrir o programa.
    const again = make({ data, reg: m.reg });
    const st = await again.svc.status();
    expect(st.program).toBe("closed");
    expect(st.models.map((x) => x.value)).toEqual(["default", "opus", "fable", "sonnet", "haiku", "opus-legacy"]);
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
    file: EMPTY_READER.file,
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
    expect(turn.at(-1)).toMatchObject({ type: "done", text: "ferramentas: kiwi" });
    const params = opened(m)[0]!.params as { mcpServers: KiwiServer[]; _meta: { claudeCode: { options: Record<string, unknown> } } };
    expect(params.mcpServers).toHaveLength(1);
    expect(params.mcpServers[0]).toMatchObject({ type: "http", name: "kiwi" });
    expect(params.mcpServers[0]!.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    expect(params.mcpServers[0]!.headers[0]!.name).toBe("X-Kiwi-Token");
    const options = params._meta.claudeCode.options;
    expect(options.allowedTools).toEqual(["mcp__kiwi__*"]);
    // O isolamento continua: das embutidas só a busca e a leitura de página (spec #19273), nenhuma configuração pessoal,
    // e só o servidor do Kiwi: nenhum MCP de fora, nem o context7 (harry #19281).
    expect(options).toMatchObject({ tools: ["WebSearch", "WebFetch"], settingSources: [], strictMcpConfig: true, allowDangerouslySkipPermissions: false });
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
    // O `tool_call` cru do agente (`mcp__kiwi__kiwi`) nunca aparece: no começo da ferramenta sai o nome limpo (`kiwi`, a
    // ferramenta única do T14563), sem o que foi lido (spec #9510, o gato entra em `agindo`), e no fim o servidor manda a
    // ação de dentro com o `target`; quando ela acaba, o host volta a `thinking`.
    expect(turn.some((e) => e.type === "status" && e.status === "running" && e.tool.startsWith("mcp__kiwi__"))).toBe(false);
    const statuses = turn.filter((e) => e.type === "status").map((e) => (e.status === "running" ? `running:${e.tool}:${e.target ?? ""}` : e.status));
    const first = statuses.indexOf("running:kiwi:");
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
    // Um arquivo do agente (spec #11549): os bytes guardados como latin1 no mesmo mapa, com a versão dos bytes.
    createFile: async (folder, name, bytes) => {
      const p = `${folder ? `${folder}/` : ""}${name}`;
      notes[p] = Buffer.from(bytes).toString("latin1");
      return { path: p, size: bytes.length, version: createHash("sha256").update(bytes).digest("hex").slice(0, 16) };
    },
  };
}

describe("Pesquisar na web (spec #11908)", () => {
  test("ligado por padrão (spec #19273); desligado, o Kiwi nega a busca do agente; ligado de novo, libera já no próximo pedido, e o status diz web", async () => {
    const m = make();
    await readyNow(m);
    expect((await m.svc.status()).webSearch).toBe(true);
    // A escolha fica gravada com a marca: desligar continua desligado depois de reler as configurações.
    expect((await m.svc.configure({ webSearch: false })).webSearch).toBe(false);
    expect((await m.svc.status()).webSearch).toBe(false);
    const off = await askAndWait(m, "/web documentação do ORBITweb");
    expect(off.at(-1)).toMatchObject({ type: "done", text: "web negada: a busca não aconteceu." });
    expect(off).toContainEqual(expect.objectContaining({ type: "permission", tool: "WebSearch", decision: "denied" }));
    expect(off.some((e) => e.type === "status" && (e as { tool?: string }).tool === "web")).toBe(false);
    // Ligado: sem reabrir o agente, o próximo pedido de permissão já vale.
    expect((await m.svc.configure({ webSearch: true })).webSearch).toBe(true);
    const on = await askAndWait(m, "/web documentação do ORBITweb");
    expect(on.at(-1)).toMatchObject({ type: "done", text: "busquei na web: documentação do ORBITweb" });
    expect(on).toContainEqual(expect.objectContaining({ type: "status", status: "running", tool: "web" }));
    expect(on.some((e) => e.type === "permission")).toBe(false);
    // O nome cru da ferramenta do agente nunca chega à tela.
    expect(on.some((e) => e.type === "status" && (e as { tool?: string }).tool === "WebSearch")).toBe(false);
    // Desligado de novo: negado de novo.
    await m.svc.configure({ webSearch: false });
    expect((await askAndWait(m, "/web outra busca")).at(-1)).toMatchObject({ text: "web negada: a busca não aconteceu." });
  });

  test("desligado por construção (revisão do T19300): a sessão abre sem as ferramentas de web, e trocar o interruptor reabre a sessão no pedido seguinte", async () => {
    const m = make();
    await readyNow(m);
    const tools = () =>
      m
        .log()
        .filter((l) => l.method === "session/new" || l.method === "session/resume" || l.method === "session/load")
        .map((l) => (l.params as { _meta: { claudeCode: { options: { tools: string[] } } } })._meta.claudeCode.options.tools);
    // Ligado de fábrica: a sessão aberta já tem a busca e a leitura de página.
    await askAndWait(m, "oi");
    expect(tools().at(-1)).toEqual([...WEB_TOOLS]);
    const opened = tools().length;
    // Desligado: o pedido seguinte vai a uma sessão nova, sem elas.
    await m.svc.configure({ webSearch: false });
    await askAndWait(m, "oi de novo");
    expect(tools()).toHaveLength(opened + 1);
    expect(tools().at(-1)).toEqual([]);
    // Sem troca, a sessão segue.
    await askAndWait(m, "mais um");
    expect(tools()).toHaveLength(opened + 1);
    // Ligado de novo: outra sessão, com elas.
    await m.svc.configure({ webSearch: true });
    await askAndWait(m, "e agora");
    expect(tools()).toHaveLength(opened + 2);
    expect(tools().at(-1)).toEqual([...WEB_TOOLS]);
  });
});

describe("as referências de uma nota (spec #11908)", () => {
  test("o agente manda os links, nada é escrito antes; [Ver] mostra a seção, [Aplicar] escreve no fim com [Desfazer], e um link repetido não entra", async () => {
    const NOTE = "Projetos/SILO.md";
    const TEXT = "# SILO\n\nA mudança.\n\n## Referências\n\n- [ORBITweb](https://www.orbitstandard.org/using/orbitweb/): já estava\n";
    const notes: Record<string, string> = { ...NOTES, [NOTE]: TEXT };
    const m = make({ reader: memoryReader(notes), writer: memoryWriter(notes) });
    await readyNow(m);
    const before = { ...notes };
    const turn = await askAndWait(m, `/referencias ${NOTE}`);
    expect(turn.at(-1)).toMatchObject({ type: "done", text: `Preparei as referências de ${NOTE}. Veja e aplique no Kiwi.` });
    expect(notes).toEqual(before);
    const [p] = await m.svc.proposalsList();
    // O ORBITweb já estava (com a barra do fim): só o outro entra.
    expect(p).toMatchObject({ kind: "references", status: "pending", meeting: null, note: null, references: { note: NOTE, count: 1 } });
    const view = await m.svc.proposalView(p!.id);
    // A nota já tem a seção: só a linha nova.
    expect(view.noteContent).toBe("- [Cloud Atlas API: ORBIT](https://cloud.google.com/atlas-api/docs/concepts/orbit): Os orbitStores e o ORBITweb do Google. (14/11/2026)\n");
    expect(view.main!.lines.filter((l) => l.added).map((l) => l.text)).toEqual([expect.stringContaining("cloud.google.com")]);
    const applied = await m.svc.proposalApply(p!.id);
    expect(applied).toMatchObject({ kind: "references", status: "applied" });
    expect(notes[NOTE]).toBe(`${TEXT}- [Cloud Atlas API: ORBIT](https://cloud.google.com/atlas-api/docs/concepts/orbit): Os orbitStores e o ORBITweb do Google. (14/11/2026)\n`);
    const r = (await m.svc.activityLog()).find((x) => x.id === applied.applyRequest)!;
    expect(r.changes.map((c) => [c.kind, c.path, c.section])).toEqual([["appended", NOTE, "Referências"]]);
    m.svc.useUndo({
      folder: async () => null,
      get: async (q) => (notes[q] === undefined ? null : { content: notes[q]!, version: versionOf(notes[q]!) }),
      save: async (q, content, base) => {
        if (notes[q] === undefined || versionOf(notes[q]!) !== base) return false;
        notes[q] = content;
        return true;
      },
      trash: async () => "gone",
    });
    await m.svc.undo(applied.applyRequest!);
    expect(notes[NOTE]).toBe(TEXT);
    // Todos já na nota: nada a propor.
    notes[NOTE] = `${TEXT}https://cloud.google.com/atlas-api/docs/concepts/orbit\n`;
    expect((await askAndWait(m, `/referencias ${NOTE}`)).at(-1)).toMatchObject({ type: "done" });
    expect((await m.svc.proposalsList()).filter((x) => x.status === "pending")).toEqual([]);
  });
});

describe("os arquivos que o agente gera (spec #11549)", () => {
  test("o pedido gera o arquivo, a Atividade registra a criação, e o [Desfazer] o manda para a Lixeira", async () => {
    const notes: Record<string, string> = { ...NOTES };
    const m = make({ reader: memoryReader(notes), writer: memoryWriter(notes) });
    await readyNow(m);
    const turn = await askAndWait(m, "/gerar-arquivo pdf Saída/Relatório");
    expect(turn.at(-1)).toMatchObject({ type: "done", text: "Gerei Saída/Relatório.pdf." });
    const bytes = Buffer.from(notes["Saída/Relatório.pdf"]!, "latin1");
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    const r = (await m.svc.activityLog())[0]!;
    expect(r.changes).toEqual([expect.objectContaining({ kind: "created", path: "Saída/Relatório.pdf", before: 0, after: bytes.length })]);
    const trashed: string[] = [];
    m.svc.useUndo({
      folder: async () => null,
      get: async (q) => (notes[q] === undefined ? null : { content: "", version: createHash("sha256").update(Buffer.from(notes[q]!, "latin1")).digest("hex").slice(0, 16) }),
      save: async () => false,
      trash: async (q) => {
        trashed.push(q);
        delete notes[q];
        return "trashed";
      },
    });
    await m.svc.undo(r.id);
    expect(trashed).toEqual(["Saída/Relatório.pdf"]);
    expect(notes["Saída/Relatório.pdf"]).toBeUndefined();
  });
});

describe("a escrita e o registro do agente (spec #8356)", () => {
  test("com o escritor, a lista é a mesma (só a kiwi, T14563); cada pedido entra no registro com o que leu e mudou, e a cópia de antes", async () => {
    const notes: Record<string, string> = { ...NOTES };
    const m = make({ reader: memoryReader(notes), writer: memoryWriter(notes) });
    await readyNow(m);
    expect((await askAndWait(m, "/ferramentas")).at(-1)).toMatchObject({
      type: "done",
      text: "ferramentas: kiwi",
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

  test("sem o escritor, a mesma lista: só a kiwi (T14563)", async () => {
    const m = make({ reader: memoryReader(NOTES) });
    await readyNow(m);
    expect((await askAndWait(m, "/ferramentas")).at(-1)).toMatchObject({ text: "ferramentas: kiwi" });
    expect((await askAndWait(m, '/tool notes_append {"path":"Ideias.md","text":"x"}')).at(-1)).toMatchObject({ text: expect.stringContaining("E_NOT_ALLOWED: kiwi escrever/acrescentar") });
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
    // De novo, numa conversa nova (na mesma, o registro de entrega diria "já está com você", T14682): não pergunta, e passa.
    m.svc.newConversation();
    const again = await askAndWait(m, read);
    expect(again.some((e) => e.type === "status" && e.status === "waiting")).toBe(false);
    expect((again.at(-1) as { text: string }).text).toContain(DOUBT);
    expect(m.svc.answersList()).toEqual([expect.objectContaining({ answer: "send" })]);
    // Esquecida a resposta e sem resposta no prazo: o trecho é segurado, o pedido segue, e a dúvida fica pendente.
    expect(m.svc.forgetAnswer(card.items[0]!.fingerprint)).toBe(true);
    m.svc.newConversation();
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

  test("o placar (T14671): as idas pelas levas de ferramentas, as cinco partes somando o total e o faro de cada pedido", async () => {
    const m = make({ reader: memoryReader(NOTES) });
    await readyNow(m);
    // Sem nome de nota: o faro não acha, e o agente falso busca e lê (2 levas, 3 idas).
    await askAndWait(m, "o que tem sobre março?");
    // Com o nome: o faro acha de primeira e o pacote vai junto.
    await askAndWait(m, "o que diz a nota Ideias?");
    const p = m.svc.usageView().placar!;
    expect(p.pedidos).toBe(2);
    const [ultimo, primeiro] = p.ultimos;
    expect(primeiro!.question).toBe("o que tem sobre março?");
    expect(primeiro!.faro).toEqual({ kind: "nada", searched: true });
    expect(primeiro!.idas).toBeGreaterThanOrEqual(3);
    expect(primeiro!.partes.achar).toBeGreaterThan(0);
    expect(primeiro!.partes.ler).toBeGreaterThan(0);
    for (const u of p.ultimos) expect(Object.values(u.partes).reduce((a, b) => a + b, 0)).toBe(u.tokens);
    expect(ultimo!.faro).toMatchObject({ kind: "certo" });
    expect(p.idas).toBe(primeiro!.idas + ultimo!.idas);
    expect(p.comFaro).toBe(2);
    expect(p.dePrimeira).toBe(1);
    // A 2ª ida da sessão leva a conversa de antes: a bagagem.
    expect(ultimo!.partes.bagagem).toBeGreaterThan(0);
  });

  test("o registro de entrega (T14682): na mesma janela, a nota lida de novo não vai; na conversa nova, vai", async () => {
    // Maior que o aviso: uma nota menor vai como está.
    const longa = `${NOTES["Projetos/Kiwi.md"]}\n## Equipe\n\nAna e Bruno, com a Carla nas reuniões de quinta e o Davi no desenho das telas.\n`;
    const m = make({ reader: memoryReader({ ...NOTES, "Projetos/Kiwi.md": longa }) });
    await readyNow(m);
    const first = await askAndWait(m, "o que tem sobre março?");
    expect((first.at(-1) as { text: string }).text).toContain("O prazo do Kiwi é março.");
    const again = await askAndWait(m, "e sobre março, de novo?");
    // O falso lembra a nota, como o agente de verdade pelo histórico: a leitura volta curta e ele responde igual.
    expect((again.at(-1) as { text: string }).text).toContain("(já estava comigo): # Kiwi");
    // O placar vê a leitura que encolheu: o "ler" do 2º pedido é menor.
    const [p2, p1] = m.svc.usageView().placar!.ultimos;
    expect(p2!.partes.ler).toBeLessThan(p1!.partes.ler);
    m.svc.newConversation();
    const fresh = await askAndWait(m, "o que tem sobre março?");
    expect((fresh.at(-1) as { text: string }).text).toContain("O prazo do Kiwi é março.");
  });

  test("as trilhas (T14682, T21325): o faro errou e o agente achou a nota; na segunda vez ela aprende, na terceira sobe; apagada, não", async () => {
    const notas = { "Projetos/Kiwi.md": "# Kiwi\n\nO cronograma do lançamento fica para março.\n", "Ideias.md": "gatos" };
    const m = make({ reader: memoryReader(notas) });
    await readyNow(m);
    await askAndWait(m, "na verdade, como anda o cronograma do lançamento?");
    expect(m.svc.usageView().placar!.ultimos[0]!.faro).toMatchObject({ kind: "nada", searched: true });
    // A primeira vez fica aprendendo: o enchimento ("verdade") nem entra, e a trilha não casa.
    const [t] = m.svc.trails().trilhas;
    expect(t).toMatchObject({ palavras: ["cronograma", "lançamento"], path: "Projetos/Kiwi.md", titulo: "Kiwi", vezes: 1, aprendendo: true });
    // O arquivo é só do Mac, 0600.
    expect(statSync(path.join(agentDir(m.data), "trilhas.json")).mode & 0o777).toBe(0o600);
    m.svc.newConversation();
    await askAndWait(m, "beleza, e o cronograma do lançamento?");
    expect(m.svc.usageView().placar!.ultimos[0]!.faro).toMatchObject({ kind: "nada" });
    expect(m.svc.trails().trilhas[0]).toMatchObject({ palavras: ["cronograma", "lançamento"], vezes: 2 });
    expect(m.svc.trails().trilhas[0]!.aprendendo).toBeUndefined();
    m.svc.newConversation();
    await askAndWait(m, "realmente, o cronograma do lançamento, como fica?");
    expect(m.svc.usageView().placar!.ultimos[0]!.faro).toMatchObject({ kind: "certo", how: "trilha" });
    // A trilha que acertou conta mais uma vez.
    expect(m.svc.trails().trilhas[0]!.vezes).toBe(3);
    expect(m.svc.trailDelete(t!.id).trilhas).toEqual([]);
    m.svc.newConversation();
    await askAndWait(m, "e o cronograma do lançamento, como fica?");
    expect(m.svc.usageView().placar!.ultimos[0]!.faro).toMatchObject({ kind: "nada" });
  });

  test("as trilhas pela pasta da maioria (T21325): o agente leu notas de pastas diferentes, e a trilha vai para a pasta com mais delas", async () => {
    const notas = { "Ideias.md": "gatos", "Horta Norte/Plantio.md": "canteiro", "Horta Norte/Colheita.md": "canteiro", "Horta Sul/Plantio.md": "x" };
    const m = make({ reader: memoryReader(notas) });
    await readyNow(m);
    const ler = (p: string) => `\n/tool notes_read ${JSON.stringify({ path: p })}`;
    await askAndWait(m, `na verdade, e o norte?${ler("Ideias.md")}${ler("Horta Norte/Colheita.md")}${ler("Horta Norte/Plantio.md")}`);
    const [t] = m.svc.trails().trilhas;
    // A primeira lida na pasta da maioria. O "norte" está no nome da pasta: vale na hora. (As linhas `/tool` do agente
    // falso fazem parte do pedido, e as palavras do caminho entram junto.)
    expect(t).toMatchObject({ path: "Horta Norte/Colheita.md", vezes: 1 });
    expect(t!.palavras).toContain("norte");
    expect(t!.aprendendo).toBeUndefined();
  });

  test("as trilhas pela leitura de uma seção (T14682): o faro certo não aprende; o errado aprende o caminho da nota", async () => {
    // A nota na raiz: a linha /tool do agente falso entra no faro, e uma pasta no caminho viraria outro candidato.
    const m = make({ reader: memoryReader({ "Kiwi.md": "# Kiwi\n\n## Prazo\n\nO prazo do Kiwi é março.\n", "Ideias.md": "gatos" }) });
    await readyNow(m);
    const prazo = `\n/tool notes_read ${JSON.stringify({ path: "Kiwi.md", section: "Prazo" })}`;
    await askAndWait(m, `Qual é o prazo do Kiwi?${prazo}`);
    expect(m.svc.usageView().placar!.ultimos[0]!.faro).toMatchObject({ kind: "certo", how: "nome" });
    // O faro achou a nota e o agente leu só a seção dela: nada a aprender.
    expect(m.svc.trails().trilhas).toEqual([]);
    m.svc.newConversation();
    await askAndWait(m, `e as datas das Ideias?${prazo}`);
    expect(m.svc.usageView().placar!.ultimos[0]!.faro).toMatchObject({ kind: "provavel" });
    // A trilha leva à nota, não à seção ("Kiwi.md › Prazo" nunca casaria um alvo).
    expect(m.svc.trails().trilhas).toEqual([expect.objectContaining({ path: "Kiwi.md", titulo: "Kiwi", vezes: 1 })]);
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

  describe("o limite depois de cada pedido (ADR 0013, #13853)", () => {
    const usages = (m: Made) => m.log().filter((l) => l.method === "session/usage").length;
    const waitFor = async (ok: () => boolean) => {
      for (let i = 0; i < 150 && !ok(); i++) await Bun.sleep(20);
    };
    const usageFile = (m: Made) => JSON.parse(readFileSync(path.join(agentDir(m.data), "usage.json"), "utf8")) as { entries: { limit?: { before?: { fiveHour?: number }; after?: { fiveHour?: number }; shared?: number } }[] };

    test("em segundo plano, depois da resposta, no máximo um a cada 10 min; só os números", async () => {
      const m = make({ limitProbe: { delayMs: 20 } });
      await readyNow(m);
      await askAndWait(m, "um");
      await waitFor(() => usages(m) === 1);
      await askAndWait(m, "dois");
      await Bun.sleep(150);
      // Um /usage só: o do segundo pedido cai nos mesmos 10 min. Nenhum turno a mais: o /usage não é ida ao modelo.
      expect(m.log().map((l) => l.method).filter((x) => x === "session/usage" || x === "session/prompt")).toEqual(["session/prompt", "session/usage", "session/prompt"]);
      expect(m.turns.filter((e) => e.type === "done").at(-1)).toMatchObject({ text: expect.stringContaining("turno 2") });
      const f = usageFile(m);
      expect(f.entries).toHaveLength(2);
      // O 1º pedido não tinha /usage antes; o 2º começa o trecho que o próximo /usage fecha.
      expect(f.entries[0]!.limit).toBeUndefined();
      expect(f.entries[1]!.limit).toEqual({ before: expect.objectContaining({ fiveHour: 37, week: 12 }) });
    });

    test("um pedido só entre dois /usage: o trecho é dele (revisão #13902)", async () => {
      const m = make({ limitProbe: { delayMs: 20, everyMs: 0 } });
      await readyNow(m);
      await askAndWait(m, "um");
      await waitFor(() => usages(m) === 1);
      await askAndWait(m, "dois");
      await waitFor(() => usages(m) === 2);
      await Bun.sleep(50);
      const f = usageFile(m);
      expect(f.entries[1]!.limit).toEqual({ before: expect.objectContaining({ fiveHour: 37 }), after: expect.objectContaining({ fiveHour: 37 }), shared: 1 });
    });

    test("dois pedidos entre dois /usage: o trecho é dos dois juntos, e nenhum fica com o par sozinho", async () => {
      const m = make({ limitProbe: { delayMs: 300, everyMs: 0 } });
      await readyNow(m);
      await askAndWait(m, "um");
      await waitFor(() => usages(m) === 1);
      // O "dois" e o "três" seguidos: o /usage do "dois" é pulado.
      await askAndWait(m, "dois");
      await askAndWait(m, "três");
      await waitFor(() => usages(m) === 2);
      await Bun.sleep(50);
      const f = usageFile(m);
      expect(f.entries.map((e) => e.limit?.shared)).toEqual([undefined, 2, 2]);
    });

    test("a pessoa mandou outro pedido antes: o /usage do anterior é pulado, e o pedido não espera", async () => {
      const m = make({ limitProbe: { delayMs: 300 } });
      await readyNow(m);
      await askAndWait(m, "um");
      await askAndWait(m, "dois");
      await Bun.sleep(150);
      // O do "um" foi pulado; o do "dois" ainda espera os 300 ms.
      expect(usages(m)).toBe(0);
      await waitFor(() => usages(m) === 1);
      expect(usages(m)).toBe(1);
    });

    test("o /usage não entra entre o começo do pedido e o turno dele: o pedido nunca dá E_AGENT_BUSY (main vermelha do #292)", async () => {
      // O `/usage` demora, e os ajustes do pedido carregam devagar: o relógio do /usage do "um" dispara bem nessa janela.
      const m = make({ limitProbe: { delayMs: 50 }, env: { KIWI_FAKE_AGENT_USAGE_DELAY_MS: "2000" } });
      await readyNow(m);
      await askAndWait(m, "um");
      const load = m.store.load.bind(m.store);
      let slow = true;
      m.store.load = async () => {
        if (slow) {
          slow = false;
          for (let i = 0; i < 15 && usages(m) === 0; i++) await Bun.sleep(20);
        }
        return load();
      };
      const turn = await askAndWait(m, "dois");
      expect(turn.find((e) => e.type === "error")).toBeUndefined();
      expect(turn.at(-1)).toMatchObject({ type: "done", text: expect.stringContaining("turno 2") });
    });

    test("com a conversa do gato na tela, ele espera ela acabar", async () => {
      const m = make({ limitProbe: { delayMs: 20, retryMs: 40 } });
      let open = true;
      m.svc.useConversationCheck(() => open);
      await readyNow(m);
      await askAndWait(m, "um");
      await Bun.sleep(200);
      expect(usages(m)).toBe(0);
      open = false;
      await waitFor(() => usages(m) === 1);
      expect(usages(m)).toBe(1);
    });

    test("nada depois de um pedido cancelado ou com erro", async () => {
      const m = make({ limitProbe: { delayMs: 20 } });
      await readyNow(m);
      await askAndWait(m, "/limite");
      const { id } = await m.svc.ask("/lento");
      await waitFor(() => m.turns.some((e) => e.id === id && e.type === "text"));
      await m.svc.cancel();
      await waitFor(() => m.turns.some((e) => e.id === id && e.type === "done"));
      await Bun.sleep(200);
      expect(usages(m)).toBe(0);
    });
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

  test("o /usage do medidor não segura o pedido da pessoa: feito enquanto o programa abre, o pedido espera e sai (T16712)", async () => {
    const m = make();
    await readyNow(m);
    // Abrir Ajustes › Agente pede o /usage, que abre o programa. Um pedido ao gato nesse meio tempo não pode dar
    // E_AGENT_BUSY: a pessoa não pediu nada antes.
    const usage = m.svc.usageRefresh();
    while ((await m.svc.status()).program !== "opening") await Bun.sleep(5);
    const events = await askAndWait(m, "oi");
    expect(events.find((e) => e.type === "error")).toBeUndefined();
    expect(events.some((e) => e.type === "done")).toBe(true);
    expect(m.log().filter((l) => l.method === "session/prompt")).toHaveLength(1);
    // O medidor não vê erro: ou leu o /usage, ou cedeu a vez e mostra o número que já tinha.
    await usage;
  }, 30_000);

  test("o /usage do medidor pedido logo antes do pedido da pessoa, com o programa aberto, não dá erro a nenhum dos dois (T16712)", async () => {
    const m = make();
    await readyNow(m);
    await askAndWait(m, "oi");
    // O medidor começa com o agente livre e, antes de ele chegar ao agente, a pessoa pede: com e sem um tique entre os dois.
    for (const gap of [0, 0, 1, 1, 2]) {
      const usage = m.svc.usageRefresh();
      if (gap) await Bun.sleep(0);
      const events = await askAndWait(m, `pedido ${gap}`);
      expect(events.find((e) => e.type === "error")).toBeUndefined();
      expect(await usage).toBeDefined();
    }
  }, 30_000);

  test("o /usage do medidor que já foi ao agente é cancelado para o pedido da pessoa: o pedido sai, o número fica o antigo e o próximo pedido responde (T16712)", async () => {
    const m = make({ env: { KIWI_FAKE_AGENT_USAGE_DELAY_MS: "3000" } });
    await readyNow(m);
    const first = await m.svc.usageRefresh();
    const usages = () => m.log().filter((l) => l.method === "session/usage").length;
    const usage = m.svc.usageRefresh();
    await until(() => usages() === 2);
    const start = Date.now();
    const events = await askAndWait(m, "oi");
    // Sem o cancelar, o pedido esperaria os 3 s do /usage.
    expect(Date.now() - start).toBeLessThan(2_000);
    expect(events.find((e) => e.type === "error")).toBeUndefined();
    expect(events.some((e) => e.type === "done")).toBe(true);
    expect((await usage).subscription).toEqual(first.subscription);
    const again = await askAndWait(m, "de novo");
    expect(again.find((e) => e.type === "error")).toBeUndefined();
    expect(again.some((e) => e.type === "done")).toBe(true);
  }, 30_000);

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
    expect(a).toBe(fixed + "oi");
    // A sessão é retomada (spec #13379): o mesmo começo fixo não vai de novo, porque já está no histórico.
    expect(b).toBe("outra coisa");
    // Com o modo econômico, o modelo vem antes, e as instruções econômicas depois: os dois sempre na mesma ordem.
    await m.svc.configure({ economy: true });
    await askAndWait(m, "oi");
    expect(prompts().at(-1)).toBe(fixed + ECONOMY_INSTRUCTIONS + "oi");
    // Mudar o modelo muda o começo fixo, e ele vai de novo; um erro ao ler não derruba o pedido.
    model = sanitizeNoteModel({ ...DEFAULT_NOTE_MODEL, numbered: true });
    await askAndWait(m, "oi");
    expect(prompts().at(-1)!.startsWith(noteModelText(model))).toBe(true);
    m.svc.useNoteModel(async () => { throw new Error("sem cofre"); });
    await askAndWait(m, "oi");
    expect(prompts().at(-1)).toBe(ECONOMY_INSTRUCTIONS + "oi");
  });

  test("dois pedidos seguidos (a conversa pelo Control, spec #13380) vão na mesma sessão do agente, que lembra do anterior", async () => {
    const m = make();
    await readyNow(m);
    await askAndWait(m, "qual o prazo do Kiwi?");
    await askAndWait(m, "e quem cuida do teste?");
    const prompts = m.log().filter((l) => l.method === "session/prompt");
    const opened = m.log().filter((l) => l.method === "session/new" || l.method === "session/resume" || l.method === "session/load");
    expect(prompts.length).toBeGreaterThanOrEqual(2);
    const [a, b] = prompts.slice(-2).map((l) => l.params.sessionId);
    expect(a).toBeTruthy();
    expect(b).toBe(a);
    // Uma abertura só: o segundo pedido continua a conversa, não abre outra.
    expect(opened).toHaveLength(1);
  });

  describe("o faro e o pacote (ADR 0013 peças 1 e 2, T14359)", () => {
    const promptsOf = (m: Made) => m.log().filter((l) => l.method === "session/prompt").map((l) => (l.params.prompt as { text: string }[])[0]!.text);

    test("a nota citada vai junto com o pedido, com o texto e a versão, e a Atividade diz que o Kiwi entregou", async () => {
      const m = make({ reader: memoryReader(NOTES) });
      await readyNow(m);
      const done = await askAndWait(m, "qual o prazo do Kiwi?");
      const sent = promptsOf(m).at(-1)!;
      expect(sent).toContain("[O Kiwi achou nas suas notas");
      expect(sent).toContain("nota: Projetos/Kiwi.md");
      expect(sent).toContain("O prazo do Kiwi é março.");
      expect(sent).toEndWith("[/O Kiwi achou]\n\nqual o prazo do Kiwi?");
      expect((await m.svc.activityLog())[0]!.reads).toContainEqual(expect.objectContaining({ tool: "faro", target: "Projetos/Kiwi.md" }));
      // O agente falso tira o pacote e responde ao pedido.
      expect(done.at(-1)).toMatchObject({ type: "done", text: expect.stringContaining("março") });
    });

    test('"essa nota" é a nota aberta na janela Notas; sem nada aberto, o agente pergunta qual (T19969)', async () => {
      const m = make({ reader: memoryReader(NOTES) });
      await readyNow(m);
      await askAndWait(m, "resume essa nota");
      expect(promptsOf(m).at(-1)).toContain(PACKAGE_HEAD_NONE);
      expect(promptsOf(m).at(-1)).not.toContain("nota: ");
      // "Aqui" sozinho, sem nada aberto, é só a palavra: nada vai.
      await askAndWait(m, "aqui está o que eu pensei para amanhã");
      expect(promptsOf(m).at(-1)).not.toContain("[O Kiwi achou");
      m.svc.setOpenNote("Ideias.md");
      await askAndWait(m, "resume essa nota");
      expect(promptsOf(m).at(-1)).toContain("nota: Ideias.md");
      expect(promptsOf(m).at(-1)).toContain("gatos");
    });

    test('"esse arquivo" é o arquivo aberto nas Notas: o cartão e o nome dito antes; fechada a janela, pergunta (T19969)', async () => {
      const m = make({ reader: memoryReader(NOTES) });
      await readyNow(m);
      m.svc.setOpenNote("Dados/dados-exemplo.csv");
      await askAndWait(m, "tá vendo esse arquivo aberto aqui? monta uma tabela com os totais");
      const p = promptsOf(m).at(-1)!;
      expect(p).toContain("arquivo aberto nas Notas: Dados/dados-exemplo.csv");
      expect(p).toContain("kiwi ler/arquivo");
      expect(p).toContain('("No dados-exemplo.csv:")');
      // A janela das Notas fechou (o Bun avisa com null): "esse arquivo" não é mais nada, e ele pergunta.
      m.svc.setOpenNote(null);
      await askAndWait(m, "nesse arquivo, soma a coluna B");
      expect(promptsOf(m).at(-1)).toContain(PACKAGE_HEAD_NONE);
    });

    test("renomear uma nota refaz o índice: o nome novo acha, o velho não (revisão do T14359)", async () => {
      const notes: Record<string, string> = { ...NOTES, "Trabalho/Plano de Viagem.md": "# Plano de Viagem\n\nsaída em março\n" };
      const m = make({ reader: memoryReader(notes) });
      await readyNow(m);
      await askAndWait(m, "o que diz o Plano de Viagem?");
      expect(promptsOf(m).at(-1)).toContain("nota: Trabalho/Plano de Viagem.md");
      // Renomeia com o mesmo número de notas e sem mudar o texto (o mtime fica igual).
      notes["Trabalho/Roteiro de Férias.md"] = notes["Trabalho/Plano de Viagem.md"]!;
      delete notes["Trabalho/Plano de Viagem.md"];
      await askAndWait(m, "o que diz o Roteiro de Férias?");
      expect(promptsOf(m).at(-1)).toContain("nota: Trabalho/Roteiro de Férias.md");
      await askAndWait(m, "o que diz o Plano de Viagem?");
      expect(promptsOf(m).at(-1)).not.toContain("Plano de Viagem.md");
    });

    test("um comando do agente e um pedido sem nome de nota vão sem pacote", async () => {
      const m = make({ reader: memoryReader(NOTES) });
      await readyNow(m);
      await askAndWait(m, "bom dia, tudo bem?");
      // A 1ª ida da janela leva a cápsula com o mapa da pasta (T13835); o pacote, não.
      expect(promptsOf(m).at(-1)).toEndWith("bom dia, tudo bem?");
      expect(promptsOf(m).at(-1)).not.toContain("[O Kiwi achou");
      await askAndWait(m, '/tool notes_read {"path":"Projetos/Kiwi.md"}');
      expect(promptsOf(m).at(-1)).not.toContain("[O Kiwi achou");
    });
  });

  describe("a janela curta e a cápsula (ADR 0013 peça 5, T13835)", () => {
    const sessions = (m: Made) => m.log().filter((l) => l.method === "session/prompt").map((l) => l.params.sessionId as string);
    const promptsOf = (m: Made) => m.log().filter((l) => l.method === "session/prompt").map((l) => (l.params.prompt as { text: string }[])[0]!.text);

    test("mais de 55 min sem ida: sessão nova, com os pedidos de antes, a resposta, a nota lida e o mapa; o começo fixo vai de novo", async () => {
      let t = Date.parse("2026-11-14T10:00:00Z");
      const m = make({ reader: memoryReader(NOTES), now: () => t });
      await readyNow(m);
      const model = sanitizeNoteModel({ ...DEFAULT_NOTE_MODEL, body: "topicos" });
      m.svc.useNoteModel(async () => model);
      await askAndWait(m, '/tool notes_read {"path":"Projetos/Kiwi.md"}');
      t += 54 * 60_000;
      await askAndWait(m, "e o prazo?");
      expect(new Set(sessions(m)).size).toBe(1);
      t += 56 * 60_000;
      await askAndWait(m, "voltei");
      const [s1, , s3] = sessions(m);
      expect(s3).not.toBe(s1);
      const last = promptsOf(m).at(-1)!;
      expect(last.startsWith(noteModelText(model))).toBe(true);
      const capsule = last.slice(noteModelText(model).length);
      expect(capsule).toStartWith("[A conversa de antes");
      expect(capsule).toContain('1. Pedido: /tool notes_read {"path":"Projetos/Kiwi.md"}');
      expect(capsule).toContain("Resposta: ");
      expect(capsule).toContain("2. Pedido: e o prazo?");
      expect(capsule).toContain("Notas tocadas: Projetos/Kiwi.md (lida)");
      expect(capsule).toContain("Mapa da pasta (notas por pasta):");
      expect(capsule).toEndWith("]\n\nvoltei");
      expect(modelTokens(capsule.slice(0, -"\n\nvoltei".length))).toBeLessThanOrEqual(CAPSULE_MAX_TOKENS);
      // O agente falso recomeça a contar: a conversa de antes ficou na outra sessão.
      expect(m.turns.filter((e) => e.type === "done").at(-1)).toMatchObject({ text: expect.stringContaining("turno 1") });
      expect(m.svc.windowState()).toMatchObject({ sessionId: s3, tokens: expect.any(Number) });
    });

    test("mais de 6 mil tokens de conversa: sessão nova; com a conversa do gato na tela, só depois que ela acaba", async () => {
      const m = make({ window: { maxTokens: 40 } });
      await readyNow(m);
      let open = true;
      m.svc.useConversationCheck(() => open);
      await askAndWait(m, "um pedido que já passa do teto pequeno deste teste, com palavras bastantes para isso");
      await askAndWait(m, "dois");
      await askAndWait(m, "três");
      expect(new Set(sessions(m)).size).toBe(1);
      expect(m.svc.windowState()!.tokens).toBeGreaterThan(40);
      open = false;
      await askAndWait(m, "quatro");
      const all = sessions(m);
      expect(all.at(-1)).not.toBe(all[0]);
      expect(promptsOf(m).at(-1)).toContain("3. Pedido: três");
      expect(m.svc.windowState()!.tokens).toBeGreaterThan(0);
    });

    test("a pessoa pede uma conversa nova: fecha no próximo pedido, mesmo com o gato na tela", async () => {
      const m = make();
      await readyNow(m);
      m.svc.useConversationCheck(() => true);
      await askAndWait(m, "um");
      m.svc.newConversation();
      await askAndWait(m, "dois");
      await askAndWait(m, "três");
      const [a, b, c] = sessions(m);
      expect(b).not.toBe(a);
      expect(c).toBe(b);
      expect(promptsOf(m)[1]).toContain("1. Pedido: um");
      expect(promptsOf(m)[2]).toBe("três");
    });

    test("o programa reabre dentro da hora: retoma a mesma janela, sem cápsula", async () => {
      const m = make({ idleMs: 1500 });
      await readyNow(m);
      await askAndWait(m, "um");
      const pid = m.pid();
      await until(() => !alive(pid), 8000);
      await askAndWait(m, "dois");
      const [a, b] = sessions(m);
      expect(b).toBe(a);
      expect(promptsOf(m).at(-1)).toBe("dois");
      expect(m.log().filter((l) => l.method === "session/new")).toHaveLength(1);
    });
  });

  test("o começo fixo vai uma vez por abertura (spec #13379): de novo quando muda, a cada 8 pedidos e depois que o programa reabre", async () => {
    const m = make({ idleMs: 2000 });
    await readyNow(m);
    const model = sanitizeNoteModel({ ...DEFAULT_NOTE_MODEL, body: "topicos" });
    m.svc.useNoteModel(async () => model);
    const fixed = noteModelText(model);
    const prompts = () => m.log().filter((l) => l.method === "session/prompt").map((l) => (l.params.prompt as { text: string }[])[0]!.text);
    for (let i = 1; i <= PREFIX_RESEND_EVERY + 1; i++) await askAndWait(m, `pedido ${i}`);
    const sent = prompts().slice(-(PREFIX_RESEND_EVERY + 1));
    expect(sent[0]).toBe(`${fixed}pedido 1`);
    for (let i = 1; i < PREFIX_RESEND_EVERY; i++) expect(sent[i]).toBe(`pedido ${i + 1}`);
    expect(sent[PREFIX_RESEND_EVERY]).toBe(`${fixed}pedido ${PREFIX_RESEND_EVERY + 1}`);
    // As instruções da pessoa mudaram: o começo fixo muda, e vai.
    await m.svc.configure({ instructions: "Sempre em tópicos." });
    await askAndWait(m, "depois das instruções");
    expect(prompts().at(-1)).toBe(`${fixed}${instructionsText("Sempre em tópicos.")}depois das instruções`);
    await askAndWait(m, "e mais um");
    expect(prompts().at(-1)).toBe("e mais um");
    // O programa fechou (o tempo sem uso) e abriu de novo: vai de novo, uma vez.
    const pid = m.pid();
    await until(() => !alive(pid), 8000);
    await askAndWait(m, "depois de reabrir");
    expect(prompts().at(-1)).toBe(`${fixed}${instructionsText("Sempre em tópicos.")}depois de reabrir`);
  });

  test("o modo econômico (spec #11084): as instruções e a lista das ferramentas idênticas, byte a byte, entre dois pedidos", async () => {
    const notes: Record<string, string> = { ...NOTES, "Longa.md": `# Longa\n\n## Um\n\n${"um texto ".repeat(600)}\n\n## Dois\n\n${"outro texto ".repeat(600)}\n` };
    // A lista crua das ferramentas passa dos 6 mil tokens da janela (T13835): aqui o teto sai, para comparar os bytes.
    const m = make({ reader: memoryReader(notes), writer: memoryWriter(notes), window: { maxTokens: Infinity } });
    await readyNow(m);
    const plain = (await askAndWait(m, "/ferramentas-cru")).at(-1) as { text: string };
    expect((await m.svc.configure({ economy: true })).economy).toBe(true);
    const a = (await askAndWait(m, "/ferramentas-cru")).at(-1) as { text: string };
    const b = (await askAndWait(m, "/ferramentas-cru")).at(-1) as { text: string };
    // A lista das ferramentas é a mesma nos dois pedidos, e a mesma sem o modo econômico (as descrições não mudam).
    expect(a.text).toBe(b.text);
    expect(a.text).toBe(plain.text);
    // As instruções vão na frente do pedido em que o modo econômico ligou; no seguinte, a sessão já as tem (spec #13379).
    const prompts = m.log().filter((l) => l.method === "session/prompt").map((l) => (l.params.prompt as { text: string }[])[0]!.text);
    const eco = prompts.slice(-2);
    expect(eco[0]).toBe(`${ECONOMY_INSTRUCTIONS}/ferramentas-cru`);
    expect(eco[1]).toBe("/ferramentas-cru");
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
  const MEETING_NOTE = "---\ntype: meeting\ndate: 2026-11-11\n---\n\n## Transcrição\n\n**Ana** (00:00): Vamos começar pelo 3º andar.\n";
  // Uma segunda reunião de teste, com um segredo dito na transcrição: o guardrail o segura antes de ir ao agente.
  const SECRET = "ghp_0123456789abcdefghijABCDEFGHIJ012345";
  const MEETING2_PATH = "Reuniões/2026-11-11 15h00 Meet.md";
  const MEETING2_NOTE = `---\ntype: meeting\ndate: 2026-11-11\n---\n\n## Transcrição\n\n**Bruno** (00:00): O token do CI é ${SECRET}.\n`;
  const MAIN = "Projetos/Mudança/Mudança.md";
  const MAIN_TEXT = "# Mudança\n\n## Pendências\n\n- [ ] Pedir o acesso\n";
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
  const NOTE = "Projetos/Mudança/2026-11-11 · Cronograma da mudança.md";

  test("a pedido: a proposta fica pendente sem escrever nada; [Ver] mostra a nota nova e a diferença; [Aplicar] escreve as duas, com [Desfazer]", async () => {
    const v = vault([project("Projetos/Mudança", "Mudança", MAIN)]);
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
      project: { folder: "Projetos/Mudança", name: "Mudança" },
      candidates: [],
      note: { folder: "Projetos/Mudança", title: "2026-11-11 · Cronograma da mudança" },
    });
    const view = await m.svc.proposalView(p!.id);
    expect(view.noteContent).toContain(`[[Reuniões/2026-11-11 10h00 Zoom|`);
    expect(view.noteContent).toContain("## Decisões\n\n- A mudança começa pelo 3º andar");
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
    // O aviso sai depois do [Aplicar] devolver (o `emitProposals` lê as settings antes): espera por ele, sem contar que
    // a leitura dele termine antes da do retorno. No runner carregado do #504, a 2ª terminava antes (T12910).
    await until(() => events.length >= 2);
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
    const v = vault([project("Projetos/Mudança", "Mudança", MAIN), project("Projetos/Rede", "Rede Norte", null)]);
    const m = make({ reader: v.reader, writer: v.writer });
    await readyNow(m);
    const before = { ...v.notes };
    await askAndWait(m, ASK);
    const [p] = (await m.svc.proposalsList());
    expect(p).toMatchObject({ project: null, candidates: [{ folder: "Projetos/Mudança", name: "Mudança" }, { folder: "Projetos/Rede", name: "Rede Norte" }] });
    await expect(m.svc.proposalApply(p!.id)).rejects.toMatchObject({ code: "E_BAD_ARGS" });
    await expect(m.svc.proposalChoose(p!.id, "Projetos/Outro")).rejects.toMatchObject({ code: "E_BAD_ARGS" });
    expect(await m.svc.proposalChoose(p!.id, "Projetos/Rede")).toMatchObject({ project: { name: "Rede Norte" }, candidates: [], note: { folder: "Projetos/Rede" } });
    // Um projeto sem nota principal: a proposta é só a nota da reunião.
    expect((await m.svc.proposalView(p!.id)).main).toBeNull();
    // A nota segue o Modelo de nota do cofre (T11478): com títulos numerados, o [Ver] já mostra a numeração.
    expect((await m.svc.proposalView(p!.id)).noteContent).toContain("## Resumo");
    m.svc.useNoteModel(async () => ({ ...DEFAULT_NOTE_MODEL, numbered: true }));
    const numbered = (await m.svc.proposalView(p!.id)).noteContent;
    expect(numbered).toContain("## 1. Resumo");
    expect(numbered).toContain('projeto: "Rede Norte"');
    expect(await m.svc.proposalDiscard(p!.id)).toMatchObject({ status: "discarded" });
    expect(v.notes).toEqual(before);
    await expect(m.svc.proposalApply(p!.id)).rejects.toMatchObject({ code: "E_BAD_ARGS" });

    // De novo, e "Nenhum: só a nota da reunião": a nota vai para a raiz, e a nota principal não muda.
    await askAndWait(m, ASK);
    const [q] = (await m.svc.proposalsList()).filter((x) => x.status === "pending");
    expect(await m.svc.proposalChoose(q!.id, null)).toMatchObject({ project: null, candidates: [], note: { folder: "" } });
    expect(await m.svc.proposalApply(q!.id)).toMatchObject({ status: "applied", notePath: "2026-11-11 · Cronograma da mudança.md" });
    expect(v.notes[MAIN]).toBe(MAIN_TEXT);
    await expect(m.svc.proposalView("nao-existe")).rejects.toMatchObject({ code: "E_NOT_FOUND" });
  });

  test("um [Aplicar] que parou depois de gravar a nota principal não repete a reunião nela no [Aplicar] seguinte", async () => {
    const v = vault([project("Projetos/Mudança", "Mudança", MAIN)]);
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
    expect(v.notes[MAIN]!.match(/Cronograma da mudança\]\]/g)).toHaveLength(1);
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
    const v = vault([project("Projetos/Mudança", "Mudança", MAIN)]);
    const m = make({ reader: v.reader, writer: v.writer });
    await readyNow(m);
    const before = { ...v.notes };
    await m.svc.meetingReady(MEETING2_PATH);
    const p = await untilAsync(async () => (await m.svc.proposalsList()).find((x) => x.status === "pending"));
    expect(p).toMatchObject({ meeting: { path: MEETING2_PATH }, project: { name: "Mudança" } });
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
    const v = vault([project("Projetos/Mudança", "Mudança", MAIN)]);
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
  const MAIN = "Projetos/Mudança/Mudança.md";
  const MEETING = "Projetos/Mudança/2026-11-10 · Cronograma.md";
  const MAIN_TEXT = "# Mudança\n\nO projeto da mudança do SILO.\n\n## Pendências\n\n- [ ] Pedir o acesso\n";
  const OLD = "# Mudança\n\n## Resumo executivo\n\n**Situação:** 🟢 No rumo · 01/11/2026\n\n### Decisões\n\n- Uma decisão velha ([[Projetos/Mudança/Mudança|Mudança]])\n\n## Pendências\n\n- [ ] Pedir o acesso\n";
  const project = (folder: string, name: string, main: string | null) => ({ folder, name, main, updated: null, notes: 2 });
  function vault(main: string, projects = [project("Projetos/Mudança", "Mudança", MAIN)]) {
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
  const ASK = "faz o resumo executivo do projeto Mudança";
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
    expect(turn.at(-1)).toMatchObject({ type: "done", text: 'Preparei o resumo executivo de "Mudança". Veja e aplique no Kiwi.' });
    expect(v.notes).toEqual(before);
    const [p] = await m.svc.proposalsList();
    // O primeiro resumo conta os últimos 14 dias (o padrão de Ajustes).
    const since = new Date(Date.now() - 14 * 86_400_000);
    const sinceIso = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, "0")}-${String(since.getDate()).padStart(2, "0")}`;
    expect(p).toMatchObject({ kind: "summary", status: "pending", meeting: null, note: null, project: { folder: "Projetos/Mudança" }, summary: { signal: "amarelo", since: sinceIso } });
    const view = await m.svc.proposalView(p!.id);
    const s = view.noteContent;
    const order = [
      "## Resumo executivo",
      `**Situação:** 🟡 Atenção · ${day(new Date())} · a mudança atrasou uma semana`,
      `### O que andou desde ${day(since)}`,
      "### Decisões",
      "### Riscos e bloqueios",
      "### Próximos passos",
      "### Reuniões recentes",
    ].map((x) => s.indexOf(x));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(s).toContain("- A mudança começa pelo 3º andar (10/11/2026, [[Projetos/Mudança/2026-11-10 · Cronograma|2026-11-10 · Cronograma]])");
    expect(s).toContain("- [ ] Confirmar a janela de manutenção (Ana, sexta) · [[Projetos/Mudança/Mudança|Mudança]]");
    expect(s).toContain("- 10/11/2026 · [[Projetos/Mudança/2026-11-10 · Cronograma|Cronograma]]");
    expect(view.replaces).toBeUndefined();
    expect(view.main!.lines.filter((l) => !l.added).map((l) => l.text)).toEqual(MAIN_TEXT.split("\n"));
    expect(v.notes).toEqual(before);

    const applied = await m.svc.proposalApply(p!.id);
    expect(applied).toMatchObject({ kind: "summary", status: "applied" });
    expect(v.notes[MAIN]!.startsWith(`# Mudança\n\n${s}\nO projeto da mudança do SILO.`)).toBe(true);
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
    const v = vault(MAIN_TEXT, [project("Projetos/Mudança", "Mudança", MAIN), project("Projetos/Mudança Beta", "Mudança Beta", null)]);
    const m = make({ reader: v.reader, writer: v.writer });
    await readyNow(m);
    await askAndWait(m, ASK);
    const [p] = await m.svc.proposalsList();
    expect(p).toMatchObject({ kind: "summary", project: null, candidates: [{ folder: "Projetos/Mudança" }, { folder: "Projetos/Mudança Beta" }], summary: { since: "" } });
    await expect(m.svc.proposalApply(p!.id)).rejects.toMatchObject({ code: "E_BAD_ARGS" });
    await expect(m.svc.proposalChoose(p!.id, null)).rejects.toMatchObject({ code: "E_BAD_ARGS" });
    // Um candidato sem nota principal é recusado na escolha, não no [Aplicar]; a pergunta continua aberta.
    await expect(m.svc.proposalChoose(p!.id, "Projetos/Mudança Beta")).rejects.toThrow("não tem nota principal");
    expect((await m.svc.proposalsList())[0]).toMatchObject({ project: null, candidates: [{}, {}] });
    const chosen = await m.svc.proposalChoose(p!.id, "Projetos/Mudança");
    expect(chosen).toMatchObject({ project: { folder: "Projetos/Mudança" }, candidates: [] });
    expect(chosen.summary!.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await m.svc.proposalApply(p!.id);
    expect(v.notes[MAIN]).toContain("## Resumo executivo");
  });

  test("um projeto sem nota principal: a ferramenta recusa, o agente diz, e nenhum balão nasce", async () => {
    const v = vault(MAIN_TEXT, [project("Projetos/Mudança", "Mudança", null)]);
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
    expect(seen.at(-1)).toMatchObject({ facts: ["eu prefiro respostas curtas"], max: 60, changes: [{ action: "remember", fact: "eu prefiro respostas curtas" }] });
    const [r] = await m.svc.activityLog();
    expect(r!.reads).toContainEqual(expect.objectContaining({ tool: "memory_remember", target: "eu prefiro respostas curtas" }));
    // O pedido seguinte leva a memória no começo fixo; o outro, com a mesma memória, não a leva de novo (spec #13379).
    await askAndWait(m, "Oi");
    await askAndWait(m, "Oi de novo");
    const prompts = m.log().filter((l) => l.method === "session/prompt").map((l) => (l.params.prompt as { text: string }[])[0]!.text);
    expect(prompts.at(-2)).toStartWith("[O que você sabe sobre a pessoa (a memória do Kiwi).");
    expect(prompts.at(-1)).toBe("Oi de novo");
    expect(prompts.at(-2)).toContain("- eu prefiro respostas curtas\n]");
    // O [Desfazer] do balão tira o fato, e o balão sabe que foi desfeito.
    const undone = await m.svc.memoryUndo(seen.at(-1)!.changes[0]!.id);
    expect(undone).toMatchObject({ facts: [], changes: [{ undone: true }] });
    expect(await m.svc.memoryView()).toMatchObject({ facts: [] });
    await expect(m.svc.memoryUndo("nao-existe")).rejects.toMatchObject({ code: "E_NOT_FOUND" });
    // "esquece que…" com o fato de volta, e o [Desfazer] traz o fato no mesmo lugar.
    await askAndWait(m, "lembra que trabalho com SILO");
    await askAndWait(m, "lembra que uso o Mac");
    await askAndWait(m, "esquece que trabalho com SILO");
    expect((await m.svc.memoryView()).facts).toEqual(["uso o Mac"]);
    await m.svc.memoryUndo((await m.svc.memoryView()).changes.at(-1)!.id);
    expect((await m.svc.memoryView()).facts).toEqual(["trabalho com SILO", "uso o Mac"]);
    // Duas anotações no mesmo pedido: as duas vão para o balão, cada uma com o seu [Desfazer] (revisão do T11665).
    await askAndWait(m, '/tool memory_remember {"fato":"mora em BH"}\n/tool memory_remember {"fato":"tem um gato"}');
    const both = await m.svc.memoryView();
    expect(both.changes.map((c) => c.fact)).toEqual(["mora em BH", "tem um gato"]);
    await m.svc.memoryUndo(both.changes[0]!.id);
    expect((await m.svc.memoryView()).facts).toEqual(["trabalho com SILO", "uso o Mac", "tem um gato"]);
    expect((await m.svc.memoryView()).changes).toMatchObject([{ fact: "mora em BH", undone: true }, { fact: "tem um gato" }]);
    // Um fato que já estava lá não muda nada: a Atividade não diz "Anotou".
    await askAndWait(m, "lembra que tem um gato");
    const [r2] = await m.svc.activityLog();
    expect(r2!.reads.find((x) => x.tool === "memory_remember")?.target).toBeUndefined();
  });

  test("a memória cheia (T11808): o fato não entra, o agente recebe o erro e o balão avisa, sem [Desfazer]", async () => {
    const root = tmp();
    const notes: Record<string, string> = { ...NOTES };
    const m = make({ reader: memoryReader(notes), writer: memoryWriter(notes) });
    m.svc.useVaultRoot(async () => root);
    const seen: AgentMemoryView[] = [];
    m.svc.onMemoryChanged((v) => seen.push(v));
    await readyNow(m);
    const full = Array.from({ length: 60 }, (_, i) => `fato ${i + 1}`);
    await m.svc.memorySet(full);
    const turn = await askAndWait(m, "lembra que tem um gato");
    expect(JSON.stringify(turn.at(-1))).toContain("E_MEMORY_FULL");
    expect((await m.svc.memoryView()).facts).toEqual(full);
    const v = seen.at(-1)!;
    expect(v.facts).toEqual(full);
    expect(v.changes).toEqual([expect.objectContaining({ action: "full", fact: "tem um gato" })]);
    await expect(m.svc.memoryUndo(v.changes[0]!.id)).rejects.toMatchObject({ code: "E_BAD_ARGS" });
    expect((await m.svc.memoryView()).facts).toEqual(full);
  });

  test("a memória escrita à mão passou do limite (spec #12749): o agente não muda nada, o balão avisa com o motivo, e Ajustes arruma sem apagar o resto", async () => {
    const root = tmp();
    const notes: Record<string, string> = { ...NOTES };
    const m = make({ reader: memoryReader(notes), writer: memoryWriter(notes) });
    m.svc.useVaultRoot(async () => root);
    const seen: AgentMemoryView[] = [];
    m.svc.onMemoryChanged((v) => seen.push(v));
    await readyNow(m);
    const file = path.join(root, ".kiwi/agente/sobre-mim.md");
    mkdirSync(path.dirname(file), { recursive: true });
    const longo = "x".repeat(400);
    const text = `- prefiro respostas curtas\n- ${longo}\n\nUma observação minha, fora da lista.\n`;
    writeFileSync(file, text);
    // Ajustes vê o fato de fora e a linha que não é fato.
    expect(await m.svc.memoryView()).toMatchObject({ facts: ["prefiro respostas curtas"], skipped: [{ text: longo, reason: "long" }], outside: 1 });
    // O agente lê só o fato válido.
    await askAndWait(m, "Oi");
    const prompt = m.log().filter((l) => l.method === "session/prompt").map((l) => (l.params.prompt as { text: string }[])[0]!.text).at(-1)!;
    expect(prompt).toContain("- prefiro respostas curtas\n]");
    expect(prompt).not.toContain(longo);
    // "lembra que…" e "esquece…": nada muda no arquivo, o agente recebe o erro e o balão avisa, sem [Desfazer].
    for (const ask of ["lembra que tem um gato", "esquece que prefiro respostas curtas"]) {
      const turn = await askAndWait(m, ask);
      expect(JSON.stringify(turn.at(-1))).toContain("E_MEMORY_OVER");
      expect(readFileSync(file, "utf8")).toBe(text);
    }
    const v = seen.at(-1)!;
    expect(v.changes.at(-1)).toMatchObject({ action: "over", over: { facts: 2, long: 1 } });
    await expect(m.svc.memoryUndo(v.changes.at(-1)!.id)).rejects.toMatchObject({ code: "E_BAD_ARGS" });
    // Editar um fato em Ajustes não mexe no de fora nem no parágrafo.
    await m.svc.memorySet(["prefiro respostas bem curtas"]);
    expect(readFileSync(file, "utf8")).toBe(`- prefiro respostas bem curtas\n- ${longo}\n\nUma observação minha, fora da lista.\n`);
    // Encurtar o longo em Ajustes: ele vira fato, a linha longa sai, e o agente volta a mudar a memória.
    expect(await m.svc.memorySet(["prefiro respostas bem curtas", "x".repeat(20)], [])).toMatchObject({ skipped: [], outside: 1 });
    expect((await askAndWait(m, "lembra que tem um gato")).at(-1)).toMatchObject({ type: "done", text: "Anotei: tem um gato." });
    expect(readFileSync(file, "utf8")).toBe(`- prefiro respostas bem curtas\n- ${"x".repeat(20)}\n- tem um gato\n\nUma observação minha, fora da lista.\n`);
    // "Apagar tudo": os fatos saem, o parágrafo fica.
    await m.svc.memoryClear();
    expect(readFileSync(file, "utf8")).toBe("\nUma observação minha, fora da lista.\n");
  });

  test("as instruções e o glossário (T11667): no começo fixo, na ordem, os mesmos bytes em dois pedidos seguidos; no modo econômico, só os termos do pedido", async () => {
    const root = tmp();
    const notes: Record<string, string> = { ...NOTES };
    const m = make({ reader: memoryReader(notes), writer: memoryWriter(notes) });
    m.svc.useVaultRoot(async () => root);
    m.svc.useGlossary(async () => ["ORBIT", "kubectl"]);
    await readyNow(m);
    await askAndWait(m, "lembra que trabalho com SILO");
    expect((await m.svc.configure({ instructions: "Sempre em português." })).instructions).toBe("Sempre em português.");
    await askAndWait(m, "Oi");
    await askAndWait(m, "Oi de novo");
    const prompts = m.log().filter((l) => l.method === "session/prompt").map((l) => (l.params.prompt as { text: string }[])[0]!.text);
    const fixed = (t: string, ask: string) => t.slice(0, t.length - ask.length);
    const a = fixed(prompts.at(-2)!, "Oi");
    // O mesmo começo fixo não vai de novo no pedido seguinte (spec #13379): a sessão já o tem.
    expect(fixed(prompts.at(-1)!, "Oi de novo")).toBe("");
    expect(a.indexOf("[O que você sabe sobre a pessoa")).toBe(0);
    expect(a.indexOf("[As instruções da pessoa")).toBeGreaterThan(a.indexOf("- trabalho com SILO"));
    expect(a.indexOf("[O glossário da pessoa")).toBeGreaterThan(a.indexOf("Sempre em português."));
    expect(a).toContain("[O glossário da pessoa: escreva estes termos assim. ORBIT; kubectl]\n\n");
    // O modo econômico: o glossário só com os termos que aparecem no pedido.
    await m.svc.configure({ economy: true });
    await askAndWait(m, "converta o orbit");
    const eco = m.log().filter((l) => l.method === "session/prompt").map((l) => (l.params.prompt as { text: string }[])[0]!.text).at(-1)!;
    expect(eco).toContain("[O glossário da pessoa: escreva estes termos assim. ORBIT]\n\n");
    expect(eco).not.toContain("kubectl");
    // No econômico, o glossário (que muda a cada pedido) vai por último, depois das instruções do econômico: o cache.
    expect(eco.indexOf("[O glossário da pessoa")).toBeGreaterThan(eco.indexOf("[Modo econômico do Kiwi"));
    // Instruções com um segredo são recusadas, e nada muda (revisão do T11667).
    await expect(m.svc.configure({ instructions: "use o token ghp_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8 no CI" })).rejects.toMatchObject({ code: "E_SECRET" });
    expect((await m.svc.status()).instructions).toBe("Sempre em português.");
  });

  test("Ajustes › Memória (T11668): a pessoa edita e apaga a lista, um segredo é recusado, e \"Apagar tudo\" esvazia; o balão não abre", async () => {
    const root = tmp();
    const m = make();
    m.svc.useVaultRoot(async () => root);
    const seen: AgentMemoryView[] = [];
    m.svc.onMemoryChanged((v) => seen.push(v));
    expect(await m.svc.memorySet(["prefere respostas curtas", "  trabalha  com SILO ", ""])).toMatchObject({ facts: ["prefere respostas curtas", "trabalha com SILO"], changes: [] });
    expect(readFileSync(path.join(root, ".kiwi/agente/sobre-mim.md"), "utf8")).toContain("- trabalha com SILO\n");
    // Editar uma linha e apagar outra é mandar a lista nova.
    expect((await m.svc.memorySet(["prefere respostas bem curtas"])).facts).toEqual(["prefere respostas bem curtas"]);
    // Um fato com cara de token é recusado, e a memória não muda.
    await expect(m.svc.memorySet(["prefere respostas bem curtas", "o token é ghp_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"])).rejects.toMatchObject({ code: "E_SECRET" });
    await expect(m.svc.memorySet(Array.from({ length: 61 }, (_, i) => `fato ${i}`))).rejects.toMatchObject({ code: "E_BAD_ARGS" });
    await expect(m.svc.memorySet("x" as unknown as string[])).rejects.toMatchObject({ code: "E_BAD_ARGS" });
    expect((await m.svc.memoryView()).facts).toEqual(["prefere respostas bem curtas"]);
    expect((await m.svc.memoryClear()).facts).toEqual([]);
    // As mudanças da pessoa não são do agente: nenhuma entra nas `changes` do balão.
    expect(seen.every((v) => v.changes.length === 0)).toBe(true);
    expect(seen.at(-1)!.facts).toEqual([]);
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

describe("as rotinas (spec #12150)", () => {
  /** 16/11/2026 é uma segunda-feira; o relógio do serviço anda só quando o teste manda. */
  const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).getTime();
  function routines(clockStart: number) {
    const notes: Record<string, string> = { ...NOTES };
    const clock = { now: clockStart };
    const m = make({ reader: memoryReader(notes), writer: memoryWriter(notes), now: () => clock.now });
    const events: AgentRoutineEvent[] = [];
    m.svc.onRoutine((e) => events.push(e));
    /**
     * Uma conferência do agendador na hora dada; espera o pedido que ela começar acabar de vez. O `done` sai antes do fim
     * do pedido (a rotina ainda lê a Atividade para achar a nota): espera um evento novo da rotina, e não um de antes,
     * e o agente livre. Sem isso, o "Rodar agora" logo depois caía em E_AGENT_BUSY no CI carregado (#13738).
     */
    const tick = async (when: number) => {
      clock.now = when;
      const before = m.turns.filter((e) => e.type === "started").length;
      const seen = events.length;
      await m.svc.routineTick();
      const started = m.turns.filter((e) => e.type === "started");
      if (started.length === before) return null;
      const id = started.at(-1)!.id;
      await until(() => m.turns.some((e) => e.id === id && (e.type === "done" || e.type === "error")));
      await until(() => events.length > seen || m.turns.some((e) => e.id === id && e.type === "error"));
      await untilIdle(m);
      return id;
    };
    return { m, notes, clock, events, tick };
  }

  test("nascem desligadas, e ligar ou mudar a hora fica no status", async () => {
    const r = routines(at(16, 10));
    await readyNow(r.m);
    expect((await r.m.svc.status()).routines).toEqual(DEFAULT_AGENT_ROUTINES);
    const s = await r.m.svc.configure({ routines: { daily: { on: true, time: "18:30", folder: "Diário/Resumos" } } });
    expect(s.routines.daily).toEqual({ on: true, time: "18:30", folder: "Diário/Resumos", lastRun: null, armedAt: new Date(at(16, 10)).toISOString() });
    expect(s.routines.weekly.on).toBe(false);
    // Os pendentes, desligados, não rodam nem na hora deles; o resumo, ligado, só às 18h30.
    expect(await r.tick(at(16, 18, 29))).toBeNull();
    expect(r.events).toEqual([]);
  });

  // As rotinas novas (spec #12944): pelo botão "Nova rotina" e pela proposta do agente.
  const NEW = { name: "Resumo das reuniões", prompt: "Faz um resumo das reuniões do dia.", time: "18:00", days: "every" as const, folder: "Rotinas" };

  test("rotina nova: entra desligada; dá para editar, ligar e apagar; o campo que não vale diz qual; as prontas só desligam", async () => {
    const r = routines(at(16, 10));
    await readyNow(r.m);
    const s = await r.m.svc.routineCreate(NEW);
    expect(s.routines.custom).toEqual([{ id: expect.stringMatching(/^r-[a-z0-9]{8}$/), ...NEW, on: false, lastRun: null, armedAt: null }]);
    const id = s.routines.custom[0]!.id;
    const edited = await r.m.svc.routineUpdate(id, { name: "Reuniões do dia", days: [1, 3, 5], on: true });
    expect(edited.routines.custom[0]).toMatchObject({ name: "Reuniões do dia", days: [1, 3, 5], on: true, armedAt: new Date(at(16, 10)).toISOString() });
    await expect(r.m.svc.routineUpdate(id, { time: "18h" })).rejects.toMatchObject({ code: "E_BAD_ARGS", message: "Falta ou não vale a hora (HH:MM)." });
    await expect(r.m.svc.routineCreate({ ...NEW, name: "" })).rejects.toMatchObject({ code: "E_BAD_ARGS", message: "Falta ou não vale o nome (até 60 caracteres)." });
    expect((await r.m.svc.routineDelete(id)).routines.custom).toEqual([]);
    await expect(r.m.svc.routineDelete(id)).rejects.toMatchObject({ code: "E_NOT_FOUND" });
    await expect(r.m.svc.routineRun({ kind: "custom", id })).rejects.toMatchObject({ code: "E_NOT_FOUND" });
    // Desligar o agente desliga as novas também.
    const again = await r.m.svc.routineCreate(NEW);
    await r.m.svc.routineUpdate(again.routines.custom[0]!.id, { on: true });
    await r.m.svc.disable();
    expect((await r.m.svc.status()).routines.custom[0]!.on).toBe(false);
  });

  test("as gravações das rotinas não se atropelam: criar junto com ligar uma pronta, e criar junto com desligar o agente (revisão do T13010)", async () => {
    const r = routines(at(16, 10));
    await readyNow(r.m);
    for (let i = 0; i < 10; i++) {
      await Promise.all([r.m.svc.routineCreate({ ...NEW, name: `Nova ${i}` }), r.m.svc.configure({ routines: { daily: { on: i % 2 === 0 } } })]);
      const s = await r.m.svc.status();
      expect(s.routines.custom.map((x) => x.name)).toContain(`Nova ${i}`);
      expect(s.routines.daily.on).toBe(i % 2 === 0);
    }
    await r.m.svc.configure({ routines: { daily: { on: true } } });
    await Promise.all([r.m.svc.routineCreate({ ...NEW, name: "Junto do desligar" }), r.m.svc.disable()]);
    const off = (await r.m.svc.status()).routines;
    expect([off.daily.on, off.weekly.on, ...off.custom.map((x) => x.on)].every((on) => on === false)).toBe(true);
  });

  test("rotina nova, ligada, roda na hora certa com o relógio falso, como as prontas, e só nos dias dela", async () => {
    const r = routines(at(16, 10));
    await readyNow(r.m);
    const id = (await r.m.svc.routineCreate({ ...NEW, days: "weekdays" })).routines.custom[0]!.id;
    // Desligada, não roda (o relógio fica às 17h: ligar depois das 18h já não conta o horário de hoje).
    expect(await r.tick(at(16, 17))).toBeNull();
    await r.m.svc.routineUpdate(id, { on: true });
    expect(await r.tick(at(16, 17, 59))).toBeNull();
    const req = await r.tick(at(16, 18));
    expect(req).toBeTruthy();
    const note = "Rotinas/Resumo das reuniões de 16-11-2026.md";
    expect(r.notes[note]).toBeDefined();
    expect(r.events).toEqual([{ kind: "custom", id, name: "Resumo das reuniões", phase: "done", request: req!, note, change: 1 }]);
    const log = (await r.m.svc.activityLog())[0]!;
    expect(log.request).toStartWith("[Rotina do Kiwi] Resumo das reuniões, 16/11/2026.");
    expect(log.request).toContain("Faz um resumo das reuniões do dia.");
    expect((await r.m.svc.status()).routines.custom[0]!.lastRun).toBe(new Date(at(16, 18)).toISOString());
    expect(await r.tick(at(16, 19))).toBeNull();
    // Sábado (21/11) não é dia útil; segunda (23/11) é.
    expect(await r.tick(at(21, 18, 5))).toBeNull();
    expect(await r.tick(at(23, 18, 5))).toBeTruthy();
    // "Rodar agora", pelo id, mesmo desligada.
    await r.m.svc.routineUpdate(id, { on: false });
    const manual = await r.m.svc.routineRun({ kind: "custom", id });
    await until(() => r.events.some((e) => e.phase === "done" && e.request === manual.id));
  });

  test("pedir ao agente: a proposta da rotina fica pendente; [Criar] a cria desligada; o [Ajustar] cria com o cartão; [Descartar] não cria", async () => {
    const r = routines(at(16, 10));
    await readyNow(r.m);
    const turn = await askAndWait(r.m, "todo dia às 18h, faz um resumo das reuniões");
    expect(turn.at(-1)).toMatchObject({ type: "done", text: 'Preparei a rotina "Resumo das reuniões", todo dia às 18:00. Ela entra desligada: crie, ajuste ou descarte.' });
    expect((await r.m.svc.status()).routines.custom).toEqual([]);
    const [p] = await r.m.svc.proposalsList();
    expect(p).toMatchObject({ kind: "routine", status: "pending", routine: { name: "Resumo das reuniões", prompt: "Faz um resumo das reuniões.", time: "18:00", days: "every", folder: "Rotinas" } });
    expect(await r.m.svc.proposalApply(p!.id)).toMatchObject({ kind: "routine", status: "applied" });
    expect((await r.m.svc.status()).routines.custom).toEqual([expect.objectContaining({ name: "Resumo das reuniões", on: false, time: "18:00" })]);
    await expect(r.m.svc.proposalApply(p!.id)).rejects.toMatchObject({ code: "E_BAD_ARGS" });

    // [Ajustar]: o cartão manda os campos mudados, e a rotina entra com eles.
    await askAndWait(r.m, "dias úteis às 9h, me manda os pendentes do dia");
    const q = (await r.m.svc.proposalsList()).find((x) => x.status === "pending")!;
    expect(q.routine).toMatchObject({ name: "Os pendentes do dia", time: "09:00", days: "weekdays" });
    const adjusted = { ...q.routine!, time: "08:30", days: [1, 3] };
    expect(await r.m.svc.proposalApply(q.id, adjusted)).toMatchObject({ status: "applied", routine: adjusted });
    expect((await r.m.svc.status()).routines.custom.map((x) => [x.name, x.time, x.days, x.on])).toEqual([
      ["Resumo das reuniões", "18:00", "every", false],
      ["Os pendentes do dia", "08:30", [1, 3], false],
    ]);

    // [Descartar]: nada é criado.
    await askAndWait(r.m, "todo dia às 7h, faz a lista do dia");
    const d = (await r.m.svc.proposalsList()).find((x) => x.status === "pending")!;
    await r.m.svc.proposalDiscard(d.id);
    expect((await r.m.svc.status()).routines.custom).toHaveLength(2);
  });

  test("ligada, roda na hora, cria a nota pela escrita de sempre, e não roda duas vezes no dia", async () => {
    const r = routines(at(16, 10));
    await readyNow(r.m);
    await r.m.svc.configure({ routines: { daily: { on: true } } });
    expect(await r.tick(at(16, 17, 59))).toBeNull();
    const id = await r.tick(at(16, 18));
    expect(id).toBeTruthy();
    expect(r.notes["Rotinas/Resumo de 16-11-2026.md"]).toContain("## Próximos passos");
    expect(r.events).toEqual([{ kind: "daily", phase: "done", request: id!, note: "Rotinas/Resumo de 16-11-2026.md", change: 1 }]);
    // A Atividade registra a criação (o [Desfazer] de sempre).
    const log = (await r.m.svc.activityLog())[0]!;
    expect(log.id).toBe(id!);
    expect(log.request).toStartWith("[Rotina do Kiwi]");
    expect(log.changes).toEqual([expect.objectContaining({ kind: "created", path: "Rotinas/Resumo de 16-11-2026.md" })]);
    expect((await r.m.svc.status()).routines.daily.lastRun).toBe(new Date(at(16, 18)).toISOString());
    expect(await r.tick(at(16, 18, 30))).toBeNull();
    // No dia seguinte, de novo.
    expect(await r.tick(at(17, 18, 1))).toBeTruthy();
    expect(r.notes["Rotinas/Resumo de 17-11-2026.md"]).toBeDefined();
  });

  test("com o app fechado na hora: roda uma vez ao abrir no mesmo dia; no dia seguinte, o de ontem pula", async () => {
    const r = routines(at(16, 10));
    await readyNow(r.m);
    await r.m.svc.configure({ routines: { daily: { on: true }, weekly: { on: true } } });
    // Os pendentes da semana (segunda, 9h) ficaram para trás: armados às 10h, só na próxima segunda.
    expect(await r.tick(at(16, 22, 40))).toBeTruthy();
    expect(r.events.map((e) => e.kind)).toEqual(["daily"]);
    expect(await r.tick(at(16, 23))).toBeNull();
    // Abriu só na quarta de manhã: o resumo de terça não roda mais, e o de quarta ainda não chegou.
    expect(await r.tick(at(18, 8))).toBeNull();
    // Na segunda seguinte, os pendentes rodam às 9h, com a nota deles.
    expect(await r.tick(at(23, 9, 5))).toBeTruthy();
    expect(r.notes["Rotinas/Pendentes da semana de 23-11-2026.md"]).toContain("- [ ]");
  });

  test("com o agente ocupado, espera o pedido de agora e roda na conferência seguinte", async () => {
    const r = routines(at(16, 10));
    await readyNow(r.m);
    await r.m.svc.configure({ routines: { daily: { on: true } } });
    r.clock.now = at(16, 18);
    const { id } = await r.m.svc.ask("/lento");
    expect(await r.tick(at(16, 18))).toBeNull();
    await until(() => r.m.turns.some((e) => e.id === id && e.type === "done"));
    expect(await r.tick(at(16, 18, 1))).toBeTruthy();
  });

  test("com o modo econômico, pergunta antes: o não para tudo e avisa; o Rodar agora não pergunta", async () => {
    const r = routines(at(16, 10));
    await readyNow(r.m);
    await r.m.svc.configure({ economy: true, routines: { daily: { on: true } } });
    r.clock.now = at(16, 18);
    void r.m.svc.routineTick();
    await until(() => !!r.m.svc.question());
    const card = r.m.svc.question()!;
    expect(card.items).toEqual([expect.objectContaining({ kind: "confirm", value: routineEconomyQuestion(ROUTINE_LABELS.daily) })]);
    await r.m.svc.answerDoubt({ card: card.id, fingerprint: card.items[0]!.fingerprint, answer: "hold" });
    await until(() => r.events.length > 0);
    expect(r.events).toEqual([{ kind: "daily", phase: "skipped", reason: "declined" }]);
    expect(r.m.turns.findLast((e) => e.type === "done")).toMatchObject({ stopReason: "cancelled", text: routineDeclined(ROUTINE_LABELS.daily, true) });
    expect(Object.keys(r.notes).some((p) => p.startsWith("Rotinas/"))).toBe(false);
    // Não pergunta de novo no mesmo dia.
    expect(await r.tick(at(16, 18, 30))).toBeNull();
    // "Rodar agora": o clique já foi o sim.
    const { id } = await r.m.svc.routineRun({ kind: "weekly" });
    await until(() => r.events.length > 1);
    expect(r.m.svc.question()).toBeNull();
    expect(r.events[1]).toEqual({ kind: "weekly", phase: "done", request: id, note: "Rotinas/Pendentes da semana de 16-11-2026.md", change: 1 });
  });

  test("com o limite do plano acabado, não roda e avisa", async () => {
    const r = routines(at(16, 10));
    await readyNow(r.m);
    r.clock.now = at(16, 17);
    expect((await askAndWait(r.m, "/limite")).at(-1)).toMatchObject({ type: "error", code: "E_AGENT_LIMIT" });
    await r.m.svc.configure({ routines: { daily: { on: true } } });
    const asked = r.m.turns.filter((e) => e.type === "started").length;
    expect(await r.tick(at(16, 18))).toBeNull();
    // A hora de volta é a da mensagem do limite (o agente falso diz "reset at 5pm": as 17h seguintes).
    expect(r.events).toEqual([{ kind: "daily", phase: "skipped", reason: "limit", resetsAt: expect.any(String) }]);
    expect(r.m.turns.filter((e) => e.type === "started")).toHaveLength(asked);
    await expect(r.m.svc.routineRun({ kind: "daily" })).rejects.toMatchObject({ code: "E_AGENT_LIMIT" });
  });

  test("a vez só conta depois que o pedido sai; com um pedido da pessoa na frente, nada é marcado (revisão do #479)", async () => {
    const r = routines(at(16, 10));
    await readyNow(r.m);
    await r.m.svc.configure({ routines: { daily: { on: true } } });
    // A ordem: o pedido da rotina começa antes de o status trazer a vez marcada.
    const order: string[] = [];
    r.m.svc.onTurn((e) => e.type === "started" && order.push("pedido"));
    r.m.svc.onStatus((s) => s.routines.daily.lastRun && !order.includes("marcada") && order.push("marcada"));
    expect(await r.tick(at(16, 18))).toBeTruthy();
    expect(order).toEqual(["pedido", "marcada"]);
    // Um pedido da pessoa na frente: o "Rodar agora" falha ocupado, e a vez não é gastada.
    const { id } = await r.m.svc.ask("/lento");
    const before = (await r.m.svc.status()).routines.weekly.lastRun;
    await expect(r.m.svc.routineRun({ kind: "weekly" })).rejects.toMatchObject({ code: "E_AGENT_BUSY" });
    expect((await r.m.svc.status()).routines.weekly.lastRun).toBe(before);
    await until(() => r.m.turns.some((e) => e.id === id && e.type === "done"));
  });

  test("desligar o agente desliga as rotinas, e o Rodar agora pede o agente ligado", async () => {
    const r = routines(at(16, 10));
    await readyNow(r.m);
    await r.m.svc.configure({ routines: { daily: { on: true }, weekly: { on: true } } });
    const off = await r.m.svc.disable();
    expect([off.routines.daily.on, off.routines.weekly.on]).toEqual([false, false]);
    await expect(r.m.svc.routineRun({ kind: "daily" })).rejects.toMatchObject({ code: "E_AGENT_DISABLED" });
    expect((await r.m.svc.enable()).routines.daily.on).toBe(false);
  });
});

describe("as notas .txt pelo agente falso (spec #13379)", () => {
  test('"organize as anotações da pasta Legacy PR": o agente falso acha a pasta pelo nome e lê o .txt, pelas ferramentas do Kiwi', async () => {
    const root = path.join(tmp(), "KiwiNotes");
    for (const [rel, content] of Object.entries({ "Trabalho/legacy-pr/anotacoes.txt": "mudar o legado até março\n", "Trabalho/legacy-pr/Plano.md": "# Plano\n" })) {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      writeFileSync(path.join(root, rel), content);
    }
    const vault = new Vault({ root, debounceMs: 20, trash: async () => {} });
    // O .txt é achado pelo índice do texto dos arquivos (T21240), como no app.
    const text = new TextIndex({ root, dir: path.join(tmp(), "text-index"), pause: async () => {} });
    try {
      const caps = uiCapabilities({
        dictionary: { load: async () => [], save: async (t) => t },
        snippets: { load: async () => [], save: async (s) => s },
        history: { search: async () => ({ entries: [] }), delete: async () => true, get: async () => null },
        dictationNotes: { toNew: async () => { throw new Error("not used"); }, append: async () => { throw new Error("not used"); } },
        settings: { load: async () => ({ ...DEFAULT_SETTINGS, notesShortcut: null }), save: async () => ({ ...DEFAULT_SETTINGS, notesShortcut: null }) },
        clipboardWrite: () => {},
        notes: vault,
        textIndex: text,
      });
      await (caps as Record<string, (a: unknown) => Promise<unknown>>)["notes.list"]!(undefined);
      await text.idle();
      const m = make({ reader: readerFromCapabilities(caps as never), writer: writerFromCapabilities(caps as never) });
      await readyNow(m);
      const done = (await askAndWait(
        m,
        'organize as anotações da pasta Legacy PR\n/tool notes_list {"folder":"Legacy PR"}\n/tool notes_search {"query":"mudar legado"}\n/tool notes_read {"path":"Trabalho/legacy-pr/anotacoes.txt"}',
      )).at(-1) as { type: string; text: string };
      expect(done.type).toBe("done");
      const [list, search, read] = done.text.split("\n").map((l) => JSON.parse(l) as Record<string, any>);
      expect(list!.pasta).toBe("Trabalho/legacy-pr");
      expect(list!.notas.map((n: { path: string }) => n.path)).toContain("Trabalho/legacy-pr/anotacoes.txt");
      expect(search!.resultados.map((h: { path: string }) => h.path)).toContain("Trabalho/legacy-pr/anotacoes.txt");
      expect(read!.texto).toBe("mudar o legado até março\n");
    } finally {
      vault.close();
      await text.close();
    }
  });
});

describe("o Kiwi escrevendo ao vivo: o agent.wrote (spec #20843, T20868)", () => {
  /** Um cofre de verdade num tmp, com o agente falso escrevendo pelas capacidades, e os avisos na ordem em que saem. */
  function live(files: Record<string, string>) {
    const root = path.join(tmp(), "KiwiNotes");
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      writeFileSync(path.join(root, rel), content);
    }
    const vault = new Vault({ root, debounceMs: 20, trash: async () => {} });
    const caps = uiCapabilities({
      dictionary: { load: async () => [], save: async (t) => t },
      snippets: { load: async () => [], save: async (s) => s },
      history: { search: async () => ({ entries: [] }), delete: async () => true, get: async () => null },
      dictationNotes: { toNew: async () => { throw new Error("not used"); }, append: async () => { throw new Error("not used"); } },
      settings: { load: async () => ({ ...DEFAULT_SETTINGS, notesShortcut: null }), save: async () => ({ ...DEFAULT_SETTINGS, notesShortcut: null }) },
      clipboardWrite: () => {},
      notes: vault,
    });
    const m = make({ reader: readerFromCapabilities(caps as never), writer: writerFromCapabilities(caps as never) });
    // Como o `windows.ts`: o `agent.wrote` da escrita sai antes do `notes.changed` (ou do `files.changed`) dela.
    const events: { name: string; payload: any }[] = [];
    const offs = [
      vault.onChanged((paths) => {
        for (const w of m.svc.liveWrites.take(paths, "pasta")) events.push({ name: "agent.wrote", payload: w });
        events.push({ name: "notes.changed", payload: { paths } });
      }),
      vault.onOtherFiles((paths) => {
        for (const w of m.svc.liveWrites.take(paths, "pasta")) events.push({ name: "agent.wrote", payload: w });
        events.push({ name: "files.changed", payload: { paths } });
      }),
      m.svc.liveWrites.onAnnounce((w) => events.push({ name: "agent.wrote", payload: w })),
    ];
    const close = () => {
      for (const off of offs) off();
      vault.close();
    };
    return { root, vault, m, events, close };
  }

  const wrote = (events: { name: string; payload: any }[]) => events.filter((e) => e.name === "agent.wrote").map((e) => e.payload);

  test("acrescentar e trocar um trecho: um aviso por escrita, antes do notes.changed, e os edits dão o texto do disco", async () => {
    const before = "# Projeto X\n\nA Ana cuida do prazo.\n\n## Tarefas\n- revisar o exemplo\n";
    const l = live({ "Projeto X.md": before });
    try {
      await readyNow(l.m);
      const turn = await askAndWait(
        l.m,
        'arrume a nota\n/tool notes_edit {"path":"Projeto X.md","old":"A Ana cuida","text":"A Bia cuida"}\n/tool notes_append {"path":"Projeto X.md","section":"Tarefas","text":"- marcar a reunião"}',
      );
      expect(turn.at(-1)!.type).toBe("done");
      const ws = wrote(l.events);
      expect(ws).toHaveLength(2);
      // Cada aviso vem logo antes do notes.changed da mesma escrita.
      for (const w of ws) {
        const i = l.events.findIndex((e) => e.payload === w);
        expect(l.events[i + 1]).toMatchObject({ name: "notes.changed", payload: { paths: ["Projeto X.md"] } });
      }
      const id = turn[0]!.id;
      expect(ws.map((w) => w.turnId)).toEqual([id, id]);
      expect(ws.map((w) => w.folderId)).toEqual(["pasta", "pasta"]);
      // A troca: só os caracteres que mudaram ("Ana" → "Bia"); o acréscimo: só o texto novo. Encadeados pela versão.
      expect(ws[0].edits).toEqual([{ from: 15, to: 17, removed: "An", inserted: "Bi" }]);
      expect(ws[1].baseVersion).toBe(ws[0].version);
      expect(ws[1].edits).toHaveLength(1);
      expect(ws[1].edits[0].removed).toBe("");
      expect(ws[1].edits[0].inserted).toContain("- marcar a reunião");
      // A garantia: os edits sobre o texto de antes dão exatamente o disco, e a versão é a dele.
      const disk = readFileSync(path.join(l.root, "Projeto X.md"), "utf8");
      const mid = applyLiveEdits(before, ws[0].edits)!;
      expect(versionOf(before)).toBe(ws[0].baseVersion);
      expect(versionOf(mid)).toBe(ws[0].version);
      expect(applyLiveEdits(mid, ws[1].edits)).toBe(disk);
      expect(versionOf(disk)).toBe(ws[1].version);
    } finally {
      l.close();
    }
  });

  test("a nota inteira trocada: vários edits pequenos, que dão o texto do disco", async () => {
    const before = "# Plano\n\nlinha um\nlinha dois\nlinha três\nlinha quatro\n";
    const l = live({ "Plano.md": before });
    try {
      await readyNow(l.m);
      const version = versionOf(before);
      const text = "# Plano\n\nlinha UM\nlinha dois\nlinha três\nlinha QUATRO\n";
      const turn = await askAndWait(l.m, `/tool notes_write ${JSON.stringify({ path: "Plano.md", text, version })}`);
      expect(turn.at(-1)!.type).toBe("done");
      const [w] = wrote(l.events);
      expect(w.edits.map((e: { removed: string; inserted: string }) => [e.removed, e.inserted])).toEqual([["um", "UM"], ["quatro", "QUATRO"]]);
      expect(applyLiveEdits(before, w.edits)).toBe(readFileSync(path.join(l.root, "Plano.md"), "utf8"));
    } finally {
      l.close();
    }
  });

  test("o .txt leva os edits, antes do files.changed dele", async () => {
    const before = "lista do exemplo\n- pão\n";
    const l = live({ "lista.txt": before });
    try {
      await readyNow(l.m);
      expect((await askAndWait(l.m, '/tool notes_append {"path":"lista.txt","text":"- café"}')).at(-1)!.type).toBe("done");
      const [w] = wrote(l.events);
      const i = l.events.findIndex((e) => e.payload === w);
      expect(l.events[i + 1]).toMatchObject({ name: "files.changed", payload: { paths: ["lista.txt"] } });
      expect(applyLiveEdits(before, w.edits)).toBe(readFileSync(path.join(l.root, "lista.txt"), "utf8"));
    } finally {
      l.close();
    }
  });

  test("um arquivo que não é nota: só o caminho, sem edits", async () => {
    const l = live({ "Leia.md": "# Leia\n" });
    try {
      await readyNow(l.m);
      const turn = await askAndWait(l.m, `/tool files_create ${JSON.stringify({ formato: "csv", nome: "notas", conteudo: { tabela: [["nome", "nota"], ["Ana", "10"]] } })}`);
      expect(turn.at(-1)!.type).toBe("done");
      const [w] = wrote(l.events);
      expect(w.path).toBe("notas.csv");
      expect(w.edits).toBeUndefined();
      expect(w.turnId).toBe(turn[0]!.id);
    } finally {
      l.close();
    }
  });

  test("a nota que mudou no meio: a escrita é recusada e nenhum aviso sai", async () => {
    const before = "# Ideias\n\nexemplo\n";
    const l = live({ "Ideias.md": before });
    try {
      await readyNow(l.m);
      const turn = await askAndWait(l.m, `/tool notes_write ${JSON.stringify({ path: "Ideias.md", text: "outra", version: "0000000000000000" })}`);
      expect(turn.at(-1)!.type).toBe("done");
      expect(wrote(l.events)).toEqual([]);
      expect(readFileSync(path.join(l.root, "Ideias.md"), "utf8")).toBe(before);
    } finally {
      l.close();
    }
  });
});

describe("dois agentes (spec #24666)", () => {
  test("o Gemini abre sem o adaptador, sem o _meta do Claude, e na sessão dele", async () => {
    const m = make();
    await m.svc.enable(true);
    let s = await m.svc.configure({ kind: "gemini" });
    expect(s).toMatchObject({ kind: "gemini", name: "Gemini (Antigravity)", adapter: { phase: "missing" } });
    expect((await m.svc.status(true)).gemini).toMatchObject({ installed: true, version: "0.70.0", versionOk: true, loggedIn: false, loginKnown: false });
    // Sem baixar nada: o pedido vai.
    const events = await askAndWait(m, "oi");
    expect(events.at(-1)?.type).toBe("done");
    const opened = m.log().find((l) => l.method === "session/new")!;
    expect(opened.params._meta).toBeUndefined();
    expect(existsSync(sessionFileOf(agentDir(m.data), "gemini"))).toBe(true);
    expect(existsSync(sessionFileOf(agentDir(m.data), "claude"))).toBe(false);
    // O download do adaptador não começa com o Gemini.
    s = await m.svc.startDownload();
    expect(s.adapter.phase).toBe("missing");
    expect(m.reg.requests).toEqual([]);
  });

  test("trocar de agente fecha o aberto, e cada um retoma a própria sessão", async () => {
    const m = make({ env: { KIWI_FAKE_AGENT_RESUME: "resume" } });
    await readyNow(m);
    await askAndWait(m, "oi");
    const claudePid = m.pid();
    expect(alive(claudePid)).toBe(true);
    const claudeSession = JSON.parse(readFileSync(sessionFileOf(agentDir(m.data), "claude"), "utf8")).sessionId as string;

    const s = await m.svc.configure({ kind: "gemini" });
    expect(s.program).toBe("closed");
    await until(() => !alive(claudePid));
    await askAndWait(m, "oi");
    const geminiSession = JSON.parse(readFileSync(sessionFileOf(agentDir(m.data), "gemini"), "utf8")).sessionId as string;
    expect(geminiSession).not.toBe(claudeSession);

    // De volta ao Claude: retoma a sessão dele, não a do Gemini.
    await m.svc.configure({ kind: "claude" });
    await askAndWait(m, "oi");
    const resumed = m.log().filter((l) => l.method === "session/resume").map((l) => l.params.sessionId);
    expect(resumed.at(-1)).toBe(claudeSession);
    expect(resumed).not.toContain(geminiSession);
  });

  // A troca e um pedido juntos, nas duas ordens: o pedido que corre com a troca não pode abrir nem reusar o Claude, e o
  // seguinte vai ao Gemini, na sessão dele (revisão do T24672).
  for (const order of ["a troca antes", "o pedido antes"] as const) {
    test(`trocar e pedir juntos (${order}): o aberto é o escolhido, nunca o de antes`, async () => {
      const m = make();
      await readyNow(m);
      const claudePid = m.pid();
      const asked = () => m.svc.ask("oi");
      const switched = () => m.svc.configure({ kind: "gemini" });
      const [first, second] = await Promise.allSettled(order === "a troca antes" ? [switched(), asked()] : [asked(), switched()]);
      const sw = order === "a troca antes" ? first! : second!;
      await untilIdle(m);
      await askAndWait(m, "de novo");
      const opened = m.log().filter((l) => l.method === "session/new" || l.method === "session/load" || l.method === "session/resume");
      if (sw.status === "rejected") {
        // O pedido pegou a vez: a troca é recusada, e tudo fica no Claude.
        expect((sw.reason as AgentServiceError).code).toBe("E_AGENT_BUSY");
        expect(await m.svc.status()).toMatchObject({ kind: "claude", program: "open" });
        expect(opened.at(-1)!.params._meta).toBeDefined();
        return;
      }
      // A troca valeu: o aberto é o Gemini, na sessão dele, e o Claude fechou.
      expect(await m.svc.status()).toMatchObject({ kind: "gemini", name: "Gemini (Antigravity)", program: "open" });
      if (claudePid) await until(() => !alive(claudePid));
      expect(opened.at(-1)!.params._meta).toBeUndefined();
      expect(existsSync(sessionFileOf(agentDir(m.data), "gemini"))).toBe(true);
    });
  }

  test("um pedido que começa por / não chega ao Gemini como comando (ADR 0012)", async () => {
    const m = make();
    await m.svc.enable(true);
    await m.svc.configure({ kind: "gemini" });
    const events = await askAndWait(m, "/resumo Projeto X");
    expect(events.at(-1)?.type).toBe("done");
    const sent = m.log().filter((l) => l.method === "session/prompt").map((l) => (l.params.prompt as { text: string }[])[0]!.text);
    expect(sent.length).toBeGreaterThan(0);
    for (const t of sent) expect(t.trimStart().startsWith("/")).toBe(false);
    expect(sent.at(-1)).toContain("/resumo Projeto X");
  });

  // Uma das duas defesas da troca, sozinha (revisão do T24672, #24813): o agente mudou nos ajustes sem o `configure`
  // fechar o aberto. O host do Claude, ainda vivo, não é reusado: o próximo pedido fecha ele e abre o Gemini.
  test("um host de outro agente, ainda aberto, nunca é reusado", async () => {
    const m = make();
    await readyNow(m);
    await askAndWait(m, "oi");
    const claudePid = m.pid()!;
    expect(alive(claudePid)).toBe(true);

    await m.store.save({ agent: { ...(await m.store.load()).agent, kind: "gemini" } });
    expect(alive(claudePid)).toBe(true);

    await askAndWait(m, "de novo");
    expect(await m.svc.status()).toMatchObject({ kind: "gemini", program: "open" });
    await until(() => !alive(claudePid));
    const opened = m.log().filter((l) => l.method === "session/new" || l.method === "session/load" || l.method === "session/resume");
    expect(opened.at(-1)!.params._meta).toBeUndefined();
    expect(existsSync(sessionFileOf(agentDir(m.data), "gemini"))).toBe(true);
  });

  test("trocar no meio de um pedido: E_AGENT_BUSY, e nada muda", async () => {
    const m = make();
    await readyNow(m);
    const { id } = await m.svc.ask("/ate-cancelar");
    await until(() => m.turns.some((e) => e.id === id && e.type === "text"));
    expect((await rejection(m.svc.configure({ kind: "gemini" }))).code).toBe("E_AGENT_BUSY");
    expect((await m.svc.status()).kind).toBe("claude");
    await m.svc.cancel();
    await untilIdle(m);
  });

  test("um agente que não existe é recusado", async () => {
    const m = make();
    expect((await rejection(m.svc.configure({ kind: "codex" as never }))).code).toBe("E_BAD_ARGS");
  });

  test("o modelo é de cada agente: voltar ao Claude traz o dele", async () => {
    const m = make();
    await m.svc.configure({ model: "opus" });
    let s = await m.svc.configure({ kind: "gemini" });
    expect(s.model).toBe("default");
    s = await m.svc.configure({ model: "gemini-exemplo" });
    s = await m.svc.configure({ kind: "claude" });
    expect(s.model).toBe("opus");
    s = await m.svc.configure({ kind: "gemini" });
    expect(s.model).toBe("gemini-exemplo");
  });

  test("o Gemini falso oferece os modelos dele, nenhum do Claude (T24673)", async () => {
    const m = make();
    await m.svc.enable(true);
    await m.svc.configure({ kind: "gemini" });
    await askAndWait(m, "oi");
    const models = (await m.svc.status()).models;
    expect(models.map((x) => x.value)).toEqual(["default", "gemini-hydrogen", "gemini-argon", "gemini-neon"]);
    expect(models.map((x) => x.name)).toEqual(["Auto", "Hydrogen", "Argon", "Neon"]);
    expect(JSON.stringify(models)).not.toMatch(/sonnet|opus|haiku|fable|claude/i);
    await m.svc.close();
  });

  test("o login do Gemini: desconhecido até abrir, logado ao abrir, e não logado pelo authRequired", async () => {
    const out = path.join(tmp(), "sem-login");
    const m = make({ env: { KIWI_FAKE_AGENT_LOGGED_OUT: out } });
    await m.svc.enable(true);
    await m.svc.configure({ kind: "gemini" });
    let s = await m.svc.status(true);
    expect(s.gemini).toMatchObject({ loggedIn: false, loginKnown: false });

    writeFileSync(out, "");
    const failed = await askAndWait(m, "oi");
    expect(failed.at(-1)).toMatchObject({ type: "error", code: "E_AGENT_NOT_LOGGED_IN" });
    expect((failed.at(-1) as { message: string }).message).toContain("O Gemini (Antigravity) não está logado");
    s = await m.svc.status();
    expect(s.gemini?.loggedIn).toBe(false);
    expect(s.gemini).not.toHaveProperty("loginKnown");

    rmSync(out);
    expect((await askAndWait(m, "oi")).at(-1)?.type).toBe("done");
    s = await m.svc.status(true);
    expect(s.gemini).toMatchObject({ loggedIn: true });
    expect(s.gemini).not.toHaveProperty("loginKnown");
  });

  test("o Kiwi nunca lê o ~/.gemini: o estado, o pedido e a troca, com as leituras do processo vigiadas", async () => {
    // O agente (o processo filho) pode ler o que é dele, numa casa falsa; o Kiwi, não. A vigia olha qualquer caminho
    // com ".gemini", seja qual for a casa: o `os.homedir()` do Bun não segue o HOME trocado depois de abrir.
    const home = tmp();
    mkdirSync(path.join(home, ".gemini"));
    writeFileSync(path.join(home, ".gemini", "oauth_creds.json"), JSON.stringify({ token: "exemplo" }));
    // O `import` e o `require` dão objetos diferentes do node:fs: a vigia fica nos dois. Elas passam adiante: só anotam.
    const fsObjects = [...new Set([fs, require("node:fs")])] as (typeof fs)[];
    const fspObjects = [...new Set([fsp, require("node:fs/promises")])] as (typeof fsp)[];
    const watched = [
      ...fsObjects.flatMap((o) => [spyOn(o, "readFileSync"), spyOn(o, "existsSync"), spyOn(o, "statSync"), spyOn(o, "readdirSync"), spyOn(o, "openSync"), spyOn(o, "readFile"), spyOn(o, "open")]),
      ...fspObjects.flatMap((o) => [spyOn(o, "readFile"), spyOn(o, "readdir"), spyOn(o, "stat"), spyOn(o, "open")]),
      spyOn(Bun, "file"),
    ];
    const touched = () => watched.flatMap((s) => s.mock.calls.map((c) => String(c[0]))).filter((p) => p.includes(".gemini"));
    try {
      const m = make({ env: { HOME: home } });
      await m.svc.enable(true);
      await m.svc.configure({ kind: "gemini" });
      await m.svc.status(true);
      expect((await askAndWait(m, "oi")).at(-1)?.type).toBe("done");
      await m.svc.status(true);
      await m.svc.configure({ kind: "claude" });
      await m.svc.configure({ kind: "gemini" });
      await m.svc.status(true);
      expect(touched()).toEqual([]);
      // A vigia pega mesmo, pelos dois caminhos.
      fs.existsSync(path.join(home, ".gemini"));
      require("node:fs").readFileSync(path.join(home, ".gemini", "oauth_creds.json"));
      expect(touched()).toHaveLength(2);
    } finally {
      for (const s of watched) s.mockRestore();
    }
  });

  test("o medidor com o Gemini: nenhum /usage, nem o do Atualizar nem o de depois do pedido", async () => {
    const m = make({ limitProbe: { delayMs: 10, everyMs: 0 } });
    await m.svc.enable(true);
    await m.svc.configure({ kind: "gemini" });
    await askAndWait(m, "oi");
    await m.svc.usageRefresh();
    await Bun.sleep(200);
    expect(m.log().filter((l) => l.method === "session/usage")).toEqual([]);
    // Um serviço novo (o app reaberto), com o Gemini salvo e os ajustes ainda não lidos: o Atualizar também não vai.
    const again = make({ data: m.data, reg: m.reg });
    await again.svc.usageRefresh();
    await Bun.sleep(100);
    expect(again.log().filter((l) => l.method === "session/usage")).toEqual([]);
    const prompts = m.log().filter((l) => l.method === "session/prompt").map((l) => JSON.stringify(l.params.prompt));
    expect(prompts.some((p) => p.includes("/usage"))).toBe(false);
    expect((await m.svc.status()).busy).toBe(false);
  });
});

describe("o Antigravity (spec #25046): os testes do #24666 com o agy falso", () => {
  test("trocar de agente: o Claude fecha, o agy abre na sessão dele e a retoma; de volta, o Claude retoma a dele", async () => {
    const m = make({ agy: true, env: { KIWI_FAKE_AGENT_RESUME: "resume" } });
    await readyNow(m);
    await askAndWait(m, "oi");
    const claudePid = m.pid();
    expect(alive(claudePid)).toBe(true);
    const claudeSession = JSON.parse(readFileSync(sessionFileOf(agentDir(m.data), "claude"), "utf8")).sessionId as string;

    const s = await m.svc.configure({ kind: "gemini" });
    expect(s.program).toBe("closed");
    await until(() => !alive(claudePid));
    expect((await askAndWait(m, "oi")).at(-1)?.type).toBe("done");
    // Abriu o `agy acp`, não o Gemini CLI: o argv do falso e o initialize do Antigravity.
    expect(m.log().some((l) => l.method === "argv" && (l.params.argv as string[] | undefined)?.[0] === "acp")).toBe(true);
    const agySession = JSON.parse(readFileSync(sessionFileOf(agentDir(m.data), "gemini"), "utf8")).sessionId as string;
    expect(agySession).not.toBe(claudeSession);
    expect(m.log().find((l) => l.method === "session/new" && !l.params._meta)).toBeDefined();

    // O app fechado e aberto de novo: o agy retoma a própria sessão pelo session/resume.
    await m.svc.close();
    const again = make({ agy: true, data: m.data, reg: m.reg, env: { KIWI_FAKE_AGENT_RESUME: "resume" } });
    await again.svc.enable(true);
    expect((await askAndWait(again, "de novo")).at(-1)?.type).toBe("done");
    expect(again.log().filter((l) => l.method === "session/resume").map((l) => l.params.sessionId)).toContain(agySession);

    // De volta ao Claude: a sessão dele, nunca a do agy.
    await again.svc.configure({ kind: "claude" });
    await askAndWait(again, "oi");
    const resumed = again.log().filter((l) => l.method === "session/resume").map((l) => l.params.sessionId);
    expect(resumed.at(-1)).toBe(claudeSession);
  });

  test("o esforço do agy pela categoria thought_level (T25553): os níveis dele na tela, o Padrão dele, escolher pelo id dele, e o log", async () => {
    const lines: string[] = [];
    const m = make({ agy: true, appLog: (l) => lines.push(l) });
    await m.svc.enable(true);
    await m.svc.configure({ kind: "gemini" });
    expect((await askAndWait(m, "oi")).at(-1)?.type).toBe("done");
    let s = await m.svc.status();
    // A tela: o Padrão do Kiwi e os níveis com os nomes que o agente deu.
    expect(effortOptions(s)).toEqual([
      { value: "default", label: "Padrão" },
      { value: "fake_low", label: "Pouco" },
      { value: "fake_high", label: "Muito" },
    ]);
    // O Padrão com níveis que o Kiwi não conhece: fica o do agente, sem nenhum set_config_option.
    expect(s.session?.effort).toBe("fake_high");
    expect(m.log().filter((l) => l.method === "session/set_config_option")).toEqual([]);
    await m.svc.configure({ effort: "fake_low" });
    expect((await askAndWait(m, "de novo")).at(-1)?.type).toBe("done");
    s = await m.svc.status();
    expect(s.session?.effort).toBe("fake_low");
    expect(effortValue(s)).toBe("fake_low");
    const sets = m.log().filter((l) => l.method === "session/set_config_option").map((l) => [l.params.configId, l.params.value]);
    expect(sets).toEqual([["fake_thinking", "fake_low"]]);
    // Uma linha por formato, só com os ids e as categorias.
    expect(lines.filter((l) => l.includes("opções da sessão"))).toEqual(["[agent] opções da sessão (gemini): model, fake_thinking (thought_level)"]);
  });

  test("um agy sem opção de esforço (T25553): a lista vazia, e a linha Esforço diz que ele não deixa escolher", async () => {
    const lines: string[] = [];
    const m = make({ agy: true, env: { KIWI_FAKE_AGENT_NO_EFFORT: "1" }, appLog: (l) => lines.push(l) });
    await m.svc.enable(true);
    await m.svc.configure({ kind: "gemini" });
    expect((await askAndWait(m, "oi")).at(-1)?.type).toBe("done");
    const s = await m.svc.status();
    expect(s.efforts?.[s.model]).toEqual([]);
    expect(effortHint(s)).toBe(`O ${s.name} não deixa escolher o esforço: ele decide sozinho quanto pensar.`);
    expect(m.log().filter((l) => l.method === "session/set_config_option")).toEqual([]);
    expect(lines.filter((l) => l.includes("opções da sessão"))).toEqual(["[agent] opções da sessão (gemini): model"]);
  });

  test("um pedido que começa por / chega ao agy com a marca, nunca como comando", async () => {
    const m = make({ agy: true });
    await m.svc.enable(true);
    await m.svc.configure({ kind: "gemini" });
    expect((await askAndWait(m, "/resumo Projeto X")).at(-1)?.type).toBe("done");
    expect((await askAndWait(m, "Resuma a nota /Projetos/exemplo.md")).at(-1)?.type).toBe("done");
    const sent = m.log().filter((l) => l.method === "session/prompt").map((l) => (l.params.prompt as { text: string }[])[0]!.text);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toBe(`${GEMINI_NOT_A_COMMAND}\n/resumo Projeto X`);
    expect(sent[1]).toBe("Resuma a nota /Projetos/exemplo.md");
  });

  test("sem login: o -32000 do agy vira E_AGENT_NOT_LOGGED_IN com a frase do Antigravity, e entrar destrava", async () => {
    const out = path.join(tmp(), "sem-login");
    const m = make({ agy: true, env: { KIWI_FAKE_AGENT_LOGGED_OUT: out } });
    await m.svc.enable(true);
    await m.svc.configure({ kind: "gemini" });
    expect((await m.svc.status(true)).gemini).toMatchObject({ installed: true, loggedIn: false, loginKnown: false });

    writeFileSync(out, "");
    const failed = await askAndWait(m, "oi");
    expect(failed.at(-1)).toMatchObject({ type: "error", code: "E_AGENT_NOT_LOGGED_IN" });
    const message = (failed.at(-1) as { message: string }).message;
    expect(message).toContain(AGY_LOGIN_HELP);
    // Em português, sem o texto em inglês do agy.
    expect(message).not.toMatch(/authentication|required/i);
    let s = await m.svc.status();
    expect(s.gemini?.loggedIn).toBe(false);
    expect(s.gemini).not.toHaveProperty("loginKnown");

    rmSync(out);
    expect((await askAndWait(m, "oi")).at(-1)?.type).toBe("done");
    s = await m.svc.status(true);
    expect(s.gemini).toMatchObject({ loggedIn: true });
  });
});
