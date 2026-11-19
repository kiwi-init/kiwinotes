// O faro (ADR 0013, peça 1; T14359): antes de o pedido ir ao agente, o Kiwi acha no Mac o que a pessoa citou. Sem
// modelo, sem rede, sem a busca pelo sentido.
//
// Esta parte é a chave pelo som: o ditado erra nomes próprios ("legasi pê erre" no lugar de "Legacy PR"), então o
// Kiwi compara a pronúncia, em português e em inglês, e não a grafia. A chave é grossa de propósito: ela junta o que
// soa parecido, e o placar (`matchScore`, do `find`) desempata.

import { nameKey } from "./tools/find.ts";
import type { ReaderNoteMeta } from "./tools/reader.ts";
import { placarDaTrilha, type Trilha, trilhasDoPedido } from "./trilhas.ts";

/** As letras faladas, como o ditado escreve uma sigla: "pê erre" é PR, "gê cê pê" é GCP. */
const LETTERS: Record<string, string> = {
  // Sem "a", "e" e "o": no meio da frase eles são artigo e conjunção ("quê um e me diz" não é "q1e").
  be: "b", bê: "b", ce: "c", cê: "c", dê: "d", efe: "f", ge: "g", gê: "g", aga: "h", i: "i",
  jota: "j", ka: "k", cá: "k", ele: "l", eme: "m", ene: "n", pe: "p", pê: "p", que: "q", quê: "q", erre: "r",
  esse: "s", te: "t", tê: "t", u: "u", ve: "v", vê: "v", dablio: "w", dáblio: "w", xis: "x", ipsilon: "y", ípsilon: "y", ze: "z", zê: "z",
};

/** Os números falados, que o ditado escreve por extenso ("relatório quê um" é Relatório Q1). */
const NUMBERS: Record<string, string> = { zero: "0", um: "1", uma: "1", dois: "2", duas: "2", tres: "3", quatro: "4", cinco: "5", seis: "6", sete: "7", oito: "8", nove: "9", dez: "10" };

/** Sem acento e minúsculas, com as palavras separadas por um espaço. O "ç" vira "ss" antes de perder a cedilha. */
const plain = (t: string) =>
  t
    .replace(/ç/gi, "ss")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * Junta as letras faladas numa sigla: "legasi pê erre" → "legasi pr". Só a partir de duas seguidas, para "e" e "a"
 * soltos no meio da frase não virarem letra.
 */
export function joinSpelledLetters(t: string): string {
  const words = t.normalize("NFC").toLowerCase().split(/\s+/).filter(Boolean);
  const unit = (w: string) => LETTERS[w] ?? LETTERS[plain(w)] ?? NUMBERS[plain(w)] ?? (/^\d+$/.test(w) ? w : undefined);
  const out: string[] = [];
  for (let i = 0; i < words.length; ) {
    let j = i;
    while (j < words.length && unit(words[j]!) !== undefined) j++;
    // Uma sigla: duas ou mais letras, ou uma letra e um número ("quê um" é q1).
    const run = words.slice(i, j);
    const letters = run.filter((w) => !NUMBERS[plain(w)] && !/^\d+$/.test(w)).length;
    if (run.length >= 2 && letters >= 1) {
      out.push(run.map(unit).join(""));
      i = j;
    } else {
      out.push(words[i]!);
      i++;
    }
  }
  return out.join(" ");
}

/**
 * A chave pelo som de uma palavra, em português e em inglês: os dígrafos e as letras que soam igual viram uma, as
 * vogais do meio se juntam em classes, e as letras dobradas e a vogal final átona caem.
 */
export function soundWord(w: string): string {
  let s = plain(w).replace(/\s+/g, "");
  if (!s) return "";
  s = s
    .replace(/y/g, "i")
    .replace(/ph/g, "f")
    .replace(/th/g, "t")
    .replace(/sh|ch|x/g, "x")
    .replace(/lh/g, "li")
    .replace(/nh/g, "ni")
    .replace(/qu|q|ck|k/g, "k")
    .replace(/c(?=[ei])/g, "s")
    .replace(/c/g, "k")
    .replace(/ç/g, "s")
    .replace(/ss|z(?=[aeiou])/g, "s")
    .replace(/g(?=[ei])/g, "j")
    .replace(/w/g, "v")
    .replace(/h/g, "")
    // O "l" antes de consoante ou no fim soa "u" no português do Brasil ("portal", "portau").
    .replace(/l(?=[^aeiou]|$)/g, "u")
    // As vogais: e/i e o/u soam perto no fim e no meio da fala.
    .replace(/[ei]/g, "i")
    .replace(/[ou]/g, "u")
    .replace(/(.)\1+/g, "$1");
  // O plural e a vogal final átona caem ("compras" e "compra", "norte" e "nórti", "legacy" e "legasi").
  if (s.length > 3) s = s.replace(/s$/, "");
  if (s.length > 3) s = s.replace(/[aiu]$/, "");
  return s;
}

/** A chave pelo som de um nome: a de cada palavra, com as siglas faladas juntas, sem espaço. */
export function soundKey(name: string): string {
  // Sem os espaços antes da chave: "fotô grafia" e "Fotografia" são a mesma palavra para quem ouve.
  return soundWord(joinSpelledLetters(plain(name)).replace(/ /g, ""));
}

// ── O índice de nomes e as citações ─────────────────────────────────────────────────────────────────────────────────


/** `arquivo`: um arquivo que não é nota (csv, pdf, código…), só quando a pessoa aponta o aberto nas Notas (T19969). */
export type FaroKind = "nota" | "pasta" | "projeto" | "reuniao" | "arquivo";

/** Um alvo do índice: o tipo, o caminho e os nomes pelos quais a pessoa o chama. */
export interface FaroTarget {
  kind: FaroKind;
  path: string;
  title: string;
  names: string[];
  /** A nota principal, num projeto. */
  main?: string | null;
}

export interface FaroIndex {
  targets: FaroTarget[];
  /** Pela chave do nome (sem acento, maiúscula e separador) e pela chave do som. */
  byName: Map<string, FaroTarget[]>;
  bySound: Map<string, FaroTarget[]>;
  /**
   * Os nomes de duas palavras ou mais, por palavra (pela chave e pelo som): o pedido pode trazer as palavras em outra
   * ordem ("o rascunho do Relatório Q1" para "Relatório Q1 rascunho").
   */
  byWord: Map<string, { target: FaroTarget; words: string[]; how: "nome" | "som" }[]>;
  /** A reunião mais nova, para "a última reunião". */
  lastMeeting: string | null;
}

/** Nomes curtos demais casam por acaso ("a", "de"): ficam fora do índice. */
const MIN_KEY = 4;

/** Monta o índice com o que o cofre já lista, sem ler o texto das notas. */
export function buildIndex(o: {
  notes: readonly ReaderNoteMeta[];
  folders: readonly string[];
  projects: readonly { name: string; folder: string; main: string | null }[];
  meetings: readonly { path: string; title: string; date: string }[];
}): FaroIndex {
  const targets: FaroTarget[] = [];
  const projectFolders = new Set(o.projects.map((p) => p.folder));
  const meetingPaths = new Set(o.meetings.map((m) => m.path));
  for (const p of o.projects) targets.push({ kind: "projeto", path: p.folder, title: p.name, names: [p.name, p.folder.split("/").pop()!], main: p.main });
  for (const f of o.folders) if (!projectFolders.has(f)) targets.push({ kind: "pasta", path: f, title: f.split("/").pop()!, names: [f.split("/").pop()!] });
  for (const m of o.meetings) targets.push({ kind: "reuniao", path: m.path, title: m.title, names: [m.title] });
  for (const n of o.notes) {
    if (meetingPaths.has(n.path)) continue;
    const file = n.path.split("/").pop()!.replace(/\.(md|txt)$/i, "");
    targets.push({ kind: "nota", path: n.path, title: n.title, names: n.title === file ? [n.title] : [n.title, file] });
  }
  const byName = new Map<string, FaroTarget[]>();
  const bySound = new Map<string, FaroTarget[]>();
  const add = (m: Map<string, FaroTarget[]>, k: string, t: FaroTarget) => {
    if (k.length < MIN_KEY) return;
    const list = m.get(k) ?? [];
    if (!list.includes(t)) list.push(t);
    m.set(k, list);
  };
  for (const t of targets) for (const n of t.names) {
    add(byName, nameKey(n), t);
    add(bySound, soundKey(n), t);
  }
  const byWord = new Map<string, { target: FaroTarget; words: string[]; how: "nome" | "som" }[]>();
  for (const t of targets) for (const n of t.names) {
    const parts = n.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    if (parts.length < 2) continue;
    for (const [how, key] of [["nome", nameKey], ["som", soundWord]] as const) {
      // Um número do nome é obrigatório ("relatório pendência 88" não é qualquer relatório de pendências).
      const words = [...new Set(parts.map((w) => (/^\d+$/.test(w) ? w : key(w))).filter((w) => w.length >= 2 || /^\d+$/.test(w)))];
      if (words.length < 2) continue;
      // Pela palavra mais rara não dá para saber aqui: entra por todas, e o pedido confere o resto.
      for (const w of words) {
        const list = byWord.get(`${how}:${w}`) ?? [];
        list.push({ target: t, words, how });
        byWord.set(`${how}:${w}`, list);
      }
    }
  }
  const last = [...o.meetings].sort((a, b) => b.date.localeCompare(a.date) || b.path.localeCompare(a.path))[0];
  return { targets, byName, bySound, byWord, lastMeeting: last?.path ?? null };
}

/** Uma citação achada: o alvo, a janela do pedido que casou e o placar. */
export interface FaroHit {
  target: FaroTarget;
  /** As palavras do pedido que casaram. */
  said: string;
  score: number;
  /**
   * Como casou: o nome, o som, a pessoa apontou ("essa nota", "a última reunião"), ou pela trilha (T14682): as palavras
   * do pedido já levaram o agente a esta nota antes.
   */
  how: "nome" | "som" | "apontado" | "trilha";
}

/** No "nada", `semAberto`: a pessoa apontou o aberto ("esse arquivo") e nada está aberto nas Notas; o agente pergunta. */
export type FaroResult = { kind: "certo"; hit: FaroHit } | { kind: "provavel"; hits: FaroHit[] } | { kind: "nada"; semAberto?: true };

/** As palavras que dizem o tipo do alvo. */
const TYPE_WORDS: [RegExp, FaroKind][] = [
  [/\bpastas?\b/, "pasta"],
  [/\bprojetos?\b/, "projeto"],
  [/\breuni(ao|oes)\b/, "reuniao"],
  [/\bnotas?\b/, "nota"],
];
/**
 * O que a pessoa aponta como o aberto nas Notas (T14359, T19969): "essa nota", "nesse arquivo", "nessa planilha",
 * "neste csv", "o arquivo que eu tô com aberto", "o que tá aberto", "aqui". O texto já vem sem acento e minúsculo
 * ("tô" é "to", "está" é "esta"). "Uma tabela" não aponta nada: só o demonstrativo ou o "aberto".
 */
const OPEN_THINGS = "nota|arquivo|planilha|tabela|documento|doc|docx|texto|csv|tsv|pdf|xlsx|json|codigo|pagina|imagem|foto|apresentacao";
const POINT_OPEN = new RegExp(
  [
    `\\b[nd]?(ess|est)[ae] (${OPEN_THINGS})\\b`,
    `\\b(${OPEN_THINGS}) (que (eu )?(to|estou|esta|ta|deixei) (com )?)?abert[oa]\\b`,
    `\\bo que (eu )?(to|estou|esta|ta|deixei) (com )?abert[oa]\\b`,
  ].join("|"),
);
/** "Aqui" também aponta o aberto; sozinho, sem nada aberto, é só a palavra ("aqui está a lista"): não pede pergunta. */
const POINT_HERE = /\baqui\b/;
/** "A última reunião", "a reunião de ontem": a mais nova. */
const POINT_MEETING = /\b(ultima|recente) reuniao\b|\breuniao (de ontem|de hoje|mais recente)\b/;

/** O `said` do alvo que veio do aberto nas Notas. */
export const OPEN_SAID = "o aberto nas Notas";

/**
 * O que vem antes de um nome para ele ser o destino ou o lugar do pedido (T19969). Uma palavra solta só depois de
 * "nota", "pasta", "projeto", "para a" ou "pra" ("na nota Resumo", "para o Total"): um "na" ou "no" sozinho não basta,
 * porque "o maior valor na coluna B" e "quanto dá no total" falam do aberto. Um nome de várias palavras vale também
 * depois de "na", "no" e "em" ("escreve aqui na Lista de compras"). Em qualquer outro lugar da frase ("monta uma lista
 * de tarefas", "qual o maior valor"), o nome é só o que a pessoa disse, e o aberto fica na frente.
 */
const CITE_BEFORE_WORD = "(?:nota|pasta|projeto|pra|pro|para(?: a| o)?)";
const CITE_BEFORE_NAME = "(?:nota|pasta|projeto|pra|pro|para(?: a| o)?|na|no|nas|nos|em)";

/** Uma citação forte o bastante para passar na frente do aberto (T19969). `text` é o pedido já no `plain`. */
function strongCitation(text: string, said: string): boolean {
  const s = plain(said).trim();
  const before = s.split(/\s+/).length >= 2 ? CITE_BEFORE_NAME : CITE_BEFORE_WORD;
  const esc = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${before} ${esc}\\b`).test(text);
}

/** O alvo do aberto nas Notas: o do índice (nota, reunião), ou um arquivo pelo caminho. `.md` e `.txt` são notas. */
function openTarget(idx: FaroIndex, path: string): FaroTarget {
  const known = idx.targets.find((x) => x.path === path && x.kind !== "pasta" && x.kind !== "projeto");
  if (known) return known;
  const name = path.split("/").pop()!;
  return /\.(md|txt)$/i.test(name) ? { kind: "nota", path, title: name.replace(/\.(md|txt)$/i, ""), names: [] } : { kind: "arquivo", path, title: name, names: [] };
}

/** Um nome que vários alvos têm ("prazo", "lista") diz pouco: acima disto, ele não conta. */
export const GENERIC_MAX = 3;
/** Quanto o placar do primeiro tem de passar o do segundo para ser "certo". */
export const CERTO_MARGIN = 0.15;
/** Quantos alvos o "provável" leva, no máximo. */
export const PROVAVEL_MAX = 5;

/**
 * As citações do pedido (ADR 0013 peça 1): janelas de 1 a 5 palavras, casadas pelo nome e pelo som. Igual vale mais
 * que pelo som, e uma janela longa vale mais que uma curta. A palavra do tipo ("pasta", "projeto") puxa o alvo daquele
 * tipo. O que a pessoa aponta ("essa nota") vem da nota aberta.
 */
export function sniff(request: string, idx: FaroIndex, ctx: { openNote?: string | null; trilhas?: readonly Trilha[] } = {}): FaroResult {
  const text = plain(request);
  const byTarget = new Map<FaroTarget, FaroHit>();
  const keep = (h: FaroHit) => {
    const was = byTarget.get(h.target);
    if (!was || was.score < h.score) byTarget.set(h.target, h);
  };
  // O aberto nas Notas (T19969): a nota, ou qualquer arquivo no visualizador. As siglas faladas contam ("nesse cê esse vê").
  const pointed = POINT_OPEN.test(text) || POINT_OPEN.test(plain(joinSpelledLetters(request)));
  const open = (pointed || POINT_HERE.test(text)) && ctx.openNote ? openTarget(idx, ctx.openNote) : null;
  if (idx.lastMeeting && POINT_MEETING.test(text)) {
    const t = idx.targets.find((x) => x.path === idx.lastMeeting)!;
    if (t) keep({ target: t, said: "a última reunião", score: 2, how: "apontado" });
  }
  const types = new Set(TYPE_WORDS.filter(([re]) => re.test(text)).map(([, k]) => k));
  // Pelo nome, as palavras como a pessoa escreveu (o `nameKey` tira acento e separador); pelo som, com as siglas
  // faladas juntas ("pê erre" é PR).
  const rawWords = request.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const soundWords = joinSpelledLetters(text).split(" ").filter(Boolean);
  const scan = (words: string[], how: "nome" | "som") => {
    for (let size = 5; size >= 1; size--) {
      for (let i = 0; i + size <= words.length; i++) {
        const said = words.slice(i, i + size).join(" ");
        const key = how === "nome" ? nameKey(said) : soundKey(said);
        if (key.length < MIN_KEY) continue;
        const found = (how === "nome" ? idx.byName : idx.bySound).get(key) ?? [];
        // Um nome de muitos alvos ("prazo", "lista") é uma palavra comum, não uma citação.
        if (!found.length || found.length > GENERIC_MAX) continue;
        // Mais palavras dizem mais do alvo; o nome exato vale mais que o som.
        const base = (how === "nome" ? 1 : 0.85) + 0.12 * (size - 1) + Math.min(key.length, 30) / 300;
        for (const t of found) keep({ target: t, said, score: base + (types.has(t.kind) ? 0.1 : 0) - 0.05 * (found.length - 1), how });
      }
    }
  };
  scan(rawWords, "nome");
  scan(soundWords, "som");
  // As palavras de um nome longo, em qualquer ordem: um pouco abaixo da mesma janela na ordem.
  for (const [how, words] of [["nome", rawWords.map((w) => (/^\d+$/.test(w) ? w : nameKey(w)))], ["som", soundWords.map((w) => (/^\d+$/.test(w) ? w : soundWord(w)))]] as const) {
    const have = new Set(words.filter((w) => w.length >= 2 || /^\d+$/.test(w)));
    const seen = new Set<FaroTarget>();
    for (const w of have)
      for (const e of idx.byWord.get(`${how}:${w}`) ?? []) {
        if (seen.has(e.target) || !e.words.every((x) => have.has(x))) continue;
        seen.add(e.target);
        const base = (how === "nome" ? 1 : 0.85) + 0.12 * (e.words.length - 1) - 0.03;
        keep({ target: e.target, said: e.words.join(" "), score: base + (types.has(e.target.kind) ? 0.1 : 0), how });
      }
  }
  // As trilhas (T14682): as palavras que já levaram o agente a uma nota. Uma nota que saiu do cofre não volta.
  for (const c of trilhasDoPedido(request, ctx.trilhas ?? [])) {
    const t = idx.targets.find((x) => (x.kind === "nota" || x.kind === "reuniao") && x.path === c.trilha.path) ?? idx.targets.find((x) => x.kind === "projeto" && x.main === c.trilha.path);
    if (t) keep({ target: t, said: c.palavras.join(" "), score: placarDaTrilha(c), how: "trilha" });
  }
  // O projeto e a nota principal dele são o mesmo alvo: fica o projeto.
  const mains = new Set([...byTarget.keys()].filter((t) => t.kind === "projeto" && t.main).map((t) => t.main!));
  for (const t of [...byTarget.keys()]) if (t.kind === "nota" && mains.has(t.path)) byTarget.delete(t);
  // Uma janela que cabe dentro de outra que casou não conta à parte ("plano" dentro de "plano de mudança").
  const all = [...byTarget.values()];
  const hits = all
    .filter((h) => h.how === "apontado" || h.how === "trilha" || !all.some((o) => o !== h && o.score > h.score && plain(o.said).includes(plain(h.said)) && plain(o.said) !== plain(h.said)))
    .sort((a, b) => b.score - a.score);
  // O aberto vale, a não ser que a pessoa cite outro alvo pelo nome com força ("aqui na Lista de compras"): aí vale o
  // citado, e o aberto fica abaixo dele. Uma palavra solta que também é o nome de uma nota ("resumo", "total",
  // "linhas") não tira o aberto da frente: ele fica com o placar 2, acima dela (revisão do T19969).
  if (open && !byTarget.has(open)) {
    const cited = hits.some((h) => (h.how === "nome" || h.how === "som") && h.target.path !== open.path && strongCitation(text, h.said));
    hits.push({ target: open, said: OPEN_SAID, score: cited ? 0 : 2, how: "apontado" });
    hits.sort((a, b) => b.score - a.score);
  }
  if (!hits.length) return pointed && !ctx.openNote ? { kind: "nada", semAberto: true } : { kind: "nada" };
  if (hits.length === 1 || hits[0]!.score - hits[1]!.score >= CERTO_MARGIN) return { kind: "certo", hit: hits[0]! };
  return { kind: "provavel", hits: hits.slice(0, PROVAVEL_MAX) };
}
