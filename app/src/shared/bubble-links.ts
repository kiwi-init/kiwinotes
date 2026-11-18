/**
 * O link das notas e dos arquivos no balão do gato (spec #17683): troca cada menção achada pelo main por um link
 * markdown `[rótulo](kiwi-file:<caminho>)`, que o construtor do balão (bubbleMarkdown) monta e o clique abre.
 */
import type { BubbleLink } from "./ui-contract.ts";

export const KIWI_FILE_SCHEME = "kiwi-file:";

/** O href de um caminho da pasta. Os parênteses também vão codificados, para não fechar o `(…)` do markdown. */
export function kiwiFileHref(path: string, scheme: string = KIWI_FILE_SCHEME): string {
  return scheme + encodeURIComponent(path).replace(/[()'*!]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** O caminho de um href `kiwi-file:`, ou null quando não é um (ou não decodifica). */
export function kiwiFilePath(href: string, scheme: string = KIWI_FILE_SCHEME): string | null {
  if (!href.startsWith(scheme)) return null;
  try {
    const p = decodeURIComponent(href.slice(scheme.length));
    return p ? p : null;
  } catch {
    return null;
  }
}

/** O texto que aparece no link: o apelido ou o alvo do `[[…]]`, o rótulo do `[…](…)`, e o resto como está. */
export function linkLabel(text: string): string {
  const wiki = /^!?\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]$/.exec(text);
  if (wiki) return (wiki[2] ?? wiki[1] ?? "").trim() || text;
  const md = /^\[((?:\\.|[^\]\\])*)\]\(/.exec(text);
  if (md) return md[1]!;
  return text;
}

function escapeLabel(label: string): string {
  // O rótulo do `[…](…)` que já veio da resposta já está escapado; o resto escapa os colchetes.
  return label.replace(/\\?([[\]])/g, "\\$1");
}

/**
 * A resposta com cada menção virando link. As que não batem com o texto na posição (a resposta mudou) ficam como estão,
 * e as que se cruzam valem só a primeira. `scheme`: quem monta pode trocar o `kiwi-file:` por um só dele, para separar
 * os links que pôs dos que a resposta escreveu.
 */
export function linkify(text: string, links: readonly BubbleLink[] | undefined, scheme: string = KIWI_FILE_SCHEME): string {
  if (!links?.length) return text;
  const ok = [...links]
    .filter((l) => l.from >= 0 && l.to <= text.length && l.from < l.to && text.slice(l.from, l.to) === l.text)
    .sort((a, b) => a.from - b.from);
  let out = "";
  let at = 0;
  for (const l of ok) {
    if (l.from < at) continue;
    out += text.slice(at, l.from) + `[${escapeLabel(linkLabel(l.text))}](${kiwiFileHref(l.path, scheme)})`;
    at = l.to;
  }
  return out + text.slice(at);
}
