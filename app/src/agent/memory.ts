// A memória do agente (spec #11469, T11665): o que ele sabe sobre a pessoa, num arquivo legível do cofre,
// `.kiwi/agente/sobre-mim.md`, uma linha por fato. O agente escreve pelas ferramentas `memory_remember` e
// `memory_forget`; a pessoa vê e muda tudo em Ajustes › Agente › Memória (T11668).
//
// - **Texto legível:** um título, uma frase do que é, e um fato por linha (`- fato`). A pessoa pode editar à mão: uma
//   linha que não é fato (um parágrafo, um título) não vai ao agente, mas fica onde está (spec #12749).
// - **No máximo 60 fatos** (`MEMORY_MAX`), cada um com até 300 caracteres: passando disso, o agente tem de esquecer um
//   antes de anotar outro. Um fato escrito à mão além do limite fica no arquivo, sem ir ao agente, e o agente não muda a
//   memória até a pessoa arrumar (spec #12749).
// - **Os mesmos bytes para a mesma memória,** no arquivo e no começo fixo do pedido (o cache do agente, #11084).

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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

/** Um fato escrito à mão que o agente não lê: passa de 300 caracteres, ou vem depois dos 60 (spec #12749). */
export interface SkippedFact {
  text: string;
  reason: "long" | "over";
}

/** O arquivo da memória lido linha a linha (spec #12749). */
export interface MemoryFile {
  /** Os fatos que vão ao agente: até 60, cada um com até 300 caracteres, sem repetir, na ordem do arquivo. */
  facts: string[];
  /** Os fatos que ficam no arquivo sem ir ao agente. */
  skipped: SkippedFact[];
  /** As linhas escritas que não são fato (parágrafos, títulos), fora o cabeçalho do Kiwi. */
  outside: number;
}

const FACT_LINE = /^\s*[-*]\s+(.+)$/;
const HEADER_LINES = new Set(HEADER.filter(Boolean));

type LineKind = { kind: "fact"; fact: string; key: string } | { kind: "dup"; key: string } | { kind: "skipped"; fact: string; reason: SkippedFact["reason"] } | { kind: "other"; written: boolean };

/** O que cada linha é, na ordem do arquivo: os 60 primeiros fatos válidos são fatos; o resto fica de fora. */
function classify(lines: readonly string[]): LineKind[] {
  const seen = new Set<string>();
  return lines.map((line): LineKind => {
    const m = FACT_LINE.exec(line);
    const fact = m ? cleanFact(m[1]!) : "";
    if (!m || !fact) return { kind: "other", written: line.trim() !== "" && !HEADER_LINES.has(line.trim()) };
    if (fact.length > FACT_MAX_CHARS) return { kind: "skipped", fact, reason: "long" };
    const key = factKey(fact);
    if (seen.has(key)) return { kind: "dup", key };
    if (seen.size >= MEMORY_MAX) return { kind: "skipped", fact, reason: "over" };
    seen.add(key);
    return { kind: "fact", fact, key };
  });
}

/** O arquivo da memória: os fatos que vão ao agente, os que ficam de fora e as outras linhas (spec #12749). */
export function inspectMemory(text: string): MemoryFile {
  const out: MemoryFile = { facts: [], skipped: [], outside: 0 };
  for (const k of classify(text.split("\n"))) {
    if (k.kind === "fact") out.facts.push(k.fact);
    else if (k.kind === "skipped") out.skipped.push({ text: k.fact, reason: k.reason });
    else if (k.kind === "other" && k.written) out.outside++;
  }
  return out;
}

/** Os fatos do arquivo que vão ao agente, na ordem dele. */
export function parseMemory(text: string): string[] {
  return inspectMemory(text).facts;
}

/** O arquivo para estes fatos: sempre os mesmos bytes. */
export function formatMemory(facts: readonly string[]): string {
  return [...HEADER, ...facts.map((f) => `- ${cleanFact(f)}`), ""].join("\n");
}

/** Os fatos limpos, sem repetir, sem vazio, até o limite: o que a memória pode guardar. */
function normalizeFacts(facts: readonly string[]): string[] {
  return parseMemory(formatMemory(facts.map(cleanFact).filter((f) => f && f.length <= FACT_MAX_CHARS)));
}

/**
 * O arquivo novo a partir do que está no cofre (spec #12749): só as linhas dos fatos mudam. Um fato que saiu tem a linha
 * apagada. Um fato novo entra no lugar do fato que saiu na mesma posição da lista (o fato editado em Ajustes fica onde
 * estava); senão, logo depois do fato que vem antes dele (o esquecido volta no lugar, e o anotado vai para o fim). O resto (o cabeçalho, os parágrafos, os títulos e os fatos que o agente não lê) fica onde está.
 * `keepSkipped`: os fatos de fora que ficam (Ajustes apaga um deles); sem a lista, ficam todos.
 */
export function mergeMemory(existing: string | null, facts: readonly string[], keepSkipped: readonly string[] | null = null): string {
  const wanted = normalizeFacts(facts);
  if (existing === null) return formatMemory(wanted);
  const byKey = new Map(wanted.map((f) => [factKey(f), f]));
  const keep = keepSkipped === null ? null : new Set(keepSkipped.map(cleanFact));
  const lines = existing.split("\n");
  const kinds = classify(lines);
  const out: string[] = [];
  /** Onde está, em `out`, a linha de cada fato que ficou. */
  const at = new Map<string, number>();
  /** Onde estava, em `out`, a linha de cada fato que saiu, pela posição dele na lista antiga. */
  const slots = new Map<number, number>();
  let oldIndex = 0;
  /** A última linha de fato de qualquer tipo, para um fato novo sem vizinho na lista. */
  let lastFactLine = -1;
  lines.forEach((line, i) => {
    const k = kinds[i]!;
    if (k.kind === "fact") {
      const next = byKey.get(k.key);
      const index = oldIndex++;
      if (next === undefined) {
        slots.set(index, out.length);
        return;
      }
      at.set(k.key, out.length);
      lastFactLine = out.length;
      out.push(next === k.fact ? line : `- ${next}`);
    } else if (k.kind === "dup") {
      if (!byKey.has(k.key)) return;
      lastFactLine = out.length;
      out.push(line);
    } else if (k.kind === "skipped") {
      if (keep && !keep.has(k.fact)) return;
      lastFactLine = out.length;
      out.push(line);
    } else out.push(line);
  });
  const insert = (pos: number, line: string) => {
    out.splice(pos, 0, line);
    for (const [key, p] of at) if (p >= pos) at.set(key, p + 1);
    for (const [index, p] of slots) if (p >= pos) slots.set(index, p + 1);
    if (lastFactLine >= pos) lastFactLine++;
  };
  let prev: number | null = null;
  wanted.forEach((f, index) => {
    const key = factKey(f);
    const here = at.get(key);
    if (here !== undefined) {
      prev = here;
      return;
    }
    const slot = slots.get(index);
    slots.delete(index);
    let pos: number;
    if (slot !== undefined) pos = slot;
    else if (prev !== null) pos = prev + 1;
    else if (at.size) pos = Math.min(...at.values());
    else if (lastFactLine >= 0) pos = lastFactLine + 1;
    else {
      // Nenhuma linha de fato ainda: os fatos vão no fim do texto, depois de uma linha em branco.
      while (out.length && out.at(-1)!.trim() === "") out.pop();
      if (out.length) out.push("");
      pos = out.length;
      out.push("");
    }
    insert(pos, `- ${f}`);
    at.set(key, pos);
    prev = pos;
  });
  const text = out.join("\n");
  return text.endsWith("\n") ? text : `${text}\n`;
}

/**
 * O arquivo da memória no cofre. Sem o arquivo, vazio. **Qualquer outro erro sobe** (`E_MEMORY_UNREADABLE`: sem
 * permissão, uma pasta no lugar, um arquivo do iCloud que não baixou): quem ia gravar não grava por cima de fatos que
 * não leu (revisão do T11665).
 */
export function readMemoryFile(vaultRoot: string): MemoryFile {
  const text = readMemoryText(vaultRoot);
  return text === null ? { facts: [], skipped: [], outside: 0 } : inspectMemory(text);
}

/** Os fatos do cofre que vão ao agente. */
export function readMemory(vaultRoot: string): string[] {
  return readMemoryFile(vaultRoot).facts;
}

function readMemoryText(vaultRoot: string): string | null {
  const file = path.join(vaultRoot, MEMORY_FILE);
  try {
    return readFileSync(file, "utf8");
  } catch (e) {
    if ((e as { code?: string })?.code === "ENOENT") return null;
    throw new MemoryError("E_MEMORY_UNREADABLE", `o Kiwi não conseguiu ler a memória (${MEMORY_FILE}): nada foi mudado nela`);
  }
}

/**
 * Grava a memória (escrita atômica): só as linhas dos fatos mudam, o resto do que a pessoa escreveu fica (spec #12749).
 * Sem o arquivo, ele nasce com o cabeçalho. `keepSkipped`: veja `mergeMemory`.
 */
export function writeMemory(vaultRoot: string, facts: readonly string[], keepSkipped: readonly string[] | null = null): MemoryFile {
  const text = mergeMemory(readMemoryText(vaultRoot), facts, keepSkipped);
  const file = path.join(vaultRoot, MEMORY_FILE);
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
  return inspectMemory(text);
}

export class MemoryError extends Error {
  constructor(
    readonly code: "E_MEMORY_FULL" | "E_MEMORY_OVER" | "E_NOT_FOUND" | "E_BAD_ARGS" | "E_MEMORY_UNREADABLE",
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
