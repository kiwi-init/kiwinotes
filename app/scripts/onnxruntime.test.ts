// T6318: o ONNX Runtime que o preBuild leva para o .app tem de ser o do `onnxruntime-node` fixado no package.json,
// no caminho que o binding dele pede. Uma versão nova que mude o caminho (napi-v6) ou o nome da dylib quebra aqui,
// e não no app da pessoa.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import config from "../electrobun.config.ts";
import { machoLoadsOf } from "./macho.ts";
import { ONNX_BUNDLE_DIR, ONNX_DYLIB, ONNX_FILES, ONNX_PACKAGE, ONNX_STAGE, onnxSourceDir, stageOnnxRuntime } from "./onnxruntime.ts";

const appDir = path.resolve(import.meta.dir, "..");
const pkgDir = path.join(appDir, "node_modules", ONNX_PACKAGE);

type Manifest = { version?: string; dependencies?: Record<string, string> };
const manifest = (file: string): Manifest => JSON.parse(readFileSync(file, "utf8")) as Manifest;

describe("o onnxruntime-node instalado", () => {
  test("é a versão fixada no package.json", () => {
    const pin = manifest(path.join(appDir, "package.json")).dependencies?.[ONNX_PACKAGE];
    expect(pin).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest(path.join(pkgDir, "package.json")).version).toBe(pin);
  });

  test("pede o binding no caminho que o app copia", () => {
    const binding = readFileSync(path.join(pkgDir, "dist", "binding.js"), "utf8");
    const m = binding.match(/require\(`\.\.\/(bin\/napi-v\d+)\/\$\{process\.platform\}\/\$\{process\.arch\}\/onnxruntime_binding\.node`\)/);
    expect(m?.[1]).toBeDefined();
    expect(`${m?.[1]}/darwin/arm64`).toBe(ONNX_BUNDLE_DIR);
  });

  test("tem os dois arquivos, e o binding só precisa da dylib ao lado dele", () => {
    const names = readdirSync(onnxSourceDir(appDir));
    for (const name of ONNX_FILES) expect(names).toContain(name);
    const loads = machoLoadsOf(path.join(onnxSourceDir(appDir), "onnxruntime_binding.node"));
    expect(loads.dylibs.filter((l) => l.startsWith("@rpath/"))).toEqual([`@rpath/${ONNX_DYLIB}`]);
    expect(loads.rpaths).toContain("@loader_path");
  });

  test("o copy do electrobun.config.ts leva a pasta preparada para esse caminho", () => {
    expect(config.build.copy[ONNX_STAGE]).toBe(ONNX_BUNDLE_DIR);
    expect(config.scripts.preBuild).toBe("./scripts/pre-build.ts");
  });
});

describe("stageOnnxRuntime", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "kiwinotes-onnx-test-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("copia só o binding e a dylib, sem a cópia versionada", () => {
    const from = onnxSourceDir(dir);
    mkdirSync(from, { recursive: true });
    for (const name of [...ONNX_FILES, "libonnxruntime.1.30.0.dylib"]) writeFileSync(path.join(from, name), name);
    stageOnnxRuntime(dir);
    expect(readdirSync(path.join(dir, ONNX_STAGE)).sort()).toEqual([...ONNX_FILES].sort());
  });

  test("falha com o nome do que falta", () => {
    mkdirSync(onnxSourceDir(dir), { recursive: true });
    writeFileSync(path.join(onnxSourceDir(dir), "onnxruntime_binding.node"), "x");
    expect(() => stageOnnxRuntime(dir)).toThrow(ONNX_DYLIB);
  });
});
