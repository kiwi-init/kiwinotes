// O lado da UI do contrato do AppEngine (src/shared/ui-contract.ts, T1192). A UI só fala com o main por
// `window.engine.invoke(cap, args)`, que o preload da janela põe na página. Fora do app (Vite no navegador) não há
// `window.engine`: as chamadas falham e as telas mostram o estado vazio.

import type { HistoryEntry, UiCapabilities, UiCapability, UiEvents } from "../../src/shared/ui-contract.ts";

export type { DictionaryTerm, HistoryEntry, HistoryPage, NoteMeta, SearchHit, Snippet } from "../../src/shared/ui-contract.ts";

interface Engine {
  invoke(cap: string, args?: unknown): Promise<unknown>;
  has(cap: string): boolean;
  ready(info?: unknown): void;
  reportError(error: unknown): void;
  on(name: string, listener: (payload: unknown) => void): () => void;
}

declare global {
  interface Window {
    /** O `window.engine` do AppEngine (browser/appengine/page.ts do devkit), pelo preload. */
    engine?: Engine;
  }
}

function need(): Engine {
  if (!window.engine) throw new Error("sem o app (AppEngine) por perto");
  return window.engine;
}

function invoke<C extends UiCapability>(cap: C, args: UiCapabilities[C]["args"]): Promise<UiCapabilities[C]["result"]> {
  return need().invoke(cap, args) as Promise<UiCapabilities[C]["result"]>;
}

function on<E extends keyof UiEvents>(name: E, fn: (payload: UiEvents[E]) => void): () => void {
  return window.engine?.on(name, (payload) => fn(payload as UiEvents[E])) ?? (() => {});
}

/** A UI pode ser usada: o engine conta o boot como bom (até aqui, uma falha volta para a UI anterior). */
export function engineReady(): void {
  window.engine?.ready();
}

/** Erros que não chegam ao window.onerror (os que um error boundary pegou). */
export function reportError(error: unknown): void {
  window.engine?.reportError(error);
}

/** O engine tem esta capacidade (uma UI nova num engine velho esconde o que ele não sabe fazer). */
export const has = (cap: UiCapability) => window.engine?.has(cap) ?? false;

export const api = {
  dictionary: {
    get: () => invoke("dictionary.get", {}),
    set: (terms: UiCapabilities["dictionary.set"]["args"]["terms"]) => invoke("dictionary.set", { terms }),
    check: (terms: UiCapabilities["dictionary.check"]["args"]["terms"]) => invoke("dictionary.check", { terms }),
  },
  settings: {
    get: () => invoke("settings.get", {}),
    set: (patch: UiCapabilities["settings.set"]["args"]) => invoke("settings.set", patch),
  },
  snippets: {
    get: () => invoke("snippets.get", {}),
    set: (snippets: UiCapabilities["snippets.set"]["args"]["snippets"]) => invoke("snippets.set", { snippets }),
  },
  history: {
    search: (params: UiCapabilities["history.search"]["args"]) => invoke("history.search", params),
    delete: (id: string) => invoke("history.delete", { id }),
    onAdded: (fn: (e: HistoryEntry) => void) => on("history.added", fn),
    /** "Enviar para nota…" (T1320): sem `path`, uma nota nova em Caixa de entrada/. */
    toNote: (id: string, path?: string) => invoke("history.toNote", path ? { id, path } : { id }),
  },
  notes: {
    list: () => invoke("notes.list", {}),
    search: (query: string) => invoke("notes.search", { query, limit: 12 }),
  },
  /** A seção Sobre (T2386): a versão, o canal e as atualizações. */
  app: {
    about: () => invoke("app.about", {}),
  },
  updates: {
    /** Checa na hora; resolve quando a checagem termina (pronta, na última versão ou com erro). */
    check: () => invoke("updates.check", {}),
    /** "Atualizar e reiniciar": o app fecha, troca e reabre. Se resolver, é que não reiniciou. */
    apply: () => invoke("updates.apply", {}),
    onStatus: (fn: (v: UiEvents["updates.status"]) => void) => on("updates.status", fn),
  },
  /** O hub (T2121): a seção pedida antes de ele abrir, e as que chegam com ele aberto. */
  hub: {
    section: () => invoke("hub.section", {}),
    onNavigate: (fn: (e: UiEvents["hub.navigate"]) => void) => on("hub.navigate", fn),
  },
  /** Só num gesto da pessoa (o clique em copiar): nenhuma UI escreve no clipboard sozinha (#1199). */
  copy: async (text: string) => {
    if (navigator.userActivation && !navigator.userActivation.isActive) throw new Error("copiar só com um clique");
    return invoke("clipboard.write", { text });
  },
};
