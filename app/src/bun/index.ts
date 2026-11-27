// Kiwi Notes: processo principal. Abre no hub, a janela principal (T2121, #2100), e vive na barra de menu: com o hub
// fechado, sai do Dock e segue rodando.
import path from "node:path";
import { existsSync } from "node:fs";

import Electrobun, { AgentControl, ApplicationMenu, PATHS, Tray, Updater, Utils } from "electrobun/bun";

import { type AppChannel, type HubSection, isHubSection, releaseNotesUrl, UI_WINDOWS } from "../shared/ui-contract.ts";
import { CALENDAR_NOTICE_PREFIX, micRecording } from "./calendar-alerts.ts";
import { Hub } from "./hub.ts";
import { makeIntro } from "./intro.ts";
import { repairInstallRegistry, runningBundle } from "./install-registry.ts";
import { cleanLaunchServices, realLsRegister } from "./launch-services.ts";
import { claimInstance, releaseInstance } from "./instance.ts";
import { mainLocale } from "./locale.ts";
import { appMenu, trayMenu } from "./menus.ts";
import { appLocale } from "../shared/i18n/index.ts";
import { systemLanguages } from "./system-language.ts";
import { helperPath, Session, session, type SessionStatus } from "./session.ts";
import { helperRunner } from "../notes/ocr.ts";
import { helperPdf } from "../notes/export.ts";
import { wireGate } from "../notes/semantic/gate.ts";
import { stores } from "./stores.ts";
import { installFileLog } from "./file-log.ts";
import { AppUpdates, channelOf, updateMenuLabel, updatesView } from "./updates.ts";
import { watchBusy } from "./slow-log.ts";
import { appSlowLog, closeWindow, setupChanged, hubInView, openNotesFolderFromMenu, onIntroDone, onWindowClosed, openWindows, prepareHub, provideAbout, revealHub, startCatOverlay, startAgentVoice, startCatVoiceOutput, startCalendarAlerts, provideHubSection, provideOpenInHub, sendToWindow, homeChanged, showWindow, type WindowName } from "./windows.ts";
import { loadNotices, NOTIFY_LIBRARY } from "./notices.ts";

// Um Kiwi Notes por vez (T992): antes do ícone da barra e do helper. Com o mesmo .app já de pé, este sai; um build
// velho de pé é substituído. Com KIWI_DEBUG=1 nunca derruba outro.
// T5350: o log em arquivo, antes de qualquer linha (o .app de release não tem terminal).
installFileLog(stores.dir);
if (claimInstance({ dir: stores.dir, mayReplace: process.env.KIWI_DEBUG !== "1" }).action === "exit") process.exit(0);

Utils.setDockIconVisible(false);
// O Bun parado (spec #12918): uma tarefa síncrona pesada segura todas as respostas das telas; o log conta quanto.
watchBusy(appSlowLog);

// O hub: abrir do zero toca a intro (#2078, T2308) e abre; abrir de novo, só abre. O Dock acompanha.
const hub = new Hub({
  intro: makeIntro({
    show: () => showWindow("intro"),
    close: () => closeWindow("intro"),
    onDone: onIntroDone,
    onClosed: (fn) => onWindowClosed((name) => name === "intro" && fn()),
    // O fim vira o hub (T16769): ele abre escondido no lugar dele e aparece por cima da intro.
    prepare: prepareHub,
    reveal: revealHub,
  }),
  show: () => showWindow("hub"),
  isOpen: () => openWindows().includes("hub"),
  navigate: (section, path) => void sendToWindow("hub", "hub.navigate", path ? { section, path } : { section }),
  setDock: (visible) => Utils.setDockIconVisible(visible),
});
provideHubSection(() => hub.takeRequest());
provideOpenInHub((path) => void hub.open("notes", path));
onWindowClosed((name) => name === "hub" && hub.closed());
const openHub = (section?: HubSection) => void hub.open(section);

// A notificação quando o agente espera uma resposta (spec #9839): o próprio app notifica, pela dylib ao lado do helper.
// Nada aqui pede a permissão; só o botão "Ligar as notificações" de Ajustes › Agente. O clique volta pela engine.
// A aba do Calendário (T32155): enquanto ela não está no hub, o clique só abre o hub.
const CALENDAR_SECTION: string = "calendar";
// Os avisos do Calendário (spec #32129, T32156) saem pelas mesmas notificações, depois que o helper (o ditado) existe.
const noticesLoaded = loadNotices(path.join(PATHS.VIEWS_FOLDER, "..", "bin", NOTIFY_LIBRARY), (m) => console.log(m));
void noticesLoaded.then((notices) => stores.agent.attachNotice({ notices, inView: hubInView, show: () => openHub(), locale: () => mainLocale.get() }));
Electrobun.events.on("notification-response", (e) => {
  // O clique num aviso do Calendário abre a aba dele.
  if (e.data.id.startsWith(CALENDAR_NOTICE_PREFIX) && e.data.action === "default") return openHub(isHubSection(CALENDAR_SECTION) ? CALENDAR_SECTION : undefined);
  stores.agent.noticeResponse(e.data);
});

// O menu do app (menus.ts), na língua do app: refeito quando ela muda (T28192).
const setAppMenu = () => ApplicationMenu.setApplicationMenu(appMenu(mainLocale.get()));
setAppMenu();
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

// A atualização automática (T1969): o menu ganha "Atualizar e reiniciar" quando uma versão nova, já conferida, está
// pronta. Nada reinicia sem o clique.
// Antes do Updater: o registro de instalação do Electrobun que aponta para outro app (um build de teste velho) faz toda
// troca de versão falhar com InvalidUpdateIdentity (T2399, a rc3 do harry). Ele sai do caminho, renomeado ao lado.
{
  const registry = repairInstallRegistry({ channelRoot: Utils.paths.userData, bundle: runningBundle(process.execPath) });
  if (registry.state === "moved") console.warn(`[updates] install registry pointed at ${registry.recorded}; moved to ${registry.movedTo}`);
  else if (registry.state === "skipped" && registry.reason !== "not a packaged .app") console.warn(`[updates] install registry: ${registry.reason}`);
}
// "Buscar atualizações" em Ajustes (T25110): lido a cada checagem; desligado, o Updater não vai à rede.
const updates = new AppUpdates({ updater: Updater, enabled: async () => (await stores.globalSettings.load()).checkUpdates });
let appVersion = "";
let appChannel: AppChannel = "dev";
void Updater.getLocalInfo().then((i) => {
  appVersion = i.version;
  appChannel = channelOf(i.channel);
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
const updatesNow = () => updatesView(updates.status(), updates.lastCheck(mainLocale.get()), mainLocale.get());
provideAbout({
  info: () => ({ version: appVersion, channel: appChannel, releaseUrl: appChannel === "dev" ? null : releaseNotesUrl(appVersion) }),
  view: updatesNow,
  check: async () => (await updates.check(), updatesNow()),
  apply: async () => (await updates.apply(), updatesNow()),
  checkUpdatesChanged: (on) => updates.settingChanged(on),
});
updates.onChange(() => void sendToWindow("hub", "updates.status", updatesNow()));

function setMenu(s: SessionStatus) {
  const locale = mainLocale.get();
  tray.setMenu(trayMenu(s, { label: updateMenuLabel(updates.status(), appVersion, locale), ready: updates.status().kind === "ready" }, locale));
}

// O sidecar (atalho, mic, STT, overlay, colagem) e o fluxo do ditado (T58).
const dictation = new Session(PATHS.VIEWS_FOLDER);
session.set(dictation);
// A primeira abertura (T20796, spec #20780): sem settings.json nem permissions.json (instalação nova), o settings.json nasce com `firstRun: "pending"`. Até o fim do
// passo do onboarding, as permissões não são pedidas sozinhas: o passo explica e pede pelo botão de cada uma.
const firstRun = stores.globalSettings.beginFirstRun([path.join(stores.dir, "permissions.json")]).catch((e: unknown) => {
  console.warn(`[setup] couldn't read settings.json (${e instanceof Error ? e.message : String(e)})`);
  return "done" as const;
});
dictation.permissions.holdWhile(async () => (await firstRun) === "pending" && (await stores.settings.load()).firstRun === "pending");
// Entrou ou saiu um microfone (T3230): os Ajustes (no hub ou na janela deles) listam de novo.
dictation.sidecar.on("audio.inputs.changed", () => {
  for (const w of ["hub", "settings"] as const) sendToWindow(w, "audio.inputs.changed", {});
});
// A busca pelo sentido para enquanto a pessoa dita, fala com o agente ou grava uma reunião (spec #24228).
wireGate(dictation.sidecar, dictation.meetings, stores.gate);
// A gravação de reunião começou, parou ou pausou o canal "você" (R6): o card ao vivo da aba Reuniões.
dictation.meetings.onChange((live) => {
  sendToWindow("hub", "meetings.live", live);
  // A que parou vira a "última reunião" da tela de Início (T15847).
  homeChanged();
});
// O texto dos anexos (T2709): o mesmo helper, no modo `--ocr` (lê e sai), em prioridade de fundo.
if (existsSync(helperPath(PATHS.VIEWS_FOLDER))) stores.folders.setOcrRunner(helperRunner(helperPath(PATHS.VIEWS_FOLDER)));
// O PDF do exportar (T2684): o mesmo helper, no modo `--export-pdf` (imprime fora da tela e sai).
if (existsSync(helperPath(PATHS.VIEWS_FOLDER))) stores.folders.setPdf(helperPdf(helperPath(PATHS.VIEWS_FOLDER)));
setMenu(dictation.status());
dictation.onStatus(setMenu);
dictation.onStatus(() => void setupChanged().catch(() => {}));
// O atalho global da janela Notas (T1499): quem vê a tecla é o helper, que já tem o Monitoramento de Entrada.
dictation.sidecar.on("hotkey.notes", () => openHub("notes"));
{
  const mic = micRecording((t, fn) => dictation.sidecar.on(t, fn));
  void noticesLoaded.then((notices) => startCalendarAlerts(notices, mic.recording));
}
dictation.start();
startCatOverlay(dictation.sidecar);
startAgentVoice(dictation.sidecar);
startCatVoiceOutput(dictation.sidecar);
updates.onChange(() => setMenu(dictation.status()));
// A língua do app (spec #28171, T28192): a dos Ajustes ao abrir, pela mesma função das telas; a troca chega pelo
// `localeChanged` das janelas (windows.ts). O menu do app e a bandeja se refazem nela.
mainLocale.onChange(() => {
  setAppMenu();
  setMenu(dictation.status());
  // O Sobre aberto lê o erro e o motivo das atualizações de novo, na língua nova (T29006).
  void sendToWindow("hub", "updates.status", updatesNow());
});
void stores.settings.load().then(
  (s) => mainLocale.set(appLocale(s.language, systemLanguages()).locale),
  () => {},
);
void updates.start();

tray.on("tray-clicked", (event) => {
  const action = (event as { data?: { action?: string } }).data?.action;
  switch (action) {
    case "hub":
      openHub();
      break;
    case "notes-folder":
      openHub("notes");
      void openNotesFolderFromMenu();
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
  const meetingFlush = dictation.stop();
  tray.remove();
  // A versão pendente de uma nota editada há menos de 2 min (T2680) vai para o histórico antes de sair, com um teto:
  // sair nunca espera mais que isso.
  const exit = () => { releaseInstance(stores.dir); process.exit(0); };
  // O supervisor precisa de ~2 s para escalar SIGTERM → SIGKILL antes de o Bun sair.
  setTimeout(exit, 3_000);
  // O modelo da busca pelo sentido (T6013) solta o ONNX Runtime antes de sair: sair com ele carregado derruba o Bun.
  // O programa do agente (T8678) fecha junto: nunca sobra um Claude Code rodando sozinho.
  void Promise.allSettled([meetingFlush, stores.folders.close().then(() => stores.semantic.close()), stores.agent.close()]).then(exit, exit);
}

// Um build novo pede para este sair (T992): sai limpo, parando o helper e soltando o socket.
process.on("SIGTERM", () => quit());
// Qualquer saída, inclusive a do Updater (T1969), que sai sem passar pelo quit(): o helper não fica órfão e a trava
// de instância é solta para o app novo.
process.on("exit", () => {
  void dictation.stop();
  dictation.sidecar.forceKill();
  stores.agent.killNow();
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
// Abrir do zero: a intro e o hub, depois de o settings.json saber se é a primeira abertura.
void firstRun.finally(() => openHub());
