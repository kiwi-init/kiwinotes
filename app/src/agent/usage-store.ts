// O gasto guardado (spec #11084, T11114): o que o agente informou de cada pedido do Kiwi e o último uso da janela, por
// 8 dias, só no Mac (`<dados>/agent/usage.json`, 0600). Daqui saem o medidor de Ajustes › Agente, o aviso antes do fim
// e a hora de volta. Nada em dinheiro, e a pergunta guardada já é a que passou pelo guardrail (sem segredo).

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { type PlacarPartes, type PlacarPedido, somarPartes } from "./placar.ts";
import { type AgentLimit, type AgentUsage, usageTotal } from "./usage.ts";

/** Quanto tempo o gasto fica guardado. */
export const USAGE_KEEP_MS = 8 * 86_400_000;
export const FIVE_HOURS_MS = 5 * 3_600_000;
export const WEEK_MS = 7 * 86_400_000;
/** Quantos caracteres da pergunta ficam guardados, e quantos pedidos caros a lista mostra. */
export const USAGE_QUESTION_CHARS = 120;
export const USAGE_TOP = 5;

/**
 * Quanto do limite da assinatura estava gasto (o `/usage` do Claude Code), em %, e quando (ADR 0013, T13702). Só os
 * números: com alguns dias, sai quanto cada tipo de token pesa no limite.
 */
export interface LimitSnapshot {
  fiveHour?: number;
  week?: number;
  at: number;
}

/**
 * Até quanto tempo entre dois `/usage` o trecho entre eles conta (revisão #13902): mais longe, outro uso da assinatura
 * pode ter entrado no meio. É maior que o intervalo dos `/usage` (10 min), para os trechos saírem de verdade.
 */
export const LIMIT_PAIR_MS = 30 * 60_000;

export interface UsageEntry extends AgentUsage {
  request: string;
  at: number;
  question: string;
  /**
   * O limite antes do pedido e depois dele: os dois `/usage` em volta (lidos em segundo plano, no máximo um a cada
   * 10 min), e quantos pedidos ficaram entre os dois (`shared`). A diferença é desses pedidos juntos, não só deste.
   */
  limit?: { before?: LimitSnapshot; after?: LimitSnapshot; shared?: number };
  /** O placar do pedido (T14671): as idas, as cinco partes e o faro. */
  placar?: PlacarPedido;
}

/** Quantos pedidos a lista do placar mostra. */
export const PLACAR_ULTIMOS = 5;

/** O placar do dia (ADR 0013, T14671): só os pedidos que têm placar. */
export interface PlacarDia {
  pedidos: number;
  idas: number;
  tokens: number;
  partes: PlacarPartes;
  /** Os pedidos com alvo (o faro achou, quase, ou o agente buscou), e em quantos o faro achou antes de perguntar. */
  comFaro: number;
  dePrimeira: number;
  /** Quanto do limite de 5 horas o dia gastou, pelos `/usage` antes e depois; sem nenhum par, fica de fora. */
  limite5h?: number;
  /** Os últimos pedidos, do mais novo para o mais velho. */
  ultimos: { request: string; at: number; question: string; tokens: number; placar: PlacarPedido }[];
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
  /** O último `/usage` lido (ADR 0013): o "antes" do próximo pedido, se ele vier logo. */
  lastLimit?: LimitSnapshot;
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
      const f = { ...raw, version: 1, entries: raw.entries.filter((e) => e && typeof e.at === "number") } as UsageFile;
      // Os 8 dias valem no disco também, mesmo sem pedido novo: o que passou deles sai na hora em que o arquivo é lido.
      const now = this.now();
      if (f.entries.length !== raw.entries.length || f.entries.some((e) => now - e.at >= USAGE_KEEP_MS)) this.save(f);
      return f;
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

  /** O gasto de um pedido que terminou, com o limite de antes dele: o último `/usage`, se foi há até 10 min. */
  record(request: string, question: string, usage: AgentUsage, placar?: PlacarPedido): void {
    const f = this.load();
    const q = question.replace(/\s+/g, " ").trim();
    const before = f.lastLimit && this.now() - f.lastLimit.at <= LIMIT_PAIR_MS ? f.lastLimit : null;
    f.entries.push({
      request,
      at: this.now(),
      question: q.length > USAGE_QUESTION_CHARS ? `${q.slice(0, USAGE_QUESTION_CHARS - 1)}…` : q,
      ...usage,
      ...(before ? { limit: { before } } : {}),
      ...(placar ? { placar } : {}),
    });
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

  /**
   * Um `/usage` lido depois de um pedido (revisão #13902): fecha o trecho que começou no `/usage` anterior. Todos os
   * pedidos desse trecho ganham o mesmo "depois" e quantos eram, se os dois `/usage` estão a até `LIMIT_PAIR_MS`. O
   * novo fica como o "antes" dos próximos.
   */
  noteLimitSnapshot(snap: LimitSnapshot): void {
    const f = this.load();
    const open = f.lastLimit;
    if (open && snap.at - open.at <= LIMIT_PAIR_MS) {
      const span = f.entries.filter((e) => e.limit?.before?.at === open.at && !e.limit.after);
      for (const e of span) e.limit = { ...e.limit, after: snap, shared: span.length };
    }
    f.lastLimit = snap;
    this.save(f);
  }

  /**
   * Os trechos entre dois `/usage` (para a conta do peso de cada tipo de token): o limite de antes e de depois, e os
   * pedidos de dentro, com o gasto de cada um.
   */
  limitSpans(): { before: LimitSnapshot; after: LimitSnapshot; entries: UsageEntry[] }[] {
    const spans = new Map<number, { before: LimitSnapshot; after: LimitSnapshot; entries: UsageEntry[] }>();
    for (const e of this.load().entries) {
      const l = e.limit;
      if (!l?.before || !l.after) continue;
      const s = spans.get(l.before.at) ?? { before: l.before, after: l.after, entries: [] };
      s.entries.push(e);
      spans.set(l.before.at, s);
    }
    return [...spans.values()];
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

  /**
   * O placar de hoje (T14671), do começo do dia no fuso do Mac. O limite do dia é a soma dos trechos entre dois `/usage`
   * que fecharam hoje, cada trecho uma vez (um trecho que passou por uma volta do limite, com o número caindo, fica de
   * fora).
   */
  placarDia(): PlacarDia {
    const now = this.now();
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    const inicio = d.getTime();
    const f = this.load();
    const hoje = f.entries.filter((e) => e.at >= inicio && e.placar);
    const spans = new Map<number, number>();
    for (const e of f.entries) {
      const l = e.limit;
      if (l?.before?.fiveHour === undefined || l.after?.fiveHour === undefined || l.after.at < inicio) continue;
      const delta = l.after.fiveHour - l.before.fiveHour;
      if (delta >= 0) spans.set(l.before.at, delta);
    }
    const limite = [...spans.values()].reduce((a, b) => a + b, 0);
    // Só os pedidos com alvo: o faro achou, quase achou, ou não achou e o agente teve de buscar. Um "obrigado" fica de fora.
    const comFaro = hoje.filter((e) => e.placar!.faro && (e.placar!.faro.kind !== "nada" || e.placar!.faro.searched));
    return {
      pedidos: hoje.length,
      idas: hoje.reduce((s, e) => s + e.placar!.idas, 0),
      tokens: hoje.reduce((s, e) => s + usageTotal(e), 0),
      partes: somarPartes(hoje.map((e) => e.placar!.partes)),
      comFaro: comFaro.length,
      dePrimeira: comFaro.filter((e) => e.placar!.faro!.kind === "certo").length,
      ...(spans.size ? { limite5h: limite } : {}),
      ultimos: f.entries
        .filter((e) => e.placar)
        .slice(-PLACAR_ULTIMOS)
        .reverse()
        .map((e) => ({ request: e.request, at: e.at, question: e.question, tokens: usageTotal(e), placar: e.placar! })),
    };
  }

  /**
   * Apaga o gasto guardado: só os pedidos. O estado do limite (o limite acabado, a hora de volta e o aviso já dado
   * nesta janela) fica, porque o limite continua o mesmo.
   */
  clear(): void {
    const f = this.load();
    f.entries = [];
    this.save(f);
  }
}
