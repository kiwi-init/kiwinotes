// O que o hook `info-plist.ts` faz em cada .app antes de assinar, fora dele para o `bun test` (T29006): o hook roda ao
// ser importado.
//
// - No Info.plist: as frases do pedido de permissão na língua de reserva, a `CFBundleDevelopmentRegion`, o nome e a
//   versão curta (`bundle-identity.ts`).
// - Ao lado: o `InfoPlist.strings` de cada língua do app (`usage-strings.ts`), que o macOS escolhe pela língua do Mac.

import { spawnSync } from "node:child_process";
import path from "node:path";

import { identityKeys } from "./bundle-identity.ts";
import { DEVELOPMENT_REGION, usageDescriptions, writeUsageStrings } from "./usage-strings.ts";

/** As frases da língua de reserva e a própria língua, no Info.plist. */
export const USAGE: Record<string, string> = { ...usageDescriptions(DEVELOPMENT_REGION), CFBundleDevelopmentRegion: DEVELOPMENT_REGION };

/** Prepara o .app do `plist` (`<app>/Contents/Info.plist`); devolve os `InfoPlist.strings` gravados. Não assina. */
export function applyAppPlist(plist: string): string[] {
  const read = spawnSync("plutil", ["-extract", "CFBundleVersion", "raw", plist], { encoding: "utf8" });
  if (read.status !== 0) throw new Error(`info-plist: no CFBundleVersion in ${plist}`);
  for (const [key, value] of Object.entries({ ...USAGE, ...identityKeys(read.stdout.trim()) })) {
    // -replace cria a chave quando ela não existe.
    const r = spawnSync("plutil", ["-replace", key, "-string", value, plist], { stdio: "inherit" });
    if (r.status !== 0) throw new Error(`info-plist: plutil failed on ${plist}`);
  }
  return writeUsageStrings(path.dirname(path.dirname(plist)));
}
