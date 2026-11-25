// A língua do macOS para o "Automático" do idioma do app (spec #28171, T28190). Lida uma vez por processo: o macOS pede
// reiniciar o app para trocar a língua dele, e o Kiwi faz igual.
//
// `KIWI_SYSTEM_LANG` (uma lista, `en-US,pt-BR`) passa por cima: o headless e os testes escolhem a língua sem ler o Mac.

import { spawnSync } from "node:child_process";

/** As línguas da saída de `defaults read -g AppleLanguages` (um array do plist: `(\n "pt-BR",\n "en-US"\n)`). */
export function parseAppleLanguages(out: string): string[] {
  return [...out.matchAll(/"?([A-Za-z]{2,3}(?:[-_][A-Za-z0-9]+)*)"?\s*,?\s*$/gm)].map((m) => m[1]!).filter((l) => l !== "");
}

export function envSystemLanguages(env: Record<string, string | undefined> = process.env): string[] | null {
  const v = env.KIWI_SYSTEM_LANG?.trim();
  return v ? v.split(",").map((s) => s.trim()).filter(Boolean) : null;
}

let cached: string[] | null = null;

/** As línguas do macOS, na ordem da preferência. Sem conseguir ler, `[]` (e o Automático fica em português). */
export function systemLanguages(): string[] {
  const fromEnv = envSystemLanguages();
  if (fromEnv) return fromEnv;
  if (cached) return cached;
  try {
    const r = spawnSync("/usr/bin/defaults", ["read", "-g", "AppleLanguages"], { encoding: "utf8", timeout: 2000 });
    cached = r.status === 0 ? parseAppleLanguages(r.stdout) : [];
  } catch {
    cached = [];
  }
  return cached;
}
