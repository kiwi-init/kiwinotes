// preBuild (electrobun.config.ts, pelo pre-build.ts): compila o processo da voz do gato (native-voice/, ADR 0014, T26732)
// e põe o `kiwi-voice` com o bundle do MLX (o `default.metallib`) em app/.voice/. O `copy` leva essa pasta para dentro do
// .app, em voice/.
//
// Só o `xcodebuild` compila os shaders Metal do MLX: o `swift build` da linha de comando sai sem o metallib, e o processo
// falha na 1ª frase. Por isso o executável fica num pacote à parte, e não no native/ do helper.
//
// - O release (`bun run build` no CI) sempre compila, ou usa o app/.voice do cache com KIWI_VOICE_CACHED=1.
// - O `bun dev` e os builds dos agentes pulam, para não compilar o MLX do zero (~5 min) em cada worktree: o app sem o
//   `voice/` só não fala. KIWI_BUILD_VOICE=1 compila assim mesmo.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

export const VOICE_EXE = "kiwi-voice";
/** O bundle do mlx-swift com o `default.metallib`: o MLX o procura ao lado do executável. */
export const MLX_BUNDLE = "mlx-swift_Cmlx.bundle";

export function metallibIn(dir: string): string | null {
  for (const rel of [path.join(MLX_BUNDLE, "Contents", "Resources", "default.metallib"), path.join(MLX_BUNDLE, "default.metallib")]) {
    if (existsSync(path.join(dir, rel))) return rel;
  }
  return null;
}

/** O que precisa estar em app/.voice para o .app falar: o executável e o metallib. */
export function checkVoiceDir(dir: string): void {
  if (!existsSync(path.join(dir, VOICE_EXE))) throw new Error(`build-voice: no ${VOICE_EXE} in ${dir}`);
  if (!metallibIn(dir)) throw new Error(`build-voice: no ${MLX_BUNDLE}/…/default.metallib in ${dir}: was it built with xcodebuild?`);
}

export function buildVoice(appDir: string, env = process.env): "built" | "cached" | "skipped" {
  const voiceDir = path.resolve(appDir, "..", "native-voice");
  const out = path.join(appDir, ".voice");
  const release = env.ELECTROBUN_BUILD_ENV !== "dev";

  const log = (source: string) => {
    const sha = createHash("sha256").update(readFileSync(path.join(out, VOICE_EXE))).digest("hex");
    console.log(`build-voice: ${source} → .voice/ (${VOICE_EXE} sha256 ${sha})`);
  };

  if (env.KIWI_VOICE_CACHED === "1") {
    checkVoiceDir(out);
    log("from the cache");
    return "cached";
  }
  if (!release && env.KIWI_BUILD_VOICE !== "1") {
    console.log("build-voice: skipped in dev (KIWI_BUILD_VOICE=1 builds it): the app won't speak");
    // A pasta existe sempre, mesmo vazia, para o `copy` do electrobun.config.ts. Um build anterior fica como está.
    mkdirSync(out, { recursive: true });
    return "skipped";
  }

  const derived = path.join(voiceDir, ".build-xcode");
  const config = release ? "Release" : "Debug";
  const args = [
    "-scheme", VOICE_EXE,
    "-configuration", config,
    "-destination", "platform=macOS,arch=arm64",
    "-derivedDataPath", derived,
    // O mlx-swift e o swift-transformers trazem plugins e macros do SwiftPM: sem estas, o xcodebuild pede um clique.
    "-skipPackagePluginValidation",
    "-skipMacroValidation",
    "build",
  ];
  console.log(`build-voice: xcodebuild ${args.join(" ")}`);
  const r = spawnSync("xcodebuild", args, { cwd: voiceDir, stdio: ["ignore", "inherit", "inherit"] });
  if (r.status !== 0) throw new Error(`build-voice: xcodebuild -configuration ${config} failed`);

  const products = path.join(derived, "Build", "Products", config);
  checkVoiceDir(products);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(path.join(products, VOICE_EXE), path.join(out, VOICE_EXE));
  for (const name of readdirSync(products)) {
    if (name.endsWith(".bundle")) cpSync(path.join(products, name), path.join(out, name), { recursive: true });
  }
  checkVoiceDir(out);
  log(products);
  return "built";
}

if (import.meta.main) buildVoice(process.cwd());
