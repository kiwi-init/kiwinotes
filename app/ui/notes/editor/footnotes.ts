// As notas de rodapé (T6377, E7, issue 183): `[^rótulo]` no texto, `[^rótulo]: texto` embaixo e a nota em linha
// `^[texto]`, como no Obsidian e no Pandoc. Sem DOM: aqui ficam a leitura da nota, os números e o que entra ao inserir
// uma. O desenho fica em `rendered.ts` (o Markdown que vai para a lib), `livePreview.ts` (o bloco do cursor) e
// `renderedWidget.tsx` (o hover). Referência de comportamento: SilverBullet `markdown_parser/footnote.ts` (MIT), só como
// ideia; o Zettlr (GPL-3.0) também só como ideia, sem código.

import type { EditorState, Text, TransactionSpec } from "@codemirror/state";

/** `[^1]` no texto, ou a nota em linha `^[texto]`. `n` é o número que aparece: a ordem da primeira chamada na nota. */
export type FootnoteMark =
  | { kind: "ref"; label: string; from: number; to: number; n: number }
  | { kind: "inline"; text: string; from: number; to: number; n: number };

/** `[^rótulo]: texto` no começo da linha, com as linhas de baixo recuadas (4 espaços ou tab) que continuam o texto. */
export interface FootnoteDef {
  label: string;
  /** O começo da linha do `[^rótulo]:` e o fim da última linha da nota. */
  from: number;
  to: number;
  /** O fim do `[^rótulo]:`, e onde começa o texto. */
  markerTo: number;
  textFrom: number;
  text: string;
}

export interface Footnotes {
  /** As chamadas e as notas em linha, na ordem do texto. */
  marks: FootnoteMark[];
  defs: FootnoteDef[];
  /** A primeira definição de cada rótulo (sem diferença de maiúsculas, como os links de referência do CommonMark). */
  def(label: string): FootnoteDef | undefined;
  /** O número que o rótulo mostra; `undefined` quando nenhuma chamada usa a nota. */
  number(label: string): number | undefined;
}

const LABEL = String.raw`[^\s\]\[^]+`;
const REF = new RegExp(String.raw`\[\^(${LABEL})\]`, "g");
const DEF = new RegExp(String.raw`^ {0,3}\[\^(${LABEL})\]:[ \t]?`);
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const CONTINUATION = /^(?: {4}|\t)/;

const key = (label: string) => label.toLocaleLowerCase("pt-BR");

/** Os trechos de código em linha (`` `a` ``, ``` ``a`b`` ```) da linha: o que está dentro não é nota de rodapé. */
function codeSpans(line: string): [number, number][] {
  const out: [number, number][] = [];
  const runs = [...line.matchAll(/`+/g)].map((m) => ({ at: m.index!, len: m[0].length }));
  for (let i = 0; i < runs.length; i++) {
    const open = runs[i]!;
    const close = runs.findIndex((r, j) => j > i && r.len === open.len);
    if (close < 0) continue;
    out.push([open.at, runs[close]!.at + open.len]);
    i = close;
  }
  return out;
}

const escaped = (line: string, at: number) => {
  let n = 0;
  for (let i = at - 1; i >= 0 && line[i] === "\\"; i--) n++;
  return n % 2 === 1;
};

/** O `]` que fecha o `[` de `at`, contando os pares de dentro; -1 sem fecho na linha. */
function closing(line: string, at: number): number {
  let depth = 0;
  for (let i = at; i < line.length; i++) {
    const c = line[i];
    if (c === "\\") i++;
    else if (c === "[") depth++;
    else if (c === "]" && --depth === 0) return i;
  }
  return -1;
}

/** Lê as notas de rodapé de uma nota inteira, fora do frontmatter e do código. */
export function scanFootnotes(doc: string): Footnotes {
  // Sem o número ainda: ele sai da ordem, depois de ler tudo.
  const marks: ({ kind: "ref"; label: string; from: number; to: number } | { kind: "inline"; text: string; from: number; to: number })[] = [];
  const defs: FootnoteDef[] = [];
  const lines = doc.split("\n");
  let at = 0;
  let fence: string | null = null;
  let i = 0;
  // O frontmatter é YAML, não Markdown.
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);
    if (end > 0) {
      for (; i <= end; i++) at += lines[i]!.length + 1;
    }
  }
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    const lineFrom = at;
    at += line.length + 1;
    const f = FENCE.exec(line);
    if (fence) {
      if (f && f[1]![0] === fence[0] && f[1]!.length >= fence.length && !line.slice(f[0].length).trim()) fence = null;
      continue;
    }
    if (f) {
      fence = f[1]!;
      continue;
    }
    const code = codeSpans(line);
    const inCode = (x: number) => code.some(([a, b]) => x >= a && x < b);
    let scanFrom = 0;
    const d = DEF.exec(line);
    if (d && !inCode(line.indexOf("["))) {
      const markerTo = lineFrom + d[0].trimEnd().length;
      let text = line.slice(d[0].length);
      let to = lineFrom + line.length;
      // As linhas recuadas logo abaixo continuam a nota.
      while (i + 1 < lines.length && CONTINUATION.test(lines[i + 1]!) && lines[i + 1]!.trim()) {
        i++;
        const next = lines[i]!;
        text += `\n${next.trim()}`;
        to = at + next.length;
        at += next.length + 1;
      }
      defs.push({ label: d[1]!, from: lineFrom, to, markerTo, textFrom: lineFrom + d[0].length, text: text.trim() });
      scanFrom = d[0].length;
    }
    for (const m of line.slice(scanFrom).matchAll(REF)) {
      const x = scanFrom + m.index!;
      if (escaped(line, x) || inCode(x)) continue;
      // `[^x](endereço)` é um link do Markdown com o texto "^x", não uma nota.
      if (line[x + m[0].length] === "(") continue;
      marks.push({ kind: "ref", label: m[1]!, from: lineFrom + x, to: lineFrom + x + m[0].length });
    }
    for (let x = line.indexOf("^[", scanFrom); x >= 0; x = line.indexOf("^[", x + 1)) {
      if (escaped(line, x) || inCode(x)) continue;
      const end = closing(line, x + 1);
      if (end < 0) continue;
      const text = line.slice(x + 2, end);
      if (!text.trim()) continue;
      marks.push({ kind: "inline", text, from: lineFrom + x, to: lineFrom + end + 1 });
      x = end;
    }
  }
  marks.sort((a, b) => a.from - b.from);
  const numbers = new Map<string, number>();
  let next = 0;
  const numbered = marks.map((m): FootnoteMark => {
    if (m.kind === "inline") return { ...m, n: ++next };
    const k = key(m.label);
    if (!numbers.has(k)) numbers.set(k, ++next);
    return { ...m, n: numbers.get(k)! };
  });
  const byLabel = new Map<string, FootnoteDef>();
  for (const d of defs) if (!byLabel.has(key(d.label))) byLabel.set(key(d.label), d);
  return {
    marks: numbered,
    defs,
    def: (label) => byLabel.get(key(label)),
    number: (label) => numbers.get(key(label)),
  };
}

const cache = new WeakMap<Text, Footnotes>();

/** As notas de rodapé do documento do editor, lidas uma vez por versão do texto. */
export function footnotesOf(state: EditorState): Footnotes {
  let got = cache.get(state.doc);
  if (!got) {
    got = scanFootnotes(state.doc.toString());
    cache.set(state.doc, got);
  }
  return got;
}

const SUPERSCRIPT = "⁰¹²³⁴⁵⁶⁷⁸⁹";

/** O número em sobrescrito, como aparece no texto: 12 → ¹². */
export function superscript(n: number): string {
  return String(n).replace(/\d/g, (d) => SUPERSCRIPT[Number(d)]!);
}

/** O marcador de uma chamada: o número dela, ou o rótulo quando nenhuma chamada usa a nota (só a definição). */
export function footnoteLabel(notes: Footnotes, label: string): string {
  const n = notes.number(label);
  return n ? superscript(n) : `[${label}]`;
}

/** O próximo rótulo livre: um a mais que o maior número em uso (`[^1]`, `[^2]`…). */
export function nextFootnoteLabel(notes: Footnotes): string {
  let max = 0;
  for (const m of notes.marks) if (m.kind === "ref" && /^\d+$/.test(m.label)) max = Math.max(max, Number(m.label));
  for (const d of notes.defs) if (/^\d+$/.test(d.label)) max = Math.max(max, Number(d.label));
  return String(max + 1);
}

/**
 * A definição `[^rótulo]: ` no fim da nota, junto das outras: uma linha em branco antes da primeira, e as seguintes
 * ficam juntas (com ou sem linha em branco depois da última).
 */
export function definitionAtEnd(doc: string, notes: Footnotes, label: string): { from: number; insert: string } {
  const afterDefs = notes.defs.length > 0 && notes.defs.at(-1)!.to === doc.trimEnd().length;
  const sep = afterDefs ? (doc.endsWith("\n") ? "" : "\n") : doc.endsWith("\n\n") ? "" : doc.endsWith("\n") ? "\n" : "\n\n";
  return { from: doc.length, insert: `${sep}[^${label}]: ` };
}

/**
 * Inserir uma nota de rodapé (pelo menu e pelo "/"): a chamada `[^n]` entra no cursor (depois da seleção, que fica), e
 * a definição `[^n]: ` entra no fim da nota. O cursor vai para a definição, para escrever o texto, como no Obsidian.
 * `remove` é o trecho que a chamada substitui (o "/rodapé" do comando); sem ele, ela entra em `at`.
 */
export function footnoteInsert(doc: string, at: number, notes: Footnotes = scanFootnotes(doc), remove?: { from: number; to: number }): {
  changes: { from: number; to: number; insert: string }[];
  cursor: number;
  label: string;
} {
  const label = nextFootnoteLabel(notes);
  const ref = `[^${label}]`;
  const def = definitionAtEnd(doc, notes, label);
  const removed = remove ? remove.to - remove.from : 0;
  const changes = [
    remove ? { from: remove.from, to: remove.to, insert: ref } : { from: at, to: at, insert: ref },
    // Com o cursor no fim da nota, as duas entram no mesmo ponto: a chamada primeiro.
    { from: def.from, to: def.from, insert: def.insert },
  ];
  return { changes, cursor: doc.length - removed + ref.length + def.insert.length, label };
}

/** A transação de inserir uma nota de rodapé no cursor do editor (o fim da seleção). */
export function insertFootnote(state: EditorState, remove?: { from: number; to: number }): TransactionSpec {
  const r = footnoteInsert(state.doc.toString(), state.selection.main.to, footnotesOf(state), remove);
  return { changes: r.changes, selection: { anchor: r.cursor }, scrollIntoView: true, userEvent: "input.type" };
}

/**
 * Para onde vai o cursor ao clicar numa nota de rodapé desenhada: da chamada para o fim do texto da definição (uma
 * chamada sem definição cria a definição vazia no fim), da definição de volta para a primeira chamada, e da nota em
 * linha para dentro dela, para editar.
 */
export function footnoteJump(
  state: EditorState,
  to: { kind: "footnote"; label: string } | { kind: "footnoteDef"; label: string } | { kind: "footnoteInline"; n: number },
): TransactionSpec | null {
  const notes = footnotesOf(state);
  if (to.kind === "footnote") {
    const def = notes.def(to.label);
    if (def) return { selection: { anchor: def.to }, scrollIntoView: true, userEvent: "select" };
    const add = definitionAtEnd(state.doc.toString(), notes, to.label);
    return { changes: { from: add.from, insert: add.insert }, selection: { anchor: add.from + add.insert.length }, scrollIntoView: true, userEvent: "input.type" };
  }
  if (to.kind === "footnoteDef") {
    const k = key(to.label);
    const ref = notes.marks.find((m) => m.kind === "ref" && key(m.label) === k);
    return ref ? { selection: { anchor: ref.to }, scrollIntoView: true, userEvent: "select" } : null;
  }
  const inline = notes.marks.find((m) => m.kind === "inline" && m.n === to.n);
  return inline ? { selection: { anchor: inline.from + 2, head: inline.to - 1 }, scrollIntoView: true, userEvent: "select" } : null;
}

/** O texto que o hover mostra: o da definição, o da nota em linha, ou o aviso de que a nota ainda não tem texto. */
export function footnoteText(notes: Footnotes, of: { label: string } | { n: number }): { text: string; missing: boolean } | null {
  if ("n" in of) {
    const m = notes.marks.find((x) => x.kind === "inline" && x.n === of.n);
    return m && m.kind === "inline" ? { text: m.text, missing: false } : null;
  }
  const def = notes.def(of.label);
  return def?.text ? { text: def.text, missing: false } : { text: "Esta nota de rodapé ainda não tem texto. Clique para escrever.", missing: true };
}
