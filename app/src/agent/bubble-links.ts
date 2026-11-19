/**
 * As notas e os arquivos que a resposta do agente cita (spec #17683), para o balão do gato virar link. Puro: quem diz o
 * que existe na pasta é o `resolver` (o índice do cofre), e o que ele não acha fica texto.
 */
import type { BubbleLink } from "../shared/ui-contract.ts";

/** O índice da pasta: o caminho relativo de uma nota (`[[alvo]]`, sem `.md`) ou de um arquivo, ou null. */
export interface BubbleLinkResolver {
  note(target: string): string | null;
  file(target: string): string | null;
}

/** Até quantos links uma resposta leva, e até que tamanho de resposta se procura. */
export const MAX_BUBBLE_LINKS = 50;
const MAX_TEXT = 200_000;

const NOTE_EXT = /\.(md|txt)$/i;
const EXT = /\.[\p{L}\p{N}]{1,10}$/u;

/** Um alvo que sai da pasta (`..`, absoluto, `~`, esquema) não é procurado. */
function safeTarget(raw: string): string | null {
  let t = raw.trim();
  if (!t || t.length > 1024 || /[\n\r\0]/.test(t)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith("/") || t.startsWith("~") || t.startsWith("\\")) return null;
  t = t.replace(/^\.\/+/, "");
  if (t.split(/[\\/]/).some((s) => s === "..")) return null;
  return t || null;
}

function resolveTarget(raw: string, r: BubbleLinkResolver, opts: { bareNote: boolean }): { path: string; kind: BubbleLink["kind"] } | null {
  const t = safeTarget(raw);
  if (!t) return null;
  let path: string | null = null;
  if (/\.md$/i.test(t) || (opts.bareNote && !EXT.test(t))) path = r.note(t);
  // Sem extensão, um arquivo só pelo caminho com a pasta (`Projeto X/Dockerfile`, T20047): um nome solto fica texto.
  if (!path && (EXT.test(t) || t.includes("/")) && !/\.md$/i.test(t)) path = r.file(t);
  if (!path) return null;
  return { path, kind: NOTE_EXT.test(path) ? "note" : "file" };
}

/** As faixas dos blocos de código cercados (``` e ~~~): nada dentro deles vira link. */
function fencedRanges(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const re = /^ {0,3}(`{3,}|~{3,})[^\n]*$/gm;
  let open: { at: number; fence: string } | null = null;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const fence = m[1]!;
    if (!open) open = { at: m.index, fence };
    else if (fence[0] === open.fence[0] && fence.length >= open.fence.length && m[0].trim() === fence) {
      out.push([open.at, m.index + m[0].length]);
      open = null;
    }
  }
  if (open) out.push([open.at, text.length]);
  return out;
}

/**
 * As menções, na ordem do texto, sem repetir trecho: `[[alvo|apelido]]`, `[rótulo](caminho)` (nunca web), um caminho
 * entre crases e um nome ou caminho com extensão solto no texto. Uma menção no meio de uma palavra, numa URL ou num
 * bloco de código cercado não conta.
 */
export function findBubbleLinks(text: string, resolver: BubbleLinkResolver): BubbleLink[] {
  if (!text || text.length > MAX_TEXT) return [];
  const taken: Array<[number, number]> = fencedRanges(text);
  const free = (from: number, to: number) => taken.every(([a, b]) => to <= a || from >= b);
  const found: BubbleLink[] = [];
  const add = (from: number, to: number, hit: { path: string; kind: BubbleLink["kind"] } | null) => {
    taken.push([from, to]);
    if (hit) found.push({ text: text.slice(from, to), from, to, ...hit });
  };
  const scan = (re: RegExp, each: (m: RegExpExecArray) => void) => {
    for (let m = re.exec(text); m; m = re.exec(text)) if (free(m.index, m.index + m[0].length)) each(m);
  };

  // 1. As URLs (autolink e solta): ficam de fora, e o que está dentro delas também.
  scan(/<[a-z][a-z0-9+.-]*:[^>\s]*>|\b(?:https?|mailto|ftp|file):[^\s<>()]+/gi, (m) => taken.push([m.index, m.index + m[0].length]));
  // 2. `[[alvo#seção|apelido]]` e o embed `![[…]]`.
  scan(/!?\[\[([^\]\n|#]+)(?:#[^\]\n|]*)?(?:\|[^\]\n]*)?\]\]/g, (m) => add(m.index, m.index + m[0].length, resolveTarget(m[1]!, resolver, { bareNote: true })));
  // 3. `[rótulo](caminho)`, também `<caminho com espaço>` e `%20`; imagem `![…](…)` fica de fora.
  scan(/(!?)\[((?:\\.|[^\]\\\n])*)\]\((?:<([^>\n]+)>|([^)\s]+))(?:\s+"[^"\n]*")?\)/g, (m) => {
    if (m[1]) return void taken.push([m.index, m.index + m[0].length]);
    let target = (m[3] ?? m[4] ?? "").replace(/#.*$/, "");
    try {
      target = decodeURIComponent(target);
    } catch {
      /* fica como veio */
    }
    add(m.index, m.index + m[0].length, resolveTarget(target, resolver, { bareNote: true }));
  });
  // 4. Um caminho entre crases: só com extensão ou com barra, para `kiwi status` não virar nota.
  scan(/(`+)([^`\n]+?)\1(?!`)/g, (m) => {
    const inner = m[2]!.trim();
    const looks = EXT.test(inner) || inner.includes("/");
    add(m.index, m.index + m[0].length, looks ? resolveTarget(inner, resolver, { bareNote: true }) : null);
  });
  // 5. Solto no texto: um nome ou caminho com extensão, sem espaço, entre limites de palavra.
  scan(/(?<![\p{L}\p{N}_/\\.@-])(?:[\p{L}\p{N}_-][\p{L}\p{N}_.-]*\/)*[\p{L}\p{N}_-][\p{L}\p{N}_.-]*\.[\p{L}\p{N}]{1,10}(?![\p{L}\p{N}_/\\@-]|\.[\p{L}\p{N}])/gu, (m) => {
    const hit = resolveTarget(m[0], resolver, { bareNote: false });
    if (hit) add(m.index, m.index + m[0].length, hit);
  });

  found.sort((a, b) => a.from - b.from);
  return found.slice(0, MAX_BUBBLE_LINKS);
}
