// O `dictate` da CLI dos agentes (T1740): um ditado inteiro sem microfone nem colagem. Um WAV sintético (`say`) passa
// pelo STT de verdade do helper (`debug.transcribe`); um texto pula o STT. Daí em diante é o caminho do app: a limpeza
// com o tom do app, o dicionário, os snippets, o `insert.text` em dryRun com o campo descrito (`simulate`), o
// Histórico e a nota rápida. Quem chama é o socket do modo headless (T1739, `cmd: "dictate"`).

import { existsSync, statSync } from "node:fs";
import path from "node:path";

import type { AppRef, InsertSimulation, SttEngine } from "../shared/ipc.ts";
import type { Dictation, DictationOutcome } from "./dictation.ts";
import { CapabilityError } from "./ui-capabilities.ts";

/** Nomes curtos para o `--app`: o bundle id de cada um (os do `toneFor`). Qualquer outro valor vale como bundle id. */
export const APP_ALIASES: Record<string, AppRef> = {
  slack: { bundleId: "com.tinyspeck.slackmacgap", name: "Slack" },
  teams: { bundleId: "com.microsoft.teams2", name: "Microsoft Teams" },
  whatsapp: { bundleId: "net.whatsapp.WhatsApp", name: "WhatsApp" },
  mail: { bundleId: "com.apple.mail", name: "Mail" },
  outlook: { bundleId: "com.microsoft.Outlook", name: "Microsoft Outlook" },
  notes: { bundleId: "com.apple.Notes", name: "Notes" },
  terminal: { bundleId: "com.apple.Terminal", name: "Terminal" },
  ghostty: { bundleId: "com.mitchellh.ghostty", name: "Ghostty" },
  iterm: { bundleId: "com.googlecode.iterm2", name: "iTerm" },
  vscode: { bundleId: "com.microsoft.VSCode", name: "Visual Studio Code" },
  cursor: { bundleId: "com.todesktop.230313mzl4w4u92", name: "Cursor" },
  chrome: { bundleId: "com.google.Chrome", name: "Google Chrome" },
  safari: { bundleId: "com.apple.Safari", name: "Safari" },
};

/** O pedido, como chega no socket. Um de `wav` ou `text`. */
export interface DictateRequest {
  wav?: string;
  text?: string;
  /** Um alias de `APP_ALIASES` ou um bundle id. Sem ele, nenhum app (o tom padrão). */
  app?: string;
  /** A nota rápida (T1320): o ditado vira nota em vez de ser colado. */
  note?: boolean;
  /** Num navegador (L18): o título da janela e o host da página, como o helper leria pela Acessibilidade. */
  siteTitle?: string;
  siteHost?: string;
  /** O texto antes do cursor (T733); só os 2 últimos caracteres contam. Sem ele, o campo "não diz" (sem espaço). */
  fieldBefore?: string | null;
  /** O resto do campo descrito: o papel na Acessibilidade, secure input, cursor, a permissão. */
  field?: Omit<InsertSimulation, "textBefore">;
}

export interface DictateReport {
  input: "wav" | "text";
  app: AppRef | null;
  note: boolean;
  /** O que o STT deu (ou o `text` dado). */
  raw: string;
  /** O que iria para o campo, já limpo e com os snippets. */
  text: string;
  tone: string | null;
  latencyMs: { stt: number; app: number };
  /** Quem transcreveu o WAV (T6602): o Parakeet ou o Whisper do modo preciso. */
  engine?: SttEngine;
  /**
   * O que o paste faria (nulo na nota rápida). `typed` é exatamente o que entraria no campo, com o espaço automático;
   * null quando nada entraria (`clipboardOnly`: o texto só fica no clipboard; ou o insert falhou).
   */
  insert: { plan: string | null; reason: string | null; autoSpace: boolean; spaced: boolean; typed: string | null; error?: string } | null;
  /** A nota rápida: a nota que o ditado virou. */
  createdNote?: { path: string; title: string; created: boolean };
  historyId?: string;
  /** `empty`: sem fala; `error`: o STT ou a gravação falhou, com o código em `error`. */
  skipped?: "empty" | "error";
  error?: string;
}

/** O que o `dictate` usa do `Session` do app. */
export interface DictateSession {
  dictation: Pick<Dictation, "dictateText" | "dictateWav">;
}

const bad = (message: string) => new CapabilityError("E_BAD_ARGS", message);

export function resolveApp(value: string): AppRef {
  const alias = APP_ALIASES[value.toLowerCase()];
  if (alias) return alias;
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]{1,254}$/.test(value)) throw bad(`app: not an alias (${Object.keys(APP_ALIASES).join(", ")}) nor a bundle id`);
  return { bundleId: value, name: value };
}

/** Valida o pedido inteiro antes de qualquer coisa: um pedido ruim não chega ao helper. */
export function parseRequest(msg: unknown): { input: "wav" | "text"; value: string; app?: AppRef; note: boolean; simulate: InsertSimulation } {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) throw bad("dictate: expects an object");
  const m = msg as Record<string, unknown>;
  const known = new Set(["cmd", "id", "wav", "text", "app", "note", "fieldBefore", "field", "siteTitle", "siteHost"]);
  for (const key of Object.keys(m)) if (!known.has(key)) throw bad(`dictate: unknown field ${key}`);
  if ((m.wav === undefined) === (m.text === undefined)) throw bad("dictate: give wav or text (one of them)");
  let input: "wav" | "text";
  let value: string;
  if (m.wav !== undefined) {
    if (typeof m.wav !== "string" || !m.wav) throw bad("wav must be a path");
    value = path.resolve(m.wav);
    if (!existsSync(value) || !statSync(value).isFile()) throw bad(`wav: no file at ${value}`);
    input = "wav";
  } else {
    if (typeof m.text !== "string") throw bad("text must be a string");
    if (m.text.length > 20_000) throw bad("text is longer than 20000");
    value = m.text;
    input = "text";
  }
  if (m.app !== undefined && typeof m.app !== "string") throw bad("app must be a string");
  if (m.note !== undefined && typeof m.note !== "boolean") throw bad("note must be true or false");
  for (const key of ["siteTitle", "siteHost"] as const) {
    if (m[key] !== undefined && (typeof m[key] !== "string" || !m[key])) throw bad(`${key} must be a non-empty string`);
  }
  if ((m.siteTitle !== undefined || m.siteHost !== undefined) && !m.app) throw bad("siteTitle and siteHost need app (a browser)");
  if (m.fieldBefore !== undefined && m.fieldBefore !== null && typeof m.fieldBefore !== "string") throw bad("fieldBefore must be a string or null");
  const simulate: InsertSimulation = {};
  if (m.field !== undefined) {
    if (!m.field || typeof m.field !== "object" || Array.isArray(m.field)) throw bad("field must be an object");
    const f = m.field as Record<string, unknown>;
    for (const [key, v] of Object.entries(f)) {
      if (key === "role") {
        if (v !== null && typeof v !== "string") throw bad("field.role must be a string or null");
        simulate.role = v as string | null;
      } else if (key === "accessibility" || key === "secureInput" || key === "hasCaret") {
        if (typeof v !== "boolean") throw bad(`field.${key} must be true or false`);
        simulate[key] = v;
      } else {
        throw bad(`field: unknown key ${key}`);
      }
    }
  }
  if (m.fieldBefore !== undefined) simulate.textBefore = m.fieldBefore as string | null;
  const app = m.app ? resolveApp(m.app as string) : undefined;
  const site = { ...(m.siteTitle ? { title: m.siteTitle as string } : {}), ...(m.siteHost ? { urlHost: m.siteHost as string } : {}) };
  return { input, value, app: app ? { ...app, ...site } : undefined, note: m.note === true, simulate };
}

export function report(input: "wav" | "text", note: boolean, o: DictationOutcome): DictateReport {
  const r: DictateReport = {
    input,
    app: o.app ?? null,
    note,
    raw: o.raw ?? "",
    text: o.text,
    tone: o.tone ?? null,
    latencyMs: { stt: o.sttMs ?? 0, app: o.appMs },
    ...(o.engine ? { engine: o.engine } : {}),
    insert:
      note || !o.insert
        ? null
        : {
            plan: o.insert.plan ?? null,
            reason: o.insert.reason ?? null,
            autoSpace: o.insert.autoSpace,
            spaced: o.insert.spaced === true,
            typed: o.insert.plan === "clipboardOnly" || o.insert.error ? null : `${o.insert.spaced ? " " : ""}${o.text}`,
            ...(o.insert.error ? { error: o.insert.error } : {}),
          },
  };
  if (o.note) r.createdNote = { path: o.note.note.path, title: o.note.note.title, created: o.note.created };
  if (o.entry) r.historyId = o.entry.id;
  if (o.skipped) r.skipped = o.skipped;
  if (o.error) r.error = o.error;
  return r;
}

/** `cmd: "dictate"` do socket headless (T1739). Um pedido ruim dá E_BAD_ARGS; o helper que recusa, E_HELPER. */
export async function dictate(session: DictateSession, msg: unknown): Promise<DictateReport> {
  const req = parseRequest(msg);
  const options = { app: req.app, note: req.note, simulate: req.simulate };
  let outcome: DictationOutcome;
  if (req.input === "text") {
    outcome = await session.dictation.dictateText(req.value, options);
  } else {
    try {
      outcome = await session.dictation.dictateWav(req.value, options);
    } catch (e) {
      throw new CapabilityError("E_HELPER", `debug.transcribe: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return report(req.input, req.note, outcome);
}
