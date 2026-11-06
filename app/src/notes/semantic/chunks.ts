// Os trechos de uma nota para a busca pelo sentido (T6013): o título e o corpo em pedaços de ~200 tokens, cortados
// entre parágrafos. Um trecho que casa vira o trecho mostrado no resultado.

/** Uns 4 caracteres por token no português: ~200 tokens, folgado abaixo dos 512 do e5. */
export const CHUNK_CHARS = 800;
/** Uma nota enorme (um log colado) não ocupa a fila: só o começo dela entra. */
export const MAX_CHUNKS = 24;

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

/** O texto sem frontmatter, sem a sintaxe de Markdown que não diz nada sobre o sentido. */
export function plainText(content: string): string {
  return content
    .replace(FRONTMATTER, "")
    .replace(/```[^\n]*\n([\s\S]*?)```/g, "$1")
    .replace(/!\[\[[^\]]*\]\]/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_m, target: string, label?: string) => label ?? target)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, "")
    .replace(/[*_`~>|]+/g, " ")
    .replace(/[ \t]+/g, " ");
}

function splitLong(paragraph: string, max: number): string[] {
  if (paragraph.length <= max) return [paragraph];
  const out: string[] = [];
  let rest = paragraph;
  while (rest.length > max) {
    const cut = Math.max(rest.lastIndexOf(". ", max), rest.lastIndexOf(" ", max));
    const at = cut > max / 2 ? cut + 1 : max;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** Os trechos da nota, cada um começando pelo título (o e5 acha melhor com o assunto junto). */
export function noteChunks(title: string, content: string, max = CHUNK_CHARS): string[] {
  const paragraphs = plainText(content)
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .flatMap((p) => splitLong(p, max));
  const chunks: string[] = [];
  let current = "";
  for (const p of paragraphs) {
    if (current && current.length + p.length + 1 > max) {
      chunks.push(current);
      current = "";
      if (chunks.length >= MAX_CHUNKS) break;
    }
    current = current ? `${current} ${p}` : p;
  }
  if (current && chunks.length < MAX_CHUNKS) chunks.push(current);
  const head = title.trim();
  if (!chunks.length) return head ? [head] : [];
  return chunks.map((c) => (head ? `${head}. ${c}` : c));
}
