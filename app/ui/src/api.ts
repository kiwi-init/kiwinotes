// O lado da UI do contrato do AppEngine (src/shared/ui-contract.ts, T1192). A UI só fala com o main por
// `window.engine.invoke(cap, args)`, que o preload da janela põe na página. Fora do app (Vite no navegador) não há
// `window.engine`: as chamadas falham e as telas mostram o estado vazio.

import type { CustomRoutineInput, HistoryEntry, UiCapabilities, UiCapability, UiEvents } from "../../src/shared/ui-contract.ts";
import type { CatVoiceId } from "../../src/shared/cat-voices.ts";

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
  spelling: { suggest: (word: string, language?: string) => invoke("spelling.suggest", { word, ...(language ? { language } : {}) }) },
  noteFolders: {
    get: () => invoke("notes.folder",{}),
    open: (args: UiCapabilities["notes.openFolder"]["args"] = {}) => invoke("notes.openFolder",args),
    onChanged: (fn: (v:UiEvents["notes.folderChanged"])=>void) => on("notes.folderChanged",fn),
  },
  /** O modo preciso do ditado (1.38.0, T6602): o Whisper small, baixando, pronto… */
  dictation: { preciseStatus: () => invoke("dictation.preciseStatus", {}) },
  /** A voz do gato (1.100.0, T26729): ler o estado só lê o disco; o `download` é o clique da pessoa. */
  catVoice: {
    status: () => invoke("catVoice.status", {}),
    download: () => invoke("catVoice.download", {}),
    cancel: () => invoke("catVoice.cancel", {}),
    remove: () => invoke("catVoice.remove", {}),
    /** O Ouvir (T27778): toca o texto fixo da voz, sem mudar a escolhida; `null` para. */
    preview: (id: CatVoiceId | null) => invoke("catVoice.preview", { id }),
  },
  /** A voz do Kiwi pelo ElevenLabs (T31628): a chave vai ao Keychain e nunca volta; a UI só sabe se há uma. */
  elevenLabs: {
    status: () => invoke("elevenLabs.status", {}),
    setKey: (key: string) => invoke("elevenLabs.setKey", { key }),
    deleteKey: () => invoke("elevenLabs.deleteKey", {}),
    test: () => invoke("elevenLabs.test", {}),
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
  /**
   * O passo da primeira abertura (1.86.0, T20796): as duas permissões e o modelo de voz. O `request` é só no clique
   * da pessoa (o helper abre o diálogo do macOS); o progresso chega pelo `setup.changed`.
   */
  setup: {
    status: () => invoke("setup.status", {}),
    request: (permission: UiCapabilities["setup.request"]["args"]["permission"]) => invoke("setup.request", { permission }),
    done: () => invoke("setup.done", {}),
    onChanged: (fn: (s: UiEvents["setup.changed"]) => void) => on("setup.changed", fn),
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
    /** Só os nomes das pastas (1.68.0, spec #12918): para um seletor de pasta, sem o cofre inteiro. */
    folders: () => invoke("notes.folders", {}),
    search: (query: string) => invoke("notes.search", { query, limit: 12 }),
    /** A busca pelo sentido (1.34.0, T6013): o modelo e o índice da pasta aberta. */
    semanticStatus: () => invoke("notes.semanticStatus", {}),
    /** Mostra no Finder (o arquivo que o agente gerou, spec #11549). */
    reveal: (path: string) => invoke("notes.reveal", { path }),
    /** Abre uma nota ou um arquivo da pasta no lugar certo (spec #17683): o clique num link do balão. */
    openPath: (path: string) => invoke("notes.openPath", { path }),
  },
  /** A seção Sobre (T2386): a versão, o canal e as atualizações. */
  app: {
    about: () => invoke("app.about", {}),
    /** O idioma do app (1.104.0, spec #28171): a escolha, a língua de agora e a do macOS. */
    locale: () => invoke("app.locale", {}),
    onLocaleChanged: (fn: (e: UiEvents["app.localeChanged"]) => void) => on("app.localeChanged", fn),
  },
  /** "Salvar diagnóstico" (T5350): o .txt sem texto nem áudio; no app, em ~/Downloads e no Finder. */
  diagnostics: {
    save: () => invoke("diagnostics.save", {}),
    /** Um quadro travado (1.68.0, spec #12918), para o log local. */
    slowFrame: (where: string, ms: number) => invoke("diagnostics.slowFrame", { where, ms }),
  },
  /**
   * A aparência da janela (1.99.0, spec #25011): a UI nova que o canal baixou espera o Recarregar da faixa "Nova
   * aparência pronta"; o Sobre mostra a de cada janela e volta à anterior.
   */
  ui: {
    status: () => invoke("ui.status", {}),
    /** Troca para a UI nova sem fechar a janela: a página recarrega e esta promessa pode não voltar. */
    reload: () => invoke("ui.reload", {}),
    revert: () => invoke("ui.revert", {}),
    onUpdateReady: (fn: (s: UiEvents["ui.updateReady"]) => void) => on("ui.updateReady", fn),
  },
  updates: {
    /** Checa na hora; resolve quando a checagem termina (pronta, na última versão ou com erro). */
    check: () => invoke("updates.check", {}),
    /** "Atualizar e reiniciar": o app fecha, troca e reabre. Se resolver, é que não reiniciou. */
    apply: () => invoke("updates.apply", {}),
    onStatus: (fn: (v: UiEvents["updates.status"]) => void) => on("updates.status", fn),
  },
  /**
   * O agente (1.41.0/1.42.0, T8762, spec #8373): a seção Agente dos Ajustes. Nada liga, baixa nem pede sozinho: cada
   * chamada é um clique da pessoa. O progresso e a resposta chegam pelos eventos.
   */
  agent: {
    /** `refresh`: confere o Claude Code instalado (abre o `claude --version` e o `auth status`). */
    status: (refresh = false) => invoke("agent.status", refresh ? { refresh: true } : {}),
    enable: (consent = false) => invoke("agent.enable", consent ? { consent: true } : {}),
    disable: () => invoke("agent.disable", {}),
    download: () => invoke("agent.download", {}),
    ask: (text: string) => invoke("agent.ask", { text }),
    cancel: () => invoke("agent.cancel", {}),
    remove: () => invoke("agent.remove", {}),
    configure: (o: UiCapabilities["agent.configure"]["args"]) => invoke("agent.configure", o),
    onStatus: (fn: (s: UiEvents["agent.status"]) => void) => on("agent.status", fn),
    onTurn: (fn: (e: UiEvents["agent.turn"]) => void) => on("agent.turn", fn),
    /** O gato foi para o overlay, ou voltou (1.53.0, spec #9810): o hub esconde o do canto. */
    onCatWhere: (fn: (e: UiEvents["kiwicat.where"]) => void) => on("kiwicat.where", fn),
    /** A fala ao agente pelo Control (1.55.0, spec #9876): o `ouvindo` com as ondas e o texto no balão. */
    onVoice: (fn: (e: UiEvents["agent.voice"]) => void) => on("agent.voice", fn),
    /** A voz do gato (1.105.0, T26829): o nível do que ela tocou; `null` quando para. */
    onSpeech: (fn: (e: UiEvents["agent.speech"]) => void) => on("agent.speech", fn),
    /** A tela "Atividade do agente" (1.44.0–1.46.0, spec #9480): o registro, o [Ver] e o [Desfazer]. */
    activity: (limit?: number) => invoke("agent.activity", limit ? { limit } : {}),
    change: (request: string, change: number) => invoke("agent.change", { request, change }),
    undo: (request: string, change?: number) => invoke("agent.undo", change ? { request, change } : { request }),
    onActivity: (fn: (e: UiEvents["agent.activityChanged"]) => void) => on("agent.activityChanged", fn),
    /** A pergunta na dúvida (1.50.0, spec #9873). */
    question: () => invoke("agent.question", {}),
    answer: (a: UiCapabilities["agent.answer"]["args"]) => invoke("agent.answer", a),
    answers: () => invoke("agent.answers", {}),
    forget: (fingerprint: string) => invoke("agent.forget", { fingerprint }),
    onQuestion: (fn: (e: UiEvents["agent.questionChanged"]) => void) => on("agent.questionChanged", fn),
    /** A notificação quando o agente espera (1.52.0, spec #9839). O `noticeAllow` só no clique da pessoa. */
    notice: () => invoke("agent.notice", {}),
    noticeAllow: () => invoke("agent.noticeAllow", {}),
    noticeSet: (enabled: boolean) => invoke("agent.noticeSet", { enabled }),
    onNotice: (fn: (e: UiEvents["agent.noticeChanged"]) => void) => on("agent.noticeChanged", fn),
    /** O medidor (1.54.0, spec #11084). O `usageRefresh` (o `/usage`) só quando a pessoa abre ou clica em Atualizar. */
    usage: () => invoke("agent.usage", {}),
    usageRefresh: () => invoke("agent.usageRefresh", {}),
    usageClear: () => invoke("agent.usageClear", {}),
    /** Abre o programa sem pedido (1.82.0, spec #16793): o onboarding lista os modelos e os esforços. */
    prepare: () => invoke("agent.prepare", {}),
    /** As trilhas (1.79.0, T14682): visíveis e apagáveis, uma a uma. */
    trails: () => invoke("agent.trails", {}),
    trailDelete: (id: string) => invoke("agent.trailDelete", { id }),
    /** A conversa nova (1.75.0, T13835): a próxima pergunta começa uma janela, com a cápsula. */
    newConversation: () => invoke("agent.newConversation", {}),
    /** O Modelo de nota (1.56.0, spec #11102). */
    noteModel: () => invoke("agent.noteModel", {}),
    noteModelSet: (model: UiCapabilities["agent.noteModelSet"]["args"]["model"]) => invoke("agent.noteModelSet", { model }),
    onUsage: (fn: (e: UiEvents["agent.usageChanged"]) => void) => on("agent.usageChanged", fn),
    /** A proposta da reunião (1.57.0, spec #8360): nada é escrito antes do `proposalApply`. */
    proposals: () => invoke("agent.proposals", {}),
    proposal: (id: string) => invoke("agent.proposal", { id }),
    proposalChoose: (id: string, folder: string | null) => invoke("agent.proposalChoose", { id, folder }),
    /** Numa proposta de rotina (1.68.0), a `routine` é o cartão do [Ajustar]. */
    proposalApply: (id: string, routine?: CustomRoutineInput) => invoke("agent.proposalApply", routine ? { id, routine } : { id }),
    proposalPrepare: (id: string) => invoke("agent.proposalPrepare", { id }),
    /** "Rodar agora" numa rotina (spec #12150). */
    routineRun: (which: { kind: "daily" | "weekly" } | { id: string }) => invoke("agent.routineRun", which),
    /** As rotinas novas (1.68.0, spec #12944): entram desligadas; editar, ligar e apagar. */
    routineCreate: (r: CustomRoutineInput) => invoke("agent.routineCreate", r),
    routineUpdate: (id: string, patch: Partial<CustomRoutineInput & { on: boolean }>) => invoke("agent.routineUpdate", { id, ...patch }),
    routineDelete: (id: string) => invoke("agent.routineDelete", { id }),
    onRoutine: (fn: (e: UiEvents["agent.routine"]) => void) => on("agent.routine", fn),
    proposalDiscard: (id: string) => invoke("agent.proposalDiscard", { id }),
    onProposals: (fn: (e: UiEvents["agent.proposalsChanged"]) => void) => on("agent.proposalsChanged", fn),
    /** A memória do agente (1.60.0, spec #11469). */
    memory: () => invoke("agent.memory", {}),
    memoryUndo: (id: string) => invoke("agent.memoryUndo", { id }),
    memorySet: (facts: string[], skipped?: string[]) => invoke("agent.memorySet", skipped === undefined ? { facts } : { facts, skipped }),
    memoryClear: () => invoke("agent.memoryClear", {}),
    /** O guardrail na prática (1.64.0, spec #11955): o filtro local, sem ir ao agente. */
    guardPreview: (text: string) => invoke("agent.guardPreview", { text }),
    onMemory: (fn: (e: UiEvents["agent.memoryChanged"]) => void) => on("agent.memoryChanged", fn),
  },
  /** Os projetos (spec #9874), para o onboarding do agente (spec #11955): a lista e marcar ou desmarcar uma pasta. */
  projects: {
    list: () => invoke("projects.list", {}),
    mark: (folder: string) => invoke("projects.mark", { folder }),
    /** Uma pasta de fora da pasta de notas (spec #12950): o projeto nasce dentro dela, com o caminho na nota. */
    markOutside: (outside: string) => invoke("projects.mark", { outside }),
    /** A busca das pastas de projeto: `start`, `stop`, ou só ler onde está. */
    find: (args: { start?: true; stop?: true } = {}) => invoke("projects.find", args),
    choose: () => invoke("projects.choose", {}),
    reveal: (path: string) => invoke("projects.reveal", { path }),
    unmark: (folder: string) => invoke("projects.unmark", { folder }),
    onChanged: (fn: () => void) => on("projects.changed", () => fn()),
  },
  /** O hub (T2121): a seção pedida antes de ele abrir, e as que chegam com ele aberto. */
  hub: {
    section: () => invoke("hub.section", {}),
    onNavigate: (fn: (e: UiEvents["hub.navigate"]) => void) => on("hub.navigate", fn),
  },
  /** A aba Início (T15847, T15875): o dia, as Pendências e a Semana; `onChanged` quando algo disso muda. */
  home: {
    pending: () => invoke("home.pending", {}),
    week: () => invoke("home.week", {}),
    onChanged: (fn: () => void) => on("home.changed", fn),
  },
  /** O Calendário (1.107.0, T32154): os itens de um período, criar, mudar e a nota de onde veio; `onChanged` quando muda. */
  calendar: {
    items: (from: string, to: string) => invoke("calendar.items", { from, to }),
    create: (args: UiCapabilities["calendar.create"]["args"]) => invoke("calendar.create", args),
    update: (args: UiCapabilities["calendar.update"]["args"]) => invoke("calendar.update", args),
    source: (id: string) => invoke("calendar.source", { id }),
    onChanged: (fn: () => void) => on("calendar.changed", fn),
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
