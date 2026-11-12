// Os erros do host do agente (spec #4576): tudo o que dá errado ao falar com o agente vira um destes casos, com uma
// mensagem que a pessoa entende. Os quatro do spec (não instalado, não logado, limite atingido e sem rede) e os do
// próprio host (ocupado, falhou).
//
// O formato real dos erros do Claude Code pelo adaptador ACP só se confere com o Claude Code de verdade (spec #8368,
// ADR 0012). Por isso a classificação olha primeiro o que o ACP define (o código -32000 de `authRequired`) e um
// `data.reason` explícito, e só depois procura palavras na mensagem.

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
  | "E_AGENT_TOO_OLD"
  | "E_AGENT_TOO_NEW";

/**
 * A mensagem de cada caso, para a pessoa ler. `{agente}` vira o nome do agente; `{instalada}` e `{esperada}` são as
 * versões, nos dois erros de versão.
 */
export const AGENT_ERROR_MESSAGES: Record<AgentErrorCode, string> = {
  E_AGENT_NOT_INSTALLED: "O {agente} não está instalado neste Mac. Instale e tente de novo.",
  E_AGENT_NOT_LOGGED_IN: "O {agente} não está logado. Entre na sua conta pelo próprio {agente} e tente de novo.",
  E_AGENT_LIMIT: "O {agente} atingiu o limite de uso da sua conta. Espere o limite voltar e tente de novo.",
  E_AGENT_OFFLINE: "Sem conexão com a internet. O {agente} precisa de rede para responder.",
  E_AGENT_BUSY: "O {agente} ainda está respondendo o pedido anterior. Espere terminar ou cancele.",
  E_AGENT_FAILED: "O {agente} falhou ao responder. Tente de novo.",
  E_ADAPTER_MISSING: "Falta baixar o adaptador do {agente}. Ele é baixado uma vez, quando você liga o agente.",
  E_ADAPTER_OFFLINE: "Sem conexão com a internet. O Kiwi precisa de rede para baixar o adaptador do {agente}.",
  E_ADAPTER_TAMPERED:
    "Um pacote do adaptador do {agente} chegou diferente do esperado e foi apagado. Nada foi instalado. Tente de novo mais tarde.",
  E_ADAPTER_DOWNLOAD: "O download do adaptador do {agente} falhou. Nada foi instalado. Tente de novo mais tarde.",
  E_AGENT_TOO_OLD:
    "O {agente} instalado (versão {instalada}) é mais antigo que o que este Kiwi usa ({esperada}). Atualize o {agente} e tente de novo.",
  E_AGENT_TOO_NEW:
    "O {agente} instalado (versão {instalada}) mudou de série, e este Kiwi só conhece a da {esperada}. O agente fica indisponível até sair uma atualização do Kiwi Notes.",
};

export class AgentError extends Error {
  readonly code: AgentErrorCode;
  /** O que o agente disse, cru, para o log. Nunca vai para a mensagem da pessoa. */
  readonly detail?: string;
  constructor(code: AgentErrorCode, agentName = "agente", detail?: string, vars: Record<string, string> = {}) {
    let message = AGENT_ERROR_MESSAGES[code].replaceAll("{agente}", agentName);
    for (const [k, v] of Object.entries(vars)) message = message.replaceAll(`{${k}}`, v);
    super(message);
    this.name = "AgentError";
    this.code = code;
    this.detail = detail;
  }
}

/** O código JSON-RPC que o ACP dá ao `authRequired` (`RequestError.authRequired()`). */
export const ACP_AUTH_REQUIRED = -32000;

const LIMIT = /rate.?limit|usage limit|limit reached|quota|too many requests|\b429\b|limite/i;
const OFFLINE = /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|network|offline|fetch failed|sem conex|internet/i;
const NOT_LOGGED_IN = /not logged in|log ?in|sign ?in|authenticat|unauthori[sz]ed|\b401\b|invalid api key|credential/i;

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
export function classifyAgentError(err: unknown, agentName = "agente"): AgentError {
  if (err instanceof AgentError) return err;
  const detail = textOf(err).slice(0, 2000);
  const e = (err ?? {}) as { code?: unknown; data?: { reason?: unknown } };
  if (e.code === "ENOENT") return new AgentError("E_AGENT_NOT_INSTALLED", agentName, detail);
  if (e.code === ACP_AUTH_REQUIRED) return new AgentError("E_AGENT_NOT_LOGGED_IN", agentName, detail);
  const reason = typeof e.data === "object" && e.data ? e.data.reason : undefined;
  if (reason === "auth_required") return new AgentError("E_AGENT_NOT_LOGGED_IN", agentName, detail);
  if (reason === "rate_limited" || reason === "quota_exhausted") return new AgentError("E_AGENT_LIMIT", agentName, detail);
  if (reason === "transport_lost" || reason === "offline") return new AgentError("E_AGENT_OFFLINE", agentName, detail);
  if (LIMIT.test(detail)) return new AgentError("E_AGENT_LIMIT", agentName, detail);
  if (OFFLINE.test(detail)) return new AgentError("E_AGENT_OFFLINE", agentName, detail);
  if (NOT_LOGGED_IN.test(detail)) return new AgentError("E_AGENT_NOT_LOGGED_IN", agentName, detail);
  return new AgentError("E_AGENT_FAILED", agentName, detail);
}
