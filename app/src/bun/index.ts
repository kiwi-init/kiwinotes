// Kiwi Notes: processo principal. Vive na barra de menu, sem ícone no Dock.
import path from "node:path";

import { AgentControl, PATHS, Tray, Utils } from "electrobun/bun";

import { stores } from "./stores.ts";
import { openWindows, showWindow, type WindowName } from "./windows.ts";

Utils.setDockIconVisible(false);

const tray = new Tray({
  title: "",
  image: path.join(PATHS.VIEWS_FOLDER, "..", "assets", "trayTemplate@2x.png"),
  template: true,
  width: 18,
  height: 18,
});

tray.setMenu([
  { type: "normal", label: "Histórico…", action: "history" },
  { type: "normal", label: "Configurações…", action: "settings" },
  { type: "divider" },
  { type: "normal", label: "Sair do Kiwi Notes", action: "quit" },
]);

tray.on("tray-clicked", (event) => {
  const action = (event as { data?: { action?: string } }).data?.action;
  switch (action) {
    case "history":
    case "settings":
      void showWindow(action);
      break;
    case "quit":
      tray.remove();
      process.exit(0);
  }
});

// Com ELECTROBUN_AGENT_CONTROL=1 (o `bun dev` liga), agentes abrem as janelas
// sem clicar na barra de menu:
//   bun run agent call actions.invoke '{"name":"open-window","params":{"window":"settings"}}'
AgentControl.registerAction("open-window", {
  description: "Abre ou traz para a frente uma janela do Kiwi Notes",
  params: { window: "settings | history" },
  handler: async (params) => {
    const name = params.window as WindowName;
    if (name !== "settings" && name !== "history") throw new Error(`unknown window ${String(params.window)}`);
    await showWindow(name);
    return { open: openWindows() };
  },
});

// Põe um ditado no histórico sem microfone (testes e agentes), até o T58 ligar o fluxo real:
//   bun run agent call actions.invoke '{"name":"history-add","params":{"raw":"hum oi","text":"Oi.","app":"Slack"}}'
AgentControl.registerAction("history-add", {
  description: "Adiciona um ditado ao histórico (para testar a janela Histórico)",
  params: { raw: "texto cru", text: "texto final", app: "nome do app (opcional)" },
  handler: async (params) => {
    const raw = String(params.raw ?? "");
    const text = String(params.text ?? raw);
    const entry = await stores.history.add({ raw, text, app: params.app ? { name: String(params.app) } : undefined });
    return { id: entry.id };
  },
});

console.log("Kiwi Notes is running in the menu bar");
