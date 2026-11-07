// L26 (T6910, escolha A do harry no #6906): a correção logo depois de colar (o `paste.edited` do helper) vira uma
// pergunta no cartão do helper, já na 1ª vez: "Adicionar ao dicionário? Pax → PACS". "Adicionar" grava, "Agora não"
// guarda a troca para nunca perguntar de novo. Antes (L23, #4767) aprendia calado, na 2ª vez.

import path from "node:path";

import { type LearnedPair, learnedPair, withLearned } from "../cleanup/learn.ts";
import { toneFor } from "../cleanup/tone.ts";
import type { DictionaryTerm } from "../store/dictionary.ts";
import { readJson, writeJson } from "../store/files.ts";
import { fold } from "../store/text.ts";

export interface LearningStore {
  readonly file: string;
  load(): Promise<DictionaryTerm[]>;
  save(terms: DictionaryTerm[]): Promise<DictionaryTerm[]>;
}

/** As trocas recusadas guardadas: as mais antigas saem primeiro. */
const MAX_DECLINED = 500;

/** A versão 1 era a das candidatas da L23 (contagem até a 2ª vez); ao ler, ela é ignorada. */
interface DeclinedFile {
  version: 2;
  declined: Record<string, string>;
}

/** O arquivo das trocas que a pessoa recusou, ao lado do `dictionary.json`. */
export const declinedFile = (store: LearningStore) => path.join(path.dirname(store.file), "dictionary-candidates.json");

const keyOf = (pair: LearnedPair) => `${fold(pair.from)}→${pair.to}`;

async function readDeclined(store: LearningStore): Promise<Record<string, string>> {
  const data = await readJson<DeclinedFile | { version: 1 }>(declinedFile(store));
  return data?.version === 2 ? { ...data.declined } : {};
}

/**
 * A troca a perguntar, ou `null` quando não há o que perguntar: não é a troca de um termo, é num terminal ou editor
 * de código, o dicionário já tem, ou a pessoa já disse "Agora não" para ela.
 */
export async function offerFromEdit(
  store: LearningStore,
  edit: { pasted: string; edited: string; app?: string },
): Promise<LearnedPair | null> {
  if (edit.app && toneFor(edit.app) === "literal") return null;
  const pair = learnedPair(edit.pasted, edit.edited);
  if (!pair) return null;
  if (!withLearned(await store.load(), pair)) return null;
  if ((await readDeclined(store))[keyOf(pair)]) return null;
  return pair;
}

/** "Adicionar": o dicionário salvo com a troca, ou `null` se ele já tinha. */
export async function acceptOffer(store: LearningStore, pair: LearnedPair): Promise<DictionaryTerm[] | null> {
  const next = withLearned(await store.load(), pair);
  return next ? store.save(next) : null;
}

/** "Agora não": a troca não é oferecida de novo. */
export async function declineOffer(store: LearningStore, pair: LearnedPair, now: () => Date = () => new Date()): Promise<void> {
  const declined = await readDeclined(store);
  declined[keyOf(pair)] = now().toISOString();
  const kept = Object.entries(declined).sort((a, b) => b[1].localeCompare(a[1])).slice(0, MAX_DECLINED);
  await writeJson(declinedFile(store), { version: 2, declined: Object.fromEntries(kept) } satisfies DeclinedFile);
}

/** O que o fluxo manda ao helper: só o `learn.offer`, e se ele mostrou. */
export type SendOffer = (offer: { type: "learn.offer"; from: string; to: string }) => Promise<{ ok: boolean } | undefined>;

/**
 * O caminho inteiro do lado do app: a correção vira oferta no cartão, e a resposta do cartão grava, recusa ou deixa
 * para a próxima. Só vale a resposta da troca oferecida por último (uma mais nova a substitui no cartão).
 */
export class CorrectionOffers {
  private offered: LearnedPair | null = null;

  constructor(
    private readonly store: LearningStore,
    private readonly send: SendOffer,
    private readonly learned: (terms: DictionaryTerm[]) => Promise<void>,
  ) {}

  /** O `paste.edited`: true quando o cartão foi mostrado. */
  async edited(edit: { pasted: string; edited: string; app?: string }): Promise<boolean> {
    const pair = await offerFromEdit(this.store, edit);
    if (!pair) return false;
    const shown = await this.send({ type: "learn.offer", from: pair.from, to: pair.to }).catch(() => undefined);
    if (!shown?.ok) return false;
    this.offered = pair;
    return true;
  }

  /** O `learn.answered`: o que aconteceu com a troca, ou `null` se a resposta não era da oferta de agora. */
  async answered(answer: { from: string; to: string; answer: "add" | "notNow" | "expired" }): Promise<"learned" | "declined" | "expired" | null> {
    const pair = this.offered;
    if (!pair || pair.from !== answer.from || pair.to !== answer.to) return null;
    this.offered = null;
    if (answer.answer === "notNow") {
      await declineOffer(this.store, pair);
      return "declined";
    }
    if (answer.answer === "expired") return "expired";
    const saved = await acceptOffer(this.store, pair);
    if (saved) await this.learned(saved);
    return "learned";
  }
}
