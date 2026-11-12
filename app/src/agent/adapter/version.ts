// A régua de versão do Claude Code (spec #8368). O adaptador é feito para uma versão exata do Claude Code, e o Claude
// Code do Mac se atualiza sozinho, quase todo dia. Por isso a régua não é a versão exata:
// - **serve** o instalado que é igual ou mais novo que o do adaptador, dentro da mesma versão principal;
// - **mais antigo:** a pessoa atualiza o Claude Code;
// - **outra versão principal:** o agente fica indisponível até sair um Kiwi novo, com outro adaptador fixo.
// O Kiwi nunca usa outra cópia do Claude Code para contornar isso.

import { AgentError } from "../errors.ts";
import { CLAUDE_CODE_FOR_ADAPTER } from "./pinned.ts";

/** "2.1.322", "2.1.322-beta.1" ou "2.1.322 (Claude Code)" → [2, 1, 322]; o que não é versão → null. */
export function parseVersion(v: string): [number, number, number] | null {
  const m = /^\s*v?(\d+)\.(\d+)\.(\d+)/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export type VersionCheck = { ok: true } | { ok: false; code: "E_AGENT_TOO_OLD" | "E_AGENT_TOO_NEW" | "E_AGENT_NOT_INSTALLED" };

/** Se o Claude Code instalado serve para o adaptador fixo. */
export function checkClaudeVersion(installed: string | null | undefined, expected = CLAUDE_CODE_FOR_ADAPTER): VersionCheck {
  const have = installed ? parseVersion(installed) : null;
  const want = parseVersion(expected);
  if (!have || !want) return { ok: false, code: "E_AGENT_NOT_INSTALLED" };
  if (have[0] > want[0]) return { ok: false, code: "E_AGENT_TOO_NEW" };
  for (let i = 0; i < 3; i++) {
    if (have[i]! > want[i]!) return { ok: true };
    if (have[i]! < want[i]!) return { ok: false, code: "E_AGENT_TOO_OLD" };
  }
  return { ok: true };
}

/** O erro, com as duas versões na mensagem, ou null quando serve. */
export function versionError(installed: string | null | undefined, agentName = "Claude Code", expected = CLAUDE_CODE_FOR_ADAPTER): AgentError | null {
  const r = checkClaudeVersion(installed, expected);
  if (r.ok) return null;
  return new AgentError(r.code, agentName, `instalada ${installed ?? "nenhuma"}, esperada ${expected}`, {
    instalada: installed ?? "?",
    esperada: expected,
  });
}
