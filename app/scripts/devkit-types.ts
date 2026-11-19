// Os tipos do Electrobun para o `typecheck` no Linux (spec #21331), sem o Hutch, que só tem build para macOS arm64.
//
// O `tsconfig.json` do app estende o `.hutch/devkit/tsconfig.json`, que o `electrobun prepare` monta a partir do core
// do Electrobun: a pasta `api/` (só TypeScript) e um tsconfig com um `paths` por export do `native-devkit.json`. Este
// script monta o mesmo devkit a partir do mesmo arquivo: o core de macOS arm64 fixado no `hutch-pin.json` (o sha256
// conferido), de onde tira só a `api/` e o `native-devkit.json`. Assim o typecheck do Linux vê os mesmos bytes que o do
// Mac. O `devkit-types.test.ts`, no macOS, compara o resultado com o devkit do Hutch.
//
//   bun scripts/devkit-types.ts          # monta app/.hutch/devkit (não mexe num devkit completo do Hutch)
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import pin from "../hutch-pin.json" with { type: "json" };

/** O pedaço do `native-devkit.json` que o devkit usa. */
export interface NativeDevkit {
  product: { name: string; version: string };
  layout: { sdks: { javascript: { main: string; exports: Record<string, string> } } };
}

/** O `tsconfig.json` e o `package.json` do devkit, como o Hutch escreve. */
export function devkitConfig(nd: NativeDevkit): { tsconfig: unknown; packageJson: unknown } {
  const js = nd.layout.sdks.javascript;
  const dot = (p: string) => `./${p}`;
  const paths: Record<string, string[]> = {};
  const exports: Record<string, string> = {};
  for (const [key, file] of Object.entries(js.exports)) {
    paths[key === "." ? nd.product.name : `${nd.product.name}${key.slice(1)}`] = [dot(file)];
    exports[key] = dot(file);
  }
  return {
    tsconfig: { compilerOptions: { baseUrl: ".", paths } },
    packageJson: { name: nd.product.name, version: nd.product.version, private: true, type: "module", types: dot(js.main), exports },
  };
}

/** Onde o core fixado está, e o sha256 dele. */
export function coreUrl(): { url: string; sha256: string } {
  const core = pin.devkitCore;
  return { url: `${pin.releasesBaseUrl}/v${pin.electrobun}/${core.asset}`, sha256: core.sha256 };
}

async function main(): Promise<void> {
  const appDir = path.resolve(import.meta.dirname, "..");
  const devkit = path.join(appDir, ".hutch", "devkit");
  if (fs.existsSync(path.join(devkit, ".complete"))) {
    console.log("devkit-types: o devkit do Hutch já está aqui; nada a fazer");
    return;
  }
  const { url, sha256 } = coreUrl();
  console.log(`devkit-types: baixando ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`devkit-types: o download falhou (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const sum = createHash("sha256").update(bytes).digest("hex");
  if (sum !== sha256) throw new Error(`devkit-types: o sha256 ${sum} não bate com o do hutch-pin.json (${sha256})`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kiwinotes-devkit-"));
  try {
    fs.writeFileSync(path.join(tmp, "core.tar.gz"), bytes);
    const tar = spawnSync("tar", ["-xzf", "core.tar.gz", "api", "native-devkit.json"], { cwd: tmp, stdio: "inherit" });
    if (tar.status !== 0) throw new Error("devkit-types: não deu para abrir o core");
    const nd = JSON.parse(fs.readFileSync(path.join(tmp, "native-devkit.json"), "utf8")) as NativeDevkit;
    if (nd.product.version !== pin.electrobun) throw new Error(`devkit-types: o core é ${nd.product.version}, o pin pede ${pin.electrobun}`);
    const { tsconfig, packageJson } = devkitConfig(nd);
    fs.rmSync(devkit, { recursive: true, force: true });
    fs.mkdirSync(devkit, { recursive: true });
    fs.cpSync(path.join(tmp, "api"), path.join(devkit, "api"), { recursive: true });
    fs.writeFileSync(path.join(devkit, "tsconfig.json"), JSON.stringify(tsconfig));
    fs.writeFileSync(path.join(devkit, "package.json"), JSON.stringify(packageJson, null, 2));
    console.log(`devkit-types: ${Object.keys(nd.layout.sdks.javascript.exports).length} exports em ${path.relative(appDir, devkit)}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (import.meta.main) await main();
