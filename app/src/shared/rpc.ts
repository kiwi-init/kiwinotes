// RPC entre as janelas (React) e o processo principal (Bun), pelo Electrobun.
// Só dados locais: nada aqui sai do Mac.

import type { RPCSchema } from "electrobun/bun";

import type { AliasWarning } from "../store/aliasCheck.ts";
import type { DictionaryTerm } from "../store/dictionary.ts";
import type { HistoryEntry, HistoryPage } from "../store/history.ts";
import type { Snippet } from "../store/snippets.ts";

export type { AliasWarning, DictionaryTerm, HistoryEntry, HistoryPage, Snippet };

export type KiwiRPC = {
  bun: RPCSchema<{
    requests: {
      dictionaryGet: { params: Record<string, never>; response: DictionaryTerm[] };
      /** Devolve o que foi salvo (já limpo: sem vazios nem repetidos). */
      dictionarySet: { params: { terms: DictionaryTerm[] }; response: DictionaryTerm[] };
      /** Os aliases que trocariam texto de verdade (palavra, nome ou expressão comum, #434), com o texto do aviso. */
      dictionaryCheck: { params: { terms: DictionaryTerm[] }; response: (AliasWarning & { text: string })[] };
      snippetsGet: { params: Record<string, never>; response: Snippet[] };
      snippetsSet: { params: { snippets: Snippet[] }; response: Snippet[] };
      historySearch: { params: { query?: string; limit?: number; before?: string }; response: HistoryPage };
      historyDelete: { params: { id: string }; response: boolean };
      clipboardWrite: { params: { text: string }; response: boolean };
    };
    messages: Record<string, never>;
  }>;
  webview: RPCSchema<{
    requests: Record<string, never>;
    messages: {
      /** Um ditado novo entrou no histórico. */
      historyAdded: HistoryEntry;
    };
  }>;
};
