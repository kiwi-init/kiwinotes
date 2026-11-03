// Aviso na tela do dicionário (#434): um alias que é uma palavra, um nome ou uma expressão comum troca texto de
// verdade. Com o alias "New York" → "IAM", toda vez que a pessoa disser "New York" sai "IAM" (T51, #431).
// O aviso não bloqueia: só diz o que vai acontecer, porque às vezes é isso mesmo que a pessoa quer.

import { existsSync, readFileSync } from "node:fs";

import type { DictionaryTerm } from "./dictionary.ts";
import { fold } from "./text.ts";

export type AliasWarningReason = "word" | "phrase" | "name";

export interface AliasWarning {
  term: string;
  alias: string;
  reason: AliasWarningReason;
  /** A palavra do alias que é um nome próprio (só no `name`). */
  word?: string;
}

export interface Lexicon {
  /** Palavras comuns (minúsculas no dicionário), já sem acento. */
  words: Set<string>;
  /** Nomes próprios: pessoas, cidades, países. */
  names: Set<string>;
  /** Expressões de mais de uma palavra ("new york"). */
  phrases: Set<string>;
}

// O macOS traz listas em inglês; as de português vão abaixo, curtas e só com o que mais aparece num ditado.
const PT_WORDS =
  "a o as os um uma uns umas de do da dos das em no na nos nas por pelo pela para pra pro com sem sob sobre entre ate até e ou mas que se como quando onde porque porquê então entao também tambem não nao sim já ja ainda só so muito muita pouco pouca mais menos bem mal aqui ali lá la agora hoje ontem amanhã amanha sempre nunca depois antes logo cedo tarde noite dia dias semana mês mes ano anos hora horas minuto minutos tempo vez vezes coisa coisas gente pessoa pessoas casa trabalho time equipe reunião reuniao projeto email e-mail mensagem link arquivo relatório relatorio documento problema erro teste sistema servidor cliente dado dados exame exames lote lotes ser estar ter haver fazer ir vir ver dar dizer falar poder querer saber ficar passar deixar levar trazer mandar enviar segue seguir certo certa claro ok beleza obrigado obrigada valeu oi olá ola tchau bom boa dia tarde noite eu você voce ele ela nós nos eles elas meu minha seu sua nosso nossa isso isto aquilo esse essa este esta aquele aquela tudo nada todo toda todos todas outro outra cada qual quem quanto quanta primeiro segundo terceiro último ultimo novo nova velho grande pequeno melhor pior mesmo mesma tipo assim sabe né ne aí ai daí dai cara pode vamos vai foi era tem tá ta está esta estou são sao é"
    .split(" ");
const PT_NAMES =
  "ana maria joão joao josé jose pedro paulo lucas gabriel rafael davi daniel bruno felipe gustavo mateus matheus marcos marcelo carlos eduardo fernando ricardo rodrigo thiago tiago andré andre antônio antonio francisco luiz luis julia júlia beatriz mariana larissa camila amanda fernanda letícia leticia juliana patrícia patricia aline bruna carla luana sofia alice laura helena manuela isabela brasil portugal argentina méxico mexico europa américa america são paulo rio janeiro brasília brasilia salvador fortaleza recife curitiba porto alegre belo horizonte manaus belém belem goiânia goiania florianópolis florianopolis campinas santos lisboa londres paris madri roma berlim tóquio toquio nova york"
    .split(" ");

const DICT = "/usr/share/dict";

let cached: Lexicon | undefined;

/** O léxico: as listas do macOS (`/usr/share/dict`) mais as de português daqui. Carregado uma vez. */
export function systemLexicon(dir = DICT): Lexicon {
  if (cached && dir === DICT) return cached;
  const words = new Set(PT_WORDS.map(fold));
  const names = new Set(PT_NAMES.map(fold));
  const phrases = new Set<string>(["sao paulo", "rio de janeiro", "porto alegre", "belo horizonte", "nova york", "new york"]);
  const read = (file: string) => (existsSync(`${dir}/${file}`) ? readFileSync(`${dir}/${file}`, "utf8").split("\n") : []);
  for (const line of read("web2")) {
    if (!line) continue;
    // Minúscula no dicionário é palavra comum; maiúscula é nome próprio ("Paris").
    (line[0] === line[0]!.toLowerCase() ? words : names).add(fold(line));
  }
  for (const line of read("propernames")) if (line) names.add(fold(line));
  for (const line of read("web2a")) if (line.includes(" ")) phrases.add(fold(line).replace(/\s+/g, " "));
  const lexicon = { words, names, phrases };
  if (dir === DICT) cached = lexicon;
  return lexicon;
}

const wordsOf = (s: string) => fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Por que um alias é arriscado, ou `undefined` quando ele é seguro (ex.: "cube control", "cubectl"). */
export function aliasRisk(alias: string, lexicon: Lexicon): { reason: AliasWarningReason; word?: string } | undefined {
  const parts = wordsOf(alias);
  if (!parts.length) return undefined;
  if (parts.length > 1 && lexicon.phrases.has(parts.join(" "))) return { reason: "phrase" };
  if (parts.length === 1) {
    const [w] = parts as [string];
    if (lexicon.names.has(w) && !lexicon.words.has(w)) return { reason: "name", word: w };
    if (lexicon.words.has(w) || lexicon.names.has(w)) return { reason: "word" };
    return undefined;
  }
  // Numa expressão, um nome próprio (que não é também palavra comum) já basta: "New York", "Ana Paula".
  const name = parts.find((w) => lexicon.names.has(w) && !lexicon.words.has(w));
  return name ? { reason: "name", word: name } : undefined;
}

export function aliasWarnings(terms: DictionaryTerm[], lexicon: Lexicon = systemLexicon()): AliasWarning[] {
  const out: AliasWarning[] = [];
  for (const t of terms) {
    for (const alias of t.aliases) {
      const risk = aliasRisk(alias, lexicon);
      if (risk) out.push({ term: t.term, alias, ...risk });
    }
  }
  return out;
}

/** O texto do aviso na tela. */
export function aliasWarningText(w: AliasWarning): string {
  const what = w.reason === "word" ? "é uma palavra comum" : w.reason === "phrase" ? "é uma expressão comum" : "tem um nome próprio";
  return `“${w.alias}” ${what}: sempre que você disser isso, vai sair “${w.term}”.`;
}
