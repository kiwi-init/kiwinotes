// O Gemini CLI (spec #24666, parte 1): achar, a versão, o isolamento e o Gemini falso pelo host. Nenhum teste roda o
// Gemini de verdade: o `gemini` aqui é sempre o falso (`fake/gemini.ts`).

import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { AgentError } from "./errors.ts";
import { FAKE_GEMINI, writeFakeGeminiExecutable } from "./fake/index.ts";
import {
  compareVersions,
  findGemini,
  GEMINI_MIN_VERSION,
  GEMINI_POLICY,
  geminiArgs,
  geminiEnv,
  geminiSearchDirs,
  geminiStatus,
  geminiVersion,
  geminiVersionOk,
  writeGeminiPolicy,
} from "./gemini.ts";
import { AgentHost } from "./host.ts";
import { tempDir } from "../../test/tmp.ts";

const dirs: string[] = [];
const hosts: AgentHost[] = [];
afterEach(async () => {
  for (const h of hosts.splice(0)) await h.stop();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tmp(): string {
  const d = tempDir("kn-gemini-");
  dirs.push(d);
  return d;
}

function file(p: string, mode: number): string {
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, "#!/bin/sh\n");
  chmodSync(p, mode);
  return p;
}

describe("achar o gemini", () => {
  test("o primeiro executável das pastas, na ordem; sem permissão de execução ou uma pasta não contam", () => {
    const d = tmp();
    file(path.join(d, "a", "gemini"), 0o644);
    mkdirSync(path.join(d, "b", "gemini"), { recursive: true });
    const c = file(path.join(d, "c", "gemini"), 0o755);
    file(path.join(d, "d", "gemini"), 0o755);
    expect(findGemini(["a", "b", "c", "d"].map((x) => path.join(d, x)))).toBe(c);
    expect(findGemini([path.join(d, "a"), path.join(d, "nao-existe")])).toBeNull();
  });

  test("o PATH primeiro, depois o Homebrew, o npm global, o Volta, o Bun e o nvm (o mais novo antes)", () => {
    const home = tmp();
    for (const v of ["v18.20.0", "v22.3.0", "v20.11.1", "nao-e-versao"]) mkdirSync(path.join(home, ".nvm", "versions", "node", v), { recursive: true });
    const found = geminiSearchDirs({ PATH: "/um:/dois:/um" }, home);
    expect(found).toEqual([
      "/um",
      "/dois",
      "/opt/homebrew/bin",
      "/usr/local/bin",
      path.join(home, ".npm-global", "bin"),
      path.join(home, ".volta", "bin"),
      path.join(home, ".bun", "bin"),
      path.join(home, ".local", "bin"),
      path.join(home, ".nvm", "versions", "node", "v22.3.0", "bin"),
      path.join(home, ".nvm", "versions", "node", "v20.11.1", "bin"),
      path.join(home, ".nvm", "versions", "node", "v18.20.0", "bin"),
    ]);
  });

  test("o prefixo do npm da pessoa (NPM_CONFIG_PREFIX) também conta", () => {
    expect(geminiSearchDirs({ PATH: "", NPM_CONFIG_PREFIX: "/opt/npm" }, "/Users/exemplo")).toContain("/opt/npm/bin");
  });
});

describe("a versão", () => {
  test("compara a.b.c pelo número, não pelo texto; o sufixo não conta", () => {
    expect(compareVersions("0.70.0", "0.9.0")).toBeGreaterThan(0);
    expect(compareVersions("0.69.9", "0.70.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "0.70.0")).toBeGreaterThan(0);
    expect(compareVersions("0.70.0-preview.1", "0.70.0")).toBe(0);
    expect(geminiVersionOk(GEMINI_MIN_VERSION)).toBe(true);
    expect(geminiVersionOk("0.34.0")).toBe(false);
  });

  test("sai do --version do gemini falso", async () => {
    expect(await geminiVersion(FAKE_GEMINI)).toBe("0.70.0");
  });

  test("instalado e a versão; o login fica indefinido (o Gemini não diz sem abrir uma sessão)", async () => {
    const exe = writeFakeGeminiExecutable(tmp());
    const s = await geminiStatus([exe]);
    expect(s).toEqual({ installed: true, path: exe, version: "0.70.0" });
    expect("loggedIn" in s).toBe(false);
  });

  test("uma versão mais velha que a mínima sai como tooOld", async () => {
    const exe = writeFakeGeminiExecutable(tmp(), { KIWI_FAKE_GEMINI_VERSION: "0.33.0" });
    expect(await geminiStatus([exe])).toEqual({ installed: true, path: exe, version: "0.33.0", tooOld: true });
  });

  test("sem programa, ou um que não responde a versão, é não instalado", async () => {
    expect(await geminiStatus(null)).toEqual({ installed: false });
    const bad = file(path.join(tmp(), "gemini"), 0o755);
    writeFileSync(bad, "#!/bin/sh\nexit 3\n");
    expect(await geminiStatus([bad])).toEqual({ installed: false, path: bad });
  });

  test("um --version que trava passa do tempo e volta null", async () => {
    const exe = writeFakeGeminiExecutable(tmp(), { KIWI_FAKE_GEMINI_DELAY_MS: "5000" });
    const t = Date.now();
    expect(await geminiVersion([exe], 300)).toBeNull();
    expect(Date.now() - t).toBeLessThan(3000);
  });
});

describe("o isolamento", () => {
  test("os argumentos: ACP, sem YOLO, sem extensões, só o servidor kiwi e a regra de administrador", () => {
    expect(geminiArgs("/dados/agent/gemini-policy")).toEqual([
      "--acp",
      "--approval-mode",
      "default",
      "--extensions",
      "none",
      "--allowed-mcp-server-names",
      "kiwi",
      "--admin-policy",
      "/dados/agent/gemini-policy",
    ]);
  });

  test("a regra nega toda ferramenta e libera só as do servidor kiwi, com prioridade maior", () => {
    const dir = writeGeminiPolicy(path.join(tmp(), "agent"));
    expect(readdirSync(dir)).toEqual(["kiwi.toml"]);
    const toml = readFileSync(path.join(dir, "kiwi.toml"), "utf8");
    expect(toml).toBe(GEMINI_POLICY);
    const { rule: rules } = Bun.TOML.parse(toml) as { rule: Record<string, unknown>[] };
    expect(rules).toEqual([
      { toolName: "*", decision: "deny", priority: 900, denyMessage: "O Kiwi Notes só libera as ferramentas dele." },
      { toolName: "*", mcpName: "kiwi", decision: "allow", priority: 999 },
    ]);
  });

  // O Gemini 0.70.0 pula o arquivo inteiro quando uma regra sai do schema (`packages/core/src/policy/toml-loader.ts`:
  // o `PolicyRuleSchema` e o `continue` depois do `schema_validation`): o `deny` cairia junto e as ferramentas
  // embutidas voltariam sem aviso. Toda regra precisa de `toolName` (texto ou lista), `decision` e `priority` inteira de
  // 0 a 999; os outros campos são os que o schema conhece.
  test("toda regra cabe no schema do Gemini 0.70.0 (senão ele pula o arquivo e o isolamento cai)", () => {
    const { rule: rules } = Bun.TOML.parse(GEMINI_POLICY) as { rule: Record<string, unknown>[] };
    expect(rules.length).toBeGreaterThan(0);
    const known = new Set(["toolName", "subagent", "mcpName", "toolAnnotations", "argsPattern", "commandPrefix", "commandRegex", "decision", "priority", "modes", "interactive", "denyMessage", "allowRedirection", "allowCommandSubstitution"]);
    for (const r of rules) {
      const t = r.toolName;
      expect(typeof t === "string" || (Array.isArray(t) && t.every((x) => typeof x === "string"))).toBe(true);
      expect(["allow", "deny", "ask_user"]).toContain(r.decision as string);
      expect(Number.isInteger(r.priority) && (r.priority as number) >= 0 && (r.priority as number) <= 999).toBe(true);
      for (const k of Object.keys(r)) expect(known.has(k) ? k : `campo que o schema não conhece: ${k}`).toBe(k);
    }
  });

  test("o ambiente: a pasta do gemini no começo do PATH (o Node do npm), um processo só e sem navegador", () => {
    const env = geminiEnv(["/Users/exemplo/.nvm/versions/node/v22.3.0/bin/gemini"], { PATH: "/usr/bin:/Users/exemplo/.nvm/versions/node/v22.3.0/bin" });
    expect(env).toEqual({
      PATH: "/Users/exemplo/.nvm/versions/node/v22.3.0/bin:/usr/bin:/opt/homebrew/bin:/usr/local/bin:/bin",
      GEMINI_CLI_NO_RELAUNCH: "1",
      NO_BROWSER: "true",
    });
  });

  test("nada do código do agente aponta para a pasta do Gemini da pessoa (ADR 0011)", () => {
    const root = import.meta.dir;
    const found: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) {
          const code = readFileSync(p, "utf8")
            .split("\n")
            .filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l))
            .join("\n");
          if (/["'`/]\.gemini\b|GEMINI_CLI_HOME|GEMINI_API_KEY|oauth_creds/.test(code)) found.push(path.relative(root, p));
        }
      }
    };
    walk(root);
    expect(found).toEqual([]);
  });
});

/** O host com o gemini falso, aberto como o Kiwi o abre (os argumentos e o ambiente do isolamento). */
function geminiHost(dir: string, env: Record<string, string> = {}) {
  const log = path.join(dir, "fake-log.jsonl");
  const exe = writeFakeGeminiExecutable(path.join(dir, "bin"), env);
  const agentDir = path.join(dir, "agent");
  const h = new AgentHost({
    name: "Gemini",
    command: [exe, ...geminiArgs(writeGeminiPolicy(agentDir))],
    dir: agentDir,
    env: { ...process.env, ...geminiEnv([exe]), KIWI_FAKE_AGENT_LOG: log },
  });
  hosts.push(h);
  const lines = () =>
    existsSync(log)
      ? readFileSync(log, "utf8")
          .trim()
          .split("\n")
          .map((l) => JSON.parse(l) as { method: string; params: Record<string, unknown> })
      : [];
  return { h, lines, exe };
}

async function rejection(p: Promise<unknown>): Promise<AgentError> {
  try {
    await p;
  } catch (e) {
    return e as AgentError;
  }
  throw new Error("era para falhar");
}

describe("o gemini falso pelo host", () => {
  test("abre com os argumentos e o ambiente do isolamento, na pasta de trabalho, e se apresenta como o Gemini CLI", async () => {
    const d = tmp();
    const { h, lines, exe } = geminiHost(d);
    const s = await h.start();
    // O host mostra o `title` do `agentInfo` (o `name` do Gemini é "gemini-cli").
    expect(s.agent).toEqual({ name: "Gemini CLI", version: "0.70.0" });
    const argv = lines().find((l) => l.method === "argv")!.params as { argv: string[]; cwd: string; env: Record<string, unknown> };
    expect(argv.argv).toEqual(geminiArgs(path.join(d, "agent", "gemini-policy")));
    expect(argv.cwd).toBe(path.join(d, "agent", "work"));
    expect(argv.env).toEqual({ GEMINI_CLI_NO_RELAUNCH: "1", NO_BROWSER: "true", pathFirst: path.dirname(exe) });
    // O Kiwi nunca chama o `authenticate`: o login é da pessoa.
    expect(lines().map((l) => l.method)).not.toContain("authenticate");
    const a = await h.ask("oi");
    expect(a.text).toContain('Você disse: "oi"');
  });

  test("sem login, a sessão não abre: o -32000 do Gemini vira o E_AGENT_NOT_LOGGED_IN, sem authenticate", async () => {
    const { h, lines } = geminiHost(tmp(), { KIWI_FAKE_GEMINI_LOGGED_IN: "0" });
    const e = await rejection(h.start());
    expect(e.code).toBe("E_AGENT_NOT_LOGGED_IN");
    expect(lines().map((l) => l.method)).not.toContain("authenticate");
  });

  test("o Gemini não tem session/resume: o host volta à mesma sessão pelo session/load", async () => {
    const d = tmp();
    const first = geminiHost(d);
    const s1 = await first.h.start();
    await first.h.ask("oi");
    await first.h.stop();
    hosts.splice(hosts.indexOf(first.h), 1);
    const again = geminiHost(d);
    const s2 = await again.h.start();
    expect(s2.resumed).toBe(true);
    expect(s2.sessionId).toBe(s1.sessionId);
    const methods = again.lines().map((l) => l.method);
    expect(methods).toContain("session/load");
    expect(methods).not.toContain("session/resume");
  });

  test("o limite do Gemini é o código 429 com a frase dele", async () => {
    const { h } = geminiHost(tmp());
    await h.start();
    const e = await rejection(h.ask("/limite"));
    expect(e.code).toBe("E_AGENT_LIMIT");
  });

  test("sem rede, o 500 com o \"fetch failed\" do Gemini é o E_AGENT_OFFLINE", async () => {
    const { h } = geminiHost(tmp());
    await h.start();
    const e = await rejection(h.ask("/sem-rede"));
    expect(e.code).toBe("E_AGENT_OFFLINE");
  });
});
