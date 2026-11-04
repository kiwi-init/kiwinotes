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

import { appendFileSync, chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Socket } from "bun";

import { UI_CAPABILITIES, UI_CONTRACT_VERSION } from "../shared/ui-contract.ts";
import { assertNotRealData } from "./guard.ts";

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

/** O helper do `swift build`: release se houver, senão debug. */
export function defaultHelper(appDir: string): string | undefined {
  for (const config of ["release", "debug"]) {
    const p = path.join(appDir, "..", "native", ".build", config, "kiwi-helper");
    if (existsSync(p)) return p;
  }
  return undefined;
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
  }

  const { stores } = await import("../bun/stores.ts");
  const { uiCapabilities } = await import("../bun/ui-capabilities.ts");
  const { directInvoke } = await import("../bun/ui-engine.ts");
  const { dictate } = await import("../bun/dictate.ts");

  // ---------------------------------------------------------------- saídas: eventos e logs, com histórico curto
  const subscribers = new Map<Socket<unknown>, Set<Topic>>();
  const backlog: Record<Topic, Line[]> = { events: [], logs: [] };
  const logFile = path.join(data, "headless.log");
  const publish = (topic: Topic, line: Line) => {
    backlog[topic].push(line);
    if (backlog[topic].length > RING) backlog[topic].shift();
    if (topic === "logs") appendFileSync(logFile, `${JSON.stringify(line)}\n`);
    for (const [s, topics] of subscribers) if (topics.has(topic)) s.write(`${JSON.stringify(line)}\n`);
  };
  const event = (name: string, payload: unknown) => publish("events", { event: name, payload, at: new Date().toISOString() });
  const original = { log: console.log, warn: console.warn, error: console.error };
  for (const level of ["log", "warn", "error"] as const) {
    console[level] = (...args: unknown[]) => {
      original[level](...args);
      publish("logs", { log: args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "), level, at: new Date().toISOString() });
    };
  }

  // ---------------------------------------------------------------- o motor
  const session = o.helper ? new (await import("../bun/session.ts")).Session(path.join(data, "views")) : null;
  const capabilities = uiCapabilities({
    dictionary: stores.dictionary,
    snippets: stores.snippets,
    history: stores.history,
    notes: stores.notes,
    attachments: stores.attachments,
    dictionaryChanged: (terms) => void session?.dictionaryChanged(terms),
    snippetsChanged: (snippets) => session?.snippetsChanged(snippets),
    settings: stores.settings,
    settingsChanged: (settings) => {
      void session?.settingsChanged(settings);
      event("settings.changed", settings);
    },
    dictationNotes: stores.dictationNotes,
    // Headless nunca encosta no clipboard da pessoa: o texto vai só para o log, como o dryRun do insert.
    clipboardWrite: (text) => console.log(`[headless] clipboard.write (not written): ${text.length} chars`),
    // O "Mostrar no Finder" nunca abre o Finder no headless: só o log (T2468).
    reveal: (abs) => console.log(`[headless] notes.reveal (not opened): ${abs}`),
    revealTrash: () => console.log("[headless] trash.reveal (not opened)"),
  });
  const offs = [
    stores.notes.onChanged((paths) => event("notes.changed", { paths })),
    stores.history.onAdded((entry) => event("history.added", entry)),
  ];
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
    helper: !session ? "off" : session.sidecar.ready ? "ready" : "starting",
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
      case "subscribe": {
        const topics = new Set((Array.isArray(msg.topics) ? msg.topics : ["events"]).filter((t): t is Topic => t === "events" || t === "logs"));
        if (msg.backlog !== false) for (const t of topics) for (const line of backlog[t]) s.write(`${JSON.stringify(line)}\n`);
        if (msg.follow !== false) subscribers.set(s, topics);
        return { id, ok: true, value: { topics: [...topics] } };
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
            s.write(`${JSON.stringify({ id: null, ok: false, code: "E_BAD_JSON", message: "not a JSON line" })}\n`);
            continue;
          }
          void handle(s, msg).then((reply) => s.write(`${JSON.stringify(reply)}\n`));
        }
        buffers.set(s, buf);
      },
      close(s) {
        subscribers.delete(s);
        buffers.delete(s);
      },
    },
  });
  chmodSync(sock, 0o600);
  writeFileSync(stateFile(data), JSON.stringify({ pid: process.pid, socket: sock, helper: !!session, startedAt: new Date().toISOString() }));
  console.log(`[headless] up: ${sock} (helper ${session ? "on" : "off"})`);

  const stop = () => {
    stopping ??= (async () => {
      for (const off of offs) off();
      session?.stop();
      stores.notes.close();
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
