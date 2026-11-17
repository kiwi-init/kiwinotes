// A aba Reuniões do hub (R6, T4947, issue #198, spec #4823): o que a lista mostra de cada nota de reunião, o estado ao
// vivo da gravação e os ajustes de reunião. O formato da nota é o do R4 (T4945, combinado no #5059):
//
//   type: meeting · session · date: "AAAA-MM-DD" · start/end: ISO completo (sem `end` enquanto grava)
//   duration: segundos · app: "Teams" · participants: [Você, Pessoa 1]
//
// Puro (sem disco nem helper), para o `bun test`.

/** Uma nota de reunião, como a lista mostra. */
import { canonicalShortcut, isShortcutFor } from "./shortcuts.ts";

export interface MeetingNote {
  path: string;
  title: string;
  /** O dia local, `AAAA-MM-DD`. */
  date: string;
  /** ISO 8601; null quando a nota não diz (uma nota escrita à mão). */
  start: string | null;
  end: string | null;
  /** Segundos; null sem `duration` (ainda gravando, ou à mão). */
  duration: number | null;
  app: string | null;
  participants: string[];
  /** A nota de uma gravação em andamento (sem `end`). */
  live: boolean;
  mtime: string;
}

/** A gravação agora, pelos eventos do helper (`meeting.started`/`stopped`/`minePaused`). */
export type MeetingLive =
  | { recording: false }
  | { recording: true; session: string; app: string | null; since: string; minePaused: boolean; warning?: string };

export const NOT_RECORDING: MeetingLive = { recording: false };

/** Um app que conta como reunião (o `config.set meetingApps` do R2). */
export interface MeetingAppEntry {
  bundleId: string;
  name: string;
}

/** Os ajustes de reunião, nas Configurações (`AppSettings.meetings`). */
export interface MeetingSettings {
  /** Grava e para a reunião (R2); null desliga. Desde o T5349, o mesmo que `AppSettings.shortcuts.meeting`. */
  shortcut: MeetingShortcut | null;
  /** "Pausar meu mic"; null desliga. Desde o T5349, o mesmo que `AppSettings.shortcuts.meetingPause`. */
  pauseShortcut: MeetingPauseShortcut | null;
  /** O pop-up "Gravar esta reunião?". Desligado, o atalho ainda grava. */
  suggest: boolean;
  /** Os apps que contam como reunião. */
  apps: MeetingAppEntry[];
}

/** As combinações oferecidas: nenhuma faz nada nos apps comuns do Mac (como as do atalho das Notas). */
export const MEETING_SHORTCUTS = [
  { value: "control+option+r", label: "⌃⌥R" },
  { value: "control+command+r", label: "⌃⌘R" },
  { value: "option+command+r", label: "⌥⌘R" },
] as const;
export const MEETING_PAUSE_SHORTCUTS = [
  { value: "control+option+m", label: "⌃⌥M" },
  { value: "control+command+m", label: "⌃⌘M" },
  { value: "option+command+m", label: "⌥⌘M" },
] as const;
/** Desde o T5349, qualquer atalho global (`shortcuts.ts`); as listas acima são só as de antes. */
export type MeetingShortcut = string;
export type MeetingPauseShortcut = string;

/** A mesma lista do helper (`MeetingApps.defaults`, native/Sources/KiwiHelperCore/Meeting/MeetingApps.swift). */
export const DEFAULT_MEETING_APPS: readonly MeetingAppEntry[] = [
  { bundleId: "com.microsoft.teams2", name: "Teams" },
  { bundleId: "com.microsoft.teams", name: "Teams" },
  { bundleId: "us.zoom.xos", name: "Zoom" },
  { bundleId: "Cisco-Systems.Spark", name: "Webex" },
  { bundleId: "com.webex.meetingmanager", name: "Webex" },
  { bundleId: "com.tinyspeck.slackmacgap", name: "Slack" },
  { bundleId: "com.apple.FaceTime", name: "FaceTime" },
  { bundleId: "com.apple.avconferenced", name: "FaceTime" },
  { bundleId: "com.google.Chrome", name: "Chrome" },
  { bundleId: "company.thebrowser.Browser", name: "Arc" },
  { bundleId: "com.microsoft.edgemac", name: "Edge" },
  { bundleId: "com.brave.Browser", name: "Brave" },
  { bundleId: "org.mozilla.firefox", name: "Firefox" },
  { bundleId: "com.apple.Safari", name: "Safari" },
  { bundleId: "com.apple.WebKit.GPU", name: "Safari" },
];

export const DEFAULT_MEETING_SETTINGS: MeetingSettings = {
  shortcut: "control+option+r",
  pauseShortcut: "control+option+m",
  suggest: true,
  apps: [...DEFAULT_MEETING_APPS],
};

/** Até quantos apps. */
export const MAX_MEETING_APPS = 100;

const isShortcut = (v: unknown): v is MeetingShortcut | null => v === null || isShortcutFor("meeting", v);
const isPauseShortcut = (v: unknown): v is MeetingPauseShortcut | null => v === null || isShortcutFor("meetingPause", v);

/** Um bundle id que vale: letras, dígitos, ponto, hífen e sublinhado, como os do macOS. */
export const isBundleId = (v: unknown): v is string => typeof v === "string" && v.length <= 255 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v);

/** A lista de apps que vale: só entradas inteiras, sem repetir bundle id, até `MAX_MEETING_APPS`. Nil: não é lista. */
export function sanitizeMeetingApps(input: unknown): MeetingAppEntry[] | null {
  if (!Array.isArray(input)) return null;
  const seen = new Set<string>();
  const apps: MeetingAppEntry[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const { bundleId, name } = item as Record<string, unknown>;
    const id = typeof bundleId === "string" ? bundleId.trim() : bundleId;
    const label = typeof name === "string" ? name.trim().slice(0, 60) : "";
    if (!isBundleId(id) || !label || seen.has(id.toLowerCase())) continue;
    seen.add(id.toLowerCase());
    apps.push({ bundleId: id, name: label });
  }
  return apps.slice(0, MAX_MEETING_APPS);
}

/** Os ajustes que valem: um campo editado à mão com um valor que não existe volta ao padrão, sem derrubar os outros. */
export function sanitizeMeetingSettings(input: unknown): MeetingSettings {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return {
    shortcut: "shortcut" in o && isShortcut(o.shortcut) ? (o.shortcut && canonicalShortcut(o.shortcut)) : DEFAULT_MEETING_SETTINGS.shortcut,
    pauseShortcut: "pauseShortcut" in o && isPauseShortcut(o.pauseShortcut) ? (o.pauseShortcut && canonicalShortcut(o.pauseShortcut)) : DEFAULT_MEETING_SETTINGS.pauseShortcut,
    suggest: typeof o.suggest === "boolean" ? o.suggest : true,
    apps: sanitizeMeetingApps(o.apps) ?? [...DEFAULT_MEETING_APPS],
  };
}

/** Confere um `settings.set {meetings}` (só os campos dados). Devolve o patch, ou o erro. */
export function checkMeetingSettingsPatch(input: unknown): { ok: true; patch: Partial<MeetingSettings> } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "meetings must be an object" };
  const patch: Partial<MeetingSettings> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === "shortcut") {
      if (!isShortcut(value)) return { ok: false, error: "meetings.shortcut must be a shortcut, or null" };
      patch.shortcut = value && canonicalShortcut(value);
    } else if (key === "pauseShortcut") {
      if (!isPauseShortcut(value)) return { ok: false, error: "meetings.pauseShortcut must be a shortcut, or null" };
      patch.pauseShortcut = value && canonicalShortcut(value);
    } else if (key === "suggest") {
      if (typeof value !== "boolean") return { ok: false, error: "meetings.suggest must be true or false" };
      patch.suggest = value;
    } else if (key === "apps") {
      if (!Array.isArray(value) || value.length > MAX_MEETING_APPS) return { ok: false, error: `meetings.apps must be a list of up to ${MAX_MEETING_APPS}` };
      const apps = sanitizeMeetingApps(value)!;
      if (apps.length !== value.length) return { ok: false, error: "meetings.apps: each app needs a bundleId and a name, without repeats" };
      patch.apps = apps;
    } else {
      return { ok: false, error: `meetings: unknown field ${key}` };
    }
  }
  return { ok: true, patch };
}

/** O frontmatter de uma nota (o bloco `---` do começo), ou null. */
export function frontmatterOf(content: string): Record<string, unknown> | null {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!fm) return null;
  try {
    const data = Bun.YAML.parse(fm[1]!) as unknown;
    return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const isoOrNull = (v: unknown): string | null => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v !== "string" || !v.trim()) return null;
  return Number.isNaN(Date.parse(v)) ? null : v.trim();
};

/** O dia local de um instante, `AAAA-MM-DD`. */
export function localDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * A nota é uma reunião (`type: meeting`): o que a lista mostra dela, ou null. O que falta ou não serve fica vazio,
 * sem esconder a nota: uma reunião escrita à mão ainda aparece.
 */
export function meetingFromNote(meta: { path: string; title: string; mtime: string }, content: string, liveSession?: string | null): MeetingNote | null {
  const fm = frontmatterOf(content);
  if (!fm || String(fm.type ?? "").trim().toLowerCase() !== "meeting") return null;
  const start = isoOrNull(fm.start);
  const end = isoOrNull(fm.end);
  const rawDate = fm.date instanceof Date ? fm.date.toISOString().slice(0, 10) : typeof fm.date === "string" ? fm.date.trim() : "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : localDay(new Date(start ?? meta.mtime));
  const duration = typeof fm.duration === "number" && Number.isFinite(fm.duration) && fm.duration >= 0 ? fm.duration : null;
  const app = typeof fm.app === "string" && fm.app.trim() ? fm.app.trim() : null;
  const participants = Array.isArray(fm.participants)
    ? fm.participants.filter((p): p is string | number => typeof p === "string" || typeof p === "number").map(String).map((p) => p.trim()).filter(Boolean)
    : [];
  // Sem `end` é gravando. Com o `liveSession` (o `session` que o `meetings.live` grava agora, ou null), só a nota dessa
  // sessão: uma que ficou sem `end` (o helper ou o app que caiu, T7938) não grava nada.
  const live = start !== null && end === null && (liveSession === undefined || (liveSession !== null && fm.session === liveSession));
  return { path: meta.path, title: meta.title, date, start, end, duration, app, participants, live, mtime: meta.mtime };
}

/** A mais nova primeiro: o início (ou o dia), e depois a última mudança. */
export function sortMeetings(list: MeetingNote[]): MeetingNote[] {
  const key = (m: MeetingNote) => m.start ?? `${m.date}T00:00:00`;
  return [...list].sort((a, b) => Date.parse(key(b)) - Date.parse(key(a)) || b.mtime.localeCompare(a.mtime));
}

/** "38 min", "1 h 05", "menos de 1 min". */
export function durationLabel(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return "menos de 1 min";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;
}

/** O relógio do card ao vivo: "0:42", "12:05", "1:02:03" (como a pílula do helper). */
export function elapsedLabel(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor(total / 60) % 60;
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/** Os participantes numa linha curta: "Você, Pessoa 1 e Pessoa 2", "Você e mais 4". */
export function participantsLabel(people: string[]): string {
  if (people.length === 0) return "";
  if (people.length === 1) return people[0]!;
  if (people.length <= 3) return `${people.slice(0, -1).join(", ")} e ${people.at(-1)}`;
  return `${people.slice(0, 2).join(", ")} e mais ${people.length - 2}`;
}

/**
 * O estado ao vivo a partir dos eventos do helper (R1 e R2). Puro: o engine guarda o que sai daqui e manda o evento
 * `meetings.live` às janelas.
 */
export function nextLive(live: MeetingLive, event: { type: string; [k: string]: unknown }, now: Date): MeetingLive {
  switch (event.type) {
    case "meeting.started":
      return {
        recording: true,
        session: typeof event.session === "string" ? event.session : "",
        app: typeof event.app === "string" && event.app ? event.app : null,
        since: now.toISOString(),
        minePaused: false,
      };
    case "meeting.warning":
      // R3: o canal sistema só trouxe zeros (a permissão de áudio do sistema, #5030).
      return live.recording && event.session === live.session && typeof event.warning === "string" ? { ...live, warning: event.warning } : live;
    case "meeting.minePaused":
      return live.recording ? { ...live, minePaused: event.paused === true } : live;
    case "meeting.stopped":
      return live.recording && (typeof event.session !== "string" || event.session === live.session) ? NOT_RECORDING : live;
    default:
      return live;
  }
}
