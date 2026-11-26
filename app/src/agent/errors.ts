// Os erros do host do agente (spec #4576): tudo o que dá errado ao falar com o agente vira um destes casos, com uma
// mensagem que a pessoa entende. Os quatro do spec (não instalado, não logado, limite atingido e sem rede) e os do
// próprio host (ocupado, falhou).
//
// O formato real dos erros do Claude Code pelo adaptador ACP só se confere com o Claude Code de verdade (spec #8368,
// ADR 0012). Por isso a classificação olha primeiro o que o ACP define (o código -32000 de `authRequired`) e um
// `data.reason` explícito, e só depois procura palavras na mensagem.

import { mainLocale } from "../bun/locale.ts";
import { type Locale, type TextKey, translate } from "../shared/i18n/index.ts";

export type AgentErrorCode =
  | "E_AGENT_NOT_INSTALLED"
  | "E_AGENT_NOT_LOGGED_IN"
  | "E_AGENT_LIMIT"
  | "E_AGENT_OFFLINE"
  | "E_AGENT_BUSY"
  | "E_AGENT_FAILED"
  // O adaptador do Claude Code (spec #8368): o download e a régua de versão.
  | "E_ADAPTER_MISSING"
  | "E_ADAPTER_OFFLINE"
  | "E_ADAPTER_TAMPERED"
  | "E_ADAPTER_DOWNLOAD"
  | "E_ADAPTER_CANCELLED"
  | "E_AGENT_TOO_OLD"
  | "E_AGENT_TOO_NEW";

/** A chave do catálogo de cada caso (T30986): a mensagem sai na língua do app, como o resto do main. */
export const agentErrorKey = (code: AgentErrorCode): TextKey => `agent.error.${code}`;

/**
 * A mensagem de um caso, para a pessoa ler, na língua dada. `{agente}` vira o nome do agente; `{entrar}`, como entrar
 * na conta (o padrão, ou o `loginHelp` do host); `{instalada}` e `{esperada}`, as versões nos dois erros de versão.
 */
export function agentErrorMessage(
  code: AgentErrorCode,
  locale: Locale,
  agentName?: string,
  vars: Record<string, string> = {},
  loginHelp: TextKey = "agent.error.login",
): string {
  const agente = agentName ?? translate(locale, "agent.error.someAgent");
  const entrar = translate(locale, loginHelp, { agente });
  const text = translate(locale, agentErrorKey(code), { entrar, ...vars, agente });
  // Em inglês a frase pode começar pelo nome: "the agent" vira "The agent".
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export class AgentError extends Error {
  readonly code: AgentErrorCode;
  /** O que o agente disse, cru, para o log. Nunca vai para a mensagem da pessoa. */
  readonly detail?: string;
  constructor(
    code: AgentErrorCode,
    agentName?: string,
    detail?: string,
    vars: Record<string, string> = {},
    loginHelp?: TextKey,
    locale: Locale = mainLocale.get(),
  ) {
    super(agentErrorMessage(code, locale, agentName, vars, loginHelp));
    this.name = "AgentError";
    this.code = code;
    this.detail = detail;
  }
}

/** O código JSON-RPC que o ACP dá ao `authRequired` (`RequestError.authRequired()`). */
export const ACP_AUTH_REQUIRED = -32000;

// O Gemini CLI (spec #24666) diz o limite com o status do Google (`RESOURCE_EXHAUSTED`) e o login com "auth method" ou a
// falta da chave de API ("API key is missing"); o Kiwi só procura as palavras, nunca lê a chave.
const LIMIT = /rate.?limit|usage limit|limit reached|quota|too many requests|\b429\b|RESOURCE_EXHAUSTED|limite/i;
const OFFLINE = /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|network|offline|fetch failed|sem conex|internet/i;
const NOT_LOGGED_IN = /not logged in|log ?in|sign ?in|authenticat|unauthori[sz]ed|\b401\b|invalid api key|credential|auth method|api key (?:is )?(?:missing|not valid)|UNAUTHENTICATED/i;

/** O texto de um erro qualquer: a mensagem, o `data` do JSON-RPC e a causa, para procurar as palavras. */
function textOf(err: unknown): string {
  if (err == null) return "";
  if (typeof err === "string") return err;
  const e = err as { message?: unknown; data?: unknown; cause?: unknown };
  const parts = [typeof e.message === "string" ? e.message : ""];
  if (e.data !== undefined) parts.push(typeof e.data === "string" ? e.data : JSON.stringify(e.data));
  if (e.cause) parts.push(textOf(e.cause));
  return parts.join(" ");
}

/**
 * Um erro qualquer (do ACP, do processo ou de rede) vira um `AgentError`. A ordem importa: o `authRequired` do ACP
 * e o `data.reason` vêm antes das palavras, e o limite vem antes do login (uma mensagem de limite costuma dizer "account").
 */
export function classifyAgentError(err: unknown, agentName?: string, loginHelp?: TextKey): AgentError {
  if (err instanceof AgentError) return err;
  const notLoggedIn = (detail: string) => new AgentError("E_AGENT_NOT_LOGGED_IN", agentName, detail, {}, loginHelp);
  const detail = textOf(err).slice(0, 2000);
  const e = (err ?? {}) as { code?: unknown; data?: { reason?: unknown } };
  if (e.code === "ENOENT") return new AgentError("E_AGENT_NOT_INSTALLED", agentName, detail);
  if (e.code === ACP_AUTH_REQUIRED) return notLoggedIn(detail);
  const reason = typeof e.data === "object" && e.data ? e.data.reason : undefined;
  if (reason === "auth_required") return notLoggedIn(detail);
  if (reason === "rate_limited" || reason === "quota_exhausted") return new AgentError("E_AGENT_LIMIT", agentName, detail);
  if (reason === "transport_lost" || reason === "offline") return new AgentError("E_AGENT_OFFLINE", agentName, detail);
  if (LIMIT.test(detail)) return new AgentError("E_AGENT_LIMIT", agentName, detail);
  if (OFFLINE.test(detail)) return new AgentError("E_AGENT_OFFLINE", agentName, detail);
  if (NOT_LOGGED_IN.test(detail)) return notLoggedIn(detail);
  return new AgentError("E_AGENT_FAILED", agentName, detail);
}
