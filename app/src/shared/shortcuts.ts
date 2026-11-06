// Os atalhos do Kiwi (T5349, #175): todos configuráveis, com padrões. O texto de cada um é o do `config.set {shortcuts}`
// (ADR 0001), o mesmo que o helper lê em `Shortcut.swift`:
//
// | gesto | texto | exemplo |
// |---|---|---|
// | uma tecla modificadora sozinha | o nome dela | `fn`, `rightOption` |
// | a mesma, duas vezes | `double:` e o nome | `double:rightCommand` |
// | uma combinação | os modificadores e uma tecla, com `+` | `control+option+r`, `command+shift+space`, `f5` |
// | uma sequência de 2 a 4 passos | os passos, com espaço | `control+k r r`, `f5 f5` |
//
// Os globais (o ditado, as Notas, as reuniões) quem vê é o helper, em qualquer app, e eles têm prioridade: o app da frente
// não recebe a tecla (com Acessibilidade). Os do app (a paleta, a nota nova, a nota do dia) só valem com uma janela do
// Kiwi na frente, e só podem ser uma combinação.

export type ShortcutId = "dictation" | "notes" | "meeting" | "meetingPause" | "palette" | "newNote" | "dailyNote";

export type ShortcutScope = "global" | "app";

export interface ShortcutDef {
  id: ShortcutId;
  label: string;
  hint: string;
  group: "Ditado" | "Notas" | "Reuniões";
  scope: ShortcutScope;
  default: string;
}

export const SHORTCUTS: readonly ShortcutDef[] = [
  { id: "dictation", label: "Ditar", hint: "Segure para falar; toque duas vezes para gravar sem segurar.", group: "Ditado", scope: "global", default: "fn" },
  { id: "notes", label: "Abrir as Notas", hint: "De qualquer app.", group: "Notas", scope: "global", default: "control+option+n" },
  { id: "palette", label: "Paleta de comandos", hint: "Com as Notas na frente.", group: "Notas", scope: "app", default: "command+k" },
  { id: "newNote", label: "Nova nota", hint: "Com as Notas na frente.", group: "Notas", scope: "app", default: "command+n" },
  { id: "dailyNote", label: "Nota do dia", hint: "Com as Notas na frente.", group: "Notas", scope: "app", default: "shift+command+d" },
  { id: "meeting", label: "Gravar e parar a reunião", hint: "De qualquer app, com ou sem o pop-up.", group: "Reuniões", scope: "global", default: "control+option+r" },
  { id: "meetingPause", label: "Pausar meu mic", hint: "Só durante a gravação: os outros continuam sendo gravados.", group: "Reuniões", scope: "global", default: "control+option+m" },
] as const;

/** O atalho de cada ação; null é desligado. */
export type Shortcuts = Record<ShortcutId, string | null>;

export const DEFAULT_SHORTCUTS: Shortcuts = Object.fromEntries(SHORTCUTS.map((s) => [s.id, s.default])) as Shortcuts;

export const SHORTCUT_IDS = SHORTCUTS.map((s) => s.id);

export const GLOBAL_SHORTCUT_IDS = SHORTCUTS.filter((s) => s.scope === "global").map((s) => s.id);

export const shortcutDef = (id: ShortcutId): ShortcutDef => SHORTCUTS.find((s) => s.id === id)!;

// ---------------------------------------------------------------------------------------------------------------------
// O texto

export type ModifierKey = "fn" | "rightOption" | "rightCommand" | "rightControl";
const MODIFIER_KEYS: readonly ModifierKey[] = ["fn", "rightOption", "rightCommand", "rightControl"];

export type Modifier = "control" | "option" | "shift" | "command";
/** A ordem dos menus do Mac (⌃⌥⇧⌘), que é também a do texto canônico. */
const MODIFIERS: readonly Modifier[] = ["control", "option", "shift", "command"];

const LETTERS = "abcdefghijklmnopqrstuvwxyz0123456789";
const NAMED_KEYS = [
  ...Array.from({ length: 20 }, (_, i) => `f${i + 1}`),
  "space", "escape", "return", "tab", "delete", "left", "right", "down", "up",
];

export interface Step {
  modifiers: Modifier[];
  key: string;
}

export type ParsedShortcut =
  | { kind: "key"; key: ModifierKey }
  | { kind: "double"; key: ModifierKey }
  | { kind: "combo"; step: Step }
  | { kind: "sequence"; steps: Step[] };

const isFunctionKey = (key: string) => /^f([1-9]|1[0-9]|20)$/.test(key);

function modifierKey(name: string): ModifierKey | null {
  return MODIFIER_KEYS.find((k) => k.toLowerCase() === name.toLowerCase()) ?? null;
}

/** Um passo: `control+option+r`. Sozinho (ou o 1º de uma sequência), precisa de ⌃, ⌥ ou ⌘, ou ser uma tecla F. */
function parseStep(text: string, bare: boolean): Step | null {
  const mods = new Set<Modifier>();
  let key: string | null = null;
  for (const part of text.toLowerCase().split("+")) {
    if ((MODIFIERS as readonly string[]).includes(part)) {
      if (mods.has(part as Modifier)) return null;
      mods.add(part as Modifier);
    } else if (key === null && (LETTERS.includes(part) && part.length === 1 || NAMED_KEYS.includes(part))) {
      key = part;
    } else {
      return null;
    }
  }
  if (key === null) return null;
  const modifiers = MODIFIERS.filter((m) => mods.has(m));
  if (!bare && !isFunctionKey(key) && !modifiers.some((m) => m !== "shift")) return null;
  return { modifiers, key };
}

/** O texto de um atalho, ou null quando não é um (a mesma regra do `Shortcut.swift`). */
export function parseShortcut(text: unknown): ParsedShortcut | null {
  if (typeof text !== "string") return null;
  const t = text.trim();
  if (t.toLowerCase().startsWith("double:")) {
    const key = modifierKey(t.slice("double:".length));
    return key ? { kind: "double", key } : null;
  }
  const key = modifierKey(t);
  if (key) return { kind: "key", key };
  const parts = t.split(" ").filter(Boolean);
  if (parts.length < 1 || parts.length > 4 || t.split(" ").length !== parts.length) return null;
  const steps: Step[] = [];
  for (const [i, part] of parts.entries()) {
    const step = parseStep(part, i > 0);
    if (!step) return null;
    steps.push(step);
  }
  return steps.length === 1 ? { kind: "combo", step: steps[0]! } : { kind: "sequence", steps };
}

const stepText = (s: Step) => [...s.modifiers, s.key].join("+");

export function shortcutText(p: ParsedShortcut): string {
  switch (p.kind) {
    case "key": return p.key;
    case "double": return `double:${p.key}`;
    case "combo": return stepText(p.step);
    case "sequence": return p.steps.map(stepText).join(" ");
  }
}

/** O texto canônico, ou null. */
export function canonicalShortcut(text: unknown): string | null {
  const p = parseShortcut(text);
  return p ? shortcutText(p) : null;
}

/** Vale para esta ação: os do app só como uma combinação (quem vê é o WebView, que não vê o Fn nem uma sequência). */
export function isShortcutFor(id: ShortcutId, text: unknown): boolean {
  const p = parseShortcut(text);
  if (!p) return false;
  return shortcutDef(id).scope === "global" || p.kind === "combo";
}

// ---------------------------------------------------------------------------------------------------------------------
// Como aparece

const MODIFIER_SYMBOLS: Record<Modifier, string> = { control: "⌃", option: "⌥", shift: "⇧", command: "⌘" };
const MODIFIER_KEY_LABELS: Record<ModifierKey, string> = { fn: "Fn 🌐", rightOption: "⌥ direito", rightCommand: "⌘ direito", rightControl: "⌃ direito" };
const KEY_LABELS: Record<string, string> = {
  space: "Espaço", escape: "Esc", return: "↩", tab: "⇥", delete: "⌫", left: "←", right: "→", down: "↓", up: "↑",
};

function keyLabel(key: string): string {
  return KEY_LABELS[key] ?? key.toUpperCase();
}

function stepLabel(s: Step): string {
  const mods = s.modifiers.map((m) => MODIFIER_SYMBOLS[m]).join("");
  const key = keyLabel(s.key);
  return mods && key.length > 1 && !key.startsWith("F") && !/^[←→↑↓↩⇥⌫]$/.test(key) ? `${mods} ${key}` : `${mods}${key}`;
}

/** Como o atalho aparece nas Configurações e nas dicas: "⌃⌥R", "Fn 🌐", "⌥ direito duas vezes", "⌃K, R, R". */
export function shortcutLabel(text: string | null): string {
  if (text === null) return "Desligado";
  const p = parseShortcut(text);
  if (!p) return text;
  switch (p.kind) {
    case "key": return MODIFIER_KEY_LABELS[p.key];
    case "double": return `${MODIFIER_KEY_LABELS[p.key]} duas vezes`;
    case "combo": return stepLabel(p.step);
    case "sequence":
      return p.steps.length === 2 && p.steps[0]!.modifiers.length === 0 && stepText(p.steps[0]!) === stepText(p.steps[1]!)
        ? `${stepLabel(p.steps[0]!)} duas vezes`
        : p.steps.map(stepLabel).join(", ");
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Conflitos: dois atalhos do Kiwi nas mesmas teclas

/** As teclas que o atalho ocupa, para comparar: uma tecla modificadora, ou o 1º passo de uma combinação ou sequência. */
function claims(p: ParsedShortcut): { modifierKey?: ModifierKey; steps?: string[] } {
  switch (p.kind) {
    case "key":
    case "double": return { modifierKey: p.key };
    case "combo": return { steps: [stepText(p.step)] };
    case "sequence": return { steps: p.steps.map(stepText) };
  }
}

/**
 * Se dois atalhos se atrapalham: o mesmo texto; a mesma tecla modificadora (segurar o Fn para ditar e tocar o Fn duas
 * vezes para outra coisa); ou um é o começo do outro (⌃K e a sequência ⌃K R).
 */
export function shortcutsConflict(a: string, b: string): boolean {
  const pa = parseShortcut(a), pb = parseShortcut(b);
  if (!pa || !pb) return false;
  const ca = claims(pa), cb = claims(pb);
  if (ca.modifierKey || cb.modifierKey) return ca.modifierKey === cb.modifierKey;
  const [short, long] = ca.steps!.length <= cb.steps!.length ? [ca.steps!, cb.steps!] : [cb.steps!, ca.steps!];
  return short.every((s, i) => s === long[i]);
}

/** Com qual dos outros atalhos este conflita (o 1º), ou null. */
export function conflictOf(shortcuts: Shortcuts, id: ShortcutId, text: string): ShortcutId | null {
  for (const other of SHORTCUT_IDS) {
    const t = shortcuts[other];
    if (other !== id && t !== null && shortcutsConflict(text, t)) return other;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Guardar

/**
 * Os atalhos que valem, do arquivo: um texto inválido volta ao padrão. Sem `shortcuts` (um settings.json de antes do
 * T5349), vêm do `notesShortcut` e dos `meetings` de antes, que eram só combinações.
 */
export function sanitizeShortcuts(input: unknown, legacy: { notes?: unknown; meeting?: unknown; meetingPause?: unknown } = {}): Shortcuts {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_SHORTCUTS };
  for (const id of SHORTCUT_IDS) {
    const value = id in o ? o[id] : (legacy as Record<string, unknown>)[id];
    if (value === null) out[id] = null;
    else if (value !== undefined && isShortcutFor(id, value)) out[id] = canonicalShortcut(value);
  }
  return out;
}

/** Confere um `settings.set {shortcuts}`: cada um válido para a sua ação, e nenhum conflito no resultado. */
export function checkShortcutsPatch(current: Shortcuts, input: unknown): { ok: true; patch: Partial<Shortcuts> } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "shortcuts must be an object" };
  const patch: Partial<Shortcuts> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!(SHORTCUT_IDS as string[]).includes(key)) return { ok: false, error: `unknown shortcut ${JSON.stringify(key)}` };
    const id = key as ShortcutId;
    if (value === null) patch[id] = null;
    else if (isShortcutFor(id, value)) patch[id] = canonicalShortcut(value);
    else return { ok: false, error: `shortcuts.${id} is not a shortcut this action can use` };
  }
  const next = { ...current, ...patch };
  for (const id of SHORTCUT_IDS) {
    const text = next[id];
    const other = text === null ? null : conflictOf(next, id, text);
    if (other) return { ok: false, error: `shortcuts.${id} and shortcuts.${other} use the same keys` };
  }
  return { ok: true, patch };
}

// ---------------------------------------------------------------------------------------------------------------------
// Os do app, no WebView

const CODE_KEYS: Record<string, string> = { Space: "space", Escape: "escape", Enter: "return", Tab: "tab", Backspace: "delete", ArrowLeft: "left", ArrowRight: "right", ArrowDown: "down", ArrowUp: "up" };

/** A tecla de um `keydown`: a letra que o layout digita (como nos menus do Mac), ou a tecla nomeada. */
function eventKey(e: Pick<KeyboardEvent, "key" | "code">): string | null {
  if (CODE_KEYS[e.code]) return CODE_KEYS[e.code]!;
  if (/^F([1-9]|1[0-9]|20)$/.test(e.code)) return e.code.toLowerCase();
  const k = e.key.toLowerCase();
  if (k.length === 1 && LETTERS.includes(k)) return k;
  // ⌥ muda a letra (⌥N é ˜): a posição da tecla, como faz o macOS.
  const m = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(e.code);
  return m ? (m[1] ?? m[2]!).toLowerCase() : null;
}

/** Um `keydown` é este atalho do app (uma combinação, com exatamente estes modificadores). */
export function matchesKeyEvent(text: string | null, e: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey" | "repeat">): boolean {
  const p = text === null ? null : parseShortcut(text);
  if (!p || p.kind !== "combo" || e.repeat) return false;
  const held: Record<Modifier, boolean> = { control: e.ctrlKey, option: e.altKey, shift: e.shiftKey, command: e.metaKey };
  return MODIFIERS.every((m) => held[m] === p.step.modifiers.includes(m)) && eventKey(e) === p.step.key;
}

// ---------------------------------------------------------------------------------------------------------------------
// De antes do T5349: o atalho das Notas era uma de três combinações. Fica para quem ainda importa (contrato 1.x).

/** @deprecated desde o T5349: use `SHORTCUTS` e `settings.shortcuts`. */
export const NOTES_SHORTCUTS = [
  { value: "control+option+n", label: "⌃⌥N" },
  { value: "control+command+n", label: "⌃⌘N" },
  { value: "option+command+n", label: "⌥⌘N" },
] as const;

/** @deprecated desde o T5349: qualquer atalho global vale. */
export type NotesShortcut = string;

export const DEFAULT_NOTES_SHORTCUT: NotesShortcut = "control+option+n";

/** @deprecated desde o T5349: `isShortcutFor("notes", v)`. */
export function isNotesShortcut(value: unknown): value is NotesShortcut | null {
  return value === null || isShortcutFor("notes", value);
}
