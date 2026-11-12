// Os links `[[nota]]` das notas, com a regra do Obsidian (T1316): o vault tem que abrir no Obsidian sem perder nada.
// Uma implementação só, usada pelo engine no `notes.resolve`, no `notes.rename` e nos backlinks (#1323, #1335).

import { fold } from "../store/text.ts";

export interface WikiLink {
  /** O link inteiro, como está no texto: `[[Nota#Seção|apelido]]`, ou `![[Nota]]` (embed). */
  raw: string;
  /** O alvo, sem seção nem apelido: `Nota`, `Pasta/Nota`. */
  target: string;
  /** `#Seção`, se houver. */
  heading: string;
  /** `|apelido`, se houver. */
  alias: string;
  embed: boolean;
  index: number;
}

// [[alvo]], [[alvo#seção]], [[alvo|apelido]], [[alvo#seção|apelido]], com ! na frente para embed.
const LINK = /(!?)\[\[([^[\]|#\n]*)(#[^[\]|\n]*)?(\|[^[\]\n]*)?\]\]/g;

export function parseLinks(content: string): WikiLink[] {
  const out: WikiLink[] = [];
  for (const m of content.matchAll(LINK)) {
    if (!m[2]!.trim() && !m[3]?.slice(1).trim()) continue;
    out.push({ raw: m[0], embed: m[1] === "!", target: m[2]!.trim(), heading: m[3] ?? "", alias: m[4] ?? "", index: m.index! });
  }
  return out;
}

/** O nome da nota: o arquivo sem a pasta e sem `.md`. */
export function noteName(path: string): string {
  return path.split("/").at(-1)!.replace(/\.md$/i, "");
}

/**
 * Um nome de nota sem `# ^ | [ ]` (T7520): são sintaxe do [[link]] (título, bloco, apelido) e um nome com eles quebra os
 * links para a nota. Viram espaço, como no `notes.create`. Pode voltar "".
 */
export function linkSafeName(name: string): string {
  return name.replace(/[#^|[\]]/g, " ").replace(/\s+/g, " ").trim();
}

const key = (s: string) => fold(s.normalize("NFC"));

/** O mais curto ganha; empate, o de menos pastas; depois a ordem alfabética. */
function shortest(paths: string[]): string | null {
  return [...paths].sort((a, b) => a.length - b.length || a.split("/").length - b.split("/").length || a.localeCompare(b))[0] ?? null;
}

export type Resolver = (target: string) => string | null;

/**
 * Prepara a resolução de `[[alvo]]` para um conjunto de notas (`paths`, relativos ao vault, com `.md`). Sem barra,
 * vale o nome do arquivo, em qualquer pasta, sem diferença de maiúscula nem acento; com dois iguais, o caminho mais
 * curto. Com barra, o caminho a partir da raiz do vault ou o fim de um caminho. `null` quando a nota não existe.
 * Monta os mapas uma vez: com 1.000 notas, resolver cada link do zero levava 0,6 s nos backlinks.
 */
export function makeResolver(paths: readonly string[], aliases?: ReadonlyMap<string, readonly string[]>): Resolver {
  const byName = new Map<string, string[]>();
  const byPath = new Map<string, string[]>();
  // Os `aliases:` do frontmatter (T5352, como no Obsidian): outro nome para a mesma nota. O nome do arquivo ganha.
  const byAlias = new Map<string, string[]>();
  for (const p of paths) {
    const n = key(noteName(p));
    byName.set(n, [...(byName.get(n) ?? []), p]);
    const k = key(p);
    byPath.set(k, [...(byPath.get(k) ?? []), p]);
    for (const a of aliases?.get(p) ?? []) {
      const ak = key(a);
      if (ak) byAlias.set(ak, [...(byAlias.get(ak) ?? []), p]);
    }
  }
  const cache = new Map<string, string | null>();
  return (target) => {
    const t = target.trim().replace(/\.md$/i, "").replace(/^\/+/, "");
    if (cache.has(t)) return cache.get(t)!;
    let out: string | null = null;
    if (!t) out = null;
    else if (t.includes("/")) {
      const want = key(`${t}.md`);
      out = shortest(byPath.get(want) ?? []) ?? shortest(paths.filter((p) => key(p).endsWith(`/${want}`)));
    } else {
      out = shortest(byName.get(key(t)) ?? []) ?? shortest(byAlias.get(key(t)) ?? []);
    }
    cache.set(t, out);
    return out;
  };
}

/**
 * Para qual arquivo do vault que não é nota (pdf, quadro, draw.io, imagem) um `[[alvo.ext]]` aponta (T7616), como o
 * Obsidian: o alvo tem a extensão, e sem barra vale o nome do arquivo em qualquer pasta (o caminho mais curto ganha);
 * com barra, o caminho a partir da raiz ou o fim de um caminho. Sem extensão, ou `.md`, é link de nota: `null`.
 */
export function makeFileResolver(files: readonly string[]): Resolver {
  const byName = new Map<string, string[]>();
  const byPath = new Map<string, string[]>();
  for (const p of files) {
    const n = key(p.slice(p.lastIndexOf("/") + 1));
    byName.set(n, [...(byName.get(n) ?? []), p]);
    const k = key(p);
    byPath.set(k, [...(byPath.get(k) ?? []), p]);
  }
  return (target) => {
    const t = target.trim().replace(/^\/+/, "");
    if (!t || /\.md$/i.test(t) || !/\.[^./]+$/.test(t)) return null;
    if (!t.includes("/")) return shortest(byName.get(key(t)) ?? []);
    const want = key(t);
    return shortest(byPath.get(want) ?? []) ?? shortest(files.filter((p) => key(p).endsWith(`/${want}`)));
  };
}

/** Para qual nota um `[[alvo]]` aponta, entre `paths` (ver `makeResolver`). */
export function resolveLink(target: string, paths: readonly string[]): string | null {
  return makeResolver(paths)(target);
}

/**
 * Depois de renomear `from` para `to`: troca nos `content` os links que apontavam para `from`. Mantém a seção, o
 * apelido e o embed. Escreve só o nome quando ele basta para achar `to` (como o Obsidian faz), senão o caminho sem `.md`.
 * `before` e `after` são os caminhos do vault antes e depois da troca.
 */
export function rewriteLinks(
  content: string,
  from: string,
  to: string,
  before: readonly string[] | Resolver,
  after: readonly string[] | Resolver,
): { content: string; count: number } {
  const resolveBefore = typeof before === "function" ? before : makeResolver(before);
  const resolveAfter = typeof after === "function" ? after : makeResolver(after);
  const name = noteName(to);
  const target = resolveAfter(name) === to ? name : to.replace(/\.md$/i, "");
  let count = 0;
  const out = content.replace(LINK, (raw, bang: string, t: string, heading: string | undefined, alias: string | undefined) => {
    if (resolveBefore(t) !== from) return raw;
    // Um `[[apelido]]` (os `aliases:` da nota, T5352) continua achando a nota com o nome novo: fica como está.
    if (resolveAfter(t) === to && key(t) !== key(noteName(from)) && !t.includes("/")) return raw;
    count++;
    return `${bang}[[${target}${heading ?? ""}${alias ?? ""}]]`;
  });
  return { content: out, count };
}

/**
 * Como o `rewriteLinks`, para muitas notas que mudaram de lugar de uma vez (uma pasta movida ou renomeada, T2468): numa
 * passada só, cada link que apontava para uma nota de `moves` (antes) passa a apontar para o lugar novo. Conta só o
 * que mudou no texto: um `[[Nota]]` pelo nome que continua achando a nota fica como está.
 */
export function rewriteLinksMany(
  content: string,
  moves: ReadonlyMap<string, string>,
  before: Resolver,
  after: Resolver,
): { content: string; count: number } {
  let count = 0;
  const out = content.replace(LINK, (raw, bang: string, t: string, heading: string | undefined, alias: string | undefined) => {
    const from = before(t);
    const to = from === null ? undefined : moves.get(from);
    if (!to) return raw;
    // Um `[[apelido]]` que continua achando a nota no lugar novo fica como está (T5352).
    if (after(t) === to && !t.includes("/") && key(t) !== key(noteName(from!))) return raw;
    const name = noteName(to);
    const target = after(name) === to ? name : to.replace(/\.md$/i, "");
    const next = `${bang}[[${target}${heading ?? ""}${alias ?? ""}]]`;
    if (next !== raw) count++;
    return next;
  });
  return { content: out, count };
}
