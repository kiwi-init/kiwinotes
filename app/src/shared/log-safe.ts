// O que pode ir ao kiwi.log de um erro (#456, #457). A mensagem de um erro das Notas ou do ditado costuma levar o
// caminho da nota, e o título da nota rápida é a 1ª frase do ditado. Então o log leva só o tipo e o código do erro.

/** O tipo e o código de um erro, sem a mensagem: `Error`, `Error (ENOENT)`. */
export function errorKind(e: unknown): string {
  if (!(e instanceof Error)) return typeof e;
  const code = (e as { code?: unknown }).code;
  return typeof code === "string" || typeof code === "number" ? `${e.name} (${code})` : e.name;
}

/** Um caminho absoluto entre aspas (o `open '/…'` e o `path: '/…'` dos erros do fs) vira `'<caminho>'`. */
const QUOTED_PATH = /(['"])(?:\/|~\/)[^'"\n]*\1/g;

export function redactQuotedPaths(text: string): string {
  return text.replace(QUOTED_PATH, "$1<caminho>$1");
}
