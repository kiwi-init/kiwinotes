// O host do agente (spec #4576) contra o agente falso, que fala ACP de verdade. Nenhum teste abre o Claude Code.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { FAKE_AGENT_COMMAND } from "./fake/index.ts";
import { AgentHost, ISOLATION_META, type AgentEvent } from "./host.ts";
import type { AgentError } from "./errors.ts";

const dirs: string[] = [];
const hosts: AgentHost[] = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((h) => h.stop()));
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tmp(): string {
  const d = mkdtempSync(path.join(tmpdir(), "kn-agent-"));
  dirs.push(d);
  return d;
}

/** Um host com o agente falso. `log` recebe cada abertura de sessão que o falso viu; `resume` muda como ele retoma. */
function fakeHost(
  dir: string,
  extra: { resume?: "resume" | "load" | "none"; command?: readonly string[]; sessionOptions?: Record<string, unknown> } = {},
) {
  const log = path.join(dir, "fake-log.jsonl");
  const h = new AgentHost({
    name: "Agente falso",
    command: extra.command ?? FAKE_AGENT_COMMAND,
    dir: path.join(dir, "agent"),
    env: { ...process.env, KIWI_FAKE_AGENT_LOG: log, KIWI_FAKE_AGENT_RESUME: extra.resume ?? "resume" },
    sessionOptions: extra.sessionOptions,
  });
  hosts.push(h);
  const opened = () =>
    existsSync(log)
      ? readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { method: string; params: Record<string, unknown> })
      : [];
  return { h, opened };
}

async function rejection(p: Promise<unknown>): Promise<AgentError> {
  try {
    await p;
  } catch (e) {
    return e as AgentError;
  }
  throw new Error("era para falhar");
}

describe("o pedido", () => {
  test("devolve a resposta e os eventos, na ordem: thinking, o texto e o fim", async () => {
    const { h } = fakeHost(tmp());
    const s = await h.start();
    expect(s.resumed).toBe(false);
    expect(s.agent).toEqual({ name: "Agente falso", version: "1.0.0" });
    const events: AgentEvent[] = [];
    const a = await h.ask("oi", (e) => events.push(e));
    expect(a).toEqual({ text: 'Você disse: "oi". Este é o turno 1 desta sessão.', stopReason: "end_turn" });
    expect(events).toEqual([
      { type: "status", status: "thinking" },
      { type: "text", text: 'Você disse: "oi". ' },
      { type: "text", text: "Este é o turno 1 desta sessão." },
      { type: "done", stopReason: "end_turn" },
    ]);
  });

  test("o status diz a ferramenta que o agente está usando", async () => {
    const { h } = fakeHost(tmp());
    await h.start();
    const events: AgentEvent[] = [];
    await h.ask("/lento", (e) => events.push(e));
    expect(events.filter((e) => e.type === "status")).toEqual([
      { type: "status", status: "thinking" },
      { type: "status", status: "running", tool: "Read" },
    ]);
    expect(events.filter((e) => e.type === "text")).toHaveLength(20);
  });

  test("um pedido por vez: o segundo, com o primeiro em andamento, é recusado com E_AGENT_BUSY", async () => {
    const { h } = fakeHost(tmp());
    await h.start();
    const first = h.ask("/lento");
    expect(h.busy).toBe(true);
    const err = await rejection(h.ask("outro"));
    expect(err.code).toBe("E_AGENT_BUSY");
    expect(err.message).toContain("ainda está respondendo");
    expect((await first).stopReason).toBe("end_turn");
    expect(h.busy).toBe(false);
    expect((await h.ask("agora sim")).text).toContain("turno 2");
  });

  test("cancelar termina o pedido com stopReason cancelled, e o próximo pedido funciona", async () => {
    const { h } = fakeHost(tmp());
    await h.start();
    let pieces = 0;
    const answer = h.ask("/lento", (e) => {
      if (e.type === "text" && ++pieces === 1) void h.cancel();
    });
    const a = await answer;
    expect(a.stopReason).toBe("cancelled");
    expect(pieces).toBeLessThan(20);
    expect((await h.ask("depois")).stopReason).toBe("end_turn");
  });

  test("cancelar sem pedido em andamento não faz nada", async () => {
    const { h } = fakeHost(tmp());
    await h.start();
    await h.cancel();
    expect((await h.ask("oi")).stopReason).toBe("end_turn");
  });

  test("um pedido de permissão é recusado (sem tela, nenhuma ferramenta), e o evento diz qual", async () => {
    const { h } = fakeHost(tmp());
    await h.start();
    const events: AgentEvent[] = [];
    const a = await h.ask("/permissao", (e) => events.push(e));
    expect(events).toContainEqual({ type: "permission", tool: "Bash", decision: "denied" });
    expect(a.text).toBe("permissão: reject");
  });
});

describe("a sessão retomada", () => {
  test("fechar e abrir de novo retoma a mesma sessão (session/resume), com o histórico do agente", async () => {
    const dir = tmp();
    const { h, opened } = fakeHost(dir);
    const first = await h.start();
    await h.ask("um");
    await h.stop();

    const { h: again } = fakeHost(dir);
    const second = await again.start();
    expect(second).toMatchObject({ sessionId: first.sessionId, resumed: true });
    expect((await again.ask("dois")).text).toContain("turno 2");
    expect(opened().map((o) => o.method)).toEqual(["session/new", "session/resume"]);
  });

  test("um agente que só sabe session/load retoma por ele, e a conversa repetida não entra na resposta", async () => {
    const dir = tmp();
    const { h } = fakeHost(dir, { resume: "load" });
    const first = await h.start();
    await h.ask("um");
    await h.stop();

    const { h: again, opened } = fakeHost(dir, { resume: "load" });
    expect(await again.start()).toMatchObject({ sessionId: first.sessionId, resumed: true });
    const a = await again.ask("dois");
    expect(a.text).toBe('Você disse: "dois". Este é o turno 2 desta sessão.');
    expect(opened().map((o) => o.method)).toEqual(["session/new", "session/load"]);
  });

  test("um agente que não retoma começa uma sessão nova a cada abertura", async () => {
    const dir = tmp();
    const { h } = fakeHost(dir, { resume: "none" });
    const first = await h.start();
    await h.stop();
    const { h: again } = fakeHost(dir, { resume: "none" });
    const second = await again.start();
    expect(second.resumed).toBe(false);
    expect(second.sessionId).not.toBe(first.sessionId);
  });

  test("uma sessão guardada que o agente não conhece mais vira uma sessão nova, sem erro", async () => {
    const dir = tmp();
    const { h } = fakeHost(dir);
    const first = await h.start();
    await h.stop();
    rmSync(path.join(h.workDir, ".fake-agent-sessions.json")); // o agente esqueceu tudo
    const { h: again, opened } = fakeHost(dir);
    const second = await again.start();
    expect(second.resumed).toBe(false);
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(opened().map((o) => o.method)).toEqual(["session/new", "session/resume", "session/new"]);
  });

  test("forgetSession faz a próxima abertura começar do zero", async () => {
    const dir = tmp();
    const { h } = fakeHost(dir);
    const first = await h.start();
    await h.stop();
    h.forgetSession();
    const { h: again } = fakeHost(dir);
    expect((await again.start()).sessionId).not.toBe(first.sessionId);
  });
});

describe("o isolamento", () => {
  test("a sessão abre na pasta de trabalho do agente, sem servidores MCP e com o isolamento no _meta", async () => {
    const dir = tmp();
    const { h, opened } = fakeHost(dir);
    await h.start();
    const [created] = opened();
    expect(created!.params.cwd).toBe(path.join(dir, "agent", "work"));
    expect(created!.params.mcpServers).toEqual([]);
    expect(created!.params._meta).toEqual(ISOLATION_META);
    expect(ISOLATION_META.claudeCode.options).toEqual({ settingSources: [], strictMcpConfig: true, tools: [], allowDangerouslySkipPermissions: false });
  });

  test("opções a mais vão junto, mas nunca trocam o isolamento (T8540)", async () => {
    const dir = tmp();
    const { h, opened } = fakeHost(dir, { sessionOptions: { persistSession: false, tools: ["Bash"], settingSources: ["user"] } });
    await h.start();
    const [created] = opened();
    expect(created!.params._meta).toEqual({ claudeCode: { options: { persistSession: false, ...ISOLATION_META.claudeCode.options } } });
  });

  test("retomar a sessão manda o mesmo isolamento", async () => {
    const dir = tmp();
    const { h } = fakeHost(dir);
    await h.start();
    await h.stop();
    const { h: again, opened } = fakeHost(dir);
    await again.start();
    const resumed = opened().find((o) => o.method === "session/resume");
    expect(resumed!.params._meta).toEqual(ISOLATION_META);
    expect(resumed!.params.mcpServers).toEqual([]);
  });

  test("o processo do agente roda na pasta de trabalho dele", async () => {
    const dir = tmp();
    const { h } = fakeHost(dir);
    await h.start();
    await h.ask("oi");
    // O falso guarda as sessões na pasta onde roda: ela tem de ser a pasta de trabalho.
    expect(existsSync(path.join(dir, "agent", "work", ".fake-agent-sessions.json"))).toBe(true);
  });
});

describe("os erros", () => {
  test.each([
    ["/sem-login", "E_AGENT_NOT_LOGGED_IN", "não está logado"],
    ["/limite", "E_AGENT_LIMIT", "atingiu o limite de uso"],
    ["/sem-rede", "E_AGENT_OFFLINE", "Sem conexão com a internet"],
  ] as const)("%s chega como %s, com uma mensagem clara", async (prompt, code, words) => {
    const { h } = fakeHost(tmp());
    await h.start();
    const err = await rejection(h.ask(prompt));
    expect(err.code).toBe(code);
    expect(err.message).toContain(words);
    expect(err.message).toContain("Agente falso");
    expect(h.busy).toBe(false);
  });

  test("um agente que não existe chega como E_AGENT_NOT_INSTALLED, e nada fica aberto", async () => {
    const dir = tmp();
    const { h } = fakeHost(dir, { command: [path.join(dir, "nao-existe", "claude-agent-acp")] });
    const err = await rejection(h.start());
    expect(err.code).toBe("E_AGENT_NOT_INSTALLED");
    expect(err.message).toContain("não está instalado");
    expect(h.running).toBe(false);
  });

  test("o agente que cai no meio do pedido chega como E_AGENT_FAILED, sem travar", async () => {
    const { h } = fakeHost(tmp());
    await h.start();
    const err = await rejection(h.ask("/cai"));
    expect(err.code).toBe("E_AGENT_FAILED");
    expect(err.message).toContain("falhou ao responder");
    expect(h.busy).toBe(false);
  });

  test("depois de cair, o host volta a fechado: o pedido seguinte diz que falhou, e um start() abre de novo e retoma", async () => {
    const { h } = fakeHost(tmp());
    const first = await h.start();
    await rejection(h.ask("/cai"));
    expect(h.running).toBe(false);
    expect((await rejection(h.ask("oi"))).code).toBe("E_AGENT_FAILED");
    const again = await h.start();
    expect(again).toMatchObject({ sessionId: first.sessionId, resumed: true });
    expect((await h.ask("voltei")).text).toContain("turno 2");
  });

  test("um agente que sai antes da apresentação chega como E_AGENT_FAILED, e o processo é fechado", async () => {
    const { h } = fakeHost(tmp(), { command: [process.execPath, "-e", "process.exit(7)"] });
    const err = await rejection(h.start());
    expect(err.code).toBe("E_AGENT_FAILED");
    expect(h.running).toBe(false);
  });
});

describe("as opções da sessão: o modelo e o esforço (T8678)", () => {
  test("o host aplica os valores do Kiwi ao abrir, só onde o atual é outro", async () => {
    const dir = tmp();
    const log = path.join(dir, "log.jsonl");
    const h = new AgentHost({
      name: "Agente falso",
      command: FAKE_AGENT_COMMAND,
      dir: path.join(dir, "agent"),
      env: { ...process.env, KIWI_FAKE_AGENT_LOG: log, KIWI_FAKE_AGENT_MODEL: "fable" },
      configOptions: () => ({ model: "default", effort: "high" }),
    });
    hosts.push(h);
    await h.start();
    expect(h.configValues).toEqual({ model: "default", effort: "high" });
    const sets = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((l) => l.method === "session/set_config_option");
    expect(sets.map((l) => [l.params.configId, l.params.value])).toEqual([["model", "default"]]); // o esforço já era high
  });

  test("um valor que o agente não oferece fica de fora, e a sessão segue com o que tinha", async () => {
    const { h } = fakeHost(tmp());
    await h.start();
    expect(await h.applyConfig({ model: "nao-existe", effort: "low" })).toEqual({ applied: ["effort"], refused: ["model"] });
    expect(h.configValues).toEqual({ model: "fable", effort: "low" });
  });

  test("o killNow manda o SIGTERM na hora (a saída do app)", async () => {
    const { h } = fakeHost(tmp());
    await h.start();
    const pid = h.pid!;
    h.killNow();
    for (let i = 0; i < 100; i++) {
      try {
        process.kill(pid, 0);
      } catch {
        return;
      }
      await Bun.sleep(20);
    }
    throw new Error("o processo não saiu");
  });
});

describe("nada liga sozinho", () => {
  test("criar o host não abre o agente nem cria a pasta", () => {
    const dir = tmp();
    const { h } = fakeHost(dir);
    expect(h.running).toBe(false);
    expect(existsSync(path.join(dir, "agent"))).toBe(false);
  });

  test("pedir antes de abrir é um erro de uso, e não abre nada", async () => {
    const { h } = fakeHost(tmp());
    await expect(h.ask("oi")).rejects.toThrow("não está aberto");
    expect(h.running).toBe(false);
  });
});
