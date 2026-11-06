// L23: a correção logo depois de colar (o `paste.edited` do helper) entra no dicionário, sem perguntar (#4767).

import { learnedPair, withLearned } from "../cleanup/learn.ts";
import { toneFor } from "../cleanup/tone.ts";
import type { DictionaryTerm } from "../store/dictionary.ts";

export interface LearningStore {
  load(): Promise<DictionaryTerm[]>;
  save(terms: DictionaryTerm[]): Promise<DictionaryTerm[]>;
}

/** O dicionário salvo com a troca aprendida, ou `null` quando nada muda. Num terminal ou editor de código, nada. */
export async function learnFromEdit(store: LearningStore, edit: { pasted: string; edited: string; app?: string }): Promise<DictionaryTerm[] | null> {
  if (edit.app && toneFor(edit.app) === "literal") return null;
  const pair = learnedPair(edit.pasted, edit.edited);
  if (!pair) return null;
  const next = withLearned(await store.load(), pair);
  return next ? store.save(next) : null;
}
