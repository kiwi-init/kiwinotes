// A Aparência na tela (T2503, spec #2457 ponto 4): aplica o modo, o tema, o tamanho do texto, a fonte e o movimento em
// <html>, em todas as janelas. O valor vem das `AppSettings` (`settings.get`) e muda pelo evento `settings.changed`,
// na hora e sem reiniciar. Uma cópia fica no localStorage da view só para a primeira pintura já sair com o tema certo;
// quem manda é sempre o engine.

import { useEffect, useState } from "react";

import {
  type Appearance,
  DEFAULT_APPEARANCE,
  resolveMode,
  sanitizeAppearance,
  TEXT_SCALE,
} from "../../../src/shared/appearance.ts";
import type { AppSettings, UiEvents } from "../../../src/shared/ui-contract.ts";
import { type ColorTheme, THEME_TOKENS, themeFor } from "./themes.ts";

const CACHE_KEY = "kn-appearance";

/** Luminância relativa (WCAG) de um #rrggbb. */
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0;
  const n = Number.parseInt(m[1]!, 16);
  const ch = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

/** O texto em cima de um fundo cheio na cor dada: preto ou branco, o que contrastar mais. */
export function textOn(hex: string): string {
  const l = luminance(hex);
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? "#000000" : "#ffffff";
}

/**
 * Todas as variáveis de um tema: os 33 tokens do Channels com os nomes dele (`--ink`, `--bg-2`, `--line-2`…), para a UI
 * nova, e os tokens de hoje do Kiwi derivados deles, para as telas que ainda não mudaram. Uma superfície só, como no
 * Channels: `--bg` e `--surface` são o mesmo fundo.
 */
export function themeVars(theme: ColorTheme): Record<string, string> {
  const c = theme.colors;
  const dark = theme.appearance === "dark";
  const vars: Record<string, string> = {};
  for (const k of THEME_TOKENS) vars[`--${k}`] = c[k];
  Object.assign(vars, {
    "--surface": c.bg,
    "--surface-2": c["bg-3"],
    "--surface-hover": c.wash,
    "--border": c.line,
    "--border-strong": c["line-3"],
    "--text": c.ink,
    "--text-2": c["ink-2"],
    "--text-3": c["ink-3"],
    "--accent-soft": c["accent-wash"],
    "--accent-text": c.link,
    "--on-accent": textOn(c.accent),
    "--danger": c.alert,
    "--focus-ring": `0 0 0 3px color-mix(in srgb, ${c.accent} 30%, transparent)`,
    "--selection": `color-mix(in srgb, ${c.ink} 28%, transparent)`,
    // Os controles que flutuam (o grupo de abas, o seletor), como no Channels.
    "--float": dark ? c["bg-3"] : c.bg,
    "--float-2": "color-mix(in srgb, var(--float) 90%, var(--ink))",
    "--float-3": "color-mix(in srgb, var(--float) 80%, var(--ink))",
    "--shadow-float": dark
      ? "0 0 0 1px var(--line-2), inset 0 1px 0 var(--line), 0 1px 2px rgb(0 0 0 / 0.5), 0 4px 12px rgb(0 0 0 / 0.3)"
      : "0 0 0 1px var(--line-2), 0 1px 2px rgb(0 0 0 / 0.08), 0 4px 12px rgb(0 0 0 / 0.06)",
    "--shadow-1": dark ? "0 1px 2px rgb(0 0 0 / 0.3), 0 0 0 0.5px var(--line)" : "0 1px 2px rgb(0 0 0 / 0.05), 0 0 0 0.5px var(--line)",
    "--shadow-2": dark ? "0 4px 14px rgb(0 0 0 / 0.35), 0 0 0 0.5px var(--line)" : "0 4px 14px rgb(0 0 0 / 0.07), 0 0 0 0.5px var(--line)",
    "--shadow-pop": `0 0 0 1px var(--line-2), 0 16px 48px rgb(0 0 0 / ${dark ? 0.32 : 0.16})`,
  });
  return vars;
}

const systemDark = () => typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;

let current: Appearance = DEFAULT_APPEARANCE;
const listeners = new Set<(a: Appearance) => void>();

/** Põe a Aparência em <html>. Só o que mudou de fato é reescrito. */
export function applyAppearance(a: Appearance, root: HTMLElement = document.documentElement): void {
  current = a;
  const side = resolveMode(a.mode, systemDark());
  const theme = themeFor(side === "dark" ? a.darkTheme : a.lightTheme, side);
  for (const [k, v] of Object.entries(themeVars(theme))) root.style.setProperty(k, v);
  root.style.setProperty("--text-scale", String(TEXT_SCALE[a.textSize]));
  root.style.colorScheme = side;
  root.dataset.theme = side;
  root.dataset.themeId = theme.id;
  if (a.font === "system") delete root.dataset.font;
  else root.dataset.font = a.font;
  if (a.motion === "reduced") root.dataset.motion = "reduced";
  else delete root.dataset.motion;
  for (const fn of listeners) fn(a);
}

function cache(a: Appearance) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(a));
  } catch {
    // Sem localStorage, a primeira pintura sai no padrão e troca quando o engine responde.
  }
}

function cached(): Appearance | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? sanitizeAppearance(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** O que veio do engine. Um engine antigo (antes do 1.7.0) não manda `appearance`: fica o padrão. */
export function fromSettings(s: Partial<AppSettings> | null | undefined): Appearance {
  return sanitizeAppearance(s?.appearance);
}

let started = false;

/**
 * Liga a Aparência numa janela: aplica a cópia local na hora (antes do React), depois o valor do engine, e segue o
 * `settings.changed` e a troca de claro/escuro do sistema. Chamado uma vez pelo `mount()`.
 */
export function startAppearance(): void {
  if (started || typeof document === "undefined") return;
  started = true;
  applyAppearance(cached() ?? DEFAULT_APPEARANCE);
  const engine = window.engine;
  if (engine?.has("settings.get")) {
    engine.invoke("settings.get", {}).then(
      (s) => {
        const a = fromSettings(s as AppSettings);
        applyAppearance(a);
        cache(a);
      },
      () => {},
    );
  }
  engine?.on("settings.changed", (payload) => {
    const a = fromSettings(payload as UiEvents["settings.changed"]);
    applyAppearance(a);
    cache(a);
  });
  if (typeof matchMedia === "function") {
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (current.mode === "system") applyAppearance(current);
    });
  }
}

/** A Aparência de agora e um jeito de mudar parte dela (a tela de Configurações). */
export function useAppearance(): [Appearance, (patch: Partial<Appearance>) => Promise<void>] {
  const [a, setA] = useState(current);
  useEffect(() => {
    listeners.add(setA);
    setA(current);
    return () => void listeners.delete(setA);
  }, []);
  const set = async (patch: Partial<Appearance>) => {
    const before = current;
    // Troca na hora; o engine confirma (e as outras janelas trocam pelo evento).
    applyAppearance({ ...current, ...patch });
    const engine = window.engine;
    if (!engine?.has("settings.set")) return;
    try {
      const s = (await engine.invoke("settings.set", { appearance: patch })) as AppSettings;
      const saved = fromSettings(s);
      applyAppearance(saved);
      cache(saved);
    } catch (e) {
      applyAppearance(before);
      throw e;
    }
  };
  return [a, set];
}
