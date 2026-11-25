import type { SetupStatus } from "../shared/first-run.ts";
import { NO_SPELLING } from "../shared/spelling.ts";
// As janelas do Kiwi Notes. Cada uma é uma UI do AppEngine em modo host (T1192, ADR 0006): o engine sobe quando a
// janela abre, mostra a UI mais nova que funciona (a de fábrica do .app, ou uma instalada pelo canal local), troca
// quando chega uma nova e volta atrás se ela falhar. A UI só fala com o main pelo contrato (src/shared/ui-contract.ts).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { BrowserView, BrowserWindow, PATHS, Screen, Updater, Utils } from "electrobun/bun";
import type { AppEngine } from "electrobun/bun/appengine";

import { type HubSection, UI_CAPABILITIES, UI_CONTRACT_VERSION, UI_WINDOWS, type UiAppearance, type UiEvents, type UiStatus, type UiWindow } from "../shared/ui-contract.ts";
import { saveDiagnostics } from "./diagnostics.ts";
import { slowLog, timedCapabilities } from "./slow-log.ts";
import { appLog } from "./file-log.ts";
import { WINDOW_SPECS as SPECS } from "../shared/window-specs.ts";
import { type AppEngineRPC, appEnginePageScript } from "./appengine-devkit.ts";
import { type AttachedCatOverlay, attachCatOverlay } from "./cat-overlay.ts";
import { type AttachedAgentVoice, attachAgentVoice } from "./agent-voice.ts";
import { session } from "./session.ts";
import type { Sidecar } from "./sidecar.ts";
import { stores } from "./stores.ts";
import { type CapabilityDeps, uiCapabilities } from "./ui-capabilities.ts";
import { createCatVoice } from "./cat-voice-model.ts";
import { voicePath } from "./voice-process.ts";
import { type BuiltIn, builtInFrom, createUiEngine, devServerAllowed, directInvoke, enginePreload, oneAtATime, servedDir, uiChannelFor } from "./ui-engine.ts";
import { updatesOff } from "./updates.ts";
import { uiChannelFetch } from "./ui-channel-fetch.ts";
import { type BuiltInVersion, closedWindowStatus, revertWindow } from "./ui-appearance.ts";
import { UI_TRUSTED_KEYS } from "./ui-keys.ts";
import { windowSecurity } from "./window-security.ts";
import { createLinkOpener, newWindowUrl, urlOnDiskBefore } from "./link-open.ts";
import { releaseNotesUrl } from "../shared/ui-contract.ts";
import { fetchRemoteImage } from "../notes/remote-image.ts";
import { NOT_RECORDING } from "../shared/meetings.ts";
import { MeetingHostError } from "./meetings.ts";
import { readerFromCapabilities } from "../agent/tools/reader.ts";
import { readNoteModel } from "../agent/note-model.ts";
import { writerFromCapabilities } from "../agent/tools/writer.ts";
import { undoNotesFromCapabilities } from "../agent/undo.ts";
import { HomeChanges } from "./home.ts";
import { ligarVozDoGatoNoApp } from "./cat-voice-output.ts";
import { CatVoicePreview, createCatVoicePreview } from "./cat-voice-preview.ts";
import { hubFrame, type IntroLayout, introWindow, parseHubFrame, type Rect } from "../shared/intro-layout.ts";
import { systemLanguages } from "./system-language.ts";
import { mainLocale } from "./locale.ts";

export type WindowName = UiWindow;

const DEV_SERVER = "http://localhost:5178";

let devServer: Promise<string | null> | null = null;

/** Só no canal `dev`, e só com o Vite de pé: a UI vem do localhost, com HMR. No stable, nunca. */
function devServerUrl(): Promise<string | null> {
  devServer ??= (async () => {
    if (!devServerAllowed(await Updater.localInfo.channel())) return null;
    try {
      await fetch(DEV_SERVER, { method: "HEAD" });
      return DEV_SERVER;
    } catch {
      return null;
    }
  })();
  return devServer;
}

/** Quem sabe a seção pedida para o hub (src/bun/hub.ts), e quem quer saber que uma janela fechou. */
let hubSection: () => { section: HubSection; path?: string } | null = () => null;
/** Quem abre o hub nas Notas num arquivo (o clique no balão do gato, spec #17683): o index.ts liga ao `Hub`. */
let openInHub: (path: string) => void = () => {};
const closeListeners = new Set<(name: WindowName) => void>();
let about: CapabilityDeps["about"];
/** A seção Sobre: a versão e as atualizações, que o index.ts liga ao `AppUpdates` (T2386). */
export function provideAbout(a: NonNullable<CapabilityDeps["about"]>): void {
  about = a;
}

/**
 * O `window.open` das janelas (T25095): a lista fixa (as notas desta versão e da que a atualização oferece), a URL que
 * já estava numa nota antes desta execução, ou a pergunta com a URL. Num build dos agentes (`KIWI_DEBUG=1`), nada vai
 * ao navegador: só o log (AGENTS.md, nada na tela do harry).
 */
const APP_START = performance.timeOrigin;
const linkOpener = createLinkOpener({
  fixed: () => {
    const info = about?.info();
    const view = about?.view();
    const offered = view && "version" in view ? releaseNotesUrl(view.version) : null;
    return [info?.releaseUrl, offered].filter((u): u is string => !!u);
  },
  onDiskBefore: async (url) => {
    const roots = [...new Set([(await stores.folders.current()).ref.path, (await stores.folders.internal()).ref.path])];
    return urlOnDiskBefore(url, roots, APP_START);
  },
  confirm: async (url) => {
    if (process.env.KIWI_DEBUG === "1") return false;
    const { response } = await Utils.showMessageBox({
      type: "question",
      title: mainLocale.t("dialog.link.title"),
      message: mainLocale.t("dialog.link.message"),
      detail: url,
      buttons: [mainLocale.t("dialog.link.open"), mainLocale.t("dialog.link.cancel")],
      defaultId: 1,
      cancelId: 1,
    });
    return response === 0;
  },
  open: (url) => {
    if (process.env.KIWI_DEBUG !== "1") Utils.openExternal(url);
  },
  log: (m) => console.log(`[links] ${m}`),
});

export function provideHubSection(fn: () => { section: HubSection; path?: string } | null): void {
  hubSection = fn;
}

export function provideOpenInHub(fn: (path: string) => void): void {
  openInHub = fn;
}
const introDoneListeners = new Set<() => void>();
/** A página da intro avisou que terminou (`intro.done`, T2308). */
export function onIntroDone(fn: () => void): () => void {
  introDoneListeners.add(fn);
  return () => introDoneListeners.delete(fn);
}

export function onWindowClosed(fn: (name: WindowName) => void): () => void {
  closeListeners.add(fn);
  return () => closeListeners.delete(fn);
}

let debugClipboard = "";
/** O registro do que é lento (spec #12918), no log local: as chamadas das telas, o Bun parado e os quadros travados. */
export const appSlowLog = slowLog();
/**
 * A voz do gato (T26729): o modelo baixado no clique e o processo `kiwi-voice` que o usa. O player (T26734) fala pelo
 * `catVoice.voice`. Sem o clique, nada baixa; no headless, nada baixa nunca.
 */
export const catVoice = createCatVoice({
  modelsDir: stores.modelsDir,
  bin: voicePath(PATHS.VIEWS_FOLDER),
  download: process.env.KIWI_HEADLESS !== "1",
  // A voz escolhida nos Ajustes (T27778): lida no começo de cada fala, então a troca vale da próxima em diante.
  selected: async () => (await stores.settings.load()).kiwicat.voz,
});
/**
 * A voz do gato no alto-falante (T27825): o player da fala e o Ouvir dos Ajustes tocam pelo helper (`speech.play`),
 * ligados quando o helper sobe (`startCatVoiceOutput`). Antes disso, o Ouvir não toca.
 */
let catVoiceOutput: { preview: CatVoicePreview; stop(): void } | undefined;
const catVoicePreview = {
  ouvir: async (id: Parameters<CatVoicePreview["ouvir"]>[0]) => {
    if (!catVoiceOutput) throw new Error("helper_unavailable");
    return catVoiceOutput.preview.ouvir(id);
  },
  parar: () => catVoiceOutput?.preview.parar(),
};
export function startCatVoiceOutput(sidecar: Sidecar): void {
  catVoiceOutput?.stop();
  const log = (m: string) => console.log(`[cat-voice] ${m}`);
  // A ligação inteira fica no `ligarVozDoGatoNoApp` (T29234), que os testes provam; aqui só o que é do app.
  const voz = ligarVozDoGatoNoApp({
    sintese: catVoice.voice,
    agent: stores.agent,
    helper: {
      saida: {
        request: (c) => sidecar.request(c),
        send: (c) => sidecar.send(c),
        on: (t, fn) => sidecar.on(t, fn),
        onClose: (fn) => sidecar.onClose(fn),
      },
      midia: { request: (c) => sidecar.request(c) },
      eventos: { on: (t, fn) => sidecar.on(t, fn) },
    },
    janelas: () => rpcs.values(),
    overlay: () => catOverlay?.overlay,
    previa: (saida, falaDoGato) => createCatVoicePreview(catVoice, { saida, falaDoGato, log }),
    log,
  });
  catVoiceOutput = { preview: voz.previa!, stop: voz.stop };
}
// O motivo do Sobre sem atualizador (um build de dev). Vai ao log e ao agente; a tela não mostra.
const UPDATER_OFF = "o atualizador ainda não subiu"; // i18n-ok: diagnóstico

const capabilities = uiCapabilities({
  introDone: () => {
    for (const fn of introDoneListeners) fn();
  },
  introLayout: () => introPlan?.layout ?? null,
  dictionary: stores.dictionary,
  snippets: stores.snippets,
  history: stores.history,
  retryDictation: async id => {
    const current=session.get();if(!current)throw new Error("helper_unavailable");
    return current.retryDictation(id);
  },
  dictionaryChanged: (terms) => void session.get()?.dictionaryChanged(terms),
  snippetsChanged: (snippets) => session.get()?.snippetsChanged(snippets),
  settings: stores.settings,
  agent: stores.agent,
  settingsChanged: (settings) => {
    void session.get()?.settingsChanged(settings);
    catOverlay?.settingsChanged(settings);
    agentVoice?.settingsChanged(settings);
    // A Aparência vale para todas as janelas abertas (T2503).
    for (const rpc of rpcs.values()) rpc.send.event({ name: "settings.changed", payload: settings });
  },
  // O idioma do app (spec #28171): a língua do macOS para o Automático, e a troca vai a todas as janelas.
  systemLanguages,
  localeChanged: (locale) => {
    // O main também (T28192): o menu, a bandeja, as notificações e o helper seguem a língua.
    mainLocale.set(locale.locale);
    for (const rpc of rpcs.values()) rpc.send.event({ name: "app.localeChanged", payload: locale });
  },
  // Os projetos (spec #9847): a barra lateral das Notas relê quando mudam por outro lugar.
  projectsChangedIn: (folderId) => {
    for (const rpc of rpcs.values()) rpc.send.event({ name: "projects.changed", payload: { folderId } });
  },
  clipboardWrite: (text) => {
    if (process.env.KIWI_DEBUG === "1") { debugClipboard = text; return; }
    Utils.clipboardWriteText(text);
  },
  clipboardRead: () => process.env.KIWI_DEBUG === "1" ? debugClipboard : Utils.clipboardReadText(),
  spelling: (word, language) => session.get()?.checkSpelling(word, language) ?? NO_SPELLING,
  // "Mostrar no Finder" (T2468). Com KIWI_DEBUG=1 (os agentes), só registra: nada abre na tela de ninguém.
  reveal: (abs) => {
    if (process.env.KIWI_DEBUG === "1") return void console.log(`[notes] reveal (dry run): ${abs}`);
    Bun.spawn(["/usr/bin/open", "-R", abs], { stdio: ["ignore", "ignore", "ignore"] });
  },
  // Um arquivo do cofre que não é nota (T3370), no app padrão; o que rodaria algo, só no Finder. Com KIWI_DEBUG=1, só
  // registra, como o reveal.
  openFile: (abs, mode) => {
    if (process.env.KIWI_DEBUG === "1") return void console.log(`[notes] open file (dry run, ${mode}): ${abs}`);
    Bun.spawn(["/usr/bin/open", ...(mode === "finder" ? ["-R"] : []), abs], { stdio: ["ignore", "ignore", "ignore"] });
  },
  // A Lixeira do app (T2593): o Lixo do macOS no Finder. Só abrir a pasta; nada sai de lá (o TCC, #2493).
  revealTrash: () => {
    if (process.env.KIWI_DEBUG === "1") return void console.log("[notes] reveal trash (dry run)");
    Bun.spawn(["/usr/bin/open", path.join(process.env.HOME ?? "", ".Trash")], { stdio: ["ignore", "ignore", "ignore"] });
  },
  notes: stores.notes,
  notesFolders: stores.folders,
  chooseNotesFolder: async () => {
    if (process.env.KIWI_DEBUG === "1") return null;
    const selected = await Utils.openFileDialog({canChooseFiles:false,canChooseDirectory:true,allowsMultipleSelection:false});
    return selected[0] ?? null;
  },
  // A busca das pastas de projeto (spec #12950): a pasta pessoal do Mac. Com KIWI_DEBUG=1 (os agentes), só uma casa de
  // mentira (KIWI_PROJECTS_HOME): nunca a do harry, que abriria o pedido do macOS na tela dele.
  projectsHome: () => (process.env.KIWI_DEBUG === "1" ? (process.env.KIWI_PROJECTS_HOME ?? null) : homedir()),
  chooseProjectFolder: async () => {
    if (process.env.KIWI_DEBUG === "1") return process.env.KIWI_TEST_PROJECT_FOLDER ?? null;
    const selected = await Utils.openFileDialog({ canChooseFiles: false, canChooseDirectory: true, allowsMultipleSelection: false });
    return selected.find((p) => p.trim()) ?? null;
  },
  meetingNotes: stores.meetingNotes,
  attachments: stores.attachments,
  // A imagem de fora de uma nota, só depois do clique no cartão (T2984, #3039).
  remoteImage: (url) => fetchRemoteImage(url),
  // O seletor de microfone dos Ajustes (T3230): o helper lista as entradas, sem abrir nenhuma.
  audioInputs: async () => (await session.get()?.audioInputs()) ?? null,
  precise: () => session.get()?.precise.status() ?? null,
  catVoice: catVoice.model,
  catVoicePreview,
  // O passo da primeira abertura (T20796): o botão de cada permissão pede pelo helper; o fim solta os pedidos da abertura.
  setup: {
    live: () => session.get()?.setupLive() ?? null,
    request: async (permission) => {
      // Com KIWI_DEBUG=1 (os agentes), só registra: nenhum diálogo do macOS abre na tela da pessoa (AGENTS.md, #536).
      if (process.env.KIWI_DEBUG === "1") return void console.log(`[setup] request (dry run): ${permission}`);
      await session.get()?.permissions.requestFromSetup(permission);
    },
    done: () => session.get()?.permissions.setupDone(),
  },
  // "Aperte o atalho" das Configurações (T5349): o tap do helper lê as teclas.
  shortcuts: {
    record: async (bareKey?: boolean) => {
      const s = session.get();
      if (!s) throw new Error("sidecar_closed");
      return s.recordShortcut(bareKey);
    },
    cancel: () => session.get()?.cancelShortcutRecording(),
  },
  // A gravação de reunião ao vivo (R6): a do helper do Session de agora.
  meetings: {
    live: () => session.get()?.meetings.live() ?? NOT_RECORDING,
    onChange: (fn) => session.get()?.meetings.onChange(fn) ?? (() => {}),
    stop: async () => {
      const s = session.get();
      if (!s) throw new MeetingHostError("no_helper");
      await s.meetings.stop();
    },
    setMinePaused: async (paused) => {
      const s = session.get();
      if (!s) throw new MeetingHostError("no_helper");
      await s.meetings.setMinePaused(paused);
    },
  },
  ocr: stores.ocr,
  textIndex: stores.textIndex,
  semanticEngine: stores.semantic,
  userActive: () => stores.gate.touch(),
  exporter: stores.exporter,
  // Exportar (T2684): a pasta pelo seletor do macOS, só no clique da pessoa. Com KIWI_DEBUG=1 (os agentes), nenhum
  // diálogo abre: a pasta é a de KIWI_EXPORT_DIR, ou o exportar dá E_CANCELED.
  chooseExportFolder: async () => {
    if (process.env.KIWI_DEBUG === "1") return process.env.KIWI_EXPORT_DIR ?? null;
    const paths = await Utils.openFileDialog({ startingFolder: "~/Documents", canChooseFiles: false, canChooseDirectory: true, allowsMultipleSelection: false });
    return paths.find((p) => p.trim()) ?? null;
  },
  versions: stores.versions,
  dictationNotes: stores.dictationNotes,
  hubSection: () => hubSection(),
  openInNotes: (path) => openInHub(path),
  // "Salvar diagnóstico" (T5350): em ~/Downloads, e o Finder mostra o arquivo. Com KIWI_DEBUG=1 (os agentes), vai para
  // <dados>/diagnostics e nada abre na tela.
  // A abertura das Notas (spec #13664) chega como `notes-open`: é um tempo de abrir, não um quadro.
  slowFrame: (where, ms) => appSlowLog.line(where.endsWith("-open") ? `abrir ${where.slice(0, -5)} levou ${ms} ms` : `quadro de ${ms} ms na tela (${where})`),
  diagnostics: {
    save: () => {
      const debug = process.env.KIWI_DEBUG === "1";
      return saveDiagnostics({
        app: () => about?.info() ?? { version: "dev", channel: "dev" },
        contract: UI_CONTRACT_VERSION,
        session: () => session.get()?.diagnostics() ?? null,
        settings: async () => {
          const s = await stores.settings.load();
          return { microphone: s.microphone, notesShortcut: s.notesShortcut };
        },
        log: appLog,
        saveDir: debug ? path.join(stores.dir, "diagnostics") : path.join(process.env.HOME ?? stores.dir, "Downloads"),
        reveal: (abs) => {
          if (debug) return void console.log("[diagnostics] reveal (dry run)");
          Bun.spawn(["/usr/bin/open", "-R", abs], { stdio: ["ignore", "ignore", "ignore"] });
        },
      });
    },
  },
  // A aparência (spec #25011): o status e o reload de fora de uma janela não têm engine; cada janela troca os dois.
  appearance: {
    status: () => ({ uiVersion: "dev", builtIn: true, pending: null }),
    reload: () => ({ uiVersion: "dev", builtIn: true, pending: null }),
    about: () => uiAppearance(),
    revert: () => revertAppearance(),
  },
  about: {
    info: () => about?.info() ?? { version: "dev", channel: "dev", releaseUrl: null },
    view: () => about?.view() ?? { state: "off", reason: UPDATER_OFF, lastCheck: null },
    check: () => about?.check() ?? Promise.resolve({ state: "off", reason: UPDATER_OFF, lastCheck: null }),
    apply: () => about?.apply() ?? Promise.resolve({ state: "off", reason: UPDATER_OFF, lastCheck: null }),
  },
});
// As ferramentas do agente (spec #7496) leem pelas mesmas capacidades das janelas, só as de leitura; e escrevem (spec
// #8356) pelo mesmo salvar das Notas, com a cópia de antes nas Versões.
/** O que as telas chamam, com o tempo de cada chamada no log (spec #12918). O agente usa as de sempre, sem o tempo. */
const timedUi = timedCapabilities(capabilities, appSlowLog);
stores.agent.useReader(readerFromCapabilities(capabilities));
// O Modelo de nota (spec #11102) do cofre aberto, para o começo fixo do pedido.
stores.agent.useNoteModel(async () => readNoteModel((await stores.folders.current()).notes.root));
// A memória do agente (spec #11469) fica no cofre aberto.
stores.agent.useVaultRoot(async () => (await stores.folders.current()).notes.root);
// Os links do balão (spec #17683): só o que está no índice da pasta aberta.
stores.agent.useLinkResolver(async () => {
  const v = (await stores.folders.current()).notes;
  return { note: (t) => v.resolve(t), file: (t) => v.resolveFiles([t])[t] ?? v.fileAt(t) };
});
stores.agent.useGlossary(async () => (await stores.dictionary.load()).map((t) => t.term));
stores.agent.useWriter(writerFromCapabilities(capabilities));
// O desfazer (spec #9353), pelas mesmas capacidades: a janela das Notas vê a nota voltar.
stores.agent.useUndo(undoNotesFromCapabilities(capabilities));
// As rotinas (spec #12150): o agendador confere a hora com o app aberto, e pega a que passou com o app fechado.
stores.agent.startRoutines();

/** O RPC de cada janela aberta, para os eventos que valem para todas (`notes.changed`). */
const rpcs = new Map<WindowName, { send: { event(e: { name: string; payload: unknown }): void } }>();
stores.folders.onNotesChanged((folder, paths, listing) => {
  const payload = { paths, folderId: folder.id, listing: listing() };
  // O Kiwi escrevendo ao vivo (spec #20843): o `agent.wrote` da mesma escrita vai antes, no mesmo tick.
  const versions = new Map((payload.listing?.notes ?? []).map((n) => [n.path, n.version]));
  for (const wrote of stores.agent.liveWrites.take(paths, folder.id, (p) => versions.get(p)))
    for (const rpc of rpcs.values()) rpc.send.event({ name: "agent.wrote", payload: wrote });
  for (const rpc of rpcs.values()) rpc.send.event({ name: "notes.changed", payload });
});
// A tela de Início (T15847): uma nota, um ditado ou uma reunião que mudou vira um `home.changed` só, depois da rajada.
const homeChanges = new HomeChanges(() => {
  for (const rpc of rpcs.values()) rpc.send.event({ name: "home.changed", payload: {} });
});
/** Algo que a tela de Início mostra mudou (a reunião que começou ou parou vem do `index.ts`). */
export const homeChanged = (): void => homeChanges.poke();
stores.folders.onNotesChanged(homeChanged);
stores.history.onAdded(homeChanged);
// Os outros arquivos do cofre (T3370): a árvore mostra todos.
stores.folders.onFilesChanged((folder, paths) => {
  // O `.txt` que o Kiwi escreveu (spec #20843): o `agent.wrote` vai antes, como no `notes.changed`.
  for (const wrote of stores.agent.liveWrites.take(paths, folder.id))
    for (const rpc of rpcs.values()) rpc.send.event({ name: "agent.wrote", payload: wrote });
  for (const rpc of rpcs.values()) rpc.send.event({ name: "files.changed", payload: { paths, folderId: folder.id } });
});
// O arquivo novo do Kiwi (`files_create`): o aviso sai logo depois do `files.changed` dele, só com o caminho.
stores.agent.liveWrites.onAnnounce((wrote) => {
  void stores.folders.current().then((f) => {
    for (const rpc of rpcs.values()) rpc.send.event({ name: "agent.wrote", payload: { ...wrote, folderId: f.ref.id } });
  }, () => {});
});

const preload = enginePreload(UI_CAPABILITIES, appEnginePageScript);

const open = new Map<WindowName, BrowserWindow>();

/** O engine de uma janela aberta (spec #25011): a UI na tela, a nova que espera o Recarregar e o reinício do Voltar. */
interface OpenUi {
  dir: string;
  builtIn: BuiltIn;
  engine: AppEngine | null;
  /** A versão da UI nova que o canal baixou e espera o Recarregar, ou null. */
  waiting: string | null;
  restart(): Promise<void>;
}
const uis = new Map<WindowName, OpenUi>();

function uiStatusOf(ui: OpenUi): UiStatus {
  const showing = ui.engine?.showing;
  return { uiVersion: showing?.uiVersion ?? ui.builtIn.uiVersion, builtIn: !showing, pending: ui.waiting };
}

const uiDir = (name: WindowName) => path.join(stores.dir, "appengine", name);

/** A UI de cada janela, aberta (pelo engine) ou fechada (pelo engine.json). Sem a UI de fábrica (dev), fica de fora. */
function uiAppearance(): UiAppearance {
  const windows: UiAppearance["windows"] = [];
  for (const name of UI_WINDOWS) {
    const ui = uis.get(name);
    if (ui) windows.push({ window: name, ...uiStatusOf(ui) });
    else {
      const builtIn = builtInVersionOf(name);
      if (builtIn) windows.push({ window: name, ...closedWindowStatus(uiDir(name), builtIn) });
    }
  }
  return { windows, canRevert: windows.some((w) => !w.builtIn) };
}

function builtInVersionOf(name: WindowName): BuiltInVersion | null {
  try {
    const b = builtInFrom(path.join(PATHS.VIEWS_FOLDER, "ui", name));
    return { uiVersion: b.uiVersion, seq: b.seq };
  } catch {
    return null;
  }
}

/** "Voltar à aparência anterior": cada janela volta, a aberta com o engine parado antes e um novo depois. */
async function revertAppearance(): Promise<UiAppearance> {
  for (const name of UI_WINDOWS) {
    const ui = uis.get(name);
    const builtIn = ui?.builtIn ?? builtInVersionOf(name);
    if (!builtIn) continue;
    // Aberta, o alvo é a UI da tela, mesmo com uma nova esperando o Recarregar; fechada, a que sobe ao abrir.
    const onScreen = ui ? (ui.engine?.showing ? { sha256: ui.engine.showing.sha256 } : null) : undefined;
    ui?.engine?.stop();
    const reverted = revertWindow(uiDir(name), builtIn, onScreen);
    log(name, reverted ? "appearance reverted" : "no installed UI to revert");
    if (ui) await ui.restart();
  }
  return uiAppearance();
}

const log = (name: WindowName, m: string) => console.log(`[ui:${name}] ${m}`);

/** As aberturas em andamento: um 2º clique enquanto a 1ª sobe só espera, sem criar outra janela e outro engine. */
const opening = new Map<WindowName, Promise<void>>();

/**
 * Abre a janela, ou traz para a frente a que já existe. Ela entra com a animação
 * da UI (`enter` em ui/src/kit/Window.tsx): no primeiro load sozinha, e ao voltar
 * para a frente chamamos `__kiwiEnter()`.
 *
 * Nunca rejeita: um erro ao abrir uma janela vai para o log e não derruba o app (o ditado continua). O menu chama sem
 * esperar, e no Bun uma rejeição sem tratamento sai com exit 1 (T914, revisão #1277).
 */
export function showWindow(name: WindowName): Promise<void> {
  return oneAtATime(opening, name, () => openWindow(name), (e) =>
    log(name, `couldn't open the window: ${e instanceof Error ? e.message : String(e)}`),
  );
}

async function openWindow(name: WindowName, hidden = false): Promise<void> {
  const existing = open.get(name);
  if (existing) {
    existing.show();
    existing.activate();
    if (name === "hub") setHubFocused(true);
    existing.webview.executeJavascript("window.__kiwiEnter?.()");
    return;
  }
  const spec = SPECS[name];
  const dev = await devServerUrl();
  let engine: AppEngine | null = null;
  const rpc = BrowserView.defineRPC<AppEngineRPC>({
    maxRequestTime: 10_000,
    handlers: {
      requests: {
        invoke: ({ cap, args }) => (engine ? engine.invoke(cap, args) : directInvoke(timedUi, cap, args)),
      },
      messages: {
        ready: () => engine?.ready(),
        bootError: ({ message }) => engine?.error(message),
        runtimeError: ({ message }) => engine?.error(message),
      },
    },
  });

  const dir = path.join(stores.dir, "appengine", name);
  const options = {
    title: spec.title,
    spellCheck: name === "notes" || name === "hub",
    preload,
    ...(name === "intro"
      ? introChrome()
      : {
          // O hub abre no lugar salvo, ou no meio da área útil (T16769): o mesmo retângulo até onde a intro cresce.
          frame: name === "hub" ? (introPlan?.hub ?? planHubFrame()) : { width: spec.width, height: spec.height },
          titleBarStyle: "hiddenInset" as const,
        }),
    hidden,
    rpc,
    // Só a UI dentro da janela, link externo no navegador, CSP nas views (T1378).
    ...windowSecurity(dev),
  };
  let win: BrowserWindow;
  if (dev) {
    win = new BrowserWindow({ ...options, url: `${dev}/${name}/index.html` });
  } else {
    mkdirSync(servedDir(dir), { recursive: true, mode: 0o700 });
    const decoder = new TextDecoder();
    let created: BrowserWindow | null = null;
    // O canal da UI segue o Updater (spec #25011): com as atualizações desligadas, nada vai à rede.
    const channel = uiChannelFor(name, {
      env: process.env.KIWI_UI_CHANNEL,
      updatesOff: updatesOff(await Updater.getLocalInfo(), process.env),
      warn: (m) => log(name, m),
    });
    log(name, `UI channel: ${channel.kind === "off" ? `off, ${channel.reason}` : channel.kind}`);
    const ui: OpenUi = { dir, builtIn: builtInFrom(path.join(PATHS.VIEWS_FOLDER, "ui", name)), engine: null, waiting: null, restart: async () => {} };
    // O `ui.status` e o `ui.reload` desta janela (spec #25011): os do engine dela. O handler comum confere os argumentos.
    const windowCaps: Record<string, (args: unknown) => unknown> = {
      ...timedUi,
      "ui.status": (args) => (timedUi["ui.status"]!(args), uiStatusOf(ui)),
      "ui.reload": async (args) => {
        await timedUi["ui.reload"]!(args);
        const to = ui.waiting;
        ui.engine?.applyUpdate();
        return to ? { uiVersion: to, builtIn: false, pending: null } : uiStatusOf(ui);
      },
    };
    const startEngine = async () => {
      const e = createUiEngine({
        name,
        dir,
        builtIn: ui.builtIn,
        trustedKeys: UI_TRUSTED_KEYS,
        capabilities: windowCaps,
        channel,
        // O remoto só fala com a rede pelo fetch guardado: só o release ui-channel e o armazenamento do GitHub (T25029).
        remoteFetch: uiChannelFetch(),
        // "Buscar atualizações" (T25110): desligado, nenhum GET do canal, a partir do próximo e sem reiniciar.
        checkUpdates: async () => (await stores.globalSettings.load()).checkUpdates,
        // A UI nova não troca a da tela sozinha: a janela mostra a faixa "Nova aparência pronta", e o Recarregar troca
        // (spec #25011). Fechada, a janela sobe a nova na próxima abertura.
        canSwap: () => false,
        show: (shown) => {
          log(name, `showing UI ${shown.uiVersion}${shown.manifest ? "" : " (built-in)"}`);
          const html = decoder.decode(shown.index);
          // A janela nasce já com a UI: um html provisório no construtor chegava depois e cobria a UI (T1192).
          if (!created) {
            created = new BrowserWindow({ ...options, html, viewsRoot: servedDir(dir) });
            created.webview.on("render-process-gone", () => engine?.rendererGone());
          } else created.webview.loadHTML(html);
        },
      });
      engine = e;
      ui.engine = e;
      ui.waiting = null;
      e.on((ev) => {
        log(name, "reason" in ev ? `${ev.type}: ${ev.reason}` : ev.type);
        if (ev.type === "waiting") {
          ui.waiting = ev.manifest.uiVersion;
          rpc.send.event({ name: "ui.updateReady", payload: uiStatusOf(ui) });
        } else if (ev.type === "booting" || ev.type === "built-in") ui.waiting = null;
      });
      await e.start();
    };
    // O "Voltar à aparência anterior": o engine para, o engine.json muda (ui-appearance.ts) e um engine novo sobe a UI
    // anterior na mesma janela, sem fechar.
    ui.restart = async () => {
      ui.engine?.stop();
      await startEngine();
    };
    try {
      await startEngine();
      if (!created) throw new Error("the engine showed nothing");
    } catch (e) {
      // Sem janela pela metade nem engine de pé: o próximo clique tenta do zero.
      ui.engine?.stop();
      (created as BrowserWindow | null)?.close();
      throw e;
    }
    uis.set(name, ui);
    win = created;
  }
  open.set(name, win);
  rpcs.set(name, rpc);
  // O `newWindow: "deny"` só avisa: o main decide cada URL (T25095).
  // O tipo do `on` do Electrobun não lista o "new-window-open", mas o evento chega igual aos outros
  // (`new-window-open-<id>`, `proc/native.ts`).
  const onView = win.webview.on.bind(win.webview) as unknown as (name: "new-window-open", fn: (e: { data?: { detail?: unknown } }) => void) => void;
  onView("new-window-open", (e) => void linkOpener.request(newWindowUrl(e.data?.detail)));

  // O Histórico aberto recebe cada ditado novo na hora.
  const off = name === "history" ? stores.history.onAdded((entry) => rpc.send.event({ name: "history.added", payload: entry })) : undefined;
  // A janela principal na vista (spec #9839): com o foco. Fora da vista, a pergunta do agente vira notificação.
  if (name === "hub") {
    win.on("focus", () => setHubFocused(true));
    win.on("blur", () => setHubFocused(false));
    saveHubFrameOnChange(win);
  }
  win.on("close", () => {
    log(name, "window closed");
    if (name === "hub") setHubFocused(false);
    rpcs.delete(name);
    off?.();
    (uis.get(name)?.engine ?? engine)?.stop();
    uis.delete(name);
    open.delete(name);
    for (const fn of closeListeners) fn(name);
  });
  if (hidden) return;
  win.activate();
  if (name === "hub") setHubFocused(true);
}

export const openWindows = (): WindowName[] => [...open.keys()];

let hubFocused = false;
function setHubFocused(focused: boolean): void {
  if (hubFocused === focused) return;
  hubFocused = focused;
  stores.agent.noticeView(hubInView());
  catOverlay?.setHubInView(hubInView());
}

// O gato no overlay (spec #9810): com o hub fora da vista, o gato de um pedido aparece por cima dos outros apps, numa
// janela do helper. O hub esconde o do canto enquanto ele está lá (`kiwicat.where`).
let agentVoice: AttachedAgentVoice | undefined;
/** O atalho Control (spec #9876): fala ao agente pelo helper; o gato das janelas segue o `agent.voice`. */
export function startAgentVoice(sidecar: Sidecar): void {
  agentVoice?.stop();
  agentVoice = attachAgentVoice({
    agent: stores.agent,
    settings: stores.settings,
    helper: { send: (c) => sidecar.send(c), on: (type, fn) => sidecar.on(type, fn), onReady: (fn) => sidecar.on("ready", fn) },
    ui: (state) => {
      for (const rpc of rpcs.values()) rpc.send.event({ name: "agent.voice", payload: state });
      catOverlay?.overlay.voice(state);
    },
    log: (m) => console.log(m),
  });
}

let catOverlay: AttachedCatOverlay | undefined;
export function startCatOverlay(sidecar: Sidecar): void {
  catOverlay?.stop();
  catOverlay = attachCatOverlay({
    agent: stores.agent,
    settings: stores.settings,
    helper: {
      send: (c) => sidecar.send(c),
      onReady: (fn) => sidecar.on("ready", fn),
      onHold: (fn) => sidecar.on("catOverlay.hold", (e) => fn(e.held === true)),
      onTouch: (fn) => sidecar.on("catOverlay.touch", () => fn()),
      onClose: (fn) => sidecar.on("catOverlay.close", () => fn()),
      onOpenPath: (fn) => sidecar.on("catOverlay.openPath", (e) => fn(e.path)),
    },
    openPath: async (p) => capabilities["notes.openPath"]({ path: p }),
    pageDir: path.join(PATHS.VIEWS_FOLDER, "ui", "catoverlay"),
    where: (overlay) => {
      for (const rpc of rpcs.values()) rpc.send.event({ name: "kiwicat.where", payload: { overlay } });
    },
    log: (m) => console.log(m),
  });
  // O `/usage` de depois do pedido (ADR 0013) espera a conversa com o gato acabar (#13380, #13853).
  stores.agent.useConversationCheck(() => catOverlay?.overlay.visible ?? false);
  catOverlay.setHubInView(hubInView());
}

/** A janela principal está na vista: aberta, com o foco e não minimizada (spec #9839). */
export function hubInView(): boolean {
  const hub = open.get("hub");
  return !!hub && hubFocused && !hub.isMinimized();
}

/** Fecha a janela, se estiver aberta (a intro, quando termina). */
export function closeWindow(name: WindowName): void {
  open.get(name)?.close();
}

/**
 * A janela da intro (T2308): sem barra, sem semáforos e sem fundo, só o ícone animado no meio da tela principal. A
 * página tem fundo transparente; o palco é o ícone, de cantos arredondados. Desde o T16769 ela cobre também o lugar
 * do hub, para a moldura crescer até ele (`intro.layout`).
 */
function introChrome() {
  introPlan ??= planIntro();
  return { frame: introPlan.frame, titleBarStyle: "hidden" as const, transparent: true };
}

// ------------------------------------------------------------------ o fim da intro vira o hub (T16769, spec #16759)

/** O plano da abertura do zero: onde o hub abre, a janela da intro e o que a página dela recebe. */
let introPlan: { hub: Rect; frame: Rect; layout: IntroLayout | null } | null = null;

const hubFrameFile = () => path.join(stores.dir, "hub-frame.json");

/** Onde o hub abre: o lugar salvo (o `hub-frame.json`, posto numa tela que existe) ou o meio da área útil. */
function planHubFrame(): Rect {
  let saved: string | null = null;
  try {
    saved = readFileSync(hubFrameFile(), "utf8");
  } catch {}
  const areas = Screen.getAllDisplays().map((d) => d.workArea).filter((a) => a.width > 0 && a.height > 0);
  return hubFrame(parseHubFrame(saved), Screen.getPrimaryDisplay().workArea, areas, SPECS.hub);
}

function planIntro(): { hub: Rect; frame: Rect; layout: IntroLayout | null } {
  const hub = planHubFrame();
  return { hub, ...introWindow(Screen.getPrimaryDisplay().workArea, SPECS.intro, hub) };
}

/** Guarda o lugar do hub quando ele se move ou muda de tamanho (fora de maximizado e de tela cheia). */
function saveHubFrameOnChange(win: BrowserWindow): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    clearTimeout(timer);
    timer = undefined;
    try {
      if (win.isMaximized() || win.isFullScreen() || win.isMinimized()) return;
      writeFileSync(hubFrameFile(), JSON.stringify(win.getFrame()));
    } catch (e) {
      log("hub", `couldn't save the window frame: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(save, 400);
  };
  win.on("move", later);
  win.on("resize", later);
  win.on("close", () => timer && save());
}

/**
 * A `IntroDeps.prepare`: planeja a abertura (se a intro ainda não planejou) e abre o hub escondido no lugar dele, com
 * o conteúdo transparente (`__kiwiHold`) até o `revealHub`. Diz se ele ficou aberto. Nunca rejeita.
 */
export async function prepareHub(): Promise<boolean> {
  introPlan ??= planIntro();
  if (!introPlan.layout) return false;
  await oneAtATime(opening, "hub", () => openWindow("hub", true), (e) =>
    log("hub", `couldn't open the window: ${e instanceof Error ? e.message : String(e)}`),
  );
  const hub = open.get("hub");
  if (!hub || hub.isVisible()) return false;
  hub.webview.executeJavascript("window.__kiwiHeld = true; window.__kiwiHold?.()");
  return true;
}

/**
 * A `IntroDeps.reveal`: mostra o hub escondido, por cima da intro, e o conteúdo dele entra só com o fade (sem o
 * `window-in`, que sobe e cresce). Diz se mostrou. Nunca rejeita.
 */
export async function revealHub(): Promise<boolean> {
  const hub = open.get("hub");
  if (!hub) return false;
  try {
    hub.show();
    hub.activate();
    setHubFocused(true);
    hub.webview.executeJavascript("window.__kiwiHeld = false; window.__kiwiReveal?.()");
    return true;
  } catch (e) {
    log("hub", `couldn't show the window: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

/** A intro fechou: o próximo plano (outra abertura do zero não acontece no mesmo processo) é lido de novo. */
onWindowClosed((name) => {
  if (name === "intro") introPlan = null;
  // A janela das Notas fechou (T19969): o aberto nelas não é mais "esse arquivo" para o agente.
  if (name === "hub" || name === "notes") stores.agent.setOpenNote(null);
});

/** Manda um evento a uma janela aberta. Devolve se ela estava aberta. */
/** O passo da primeira abertura mudou (T20796): o hub recebe o estado inteiro, só enquanto o `firstRun` está `pending`. */
export async function setupChanged(): Promise<void> {
  const status = (await capabilities["setup.status"]({})) as SetupStatus;
  if (status.firstRun === "pending") void sendToWindow("hub", "setup.changed", status);
}

export function sendToWindow<E extends keyof UiEvents>(name: WindowName, event: E, payload: UiEvents[E]): boolean {
  const rpc = rpcs.get(name);
  if (!rpc) return false;
  rpc.send.event({ name: event, payload });
  return true;
}

// O agente (T8678): o estado e a resposta ao vivo vão para todas as janelas abertas (a seção Agente fica no hub).
stores.agent.onStatus((status) => {
  for (const rpc of rpcs.values()) rpc.send.event({ name: "agent.status", payload: status });
});
stores.agent.onTurn((turn) => {
  for (const rpc of rpcs.values()) rpc.send.event({ name: "agent.turn", payload: turn });
});
// O registro mudou (spec #9480): a tela "Atividade do agente" lê de novo.
// A pergunta na dúvida (spec #9873): só os ids; a janela lê o cartão pelo `agent.question`.
stores.agent.onQuestionChanged((e) => {
  for (const rpc of rpcs.values()) rpc.send.event({ name: "agent.questionChanged", payload: e });
});
// A memória do agente (spec #11469): o balão "Anotei" e a tela de Ajustes.
stores.agent.onMemoryChanged((view) => {
  for (const rpc of rpcs.values()) rpc.send.event({ name: "agent.memoryChanged", payload: view });
});
// O fim de uma rotina (spec #12150): o balão do gato.
stores.agent.onRoutine((e) => {
  for (const rpc of rpcs.values()) rpc.send.event({ name: "agent.routine", payload: e });
});
// A proposta da reunião (spec #8360): nasceu, foi escolhida, aplicada ou descartada.
stores.agent.onProposalsChanged((proposals) => {
  for (const rpc of rpcs.values()) rpc.send.event({ name: "agent.proposalsChanged", payload: { proposals } });
});
// O medidor (spec #11084): o gasto que o agente informou mudou.
stores.agent.onUsageChanged((view) => {
  for (const rpc of rpcs.values()) rpc.send.event({ name: "agent.usageChanged", payload: view });
});
stores.agent.onNoticeChanged((state) => {
  for (const rpc of rpcs.values()) rpc.send.event({ name: "agent.noticeChanged", payload: state });
});
stores.agent.onActivity((request) => {
  for (const rpc of rpcs.values()) rpc.send.event({ name: "agent.activityChanged", payload: { request } });
});

stores.recoveries.onChanged(()=>{
  for(const rpc of rpcs.values())rpc.send.event({name:"history.changed",payload:{}});
  homeChanged();
});

stores.folders.onChange(view => {
  for (const rpc of rpcs.values()) rpc.send.event({name:"notes.folderChanged",payload:view});
});

/** A tray click uses the same picker/confirmation/progress path as the Notes UI. Never called by an agent. */
export async function openNotesFolderFromMenu():Promise<void>{
  try { await capabilities["notes.openFolder"]({}); } catch { /* the folder state carries the error to the UI */ }
}
