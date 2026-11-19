// O devkit do typecheck no Linux (spec #21331) tem de ser o mesmo que o Hutch monta no Mac: senão o Linux daria verde
// onde o Mac daria vermelho. No macOS (o `bun test` do CI roda depois do `electrobun prepare`), compara com o do Hutch.
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import pin from "../hutch-pin.json" with { type: "json" };
import { coreUrl, devkitConfig, type NativeDevkit } from "./devkit-types.ts";

const appDir = path.resolve(import.meta.dirname, "..");
const devkit = path.join(appDir, ".hutch", "devkit");
const release = path.join(process.env.HUTCH_HOME ?? path.join(os.homedir(), ".hutch"), "releases", "electrobun", pin.electrobun, "macos-arm64");
const withHutch = process.platform === "darwin" && fs.existsSync(path.join(devkit, ".complete")) && fs.existsSync(path.join(release, "native-devkit.json"));
const json = (file: string) => JSON.parse(fs.readFileSync(file, "utf8")) as unknown;

describe("devkit-types", () => {
  test("um paths por export, com o nome do produto, e o package.json com os mesmos", () => {
    const nd: NativeDevkit = {
      product: { name: "exemplo", version: "1.2.3" },
      layout: { sdks: { javascript: { main: "api/index.ts", exports: { ".": "api/index.ts", "./main/tray": "api/tray.ts" } } } },
    };
    expect(devkitConfig(nd)).toEqual({
      tsconfig: { compilerOptions: { baseUrl: ".", paths: { exemplo: ["./api/index.ts"], "exemplo/main/tray": ["./api/tray.ts"] } } },
      packageJson: {
        name: "exemplo",
        version: "1.2.3",
        private: true,
        type: "module",
        types: "./api/index.ts",
        exports: { ".": "./api/index.ts", "./main/tray": "./api/tray.ts" },
      },
    });
  });

  test("o core fixado é o do Electrobun do pin", () => {
    expect(coreUrl().url).toBe(`${pin.releasesBaseUrl}/v${pin.electrobun}/electrobun-core-darwin-arm64.tar.gz`);
    expect(coreUrl().sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test.skipIf(!withHutch)("igual ao devkit do Hutch: o mesmo core (sha256) e o mesmo tsconfig e package.json", () => {
    const lock = json(path.join(appDir, ".hutch", "dependencies.lock")) as { objects: { type: string; version?: string; coreSha256?: string }[] };
    const eb = lock.objects.find((o) => o.type === "electrobun");
    expect(eb?.version).toBe(pin.electrobun);
    expect(eb?.coreSha256).toBe(pin.devkitCore.sha256);
    const { tsconfig, packageJson } = devkitConfig(json(path.join(release, "native-devkit.json")) as NativeDevkit);
    expect(tsconfig).toEqual(json(path.join(devkit, "tsconfig.json")));
    expect(packageJson).toEqual(json(path.join(devkit, "package.json")));
  });
});
