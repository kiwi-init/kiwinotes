import { expect, test } from "bun:test";

import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { highlightTree } from "@lezer/highlight";

import { CODE_TYPES } from "../../../src/shared/file-view.ts";
import { CODE_LANGUAGES, CODE_WITHOUT_COLOR, codeHighlight, codeLanguageFor, isCodeFile } from "./code-languages.ts";

test("toda extensão de código tem a linguagem dela (menos o .php), e o json e o yaml também; o .txt e o .log seguem sem cor", () => {
  for (const ext of CODE_TYPES) if (!CODE_WITHOUT_COLOR.has(ext)) expect(CODE_LANGUAGES[ext]).toBeFunction();
  expect(Object.keys(CODE_LANGUAGES).sort()).toEqual([...CODE_TYPES.filter((e) => !CODE_WITHOUT_COLOR.has(e)), "json", "yaml", "yml"].sort());
  for (const ext of CODE_WITHOUT_COLOR) expect(CODE_TYPES).toContain(ext);
  // Os do spec que entraram na 2ª rodada: o .tex com o stex, o .cfg e o .env com o properties.
  expect(codeLanguageFor("artigo.tex")).toBe(CODE_LANGUAGES.tex!);
  expect(codeLanguageFor("app.cfg")).toBe(CODE_LANGUAGES.ini!);
  expect(codeLanguageFor("pasta/.env")).toBe(CODE_LANGUAGES.ini!);
  expect(codeLanguageFor("Projeto X/script.PY")).toBe(CODE_LANGUAGES.py!);
  expect(codeLanguageFor("lista.txt")).toBeUndefined();
  expect(codeLanguageFor("saida.log")).toBeUndefined();
  expect(codeLanguageFor("sem-extensao")).toBeUndefined();
});

test("toda linguagem carrega (o import de cada uma existe)", async () => {
  for (const [ext, load] of Object.entries(CODE_LANGUAGES)) {
    const ext_ = await load().catch((e) => new Error(`${ext}: ${e}`));
    expect(ext_).not.toBeInstanceOf(Error);
  }
});

/** As cores que o realce dá a cada trecho do texto, na ordem. */
async function colors(ext: string, doc: string): Promise<{ text: string; color: string }[]> {
  const state = EditorState.create({ doc, extensions: [await CODE_LANGUAGES[ext]!()] });
  const tree = ensureSyntaxTree(state, doc.length, 5000)!;
  const out: { text: string; color: string }[] = [];
  highlightTree(tree, codeHighlight, (from, to, cls) => out.push({ text: doc.slice(from, to), color: cls }));
  // A classe gerada não diz a cor: a regra do estilo diz.
  const rules = codeHighlight.module?.getRules() ?? "";
  return out.map(({ text, color }) => ({ text, color: new RegExp(`\\.${color.split(" ")[0]} \\{ ?color: ?([^;}]+)`).exec(rules)?.[1]?.trim() ?? color }));
}

test("o realce pinta com as cores do tema: palavra-chave, texto, número e comentário", async () => {
  const py = await colors("py", 'def soma(a):\n    # exemplo\n    return a + 1 if a else "zero"\n');
  const color = (text: string) => py.find((x) => x.text === text)?.color;
  expect(color("def")).toContain("--c-violet");
  expect(color("return")).toContain("--c-violet");
  expect(color("1")).toContain("--c-orange");
  expect(color('"zero"')).toContain("--c-green");
  expect(color("# exemplo")).toContain("--ink-3");
  const ts = await colors("ts", 'const total: number = 2; // conta\nfunction ver() { return "ok"; }\n');
  const tcolor = (text: string) => ts.find((x) => x.text === text)?.color;
  expect(tcolor("const")).toContain("--c-violet");
  expect(tcolor("number")).toContain("--c-teal");
  expect(tcolor('"ok"')).toContain("--c-green");
  expect(tcolor("// conta")).toContain("--ink-3");
});

test("é código (números de linha, menu sem Markdown): o que tem cor e o .php; o .txt, o .log e o .md não", () => {
  for (const name of ["a.py", "b.TS", "c.css", "d.json", "e.yaml", "f.php", "g.tex", ".env"]) expect(isCodeFile(name)).toBe(true);
  for (const name of ["lista.txt", "saida.log", "nota.md", "sem-extensao"]) expect(isCodeFile(name)).toBe(false);
});

test("pelo nome (T19313): o Dockerfile com o modo dele, e o Makefile com o do shell (o legacy-modes não tem o do make)", async () => {
  for (const name of ["Dockerfile", "Projeto X/dockerfile", "Containerfile", "Dockerfile.dev", "app.dockerfile"]) expect(codeLanguageFor(name)).toBe(CODE_LANGUAGES.dockerfile!);
  for (const name of ["Makefile", "site/GNUmakefile", "regras.mk"]) expect(codeLanguageFor(name)).toBe(CODE_LANGUAGES.sh!);
  // Uma extensão conhecida ganha do nome, e um nome parecido não conta.
  expect(codeLanguageFor("dockerfile.json")).toBe(CODE_LANGUAGES.json!);
  for (const name of ["Makefile.md", "meu-dockerfile", "LEIAME"]) expect(codeLanguageFor(name)).toBeUndefined();
  for (const name of ["Dockerfile", "Makefile"]) expect(isCodeFile(name)).toBe(true);
  const docker = await colors("dockerfile", "# a imagem (exemplo)\nFROM exemplo:1\nRUN echo \"oi\"\n");
  expect(docker.find((x) => x.text === "FROM")?.color).toContain("--c-violet");
  expect(docker.find((x) => x.text.startsWith("# a imagem"))?.color).toContain("--ink-3");
  const make = await colors("mk", "# o build (exemplo)\nCC = cc\ntudo:\n\techo \"pronto\"\n");
  expect(make.find((x) => x.text.startsWith("# o build"))?.color).toContain("--ink-3");
  expect(make.find((x) => x.text === '"pronto"')?.color).toContain("--c-green");
});
