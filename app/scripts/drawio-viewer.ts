// O viewer do draw.io que vai no pack das Notas (T7112, spec #7079, escolha B do harry no #7312): o
// `viewer-static.min.js` oficial da JGraph (Apache-2.0), na versão fixa abaixo, conferido pelo sha256. Ele não está no
// npm; o arquivo fica no repo em `ui/notes/files/drawio/`, junto da licença, e entra no pack pelo import `?url` do
// `DrawioViewer` (em toda janela que mostra as Notas: a janela Notas e o hub).
//
//   bun scripts/drawio-viewer.ts            baixa da tag e confere (só para trocar de versão)
//   bun scripts/drawio-viewer.ts --check    só confere os arquivos do repo (o teste roda isto)

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const DRAWIO_VERSION = "32.6.10";
export const DRAWIO_DIR = path.resolve(import.meta.dir, "..", "ui", "notes", "files", "drawio");
export const DRAWIO_FILES = {
  "viewer-static.min.js": { from: "src/main/webapp/js/viewer-static.min.js", sha256: "35b8ef54369e938ad2399d3c8ce3945591d4b200a01f6942d0e39743bea1f1a1" },
  LICENSE: { from: "LICENSE", sha256: "43070e2d4e532684de521b885f385d0841030efa2b1a20bafb76133a5e1379c1" },
} as const;

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Os arquivos que não batem com o hash fixado (ou que faltam). */
export function checkDrawio(): string[] {
  return Object.entries(DRAWIO_FILES)
    .filter(([name, f]) => {
      const file = path.join(DRAWIO_DIR, name);
      return !existsSync(file) || sha256(readFileSync(file)) !== f.sha256;
    })
    .map(([name]) => name);
}

if (import.meta.main) {
  if (!process.argv.includes("--check")) {
    mkdirSync(DRAWIO_DIR, { recursive: true });
    for (const [name, f] of Object.entries(DRAWIO_FILES)) {
      const url = `https://raw.githubusercontent.com/jgraph/drawio/v${DRAWIO_VERSION}/${f.from}`;
      const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
      if (sha256(bytes) !== f.sha256) throw new Error(`${name}: o sha256 não bate com o fixado (${url})`);
      writeFileSync(path.join(DRAWIO_DIR, name), bytes);
    }
  }
  const bad = checkDrawio();
  console.log(bad.length ? `não batem: ${bad.join(", ")}` : `ok: draw.io ${DRAWIO_VERSION}`);
  process.exit(bad.length ? 1 : 0);
}
