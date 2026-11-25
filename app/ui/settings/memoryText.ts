// A memória do agente em Ajustes › Agente (spec #11469, T11668): os textos da tela, pelo catálogo (`mem.*`, T29272).

import { formatNumber } from "../../src/shared/i18n/index.ts";
import { appLocale, t } from "../src/i18n.ts";

export const memoryTitle = () => t("mem.title");
export const memoryHint = () => t("mem.hint");
export const memoryEmpty = () => t("mem.empty");
export const instructionsTitle = () => t("mem.instructions.title");
export const instructionsHint = () => t("mem.instructions.hint");
export const INSTRUCTIONS_MAX = 2000;

/** O número na língua do app ("2.000" / "2,000"). */
const num = (n: number) => formatNumber(appLocale().locale, n);

/** "3 de 60 fatos": o máximo decide o plural. */
export function countLine(n: number, max: number): string {
  return t("mem.count", { count: n, n: max }) + (n >= max ? t("mem.full") : "");
}

/** "120 de 2.000 caracteres". */
export function instructionsCount(n: number): string {
  return t("mem.chars", { n: num(n), max: num(INSTRUCTIONS_MAX) });
}

/** "Apagar os 3 fatos?" */
export const clearQuestion = (n: number): string => t("mem.clear", { n });

/** O aviso quando o fato em edição sumiu da lista (o agente o esqueceu ou mudou no meio): nada é salvo. */
export const editGone = () => t("mem.editGone");

/**
 * A lista com o fato `from` trocado por `to`, achado pelo texto, nunca pela posição: a lista segue o agente ao vivo, e
 * os fatos andam se ele anota ou esquece um no meio (revisão do T11668). Sem `from` na lista, `null`.
 */
export function replaceFact(facts: readonly string[], from: string, to: string): string[] | null {
  const at = facts.indexOf(from);
  return at < 0 ? null : facts.map((x, i) => (i === at ? to : x));
}

/** A lista sem o fato `fact`, achado pelo texto. Sem ele na lista, `null`. */
export function dropFact(facts: readonly string[], fact: string): string[] | null {
  const at = facts.indexOf(fact);
  return at < 0 ? null : facts.filter((_, i) => i !== at);
}

/**
 * O aviso da memória que passou do limite (spec #12749): no balão, quando o agente não a mudou, e em Ajustes. `facts`:
 * todos os fatos do arquivo; `long`: os que passam de 300 caracteres.
 */
export function overLine(o: { facts: number; long: number }): string {
  const why =
    o.facts > 60 && o.long
      ? t("mem.over.both", { facts: o.facts, n: o.long })
      : o.facts > 60
        ? t("mem.over.facts", { facts: o.facts })
        : t("mem.over.long", { n: o.long });
  return t("mem.over", { why });
}

/** Em Ajustes: os fatos escritos à mão que o agente não lê (spec #12749). */
export const skippedLine = (n: number): string => t("mem.skipped", { n });

/** Por que o fato fica de fora. */
export const skippedReason = (r: "long" | "over") => t(r === "long" ? "mem.reason.long" : "mem.reason.over");

/** Em Ajustes: as linhas do arquivo que não são fato (spec #12749). */
export const outsideLine = (n: number): string => t("mem.outside", { n });

/** "412 de 300 caracteres": o fato em edição, quando passa do limite. */
export const factCount = (n: number) => t("mem.factChars", { n: num(n) });
