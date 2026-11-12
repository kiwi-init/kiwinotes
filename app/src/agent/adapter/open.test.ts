// Abrir o Claude Code pelo adaptador (spec #8368): as conferências, na ordem das mensagens, e o host montado com o
// Bun do Kiwi e o Claude Code instalado. Tudo com o `claude` falso e um adaptador de mentira: nada abre aqui.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { AgentError } from "../errors.ts";
import { writeFakeClaudeExecutable } from "../fake/index.ts";
import { fakeRegistry, type FakeRegistry } from "../fake/registry.ts";
import { adapterEntry, downloadAdapter, installedAdapter } from "./download.ts";
import { adapterCommand, adapterEnv, adapterRoot, agentDir, claudeAdapterHost } from "./open.ts";
import { ADAPTER_PACKAGE, ADAPTER_VERSION } from "./pinned.ts";

const registries: FakeRegistry[] = [];
afterEach(() => {
  for (const r of registries.splice(0)) r.stop();
});

function tmp(): string {
  return mkdtempSync(path.join(tmpdir(), "kiwi-open-"));
}

async function rejection(p: Promise<unknown>): Promise<AgentError> {
  try {
    await p;
  } catch (e) {
    return e as AgentError;
  }
  throw new Error("era para falhar");
}

describe("o comando e o ambiente", () => {
  test("o adaptador é aberto pelo Bun que roda o Kiwi", () => {
    expect(adapterCommand("/x/0.106.0")).toEqual([process.execPath, adapterEntry("/x/0.106.0")]);
    expect(adapterEntry("/x/0.106.0")).toBe(`/x/0.106.0/node_modules/${ADAPTER_PACKAGE}/dist/index.js`);
  });

  test("o CLAUDE_CODE_EXECUTABLE aponta sempre para o Claude Code que o Kiwi achou, por cima do que já houver", () => {
    const env = adapterEnv("/Users/x/.local/bin/claude", { PATH: "/usr/bin", CLAUDE_CODE_EXECUTABLE: "/outra/copia/claude" });
    expect(env).toEqual({ PATH: "/usr/bin", CLAUDE_CODE_EXECUTABLE: "/Users/x/.local/bin/claude" });
  });

  test("as pastas: a sessão em <dados>/agent e o adaptador em <dados>/agent/adapter", () => {
    expect(agentDir("/d")).toBe("/d/agent");
    expect(adapterRoot("/d")).toBe("/d/agent/adapter");
  });
});

describe("as conferências antes de abrir", () => {
  async function withAdapter(data: string): Promise<void> {
    const r = fakeRegistry([{ name: ADAPTER_PACKAGE, version: ADAPTER_VERSION, files: { "dist/index.js": "" } }]);
    registries.push(r);
    await downloadAdapter({ root: adapterRoot(data), registry: r.url, packages: r.pinned });
    // `claudeAdapterHost` confere a lista fixa de verdade: aqui o marcador é da lista falsa, então a conferência é da
    // pasta, e o teste de "falta o adaptador" usa uma pasta vazia.
    expect(installedAdapter({ root: adapterRoot(data) }, r.pinned)).not.toBeNull();
  }

  test("sem Claude Code: não instalado", async () => {
    const err = await rejection(claudeAdapterHost({ data: tmp(), claudePath: null }));
    expect(err.code).toBe("E_AGENT_NOT_INSTALLED");
  });

  test("um Claude Code mais antigo que o do adaptador: a mensagem diz as duas versões", async () => {
    const data = tmp();
    const claude = writeFakeClaudeExecutable(path.join(data, "bin"), { KIWI_FAKE_CLAUDE_VERSION: "2.0.9" });
    const err = await rejection(claudeAdapterHost({ data, claudePath: claude }));
    expect(err.code).toBe("E_AGENT_TOO_OLD");
    expect(err.message).toContain("versão 2.0.9");
  });

  test("de outra versão principal: indisponível até um Kiwi novo", async () => {
    const data = tmp();
    const claude = writeFakeClaudeExecutable(path.join(data, "bin"), { KIWI_FAKE_CLAUDE_VERSION: "3.0.0" });
    expect((await rejection(claudeAdapterHost({ data, claudePath: claude }))).code).toBe("E_AGENT_TOO_NEW");
  });

  test("não logado", async () => {
    const data = tmp();
    const claude = writeFakeClaudeExecutable(path.join(data, "bin"), { KIWI_FAKE_CLAUDE_LOGGED_IN: "0" });
    expect((await rejection(claudeAdapterHost({ data, claudePath: claude }))).code).toBe("E_AGENT_NOT_LOGGED_IN");
  });

  test("tudo certo, mas o adaptador não foi baixado: falta baixar, e nada vai à rede", async () => {
    const data = tmp();
    const claude = writeFakeClaudeExecutable(path.join(data, "bin"));
    const err = await rejection(claudeAdapterHost({ data, claudePath: claude }));
    expect(err.code).toBe("E_ADAPTER_MISSING");
    expect(err.message).toBe("Falta baixar o adaptador do Claude Code. Ele é baixado uma vez, quando você liga o agente.");
  });

  test("o adaptador de outra lista (um download antigo ou de mentira) também conta como faltando", async () => {
    const data = tmp();
    await withAdapter(data);
    const claude = writeFakeClaudeExecutable(path.join(data, "bin"));
    expect((await rejection(claudeAdapterHost({ data, claudePath: claude }))).code).toBe("E_ADAPTER_MISSING");
  });
});
