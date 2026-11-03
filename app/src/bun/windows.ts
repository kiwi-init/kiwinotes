import { BrowserWindow, Updater } from "electrobun/bun";

import { createRpc } from "./rpc.ts";
import { stores } from "./stores.ts";

export type WindowName = "settings" | "history";

const SPECS: Record<WindowName, { title: string; width: number; height: number }> = {
  settings: { title: "Configurações", width: 640, height: 520 },
  history: { title: "Histórico", width: 760, height: 600 },
};

const DEV_SERVER = "http://localhost:5178";

let base: Promise<string> | null = null;

/** Em dev, usa o servidor do Vite (HMR) se ele estiver de pé; senão, os arquivos do app. */
function viewsBase(): Promise<string> {
  base ??= (async () => {
    if ((await Updater.localInfo.channel()) === "dev") {
      try {
        await fetch(DEV_SERVER, { method: "HEAD" });
        return DEV_SERVER;
      } catch {
        // sem Vite: cai para views://
      }
    }
    return "views://ui";
  })();
  return base;
}

const open = new Map<WindowName, BrowserWindow>();

/**
 * Abre a janela, ou traz para a frente a que já existe. Ela entra com a animação
 * da UI (`enter` em ui/src/kit/Window.tsx): no primeiro load sozinha, e ao voltar
 * para a frente chamamos `__kiwiEnter()`.
 */
export async function showWindow(name: WindowName): Promise<void> {
  const existing = open.get(name);
  if (existing) {
    existing.show();
    existing.activate();
    existing.webview.executeJavascript("window.__kiwiEnter?.()");
    return;
  }
  const spec = SPECS[name];
  const rpc = createRpc();
  const win = new BrowserWindow({
    title: spec.title,
    url: `${await viewsBase()}/${name}/index.html`,
    frame: { width: spec.width, height: spec.height },
    titleBarStyle: "hiddenInset",
    rpc,
  });
  open.set(name, win);
  // O Histórico aberto recebe cada ditado novo na hora.
  const off = name === "history" ? stores.history.onAdded((entry) => rpc.send.historyAdded(entry)) : undefined;
  win.on("close", () => {
    off?.();
    open.delete(name);
  });
  win.activate();
}

export const openWindows = (): WindowName[] => [...open.keys()];
