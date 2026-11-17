// T6602: o helper carrega o transcribe.cpp do modo preciso como framework dinâmico (`@rpath/CTranscribe.framework/…`,
// o xcframework da release dele). O `copy` do Electrobun leva a pasta `.helper` para o .app, e o `release.ts` assina
// cada Mach-O de dentro para fora. Para não depender de como o copy trata os symlinks do framework (`Versions/Current`)
// nem de assinar um bundle de framework, cada framework vira um arquivo simples ao lado do helper: só a fatia arm64 do
// binário, `@loader_path/lib<nome>.dylib`, com o load command do helper apontado para ele. Um `@rpath` que não é
// framework quebra o build aqui, e não no app da pessoa.

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";

import { machoLoadsOf } from "./macho.ts";

export interface RpathFramework {
  /** O load command como o helper tem: `@rpath/CTranscribe.framework/Versions/Current/CTranscribe`. */
  load: string;
  /** O caminho do binário dentro do framework, relativo à pasta do build. */
  binary: string;
  /** O arquivo que vai ao lado do helper: `libCTranscribe.dylib`. */
  dylib: string;
}

/** Os frameworks que o helper pede por `@rpath`. Outro tipo de `@rpath` (uma dylib solta) é erro. */
export function rpathFrameworks(dylibs: readonly string[]): RpathFramework[] {
  return dylibs
    .filter((d) => d.startsWith("@rpath/"))
    .map((load) => {
      const m = /^@rpath\/([^/]+)\.framework\/((?:Versions\/[^/]+\/)?)([^/]+)$/.exec(load);
      if (!m || m[1] !== m[3]) throw new Error(`helper-libs: the helper loads ${load}, which isn't a framework: ship it on purpose`);
      return { load, binary: `${m[1]}.framework/${m[2]}${m[3]}`, dylib: `lib${m[1]}.dylib` };
    });
}

function run(cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`helper-libs: ${cmd} ${args.join(" ")} failed: ${(r.stderr || r.stdout || "").trim()}`);
  return r.stdout;
}

/**
 * Põe ao lado de `out/kiwi-helper` cada framework que ele carrega por `@rpath`, como dylib simples, e aponta o helper
 * para elas. As duas pontas ficam com assinatura ad hoc (o `install_name_tool` invalida a do linker); o `release.ts`
 * assina de novo com o Developer ID. Devolve os arquivos postos.
 */
export function bundleHelperLibraries(binDir: string, out: string): string[] {
  const helper = path.join(out, "kiwi-helper");
  const frameworks = rpathFrameworks(machoLoadsOf(helper).dylibs);
  for (const f of frameworks) {
    const source = path.join(binDir, f.binary);
    if (!existsSync(source)) throw new Error(`helper-libs: the helper loads ${f.load}, but ${source} isn't there`);
    const target = path.join(out, f.dylib);
    const archs = run("lipo", ["-archs", source]).trim().split(/\s+/);
    if (!archs.includes("arm64")) throw new Error(`helper-libs: ${source} has no arm64 slice (${archs.join(", ")})`);
    if (archs.length > 1) run("lipo", [source, "-thin", "arm64", "-output", target]);
    else copyFileSync(source, target);
    run("install_name_tool", ["-id", `@loader_path/${f.dylib}`, target]);
    run("install_name_tool", ["-change", f.load, `@loader_path/${f.dylib}`, helper]);
    run("codesign", ["--force", "--sign", "-", target]);
  }
  if (frameworks.length) run("codesign", ["--force", "--sign", "-", helper]);
  return frameworks.map((f) => f.dylib);
}
