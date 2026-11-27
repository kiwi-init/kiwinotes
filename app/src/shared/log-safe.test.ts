import { expect, test } from "bun:test";

import { errorKind, redactQuotedPaths } from "./log-safe.ts";

test("errorKind dá o tipo e o código, nunca a mensagem (#456)", () => {
  expect(errorKind(new Error("notes: Caixa de entrada/Comprar pão.md kept changing"))).toBe("Error");
  expect(errorKind(Object.assign(new Error("open '/x/Ana.md'"), { code: "ENOENT" }))).toBe("Error (ENOENT)");
  expect(errorKind(new TypeError("Ana"))).toBe("TypeError");
  expect(errorKind("Comprar pão")).toBe("string");
});

test("redactQuotedPaths troca só o caminho absoluto entre aspas", () => {
  expect(redactQuotedPaths(`ENOENT: no such file or directory, open '/tmp/Projeto X/Ana.md'`)).toBe(
    `ENOENT: no such file or directory, open '<caminho>'`,
  );
  expect(redactQuotedPaths(`rename '~/Notas/a.md' -> '~/Notas/b.md'`)).toBe(`rename '<caminho>' -> '<caminho>'`);
  expect(redactQuotedPaths(`path: "/a/b c.md", code: 'ENOENT'`)).toBe(`path: "<caminho>", code: 'ENOENT'`);
  expect(redactQuotedPaths("[ui:hub] showing UI 12 (built-in)")).toBe("[ui:hub] showing UI 12 (built-in)");
});
