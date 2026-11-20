// O que o CI roda em cada PR (spec #21331).
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { changedFiles, type Plan, plan, textOnly } from "./ci-changes.ts";

describe("ci-changes", () => {
  test("o PR comum: bun test no Mac, swift test pulado com o motivo", () => {
    expect(plan("pull_request", ["app/ui/notes/files/grid.ts", "README.md"])).toEqual({
      bun: "run",
      bunReason: "",
      swift: "skip",
      swiftReason: "o PR não mexe em native/ nem no .github/workflows/ci.yml",
      cpuIndex: "skip",
      cpuIndexReason: "o PR não mexe em app/src/notes/ nem em app/src/shared/, no app/scripts/cpu-scenarios.ts nem no .github/workflows/ci.yml",
    });
  });

  test("os roteiros de índice da CPU: só com o índice, o roteiro ou o workflow no PR, e sempre na main (lead #24565)", () => {
    for (const f of ["app/src/notes/semantic/exemplo.ts", "app/src/shared/exemplo.ts", "app/scripts/cpu-scenarios.ts", ".github/workflows/ci.yml"]) {
      expect(plan("pull_request", ["app/ui/hub/main.tsx", f])).toMatchObject({ bun: "run", cpuIndex: "run", cpuIndexReason: "" });
    }
    expect(plan("pull_request", ["native/Sources/Exemplo.swift"])).toMatchObject({ swift: "run", cpuIndex: "skip" });
    expect(plan("pull_request", ["app/src/notesx/exemplo.ts"])).toMatchObject({ cpuIndex: "skip" });
    expect(plan("pull_request", ["README.md"])).toMatchObject({ bun: "skip", cpuIndex: "skip" });
    expect(plan("push", ["app/ui/hub/main.tsx"])).toMatchObject({ cpuIndex: "run" });
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
    const all: Plan = { bun: "run", bunReason: "", swift: "run", swiftReason: "", cpuIndex: "run", cpuIndexReason: "" };
    expect(plan("push", ["README.md"])).toEqual(all);
    expect(plan("pull_request", [])).toEqual(all);
  });

  test("README.MD em maiúsculas também é texto", () => {
    expect(textOnly(["NOTAS.MD"])).toBe(true);
  });

  const dirs: string[] = [];
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
  const git = (cwd: string, ...args: string[]) => {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  };
  const repo = () => {
    const d = mkdtempSync(join(tmpdir(), "ci-changes-"));
    dirs.push(d);
    git(d, "init", "-q", "-b", "main");
    git(d, "config", "user.email", "ana@exemplo.com");
    git(d, "config", "user.name", "Ana");
    mkdirSync(join(d, "native", "Sources"), { recursive: true });
    mkdirSync(join(d, "docs"));
    writeFileSync(join(d, "native", "Sources", "Exemplo.swift"), "// um arquivo de exemplo\nlet a = 1\nlet b = 2\nlet c = 3\n");
    writeFileSync(join(d, "README.md"), "# Exemplo\n");
    git(d, "add", "-A");
    git(d, "commit", "-q", "-m", "base");
    return d;
  };

  test("um git mv de native/ para um .md traz os dois caminhos e roda tudo (rodada 1)", () => {
    const d = repo();
    const base = git(d, "rev-parse", "HEAD");
    git(d, "mv", "native/Sources/Exemplo.swift", "docs/exemplo.md");
    git(d, "commit", "-q", "-m", "move");
    const files = changedFiles(d, `${base}..HEAD`);
    expect(files).toEqual(["docs/exemplo.md", "native/Sources/Exemplo.swift"]);
    expect(plan("pull_request", files)).toMatchObject({ bun: "run", swift: "run" });
  });

  test("o que um commit de merge trouxe também entra na lista", () => {
    const d = repo();
    git(d, "checkout", "-q", "-b", "pr");
    writeFileSync(join(d, "docs", "notas.md"), "notas\n");
    git(d, "add", "-A");
    git(d, "commit", "-q", "-m", "texto");
    git(d, "checkout", "-q", "main");
    writeFileSync(join(d, "native", "Sources", "Outro.swift"), "let d = 4\n");
    git(d, "add", "-A");
    git(d, "commit", "-q", "-m", "na main");
    git(d, "checkout", "-q", "pr");
    // Um merge que resolve trazendo o arquivo da main, alterado: o git log sem -m não lista o merge.
    git(d, "merge", "-q", "--no-ff", "--no-commit", "main");
    writeFileSync(join(d, "native", "Sources", "Outro.swift"), "let d = 5\n");
    git(d, "add", "-A");
    git(d, "commit", "-q", "-m", "merge");
    // No CI, a base é a ponta da main: o commit dela fica fora do range, e só o diff vê o que o merge mudou.
    const range = `${git(d, "rev-parse", "main")}..HEAD`;
    expect(git(d, "log", "--no-renames", "--name-only", "--format=", range).split("\n")).toEqual(["docs/notas.md"]);
    expect(changedFiles(d, range)).toEqual(["docs/notas.md", "native/Sources/Outro.swift"]);
    expect(plan("pull_request", changedFiles(d, range))).toMatchObject({ bun: "run", swift: "run" });
  });
});
