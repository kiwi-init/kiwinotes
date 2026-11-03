// O contrato entre o engine do Kiwi Notes (o main em Bun) e as UIs do AppEngine (T1192, ADR 0006).
//
// Uma UI só chama o main por `engine.invoke(cap, args)` com um destes nomes. Os nomes são estáveis: tirar ou mudar
// um é versão major (2.0.0); acrescentar é minor (1.1.0), e a UI testa com `engine.has(cap)`. Só dados locais: nada
// aqui sai do Mac.

import type { AliasWarning } from "../store/aliasCheck.ts";
import type { DictionaryTerm } from "../store/dictionary.ts";
import type { HistoryEntry, HistoryPage } from "../store/history.ts";
import type { Snippet } from "../store/snippets.ts";

export type { AliasWarning, DictionaryTerm, HistoryEntry, HistoryPage, Snippet };

/** A versão do contrato que este engine implementa (semver estrito). */
export const UI_CONTRACT_VERSION = "1.0.0";
/** O que as UIs deste build pedem no `requiresContract` do ui.json. */
export const UI_REQUIRES_CONTRACT = "^1.0.0";
/** O esquema dos dados que as UIs escrevem. As UIs de hoje não guardam nada próprio: tudo passa pelo engine. */
export const UI_DATA_SCHEMA = 1;

/** O maior texto que `clipboard.write` aceita (um ditado longo cabe com folga). */
export const CLIPBOARD_MAX_CHARS = 100_000;

/** Argumentos e resultado de cada capacidade. */
export interface UiCapabilities {
  "dictionary.get": { args: Record<string, never>; result: DictionaryTerm[] };
  /** Devolve o que foi salvo (já limpo: sem vazios nem repetidos). */
  "dictionary.set": { args: { terms: DictionaryTerm[] }; result: DictionaryTerm[] };
  /** Os aliases que trocariam texto de verdade (#434), com o texto do aviso. */
  "dictionary.check": { args: { terms: DictionaryTerm[] }; result: (AliasWarning & { text: string })[] };
  "snippets.get": { args: Record<string, never>; result: Snippet[] };
  "snippets.set": { args: { snippets: Snippet[] }; result: Snippet[] };
  "history.search": { args: { query?: string; limit?: number; before?: string }; result: HistoryPage };
  "history.delete": { args: { id: string }; result: boolean };
  /** Só num gesto da pessoa (o botão de copiar). Até `CLIPBOARD_MAX_CHARS`. */
  "clipboard.write": { args: { text: string }; result: boolean };
}

export type UiCapability = keyof UiCapabilities;

export const UI_CAPABILITIES = [
  "dictionary.get",
  "dictionary.set",
  "dictionary.check",
  "snippets.get",
  "snippets.set",
  "history.search",
  "history.delete",
  "clipboard.write",
] as const satisfies readonly UiCapability[];

/** Eventos que o engine manda às UIs (`engine.on(nome, fn)`). */
export interface UiEvents {
  /** Um ditado novo entrou no histórico. */
  "history.added": HistoryEntry;
}

/** As janelas que viram UI do AppEngine. A Notas entra aqui quando nascer. */
export const UI_WINDOWS = ["settings", "history"] as const;
export type UiWindow = (typeof UI_WINDOWS)[number];
