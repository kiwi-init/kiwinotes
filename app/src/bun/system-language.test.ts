import { describe, expect, test } from "bun:test";

import { envSystemLanguages, parseAppleLanguages } from "./system-language.ts";

describe("a língua do macOS (T28190)", () => {
  test("lê o array do `defaults read -g AppleLanguages`", () => {
    expect(parseAppleLanguages('(\n    "en-US",\n    "pt-BR"\n)\n')).toEqual(["en-US", "pt-BR"]);
    expect(parseAppleLanguages("(\n    en,\n    \"zh-Hans-BR\"\n)\n")).toEqual(["en", "zh-Hans-BR"]);
    expect(parseAppleLanguages("")).toEqual([]);
  });

  test("KIWI_SYSTEM_LANG passa por cima, numa lista", () => {
    expect(envSystemLanguages({ KIWI_SYSTEM_LANG: "en-GB, pt-BR" })).toEqual(["en-GB", "pt-BR"]);
    expect(envSystemLanguages({ KIWI_SYSTEM_LANG: " " })).toBeNull();
    expect(envSystemLanguages({})).toBeNull();
  });
});
