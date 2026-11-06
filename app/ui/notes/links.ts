// Os links `[[nota]]`, `[[nota|apelido]]` e `[[nota#título]]`, no formato do Obsidian: o que a UI precisa para desenhar,
// completar e clicar (com a posição no texto). Para onde um link aponta quem diz é o engine (`notes.resolve`, #1335):
// a UI nunca resolve sozinha.

export interface WikiLink {
  /** Do `[[` ao `]]`, no texto. */
  from: number;
  to: number;
  /** O nome da nota, sem `#título` nem `|apelido`. */
  target: string;
  heading?: string;
  alias?: string;
}

const LINK = /\[\[([^\[\]|#\n]*)(?:#([^\[\]|\n]*))?(?:\|([^\[\]\n]*))?\]\]/g;

/** Todos os links do texto, em ordem. */
export function parseLinks(text: string): WikiLink[] {
  const out: WikiLink[] = [];
  for (const m of text.matchAll(LINK)) {
    const target = m[1]!.trim();
    if (!target && !m[2]?.trim()) continue;
    out.push({
      from: m.index!,
      to: m.index! + m[0].length,
      target,
      heading: m[2]?.trim() || undefined,
      alias: m[3]?.trim() || undefined,
    });
  }
  return out;
}

/** O link sob a posição `pos` (dentro dos colchetes), ou `null`. */
export function linkAt(text: string, pos: number): WikiLink | null {
  return parseLinks(text).find((l) => pos >= l.from && pos <= l.to) ?? null;
}

/** O nome da nota a partir do path: o arquivo sem a pasta e sem `.md`. */
export const noteName = (path: string) => path.replace(/^.*\//, "").replace(/\.md$/i, "");

/** A pasta do path, sem barra no fim; "" na raiz. */
export const folderOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

const fold = (s: string) => s.normalize("NFC").toLocaleLowerCase("pt-BR");

/**
 * O texto que o autocomplete escreve no `[[…]]`: só o nome quando nenhuma outra nota tem o mesmo nome, senão o caminho
 * sem `.md`, que aponta para ela sem depender de regra de desempate.
 */
export function linkTextFor(path: string, paths: string[]): string {
  const name = fold(noteName(path));
  const twins = paths.filter((p) => p !== path && fold(noteName(p)) === name);
  return twins.length ? path.replace(/\.md$/i, "") : noteName(path);
}

/**
 * Um link do Markdown que pode abrir fora (no navegador ou no Mail): só `http`, `https` e `mailto`. Qualquer outro
 * esquema (`javascript:`, `file:`, `views:`, `data:`) dá `null` e o clique não faz nada (#1375, #1379).
 */
export function externalUrl(raw: string): string | null {
  const s = raw.trim().replace(/^<|>$/g, "");
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:" ? url.href : null;
}

/** A linha que cita, sem a marcação: o marcador de lista ou tarefa e os colchetes dos links (fica o apelido ou o nome). */
export function plainContext(line: string): string {
  return line
    .replace(/^(\s*…?)\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+|#+\s+|>\s*)/, "$1")
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_m, t: string, a?: string) => a || t);
}

/** Um trecho de busca sem a marcação do Markdown: links viram o nome, e somem crases, ênfase e marcadores de linha. */
export function plainSnippet(text: string): string {
  return plainContext(text)
    .replace(/```\w*/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
    .replace(/(^|\s)[-*+]\s+(?:\[[ xX]\]\s+)?/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
