// O Antigravity CLI (spec #25046, T25059): achar o `agy`, o `gemini` antigo como reserva, os argumentos, o agente e os
// ajustes do Kiwi na pasta de trabalho, e o `agy` falso pelo host. Nenhum teste roda o `agy` de verdade.

import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { AGY_AGENT, AGY_AGENT_FILE, AGY_SETTINGS, agyArgs, agyEnv, agyHelpHasAcp, findAgy, findGeminiAgent, programKind, writeAgyWorkspace } from "./agy.ts";
import { AgentError } from "./errors.ts";
import { FAKE_AGY, FAKE_GEMINI, writeFakeAgyExecutable } from "./fake/index.ts";
import { geminiStatus } from "./gemini.ts";
import { geminiHost } from "./gemini-host.ts";
import type { AgentHost } from "./host.ts";
import { tempDir } from "../../test/tmp.ts";

const dirs: string[] = [];
const hosts: AgentHost[] = [];
afterEach(async () => {
  for (const h of hosts.splice(0)) await h.stop();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tmp(): string {
  const d = tempDir("kn-agy-");
  dirs.push(d);
  return d;
}

function exe(p: string): string {
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, "#!/bin/sh\n");
  chmodSync(p, 0o755);
  return p;
}

async function rejection(p: Promise<unknown>): Promise<AgentError> {
  try {
    await p;
  } catch (e) {
    return e as AgentError;
  }
  throw new Error("era para falhar");
}

type Line = { method: string; params: Record<string, unknown> };
const readLog = (log: string): Line[] =>
  existsSync(log)
    ? readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l) as Line)
    : [];

describe("achar o agy (T25059)", () => {
  test("o agy vence o gemini antigo, em qualquer pasta; sem o agy, o gemini fica de reserva", () => {
    const d = tmp();
    const a = path.join(d, "a");
    const b = path.join(d, "b");
    const gemini = exe(path.join(a, "gemini"));
    expect(findAgy([a, b])).toBeNull();
    expect(findGeminiAgent([a, b])).toBe(gemini);
    const agy = exe(path.join(b, "agy"));
    expect(findAgy([a, b])).toBe(agy);
    expect(findGeminiAgent([a, b])).toBe(agy);
    expect(findGeminiAgent([path.join(d, "vazia")])).toBeNull();
  });

  test("qual programa é: pelo nome do executável", () => {
    expect(programKind(["/opt/homebrew/bin/agy"])).toBe("agy");
    expect(programKind(FAKE_AGY)).toBe("agy");
    expect(programKind(["/opt/homebrew/bin/gemini"])).toBe("gemini");
    expect(programKind(FAKE_GEMINI)).toBe("gemini");
    expect(programKind(["/Users/exemplo/bin/agy-velho"])).toBe("gemini");
  });

  test("o acp na ajuda: como comando, não no meio de outra palavra", () => {
    expect(agyHelpHasAcp("Commands:\n  acp        Start the ACP server\n")).toBe(true);
    expect(agyHelpHasAcp("Commands:\n  login  Sign in\n  --no-acpx\n")).toBe(false);
  });
});

describe("o estado do agy, pelo falso", () => {
  test("instalado, com a versão e o acp", async () => {
    const program = writeFakeAgyExecutable(path.join(tmp(), "bin"));
    expect(await geminiStatus([program])).toEqual({ installed: true, program: "agy", path: program, version: "1.4.0" });
  });

  test("sem o comando acp: velho demais", async () => {
    const program = writeFakeAgyExecutable(path.join(tmp(), "bin"), { KIWI_FAKE_AGY_NO_ACP: "1" });
    expect(await geminiStatus([program])).toMatchObject({ installed: true, program: "agy", tooOld: true });
  });

  test("um agy que não existe ou não responde: não instalado", async () => {
    const d = tmp();
    const missing = path.join(d, "nao-existe", "agy");
    expect(await geminiStatus([missing])).toEqual({ installed: false, path: missing });
    const broken = path.join(d, "bin", "agy");
    mkdirSync(path.dirname(broken), { recursive: true });
    writeFileSync(broken, "#!/bin/sh\nexit 3\n");
    chmodSync(broken, 0o755);
    expect(await geminiStatus([broken])).toEqual({ installed: false, path: broken });
  });
});

describe("o isolamento do agy (ADR 0012, seção O Antigravity)", () => {
  test("os argumentos: acp, sem telemetria, um processo por sessão, sandbox e o agente do Kiwi; nunca sem permissões", () => {
    const args = agyArgs();
    expect(args).toEqual(["acp", "--disable-telemetry", "--process-per-session", "--sandbox", "--agent", AGY_AGENT]);
    expect(args.join(" ")).not.toContain("dangerously");
  });

  test("o agente do Kiwi: nenhuma ferramenta embutida, nenhum MCP, skill ou plugin, e o shell desligado", () => {
    const front = /^---\n([\s\S]*?)\n---\n/.exec(AGY_AGENT_FILE)![1]!;
    const fields = Object.fromEntries(front.split("\n").map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()]));
    expect(fields).toMatchObject({
      name: AGY_AGENT,
      tools: "[]",
      mcpServers: "[]",
      skills: "[]",
      plugins: "[]",
      mainAgent: "true",
      subagent: "false",
      commandExecutionPolicy: "off",
    });
    expect(fields.description!.length).toBeGreaterThan(0);
  });

  test("os ajustes: strict, sandbox, e shell, escrita, leitura e web negados; o MCP do Kiwi não", () => {
    expect(AGY_SETTINGS.toolPermission).toBe("strict");
    expect(AGY_SETTINGS.enableTerminalSandbox).toBe(true);
    expect(AGY_SETTINGS.permissions.allow).toEqual([]);
    const deny: readonly string[] = AGY_SETTINGS.permissions.deny;
    for (const action of ["command", "write_file", "read_file", "read_url", "execute_url"]) expect(deny).toContain(`${action}(*)`);
    expect(deny.some((r) => r.startsWith("mcp("))).toBe(false);
    // O formato da doc: `ação(alvo)`, sem espaço antes do parêntese (o `agy` ignora a regra que não entende).
    for (const r of deny) expect(r).toMatch(/^[a-z_]+\([^)]+\)$/);
  });

  test("o ambiente: sai todo GEMINI_* e GOOGLE_*, e o resto fica", () => {
    expect(agyEnv({ PATH: "/usr/bin", HOME: "/Users/exemplo", GEMINI_API_KEY: "exemplo", GOOGLE_CLOUD_PROJECT: "prj-exemplo", NO_BROWSER: "true" })).toEqual({
      PATH: "/usr/bin",
      HOME: "/Users/exemplo",
      NO_BROWSER: "true",
    });
  });

  test("grava o agente e os ajustes em <trabalho>/.agents/, e reescreve o que a pessoa ou outro programa mudou", () => {
    const work = path.join(tmp(), "agent", "work");
    expect(writeAgyWorkspace(work)).toBe(work);
    const agentFile = path.join(work, ".agents", "agents", `${AGY_AGENT}.md`);
    const settings = path.join(work, ".agents", "settings.json");
    expect(readFileSync(agentFile, "utf8")).toBe(AGY_AGENT_FILE);
    expect(JSON.parse(readFileSync(settings, "utf8"))).toEqual(AGY_SETTINGS);
    writeFileSync(agentFile, "---\nname: kiwi\ntools: [run_command]\n---\n");
    writeFileSync(settings, '{"toolPermission":"always-proceed"}');
    writeAgyWorkspace(work);
    expect(readFileSync(agentFile, "utf8")).toBe(AGY_AGENT_FILE);
    expect(JSON.parse(readFileSync(settings, "utf8"))).toEqual(AGY_SETTINGS);
  });
});

describe("o agy falso pelo host (T25059)", () => {
  function open(data: string, env: Record<string, string> = {}, kiwiEnv: Record<string, string> = {}) {
    const program = writeFakeAgyExecutable(path.join(data, "bin"), env);
    const log = path.join(data, "fake-log.jsonl");
    return { program, log, opened: geminiHost({ data, program: [program], env: { ...process.env, ...kiwiEnv, KIWI_FAKE_AGENT_LOG: log } }) };
  }

  /** O que estaria no ambiente do Kiwi e não pode chegar ao `agy`: chaves, a Vertex, uma credencial (valores inventados). */
  const LOGIN_VARS = {
    GEMINI_API_KEY: "exemplo",
    GOOGLE_API_KEY: "exemplo",
    GOOGLE_GENAI_USE_VERTEXAI: "true",
    GOOGLE_APPLICATION_CREDENTIALS: "/Users/exemplo/credencial.json",
    GEMINI_MODEL: "exemplo",
  };

  test("abre o agy acp com o isolamento, na pasta de trabalho com o agente e os ajustes, e responde", async () => {
    const data = tmp();
    const { log, opened } = open(data, {}, LOGIN_VARS);
    const { host, status } = await opened;
    hosts.push(host);
    expect(status).toMatchObject({ installed: true, program: "agy", version: "1.4.0" });
    const s = await host.start();
    expect(s.agent).toEqual({ name: "Antigravity ACP Server", version: "1.4.0" });
    expect((await host.ask("oi")).text).toContain('Você disse: "oi"');

    const argv = readLog(log).find((l) => l.method === "argv")!.params as { argv: string[]; cwd: string; geminiVars: string[]; workspace: { agent: string; settings: string } };
    // Nenhuma variável do Gemini ou do Google do ambiente do Kiwi chega ao `agy`: só a que o Kiwi põe.
    expect(argv.geminiVars).toEqual(["GEMINI_CLI_NO_RELAUNCH"]);
    expect(argv.argv).toEqual(agyArgs());
    expect(argv.cwd).toBe(path.join(data, "agent", "work"));
    // O `agy` acha o agente e os ajustes na pasta em que foi aberto.
    expect(argv.workspace.agent).toBe(AGY_AGENT_FILE);
    expect(JSON.parse(argv.workspace.settings)).toEqual(AGY_SETTINGS);
    // O Kiwi nunca chama o `authenticate`: o login é da pessoa, no `agy`.
    expect(readLog(log).map((l) => l.method)).not.toContain("authenticate");
    // A regra do `gemini` antigo não vai para o `agy`.
    expect(existsSync(path.join(data, "agent", "gemini-policy"))).toBe(false);
  });

  test("o agy sabe o session/resume: o host volta à mesma sessão por ele", async () => {
    const data = tmp();
    const first = await open(data).opened;
    hosts.push(first.host);
    const s1 = await first.host.start();
    await first.host.ask("oi");
    await first.host.stop();
    hosts.splice(hosts.indexOf(first.host), 1);

    const again = open(data);
    const second = await again.opened;
    hosts.push(second.host);
    const s2 = await second.host.start();
    expect(s2).toMatchObject({ sessionId: s1.sessionId, resumed: true });
    const methods = readLog(again.log).map((l) => l.method);
    expect(methods).toContain("session/resume");
    expect(methods).not.toContain("session/load");
  });

  test("um agy sem o acp: E_AGENT_TOO_OLD, e nada abre nem é escrito", async () => {
    const data = tmp();
    const e = await rejection(open(data, { KIWI_FAKE_AGY_NO_ACP: "1" }).opened);
    expect(e).toBeInstanceOf(AgentError);
    expect(e.code).toBe("E_AGENT_TOO_OLD");
    expect(existsSync(path.join(data, "agent"))).toBe(false);
  });
});
