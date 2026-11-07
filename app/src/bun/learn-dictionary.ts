// L23: a correção logo depois de colar (o `paste.edited` do helper) entra no dicionário, sem perguntar (#4767), na
// 2ª vez que a mesma troca aparece (review do #266). Uma troca de uma vez só (o "gato" que era "fato" naquela frase)
// fica só como candidata, e nunca vira regra; um termo que o STT erra sempre ("Pax") aprende na 2ª.

import path from "node:path";

import { learnedPair, withLearned } from "../cleanup/learn.ts";
import { toneFor } from "../cleanup/tone.ts";
import type { DictionaryTerm } from "../store/dictionary.ts";
import { readJson, writeJson } from "../store/files.ts";
import { fold } from "../store/text.ts";

export interface LearningStore {
  readonly file: string;
  load(): Promise<DictionaryTerm[]>;
  save(terms: DictionaryTerm[]): Promise<DictionaryTerm[]>;
}

/** Quantas vezes a mesma troca precisa aparecer para virar dicionário. */
export const TIMES_TO_LEARN = 2;
/** As candidatas guardadas: as mais antigas saem primeiro. */
const MAX_CANDIDATES = 200;

interface Candidate {
  count: number;
  at: string;
}
interface CandidatesFile {
  version: 1;
  candidates: Record<string, Candidate>;
}

/** O arquivo das trocas candidatas, ao lado do `dictionary.json`. */
export const candidatesFile = (store: LearningStore) => path.join(path.dirname(store.file), "dictionary-candidates.json");

/**
 * O dicionário salvo com a troca aprendida, ou `null` quando nada muda: a troca não é de um termo, ainda é a 1ª vez,
 * ou já está no dicionário. Num terminal ou editor de código, nada.
 */
export async function learnFromEdit(
  store: LearningStore,
  edit: { pasted: string; edited: string; app?: string },
  now: () => Date = () => new Date(),
): Promise<DictionaryTerm[] | null> {
  if (edit.app && toneFor(edit.app) === "literal") return null;
  const pair = learnedPair(edit.pasted, edit.edited);
  if (!pair) return null;
  const file = candidatesFile(store);
  const data = await readJson<CandidatesFile>(file);
  const candidates: Record<string, Candidate> = { ...(data?.candidates ?? {}) };
  const key = `${fold(pair.from)}→${pair.to}`;
  const count = (candidates[key]?.count ?? 0) + 1;
  if (count < TIMES_TO_LEARN) {
    candidates[key] = { count, at: now().toISOString() };
    const kept = Object.entries(candidates).sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, MAX_CANDIDATES);
    await writeJson(file, { version: 1, candidates: Object.fromEntries(kept) } satisfies CandidatesFile);
    return null;
  }
  delete candidates[key];
  await writeJson(file, { version: 1, candidates } satisfies CandidatesFile);
  const next = withLearned(await store.load(), pair);
  return next ? store.save(next) : null;
}
