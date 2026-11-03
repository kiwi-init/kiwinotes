// Os handlers do RPC das janelas (src/shared/rpc.ts), ligados aos arquivos locais.

import { BrowserView, Utils } from "electrobun/bun";

import type { KiwiRPC } from "../shared/rpc.ts";
import { stores } from "./stores.ts";

export function createRpc() {
  return BrowserView.defineRPC<KiwiRPC>({
    maxRequestTime: 10_000,
    handlers: {
      requests: {
        dictionaryGet: () => stores.dictionary.load(),
        dictionarySet: ({ terms }) => stores.dictionary.save(terms),
        snippetsGet: () => stores.snippets.load(),
        snippetsSet: ({ snippets }) => stores.snippets.save(snippets),
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
