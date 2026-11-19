// O que o CI roda em cada PR (spec #21331).
import { describe, expect, test } from "bun:test";

import { type Plan, plan, textOnly } from "./ci-changes.ts";

describe("ci-changes", () => {
  test("o PR comum: bun test no Mac, swift test pulado com o motivo", () => {
    expect(plan("pull_request", ["app/ui/notes/files/grid.ts", "README.md"])).toEqual({
      bun: "run",
      bunReason: "",
      swift: "skip",
      swiftReason: "o PR não mexe em native/ nem no .github/workflows/ci.yml",
    });
  });

  test("mexer em native/ ou no workflow roda o swift test", () => {
    expect(plan("pull_request", ["native/Sources/Exemplo.swift"])).toMatchObject({ bun: "run", swift: "run" });
    expect(plan("pull_request", ["docs/notas.md", ".github/workflows/ci.yml"])).toMatchObject({ bun: "run", swift: "run" });
  });

  test("só *.md fora de app/ e native/: os dois pulados, com o motivo", () => {
    const p = plan("pull_request", ["README.md", "docs/specs/exemplo.md", "AGENTS.md"]);
    expect(p).toMatchObject({ bun: "skip", swift: "skip" });
    expect(p.bunReason).toMatch(/só mexe em texto/);
    expect(p.swiftReason).toBe(p.bunReason);
  });

  test("docs/design, um .md dentro do app/ ou um arquivo sem extensão de texto rodam o bun test", () => {
    expect(textOnly(["docs/design/kiwi-cat/exemplo.svg"])).toBe(false);
    expect(textOnly(["docs/notas.md", "docs/design/cores.json"])).toBe(false);
    expect(textOnly(["app/README.md"])).toBe(false);
    expect(textOnly(["native/README.md"])).toBe(false);
    expect(plan("pull_request", ["docs/design/icone.png"])).toMatchObject({ bun: "run", swift: "skip" });
  });

  test("o push na main roda tudo, e a lista vazia também", () => {
    const all: Plan = { bun: "run", bunReason: "", swift: "run", swiftReason: "" };
    expect(plan("push", ["README.md"])).toEqual(all);
    expect(plan("pull_request", [])).toEqual(all);
  });

  test("README.MD em maiúsculas também é texto", () => {
    expect(textOnly(["NOTAS.MD"])).toBe(true);
  });
});
