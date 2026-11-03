// As janelas do Kiwi Notes. Cada uma é uma UI do AppEngine em modo host (T1192, ADR 0006): o engine sobe quando a
// janela abre, mostra a UI mais nova que funciona (a de fábrica do .app, ou uma instalada pelo canal local), troca
// quando chega uma nova e volta atrás se ela falhar. A UI só fala com o main pelo contrato (src/shared/ui-contract.ts).

import { mkdirSync } from "node:fs";
import path from "node:path";

import { BrowserView, BrowserWindow, PATHS, Updater, Utils } from "electrobun/bun";
import type { AppEngine } from "electrobun/bun/appengine";

import { UI_CAPABILITIES, type UiWindow } from "../shared/ui-contract.ts";
import { type AppEngineRPC, appEnginePageScript } from "./appengine-devkit.ts";
import { session } from "./session.ts";
import { stores } from "./stores.ts";
import { uiCapabilities } from "./ui-capabilities.ts";
import { builtInFrom, channelUrlOrOff, createUiEngine, devServerAllowed, directInvoke, enginePreload, oneAtATime, servedDir } from "./ui-engine.ts";
import { UI_TRUSTED_KEYS } from "./ui-keys.ts";
import { windowSecurity } from "./window-security.ts";

export type WindowName = UiWindow;

const SPECS: Record<WindowName, { title: string; width: number; height: number }> = {
  settings: { title: "Configurações", width: 640, height: 520 },
  history: { title: "Histórico", width: 760, height: 600 },
};

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

const capabilities = uiCapabilities({
  dictionary: stores.dictionary,
  snippets: stores.snippets,
  history: stores.history,
  dictionaryChanged: (terms) => void session.get()?.dictionaryChanged(terms),
  snippetsChanged: (snippets) => session.get()?.snippetsChanged(snippets),
  clipboardWrite: (text) => Utils.clipboardWriteText(text),
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
    frame: { width: spec.width, height: spec.height },
    titleBarStyle: "hiddenInset" as const,
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

  // O Histórico aberto recebe cada ditado novo na hora.
  const off = name === "history" ? stores.history.onAdded((entry) => rpc.send.event({ name: "history.added", payload: entry })) : undefined;
  win.on("close", () => {
    log(name, "window closed");
    off?.();
    engine?.stop();
    open.delete(name);
  });
  win.activate();
}

export const openWindows = (): WindowName[] => [...open.keys()];
