// O nome de arquivo de uma nota nova, sem o node: o vault (`notes/paths.ts`) e a UI (o "+ Novo" do Calendário, #492)
// usam a mesma regra.

/** O tamanho máximo de um segmento do caminho (o mesmo de `notes/paths.ts`). */
export const MAX_SEGMENT = 200;

/**
 * Um título vira nome de arquivo: sem os caracteres que o Obsidian e o macOS não aceitam num nome, sem pontos no começo
 * (arquivo oculto) e sem espaço nas pontas. Os pontos e os espaços do começo saem juntos (T15890): tirar só os pontos
 * depois do `trim` deixava `../fora` como ` fora`. O corte no tamanho também não deixa espaço no fim (sobram 8 para
 * o " 2" e o ".md"). Título vazio dá "".
 */
export function noteFileName(title: string): string {
  return title
    .normalize("NFC")
    .replace(/[\\/:*?"<>|#^[\]\0]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+/, "")
    .trimEnd()
    .slice(0, MAX_SEGMENT - 8)
    .trimEnd();
}
