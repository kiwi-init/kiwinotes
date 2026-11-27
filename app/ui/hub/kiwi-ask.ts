// A porta de fora para o campo de pedido do gato (T32156, spec #32129): a busca do Kiwi (⌘K) do Calendário abre o
// mesmo campo do canto, com o texto já escrito, em vez de um segundo caminho até o agente. O gato (`CatMount`) se
// registra enquanto existe: sem o agente ligado ou sem o gato na tela, ninguém atende, e a busca não aparece.

import { useSyncExternalStore } from "react";

type Opener = (draft?: string) => void;

let opener: Opener | null = null;
const subs = new Set<() => void>();
const changed = () => subs.forEach((f) => f());

/** O gato se registra; a volta tira o registro (só se ainda for o dele). */
export function provideKiwiAsk(fn: Opener): () => void {
  opener = fn;
  changed();
  return () => {
    if (opener !== fn) return;
    opener = null;
    changed();
  };
}

/** Abre o campo do gato; `false` quando ninguém atende. */
export function openKiwiAsk(draft?: string): boolean {
  if (!opener) return false;
  opener(draft);
  return true;
}

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => void subs.delete(f);
};

/** Se há um gato para atender agora. */
export const useKiwiAskAvailable = (): boolean => useSyncExternalStore(subscribe, () => opener !== null, () => false);
