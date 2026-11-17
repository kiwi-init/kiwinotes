// Assina e publica uma UI no canal **local** (T1192, ADR 0006): .ui-channel/<janela>/manifest.json e o bundle, que o
// `scripts/ui-serve.ts` serve em 127.0.0.1. Usa o `publish` do devkit (o mesmo do `livewire ui publish`).
//
//   bun scripts/ui-build.ts
//   bun scripts/ui-publish.ts settings [--ui-version 0.1.0-local.2] [--key ~/.config/kiwinotes/ui-signing/<id>.private.pem]
//
// A chave privada fica fora do repo (ui-keys.ts diz onde). Nada aqui vai para a rede.

import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import { publish } from "../.hutch/devkit/api/sdks/main/appengine/cli.ts";
import { UI_WINDOWS, type UiWindow } from "../src/shared/ui-contract.ts";

const args = process.argv.slice(2);
const window = args[0] as UiWindow;
if (!UI_WINDOWS.includes(window)) throw new Error(`usage: ui-publish <${UI_WINDOWS.join("|")}> [--ui-version V] [--key PEM]`);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const appDir = path.resolve(import.meta.dirname, "..");
const keyDir = path.join(homedir(), ".config", "kiwinotes", "ui-signing");
const keyPath =
  flag("--key") ??
  (existsSync(keyDir) ? readdirSync(keyDir).filter((f) => f.endsWith(".private.pem")).map((f) => path.join(keyDir, f))[0] : undefined);
if (!keyPath || !existsSync(keyPath)) throw new Error(`ui-publish: no private key (looked in ${keyDir}); see src/bun/ui-keys.ts`);

let srcDir = path.join(appDir, "dist", window);
if (!existsSync(path.join(srcDir, "ui.json"))) throw new Error(`ui-publish: ${srcDir} has no ui.json; run bun scripts/ui-build.ts`);
const version = flag("--ui-version");
let temp: string | undefined;
if (version) {
  temp = mkdtempSync(path.join(tmpdir(), "kiwinotes-ui-publish-"));
  cpSync(srcDir, temp, { recursive: true });
  const ui = JSON.parse(readFileSync(path.join(temp, "ui.json"), "utf8"));
  writeFileSync(path.join(temp, "ui.json"), JSON.stringify({ ...ui, uiVersion: version }));
  srcDir = temp;
}

try {
  const out = await publish({
    srcDir,
    privateKeyPem: readFileSync(keyPath, "utf8"),
    siteDir: path.join(appDir, ".ui-channel", window),
  });
  console.log(`ui-publish: ${window} ${out.manifest.uiVersion} seq ${out.manifest.seq} (${out.fileCount} files) → ${out.manifestPath}`);
} finally {
  if (temp) rmSync(temp, { recursive: true, force: true });
}
