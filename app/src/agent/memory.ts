// A memória do agente (spec #11469, T11665): o que ele sabe sobre a pessoa, num arquivo legível do cofre,
// `.kiwi/agente/sobre-mim.md`, uma linha por fato. O agente escreve pelas ferramentas `memory_remember` e
// `memory_forget`; a pessoa vê e muda tudo em Ajustes › Agente › Memória (T11668).
//
// - **Texto legível:** um título, uma frase do que é, e um fato por linha (`- fato`). Uma linha que não começa com
//   `- ` é ignorada na leitura e some na próxima gravação; a pessoa pode editar o arquivo à mão.
// - **No máximo 60 fatos** (`MEMORY_MAX`): passando disso, o agente tem de esquecer um antes de anotar outro.
// - **Os mesmos bytes para a mesma memória,** no arquivo e no começo fixo do pedido (o cache do agente, #11084).

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export const MEMORY_FILE = path.join(".kiwi", "agente", "sobre-mim.md");
/** O máximo de fatos na memória (spec #11469). */
export const MEMORY_MAX = 60;
/** O maior fato, em caracteres: uma linha, não um texto. */
export const FACT_MAX_CHARS = 300;

const HEADER = [
  "# O que o agente sabe sobre você",
  "",
  "O agente do Kiwi escreve aqui o que aprende sobre você, um fato por linha. Você vê e muda tudo em Ajustes › Agente › Memória, ou aqui mesmo.",
  "",
];

/** Um fato numa linha só, sem espaços sobrando. */
export const cleanFact = (fact: string) => fact.replace(/\s+/g, " ").trim();
/** Para comparar dois fatos: sem diferença de maiúscula, acento nem pontuação do fim. */
export const factKey = (fact: string) =>
  cleanFact(fact)
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[.!;,]+$/, "");

/** Os fatos do arquivo, na ordem dele. */
export function parseMemory(text: string): string[] {
  const facts: string[] = [];
  const seen = new Set<string>();
  for (const line of text.split("\n")) {
    const m = /^\s*[-*]\s+(.+)$/.exec(line);
    if (!m) continue;
    const fact = cleanFact(m[1]!).slice(0, FACT_MAX_CHARS);
    if (!fact || seen.has(factKey(fact))) continue;
    seen.add(factKey(fact));
    facts.push(fact);
  }
  return facts.slice(0, MEMORY_MAX);
}

/** O arquivo para estes fatos: sempre os mesmos bytes. */
export function formatMemory(facts: readonly string[]): string {
  return [...HEADER, ...facts.map((f) => `- ${cleanFact(f)}`), ""].join("\n");
}

export function readMemory(vaultRoot: string): string[] {
  const file = path.join(vaultRoot, MEMORY_FILE);
  if (!existsSync(file)) return [];
  try {
    return parseMemory(readFileSync(file, "utf8"));
  } catch {
    return [];
  }
}

/** Grava a memória inteira (escrita atômica). Sem fatos, o arquivo fica com o cabeçalho só. */
export function writeMemory(vaultRoot: string, facts: readonly string[]): string[] {
  const clean = parseMemory(formatMemory(facts));
  const file = path.join(vaultRoot, MEMORY_FILE);
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, formatMemory(clean));
  renameSync(tmp, file);
  return clean;
}

export class MemoryError extends Error {
  constructor(
    readonly code: "E_MEMORY_FULL" | "E_NOT_FOUND" | "E_BAD_ARGS",
    message: string,
  ) {
    super(message);
  }
}

/** Anota um fato. Um fato que já está lá não entra de novo (`added: false`). */
export function rememberFact(facts: readonly string[], fact: string): { facts: string[]; added: boolean; index: number } {
  const f = cleanFact(fact);
  if (!f) throw new MemoryError("E_BAD_ARGS", "o fato está vazio");
  if (f.length > FACT_MAX_CHARS) throw new MemoryError("E_BAD_ARGS", `o fato passa de ${FACT_MAX_CHARS} caracteres: anote uma linha curta`);
  const at = facts.findIndex((x) => factKey(x) === factKey(f));
  if (at >= 0) return { facts: [...facts], added: false, index: at };
  if (facts.length >= MEMORY_MAX)
    throw new MemoryError("E_MEMORY_FULL", `a memória já tem ${MEMORY_MAX} fatos: esqueça um com memory_forget antes de anotar outro`);
  return { facts: [...facts, f], added: true, index: facts.length };
}

/** Esquece um fato (pelo texto, sem diferença de maiúscula nem acento). */
export function forgetFact(facts: readonly string[], fact: string): { facts: string[]; removed: string; index: number } {
  const at = facts.findIndex((x) => factKey(x) === factKey(fact));
  if (at < 0) throw new MemoryError("E_NOT_FOUND", "esse fato não está na memória; os fatos vão no começo do pedido, escritos como estão");
  return { facts: facts.filter((_, i) => i !== at), removed: facts[at]!, index: at };
}

/**
 * A memória no começo fixo do pedido: os fatos como estão, sempre os mesmos bytes. Sem fatos, nada (o começo do
 * pedido fica como antes da memória).
 */
export function memoryText(facts: readonly string[]): string {
  if (!facts.length) return "";
  return [
    "[O que você sabe sobre a pessoa (a memória do Kiwi). Para anotar ou esquecer um fato, use memory_remember e memory_forget:",
    ...facts.map((f) => `- ${cleanFact(f)}`),
    "]",
    "",
    "",
  ].join("\n");
}

/** As instruções da pessoa para o agente (spec #11469, T11667): um texto de Ajustes › Agente, até 2.000 caracteres. */
export const INSTRUCTIONS_MAX = 2000;
/** O glossário vai com até tantos termos (o dicionário do ditado pode ser grande). */
export const GLOSSARY_MAX = 200;

/** As instruções no começo fixo do pedido: o texto da pessoa como está. Sem texto, nada. */
export function instructionsText(text: string): string {
  const t = text.replace(/\r\n?/g, "\n").trim().slice(0, INSTRUCTIONS_MAX);
  if (!t) return "";
  return `[As instruções da pessoa para você (Ajustes › Agente). Siga sempre:\n${t}\n]\n\n`;
}

const fold = (t: string) => t.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();

/**
 * O glossário do ditado no começo fixo do pedido (T11667): só os termos, na ordem do dicionário, para o agente
 * escrever certo. `request`: o modo econômico manda só os termos que aparecem no pedido.
 */
export function glossaryText(terms: readonly string[], request?: string): string {
  const seen = new Set<string>();
  const list: string[] = [];
  const asked = request === undefined ? null : fold(request);
  for (const raw of terms) {
    const term = raw.replace(/[\]\n]/g, " ").replace(/\s+/g, " ").trim();
    if (!term || seen.has(fold(term))) continue;
    if (asked !== null && !asked.includes(fold(term))) continue;
    seen.add(fold(term));
    list.push(term);
    if (list.length >= GLOSSARY_MAX) break;
  }
  if (!list.length) return "";
  return `[O glossário da pessoa: escreva estes termos assim. ${list.join("; ")}]\n\n`;
}
