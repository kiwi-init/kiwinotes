// preBuild (electrobun.config.ts): compila o helper Swift (native/) e põe o executável, com os bundles de
// recursos do SwiftPM, em app/.helper/. O `copy` leva essa pasta para dentro do .app, em bin/.
// Release no build de verdade, debug no `bun dev`. KIWI_SKIP_HELPER_BUILD=1 só copia o que já está compilado.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

// O Hutch roda os hooks na raiz do projeto (app/).
const appDir = process.cwd();
if (!existsSync(path.join(appDir, "electrobun.config.ts"))) throw new Error(`build-helper: run from app/, not ${appDir}`);
const nativeDir = path.resolve(appDir, "..", "native");
const config = process.env.ELECTROBUN_BUILD_ENV === "dev" ? "debug" : "release";

function swift(args: string[]): string {
  const r = spawnSync("swift", args, { cwd: nativeDir, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  if (r.status !== 0) throw new Error(`build-helper: swift ${args.join(" ")} failed`);
  return r.stdout.trim();
}

if (process.env.KIWI_SKIP_HELPER_BUILD !== "1") {
  console.log(`build-helper: swift build -c ${config} --product kiwi-helper`);
  swift(["build", "-c", config, "--product", "kiwi-helper"]);
}
const binDir = swift(["build", "-c", config, "--show-bin-path"]).split("\n").pop()!;
const helper = path.join(binDir, "kiwi-helper");
if (!existsSync(helper)) throw new Error(`build-helper: no helper at ${helper}`);

const out = path.join(appDir, ".helper");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(helper, path.join(out, "kiwi-helper"));
// Bundle.module procura os recursos do SwiftPM ao lado do executável.
for (const name of readdirSync(binDir)) {
  if (name.endsWith(".bundle")) cpSync(path.join(binDir, name), path.join(out, name), { recursive: true });
}
console.log(`build-helper: ${helper} → .helper/`);
