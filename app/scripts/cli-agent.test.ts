// `bun run cli agent …` (T8478): a CLI de ponta a ponta, com o `claude` falso e o agente falso.

import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { tempDir } from "../test/tmp.ts";
import { AGY_LOGIN_HELP, GEMINI, GEMINI_NOT_A_COMMAND } from "../src/agent/gemini-host.ts";

const CLI = path.join(import.meta.dir, "cli.ts");
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tmp(): string {
  const d = tempDir("kn-cli-agent-");
  dirs.push(d);
  return d;
}

// Cada teste abre um ou mais `bun cli.ts` de verdade: uns 0,3 s cada, e o pior que medi com 12 núcleos ocupados e
// outro `bun test` junto foi 0,7 s. Mas o runner do CI já parou um desses processos por mais de 5 s, o prazo padrão
// (#14379): o teste caía sem ter nada errado na CLI. O prazo do arquivo é o dos testes que abrem processos, e um
// processo que não termina em 20 s é morto pelo próprio teste, que diz qual comando foi e o que ele escreveu no stderr.
setDefaultTimeout(30_000);
const CLI_DEADLINE_MS = 20_000;

async function cli(args: string[], env: Record<string, string> = {}) {
  const proc = Bun.spawn([process.execPath, CLI, "agent", ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env } });
  let late = false;
  const deadline = setTimeout(() => {
    late = true;
    proc.kill();
  }, CLI_DEADLINE_MS);
  const out = await new Response(proc.stdout).text();
  const exit = await proc.exited;
  clearTimeout(deadline);
  if (late) throw new Error(`a CLI não terminou em ${CLI_DEADLINE_MS / 1000} s: agent ${args.join(" ")}\n${await new Response(proc.stderr).text()}`);
  // Os eventos saem um por linha; a resposta é o último JSON, com várias linhas.
  const start = out.indexOf("\n{\n") >= 0 ? out.indexOf("\n{\n") + 1 : out.indexOf("{");
  const events = out.slice(0, start).trim().split("\n").filter(Boolean).map((l) => (JSON.parse(l) as { event: unknown }).event);
  return { exit, events, result: start >= 0 ? (JSON.parse(out.slice(start)) as Record<string, any>) : null };
}

describe("agent status", () => {
  test("com o claude falso: instalado, a versão e logado, sem a conta", async () => {
    const r = await cli(["status", "--data", tmp()]);
    expect(r.exit).toBe(0);
    expect(r.result!.value).toMatchObject({ agent: "Claude Code", fake: true, installed: true, version: "2.1.322", loggedIn: true, method: "claude.ai" });
    expect(JSON.stringify(r.result)).not.toContain("exemplo");
  });

  test("não logado e não instalado", async () => {
    const out = await cli(["status", "--data", tmp()], { KIWI_FAKE_CLAUDE_LOGGED_IN: "0" });
    expect(out.result!.value).toMatchObject({ installed: true, loggedIn: false });
    const missing = await cli(["status", "--data", tmp(), "--claude", path.join(tmp(), "claude")]);
    expect(missing.result!.value).toMatchObject({ installed: false, loggedIn: false, fake: false });
  });
});

describe("agent ask", () => {
  test("os eventos um por linha, a resposta no fim, e a sessão retomada no pedido seguinte", async () => {
    const data = tmp();
    const first = await cli(["ask", "oi", "--data", data]);
    expect(first.exit).toBe(0);
    expect(first.events).toEqual([
      { type: "status", status: "thinking" },
      { type: "text", text: 'Você disse: "oi". ' },
      { type: "text", text: "Este é o turno 1 desta sessão." },
      { type: "done", stopReason: "end_turn" },
    ]);
    expect(first.result!.value).toMatchObject({ stopReason: "end_turn", resumed: false, fake: true });

    const second = await cli(["ask", "de novo", "--data", data]);
    expect(second.result!.value).toMatchObject({ resumed: true, sessionId: first.result!.value.sessionId });
    expect(second.result!.value.text).toContain("turno 2");

    const fresh = await cli(["ask", "do zero", "--data", data, "--new"]);
    expect(fresh.result!.value.resumed).toBe(false);
    expect(fresh.result!.value.sessionId).not.toBe(first.result!.value.sessionId);
  });

  test.each([
    [["/limite"], {}, "E_AGENT_LIMIT"],
    [["/sem-rede"], {}, "E_AGENT_OFFLINE"],
    [["/sem-login"], {}, "E_AGENT_NOT_LOGGED_IN"],
    [["oi"], { KIWI_FAKE_CLAUDE_LOGGED_IN: "0" }, "E_AGENT_NOT_LOGGED_IN"],
  ] as const)("%p com %p sai com exit 1 e %s", async (args, env, code) => {
    const r = await cli(["ask", ...args, "--data", tmp()], env);
    expect(r.exit).toBe(1);
    expect(r.result).toMatchObject({ ok: false, code });
    expect(r.result!.message).toContain("Claude Code");
  });

  test("sem o claude, não instalado, e o agente nem abre", async () => {
    const data = tmp();
    const r = await cli(["ask", "oi", "--data", data, "--claude", path.join(data, "nao-existe")]);
    expect(r.exit).toBe(1);
    expect(r.result).toMatchObject({ ok: false, code: "E_AGENT_NOT_INSTALLED" });
  });

  test("nunca nos dados do app de verdade", async () => {
    const r = await cli(["ask", "oi", "--data", path.join(os.homedir(), "KiwiNotes", "x")]);
    expect(r.exit).toBe(1);
    expect(r.result!.code).toBe("E_REAL_DATA");
  });

  test("sem texto, uso errado", async () => {
    expect((await cli(["ask"])).exit).toBe(2);
    expect((await cli(["voar"])).exit).toBe(2);
  });
});

describe("o Gemini (spec #24666), com o gemini falso", () => {
  test("status: instalado e a versão; o login só se sabe ao abrir, e não há adaptador", async () => {
    const r = await cli(["status", "--agent", "gemini", "--data", tmp()]);
    expect(r.exit).toBe(0);
    expect(r.result!.value).toMatchObject({ agent: "Gemini (Antigravity)", fake: true, installed: true, loginKnown: false });
    expect(r.result!.value).not.toHaveProperty("adapter");
    expect(r.result!.value).not.toHaveProperty("loggedIn", true);
    const missing = await cli(["status", "--agent", "gemini", "--data", tmp(), "--gemini", path.join(tmp(), "gemini")]);
    expect(missing.result!.value).toMatchObject({ installed: false, fake: false });
  });

  test("ask: a resposta, na sessão do Gemini, retomada no pedido seguinte; a do Claude não muda", async () => {
    const data = tmp();
    const first = await cli(["ask", "oi", "--agent", "gemini", "--data", data]);
    expect(first.exit).toBe(0);
    expect(first.result!.value).toMatchObject({ kind: "gemini", fake: true, resumed: false });
    expect(existsSync(path.join(data, "agent", "session-gemini.json"))).toBe(true);
    expect(existsSync(path.join(data, "agent", "session-claude.json"))).toBe(false);
    const second = await cli(["ask", "de novo", "--agent", "gemini", "--data", data]);
    expect(second.result!.value).toMatchObject({ resumed: true, sessionId: first.result!.value.sessionId });
    // O Claude abre a sessão dele, nova.
    const claude = await cli(["ask", "oi", "--data", data]);
    expect(claude.result!.value).toMatchObject({ kind: "claude", resumed: false });
    expect(claude.result!.value.sessionId).not.toBe(first.result!.value.sessionId);
  });

  test("sem login: o authRequired vira E_AGENT_NOT_LOGGED_IN, em português, sem o texto do Gemini", async () => {
    const data = tmp();
    const out = path.join(data, "sem-login");
    writeFileSync(out, "");
    const r = await cli(["ask", "oi", "--agent", "gemini", "--data", data], { KIWI_FAKE_AGENT_LOGGED_OUT: out });
    expect(r.exit).toBe(1);
    expect(r.result).toMatchObject({ ok: false, code: "E_AGENT_NOT_LOGGED_IN" });
    expect(r.result!.message).toContain(`O ${GEMINI} não está logado`);
    // O `agy` falso é o padrão da CLI (spec #25046): a mensagem diz como entrar no Antigravity.
    expect(r.result!.message).toContain(AGY_LOGIN_HELP);
    expect(r.result!.message).not.toMatch(/auth|required/i);
  });

  test("o agy retoma a sessão pelo session/resume e diz quem é: o Antigravity", async () => {
    const data = tmp();
    const first = await cli(["ask", "oi", "--agent", "gemini", "--data", data], { KIWI_FAKE_AGENT_RESUME: "resume" });
    expect(first.exit).toBe(0);
    expect(first.result!.value.agent).toMatchObject({ name: expect.stringMatching(/Antigravity/) });
    const second = await cli(["ask", "de novo", "--agent", "gemini", "--data", data], { KIWI_FAKE_AGENT_RESUME: "resume" });
    expect(second.result!.value).toMatchObject({ resumed: true, sessionId: first.result!.value.sessionId });
  });

  test("o / no começo do pedido vai com a marca, e não vira um comando do Gemini (ADR 0012)", async () => {
    const data = tmp();
    const log = path.join(data, "fake-log.jsonl");
    const r = await cli(["ask", "/resumo Projeto X", "--agent", "gemini", "--data", data], { KIWI_FAKE_AGENT_LOG: log });
    expect(r.exit).toBe(0);
    const sent = readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { method: string; params: { prompt?: { text: string }[] } })
      .filter((l) => l.method === "session/prompt")
      .map((l) => l.params.prompt![0]!.text);
    expect(sent).toEqual([`${GEMINI_NOT_A_COMMAND}\n/resumo Projeto X`]);
  });

  test("um agente que não existe: uso errado", async () => {
    expect((await cli(["status", "--agent", "codex", "--data", tmp()])).exit).toBe(2);
  });
});

describe("o adaptador do Claude Code (spec #8368)", () => {
  // A CLI usa a lista fixa de verdade: um registro falso serve outros bytes, então todo download dele é "adulterado".
  // O download que dá certo está em `src/agent/adapter/download.test.ts` e na prova `KIWI_ADAPTER_PROOF=1`.
  test("o status diz se o adaptador foi baixado e se a versão do Claude Code serve", async () => {
    const r = await cli(["status", "--data", tmp()]);
    expect(r.result!.value).toMatchObject({ versionOk: true, adapter: { installed: false, version: "0.106.0", claudeCode: "2.1.322" } });
    const old = await cli(["status", "--data", tmp()], { KIWI_FAKE_CLAUDE_VERSION: "2.0.1" });
    expect(old.result!.value).toMatchObject({ versionOk: false, versionError: "E_AGENT_TOO_OLD" });
  });

  test("um pacote que não confere com a lista fixa é recusado, com exit 1, e nada fica instalado", async () => {
    const { fakeRegistry } = await import("../src/agent/fake/registry.ts");
    const reg = fakeRegistry([{ name: "@agentclientprotocol/claude-agent-acp", version: "0.106.0", files: { "dist/index.js": "" } }]);
    try {
      const data = tmp();
      const r = await cli(["download", "--data", data, "--registry", reg.url]);
      expect(r.exit).toBe(1);
      expect(r.result).toMatchObject({ ok: false, code: "E_ADAPTER_TAMPERED" });
      expect(reg.requests).toHaveLength(1);
      expect((await cli(["status", "--data", data])).result!.value.adapter.installed).toBe(false);
    } finally {
      reg.stop();
    }
  });

  test("sem rede: o download e a prova param com um erro claro, sem abrir nada", async () => {
    const closed = "http://127.0.0.1:9";
    const data = tmp();
    const dl = await cli(["download", "--data", data, "--registry", closed]);
    expect(dl.result).toMatchObject({ ok: false, code: "E_ADAPTER_OFFLINE" });
    expect(dl.result!.message).toContain("baixar o adaptador do Claude Code");
    const proof = await cli(["proof", "--data", data, "--registry", closed]);
    expect(proof.exit).toBe(1);
    expect(proof.result).toMatchObject({ ok: false, code: "E_ADAPTER_OFFLINE" });
  });

  test("remover, e nunca nos dados do app de verdade", async () => {
    expect((await cli(["remove", "--data", tmp()])).result).toMatchObject({ ok: true, value: { removed: true } });
    const real = await cli(["download", "--data", path.join(os.homedir(), "KiwiNotes", "x")]);
    expect(real.result!.code).toBe("E_REAL_DATA");
  });
});
