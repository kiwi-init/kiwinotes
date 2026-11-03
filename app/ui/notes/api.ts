// De onde a janela Notas tira o vault: das capacidades `notes.*` do engine (contrato 1.1.0, A1), ou, só no Vite do
// navegador em dev, do vault de mentira (mock.ts). No app sem as capacidades (um engine antigo), não há vault: a janela
// diz isso em vez de mostrar notas inventadas.

import "../src/api.ts"; // o tipo do `window.engine`

import { MockVault } from "./mock.ts";
import type { NotesApi } from "./types.ts";

type Invoke = (cap: string, args?: unknown) => Promise<unknown>;

/** As capacidades pelo `window.engine.invoke`, com os nomes e os argumentos do contrato. */
export function engineNotes(invoke: Invoke, on: (name: string, fn: (payload: unknown) => void) => () => void): NotesApi {
  const call = <T>(cap: string, args: object = {}) => invoke(cap, args) as Promise<T>;
  return {
    list: () => call("notes.list"),
    get: (path) => call("notes.get", { path }),
    save: (path, content, baseVersion) => call("notes.save", { path, content, baseVersion }),
    create: (title, folder, content) => call("notes.create", { title, ...(folder ? { folder } : {}), ...(content ? { content } : {}) }),
    rename: (path, newPath) => call("notes.rename", { path, newPath }),
    delete: (path) => call("notes.delete", { path }),
    search: (query, limit) => call("notes.search", { query, ...(limit ? { limit } : {}) }),
    backlinks: (path) => call("notes.backlinks", { path }),
    resolve: (link) => call("notes.resolve", { link }),
    onChanged: (fn) => on("notes.changed", (payload) => fn((payload as { paths: string[] }).paths)),
  };
}

/** O vault desta janela, ou `null` quando o engine não tem as capacidades das notas. */
export function notesApi(): NotesApi | null {
  const engine = window.engine;
  if (engine) return engine.has("notes.list") ? engineNotes((c, a) => engine.invoke(c, a), (n, f) => engine.on(n, f)) : null;
  if (!import.meta.env?.DEV) return null;
  // Só no Vite do navegador: os testes de interação simulam por aqui uma edição feita fora (no Obsidian).
  const mock = new MockVault();
  (window as { __kiwiNotesMock?: MockVault }).__kiwiNotesMock = mock;
  return mock;
}
