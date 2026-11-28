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

// #464: um nome com aspa seguida de vírgula (`x', y.md`) deixava o fim (`, y.md'`) no kiwi.log. O caminho vai até a
// última aspa que fecha, sem passar do ` -> ` do rename.
test("redactQuotedPaths esconde o nome inteiro, também com aspa e vírgula dentro (#464)", () => {
  expect(redactQuotedPaths(`ENOENT: no such file or directory, open '/tmp/Projeto X/x', y.md'`)).toBe(
    `ENOENT: no such file or directory, open '<caminho>'`,
  );
  expect(redactQuotedPaths(`path: '/a/Ana', b; c).md', errno: -2`)).toBe(`path: '<caminho>', errno: -2`);
  expect(redactQuotedPaths(`rename '~/Notas/a', b.md' -> '~/Notas/c', d.md'`)).toBe(`rename '<caminho>' -> '<caminho>'`);
  expect(redactQuotedPaths(`open "/x/um", dois.md"\nopen '/y/três.md'`)).toBe(`open "<caminho>"\nopen '<caminho>'`);
  // Nada do nome fica no log.
  for (const s of [`open '/tmp/x', y.md'`, `copyfile '~/a', b.md' -> '~/c', d.md'`]) {
    expect(redactQuotedPaths(s)).not.toMatch(/y\.md|b\.md|d\.md/);
  }
});
