// Gera os três build/*.html a partir do src/exportStandaloneHtml.ts (T14773, spec #14755).
// Da raiz do repo: `bun docs/design/kiwicat-v2/intro/gerar.ts`. A pasta build/ fica fora do git (o .gitignore da raiz).
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildStandaloneIntroHtml } from "./src/exportStandaloneHtml";

const builds = [
  ["intro-prototipo-navegador.html", buildStandaloneIntroHtml("prototype", true)],
  ["intro-app-com-moldura.html", buildStandaloneIntroHtml("app", true)],
  ["intro-sem-moldura.html", buildStandaloneIntroHtml("prototype", false)],
] as const;
const dir = resolve(import.meta.dir, "build");
mkdirSync(dir, { recursive: true });
for (const [name, html] of builds) {
  writeFileSync(resolve(dir, name), html);
  console.log(`gerado  build/${name}`);
}
