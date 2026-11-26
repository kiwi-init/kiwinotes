import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { tempDir } from "../test/tmp.ts";
import { HELPER_PLIST, helperUsageDescriptions, stringsFile, USAGE_KEYS, usageDescriptions, writeUsageStrings } from "./usage-strings.ts";

const plistJson = (file: string): Record<string, string> => {
  const r = spawnSync("plutil", ["-convert", "json", "-o", "-", file], { encoding: "utf8" });
  expect(r.status).toBe(0);
  return JSON.parse(r.stdout);
};

test("T29006: cada língua ganha o InfoPlist.strings, válido para o plutil, com as frases dela", () => {
  const app = path.join(tempDir("kiwi-usage-"), "Exemplo.app");
  const files = writeUsageStrings(app);
  expect(files.map((f) => path.relative(app, f))).toEqual(["Contents/Resources/pt.lproj/InfoPlist.strings", "Contents/Resources/en.lproj/InfoPlist.strings"]);
  for (const f of files) expect(spawnSync("plutil", ["-lint", f]).status).toBe(0);
  const en = plistJson(files[1]!);
  expect(Object.keys(en).sort()).toEqual(Object.keys(USAGE_KEYS).sort());
  expect(en.NSMicrophoneUsageDescription).toStartWith("Kiwi Notes uses the microphone");
  expect(plistJson(files[0]!).NSMicrophoneUsageDescription).toStartWith("O Kiwi Notes usa o microfone");
});

test("as duas línguas dizem coisas diferentes, e nenhuma fica vazia", () => {
  const pt = usageDescriptions("pt");
  const en = usageDescriptions("en");
  for (const k of Object.keys(USAGE_KEYS) as (keyof typeof USAGE_KEYS)[]) {
    expect(pt[k].length).toBeGreaterThan(20);
    expect(en[k]).not.toBe(pt[k]);
  }
});

test("T31094: o Info.plist embutido no helper tem as frases do catálogo nas duas línguas", () => {
  // Mudou uma frase no catálogo? Copie o `helperUsageDescriptions()` para o native/Sources/kiwi-helper/Info.plist
  // (`plutil -replace <chave> -string "<frase>" <plist>`).
  const helper = plistJson(HELPER_PLIST);
  const want = helperUsageDescriptions();
  for (const k of Object.keys(USAGE_KEYS) as (keyof typeof USAGE_KEYS)[]) {
    expect(helper[k]).toBe(want[k]);
    expect(helper[k]).toContain(usageDescriptions("pt")[k]);
    expect(helper[k]).toContain(usageDescriptions("en")[k]);
  }
  expect(helper.CFBundleIdentifier).toBe("com.kiwinotes.helper");
});

test("aspas, barra e quebra de linha saem escapadas", () => {
  const file = path.join(tempDir("kiwi-usage-"), "x.strings");
  writeFileSync(file, stringsFile({ Chave: 'Diz "oi"\\ e\nmais' }));
  expect(readFileSync(file, "utf8")).toBe('"Chave" = "Diz \\"oi\\"\\\\ e\\nmais";\n');
  expect(plistJson(file).Chave).toBe('Diz "oi"\\ e\nmais');
});
