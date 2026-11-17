// T6602: o que vai ao lado do helper no .app (scripts/helper-libs.ts).

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import path from "node:path";

import { rpathFrameworks } from "./helper-libs.ts";
import { machoLoadsOf } from "./macho.ts";

describe("rpathFrameworks", () => {
  test("o framework do transcribe.cpp vira uma dylib simples ao lado do helper", () => {
    expect(
      rpathFrameworks([
        "/System/Library/Frameworks/Metal.framework/Versions/A/Metal",
        "/usr/lib/libc++.1.dylib",
        "@rpath/CTranscribe.framework/Versions/Current/CTranscribe",
      ]),
    ).toEqual([
      {
        load: "@rpath/CTranscribe.framework/Versions/Current/CTranscribe",
        binary: "CTranscribe.framework/Versions/Current/CTranscribe",
        dylib: "libCTranscribe.dylib",
      },
    ]);
  });

  test("um framework sem Versions também serve, e sem @rpath não há nada a fazer", () => {
    expect(rpathFrameworks(["@rpath/Foo.framework/Foo"])).toEqual([{ load: "@rpath/Foo.framework/Foo", binary: "Foo.framework/Foo", dylib: "libFoo.dylib" }]);
    expect(rpathFrameworks(["/usr/lib/libSystem.B.dylib"])).toEqual([]);
  });

  test("um @rpath que não é framework quebra o build, com o nome dele", () => {
    expect(() => rpathFrameworks(["@rpath/libonnxruntime.dylib"])).toThrow("@rpath/libonnxruntime.dylib");
    expect(() => rpathFrameworks(["@rpath/Foo.framework/Versions/A/Bar"])).toThrow("isn't a framework");
  });
});

// Com o helper compilado (o swift build do preBuild ou do `swift test`), os @rpath dele são só frameworks.
const built = path.resolve(import.meta.dir, "..", "..", "native", ".build", "release", "kiwi-helper");
test.skipIf(!existsSync(built))("o helper compilado só pede por @rpath o que o build sabe levar", () => {
  expect(rpathFrameworks(machoLoadsOf(built).dylibs).map((f) => f.dylib)).toEqual(["libCTranscribe.dylib"]);
});
