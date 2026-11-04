// Kiwi Notes: processo principal. Abre no hub, a janela principal (T2121, #2100), e vive na barra de menu: com o hub
// fechado, sai do Dock e segue rodando.
import path from "node:path";
import { existsSync } from "node:fs";

import Electrobun, { AgentControl, ApplicationMenu, PATHS, Tray, Updater, Utils } from "electrobun/bun";

import { type AppChannel, type HubSection, releaseNotesUrl, UI_WINDOWS } from "../shared/ui-contract.ts";
import { Hub } from "./hub.ts";
import { makeIntro } from "./intro.ts";
import { repairInstallRegistry, runningBundle } from "./install-registry.ts";
import { cleanLaunchServices, realLsRegister } from "./launch-services.ts";
import { claimInstance, releaseInstance } from "./instance.ts";
import { PERMISSION_NAMES } from "./permissions.ts";
import { helperPath, Session, session, type SessionStatus } from "./session.ts";
import { helperRunner } from "../notes/ocr.ts";
import { helperPdf } from "../notes/export.ts";
import { stores } from "./stores.ts";
import { AppUpdates, channelOf, updateMenuLabel, updatesView } from "./updates.ts";
import { closeWindow, onIntroDone, onWindowClosed, openWindows, provideAbout, provideHubSection, sendToWindow, showWindow, type WindowName } from "./windows.ts";

// Um Kiwi Notes por vez (T992): antes do ícone da barra e do helper. Com o mesmo .app já de pé, este sai; um build
// velho de pé é substituído. Com KIWI_DEBUG=1 nunca derruba outro.
if (claimInstance({ dir: stores.dir, mayReplace: process.env.KIWI_DEBUG !== "1" }).action === "exit") process.exit(0);

Utils.setDockIconVisible(false);

// O hub: abrir do zero toca a intro (#2078, T2308) e abre; abrir de novo, só abre. O Dock acompanha.
const hub = new Hub({
  intro: makeIntro({
    show: () => showWindow("intro"),
    close: () => closeWindow("intro"),
    onDone: onIntroDone,
    onClosed: (fn) => onWindowClosed((name) => name === "intro" && fn()),
  }),
  show: () => showWindow("hub"),
  isOpen: () => openWindows().includes("hub"),
  navigate: (section) => void sendToWindow("hub", "hub.navigate", { section }),
  setDock: (visible) => Utils.setDockIconVisible(visible),
});
provideHubSection(() => hub.takeSection());
onWindowClosed((name) => name === "hub" && hub.closed());
const openHub = (section?: HubSection) => void hub.open(section);

// Com o Dock, o app tem menu de app: ⌘Q sai pelo mesmo caminho do "Sair" da barra, ⌘W fecha o hub, e a edição
// (⌘C, ⌘V, ⌘Z…) segue funcionando nas notas.
ApplicationMenu.setApplicationMenu([
  {
    label: "Kiwi Notes",
    submenu: [
      { role: "hide" },
      { role: "hideOthers" },
      { role: "showAll" },
      { type: "separator" },
      { label: "Sair do Kiwi Notes", action: "quit", accelerator: "q" },
    ],
  },
  {
    label: "Editar",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "pasteAndMatchStyle" },
      { role: "selectAll" },
    ],
  },
  { label: "Janela", submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close" }, { type: "separator" }, { role: "bringAllToFront" }] },
]);
ApplicationMenu.on("application-menu-clicked", (event) => {
  if ((event as { data?: { action?: string } }).data?.action === "quit") quit();
});
// Abrir o app com ele já rodando (Finder, Dock, Spotlight): o hub, sem a intro.
Electrobun.events.on("reopen", () => openHub());

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
  // O ditado já funciona; o vocabulário (DICOM, PACS…) ainda não ajuda o modelo a ouvir (T1973).
  if (s.boosting === "loading") return "Pronto para ditar · baixando o vocabulário…";
  return "Pronto para ditar";
}

// A atualização automática (T1969): o menu ganha "Atualizar e reiniciar" quando uma versão nova, já conferida, está
// pronta. Nada reinicia sem o clique.
// Antes do Updater: o registro de instalação do Electrobun que aponta para outro app (um build de teste velho) faz toda
// troca de versão falhar com InvalidUpdateIdentity (T2399, a rc3 do harry). Ele sai do caminho, renomeado ao lado.
{
  const registry = repairInstallRegistry({ channelRoot: Utils.paths.userData, bundle: runningBundle(process.execPath) });
  if (registry.state === "moved") console.warn(`[updates] install registry pointed at ${registry.recorded}; moved to ${registry.movedTo}`);
  else if (registry.state === "skipped" && registry.reason !== "not a packaged .app") console.warn(`[updates] install registry: ${registry.reason}`);
}
const updates = new AppUpdates({ updater: Updater });
let appVersion = "";
let appChannel: AppChannel = "dev";
void Updater.getLocalInfo().then((i) => {
  appVersion = i.version;
  appChannel = channelOf(i.channel, i.version);
  // Os registros velhos do Kiwi no LaunchServices (T3292): as pastas de troca de cada update, os dmg montados e os
  // builds antigos faziam o Spotlight e o Raycast não acharem o app. Uma vez por versão (a abertura depois de um
  // update), com o app já de pé; nada na tela. Fora do dev e do KIWI_DEBUG, que são os builds dos agentes.
  if (appChannel === "dev" || process.env.KIWI_DEBUG === "1") return;
  const bundle = runningBundle(process.execPath);
  setTimeout(() => {
    void cleanLaunchServices({
      bundleId: i.identifier,
      version: i.version,
      bundle,
      markerPath: path.join(stores.dir, "launch-services.json"),
      ls: realLsRegister(),
    })
      .then((r) => {
        if (r.state === "done" && (r.removed.length || r.failed.length)) {
          console.log(`[launch-services] removed ${r.removed.length} stale registration(s)${r.failed.length ? `, ${r.failed.length} failed` : ""}`);
        } else if (r.state === "skipped" && r.reason.startsWith("lsregister")) console.warn(`[launch-services] ${r.reason}`);
      })
      .catch((e) => console.warn(`[launch-services] ${(e as Error).message}`));
  }, 20_000);
});

// A seção Sobre do hub (T2386): a versão, o canal, as notas da versão e o "Verificar atualizações", que roda a mesma
// checagem do menu (com a conferência da assinatura). O hub aberto acompanha cada mudança pelo `updates.status`.
const updatesNow = () => updatesView(updates.status(), updates.lastCheck());
provideAbout({
  info: () => ({ version: appVersion, channel: appChannel, releaseUrl: appChannel === "dev" ? null : releaseNotesUrl(appVersion) }),
  view: updatesNow,
  check: async () => (await updates.check(), updatesNow()),
  apply: async () => (await updates.apply(), updatesNow()),
});
updates.onChange(() => void sendToWindow("hub", "updates.status", updatesNow()));

function setMenu(s: SessionStatus) {
  const update = updateMenuLabel(updates.status(), appVersion);
  tray.setMenu([
    { type: "normal", label: "Abrir o Kiwi Notes", action: "hub" },
    { type: "divider" },
    { type: "normal", label: statusLabel(s), action: "status", enabled: false },
    // Enquanto faltar alguma permissão: pede a próxima (o diálogo do macOS, ou os Ajustes no lugar certo).
    ...(s.connected && s.missing.length
      ? [{ type: "normal" as const, label: `Permitir acesso… (${PERMISSION_NAMES[s.missing[0]!]})`, action: "permissions" }]
      : []),
    { type: "divider" },
    // As janelas soltas de antes viraram seções do hub (#2100).
    { type: "normal", label: "Notas…", action: "notes" },
    { type: "normal", label: "Ditado…", action: "dictation" },
    { type: "normal", label: "Configurações…", action: "settings" },
    { type: "normal", label: "Sobre o Kiwi Notes…", action: "about" },
    { type: "divider" },
    ...(update ? [{ type: "normal" as const, label: update, action: "update", enabled: updates.status().kind === "ready" }] : []),
    { type: "normal", label: "Sair do Kiwi Notes", action: "quit" },
  ]);
}

// O sidecar (atalho, mic, STT, overlay, colagem) e o fluxo do ditado (T58).
const dictation = new Session(PATHS.VIEWS_FOLDER);
session.set(dictation);
// Entrou ou saiu um microfone (T3230): os Ajustes (no hub ou na janela deles) listam de novo.
dictation.sidecar.on("audio.inputs.changed", () => {
  for (const w of ["hub", "settings"] as const) sendToWindow(w, "audio.inputs.changed", {});
});
// O texto dos anexos (T2709): o mesmo helper, no modo `--ocr` (lê e sai), em prioridade de fundo.
if (existsSync(helperPath(PATHS.VIEWS_FOLDER))) stores.ocr.setRunner(helperRunner(helperPath(PATHS.VIEWS_FOLDER)));
// O PDF do exportar (T2684): o mesmo helper, no modo `--export-pdf` (imprime fora da tela e sai).
if (existsSync(helperPath(PATHS.VIEWS_FOLDER))) stores.exporter.setPdf(helperPdf(helperPath(PATHS.VIEWS_FOLDER)));
setMenu(dictation.status());
dictation.onStatus(setMenu);
// O atalho global da janela Notas (T1499): quem vê a tecla é o helper, que já tem o Monitoramento de Entrada.
dictation.sidecar.on("hotkey.notes", () => openHub("notes"));
dictation.start();
updates.onChange(() => setMenu(dictation.status()));
void updates.start();

tray.on("tray-clicked", (event) => {
  const action = (event as { data?: { action?: string } }).data?.action;
  switch (action) {
    case "hub":
      openHub();
      break;
    case "notes":
    case "dictation":
    case "settings":
    case "about":
      openHub(action);
      break;
    case "permissions":
      void dictation.permissions.askNext();
      break;
    case "update":
      // O Electrobun sai do processo, troca o .app e reabre o novo; o helper e a trava saem no "exit", abaixo.
      void updates.apply();
      break;
    case "quit":
      quit();
  }
});

function quit(): void {
  updates.stop();
  dictation.stop();
  tray.remove();
  releaseInstance(stores.dir);
  // A versão pendente de uma nota editada há menos de 2 min (T2680) vai para o histórico antes de sair, com um teto:
  // sair nunca espera mais que isso.
  const exit = () => process.exit(0);
  setTimeout(exit, 800);
  void stores.versions.close().then(exit, exit);
}

// Um build novo pede para este sair (T992): sai limpo, parando o helper e soltando o socket.
process.on("SIGTERM", () => quit());
// Qualquer saída, inclusive a do Updater (T1969), que sai sem passar pelo quit(): o helper não fica órfão e a trava
// de instância é solta para o app novo.
process.on("exit", () => {
  dictation.stop();
  releaseInstance(stores.dir);
});

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
// Abrir do zero: a intro e o hub.
openHub();
