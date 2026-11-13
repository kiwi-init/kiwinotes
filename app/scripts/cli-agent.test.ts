// `bun run cli agent …` (T8478): a CLI de ponta a ponta, com o `claude` falso e o agente falso.

import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { tempDir } from "../test/tmp.ts";

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

async function cli(args: string[], env: Record<string, string> = {}) {
  const proc = Bun.spawn([process.execPath, CLI, "agent", ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env } });
  const out = await new Response(proc.stdout).text();
  const exit = await proc.exited;
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
