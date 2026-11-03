// O contrato entre o engine do Kiwi Notes (o main em Bun) e as UIs do AppEngine (T1192, ADR 0006).
//
// Uma UI só chama o main por `engine.invoke(cap, args)` com um destes nomes. Os nomes são estáveis: tirar ou mudar
// um é versão major (2.0.0); acrescentar é minor (1.1.0), e a UI testa com `engine.has(cap)`. Só dados locais: nada
// aqui sai do Mac.

import type { AliasWarning } from "../store/aliasCheck.ts";
import type { DictionaryTerm } from "../store/dictionary.ts";
import type { HistoryEntry, HistoryPage } from "../store/history.ts";
import type { Snippet } from "../store/snippets.ts";
import type { Backlink, Note, NoteMeta, SaveResult, SearchHit } from "../notes/vault.ts";

export type { AliasWarning, Backlink, DictionaryTerm, HistoryEntry, HistoryPage, Note, NoteMeta, SaveResult, SearchHit, Snippet };

/** A versão do contrato que este engine implementa (semver estrito). */
// 1.1.0 (T1316): as capacidades `notes.*` e o evento `notes.changed`, só acréscimos.
// 1.2.0 (T1320): `history.toNote`, o ditado vira nota. Só acréscimo.
export const UI_CONTRACT_VERSION = "1.2.0";
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
  /**
   * "Enviar para nota…" (1.2.0, T1320): o ditado vai para o fim da nota `path` ou, sem `path`, para uma nota nova em
   * `Caixa de entrada/`. Mandar de novo não duplica: `already` diz que o trecho já estava lá. Ditado que não existe
   * dá E_NOT_FOUND.
   */
  "history.toNote": { args: { id: string; path?: string }; result: { note: NoteMeta; created: boolean; already: boolean } };
  /** Só num gesto da pessoa (o botão de copiar). Até `CLIPBOARD_MAX_CHARS`. */
  "clipboard.write": { args: { text: string }; result: boolean };

  // ---------------------------------------------------------------- notas (1.1.0, T1316)
  // `path` é sempre relativo ao vault, POSIX, terminando em `.md`. Fora do vault (`..`, absoluto, link simbólico,
  // pasta com ponto) dá E_OUTSIDE_VAULT; nota que não existe, E_NOT_FOUND; destino que já existe, E_EXISTS.
  "notes.list": { args: Record<string, never>; result: { folders: string[]; notes: NoteMeta[] } };
  "notes.get": { args: { path: string }; result: Note };
  /** Com `baseVersion` velha (a nota mudou fora, no Obsidian), não escreve e devolve a nota de agora. */
  "notes.save": { args: { path: string; content: string; baseVersion: string }; result: SaveResult };
  /** Título repetido vira "Título 2". */
  "notes.create": { args: { folder?: string; title: string; content?: string }; result: Note };
  /** Renomeia ou move, e atualiza os [[links]] das outras notas. */
  "notes.rename": { args: { path: string; newPath: string }; result: { meta: NoteMeta; updatedLinks: number } };
  /** Vai para a Lixeira do macOS: não apaga. */
  "notes.delete": { args: { path: string }; result: true };
  "notes.search": { args: { query: string; limit?: number }; result: SearchHit[] };
  "notes.backlinks": { args: { path: string }; result: Backlink[] };
  /** Para qual nota um `[[link]]` aponta (regra do Obsidian), ou null. */
  "notes.resolve": { args: { link: string }; result: string | null };
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
  "history.toNote",
  "clipboard.write",
  "notes.list",
  "notes.get",
  "notes.save",
  "notes.create",
  "notes.rename",
  "notes.delete",
  "notes.search",
  "notes.backlinks",
  "notes.resolve",
] as const satisfies readonly UiCapability[];

/** Eventos que o engine manda às UIs (`engine.on(nome, fn)`). */
export interface UiEvents {
  /** Um ditado novo entrou no histórico. */
  "history.added": HistoryEntry;
  /** Notas criadas, mudadas, apagadas ou renomeadas, inclusive fora do app (o watcher do vault). */
  "notes.changed": { paths: string[] };
}

/** As janelas que viram UI do AppEngine. */
export const UI_WINDOWS = ["settings", "history", "notes"] as const;
export type UiWindow = (typeof UI_WINDOWS)[number];
