// postBuild e postWrap (electrobun.config.ts): põe no Info.plist do .app as frases que o macOS mostra ao pedir
// permissão. O Electrobun não tem campo para elas, e sem o NSMicrophoneUsageDescription o macOS nega o mic
// ao helper, que roda como filho do app (#133).
//
// Assinatura: hoje `codesign: false`. Pela doc do Electrobun, o `postWrap` roda "before final packaging/signing", mas
// não está claro se o app de dentro já foi assinado antes. Quando ligarem a assinatura, confira com
// `codesign --verify --deep --strict` nos dois .app; se quebrar, este passo vai para antes da assinatura (review #521).

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

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
  for (const p of plists) {
    setUsage(p);
    console.log(`info-plist: usage descriptions in ${p}`);
  }
}
