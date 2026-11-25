// As frases do pedido de permissão do macOS em cada língua (spec #28171, T29006), fora do hook `info-plist.ts`, que
// roda ao ser importado.
//
// O macOS escolhe a frase pela língua do Mac, não pela do app: lê o `InfoPlist.strings` do `<língua>.lproj` dentro do
// `.app` e, sem nenhum que sirva, o da `CFBundleDevelopmentRegion` (pt, como o app sempre foi). O texto sai do mesmo
// catálogo das telas (`src/shared/i18n`), então uma língua nova no catálogo já vem com as frases.
//
// Efeito junto: com `pt.lproj` e `en.lproj` no bundle, o AppKit passa a escrever os itens de sistema do menu (Desfazer,
// Copiar…) na língua do Mac quando ela é uma dessas duas.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { type Locale, LOCALES, type TextKey, translate } from "../src/shared/i18n/index.ts";

/** A chave do Info.plist e a do catálogo. */
export const USAGE_KEYS = {
  NSMicrophoneUsageDescription: "system.micUsage",
  NSAudioCaptureUsageDescription: "system.audioCaptureUsage",
} as const satisfies Record<string, TextKey>;

/** A língua de quando o Mac não está em nenhuma das do app. */
export const DEVELOPMENT_REGION: Locale = "pt";

/** As frases numa língua, pelas chaves do Info.plist. */
export function usageDescriptions(locale: Locale): Record<keyof typeof USAGE_KEYS, string> {
  return Object.fromEntries(Object.entries(USAGE_KEYS).map(([k, key]) => [k, translate(locale, key)])) as Record<keyof typeof USAGE_KEYS, string>;
}

/** Um `.strings` (UTF-8, que o macOS lê desde o 10.6): `"Chave" = "valor";` por linha. */
export function stringsFile(entries: Record<string, string>): string {
  const quote = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
  return Object.entries(entries).map(([k, v]) => `${quote(k)} = ${quote(v)};`).join("\n") + "\n";
}

/** Grava `Contents/Resources/<língua>.lproj/InfoPlist.strings` de cada língua no `.app`; devolve os caminhos. */
export function writeUsageStrings(app: string): string[] {
  return LOCALES.map((locale) => {
    const dir = path.join(app, "Contents", "Resources", `${locale}.lproj`);
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "InfoPlist.strings");
    writeFileSync(file, stringsFile(usageDescriptions(locale)));
    return file;
  });
}
