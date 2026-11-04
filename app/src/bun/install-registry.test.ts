// T2399: o registro de instalação do Electrobun que aponta para outro app sai do caminho. Tudo num tmp (um HOME falso):
// nada encosta no ~/Library do harry.

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { REGISTRY_NAME, repairInstallRegistry, runningBundle } from "./install-registry.ts";

const home = realpathSync(mkdtempSync(path.join(tmpdir(), "kn-registry-")));
afterAll(() => rmSync(home, { recursive: true, force: true }));

/** Um .app de mentira, com o `bun` em Contents/MacOS. */
function app(dir: string): { bundle: string; exec: string } {
  const bundle = path.join(home, dir, "Kiwi Notes.app");
  mkdirSync(path.join(bundle, "Contents", "MacOS"), { recursive: true });
  const exec = path.join(bundle, "Contents", "MacOS", "bun");
  writeFileSync(exec, "");
  return { bundle, exec };
}

let n = 0;
/** A pasta do canal (`…/app.kiwinotes.desktop/stable`), com um registro que aponta para `recorded`. */
function channel(recorded?: string): string {
  const root = path.join(home, `support-${n++}`, "app.kiwinotes.desktop", "stable");
  mkdirSync(root, { recursive: true });
  if (recorded !== undefined) {
    // O formato do extractor (MacosUninstallManifest); só o app_bundle_path importa aqui.
    writeFileSync(
      path.join(root, REGISTRY_NAME),
      JSON.stringify({ schema_version: 2, identifier: "app.kiwinotes.desktop", channel: "stable", app_bundle_path: recorded, app_path_token: "x" }),
    );
  }
  return root;
}

describe("o registro de instalação (T2399)", () => {
  const installed = app("Applications");
  const old = app("kiwinotes-wt/main-teste4/app/build/stable-macos-arm64");

  test("runningBundle: o .app pelo executável, como o Updater calcula (léxico); fora de um .app, null", () => {
    expect(runningBundle(installed.exec)).toBe(installed.bundle);
    expect(runningBundle("/Applications/Kiwi Notes.app/Contents/MacOS/bun")).toBe("/Applications/Kiwi Notes.app");
    expect(runningBundle("/opt/homebrew/bin/bun")).toBeNull();
  });

  test("o caso do harry: o registro do build de teste velho sai do caminho, renomeado, com o conteúdo intacto", () => {
    const root = channel(old.bundle);
    const before = readFileSync(path.join(root, REGISTRY_NAME), "utf8");
    const r = repairInstallRegistry({ channelRoot: root, bundle: installed.bundle, now: new Date("2026-11-04T03:30:00Z") });
    expect(r).toEqual({ state: "moved", recorded: old.bundle, movedTo: path.join(root, ".electrobun-uninstall.stale-2026-11-04T03-30-00-000Z.json") });
    expect(existsSync(path.join(root, REGISTRY_NAME))).toBe(false);
    // Nada é apagado: o arquivo velho fica ao lado, igual.
    expect(readFileSync((r as { movedTo: string }).movedTo, "utf8")).toBe(before);
  });

  test("um registro de um app que nem existe mais também sai", () => {
    const root = channel(path.join(home, "sumiu", "Kiwi Notes.app"));
    expect(repairInstallRegistry({ channelRoot: root, bundle: installed.bundle }).state).toBe("moved");
  });

  test("o registro deste app fica como está; o mesmo app por um link sai, porque o extractor compara o texto (#2414)", () => {
    const root = channel(installed.bundle);
    expect(repairInstallRegistry({ channelRoot: root, bundle: installed.bundle })).toEqual({ state: "ok" });
    expect(existsSync(path.join(root, REGISTRY_NAME))).toBe(true);

    const link = path.join(home, "atalho.app");
    symlinkSync(installed.bundle, link);
    const viaLink = channel(link);
    expect(repairInstallRegistry({ channelRoot: viaLink, bundle: installed.bundle }).state).toBe("moved");
  });

  test("sem registro, sem .app ou com registro ilegível: nada é mexido", () => {
    expect(repairInstallRegistry({ channelRoot: channel(), bundle: installed.bundle })).toEqual({ state: "missing" });
    const root = channel(old.bundle);
    expect(repairInstallRegistry({ channelRoot: root, bundle: null }).state).toBe("skipped");
    expect(existsSync(path.join(root, REGISTRY_NAME))).toBe(true);

    const broken = channel();
    writeFileSync(path.join(broken, REGISTRY_NAME), "{não é json");
    expect(repairInstallRegistry({ channelRoot: broken, bundle: installed.bundle }).state).toBe("skipped");
    expect(readdirSync(broken)).toEqual([REGISTRY_NAME]);
  });
});
