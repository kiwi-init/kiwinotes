// T762: o app que vai no .tar.zst sai com o selo quebrado quando um recurso muda depois da assinatura (o Electrobun
// escreve o version.json depois do postBuild). Um .app de mentira, sem rodar nada: só codesign, tar e zstd.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { pack, resealBundles, signAdHoc, unpack, verifyApp, verifyBundle } from "./signing.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "kiwinotes-signing-test-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Um "Fake.app" assinado ad hoc, com um version.json em Resources, como o do Electrobun. */
function fakeApp(root: string): string {
  const app = path.join(root, "Fake.app");
  mkdirSync(path.join(app, "Contents", "MacOS"), { recursive: true });
  mkdirSync(path.join(app, "Contents", "Resources"), { recursive: true });
  writeFileSync(path.join(app, "Contents", "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>fake</string>
<key>CFBundleIdentifier</key><string>app.kiwinotes.test</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
`);
  copyFileSync("/usr/bin/true", path.join(app, "Contents", "MacOS", "fake"));
  writeFileSync(path.join(app, "Contents", "Resources", "version.json"), `{"hash":""}`);
  signAdHoc(app);
  return app;
}

/** O que o Electrobun faz depois do postBuild: muda o version.json e compacta o app. */
function brokenBundle(): string {
  const stage = path.join(dir, "stage");
  mkdirSync(stage);
  const app = fakeApp(stage);
  writeFileSync(path.join(app, "Contents", "Resources", "version.json"), `{"hash":"3qa20nnl17ix6"}`);
  const tar = path.join(dir, "Fake.app.tar.zst");
  pack(stage, ["Fake.app"], tar);
  return tar;
}

describe("signing (T762)", () => {
  test("verifyBundle catches a resource changed after the signature", () => {
    expect(() => verifyBundle(brokenBundle())).toThrow(/version\.json/);
  });

  test("resealBundles re-signs the app inside and keeps the copies equal", () => {
    const tar = brokenBundle();
    const copy = path.join(dir, "copy.tar.zst");
    copyFileSync(tar, copy);

    expect(resealBundles([tar, copy]).sort()).toEqual([copy, tar].sort());
    expect(verifyBundle(tar)).toEqual(["Fake.app"]);
    expect(readFileSync(copy).equals(readFileSync(tar))).toBe(true);

    // The change Electrobun made is kept; only the seal is new.
    const out = path.join(dir, "out");
    mkdirSync(out);
    unpack(tar, out);
    expect(readFileSync(path.join(out, "Fake.app", "Contents", "Resources", "version.json"), "utf8")).toBe(`{"hash":"3qa20nnl17ix6"}`);
    verifyApp(path.join(out, "Fake.app"));
  });

  test("resealBundles leaves a bundle that already verifies alone", () => {
    const stage = path.join(dir, "stage");
    mkdirSync(stage);
    fakeApp(stage);
    const tar = path.join(dir, "Fake.app.tar.zst");
    pack(stage, ["Fake.app"], tar);
    const before = readFileSync(tar);

    expect(resealBundles([tar])).toEqual([]);
    expect(readFileSync(tar).equals(before)).toBe(true);
  });

  test("pack writes a plain ustar with no macOS metadata", () => {
    const tar = brokenBundle();
    const raw = Bun.zstdDecompressSync(readFileSync(tar));
    expect(new TextDecoder().decode(raw.subarray(257, 262))).toBe("ustar");
    const listed = Bun.spawnSync(["tar", "-tf", "-"], { stdin: raw }).stdout.toString().split("\n").filter(Boolean);
    expect(listed.some((n) => path.basename(n).startsWith("._"))).toBe(false);
    expect(listed).toContain("Fake.app/Contents/Resources/version.json");
  });
});
