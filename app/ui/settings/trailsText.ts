// Os textos das trilhas (T14682), em Ajustes › Agente.

import type { AgentTrailView } from "../../src/shared/ui-contract.ts";

/** As palavras, como a pessoa disse: "orçamento · viagem". */
export const trilhaLabel = (t: Pick<AgentTrailView, "palavras">): string => t.palavras.join(" · ");

/** Para onde leva e quantas vezes: "leva a Gastos (Pessoal/Gastos.md) · 2 vezes". */
export function trilhaHint(t: Pick<AgentTrailView, "titulo" | "path" | "vezes">): string {
  return `leva a ${t.titulo} (${t.path}) · ${t.vezes === 1 ? "1 vez" : `${t.vezes} vezes`}`;
}
