// A Aparência (T2503, spec #2457 ponto 4): o mesmo que Configurações › Aparência do Channels. Modo, um tema para cada
// lado, tamanho do texto, fonte e movimento. O engine guarda isto nas `AppSettings` e avisa as janelas
// (`settings.changed`); quem desenha é a UI (ui/src/styles/appearance.ts), com os temas de ui/src/styles/themes.ts.
//
// O engine não conhece a lista de temas: só confere a forma do id. Um id que a UI não conhece (um tema que saiu)
// volta ao padrão do lado na hora de desenhar, sem quebrar nada.

export const APPEARANCE_MODES = ["system", "light", "dark"] as const;
export type AppearanceMode = (typeof APPEARANCE_MODES)[number];

/** Os tamanhos do Channels. "default" é o tamanho de hoje do Kiwi; os outros seguem a proporção do Channels. */
export const TEXT_SIZES = ["small", "default", "large", "larger", "largest"] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

/** A escala de cada tamanho. No Channels o Padrão é 1.1 e os outros 1 · 1.25 · 1.4 · 1.6; aqui o Padrão é 1. */
export const TEXT_SCALE: Record<TextSize, number> = { small: 0.91, default: 1, large: 1.14, larger: 1.27, largest: 1.45 };

export const APPEARANCE_FONTS = ["system", "inter", "lato", "atkinson"] as const;
export type AppearanceFont = (typeof APPEARANCE_FONTS)[number];

/** "reduced" corta as animações; o "Reduzir movimento" do macOS corta de qualquer jeito (base.css). */
export const MOTIONS = ["full", "reduced"] as const;
export type Motion = (typeof MOTIONS)[number];

export interface Appearance {
  mode: AppearanceMode;
  /** O tema quando o modo resolve para escuro, e para claro. */
  darkTheme: string;
  lightTheme: string;
  textSize: TextSize;
  font: AppearanceFont;
  motion: Motion;
}

/** Os padrões do Channels: OLED Black no escuro e Channels Light no claro, seguindo o sistema. */
export const DEFAULT_APPEARANCE: Appearance = {
  mode: "system",
  darkTheme: "channels-oled",
  lightTheme: "channels-light",
  textSize: "default",
  font: "system",
  motion: "full",
};

const THEME_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const isThemeId = (v: unknown): v is string => typeof v === "string" && THEME_ID.test(v);

const oneOf =
  <T extends string>(list: readonly T[]) =>
  (v: unknown): v is T =>
    (list as readonly unknown[]).includes(v);

/** Cada campo e o que ele aceita. */
export const APPEARANCE_FIELDS: { [K in keyof Appearance]: (v: unknown) => v is Appearance[K] } = {
  mode: oneOf(APPEARANCE_MODES),
  darkTheme: isThemeId,
  lightTheme: isThemeId,
  textSize: oneOf(TEXT_SIZES),
  font: oneOf(APPEARANCE_FONTS),
  motion: oneOf(MOTIONS),
};

/** Do arquivo (que alguém pode ter editado à mão): o campo que não vale volta ao padrão, sem derrubar os outros. */
export function sanitizeAppearance(input: unknown): Appearance {
  const o = (input && typeof input === "object" && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_APPEARANCE } as Record<keyof Appearance, unknown>;
  for (const key of Object.keys(APPEARANCE_FIELDS) as (keyof Appearance)[]) {
    if (APPEARANCE_FIELDS[key](o[key])) out[key] = o[key];
  }
  return out as Appearance;
}

/**
 * Do `settings.set`: só os campos dados, e cada um tem que valer. Devolve a mensagem do primeiro erro, ou o patch.
 * (Diferente do arquivo, aqui um valor ruim é erro de quem chamou, não algo a consertar em silêncio.)
 */
export function checkAppearancePatch(input: unknown): { ok: true; patch: Partial<Appearance> } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "appearance must be an object" };
  const patch: Partial<Appearance> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!(key in APPEARANCE_FIELDS)) return { ok: false, error: `appearance: unknown field ${key}` };
    const field = key as keyof Appearance;
    if (!APPEARANCE_FIELDS[field](value)) return { ok: false, error: `appearance.${key}: invalid value` };
    (patch as Record<string, unknown>)[field] = value;
  }
  return { ok: true, patch };
}

/** O lado que vale agora: o modo, ou o sistema quando o modo é "system". */
export const resolveMode = (mode: AppearanceMode, systemDark: boolean): "light" | "dark" =>
  mode === "system" ? (systemDark ? "dark" : "light") : mode;
