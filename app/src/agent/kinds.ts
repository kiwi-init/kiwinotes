// Os agentes que o Kiwi sabe abrir (spec #24666): o Claude Code, pelo adaptador baixado (#8368), e o Gemini CLI, que
// fala ACP sozinho (`gemini --acp`). Um por vez, escolhido em Ajustes › Agente (`agent.kind`).

import type { AgentKind } from "../shared/ui-contract.ts";

export type { AgentKind };

export const AGENT_KINDS: readonly AgentKind[] = ["claude", "gemini"];

/** O nome que a pessoa vê, nas mensagens e nas telas. */
// O Gemini vem pelo Antigravity CLI (`agy`) desde o spec #25046: o Gemini CLI saiu das contas pessoais. O nome diz os
// dois, o modelo e o programa que a pessoa abre no Terminal; o `kind` continua "gemini" (os ajustes salvos ficam).
export const AGENT_NAMES: Record<AgentKind, string> = { claude: "Claude Code", gemini: "Gemini (Antigravity)" };

export function isAgentKind(v: unknown): v is AgentKind {
  return v === "claude" || v === "gemini";
}
