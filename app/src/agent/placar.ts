// O placar (ADR 0013, "O placar"; T14671): para onde foram os tokens de cada pedido, em Ajustes › Agente. Só no Mac.
//
// - **As idas** se contam pelos eventos do agente: cada leva de ferramentas (do "rodando" até o "pensando" de novo) pede
//   mais uma ida. Um pedido sem ferramenta é 1 ida.
// - **O total é o do agente** (o `usage` do pedido). As partes saem do contador local, pela regra do simulador da bateria
//   (`test/tokens/idas.ts`): cada ida manda de novo o pedido, a bagagem e os resultados das idas de antes.
//   - **pedido:** o que o Kiwi mandou (o pacote, os cartões, o pedido) e a saída do modelo;
//   - **achar** e **ler:** os resultados das ferramentas do Kiwi que acham e que leem (um erro conta como achar);
//   - **bagagem:** a conversa de antes na sessão (a janela) e a cápsula;
//   - **fixo:** o resto, o que o Claude Code leva em toda ida (as instruções e as ferramentas dele) e o que o Kiwi não vê.
//   Se a conta local passar do total, as quatro partes encolhem na mesma proporção e o fixo fica em zero.
// - **O faro:** se o Kiwi achou o alvo antes de perguntar (o certo), quase (o provável) ou não, e se o agente buscou.

import type { FaroResult } from "./faro.ts";
import { type AgentUsage, usageTotal } from "./usage.ts";

export const PLACAR_PARTES = ["pedido", "achar", "ler", "bagagem", "fixo"] as const;
export type PlacarParte = (typeof PLACAR_PARTES)[number];
export type PlacarPartes = Record<PlacarParte, number>;

/** As ferramentas do Kiwi que acham e as que leem (as mesmas da bateria). As outras escrevem ou propõem: são o pedido. */
const ACHAR = new Set(["find", "notes_search", "notes_list", "projects_list", "meetings_list"]);
const LER = new Set(["notes_read", "notes_outline", "files_read", "sheets_read", "meetings_get", "project_status"]);

export function parteDaFerramenta(tool: string, ok: boolean): PlacarParte {
  if (!ok || ACHAR.has(tool)) return "achar";
  if (LER.has(tool)) return "ler";
  return "pedido";
}

/** O que o faro fez no pedido. */
export interface PlacarFaro {
  kind: FaroResult["kind"];
  /** Como achou, no certo: pelo nome, pelo som ou apontado ("essa nota", "a última reunião"). */
  how?: "nome" | "som" | "apontado" | "trilha";
  /** O que a pessoa disse, no apontado. */
  said?: string;
  /** O agente chamou uma ferramenta de achar. */
  searched: boolean;
}

/** O placar de um pedido, guardado com o gasto dele. */
export interface PlacarPedido {
  idas: number;
  partes: PlacarPartes;
  faro?: PlacarFaro;
}

const vazias = (): PlacarPartes => ({ pedido: 0, achar: 0, ler: 0, bagagem: 0, fixo: 0 });

/**
 * O placar de um pedido enquanto ele roda: o service avisa as ferramentas que começam e que terminam, e o "pensando"
 * entre elas. No fim, com o gasto do agente, sai o `PlacarPedido`.
 */
export class PlacarTurno {
  private levas = 0;
  private aberta = false;
  /** Os resultados: os tokens, a parte e a leva em que voltaram (eles entram nas idas depois dela). */
  private readonly resultados: { tokens: number; parte: PlacarParte; leva: number }[] = [];
  private buscou = false;

  constructor(
    /** O que o Kiwi mandou no pedido, menos o começo fixo e a cápsula, em tokens do modelo. */
    private readonly pedido: number,
    /** A conversa de antes na sessão e a cápsula, em tokens do modelo. */
    private readonly bagagem: number,
    private readonly faro: Omit<PlacarFaro, "searched"> | null,
  ) {}

  /** Uma ferramenta começou (qualquer uma, do Kiwi ou não): se nenhuma estava rodando, é uma leva nova. */
  ferramentaComecou(): void {
    if (this.aberta) return;
    this.levas++;
    this.aberta = true;
  }

  /** O agente voltou a pensar: a leva fechou. */
  pensando(): void {
    this.aberta = false;
  }

  /** Uma ferramenta do Kiwi terminou: o resultado, em tokens do modelo. */
  resultado(tool: string, ok: boolean, tokens: number): void {
    const parte = parteDaFerramenta(tool, ok);
    if (parte === "achar") this.buscou = true;
    // Um resultado sem leva aberta (o "começou" não chegou) conta na leva de agora, ou na primeira.
    this.resultados.push({ tokens, parte, leva: Math.max(1, this.levas) });
  }

  get idas(): number {
    return this.levas + 1;
  }

  /** O placar, com o gasto que o agente informou. */
  fim(usage: AgentUsage): PlacarPedido {
    const idas = this.idas;
    const partes = vazias();
    partes.pedido = this.pedido * idas + usage.output;
    partes.bagagem = this.bagagem * idas;
    // Um resultado da leva k entra nas idas k+1 até a última: idas − k vezes.
    for (const r of this.resultados) partes[r.parte] += r.tokens * Math.max(0, idas - r.leva);
    const total = usageTotal(usage);
    const vistos = partes.pedido + partes.achar + partes.ler + partes.bagagem;
    if (vistos > total && vistos > 0) {
      const k = total / vistos;
      for (const p of ["pedido", "achar", "ler", "bagagem"] as const) partes[p] = Math.round(partes[p] * k);
      partes.fixo = 0;
      // O arredondamento: a sobra (±alguns tokens) vai para o pedido, e as partes somam o total.
      partes.pedido += total - (partes.pedido + partes.achar + partes.ler + partes.bagagem);
    } else partes.fixo = total - vistos;
    return { idas, partes, ...(this.faro ? { faro: { ...this.faro, searched: this.buscou } } : {}) };
  }
}

/** O que o faro achou, como o placar guarda. */
export function faroDoPlacar(r: FaroResult | null | undefined): Omit<PlacarFaro, "searched"> | null {
  if (!r) return null;
  if (r.kind !== "certo") return { kind: r.kind };
  return { kind: "certo", how: r.hit.how, ...(r.hit.how === "apontado" ? { said: r.hit.said } : {}) };
}

/** Somar as partes. */
export function somarPartes(ps: readonly PlacarPartes[]): PlacarPartes {
  const s = vazias();
  for (const p of ps) for (const k of PLACAR_PARTES) s[k] += p[k];
  return s;
}
