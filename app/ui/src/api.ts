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

async function invokeInternal<C extends "notes.rename"|"notes.delete"|"notes.restore">(cap:C,args:UiCapabilities[C]["args"]):Promise<UiCapabilities[C]["result"]>{
  if(!window.engine?.has("notes.folder"))return invoke(cap,args);
  const view=await invoke("notes.folder",{});
  return window.engine.invoke(cap,{...args,folderId:view.internal.id}) as Promise<UiCapabilities[C]["result"]>;
}

export const api = {
  noteFolders: {
    get: () => invoke("notes.folder",{}),
    open: (args: UiCapabilities["notes.openFolder"]["args"] = {}) => invoke("notes.openFolder",args),
    onChanged: (fn: (v:UiEvents["notes.folderChanged"])=>void) => on("notes.folderChanged",fn),
  },
  dictionary: {
    get: () => invoke("dictionary.get", {}),
    set: (terms: UiCapabilities["dictionary.set"]["args"]["terms"]) => invoke("dictionary.set", { terms }),
    check: (terms: UiCapabilities["dictionary.check"]["args"]["terms"]) => invoke("dictionary.check", { terms }),
  },
  settings: {
    get: () => invoke("settings.get", {}),
    set: (patch: UiCapabilities["settings.set"]["args"]) => invoke("settings.set", patch),
    /** Outra janela (ou o engine) mudou as Configurações (1.8.0). */
    onChanged: (fn: (s: UiEvents["settings.changed"]) => void) => on("settings.changed", fn),
  },
  /** "Aperte o atalho" (1.24.0, T5349): o helper lê as teclas e devolve o texto, sem salvar. */
  shortcuts: {
    /** `bareKey`: o cancelar do ditado, onde ⌫ ou ↩ sozinhos valem (1.27.0). */
    record: (bareKey?: boolean) => invoke("shortcuts.record", bareKey ? { bareKey } : {}),
    cancelRecord: () => invoke("shortcuts.cancelRecord", {}),
  },
  /** O microfone do ditado (T3230): as entradas que o helper vê, e o aviso quando uma entra ou sai. */
  audio: {
    inputs: () => invoke("audio.inputs", {}),
    onInputsChanged: (fn: () => void) => on("audio.inputs.changed", fn),
  },
  snippets: {
    get: () => invoke("snippets.get", {}),
    set: (snippets: UiCapabilities["snippets.set"]["args"]["snippets"]) => invoke("snippets.set", { snippets }),
  },
  history: {
    search: (params: UiCapabilities["history.search"]["args"]) => invoke("history.search", params),
    delete: (id: string) => invoke("history.delete", { id }),
    retry: (id:string)=>invoke("history.retry",{id}),
    onChanged:(fn:()=>void)=>on("history.changed",fn),
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
  /** "Salvar diagnóstico" (T5350): o .txt sem texto nem áudio; no app, em ~/Downloads e no Finder. */
  diagnostics: {
    save: () => invoke("diagnostics.save", {}),
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
  /** A aba Reuniões do hub (1.21.0, T4947): as notas de reunião e a gravação ao vivo. */
  meetings: {
    list: () => invoke("meetings.list", {}),
    live: () => invoke("meetings.live", {}),
    /** Só no clique em "Parar". */
    stop: () => invoke("meetings.stop", {}),
    pauseMine: (paused: boolean) => invoke("meetings.pauseMine", { paused }),
    onLive: (fn: (live: UiEvents["meetings.live"]) => void) => on("meetings.live", fn),
    /** As notas mudaram (inclusive fora do app): a lista lê de novo. */
    onNotesChanged: (fn: () => void) => on("notes.changed", () => fn()),
    rename: (path: string, newPath: string) => invokeInternal("notes.rename", { path, newPath }),
    /** Para a Lixeira do app, com 10 min para desfazer (`restore`). */
    delete: (path: string) => invokeInternal("notes.delete", { path }),
    restore: (path: string) => invokeInternal("notes.restore", { path }),
  },
  readClipboard: async () => {
    if (navigator.userActivation && !navigator.userActivation.isActive) throw new Error("colar só com um clique");
    return invoke("clipboard.read", {});
  },
  /** Só num gesto da pessoa (o clique em copiar): nenhuma UI escreve no clipboard sozinha (#1199). */
  copy: async (text: string) => {
    if (navigator.userActivation && !navigator.userActivation.isActive) throw new Error("copiar só com um clique");
    return invoke("clipboard.write", { text });
  },
};
