// Os textos do placar (ADR 0013, "O placar"; T14671), separados da tela para os testes lerem cada estado sem navegador.
// Só tokens, idas e a % do limite que o `/usage` informou: nada em dinheiro.

import type { AgentPlacarFaro, AgentPlacarPartes, AgentPlacarView } from "../../src/shared/ui-contract.ts";

export const PARTES: { key: keyof AgentPlacarPartes; label: string; hint: string }[] = [
  { key: "pedido", label: "Pedido", hint: "o que você pediu, a nota entregue e a resposta" },
  { key: "achar", label: "Achar", hint: "o agente procurando nas notas" },
  { key: "ler", label: "Ler", hint: "o agente lendo notas e reuniões" },
  { key: "bagagem", label: "Bagagem", hint: "a conversa recente" },
  { key: "fixo", label: "Fixo", hint: "o que o agente leva em toda ida" },
];

const fmt = (v: number, digits = 1) => v.toLocaleString("pt-BR", { maximumFractionDigits: digits });

/** "820", "8,3 mil", "1,2 mi": o número curto, sem a palavra tokens. */
export function curto(n: number): string {
  if (n < 1000) return String(Math.round(n));
  return n < 1_000_000 ? `${fmt(n / 1000)} mil` : `${fmt(n / 1_000_000)} mi`;
}

/** A % de cada parte no total, arredondada, com a soma em 100 (a sobra vai para a maior). */
export function porcentos(p: AgentPlacarPartes): Record<keyof AgentPlacarPartes, number> {
  const total = PARTES.reduce((s, x) => s + p[x.key], 0);
  const out = { pedido: 0, achar: 0, ler: 0, bagagem: 0, fixo: 0 };
  if (!total) return out;
  for (const x of PARTES) out[x.key] = Math.round((p[x.key] / total) * 100);
  const sobra = 100 - PARTES.reduce((s, x) => s + out[x.key], 0);
  const maior = PARTES.reduce((a, b) => (p[b.key] > p[a.key] ? b : a)).key;
  out[maior] += sobra;
  return out;
}

/** Os quatro cartões de "Hoje". */
export function cartoes(v: AgentPlacarView): { valor: string; label: string; sub?: string }[] {
  const porPedido = (n: number) => (v.pedidos ? n / v.pedidos : 0);
  return [
    { valor: String(v.pedidos), label: v.pedidos === 1 ? "pedido" : "pedidos" },
    { valor: String(v.idas), label: "idas ao modelo", sub: `${fmt(porPedido(v.idas))} por pedido` },
    { valor: curto(v.tokens), label: "tokens", sub: `${curto(Math.round(porPedido(v.tokens)))} por pedido` },
    {
      valor: v.comFaro ? `${v.dePrimeira} de ${v.comFaro}` : "—",
      label: "a Bússola achou de primeira",
      ...(v.limite5h !== undefined ? { sub: `${fmt(v.limite5h)} % do limite de 5 horas` } : {}),
    },
  ];
}

/** "Achar e ler: 9 % do gasto de hoje." */
export function acharLerLine(p: AgentPlacarPartes): string {
  const pc = porcentos(p);
  return `Achar e ler: ${pc.achar + pc.ler} % do gasto de hoje.`;
}

/** O selo da Bússola num pedido. */
export function seloFaro(f: AgentPlacarFaro | undefined): { texto: string; tom: "achou" | "quase" | "nao" | "sem" } {
  if (!f) return { texto: "sem a Bússola", tom: "sem" };
  if (f.kind === "certo") {
    const como = f.how === "som" ? "pelo som" : f.how === "trilha" ? "pela trilha" : f.how === "apontado" ? (f.said ?? "apontado") : "pelo nome";
    return { texto: `achou · ${como}`, tom: "achou" };
  }
  if (f.kind === "provavel") return { texto: "quase · o agente escolheu", tom: "quase" };
  return { texto: f.searched ? "não achou · o agente buscou" : "sem alvo", tom: "nao" };
}
