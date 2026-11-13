// O gasto guardado (spec #11084, T11114): o que o agente informou de cada pedido do Kiwi e o último uso da janela, por
// 8 dias, só no Mac (`<dados>/agent/usage.json`, 0600). Daqui saem o medidor de Ajustes › Agente, o aviso antes do fim
// e a hora de volta. Nada em dinheiro, e a pergunta guardada já é a que passou pelo guardrail (sem segredo).

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { type AgentLimit, type AgentUsage, usageTotal } from "./usage.ts";

/** Quanto tempo o gasto fica guardado. */
export const USAGE_KEEP_MS = 8 * 86_400_000;
export const FIVE_HOURS_MS = 5 * 3_600_000;
export const WEEK_MS = 7 * 86_400_000;
/** Quantos caracteres da pergunta ficam guardados, e quantos pedidos caros a lista mostra. */
export const USAGE_QUESTION_CHARS = 120;
export const USAGE_TOP = 5;

export interface UsageEntry extends AgentUsage {
  request: string;
  at: number;
  question: string;
}

export interface UsageSum {
  requests: number;
  tokens: number;
  /** Quanto da entrada veio do cache (tokens lidos do cache). */
  cacheRead: number;
}

export interface UsageSummary {
  fiveHours: UsageSum;
  week: UsageSum;
  /** Os pedidos mais caros da semana, do mais caro para o menos. */
  top: { request: string; at: number; question: string; tokens: number }[];
  /** O último uso da janela que o agente informou, e quando chegou. */
  limit: (AgentLimit & { at: number }) | null;
  /** O limite acabou: desde quando, e a hora de volta, se o agente informou. Some depois da hora. */
  out: { at: number; resetsAt?: number } | null;
}

interface UsageFile {
  version: 1;
  entries: UsageEntry[];
  limit?: AgentLimit & { at: number };
  out?: { at: number; resetsAt?: number };
  /** O fim da janela em que o aviso já apareceu (um aviso por janela). */
  warned?: number;
}

const EMPTY: UsageFile = { version: 1, entries: [] };

function sum(entries: UsageEntry[]): UsageSum {
  return entries.reduce((s, e) => ({ requests: s.requests + 1, tokens: s.tokens + usageTotal(e), cacheRead: s.cacheRead + e.cacheRead }), {
    requests: 0,
    tokens: 0,
    cacheRead: 0,
  });
}

export class UsageStore {
  private readonly file: string;

  constructor(
    dir: string,
    private readonly now: () => number = Date.now,
  ) {
    this.file = path.join(dir, "usage.json");
  }

  private load(): UsageFile {
    if (!existsSync(this.file)) return { ...EMPTY, entries: [] };
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as Partial<UsageFile>;
      if (raw.version !== 1 || !Array.isArray(raw.entries)) throw new Error("bad");
      return { ...raw, version: 1, entries: raw.entries.filter((e) => e && typeof e.at === "number") } as UsageFile;
    } catch {
      // Um arquivo estragado vai para o lado; o medidor começa de novo, sem quebrar o pedido.
      try {
        renameSync(this.file, `${this.file}.bad`);
      } catch {
        // nada
      }
      return { ...EMPTY, entries: [] };
    }
  }

  private save(f: UsageFile): void {
    mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const now = this.now();
    f.entries = f.entries.filter((e) => now - e.at < USAGE_KEEP_MS);
    if (f.out?.resetsAt !== undefined && f.out.resetsAt <= now) delete f.out;
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(f), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, this.file);
  }

  /** O gasto de um pedido que terminou. */
  record(request: string, question: string, usage: AgentUsage): void {
    const f = this.load();
    const q = question.replace(/\s+/g, " ").trim();
    f.entries.push({ request, at: this.now(), question: q.length > USAGE_QUESTION_CHARS ? `${q.slice(0, USAGE_QUESTION_CHARS - 1)}…` : q, ...usage });
    // Um pedido que passa sem o limite recusado quer dizer que o limite voltou.
    if (f.out && f.out.resetsAt === undefined) delete f.out;
    this.save(f);
  }

  /**
   * O uso da janela que o agente informou. Devolve true quando é o aviso dele (`allowed_warning`) pela primeira vez
   * nesta janela: quem chama mostra o aviso uma vez.
   */
  noteLimit(limit: AgentLimit): boolean {
    const f = this.load();
    const now = this.now();
    f.limit = { ...limit, at: now };
    let warn = false;
    if (limit.status === "rejected") f.out = limit.resetsAt !== undefined ? { at: now, resetsAt: limit.resetsAt } : { at: now };
    else if (f.out) delete f.out;
    if (limit.status === "allowed_warning") {
      // A janela é a do `resetsAt`; sem ele, as próximas 5 horas.
      const windowEnd = limit.resetsAt ?? now + FIVE_HOURS_MS;
      if (!f.warned || f.warned <= now) {
        f.warned = windowEnd;
        warn = true;
      }
    }
    this.save(f);
    return warn;
  }

  /** O pedido falhou por limite: a hora de volta só se o agente a informou (no `resetsAt` antes, ou na mensagem). */
  noteOut(resetsAt: number | null): void {
    const f = this.load();
    const known = resetsAt ?? f.out?.resetsAt ?? (f.limit?.status === "rejected" ? f.limit.resetsAt : undefined);
    f.out = known !== undefined && known > this.now() ? { at: this.now(), resetsAt: known } : { at: this.now() };
    this.save(f);
  }

  summary(): UsageSummary {
    const f = this.load();
    const now = this.now();
    const week = f.entries.filter((e) => now - e.at < WEEK_MS);
    const five = week.filter((e) => now - e.at < FIVE_HOURS_MS);
    const top = [...week]
      .sort((a, b) => usageTotal(b) - usageTotal(a))
      .slice(0, USAGE_TOP)
      .map((e) => ({ request: e.request, at: e.at, question: e.question, tokens: usageTotal(e) }));
    const out = f.out && (f.out.resetsAt === undefined || f.out.resetsAt > now) ? f.out : null;
    return { fiveHours: sum(five), week: sum(week), top, limit: f.limit ?? null, out };
  }

  /** Apaga o gasto guardado. */
  clear(): void {
    this.save({ ...EMPTY, entries: [] });
  }
}
