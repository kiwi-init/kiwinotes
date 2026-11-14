// A memória do agente em Ajustes › Agente (spec #11469, T11668): os textos da tela.

export const MEMORY_TITLE = "Memória";
export const MEMORY_HINT =
  'O que o agente sabe sobre você. Ele anota quando você pede ("lembra que…") ou quando percebe algo útil, e tudo vai no começo de cada pedido. Você muda tudo aqui; o arquivo fica no cofre, em .kiwi/agente/sobre-mim.md.';
export const MEMORY_EMPTY = 'Nada anotado ainda. Peça ao gato: "lembra que eu prefiro respostas curtas".';
export const INSTRUCTIONS_TITLE = "As suas instruções para o agente";
export const INSTRUCTIONS_HINT = 'Vão em todo pedido, como você escrever: "sempre em português", "não mexa na pasta Arquivo".';
export const INSTRUCTIONS_MAX = 2000;

/** "3 de 60 fatos", "1 de 60 fato" não: o número decide o plural. */
export function countLine(n: number, max: number): string {
  return `${n} de ${max} ${max === 1 ? "fato" : "fatos"}${n >= max ? ": cheia. O agente tem de esquecer um antes de anotar outro." : ""}`;
}

/** "120 de 2.000 caracteres". */
export function instructionsCount(n: number): string {
  return `${n.toLocaleString("pt-BR")} de ${INSTRUCTIONS_MAX.toLocaleString("pt-BR")} caracteres`;
}

/** "Apagar os 3 fatos?" */
export function clearQuestion(n: number): string {
  return n === 1 ? "Apagar o fato da memória?" : `Apagar os ${n} fatos da memória?`;
}

/** O aviso quando o fato em edição sumiu da lista (o agente o esqueceu ou mudou no meio): nada é salvo. */
export const EDIT_GONE = "Esse fato mudou enquanto você editava: nada foi salvo. Veja a lista e edite de novo.";

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
      ? `tem ${o.facts} fatos, e ${o.long === 1 ? "um passa" : `${o.long} passam`} de 300 caracteres`
      : o.facts > 60
        ? `tem ${o.facts} fatos`
        : o.long === 1
          ? "um fato passa de 300 caracteres"
          : `${o.long} fatos passam de 300 caracteres`;
  return `A memória passou do limite: ${why}. Apague ou encurte um em Ajustes › Agente › Memória.`;
}

/** Em Ajustes: os fatos escritos à mão que o agente não lê (spec #12749). */
export function skippedLine(n: number): string {
  const which = n === 1 ? "Um fato escrito no arquivo fica" : `${n} fatos escritos no arquivo ficam`;
  return `${which} de fora: o agente não lê, e não muda a memória até você encurtar ou apagar. Nada foi apagado.`;
}

/** Por que o fato fica de fora. */
export const skippedReason = (r: "long" | "over") => (r === "long" ? "passa de 300 caracteres" : "depois dos 60 fatos");

/** Em Ajustes: as linhas do arquivo que não são fato (spec #12749). */
export function outsideLine(n: number): string {
  return n === 1
    ? "O arquivo tem uma linha que não é fato (um parágrafo ou um título): ela fica lá, mas não vai ao agente."
    : `O arquivo tem ${n} linhas que não são fato (parágrafos ou títulos): elas ficam lá, mas não vão ao agente.`;
}

/** "412 de 300 caracteres": o fato em edição, quando passa do limite. */
export const factCount = (n: number) => `${n.toLocaleString("pt-BR")} de 300 caracteres`;
