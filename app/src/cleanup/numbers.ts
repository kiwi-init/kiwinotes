// Número falado por extenso vira algarismo (T1974, decisão do harry em #1968), em PT-BR e EN:
//   "duzentos e trinta e quatro" → 234 · "três de dezembro" → "3 de dezembro" · "às três e meia" → "às 3h30"
//   "cinquenta reais" → "50 reais" · "dez por cento" → "10%" · "at three thirty" → "at 3:30" · "ten dollars" → "$10"
//
// Determinístico e conservador, como o resto das regras. Fica por extenso, de propósito:
// - "um", "uma", "one", "mil" e "zero" sozinhos: são artigo ou expressão ("um dia desses", "uma vez", "de um lado",
//   "one of them", "mil vezes", "do zero"). Viram algarismo só com o que diz que são número: dinheiro, por cento,
//   milhão, data ("um de março") e hora ("à uma");
// - "os dois", "nós dois", "the two of us": pronome, não quantidade ("os dois arquivos" vira "os 2 arquivos");
// - "um ou dois", "one or two": uma estimativa falada;
// - dois números colados que não formam hora, ano, telefone nem gagueira ("vinte trinta"): ambíguo.
//
// O que já veio em algarismo do STT também ganha a forma escrita: "às 3" → "às 3h", "50 por cento" → "50%".

type Lang = "pt" | "en" | "any";
type Kind = "zero" | "unit" | "teen" | "tens" | "hundreds" | "hundred" | "thousand";
interface Part {
  value: number;
  kind: Kind;
  lang: Lang;
}

const NUMBER_WORDS = new Map<string, Part>();
const add = (lang: Lang, kind: Kind, list: string) => {
  for (const entry of list.split(" ")) {
    const [word, value] = entry.split("=");
    NUMBER_WORDS.set(word!, { value: Number(value), kind, lang });
  }
};
add("any", "zero", "zero=0");
add("pt", "unit", "um=1 uma=1 dois=2 duas=2 três=3 tres=3 quatro=4 cinco=5 seis=6 sete=7 oito=8 nove=9");
add(
  "pt",
  "teen",
  "dez=10 onze=11 doze=12 treze=13 quatorze=14 catorze=14 quinze=15 dezesseis=16 dezasseis=16 dezessete=17 dezoito=18 dezenove=19",
);
add("pt", "tens", "vinte=20 trinta=30 quarenta=40 cinquenta=50 cinqüenta=50 sessenta=60 setenta=70 oitenta=80 noventa=90");
add(
  "pt",
  "hundreds",
  "cem=100 cento=100 duzentos=200 duzentas=200 trezentos=300 trezentas=300 quatrocentos=400 quatrocentas=400 quinhentos=500 quinhentas=500 seiscentos=600 seiscentas=600 setecentos=700 setecentas=700 oitocentos=800 oitocentas=800 novecentos=900 novecentas=900",
);
add("pt", "thousand", "mil=1000");
add("en", "unit", "one=1 two=2 three=3 four=4 five=5 six=6 seven=7 eight=8 nine=9");
add(
  "en",
  "teen",
  "ten=10 eleven=11 twelve=12 thirteen=13 fourteen=14 fifteen=15 sixteen=16 seventeen=17 eighteen=18 nineteen=19",
);
add("en", "tens", "twenty=20 thirty=30 forty=40 fifty=50 sixty=60 seventy=70 eighty=80 ninety=90");
add("en", "hundred", "hundred=100");
add("en", "thousand", "thousand=1000");

/** Sozinhas, estas são artigo ou expressão, não quantidade. */
const ALONE = new Set(["um", "uma", "one", "mil", "zero"]);
const CONNECTOR: Record<string, Lang> = { e: "pt", and: "en" };
const DECIMAL: Record<string, { lang: Lang; sep: string }> = {
  vírgula: { lang: "pt", sep: "," },
  ponto: { lang: "pt", sep: "." },
  point: { lang: "en", sep: "." },
};

const MONTHS_PT = "janeiro fevereiro março marco abril maio junho julho agosto setembro outubro novembro dezembro";
const MONTHS_EN = "january february march april may june july august september october november december";
const MONEY = new Set(
  "real reais centavo centavos dólar dólares dolar dolares euro euros libra libras dollar dollars buck bucks cent cents".split(" "),
);
const SCALE = new Set("milhão milhões milhao milhoes bilhão bilhões bilhao bilhoes million millions billion billions".split(" "));
const MONTH = new Set(`${MONTHS_PT} ${MONTHS_EN}`.split(" "));
/** Depois de "os dois", "nós dois": o pronome segue a frase, não é "os dois arquivos". */
const AFTER_PRONOUN = new Set(
  "e que de do da vão vamos foram estão são eram têm tem juntos juntas ali aqui lá também já não sempre só mesmo mesmos podem devem ficaram ficam se ou com sem para pra por em no na".split(
    " ",
  ),
);
const PRONOUN_BEFORE_TWO = new Set("os as nós vocês eles elas dos das aos às pros pras".split(" "));

/** Uma palavra que as regras trocam por algarismo (para a trava de palavras perdidas). */
export function isNumberWord(word: string): boolean {
  const w = word.toLocaleLowerCase("pt-BR");
  return NUMBER_WORDS.has(w) || w.split("-").every((p) => NUMBER_WORDS.has(p));
}

// ------------------------------------------------------------ o valor de uma sequência

interface State {
  total: number;
  group: number;
  low: "none" | "unit" | "teen" | "tens";
  hundreds: boolean;
  thousand: boolean;
  closed: boolean;
  lang: Lang;
}

const fresh = (): State => ({ total: 0, group: 0, low: "none", hundreds: false, thousand: false, closed: false, lang: "any" });

/** O estado com mais uma palavra, ou null se ela não continua o número ("três quatro", "vinte trinta"). */
function accept(s: State, p: Part, connector: string | null): State | null {
  if (s.closed) return null;
  const lang = p.lang === "any" ? s.lang : p.lang;
  if (s.lang !== "any" && p.lang !== "any" && p.lang !== s.lang) return null;
  if (connector && CONNECTOR[connector] !== lang) return null;
  const empty = s.group === 0 && s.total === 0 && s.low === "none" && !s.hundreds && !s.thousand;
  const n = { ...s, lang };
  switch (p.kind) {
    case "zero":
      return empty && !connector ? { ...n, closed: true } : null;
    case "unit":
      if (s.low === "none" || s.low === "tens") {
        if (s.low === "tens" && lang === "en" && connector) return null;
        return { ...n, group: s.group + p.value, low: "unit" };
      }
      return null;
    case "teen":
    case "tens":
      if (s.low !== "none") return null;
      if (connector === "and" && !(s.hundreds || s.thousand)) return null;
      return { ...n, group: s.group + p.value, low: p.kind };
    case "hundreds":
      if (s.group !== 0 || s.low !== "none" || s.hundreds) return null;
      return { ...n, group: p.value, hundreds: true };
    case "hundred":
      // "one hundred", "fifteen hundred": o que veio antes multiplica.
      if (connector || s.hundreds || s.group < 1 || s.group > 99) return null;
      return { ...n, group: s.group * 100, low: "none", hundreds: true };
    case "thousand":
      if (connector || s.thousand) return null;
      if (lang === "en" && s.group === 0) return null; // "thousand" sozinho não é número; "mil" é
      if (lang === "pt" && s.group === 1 && s.low === "unit") return null; // "um mil" não se diz
      return { ...n, total: (s.group || 1) * 1000, group: 0, low: "none", hundreds: false, thousand: true };
  }
}

const valueOf = (s: State) => s.total + s.group;

// ------------------------------------------------------------ as palavras do texto

interface Word {
  tok: number; // o índice no array de tokens
  lower: string;
  parts: Part[] | null;
}

const TOKEN = /[\p{L}\p{N}\p{Co}]+(?:['’-][\p{L}\p{N}]+)*|[^\p{L}\p{N}\p{Co}]+/gu;
const isWordToken = (t: string) => /^[\p{L}\p{N}\p{Co}]/u.test(t);

function partsOf(lower: string): Part[] | null {
  const one = NUMBER_WORDS.get(lower);
  if (one) return [one];
  if (!lower.includes("-")) return null;
  // "twenty-one", "vinte-e-um" não: só o hífen do inglês.
  const parts = lower.split("-").map((p) => NUMBER_WORDS.get(p));
  return parts.every((p) => p && p.lang !== "pt") ? (parts as Part[]) : null;
}

/** Um pedaço que vira um número só: as palavras de `from` a `to` (índices em `words`). */
interface Chunk {
  from: number;
  to: number;
  value: number;
  /** O texto pronto (telefone, decimal, hora, ano), quando não é só o valor. */
  text?: string;
  /** Uma palavra só: "três", "um". */
  single: boolean;
  /** A palavra, quando é uma só. */
  word?: string;
  /** Já decidido que é número (decimal, hora, telefone): não passa pelas exceções. */
  forced?: boolean;
  /** Fica por extenso (ambíguo). */
  keep?: boolean;
  /** Some (a cópia de uma gagueira). */
  drop?: boolean;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** O número escrito: separador de milhar a partir de 1000, menos num ano (1900–2099) fora de dinheiro. */
function format(value: number, lang: Lang, money: boolean): string {
  if (value < 1000 || (!money && value >= 1900 && value <= 2099)) return String(value);
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, lang === "en" ? "," : ".");
}

/** "pra uma", "pras três", "para as oito", "pro meio-dia": o que vem depois de um número numa hora contada para trás. */
const TO_HOUR = new Set(["pra", "pras", "pro", "para"]);
const HOUR_ARTICLE = new Set(["a", "as", "à", "às", "o"]);
const NAMED_HOUR = new Set(["meio-dia", "meia-noite"]);
/** Fração: "dois terços", "três quartos". */
const FRACTION = new Set(
  "terço terços quarto quartos quinto quintos sexto sextos sétimo sétimos oitavo oitavos nono nonos décimo décimos avos".split(" "),
);

/**
 * As palavras que ficam por extenso porque o número ali não é um número só (revisão do T1974, #2344):
 * - a hora contada para trás, "X pra Y": "quinze pra uma" é 12h45, e converter pela metade ("15 pra uma", e com o
 *   "às" na frente, "às 15h") troca a hora. Fica inteiro por extenso, os dois números;
 * - a fração: "dois terços" não é "2 terços".
 */
function ambiguousSpans(words: Word[], spaced: (k: number) => boolean): Set<number> {
  const keep = new Set<number>();
  const at = (k: number) => (k < words.length && spaced(k) ? words[k]! : null);
  for (let i = 0; i < words.length; i++) {
    if (!words[i]!.parts) continue;
    const next = at(i + 1);
    if (!next) continue;
    if (FRACTION.has(next.lower)) {
      keep.add(i);
      continue;
    }
    if (!TO_HOUR.has(next.lower)) continue;
    let t = i + 2;
    if (at(t) && HOUR_ARTICLE.has(at(t)!.lower)) t++;
    const target = at(t);
    if (!target) continue;
    // "meio dia" e "meia noite" separados também.
    const named = NAMED_HOUR.has(target.lower) || ((target.lower === "meio" || target.lower === "meia") && /^(?:dia|noite)$/.test(at(t + 1)?.lower ?? ""));
    if (!target.parts && !named) continue;
    keep.add(i);
    if (target.parts) for (let k = t; k < words.length && words[k]!.parts && (k === t || spaced(k)); k++) keep.add(k);
  }
  return keep;
}

/** Converte as sequências de palavras-número de uma frase. */
function convertWords(text: string): string {
  const tokens = text.match(TOKEN) ?? [];
  const words: Word[] = [];
  tokens.forEach((t, i) => {
    if (!isWordToken(t)) return;
    const lower = t.toLocaleLowerCase("pt-BR");
    words.push({ tok: i, lower, parts: partsOf(lower) });
  });
  /** Só espaço entre a palavra k-1 e a k (sem vírgula nem ponto). */
  const spaced = (k: number) => k > 0 && k < words.length && words[k]!.tok - words[k - 1]!.tok === 2 && /^[^\S\n]+$/.test(tokens[words[k]!.tok - 1]!);
  const replace = new Map<number, { end: number; text: string }>();
  const keepWords = ambiguousSpans(words, spaced);

  let k = 0;
  while (k < words.length) {
    if (!words[k]!.parts) {
      k++;
      continue;
    }
    const run = collectRun(words, k, spaced);
    const chunks = chunkRun(words, run);
    decide(words, chunks, spaced);
    for (const c of chunks) {
      for (let w = c.from; w <= c.to; w++) if (keepWords.has(w)) c.keep = true;
      if (c.keep) continue;
      const start = words[c.from]!.tok;
      const end = words[c.to]!.tok;
      if (c.drop) {
        // A cópia da gagueira some com o espaço antes dela.
        replace.set(start - 1, { end, text: "" });
        continue;
      }
      const next = c.to + 1 < words.length && spaced(c.to + 1) ? words[c.to + 1]!.lower : "";
      const after = c.to + 2 < words.length && spaced(c.to + 2) ? words[c.to + 2]!.lower : "";
      const money = MONEY.has(next) || (next === "por" && after === "cento") || next === "percent";
      const lang = words[c.from]!.parts?.[0]?.lang ?? "pt";
      replace.set(start, { end, text: c.text ?? format(c.value, lang, money) });
    }
    k = run.at(-1)! + 1;
  }

  let out = "";
  for (let i = 0; i < tokens.length; i++) {
    const r = replace.get(i);
    if (r) {
      out += r.text;
      i = r.end;
    } else out += tokens[i];
  }
  return out;
}

/** As palavras de uma sequência: números, e "e"/"and"/"vírgula" entre dois números. Índices em `words`. */
function collectRun(words: Word[], k: number, spaced: (k: number) => boolean): number[] {
  const run = [k];
  let i = k;
  while (i + 1 < words.length && spaced(i + 1)) {
    const next = words[i + 1]!;
    if (next.parts) {
      run.push(i + 1);
      i++;
      continue;
    }
    // "three oh five": o "oh" é zero, só entre dois números do inglês.
    if (next.lower === "oh" && words[i]!.parts?.[0]?.lang === "en" && i + 2 < words.length && spaced(i + 2)) {
      const after = words[i + 2]!.parts;
      if (after?.length === 1 && after[0]!.kind === "unit" && after[0]!.lang === "en") {
        run.push(i + 1, i + 2);
        i += 2;
        continue;
      }
    }
    const joins = next.lower in CONNECTOR || next.lower in DECIMAL;
    if (joins && i + 2 < words.length && spaced(i + 2) && words[i + 2]!.parts) {
      run.push(i + 1, i + 2);
      i += 2;
      continue;
    }
    break;
  }
  return run;
}

/** Divide a sequência nos números que ela tem ("dois e três" → 2, 3), e marca os colados (hora, ano, telefone). */
function chunkRun(words: Word[], run: number[]): Chunk[] {
  const chunks: Chunk[] = [];
  /** Se há um conector (e/and) logo antes do chunk: os colados não têm. */
  const glued: boolean[] = [];
  let i = 0;
  while (i < run.length) {
    const w = words[run[i]!]!;
    if (!w.parts) {
      i++; // um conector solto ("e"), ou um "oh"
      continue;
    }
    const gluedToPrev = chunks.length > 0 && i > 0 && words[run[i - 1]!]!.parts !== null && chunks.at(-1)!.to === run[i - 1];
    let s: State | null = fresh();
    for (const p of w.parts) s = s && accept(s, p, null);
    if (!s) {
      i++;
      continue;
    }
    let j = i + 1;
    for (;;) {
      const cand = run[j] !== undefined ? words[run[j]!]! : null;
      if (!cand) break;
      if (cand.parts) {
        let t: State | null = s;
        for (const p of cand.parts) t = t && accept(t, p, null);
        if (!t) break;
        s = t;
        j++;
        continue;
      }
      if (cand.lower in CONNECTOR && run[j + 1] !== undefined) {
        const after = words[run[j + 1]!]!;
        let t: State | null = s;
        after.parts!.forEach((p, n) => (t = t && accept(t, p, n === 0 ? cand.lower : null)));
        if (!t) break;
        s = t;
        j += 2;
        continue;
      }
      break;
    }
    const from = run[i]!;
    const to = run[j - 1]!;
    // "cento" e "hundred" não terminam um número ("cento" sozinho não se diz).
    if (w.lower === "cento" && from === to) {
      i = j;
      continue;
    }
    const chunk: Chunk = { from, to, value: valueOf(s), single: from === to && w.parts.length === 1 };
    if (chunk.single) chunk.word = w.lower;
    // Decimal: "dois vírgula cinco" → 2,5; "versão dois ponto um" → 2.1; "pi é três vírgula um quatro" → 3,14.
    const dec = run[j] !== undefined ? DECIMAL[words[run[j]!]!.lower] : undefined;
    if (dec && run[j + 1] !== undefined && (dec.lang === s.lang || s.lang === "any")) {
      let d = j + 1;
      const digits: string[] = [];
      while (run[d] !== undefined && words[run[d]!]!.parts?.length === 1 && ["unit", "zero"].includes(words[run[d]!]!.parts![0]!.kind)) {
        if (d > j + 1 && run[d - 1] !== run[d]! - 1) break;
        digits.push(String(words[run[d]!]!.parts![0]!.value));
        d++;
      }
      if (digits.length > 0) {
        Object.assign(chunk, { to: run[d - 1]!, text: `${chunk.value}${dec.sep}${digits.join("")}`, forced: true, single: false });
        j = d;
      }
    }
    // O "oh" do inglês: "oh five" é 05 (a parte de uma hora ou de um ano).
    chunks.push(chunk);
    glued.push(gluedToPrev);
    i = j;
    if (run[i] !== undefined && words[run[i]!]!.lower === "oh" && run[i + 1] !== undefined) {
      const unit = words[run[i + 1]!]!.parts![0]!;
      chunks.push({ from: run[i]!, to: run[i + 1]!, value: unit.value, text: `0${unit.value}`, single: false });
      glued.push(true);
      i += 2;
    }
  }
  return groupGlued(words, chunks, glued);
}

/**
 * Números colados, sem "e" entre eles: um telefone ("nove nove oito sete" → 9987), a hora do inglês ("three thirty"
 * → 3:30), o ano do inglês ("twenty twenty-six" → 2026) ou a gagueira ("três três" → 3). O resto fica por extenso.
 */
function groupGlued(words: Word[], chunks: Chunk[], glued: boolean[]): Chunk[] {
  const out: Chunk[] = [];
  let i = 0;
  while (i < chunks.length) {
    let j = i + 1;
    while (j < chunks.length && glued[j]) j++;
    const group = chunks.slice(i, j);
    i = j;
    if (group.length === 1) {
      out.push(group[0]!);
      continue;
    }
    const lang = words[group[0]!.from]!.parts?.[0]?.lang;
    const digit = (c: Chunk) => c.single && c.value < 10 && !c.text;
    if (group.length >= 4 && group.every(digit)) {
      out.push({ from: group[0]!.from, to: group.at(-1)!.to, value: 0, text: group.map((c) => c.value).join(""), single: false, forced: true });
      continue;
    }
    if (group.length === 2) {
      const [a, b] = group as [Chunk, Chunk];
      const same = (c: Chunk) =>
        words
          .slice(c.from, c.to + 1)
          .map((w) => w.lower)
          .join(" ");
      if (same(a) === same(b) && !a.text) {
        out.push(a, { ...b, drop: true });
        continue;
      }
      const twoDigits = (c: Chunk) => c.text !== undefined || c.value >= 10;
      if (lang === "en" && b.value < 60 && twoDigits(b) && a.value >= 1 && a.value <= 12 && !a.text) {
        out.push({ from: a.from, to: b.to, value: 0, text: `${a.value}:${pad2(b.value)}`, single: false, forced: true });
        continue;
      }
      if (lang === "en" && a.value >= 10 && a.value <= 99 && b.value < 100 && twoDigits(b) && !a.text) {
        out.push({ from: a.from, to: b.to, value: a.value * 100 + b.value, text: String(a.value * 100 + b.value), single: false, forced: true });
        continue;
      }
    }
    for (const c of group) out.push({ ...c, keep: true });
  }
  return out;
}

/** As exceções: o que fica por extenso mesmo sendo número. */
function decide(words: Word[], chunks: Chunk[], spaced: (k: number) => boolean): void {
  const at = (k: number) => (k >= 0 && k < words.length ? words[k]!.lower : "");
  const prevOf = (c: Chunk) => (spaced(c.from) ? at(c.from - 1) : "");
  const nextOf = (c: Chunk, n = 1) => {
    for (let k = c.to + 1; k <= c.to + n; k++) if (!spaced(k)) return "";
    return at(c.to + n);
  };
  for (const c of chunks) {
    if (c.keep || c.drop || c.forced) continue;
    const prev = prevOf(c);
    const next = nextOf(c);
    const next2 = nextOf(c, 2);
    if (c.single && ALONE.has(c.word!)) {
      const counted =
        MONEY.has(next) ||
        (next === "por" && next2 === "cento") ||
        next === "percent" ||
        (SCALE.has(next) && c.word !== "zero") ||
        (c.word !== "mil" && c.word !== "zero" && next === "de" && MONTH.has(next2)) ||
        (c.word === "uma" && (prev === "à" || prev === "às")) ||
        (c.word === "um" && prev === "dia") ||
        (c.word === "one" && (prev === "at" || prev === "until" || prev === "by"));
      if (!counted) c.keep = true;
      continue;
    }
    // "os dois", "nós dois", "the two of us": o pronome, quando nada de substantivo vem depois.
    if (c.single && (c.word === "dois" || c.word === "duas") && PRONOUN_BEFORE_TWO.has(prev) && prev !== "às") {
      if (!next || AFTER_PRONOUN.has(next)) c.keep = true;
      continue;
    }
    if (c.single && c.word === "two" && prev === "the" && (!next || (next === "of" && /^(?:us|them|you)$/.test(next2)))) {
      c.keep = true;
      continue;
    }
    // "um ou dois", "one or two": uma estimativa, fica como foi dita.
    if ((prev === "ou" || prev === "or") && ALONE.has(at(c.from - 2)) && spaced(c.from - 1)) c.keep = true;
  }
}

// ------------------------------------------------------------ as formas escritas (também do que veio em algarismo)

const NUM_START = "(?<![\\p{L}\\p{N}\\p{Co}$,.])";
const NUM_END = "(?![\\p{L}\\p{N}])";
const rx = (s: string) => new RegExp(s, "giu");

const PERCENT = rx(`${NUM_START}(\\d+(?:[.,]\\d+)?)\\s+(?:por\\s+cento|percent)${NUM_END}`);
const DOLLARS = rx(
  `${NUM_START}(\\d+(?:[.,]\\d+)*)(\\s+(?:million|billion))?\\s+(?:dollars?|bucks)(?:\\s+and\\s+(\\d{1,2})\\s+cents?)?${NUM_END}`,
);
const A_HUNDRED = rx(`(?<![\\p{L}])a\\s+(hundred|thousand)(?=\\s+(?:dollars?|bucks|percent)${NUM_END})`);
const FIRST_OF_MONTH = rx(`${NUM_START}(?:1|primeiro)(\\s+de\\s+(?:${MONTHS_PT.replace(/ /g, "|")})${NUM_END})`);
const DAY_FIRST = rx(`(?<![\\p{L}])(dia\\s+)primeiro${NUM_END}(?!\\s+(?:lugar|de)${NUM_END})`);

// A hora em PT: "às 3" (ou "às três", já em algarismo), com o que vem depois dizendo que é hora.
const TIME_NEXT =
  "e|de|da|do|em|no|na|pra|para|com|que|porque|mas|ou|então|amanhã|hoje|ontem|aí|lá|certo|tá|ok|beleza|combinado|também|se|né|mesmo|até|às|eu|você|ele|ela|nós|a|o|vou|vamos|chego|passo|sem|em ponto";
const TIME_PT = rx(
  `(?<![\\p{L}\\p{N}\\p{Co}])(às|das|até\\s+às|até\\s+as|à)\\s+(\\d{1,2})(?:\\s+horas?)?(?:\\s+e\\s+(meia|\\d{1,2})(?:\\s+minutos?)?)?(?=$|[^\\p{L}\\p{N}\\s:,.]|[,.!?;:](?!\\d)|\\s+(?:${TIME_NEXT})${NUM_END}|\\s*$)`,
);

const ORDINAL_EN: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17,
  eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30,
};
const ORDINAL_WORD = `(?:(?:twenty|thirty)[\\s-](?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)|${Object.keys(ORDINAL_EN).join("|")}|\\d{1,2}(?:st|nd|rd|th)?)`;
const MONTH_EN = `(?:${MONTHS_EN.replace(/ /g, "|")})`;
const DATE_EN = rx(`(?<![\\p{L}])(${MONTH_EN})\\s+(${ORDINAL_WORD})${NUM_END}`);
const DATE_EN_OF = rx(`(?<![\\p{L}])(?:the\\s+)?(${ORDINAL_WORD})\\s+of\\s+(${MONTH_EN})${NUM_END}`);

function ordinalValue(s: string): number {
  const w = s.toLowerCase();
  const digits = /^(\d{1,2})/.exec(w);
  if (digits) return Number(digits[1]);
  const m = /^(twenty|thirty)[\s-](\w+)$/.exec(w);
  if (m) return (m[1] === "twenty" ? 20 : 30) + (ORDINAL_EN[m[2]!] ?? 0);
  return ORDINAL_EN[w] ?? 0;
}

const monthCase = (m: string) => m[0]!.toUpperCase() + m.slice(1).toLowerCase();

function writtenForms(text: string): string {
  let out = text.replace(A_HUNDRED, (_, w: string) => `one ${w}`);
  out = convertWords(out);
  out = out.replace(PERCENT, "$1%");
  out = out.replace(DOLLARS, (all, n: string, scale: string | undefined, cents: string | undefined) => {
    if (cents && (scale || /[.]/.test(n))) return all;
    return `$${n}${scale ?? ""}${cents ? `.${pad2(Number(cents))}` : ""}`;
  });
  out = out.replace(FIRST_OF_MONTH, "1º$1").replace(DAY_FIRST, "$11º");
  out = out.replace(TIME_PT, (all, prep: string, h: string, m: string | undefined) => {
    const hour = Number(h);
    const minutes = m === undefined ? 0 : /meia/i.test(m) ? 30 : Number(m);
    if (hour > 24 || minutes > 59 || (/^à$/i.test(prep) && hour !== 1)) return all;
    return `${prep} ${hour}h${m === undefined ? "" : pad2(minutes)}`;
  });
  out = out.replace(DATE_EN, (all, month: string, day: string) => {
    const d = ordinalValue(day);
    // "may" também é verbo: só com o ordinal ("may fifth"), nunca "may 2".
    if (d < 1 || d > 31 || (/^may$/i.test(month) && /^\d+$/.test(day))) return all;
    return `${monthCase(month)} ${d}`;
  });
  out = out.replace(DATE_EN_OF, (all, day: string, month: string) => {
    const d = ordinalValue(day);
    return d < 1 || d > 31 ? all : `${monthCase(month)} ${d}`;
  });
  return out;
}

/** Número por extenso vira algarismo, com a forma escrita de hora, data, dinheiro e porcentagem. */
export function spokenNumbers(text: string): string {
  return writtenForms(text);
}
