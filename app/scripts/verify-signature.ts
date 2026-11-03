// postPackage (electrobun.config.ts): o build falha se algum Kiwi Notes.app que sai dele não passa em
// `codesign --verify --deep --strict` (T762). Confere:
// - os .app em build/ (no stable, o wrapper) e o app de dentro de cada .tar.zst ao lado deles;
// - o app de dentro de cada `artifacts/*.tar.zst` (o que o wrapper extrai e o que o updater baixa);
// - o .dmg: monta só leitura, sem janela, e confere o app dele e o tar que ele leva.
// Não abre o app e não pede permissão nenhuma.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { appsIn, verifyApp, verifyBundle, withDmg } from "./signing.ts";

function files(dir: string | undefined, ext: string): string[] {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith(ext)).map((n) => path.join(dir, n));
}

/** O wrapper fecha a janela "Installation complete" sozinho (T951, `info-plist.ts`). */
function checkAutoclose(app: string, where: string): void {
  const plist = path.join(app, "Contents", "Info.plist");
  const r = spawnSync("plutil", ["-extract", "LSEnvironment.ELECTROBUN_INSTALLER_UI_AUTOCLOSE", "raw", plist], { encoding: "utf8" });
  if (r.status !== 0 || r.stdout.trim() !== "1") {
    throw new Error(`verify-signature: ${where}: ${path.basename(app)} has no LSEnvironment ELECTROBUN_INSTALLER_UI_AUTOCLOSE=1`);
  }
  console.log(`verify-signature: ok ${where}: ${path.basename(app)} closes the installer window on its own`);
}

/** Os .app de `dir` e os de dentro dos .tar.zst que eles levam em Resources. */
function checkApps(dir: string, where: string): number {
  let count = 0;
  for (const app of appsIn(dir)) {
    verifyApp(app);
    console.log(`verify-signature: ok ${where}: ${path.basename(app)}`);
    count++;
    const inner = files(path.join(app, "Contents", "Resources"), ".tar.zst");
    if (inner.length) checkAutoclose(app, where);
    for (const tar of inner) {
      for (const inner of verifyBundle(tar)) console.log(`verify-signature: ok ${where}: ${inner} inside ${path.basename(tar)}`);
      count++;
    }
  }
  return count;
}

// O Hutch carrega o hook como módulo (sem `import.meta.main`), então o corpo roda no topo.
{
  const buildDir = process.env.ELECTROBUN_BUILD_DIR;
  const artifactDir = process.env.ELECTROBUN_ARTIFACT_DIR;
  const env = process.env.ELECTROBUN_BUILD_ENV;
  if (!buildDir) throw new Error("verify-signature: no ELECTROBUN_BUILD_DIR");
  let count = checkApps(buildDir, "build");
  // O artifacts/ é um só para todos os envs: só o que este build fez. O build dev não faz wrapper nem artifacts. Um
  // build com wrapper (o .app em build/<env> leva o tar em Resources) fez o <env>-*.tar.zst e o .dmg do artifacts/.
  const wrapped = appsIn(buildDir).some((app) => files(path.join(app, "Contents", "Resources"), ".tar.zst").length > 0);
  const artifacts = wrapped ? files(artifactDir, ".tar.zst").filter((f) => path.basename(f).startsWith(`${env}-`)) : [];
  if (wrapped && !artifacts.length) throw new Error(`verify-signature: no ${env}-*.tar.zst in ${artifactDir}`);
  for (const tar of [...files(buildDir, ".tar.zst"), ...artifacts]) {
    for (const inner of verifyBundle(tar)) console.log(`verify-signature: ok ${path.basename(tar)}: ${inner}`);
    count++;
  }
  const dmgs = wrapped ? [...files(buildDir, ".dmg"), ...files(artifactDir, ".dmg")] : [];
  if (wrapped && !dmgs.length) throw new Error(`verify-signature: no .dmg in ${artifactDir}`);
  for (const dmg of dmgs) {
    count += withDmg(dmg, (mount) => checkApps(mount, path.basename(dmg)));
  }
  if (!count) throw new Error(`verify-signature: no .app to check in ${buildDir}`);
}
