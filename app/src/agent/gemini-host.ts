// Abrir o Gemini CLI (spec #24666): o par do `adapter/open.ts` do Claude Code. O Gemini fala ACP sozinho
// (`gemini --acp`), então não há adaptador a baixar: o Kiwi abre o `gemini` que a pessoa instalou, com os argumentos e o
// ambiente do isolamento (`gemini.ts`, T24671).
//
// - **Antes de abrir,** a ordem é a das mensagens que a pessoa vê: instalado e a versão. O login não tem conferência à
//   parte: o Gemini só diz na abertura da sessão (o `authRequired` do ACP), e o Kiwi nunca lê o `~/.gemini`.
// - A sessão fica em `session-gemini.json`, separada da do Claude (`host.ts`).

import { agentDir } from "./adapter/open.ts";
import { AgentError } from "./errors.ts";
import { geminiArgs, geminiEnv, geminiStatus, GEMINI_MIN_VERSION, writeGeminiPolicy, type GeminiStatus } from "./gemini.ts";
import { AgentHost, type AgentHostOptions } from "./host.ts";
import { AGENT_NAMES } from "./kinds.ts";
import type { ProgramArgv } from "./claude.ts";

export const GEMINI = AGENT_NAMES.gemini;

export interface GeminiHostOptions {
  /** A pasta de dados do app (ou a de teste). */
  data: string;
  /** Como abrir o `gemini`: o instalado (`findGemini()`), o falso nos testes, ou null se não há nenhum. */
  program: ProgramArgv | null;
  /** O ambiente base (o do Kiwi); o do isolamento vai por cima. */
  env?: Record<string, string | undefined>;
  host?: Partial<Pick<AgentHostOptions, "kiwiVersion" | "onUpdate" | "configOptions" | "kiwiTools" | "webTools" | "onExit">>;
}

/** Confere o Gemini e devolve o host pronto para o `start()`, ou o erro que a pessoa vai ler. Não abre a sessão. */
export async function geminiHost(o: GeminiHostOptions): Promise<{ host: AgentHost; status: GeminiStatus }> {
  const status = await geminiStatus(o.program);
  if (!status.installed || !o.program) throw new AgentError("E_AGENT_NOT_INSTALLED", GEMINI);
  if (status.tooOld) throw new AgentError("E_AGENT_TOO_OLD", GEMINI, undefined, { instalada: status.version ?? "?", esperada: GEMINI_MIN_VERSION });
  const dir = agentDir(o.data);
  const env = o.env ?? process.env;
  const host = new AgentHost({
    name: GEMINI,
    kind: "gemini",
    // A regra do Kiwi (só as ferramentas dele) é refeita a cada abertura, na pasta do agente (T24671).
    command: [...o.program, ...geminiArgs(writeGeminiPolicy(dir))],
    dir,
    env: { ...env, ...geminiEnv(o.program, env) },
    ...o.host,
  });
  return { host, status };
}

/**
 * A marca que vai antes de um pedido que começaria por `/`. O Gemini roda os comandos da pessoa
 * (`~/.gemini/commands`) quando o pedido começa por `/` (ADR 0012), e o que a pessoa escreve ao Kiwi nunca vira um.
 */
export const GEMINI_NOT_A_COMMAND = "[Pedido da pessoa ao Kiwi, não um comando:]";

/** O pedido como vai ao Gemini: nunca começando por `/`. */
export function geminiPrompt(prompt: string): string {
  return /^\s*\//.test(prompt) ? `${GEMINI_NOT_A_COMMAND}\n${prompt}` : prompt;
}
