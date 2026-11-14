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
