// Os textos das trilhas (T14682), em Ajustes › Agente, pelo catálogo (`trails.*`, T29272).

import type { AgentTrailView } from "../../src/shared/ui-contract.ts";
import { t as tr } from "../src/i18n.ts";

/** As palavras, como a pessoa disse: "orçamento · viagem". */
export const trilhaLabel = (t: Pick<AgentTrailView, "palavras">): string => t.palavras.join(" · ");

/** Para onde leva e quantas vezes: "leva a Gastos (Pessoal/Gastos.md) · 2 vezes". */
export function trilhaHint(t: Pick<AgentTrailView, "titulo" | "path" | "vezes">): string {
  return tr("trails.hint", { title: t.titulo, path: t.path, times: tr("trails.times", { n: t.vezes }) });
}

/** O que é a parte "Aprendendo" (T21325). */
export const aprendendoHint = () => tr("trails.learningHint");
