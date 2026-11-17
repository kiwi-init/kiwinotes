// A régua de versão do Claude Code (spec #8368): igual ou mais novo que o do adaptador, na mesma versão principal.

import { describe, expect, test } from "bun:test";

import { CLAUDE_CODE_FOR_ADAPTER } from "./pinned.ts";
import { checkClaudeVersion, parseVersion, versionError } from "./version.ts";

describe("a régua de versão", () => {
  test("lê a versão como o `claude --version` diz", () => {
    expect(parseVersion("2.1.322 (Claude Code)")).toEqual([2, 1, 322]);
    expect(parseVersion("2.1.400-beta.1")).toEqual([2, 1, 400]);
    expect(parseVersion("claude")).toBeNull();
  });

  test("serve: a mesma versão, e qualquer mais nova da mesma versão principal", () => {
    for (const v of ["2.1.322", "2.1.323", "2.1.1000", "2.2.0", "2.9.1"]) expect(checkClaudeVersion(v, "2.1.322")).toEqual({ ok: true });
  });

  test("mais antigo não serve: a pessoa atualiza o Claude Code", () => {
    for (const v of ["2.1.321", "2.0.999", "1.9.0"]) expect(checkClaudeVersion(v, "2.1.322")).toEqual({ ok: false, code: "E_AGENT_TOO_OLD" });
  });

  test("outra versão principal não serve: o agente espera um Kiwi novo, e nunca usa outra cópia", () => {
    expect(checkClaudeVersion("3.0.0", "2.1.322")).toEqual({ ok: false, code: "E_AGENT_TOO_NEW" });
  });

  test("sem versão é não instalado", () => {
    expect(checkClaudeVersion(null)).toEqual({ ok: false, code: "E_AGENT_NOT_INSTALLED" });
    expect(checkClaudeVersion("?")).toEqual({ ok: false, code: "E_AGENT_NOT_INSTALLED" });
  });

  test("a mensagem diz as duas versões e o que fazer", () => {
    expect(versionError(CLAUDE_CODE_FOR_ADAPTER)).toBeNull();
    expect(versionError("2.0.5", "Claude Code", "2.1.322")?.message).toBe(
      "O Claude Code instalado (versão 2.0.5) é mais antigo que o que este Kiwi usa (2.1.322). Atualize o Claude Code e tente de novo.",
    );
    expect(versionError("3.0.0", "Claude Code", "2.1.322")?.message).toBe(
      "O Claude Code instalado (versão 3.0.0) mudou de série, e este Kiwi só conhece a da 2.1.322. O agente fica indisponível até sair uma atualização do Kiwi Notes.",
    );
  });
});
