// O lado da janela do RPC (src/shared/rpc.ts). Fora do app (Vite no navegador),
// não há Electrobun: as chamadas falham e as telas mostram o estado vazio.

import { Electroview } from "electrobun/view";

import type { HistoryEntry, KiwiRPC } from "../../src/shared/rpc.ts";

export type { DictionaryTerm, HistoryEntry, HistoryPage, Snippet } from "../../src/shared/rpc.ts";

const added = new Set<(e: HistoryEntry) => void>();

function connect() {
  try {
    const rpc = Electroview.defineRPC<KiwiRPC>({
      maxRequestTime: 10_000,
      handlers: { messages: { historyAdded: (e) => added.forEach((fn) => fn(e)) } },
    });
    new Electroview({ rpc });
    return rpc;
  } catch {
    return null;
  }
}

const rpc = connect();

function need() {
  if (!rpc) throw new Error("sem o app (Electrobun) por perto");
  return rpc.request;
}

export const api = {
  dictionary: {
    get: () => need().dictionaryGet({}),
    set: (terms: Parameters<NonNullable<typeof rpc>["request"]["dictionarySet"]>[0]["terms"]) => need().dictionarySet({ terms }),
    check: (terms: Parameters<NonNullable<typeof rpc>["request"]["dictionaryCheck"]>[0]["terms"]) => need().dictionaryCheck({ terms }),
  },
  snippets: {
    get: () => need().snippetsGet({}),
    set: (snippets: Parameters<NonNullable<typeof rpc>["request"]["snippetsSet"]>[0]["snippets"]) => need().snippetsSet({ snippets }),
  },
  history: {
    search: (params: { query?: string; limit?: number; before?: string }) => need().historySearch(params),
    delete: (id: string) => need().historyDelete({ id }),
    onAdded(fn: (e: HistoryEntry) => void) {
      added.add(fn);
      return () => {
        added.delete(fn);
      };
    },
  },
  copy: (text: string) => need().clipboardWrite({ text }),
};
