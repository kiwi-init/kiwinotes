// Kiwi Notes: processo principal. Vive na barra de menu, sem ícone no Dock.
import path from "node:path";

import { AgentControl, PATHS, Tray, Utils } from "electrobun/bun";

import { UI_WINDOWS } from "../shared/ui-contract.ts";
import { claimInstance, releaseInstance } from "./instance.ts";
import { PERMISSION_NAMES } from "./permissions.ts";
import { Session, session, type SessionStatus } from "./session.ts";
import { stores } from "./stores.ts";
import { openWindows, showWindow, type WindowName } from "./windows.ts";

// Um Kiwi Notes por vez (T992): antes do ícone da barra e do helper. Com o mesmo .app já de pé, este sai; um build
// velho de pé é substituído. Com KIWI_DEBUG=1 nunca derruba outro.
if (claimInstance({ dir: stores.dir, mayReplace: process.env.KIWI_DEBUG !== "1" }).action === "exit") process.exit(0);

Utils.setDockIconVisible(false);

const tray = new Tray({
  title: "",
  image: path.join(PATHS.VIEWS_FOLDER, "..", "assets", "trayTemplate@2x.png"),
  template: true,
  width: 18,
  height: 18,
});

/** A primeira linha do menu diz se dá para ditar agora, e por que não. */
export function statusLabel(s: SessionStatus): string {
  if (!s.connected) return "Iniciando…";
  if (!s.hotkeyActive) return `Atalho desligado: falta ${s.missing.includes("inputMonitoring") ? PERMISSION_NAMES.inputMonitoring : "permissão"}`;
  if (s.stt === "loading" || s.stt === "starting") return "Preparando o modelo de voz…";
  if (s.stt === "unavailable") return "Modelo de voz indisponível";
  return "Pronto para ditar";
}

function setMenu(s: SessionStatus) {
  tray.setMenu([
    { type: "normal", label: statusLabel(s), action: "status", enabled: false },
    // Enquanto faltar alguma permissão: pede a próxima (o diálogo do macOS, ou os Ajustes no lugar certo).
    ...(s.connected && s.missing.length
      ? [{ type: "normal" as const, label: `Permitir acesso… (${PERMISSION_NAMES[s.missing[0]!]})`, action: "permissions" }]
      : []),
    { type: "divider" },
    { type: "normal", label: "Notas…", action: "notes" },
    { type: "normal", label: "Histórico…", action: "history" },
    { type: "normal", label: "Configurações…", action: "settings" },
    { type: "divider" },
    { type: "normal", label: "Sair do Kiwi Notes", action: "quit" },
  ]);
}

// O sidecar (atalho, mic, STT, overlay, colagem) e o fluxo do ditado (T58).
const dictation = new Session(PATHS.VIEWS_FOLDER);
session.set(dictation);
setMenu(dictation.status());
dictation.onStatus(setMenu);
// O atalho global da janela Notas (T1499): quem vê a tecla é o helper, que já tem o Monitoramento de Entrada.
dictation.sidecar.on("hotkey.notes", () => void showWindow("notes"));
dictation.start();

tray.on("tray-clicked", (event) => {
  const action = (event as { data?: { action?: string } }).data?.action;
  switch (action) {
    case "notes":
    case "history":
    case "settings":
      void showWindow(action);
      break;
    case "permissions":
      void dictation.permissions.askNext();
      break;
    case "quit":
      quit();
  }
});

function quit(): never {
  dictation.stop();
  tray.remove();
  releaseInstance(stores.dir);
  process.exit(0);
}

// Um build novo pede para este sair (T992): sai limpo, parando o helper e soltando o socket.
process.on("SIGTERM", () => quit());

// Com ELECTROBUN_AGENT_CONTROL=1 (o `bun dev` liga), agentes abrem as janelas
// sem clicar na barra de menu:
//   bun run agent call actions.invoke '{"name":"open-window","params":{"window":"settings"}}'
AgentControl.registerAction("open-window", {
  description: "Abre ou traz para a frente uma janela do Kiwi Notes",
  params: { window: UI_WINDOWS.join(" | ") },
  handler: async (params) => {
    const name = params.window as WindowName;
    if (!(UI_WINDOWS as readonly string[]).includes(name)) throw new Error(`unknown window ${String(params.window)}`);
    await showWindow(name);
    return { open: openWindows() };
  },
});

// Põe um ditado no histórico sem microfone nem colagem (testes da janela Histórico):
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

// Com KIWI_DEBUG=1, um áudio sintético (do `say`, nunca gravação de alguém) faz o caminho inteiro de um ditado:
// STT → limpeza → `insert.text` em dryRun (nada é colado nem vai para o clipboard) → histórico. É o teste de ponta a
// ponta dos agentes, sem microfone (T457, #490):
//   bun run agent call actions.invoke '{"name":"debug-transcribe","params":{"path":"/tmp/frase.aiff"}}'
if (process.env.KIWI_DEBUG === "1") {
  AgentControl.registerAction("debug-transcribe", {
    description: "Passa um arquivo de áudio sintético pelo fluxo do ditado, em dryRun (só com KIWI_DEBUG=1)",
    params: { path: "caminho absoluto do áudio (WAV, AIFF…; o helper converte)" },
    handler: async (params) => {
      // Resolve com o ditado (também o vazio e o com erro), ou desiste em 60 s.
      let timer: Timer | undefined;
      const done = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error("no transcript in 60 s")), 60_000);
        dictation.dictation.onDone = resolve;
      });
      try {
        await dictation.sidecar.request({ type: "debug.transcribe", path: String(params.path ?? "") });
        return await done;
      } finally {
        clearTimeout(timer);
        dictation.dictation.onDone = undefined;
        done.catch(() => {});
      }
    },
  });
}

console.log("Kiwi Notes is running in the menu bar");
