import { describe, expect, test } from "bun:test";

import { releaseNotes } from "./release-notes.ts";

describe("as notas do release no formato do Channels (spec #13879)", () => {
  const repo = "kiwi-init/kiwinotes";

  test("um PR por linha, título em negrito e link, do mais novo para o mais velho, e o rodapé", () => {
    const body = releaseNotes({
      repo,
      tag: "v2026.11.1",
      previous: "v0.1.0-rc19",
      // A API de compare dá do mais velho para o mais novo.
      subjects: [
        "O repo repaginado, no estilo do Channels (T13933, spec #13895) (#548)",
        "A largura da nota pelas duas bordas, no .md e no .txt (T13855, spec #13383) (#546)",
        "",
      ],
    });
    expect(body.split("\n").slice(0, 4)).toEqual([
      "## O que entrou",
      "",
      "- **A largura da nota pelas duas bordas, no .md e no .txt (T13855, spec #13383)** ([#546](https://github.com/kiwi-init/kiwinotes/pull/546))",
      "- **O repo repaginado, no estilo do Channels (T13933, spec #13895)** ([#548](https://github.com/kiwi-init/kiwinotes/pull/548))",
    ]);
    expect(body).toContain("o Kiwi Notes 2026.11.1 para Mac com Apple Silicon");
    expect(body).toContain('spctl -a -vv "/Applications/Kiwi Notes.app"');
    expect(body).toContain("[v0.1.0-rc19...v2026.11.1](https://github.com/kiwi-init/kiwinotes/compare/v0.1.0-rc19...v2026.11.1)");
  });

  test("é o mesmo formato das linhas do CHANGELOG", async () => {
    const changelog = await Bun.file(new URL("../../CHANGELOG.md", import.meta.url)).text();
    const line = changelog.split("\n").find((l) => l.startsWith("- **") && l.includes("([#"))!;
    const m = /^- \*\*(.+)\*\* \(\[#(\d+)\]\(https:\/\/github\.com\/kiwi-init\/kiwinotes\/pull\/\d+\)\)$/.exec(line)!;
    expect(m).not.toBeNull();
    const body = releaseNotes({ repo, tag: "v2026.11.1", previous: "v0.1.0-rc19", subjects: [`${m[1]} (#${m[2]})`] });
    expect(body.split("\n")[2]).toBe(line);
  });

  test("um commit sem PR entra só com o título; nenhum commit diz isso", () => {
    expect(releaseNotes({ repo, tag: "v2026.11.2", previous: "v2026.11.1", subjects: ["Um ajuste direto"] })).toContain("- **Um ajuste direto**\n");
    expect(releaseNotes({ repo, tag: "v2026.11.2", previous: "v2026.11.1", subjects: [] })).toContain("- Nenhum PR desde o release anterior.");
    expect(() => releaseNotes({ repo: "x/../y/z", tag: "v2026.11.1", previous: "v0.1.0-rc19", subjects: [] })).toThrow("isn't owner/repo");
  });

  test("pela linha de comando, com os assuntos no stdin", async () => {
    const p = Bun.spawn([process.execPath, new URL("./release-notes.ts", import.meta.url).pathname, repo, "v2026.11.1", "v0.1.0-rc19"], {
      stdin: new Blob(["Primeiro (#1)\nSegundo (#2)\n"]),
      stdout: "pipe",
    });
    const out = await new Response(p.stdout).text();
    expect(await p.exited).toBe(0);
    expect(out.split("\n")[2]).toBe("- **Segundo** ([#2](https://github.com/kiwi-init/kiwinotes/pull/2))");
  });
});
