// O arquivo de avisos de terceiros (spec #7079, revisão do T7109): as licenças Apache-2.0 e BSD pedem o texto delas
// junto do que é distribuído. O arquivo sai em `ui/notes/public/THIRD_PARTY_NOTICES.txt`, que o Vite copia para o pack
// das Notas (`dist/notes/`), a partir do `CREDITS` do Sobre e dos arquivos LICENSE dos pacotes instalados.
//
//   bun scripts/third-party-notices.ts            escreve o arquivo
//   bun scripts/third-party-notices.ts --check    só confere (exit 1 se estiver velho)

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { CREDITS, NOTICES_FILE, noticesText } from "../ui/hub/aboutText.ts";

const APP = path.resolve(import.meta.dir, "..");
export const NOTICES_PATH = path.join(APP, "ui", "notes", "public", NOTICES_FILE);

export function currentNotices(): string {
  return noticesText(
    CREDITS.map((c) => {
      const dir = path.join(APP, "node_modules", c.pkg);
      const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as { version: string };
      return { ...c, version: pkg.version, text: readFileSync(path.join(dir, "LICENSE"), "utf8") };
    }),
  );
}

if (import.meta.main) {
  const text = currentNotices();
  if (process.argv.includes("--check")) {
    const ok = readFileSync(NOTICES_PATH, "utf8") === text;
    console.log(ok ? "ok" : `${NOTICES_FILE} está velho: rode bun scripts/third-party-notices.ts`);
    process.exit(ok ? 0 : 1);
  }
  writeFileSync(NOTICES_PATH, text);
  console.log(NOTICES_PATH);
}
