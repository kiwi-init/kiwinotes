// Os handlers do RPC das janelas (src/shared/rpc.ts), ligados aos arquivos locais.

import { BrowserView, Utils } from "electrobun/bun";

import type { KiwiRPC } from "../shared/rpc.ts";
import { session } from "./session.ts";
import { stores } from "./stores.ts";

export function createRpc() {
  return BrowserView.defineRPC<KiwiRPC>({
    maxRequestTime: 10_000,
    handlers: {
      requests: {
        dictionaryGet: () => stores.dictionary.load(),
        dictionarySet: async ({ terms }) => {
          const saved = await stores.dictionary.save(terms);
          // O STT e a limpeza passam a usar o dicionário novo já no próximo ditado.
          void session.get()?.dictionaryChanged(saved);
          return saved;
        },
        snippetsGet: () => stores.snippets.load(),
        snippetsSet: async ({ snippets }) => {
          const saved = await stores.snippets.save(snippets);
          session.get()?.snippetsChanged(saved);
          return saved;
        },
        historySearch: (params) => stores.history.search(params),
        historyDelete: ({ id }) => stores.history.delete(id),
        clipboardWrite: ({ text }) => {
          Utils.clipboardWriteText(text);
          return true;
        },
      },
    },
  });
}
