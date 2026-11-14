import { fakeSpelling } from "./spelling.ts";
import { fakeNotices, isNoticePermission } from "../agent/fake/notices.ts";
import { NO_SPELLING } from "../shared/spelling.ts";
// O Kiwi Notes sem nada na tela, para os agentes testarem o app inteiro (T1739, P0 do harry #1726; AGENTS.md, T1268).
//
// Roda no Bun puro, fora do Electrobun: sem o runtime dele não existe ícone na barra, janela nem pílula. O motor é o
// mesmo do app: o `Session` (o helper Swift e o fluxo do ditado) e as capacidades do contrato do AppEngine
// (`uiCapabilities`), chamadas pelo mesmo caminho validado da UI (a lista e os códigos de erro). Forçado:
// - KIWI_DEBUG=1: o `insert.text` é sempre dryRun e nenhuma permissão é pedida (#490, #537);
// - KIWI_HEADLESS=1: o helper não liga o tap do atalho, a pílula nem o mic, e recusa pedir permissão (`--headless`);
// - os dados e o vault numa pasta própria: nunca ~/Library/Application Support/KiwiNotes nem ~/KiwiNotes (recusado
//   com E_REAL_DATA, T1827).
//
// Controle: um socket unix (0600) em <data>/control.sock, com um JSON por linha (o protocolo do #1745).

import { appendFileSync, chmodSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { statusLabel } from "../bun/session-status.ts";
import { LineWriter } from "./lineWriter.ts";
import path from "node:path";
import type { Socket } from "bun";

import { UI_CAPABILITIES, UI_CONTRACT_VERSION } from "../shared/ui-contract.ts";
import { assertNotRealData } from "./guard.ts";
import { readerFromCapabilities } from "../agent/tools/reader.ts";
import { readNoteModel } from "../agent/note-model.ts";
import { writerFromCapabilities } from "../agent/tools/writer.ts";
import { undoNotesFromCapabilities } from "../agent/undo.ts";
import { remoteImageUrl } from "../notes/remote-image.ts";
import { type AudioInput, type AudioInputs, type MicInUse, type MicrophoneChoice, microphoneUid } from "../shared/microphone.ts";

/** A imagem de fora do headless (um quadrado azul de 16 px): o roteiro testa o caminho do clique sem rede. */
const HEADLESS_IMAGE = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGOw6blDEmIY1TCqYfhqAACorqQQpPjnMgAAAABJRU5ErkJggg==", "base64");

/** As entradas de áudio do headless (T3230): só nomes, nada é aberto. É o caso do #3202, com o AirPods na saída. */
const HEADLESS_AUDIO_INPUTS: AudioInputs = {
  inputs: [
    { uid: "BuiltInMicrophoneDevice", name: "Microfone (MacBook Pro)", transport: "builtin", isDefault: false },
    { uid: "AA-BB-CC-DD-EE-FF:input", name: "AirPods Pro", transport: "bluetooth", isDefault: true },
    { uid: "AppleUSBAudioEngine:Blue:Yeti:1", name: "Yeti Stereo Microphone", transport: "usb", isDefault: false },
  ],
  output: { name: "AirPods Pro", transport: "bluetooth" },
};

/**
 * O `using` do headless (T3344), pela escolha salva, como o helper faria com a tampa aberta e o AirPods na saída e como
 * entrada padrão: o Automático e o Mic do Mac pelo mic do Mac, o Padrão pelo AirPods, um salvo fora da lista cai no
 * Automático.
 */
export function headlessAudioInputs(choice: MicrophoneChoice): AudioInputs {
  const { inputs } = HEADLESS_AUDIO_INPUTS;
  const mac = inputs[0]!;
  const base = { systemDefault: false, fellBack: false, lidClosed: false, choice };
  const device = (d: AudioInput, reason: string, fellBack = false): MicInUse => ({ ...base, name: d.name, transport: d.transport, reason, fellBack });
  const uid = microphoneUid(choice);
  const chosen = uid ? inputs.find((i) => i.uid === uid) : undefined;
  const using: MicInUse =
    choice === "system"
      ? { ...base, name: "AirPods Pro", transport: "bluetooth", systemDefault: true, reason: "system default" }
      : chosen
        ? device(chosen, "chosen device")
        : uid
          ? device(mac, "chosen device not connected; auto: Bluetooth output: built-in mic", true)
          : device(mac, choice === "builtin" ? "built-in mic" : "Bluetooth output: built-in mic");
  return { ...HEADLESS_AUDIO_INPUTS, using };
}

export interface HeadlessOptions {
  /** A pasta dos dados (o vault fica em <data>/vault). */
  data: string;
  /** Sem o helper: só as capacidades (dicionário, snippets, histórico, notas). */
  helper: boolean;
  /** O executável do helper; o padrão é o do `swift build` em native/. */
  helperPath?: string;
  /** Depois do `stop` (pelo socket ou pelo sinal): o processo do headless sai aqui. */
  onStopped?: () => void;
}

type Topic = "events" | "logs";
type Line = Record<string, unknown>;

const RING = 500;

/**
 * O helper do `swift build`: o mais novo, pelo `mtime`, entre o release e o debug (T7684). Antes o release ganhava
 * sempre, e um release esquecido rodava calado no lugar do código novo (#7082). Empate: o release.
 */
export function defaultHelper(appDir: string): string | undefined {
  let newest: { path: string; mtime: number } | undefined;
  for (const config of ["release", "debug"]) {
    const p = path.join(appDir, "..", "native", ".build", config, "kiwi-helper");
    const s = statSync(p, { throwIfNoEntry: false });
    if (s && (!newest || s.mtimeMs > newest.mtime)) newest = { path: p, mtime: s.mtimeMs };
  }
  return newest?.path;
}

export const controlSocket = (data: string) => path.join(data, "control.sock");
export const stateFile = (data: string) => path.join(data, "headless.json");

/**
 * Sobe o headless e devolve como parar. Os stores leem o ambiente ao importar, então o ambiente vem antes do import
 * (dinâmico). Num processo, um headless por vez.
 */
export async function startHeadless(o: HeadlessOptions): Promise<{ stop(): Promise<void>; socket: string }> {
  const data = path.resolve(o.data);
  assertNotRealData(data); // T1827: nunca os dados nem o vault do app de verdade
  mkdirSync(data, { recursive: true, mode: 0o700 });
  process.env.KIWI_DEBUG = "1";
  process.env.KIWI_HEADLESS = "1";
  process.env.KIWI_DATA_DIR = data;
  process.env.KIWI_VAULT_DIR = path.join(data, "vault");
  if (o.helper) {
    const helper = o.helperPath ?? process.env.KIWI_HELPER ?? defaultHelper(path.resolve(import.meta.dirname, "..", ".."));
    if (!helper || !existsSync(helper)) throw new Error("no kiwi-helper: run `swift build` in native/, or start with --no-helper");
    process.env.KIWI_HELPER = helper;
    // Qual helper roda (T7684): no log e no `status`, para ninguém medir um binário velho sem saber.
    console.log(`[headless] helper: ${helper}`);
  }

  const { stores } = await import("../bun/stores.ts");
  // O OCR (T2709) usa o helper só no `--ocr`, que lê e sai: sem sessão, sem mic e sem pedir permissão. Então vale
  // também com --no-helper, quando o helper existe.
  {
    const ocrHelper = o.helperPath ?? process.env.KIWI_HELPER ?? defaultHelper(path.resolve(import.meta.dirname, "..", ".."));
    if (ocrHelper && existsSync(ocrHelper)) stores.folders.setOcrRunner((await import("../notes/ocr.ts")).helperRunner(ocrHelper));
    // O PDF do exportar (T2684) também: o `--export-pdf` imprime fora da tela e sai.
    if (ocrHelper && existsSync(ocrHelper)) stores.folders.setPdf((await import("../notes/export.ts")).helperPdf(ocrHelper));
  }
  const { uiCapabilities } = await import("../bun/ui-capabilities.ts");
  const { directInvoke } = await import("../bun/ui-engine.ts");
  const { dictate } = await import("../bun/dictate.ts");
  const { attachCatOverlay } = await import("../bun/cat-overlay.ts");
  const { attachAgentVoice } = await import("../bun/agent-voice.ts");

  // ---------------------------------------------------------------- saídas: eventos e logs, com histórico curto
  const subscribers = new Map<Socket<unknown>, Set<Topic>>();
  /** Um escritor por conexão: as linhas grandes esperam o drain em vez de se perder (T2594). */
  const writers = new Map<Socket<unknown>, LineWriter>();
  const out = (s: Socket<unknown>) => {
    let w = writers.get(s);
    if (!w) writers.set(s, (w = new LineWriter(s as unknown as { write(d: Uint8Array): number })));
    return w;
  };
  const backlog: Record<Topic, Line[]> = { events: [], logs: [] };
  const logFile = path.join(data, "headless.log");
  const publish = (topic: Topic, line: Line) => {
    backlog[topic].push(line);
    if (backlog[topic].length > RING) backlog[topic].shift();
    if (topic === "logs") appendFileSync(logFile, `${JSON.stringify(line)}\n`);
    for (const [s, topics] of subscribers) if (topics.has(topic)) out(s).line(JSON.stringify(line));
  };
  const event = (name: string, payload: unknown) => publish("events", { event: name, payload, at: new Date().toISOString() });
  const original = { log: console.log, warn: console.warn, error: console.error };
  for (const level of ["log", "warn", "error"] as const) {
    console[level] = (...args: unknown[]) => {
      original[level](...args);
      publish("logs", { log: args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "), level, at: new Date().toISOString() });
    };
  }

  // T5350: o mesmo log em arquivo do app, em <data>/logs, para os roteiros conferirem o "Salvar diagnóstico".
  const { installFileLog, appLog } = await import("../bun/file-log.ts");
  installFileLog(data);
  const { saveDiagnostics } = await import("../bun/diagnostics.ts");

  // ---------------------------------------------------------------- o motor
  const session = o.helper ? new (await import("../bun/session.ts")).Session(path.join(data, "views")) : null;
  // A gravação de reunião ao vivo (R6): a do helper, ou uma de mentira com `KIWI_FAKE_MEETING=<app>` para os prints e os
  // roteiros da aba Reuniões (o headless nunca grava de verdade: o helper recusa `meeting.start` sem mic).
  const { FakeMeetingHost } = await import("../bun/meetings.ts");
  const meetings = process.env.KIWI_FAKE_MEETING ? new FakeMeetingHost(process.env.KIWI_FAKE_MEETING, 12, undefined, process.env.KIWI_FAKE_MEETING_WARNING || undefined) : session?.meetings;
  const spelling = process.env.KIWI_FAKE_SPELLING ? fakeSpelling(process.env.KIWI_FAKE_SPELLING)
    : (word: string, language?: string) => session?.checkSpelling(word, language) ?? NO_SPELLING;
  let fakeClipboard = "";
  let catOverlay: import("../bun/cat-overlay.ts").AttachedCatOverlay | undefined;
  let agentVoice: import("../bun/agent-voice.ts").AttachedAgentVoice | undefined;
  const capabilities = uiCapabilities({
    spelling,
    meetings,
    dictionary: stores.dictionary,
    snippets: stores.snippets,
    history: stores.history,
    retryDictation: async id => {
      if(!session)throw new Error("helper_unavailable");
      return session.retryDictation(id);
    },
    notes: stores.notes,
    notesFolders: stores.folders,
    chooseNotesFolder: async () => process.env.KIWI_TEST_NOTES_FOLDER ?? null,
    meetingNotes: stores.meetingNotes,
    attachments: stores.attachments,
    // O headless não sai para a rede: a imagem de fora é sempre esta, depois de conferir o endereço como o app confere.
    remoteImage: async (url) => {
      remoteImageUrl(url);
      console.log(`[notes] remote image (headless, sem rede): ${url}`);
      return { path: url, mime: "image/png", size: HEADLESS_IMAGE.length, dataUrl: `data:image/png;base64,${HEADLESS_IMAGE.toString("base64")}` };
    },
    // Sem helper nem mic: uma lista fixa (a do #3202, AirPods na saída), para o seletor de microfone dos Ajustes (T3230).
    audioInputs: async () => headlessAudioInputs((await stores.settings.load()).microphone),
    precise: () => session?.precise.status() ?? null,
    ocr: stores.ocr,
    semanticEngine: stores.semantic,
    exporter: stores.exporter,
    // O headless nunca abre diálogo: a pasta do exportar vem de KIWI_EXPORT_DIR (T2684), ou o exportar dá E_CANCELED.
    chooseExportFolder: async () => process.env.KIWI_EXPORT_DIR ?? null,
    versions: stores.versions,
    dictionaryChanged: (terms) => void session?.dictionaryChanged(terms),
    snippetsChanged: (snippets) => session?.snippetsChanged(snippets),
    settings: stores.settings,
    agent: stores.agent,
    settingsChanged: (settings) => {
      void session?.settingsChanged(settings);
      catOverlay?.settingsChanged(settings);
      agentVoice?.settingsChanged(settings);
      event("settings.changed", settings);
    },
    projectsChangedIn: (folderId) => event("projects.changed", { folderId }),
    dictationNotes: stores.dictationNotes,
    // Headless nunca encosta no clipboard da pessoa: o texto vai só para o log, como o dryRun do insert.
    clipboardWrite: (text) => { fakeClipboard = text; console.log(`[headless] clipboard.write (not written): ${text.length} chars`); },
    clipboardRead: () => fakeClipboard,
    // O "Mostrar no Finder" nunca abre o Finder no headless: só o log (T2468).
    reveal: (abs) => console.log(`[headless] notes.reveal (not opened): ${abs}`),
    openFile: (abs, mode) => console.log(`[headless] files.open (not opened, ${mode}): ${abs}`),
    revealTrash: () => console.log("[headless] trash.reveal (not opened)"),
    // O diagnóstico vai para <data>/diagnostics e nada abre; os crashes do macOS só de KIWI_CRASH_DIR (nunca os reais).
    diagnostics: {
      save: () =>
        saveDiagnostics({
          app: () => ({ version: "headless", channel: "dev" }),
          contract: UI_CONTRACT_VERSION,
          session: () => session?.diagnostics() ?? null,
          settings: async () => {
            const s = await stores.settings.load();
            return { microphone: s.microphone, notesShortcut: s.notesShortcut };
          },
          log: appLog,
          saveDir: path.join(data, "diagnostics"),
          crashDir: process.env.KIWI_CRASH_DIR ?? path.join(data, "crash-reports"),
          reveal: (abs) => console.log(`[headless] diagnostics.reveal (not opened): ${path.basename(abs)}`),
        }),
    },
  });
  // As ferramentas do agente (spec #7496), pelas capacidades de leitura, e as de escrita (spec #8356), como no app.
  stores.agent.useReader(readerFromCapabilities(capabilities));
  // O Modelo de nota (spec #11102) do cofre aberto, para o começo fixo do pedido.
  stores.agent.useNoteModel(async () => readNoteModel((await stores.folders.current()).notes.root));
  stores.agent.useWriter(writerFromCapabilities(capabilities));
  // O desfazer (spec #9353), pelas mesmas capacidades: a janela das Notas vê a nota voltar.
  stores.agent.useUndo(undoNotesFromCapabilities(capabilities));
  // A notificação quando o agente espera (spec #9839): na CLI, só o aviso falso (`KIWI_FAKE_NOTICES=<permissão>`), que
  // registra em <dados>/fake-notices.jsonl. A "janela principal" é de mentira: fora da vista até o `notice {"view":true}`.
  const fakeNoticePermission = process.env.KIWI_FAKE_NOTICES;
  let fakeView = false;
  const fakeShown: number[] = [];
  if (isNoticePermission(fakeNoticePermission)) {
    stores.agent.attachNotice({
      notices: fakeNotices({ permission: fakeNoticePermission, file: path.join(data, "fake-notices.jsonl") }),
      inView: () => fakeView,
      show: () => {
        fakeShown.push(Date.now());
        fakeView = true;
        appendFileSync(path.join(data, "fake-notices.jsonl"), `${JSON.stringify({ op: "show" })}\n`, { mode: 0o600 });
        stores.agent.noticeView(true);
      },
    });
  }
  stores.recoveries.start();
  const offs = [
    stores.folders.onNotesChanged((folder, paths) => event("notes.changed", { paths, folderId:folder.id })),
    stores.folders.onFilesChanged((folder, paths) => event("files.changed", { paths, folderId:folder.id })),
    stores.folders.onChange(view=>event("notes.folderChanged",view)),
    stores.history.onAdded((entry) => event("history.added", entry)),
    stores.recoveries.onChanged(()=>event("history.changed",{})),
    meetings?.onChange((live) => event("meetings.live", live)) ?? (() => {}),
    stores.agent.onStatus((s) => event("agent.status", s)),
    stores.agent.onTurn((e) => event("agent.turn", e)),
    stores.agent.onActivity((request) => event("agent.activityChanged", { request })),
    stores.agent.onQuestionChanged((e) => event("agent.questionChanged", e)),
    stores.agent.onNoticeChanged((e) => event("agent.noticeChanged", e)),
    stores.agent.onUsageChanged((e) => event("agent.usageChanged", e)),
    stores.agent.onProposalsChanged((proposals) => event("agent.proposalsChanged", { proposals })),
  ];
  // O gato no overlay (spec #9810): no headless não há hub, então os pedidos vão ao helper, que no `--headless` não mostra
  // nada; os comandos aparecem no log, e o `kiwicat.where` sai como evento.
  catOverlay = attachCatOverlay({
    agent: stores.agent,
    settings: stores.settings,
    // Sem o helper (`--no-helper`), um helper falso: os comandos saem como o evento `catOverlay.command`, para a prova
    // no WebKit headless aplicar à página do overlay.
    helper: session
      ? { send: (c) => session.sidecar.send(c), onReady: (fn) => session.sidecar.on("ready", fn) }
      : { send: async (c) => (event("catOverlay.command", c), { ok: true }), onReady: () => () => {} },
    pageDir: path.resolve(import.meta.dirname, "..", "..", "dist", "catoverlay"),
    where: (overlay) => event("kiwicat.where", { overlay }),
    log: (m) => console.log(m),
  });
  offs.push(() => catOverlay?.stop());
  // O atalho Control (spec #9876): pelo helper headless, a fala vem do `debug.transcribe {target: "agent"}` (o `say`).
  agentVoice = attachAgentVoice({
    agent: stores.agent,
    settings: stores.settings,
    ...(session
      ? { helper: { send: (c) => session.sidecar.send(c), on: (type, fn) => session.sidecar.on(type, fn), onReady: (fn) => session.sidecar.on("ready", fn) } }
      : {}),
    ui: (state) => {
      event("agent.voice", state);
      catOverlay?.overlay.voice(state);
    },
    log: (m) => console.log(m),
  });
  offs.push(() => agentVoice?.stop());
  if (session) {
    offs.push(session.onStatus((s) => event("status", s)));
    offs.push(session.sidecar.on("*", (e) => (e.type === "audio.level" ? undefined : event("helper.event", e))));
    session.dictation.onDone = (outcome) => event("dictation.done", outcome);
    session.start();
  }

  const status = () => ({
    pid: process.pid,
    data,
    vault: process.env.KIWI_VAULT_DIR,
    contract: UI_CONTRACT_VERSION,
    capabilities: UI_CAPABILITIES,
    helper: !session ? "off" : session.sidecar.supervision().state === "failed" ? "failed" : session.sidecar.ready ? "ready" : "starting",
    helperPath: session ? (process.env.KIWI_HELPER ?? null) : null,
    menuLabel: session ? statusLabel(session.status()) : "Helper desligado",
    session: session?.status() ?? null,
  });

  // ---------------------------------------------------------------- o socket de controle
  let stopping: Promise<void> | null = null;
  const handle = async (s: Socket<unknown>, msg: Line): Promise<Line> => {
    const id = msg.id ?? null;
    switch (msg.cmd) {
      case "status":
        return { id, ok: true, value: status() };
      case "invoke": {
        if (typeof msg.cap !== "string") return { id, ok: false, code: "E_BAD_ARGS", message: "cap must be a string" };
        const r = await directInvoke(capabilities, msg.cap, msg.args ?? {});
        return r.ok ? { id, ok: true, value: r.value } : { id, ok: false, code: r.code, message: r.message };
      }
      case "dictate": {
        if (!session) return { id, ok: false, code: "E_NO_HELPER", message: "started with --no-helper" };
        try {
          return { id, ok: true, value: await dictate(session, msg) };
        } catch (e) {
          const code = (e as { code?: unknown }).code;
          return { id, ok: false, code: typeof code === "string" ? code : "E_FAILED", message: e instanceof Error ? e.message : String(e) };
        }
      }
      case "hubView": {
        // A janela principal à vista, ou não (o WebKit headless não tem foco de janela): com ela à vista, o gato é o do
        // canto, e o overlay não toma o lugar dele (spec #9810). Para as provas do hub.
        if (typeof msg.view !== "boolean") return { id, ok: false, code: "E_BAD_ARGS", message: "view must be a boolean" };
        catOverlay?.setHubInView(msg.view);
        return { id, ok: true, value: { view: msg.view } };
      }
      case "agentTalk": {
        // O atalho Control (spec #9876) sem o mic nem a tecla: o helper toca o WAV (`say`) como uma fala ao agente, com
        // os mesmos eventos `agent.*` da tecla segurada. Só com o helper em KIWI_DEBUG=1 (o `debug.transcribe`).
        if (!session) return { id, ok: false, code: "E_NO_HELPER", message: "started with --no-helper" };
        if (typeof msg.wav !== "string") return { id, ok: false, code: "E_BAD_ARGS", message: "wav must be a path" };
        const r = await session.sidecar.send({ type: "debug.transcribe", path: msg.wav, target: "agent" });
        return r.ok ? { id, ok: true, value: { playing: true } } : { id, ok: false, code: "E_HELPER", message: r.error ?? "failed" };
      }
      case "subscribe": {
        const topics = new Set((Array.isArray(msg.topics) ? msg.topics : ["events"]).filter((t): t is Topic => t === "events" || t === "logs"));
        if (msg.backlog !== false) for (const t of topics) for (const line of backlog[t]) out(s).line(JSON.stringify(line));
        if (msg.follow !== false) subscribers.set(s, topics);
        return { id, ok: true, value: { topics: [...topics] } };
      }
      case "notice": {
        // Só com o aviso falso: a janela entra ou sai da vista, ou a pessoa clica na notificação (spec #9839).
        if (!isNoticePermission(fakeNoticePermission)) return { id, ok: false, code: "E_NO_FAKE_NOTICES", message: "start with KIWI_FAKE_NOTICES" };
        if (typeof msg.view === "boolean") {
          fakeView = msg.view;
          stores.agent.noticeView(fakeView);
        }
        if (typeof msg.click === "string") stores.agent.noticeResponse({ id: msg.click, action: "default" });
        return { id, ok: true, value: { view: fakeView, shown: fakeShown.length } };
      }
      case "stop":
        setTimeout(() => void stop(), 10);
        return { id, ok: true, value: { stopping: true } };
      default:
        return { id, ok: false, code: "E_BAD_COMMAND", message: `unknown cmd ${JSON.stringify(msg.cmd)}` };
    }
  };

  const sock = controlSocket(data);
  rmSync(sock, { force: true });
  const buffers = new Map<Socket<unknown>, string>();
  const server = Bun.listen<unknown>({
    unix: sock,
    socket: {
      data(s, chunk) {
        let buf = (buffers.get(s) ?? "") + new TextDecoder().decode(chunk);
        for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let msg: Line;
          try {
            msg = JSON.parse(line) as Line;
          } catch {
            out(s).line(JSON.stringify({ id: null, ok: false, code: "E_BAD_JSON", message: "not a JSON line" }));
            continue;
          }
          void handle(s, msg).then((reply) => out(s).line(JSON.stringify(reply)));
        }
        buffers.set(s, buf);
      },
      // O resto de uma linha grande (um anexo, o data: URL de volta) sai aqui (T2594).
      drain(s) {
        writers.get(s)?.flush();
      },
      close(s) {
        subscribers.delete(s);
        buffers.delete(s);
        writers.delete(s);
      },
    },
  });
  chmodSync(sock, 0o600);
  writeFileSync(stateFile(data), JSON.stringify({ pid: process.pid, socket: sock, helper: !!session, startedAt: new Date().toISOString() }));
  console.log(`[headless] up: ${sock} (helper ${session ? "on" : "off"})`);

  const stop = () => {
    stopping ??= (async () => {
      for (const off of offs) off();
      await session?.stop();
      stores.recoveries.stop();
      await stores.meetingNotes.flush();
      await stores.folders.close();
      await stores.semantic.close();
      await stores.agent.close();
      server.stop(true);
      rmSync(sock, { force: true });
      rmSync(stateFile(data), { force: true });
      Object.assign(console, original);
      o.onStopped?.();
    })();
    return stopping;
  };
  return { stop, socket: sock };
}
