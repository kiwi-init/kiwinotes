// O ONNX Runtime da busca semântica (L17, T6318) dentro do .app. O `onnxruntime-node` carrega o binding por
// `require("../bin/napi-v6/<plataforma>/<arch>/onnxruntime_binding.node")`, relativo ao bundle em
// Resources/app/bun/index.js. O preBuild põe em app/.onnxruntime/ só o binding e a `libonnxruntime.1.dylib` que ele
// pede (`@rpath`, com `@loader_path`), e o `copy` leva essa pasta para bin/napi-v6/darwin/arm64. O pacote traz a dylib
// em dobro (`libonnxruntime.1.30.0.dylib`, 45 MB cada); a segunda cópia fica de fora. O release.ts assina os dois Mach-O.

import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

export const ONNX_PACKAGE = "onnxruntime-node";
export const ONNX_BUNDLE_DIR = "bin/napi-v6/darwin/arm64";
export const ONNX_DYLIB = "libonnxruntime.1.dylib";
export const ONNX_FILES = ["onnxruntime_binding.node", ONNX_DYLIB] as const;
export const ONNX_STAGE = ".onnxruntime";

export function onnxSourceDir(appDir: string): string {
  return path.join(appDir, "node_modules", ONNX_PACKAGE, ONNX_BUNDLE_DIR);
}

export function stageOnnxRuntime(appDir: string): string[] {
  const from = onnxSourceDir(appDir);
  const missing = ONNX_FILES.filter((name) => !existsSync(path.join(from, name)));
  if (missing.length) throw new Error(`onnxruntime: ${missing.join(", ")} not found in ${from}; run bun install`);
  const out = path.join(appDir, ONNX_STAGE);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const name of ONNX_FILES) cpSync(path.join(from, name), path.join(out, name));
  return ONNX_FILES.map((name) => path.join(out, name));
}

if (import.meta.main) {
  for (const file of stageOnnxRuntime(process.cwd())) console.log(`onnxruntime: ${path.basename(file)} → ${ONNX_STAGE}/`);
}
