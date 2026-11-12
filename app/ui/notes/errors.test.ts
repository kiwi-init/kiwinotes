import { describe, expect, test } from "bun:test";

import { errorCode } from "./errors.ts";

describe("errorCode (T7656)", () => {
  test("lê o .code do erro como o AppEngine manda, sem o código no texto", () => {
    expect(errorCode(Object.assign(new Error("notes.restore: A.md is taken again"), { code: "E_EXISTS" }))).toBe("E_EXISTS");
  });
  test("sem .code, acha no texto; sem nada, undefined", () => {
    expect(errorCode(new Error("E_NOT_FOUND: x"))).toBe("E_NOT_FOUND");
    expect(errorCode("E_CANCELED")).toBe("E_CANCELED");
    expect(errorCode(new Error("disco cheio"))).toBeUndefined();
    expect(errorCode(null)).toBeUndefined();
  });
});
