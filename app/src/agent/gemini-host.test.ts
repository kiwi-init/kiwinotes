// O `geminiHost` (spec #24666, T24672): o que ele confere antes de abrir, e como abre o `gemini` falso.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

import { AgentError } from "./errors.ts";
import { writeFakeGeminiExecutable } from "./fake/index.ts";
import { GEMINI_NOT_A_COMMAND, geminiHost, geminiPrompt } from "./gemini-host.ts";
import type { AgentHost } from "./host.ts";
import { tempDir } from "../../test/tmp.ts";

const dirs: string[] = [];
const hosts: AgentHost[] = [];
afterEach(async () => {
  for (const h of hosts.splice(0)) await h.stop();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tmp(): string {
  const d = tempDir("kn-gemini-host-");
  dirs.push(d);
  return d;
}

async function rejection(p: Promise<unknown>): Promise<AgentError> {
  try {
    await p;
  } catch (e) {
    return e as AgentError;
  }
  throw new Error("era para falhar");
}

describe("antes de abrir", () => {
  test("sem programa, ou com um que não existe: E_AGENT_NOT_INSTALLED, com o nome do Gemini", async () => {
    const data = tmp();
    for (const program of [null, [path.join(data, "nao-existe", "gemini")]]) {
      const e = await rejection(geminiHost({ data, program }));
      expect(e).toBeInstanceOf(AgentError);
      expect(e.code).toBe("E_AGENT_NOT_INSTALLED");
      expect(e.message).toContain("Gemini");
    }
    expect(existsSync(path.join(data, "agent"))).toBe(false);
  });

  test("uma versão velha: E_AGENT_TOO_OLD, e nada abre", async () => {
    const data = tmp();
    const exe = writeFakeGeminiExecutable(path.join(data, "bin"), { KIWI_FAKE_GEMINI_VERSION: "0.60.0" });
    const e = await rejection(geminiHost({ data, program: [exe] }));
    expect(e.code).toBe("E_AGENT_TOO_OLD");
    expect(existsSync(path.join(data, "agent"))).toBe(false);
  });
});

describe("a abertura", () => {
  test("abre o gemini com a regra do Kiwi, na sessão dele, e responde", async () => {
    const data = tmp();
    const exe = writeFakeGeminiExecutable(path.join(data, "bin"), {});
    const log = path.join(data, "fake-log.jsonl");
    const { host, status } = await geminiHost({ data, program: [exe], env: { ...process.env, KIWI_FAKE_AGENT_LOG: log } });
    hosts.push(host);
    expect(status).toMatchObject({ installed: true, version: "0.70.0" });
    const s = await host.start();
    expect(s.agent).toEqual({ name: "Gemini CLI", version: "0.70.0" });
    expect((await host.ask("oi")).text).toContain('Você disse: "oi"');
    const argv = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { method: string; params: { argv?: string[] } }).find((l) => l.method === "argv")!.params.argv!;
    expect(argv).toContain("--acp");
    expect(argv.at(-1)).toBe(path.join(data, "agent", "gemini-policy"));
    expect(existsSync(path.join(data, "agent", "gemini-policy", "kiwi.toml"))).toBe(true);
    expect(existsSync(path.join(data, "agent", "session-gemini.json"))).toBe(true);
  });
});

describe("o pedido ao Gemini (ADR 0012)", () => {
  test("um pedido que começa por / ganha a marca; o resto vai como veio", () => {
    expect(geminiPrompt("/resumo da semana")).toBe(`${GEMINI_NOT_A_COMMAND}\n/resumo da semana`);
    expect(geminiPrompt("  /x")).toStartWith(GEMINI_NOT_A_COMMAND);
    expect(geminiPrompt("Resuma a nota /Projetos/exemplo.md")).toBe("Resuma a nota /Projetos/exemplo.md");
  });
});
