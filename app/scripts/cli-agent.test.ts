// `bun run cli agent …` (T8478): a CLI de ponta a ponta, com o `claude` falso e o agente falso.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import os, { tmpdir } from "node:os";
import path from "node:path";

const CLI = path.join(import.meta.dir, "cli.ts");
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tmp(): string {
  const d = mkdtempSync(path.join(tmpdir(), "kn-cli-agent-"));
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
