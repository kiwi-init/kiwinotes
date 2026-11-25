// T29006: o que o hook do build faz num .app, e o que o `verify-signature.ts` barra. Um .app de mentira: nada abre.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { tempDir } from "../test/tmp.ts";
import { applyAppPlist } from "./app-plist.ts";
import { pack, signAdHoc, verifyBundle } from "./signing.ts";
import { assertUsageStrings, usageStringsProblems } from "./usage-strings.ts";

let dir: string;
beforeEach(() => {
  dir = tempDir("kiwinotes-app-plist-");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Um "Exemplo.app" como o Electrobun o deixa antes do hook: sem as frases e sem os `.lproj`. */
function fakeApp(): string {
  const app = path.join(dir, "Exemplo.app");
  mkdirSync(path.join(app, "Contents", "MacOS"), { recursive: true });
  mkdirSync(path.join(app, "Contents", "Resources"), { recursive: true });
  writeFileSync(path.join(app, "Contents", "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>exemplo</string>
<key>CFBundleIdentifier</key><string>app.kiwinotes.test</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1.2.3</string>
</dict></plist>
`);
  copyFileSync("/usr/bin/true", path.join(app, "Contents", "MacOS", "exemplo"));
  return app;
}

test("antes do hook, o verify-signature barra: nada das frases", () => {
  const problems = usageStringsProblems(fakeApp());
  expect(problems).toContain("Info.plist: CFBundleDevelopmentRegion is not pt");
  expect(problems).toContain("Contents/Resources/en.lproj/InfoPlist.strings: missing or unreadable");
  expect(problems).toContain("Contents/Resources/pt.lproj/InfoPlist.strings: missing or unreadable");
});

test("o hook põe no .app as frases de cada língua e a língua de reserva, e o verify-signature aceita", () => {
  const app = fakeApp();
  const files = applyAppPlist(path.join(app, "Contents", "Info.plist"));
  expect(files.map((f) => path.relative(app, f))).toEqual([
    "Contents/Resources/pt.lproj/InfoPlist.strings",
    "Contents/Resources/en.lproj/InfoPlist.strings",
  ]);
  expect(usageStringsProblems(app)).toEqual([]);
  expect(() => assertUsageStrings(app)).not.toThrow();
});

test("um .app sem o en.lproj, ou com uma frase faltando, não passa", () => {
  const app = fakeApp();
  applyAppPlist(path.join(app, "Contents", "Info.plist"));
  writeFileSync(path.join(app, "Contents", "Resources", "pt.lproj", "InfoPlist.strings"), '"NSMicrophoneUsageDescription" = "Exemplo";\n');
  rmSync(path.join(app, "Contents", "Resources", "en.lproj"), { recursive: true });
  expect(usageStringsProblems(app)).toEqual([
    "Contents/Resources/pt.lproj/InfoPlist.strings: no NSAudioCaptureUsageDescription",
    "Contents/Resources/en.lproj/InfoPlist.strings: missing or unreadable",
  ]);
  expect(() => assertUsageStrings(app)).toThrow("Exemplo.app: ");
});

test("o app de dentro do .tar.zst passa pela mesma conferência", () => {
  const app = fakeApp();
  applyAppPlist(path.join(app, "Contents", "Info.plist"));
  signAdHoc(app);
  const good = path.join(dir, "bom.tar.zst");
  pack(dir, ["Exemplo.app"], good);
  expect(verifyBundle(good, assertUsageStrings)).toEqual(["Exemplo.app"]);

  rmSync(path.join(app, "Contents", "Resources", "en.lproj"), { recursive: true });
  signAdHoc(app);
  const bad = path.join(dir, "sem-en.tar.zst");
  pack(dir, ["Exemplo.app"], bad);
  expect(verifyBundle(bad)).toEqual(["Exemplo.app"]);
  expect(() => verifyBundle(bad, assertUsageStrings)).toThrow("en.lproj/InfoPlist.strings: missing");
});
