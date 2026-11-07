// preBuild (electrobun.config.ts): compila o helper Swift (native/) e põe o executável, com os bundles de
// recursos do SwiftPM, em app/.helper/. O `copy` leva essa pasta para dentro do .app, em bin/.
// Release no build de verdade, debug no `bun dev`. KIWI_SKIP_HELPER_BUILD=1 só copia o que já está compilado.
// KIWI_HELPER_CACHED=1 (o release no CI, quando o cache trouxe o app/.helper desses fontes, T1686) não compila nem
// copia: usa o app/.helper como está.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

import { bundleHelperLibraries } from "./helper-libs.ts";

// O Hutch roda os hooks na raiz do projeto (app/).
const appDir = process.cwd();
if (!existsSync(path.join(appDir, "electrobun.config.ts"))) throw new Error(`build-helper: run from app/, not ${appDir}`);
const nativeDir = path.resolve(appDir, "..", "native");
const config = process.env.ELECTROBUN_BUILD_ENV === "dev" ? "debug" : "release";
const out = path.join(appDir, ".helper");

function swift(args: string[]): string {
  const r = spawnSync("swift", args, { cwd: nativeDir, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    // O compilador escreve os erros no stdout: sem isto, uma falha no CI só dizia "failed" (T1074).
    process.stderr.write(r.stdout ?? "");
    throw new Error(`build-helper: swift ${args.join(" ")} failed`);
  }
  return r.stdout.trim();
}

// O SHA-256 vai para o log: um helper vindo do cache dá para comparar com o do run que o compilou.
function logHelper(source: string) {
  const sha = createHash("sha256").update(readFileSync(path.join(out, "kiwi-helper"))).digest("hex");
  console.log(`build-helper: ${source} → .helper/ (kiwi-helper sha256 ${sha})`);
}

if (process.env.KIWI_HELPER_CACHED === "1") {
  if (config !== "release" || !existsSync(path.join(out, "kiwi-helper"))) {
    throw new Error("build-helper: KIWI_HELPER_CACHED=1 needs a release build and a restored .helper/kiwi-helper");
  }
  logHelper("from the cache");
  process.exit(0);
}

if (process.env.KIWI_SKIP_HELPER_BUILD !== "1") {
  console.log(`build-helper: swift build -c ${config} --product kiwi-helper`);
  // A saída do build vai direto para o log (erros e o que recompila: no CI é assim que se vê se o cache serviu).
  const r = spawnSync("swift", ["build", "-c", config, "--product", "kiwi-helper"], { cwd: nativeDir, stdio: ["ignore", "inherit", "inherit"] });
  if (r.status !== 0) throw new Error(`build-helper: swift build -c ${config} failed`);
}
const binDir = swift(["build", "-c", config, "--show-bin-path"]).split("\n").pop()!;
const helper = path.join(binDir, "kiwi-helper");
if (!existsSync(helper)) throw new Error(`build-helper: no helper at ${helper}`);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(helper, path.join(out, "kiwi-helper"));
// Bundle.module procura os recursos do SwiftPM ao lado do executável.
for (const name of readdirSync(binDir)) {
  if (name.endsWith(".bundle")) cpSync(path.join(binDir, name), path.join(out, name), { recursive: true });
}
// T6602: o transcribe.cpp (framework dinâmico) vira uma dylib simples ao lado do helper (scripts/helper-libs.ts).
for (const lib of bundleHelperLibraries(binDir, out)) console.log(`build-helper: ${lib} next to the helper`);
logHelper(helper);
