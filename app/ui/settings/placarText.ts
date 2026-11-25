// Os textos do placar (ADR 0013, "O placar"; T14671), separados da tela para os testes lerem cada estado sem navegador.
// Só tokens, idas e a % do limite que o `/usage` informou: nada em dinheiro.

import { formatNumber, type Locale, type TextKey, translate } from "../../src/shared/i18n/index.ts";
import type { AgentPlacarFaro, AgentPlacarPartes, AgentPlacarView } from "../../src/shared/ui-contract.ts";

const KEYS: (keyof AgentPlacarPartes)[] = ["pedido", "achar", "ler", "bagagem", "fixo"];

/** As cinco partes, com o nome e a frase na língua (T29271). */
export const partes = (locale: Locale = "pt"): { key: keyof AgentPlacarPartes; label: string; hint: string }[] =>
  KEYS.map((key) => ({
    key,
    label: translate(locale, `agent.placar.part.${key}` as TextKey),
    hint: translate(locale, `agent.placar.part.${key}.hint` as TextKey),
  }));
export const PARTES = partes();

const fmt = (v: number, locale: Locale, digits = 1) => formatNumber(locale, v, { maximumFractionDigits: digits });

/** "820", "8,3 mil", "1,2 mi": o número curto, sem a palavra tokens (em inglês, "8.3K"). */
export function curto(n: number, locale: Locale = "pt"): string {
  if (n < 1000) return String(Math.round(n));
  return n < 1_000_000
    ? translate(locale, "agent.usage.short.k", { n: fmt(n / 1000, locale) })
    : translate(locale, "agent.usage.short.m", { n: fmt(n / 1_000_000, locale) });
}

/** A % de cada parte no total, arredondada, com a soma em 100 (a sobra vai para a maior). */
export function porcentos(p: AgentPlacarPartes): Record<keyof AgentPlacarPartes, number> {
  const total = KEYS.reduce((s, k) => s + p[k], 0);
  const out = { pedido: 0, achar: 0, ler: 0, bagagem: 0, fixo: 0 };
  if (!total) return out;
  for (const k of KEYS) out[k] = Math.round((p[k] / total) * 100);
  const sobra = 100 - KEYS.reduce((s, k) => s + out[k], 0);
  const maior = KEYS.reduce((a, b) => (p[b] > p[a] ? b : a));
  out[maior] += sobra;
  return out;
}

/** Os quatro cartões de "Hoje". */
export function cartoes(v: AgentPlacarView, locale: Locale = "pt"): { valor: string; label: string; sub?: string }[] {
  const tr = (key: TextKey, params?: Record<string, string | number>) => translate(locale, key, params);
  const porPedido = (n: number) => (v.pedidos ? n / v.pedidos : 0);
  return [
    { valor: String(v.pedidos), label: tr("agent.placar.requests", { n: v.pedidos }) },
    { valor: String(v.idas), label: tr("agent.placar.trips"), sub: tr("agent.placar.perRequest", { n: fmt(porPedido(v.idas), locale) }) },
    { valor: curto(v.tokens, locale), label: tr("agent.placar.tokens"), sub: tr("agent.placar.perRequest", { n: curto(Math.round(porPedido(v.tokens)), locale) }) },
    {
      valor: v.comFaro ? tr("agent.placar.ofN", { a: String(v.dePrimeira), b: String(v.comFaro) }) : "—",
      label: tr("agent.placar.found"),
      ...(v.limite5h !== undefined ? { sub: tr("agent.placar.limit", { pct: fmt(v.limite5h, locale) }) } : {}),
    },
  ];
}

/** "Achar e ler: 9 % do gasto de hoje." */
export function acharLerLine(p: AgentPlacarPartes, locale: Locale = "pt"): string {
  const pc = porcentos(p);
  return translate(locale, "agent.placar.findRead", { pct: pc.achar + pc.ler });
}

/** O selo da Bússola num pedido. */
export function seloFaro(f: AgentPlacarFaro | undefined, locale: Locale = "pt"): { texto: string; tom: "achou" | "quase" | "nao" | "sem" } {
  const tr = (key: TextKey, params?: Record<string, string | number>) => translate(locale, key, params);
  if (!f) return { texto: tr("agent.placar.seal.none"), tom: "sem" };
  if (f.kind === "certo") {
    const como =
      f.how === "som"
        ? tr("agent.placar.seal.sound")
        : f.how === "trilha"
          ? tr("agent.placar.seal.trail")
          : f.how === "apontado"
            ? (f.said ?? tr("agent.placar.seal.pointed"))
            : tr("agent.placar.seal.name");
    return { texto: tr("agent.placar.seal.found", { how: como }), tom: "achou" };
  }
  if (f.kind === "provavel") return { texto: tr("agent.placar.seal.almost"), tom: "quase" };
  return { texto: tr(f.searched ? "agent.placar.seal.searched" : "agent.placar.seal.noTarget"), tom: "nao" };
}
