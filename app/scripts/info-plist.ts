// postBuild e postWrap (electrobun.config.ts): põe no Info.plist do .app as frases que o macOS mostra ao pedir
// permissão, e depois assina o .app inteiro ad hoc.
//
// - As frases: o Electrobun não tem campo para elas, e sem o NSMicrophoneUsageDescription o macOS nega o mic ao helper,
//   que roda como filho do app (#133).
// - A assinatura (T658): com `codesign: false`, o launcher sai só com a assinatura do linker (`Identifier=launcher`,
//   `Info.plist=not bound`, bundle sem selo). O TCC atribui o helper ao launcher, mas a Acessibilidade ligada nos
//   Ajustes para o "Kiwi Notes.app" não valia para ele. Assinado aqui, o launcher fica com
//   `Identifier=app.kiwinotes.desktop`, o Info.plist bound e os recursos selados. O custo: a assinatura ad hoc é o
//   cdhash, que muda a cada build, então a cada build novo a permissão precisa ser dada de novo. Isso só some com uma
//   Developer ID (decisão do harry, fora do T658).
// - A ordem importa: o `plutil` muda o Info.plist, então a assinatura vem depois dele. Com `codesign: true`, o Hutch
//   assina depois disto (postWrap roda "before final packaging/signing"); confira com `codesign --verify --deep --strict`.
// - No postWrap, o app de dentro do `KiwiNotes.app.tar.zst` é reassinado antes do wrapper (T762): o Electrobun mexe
//   no `version.json` dele depois do postBuild. Ver `signing.ts`. O postPackage (`verify-signature.ts`) confere tudo.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { resealBundles, signAdHoc } from "./signing.ts";

const USAGE: Record<string, string> = {
  NSMicrophoneUsageDescription: "O Kiwi Notes ouve o microfone só enquanto você segura o atalho, e transcreve tudo no seu Mac.",
};

/** Os Info.plist de todos os .app dentro de `dir` (o app e, no release, o wrapper). */
function infoPlists(dir: string, depth = 4): string[] {
  if (depth < 0 || !existsSync(dir) || !statSync(dir).isDirectory()) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (name.endsWith(".app")) {
      const plist = path.join(p, "Contents", "Info.plist");
      if (existsSync(plist)) out.push(plist);
    } else if (!name.startsWith(".")) {
      out.push(...infoPlists(p, depth - 1));
    }
  }
  return out;
}

function setUsage(plist: string): void {
  for (const [key, value] of Object.entries(USAGE)) {
    // -replace cria a chave quando ela não existe.
    const r = spawnSync("plutil", ["-replace", key, "-string", value, plist], { stdio: "inherit" });
    if (r.status !== 0) throw new Error(`info-plist: plutil failed on ${plist}`);
  }
}

// O Hutch carrega o hook como módulo (sem `import.meta.main`), então o corpo roda no topo.
{
  const roots = [process.env.ELECTROBUN_WRAPPER_BUNDLE_PATH, process.env.ELECTROBUN_BUILD_DIR].filter(Boolean) as string[];
  const plists = new Set<string>();
  for (const root of roots) {
    if (root.endsWith(".app") && existsSync(path.join(root, "Contents", "Info.plist"))) plists.add(path.join(root, "Contents", "Info.plist"));
    for (const p of infoPlists(root)) plists.add(p);
  }
  if (!plists.size) throw new Error(`info-plist: no .app under ${roots.join(", ") || "(no build dir)"}`);
  // postWrap: o app de dentro do tar primeiro, porque o wrapper leva uma cópia do tar e o selo do wrapper cobre ela.
  const wrapper = process.env.ELECTROBUN_WRAPPER_BUNDLE_PATH;
  const buildDir = process.env.ELECTROBUN_BUILD_DIR;
  if (wrapper && buildDir) {
    const resources = path.join(wrapper, "Contents", "Resources");
    const bundles = [buildDir, resources].flatMap((dir) =>
      existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".tar.zst")).map((n) => path.join(dir, n)) : []);
    if (!bundles.length) throw new Error(`info-plist: no .tar.zst in ${buildDir} or ${resources}`);
    for (const file of resealBundles(bundles)) console.log(`info-plist: re-signed the app inside ${file}`);
  }
  for (const p of plists) {
    setUsage(p);
    console.log(`info-plist: usage descriptions in ${p}`);
  }
  // Assina depois de mexer em todos os Info.plist: o de dentro primeiro, se um .app estiver dentro do outro.
  const apps = [...plists].map((p) => path.dirname(path.dirname(p))).sort((a, b) => b.length - a.length);
  for (const app of apps) {
    signAdHoc(app);
    console.log(`info-plist: signed ad hoc ${app}`);
  }
}
