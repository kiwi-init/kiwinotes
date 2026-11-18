import { expect, test } from "bun:test";

import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { highlightTree } from "@lezer/highlight";

import { CODE_TYPES } from "../../../src/shared/file-view.ts";
import { CODE_LANGUAGES, codeHighlight, codeLanguageFor } from "./code-languages.ts";

test("toda extensão de código tem a linguagem dela, e o json e o yaml também; o .txt e o .log seguem sem cor", () => {
  for (const ext of CODE_TYPES) expect(CODE_LANGUAGES[ext]).toBeFunction();
  expect(Object.keys(CODE_LANGUAGES).sort()).toEqual([...CODE_TYPES, "json", "yaml", "yml"].sort());
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
