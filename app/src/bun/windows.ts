// As janelas do Kiwi Notes. Cada uma é uma UI do AppEngine em modo host (T1192, ADR 0006): o engine sobe quando a
// janela abre, mostra a UI mais nova que funciona (a de fábrica do .app, ou uma instalada pelo canal local), troca
// quando chega uma nova e volta atrás se ela falhar. A UI só fala com o main pelo contrato (src/shared/ui-contract.ts).

import { mkdirSync } from "node:fs";
import path from "node:path";

import { BrowserView, BrowserWindow, PATHS, Screen, Updater, Utils } from "electrobun/bun";
import type { AppEngine } from "electrobun/bun/appengine";

import { type HubSection, UI_CAPABILITIES, type UiEvents, type UiWindow } from "../shared/ui-contract.ts";
import { WINDOW_SPECS as SPECS } from "../shared/window-specs.ts";
import { type AppEngineRPC, appEnginePageScript } from "./appengine-devkit.ts";
import { session } from "./session.ts";
import { stores } from "./stores.ts";
import { type CapabilityDeps, uiCapabilities } from "./ui-capabilities.ts";
import { builtInFrom, channelUrlOrOff, createUiEngine, devServerAllowed, directInvoke, enginePreload, oneAtATime, servedDir } from "./ui-engine.ts";
import { UI_TRUSTED_KEYS } from "./ui-keys.ts";
import { windowSecurity } from "./window-security.ts";
import { fetchRemoteImage } from "../notes/remote-image.ts";
import { NOT_RECORDING } from "../shared/meetings.ts";
import { MeetingHostError } from "./meetings.ts";

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
let hubSection: () => HubSection | null = () => null;
const closeListeners = new Set<(name: WindowName) => void>();
let about: CapabilityDeps["about"];
/** A seção Sobre: a versão e as atualizações, que o index.ts liga ao `AppUpdates` (T2386). */
export function provideAbout(a: NonNullable<CapabilityDeps["about"]>): void {
  about = a;
}

export function provideHubSection(fn: () => HubSection | null): void {
  hubSection = fn;
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

const capabilities = uiCapabilities({
  introDone: () => {
    for (const fn of introDoneListeners) fn();
  },
  dictionary: stores.dictionary,
  snippets: stores.snippets,
  history: stores.history,
  dictionaryChanged: (terms) => void session.get()?.dictionaryChanged(terms),
  snippetsChanged: (snippets) => session.get()?.snippetsChanged(snippets),
  settings: stores.settings,
  settingsChanged: (settings) => {
    void session.get()?.settingsChanged(settings);
    // A Aparência vale para todas as janelas abertas (T2503).
    for (const rpc of rpcs.values()) rpc.send.event({ name: "settings.changed", payload: settings });
  },
  clipboardWrite: (text) => Utils.clipboardWriteText(text),
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
  attachments: stores.attachments,
  // A imagem de fora de uma nota, só depois do clique no cartão (T2984, #3039).
  remoteImage: (url) => fetchRemoteImage(url),
  // O seletor de microfone dos Ajustes (T3230): o helper lista as entradas, sem abrir nenhuma.
  audioInputs: async () => (await session.get()?.audioInputs()) ?? null,
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
  about: {
    info: () => about?.info() ?? { version: "dev", channel: "dev", releaseUrl: null },
    view: () => about?.view() ?? { state: "off", reason: "o atualizador ainda não subiu", lastCheck: null },
    check: () => about?.check() ?? Promise.resolve({ state: "off", reason: "o atualizador ainda não subiu", lastCheck: null }),
    apply: () => about?.apply() ?? Promise.resolve({ state: "off", reason: "o atualizador ainda não subiu", lastCheck: null }),
  },
});

/** O RPC de cada janela aberta, para os eventos que valem para todas (`notes.changed`). */
const rpcs = new Map<WindowName, { send: { event(e: { name: string; payload: unknown }): void } }>();
stores.notes.onChanged((paths) => {
  for (const rpc of rpcs.values()) rpc.send.event({ name: "notes.changed", payload: { paths } });
});
// Os outros arquivos do cofre (T3370): a árvore mostra todos.
stores.notes.onOtherFiles((paths) => {
  for (const rpc of rpcs.values()) rpc.send.event({ name: "files.changed", payload: { paths } });
});

const preload = enginePreload(UI_CAPABILITIES, appEnginePageScript);

const open = new Map<WindowName, BrowserWindow>();

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

async function openWindow(name: WindowName): Promise<void> {
  const existing = open.get(name);
  if (existing) {
    existing.show();
    existing.activate();
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
        invoke: ({ cap, args }) => (engine ? engine.invoke(cap, args) : directInvoke(capabilities, cap, args)),
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
    preload,
    ...(name === "intro" ? introChrome(spec) : { frame: { width: spec.width, height: spec.height }, titleBarStyle: "hiddenInset" as const }),
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
    engine = createUiEngine({
      name,
      dir,
      builtIn: builtInFrom(path.join(PATHS.VIEWS_FOLDER, "ui", name)),
      trustedKeys: UI_TRUSTED_KEYS,
      capabilities,
      manifestUrl: channelUrlOrOff(process.env.KIWI_UI_CHANNEL, name, (m) => log(name, m)),
      show: (ui) => {
        log(name, `showing UI ${ui.uiVersion}${ui.manifest ? "" : " (built-in)"}`);
        const html = decoder.decode(ui.index);
        // A janela nasce já com a UI: um html provisório no construtor chegava depois e cobria a UI (T1192).
        if (!created) {
          created = new BrowserWindow({ ...options, html, viewsRoot: servedDir(dir) });
          created.webview.on("render-process-gone", () => engine?.rendererGone());
        } else created.webview.loadHTML(html);
      },
    });
    engine.on((e) => log(name, "reason" in e ? `${e.type}: ${e.reason}` : e.type));
    try {
      await engine.start();
      if (!created) throw new Error("the engine showed nothing");
    } catch (e) {
      // Sem janela pela metade nem engine de pé: o próximo clique tenta do zero.
      engine.stop();
      (created as BrowserWindow | null)?.close();
      throw e;
    }
    win = created;
  }
  open.set(name, win);
  rpcs.set(name, rpc);

  // O Histórico aberto recebe cada ditado novo na hora.
  const off = name === "history" ? stores.history.onAdded((entry) => rpc.send.event({ name: "history.added", payload: entry })) : undefined;
  win.on("close", () => {
    log(name, "window closed");
    rpcs.delete(name);
    off?.();
    engine?.stop();
    open.delete(name);
    for (const fn of closeListeners) fn(name);
  });
  win.activate();
}

export const openWindows = (): WindowName[] => [...open.keys()];

/** Fecha a janela, se estiver aberta (a intro, quando termina). */
export function closeWindow(name: WindowName): void {
  open.get(name)?.close();
}

/**
 * A janela da intro (T2308): sem barra, sem semáforos e sem fundo, só o ícone animado no meio da tela principal. A
 * página tem fundo transparente; o palco é o ícone, de cantos arredondados.
 */
function introChrome(spec: { width: number; height: number }) {
  const area = Screen.getPrimaryDisplay().workArea;
  const x = Math.round(area.x + (area.width - spec.width) / 2);
  const y = Math.round(area.y + (area.height - spec.height) / 2);
  return { frame: { x, y, width: spec.width, height: spec.height }, titleBarStyle: "hidden" as const, transparent: true };
}

/** Manda um evento a uma janela aberta. Devolve se ela estava aberta. */
export function sendToWindow<E extends keyof UiEvents>(name: WindowName, event: E, payload: UiEvents[E]): boolean {
  const rpc = rpcs.get(name);
  if (!rpc) return false;
  rpc.send.event({ name: event, payload });
  return true;
}
