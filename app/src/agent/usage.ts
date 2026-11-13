// O que o agente informa sobre o gasto e o limite (spec #11084, T11114), lido de forma defensiva: o Kiwi só usa o que o
// Claude Code manda pelo adaptador (`@agentclientprotocol/claude-agent-acp`), e nunca estima o limite por fora.
//
// - **O gasto de um pedido:** o `usage` da resposta do `session/prompt` (por pedido; só o laço principal: o gasto de um
//   subagente do Claude Code pode ficar de fora).
// - **O uso da janela:** o `_meta["_claude/rateLimit"]` de um `usage_update` (o `SDKRateLimitInfo`), que chega só quando
//   o Claude Code solta um `rate_limit_event`, não em todo pedido.
// - **A hora de volta, no erro de limite:** só a frase da própria mensagem ("will reset at 5pm"), quando ela diz.
// - **O `/usage`:** o adaptador responde em markdown (linhas "**5-hour limit** — **NN%** · Resets Nov 13, 6:40 PM"). Se o
//   texto não tem essas linhas, não há uso da assinatura: a tela mostra só o gasto do Kiwi.
// Nada aqui guarda dinheiro: o `cost` do `usage_update` é um equivalente de API, não o que a pessoa paga.

/** O gasto de um pedido, em tokens. */
export interface AgentUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const usageTotal = (u: AgentUsage): number => u.input + u.output + u.cacheRead + u.cacheWrite;

const count = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);

/** O `usage` da resposta do `session/prompt`; null se não veio ou não tem a forma esperada. */
export function parseUsage(raw: unknown): AgentUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const input = count(o.inputTokens), output = count(o.outputTokens);
  if (input === null || output === null) return null;
  return { input, output, cacheRead: count(o.cachedReadTokens) ?? 0, cacheWrite: count(o.cachedWriteTokens) ?? 0 };
}

export type LimitStatus = "allowed" | "allowed_warning" | "rejected";

/** O uso da janela que o agente informou, num `usage_update`. */
export interface AgentLimit {
  status: LimitStatus;
  /** Qual janela: `five_hour`, `seven_day`… (o que o agente disser). */
  window?: string;
  /** Quanto da janela foi usado, de 0 a 100 (o SDK manda fração ou porcentagem; aqui sempre porcentagem). */
  percent?: number;
  /** Quando a janela volta, em ms desde 1970. */
  resetsAt?: number;
}

/** O `SDKRateLimitInfo` que vem em `_meta["_claude/rateLimit"]` de um `usage_update`. */
export function parseLimit(meta: unknown): AgentLimit | null {
  if (!meta || typeof meta !== "object") return null;
  const info = (meta as Record<string, unknown>)["_claude/rateLimit"];
  if (!info || typeof info !== "object") return null;
  const o = info as Record<string, unknown>;
  if (o.status !== "allowed" && o.status !== "allowed_warning" && o.status !== "rejected") return null;
  const out: AgentLimit = { status: o.status };
  if (typeof o.rateLimitType === "string" && /^[a-z_]{1,40}$/.test(o.rateLimitType)) out.window = o.rateLimitType;
  if (typeof o.utilization === "number" && Number.isFinite(o.utilization) && o.utilization >= 0) {
    out.percent = Math.min(100, o.utilization <= 1 ? o.utilization * 100 : o.utilization);
  }
  if (typeof o.resetsAt === "number" && Number.isFinite(o.resetsAt) && o.resetsAt > 0) {
    // Segundos Unix (o SDK); um valor já em ms também é aceito.
    out.resetsAt = o.resetsAt < 1e12 ? o.resetsAt * 1000 : o.resetsAt;
  }
  return out;
}

/**
 * A hora de volta que a própria mensagem de erro diz ("Your limit will reset at 5pm", "resets at 6:40 PM"), na próxima
 * vez que essa hora chegar, no fuso do Mac. Sem a frase, null: a tela diz só que o limite acabou.
 */
export function parseResetFromError(message: string, now: number): number | null {
  const m = /reset[s]?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(message);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ampm = m[3]?.toLowerCase();
  if (h > 23 || min > 59 || (ampm && (h < 1 || h > 12))) return null;
  if (ampm === "pm" && h < 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  const at = new Date(now);
  at.setHours(h, min, 0, 0);
  if (at.getTime() <= now) at.setDate(at.getDate() + 1);
  return at.getTime();
}

/** Uma janela da assinatura, como o `/usage` respondeu. */
export interface UsageWindow {
  percent: number;
  resetsAt?: number;
}

export interface SubscriptionUsage {
  fiveHour?: UsageWindow;
  week?: UsageWindow;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "Nov 13, 6:40 PM" ou "Nov 13 at 6:40 PM" (em inglês, no fuso do Mac, sem ano) em ms: o ano é o que deixa a data mais perto de agora. */
function parseResetLabel(label: string, now: number): number | undefined {
  // O ICU muda a forma: "Nov 13, 6:40 PM" (Node) ou "Nov 13 at 6:40 PM" (Bun), às vezes com um espaço fino antes do PM.
  const m = /([A-Za-z]{3})[a-z]*\s+(\d{1,2}),?\s+(?:at\s+)?(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(label);
  if (!m) return undefined;
  const month = MONTHS.indexOf(m[1]!.toLowerCase());
  if (month < 0) return undefined;
  let h = Number(m[3]);
  if (m[5]!.toUpperCase() === "PM" && h < 12) h += 12;
  if (m[5]!.toUpperCase() === "AM" && h === 12) h = 0;
  const year = new Date(now).getFullYear();
  const options = [year - 1, year, year + 1].map((y) => new Date(y, month, Number(m[2]), h, Number(m[4])).getTime());
  return options.reduce((a, b) => (Math.abs(b - now) < Math.abs(a - now) ? b : a));
}

/** As janelas de 5 horas e da semana no markdown do `/usage`; null se o texto não tem nenhuma delas. */
export function parseUsageMarkdown(text: string, now: number): SubscriptionUsage | null {
  const out: SubscriptionUsage = {};
  const line = (label: RegExp): UsageWindow | undefined => {
    const re = new RegExp(`\\*\\*${label.source}\\*\\*\\s*—\\s*\\*\\*(\\d{1,3}(?:\\.\\d+)?)%\\*\\*(?:\\s*·\\s*Resets\\s+([^\\n]+))?`, "i");
    const m = re.exec(text);
    if (!m) return undefined;
    const percent = Math.min(100, Number(m[1]));
    const resetsAt = m[2] ? parseResetLabel(m[2], now) : undefined;
    return resetsAt !== undefined ? { percent, resetsAt } : { percent };
  };
  const five = line(/5-hour limit/);
  const week = line(/Weekly · all models/);
  if (five) out.fiveHour = five;
  if (week) out.week = week;
  return five || week ? out : null;
}
