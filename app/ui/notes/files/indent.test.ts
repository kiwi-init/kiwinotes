import { expect, test } from "bun:test";

import { indentMore } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { EditorState } from "@codemirror/state";

import { detectIndent } from "./indent.ts";

const py4 = 'class Item:\n    nome: str\n\n    def total(self):\n        return 0\n';
const js2 = "function soma(a) {\n  if (a) {\n    return a + 1;\n  }\n  return 0;\n}\n";
const tabbed = "func main() {\n\tif ok {\n\t\tfmt.Println(\"oi\")\n\t}\n}\n";

test("o recuo do arquivo: 4 espaços num .py, 2 num .js, tab num .go", () => {
  expect(detectIndent(py4, "Projeto X/feira.py")).toEqual({ unit: "    ", tabSize: 4 });
  expect(detectIndent(js2, "site/app.js")).toEqual({ unit: "  ", tabSize: 2 });
  expect(detectIndent(tabbed, "main.go")).toEqual({ unit: "\t", tabSize: 4 });
});

test("o passo vem do arquivo, não da extensão: um .py de 2 fica com 2, e um .js de 4 com 4", () => {
  expect(detectIndent("def f():\n  return 1\n", "a.py").unit).toBe("  ");
  expect(detectIndent("if (a) {\n    b();\n}\n", "a.js").unit).toBe("    ");
});

test("sem nada recuado: 4 no .py e 2 no resto", () => {
  expect(detectIndent("x = 1\n", "a.py").unit).toBe("    ");
  expect(detectIndent("", "a.ts").unit).toBe("  ");
  expect(detectIndent("uma linha\n", "notas.txt").unit).toBe("  ");
});

test("o comentário de bloco ( * …) não conta como recuo de 1, e o CRLF não atrapalha", () => {
  const doc = "/**\n * Soma.\n * @param a\n */\nfunction f(a) {\n    return a;\n}\n";
  expect(detectIndent(doc, "a.js").unit).toBe("    ");
  // Num arquivo recuado com tab, as linhas ` * ` do JSDoc de fora começam com espaço: se contassem, venceriam o tab.
  const tabbed = "/**\n * Soma dois números.\n * @param a o primeiro\n * @param b o segundo\n */\nfunction soma(a, b) {\n\treturn a + b;\n}\n";
  expect(detectIndent(tabbed, "soma.js").unit).toBe("\t");
  expect(detectIndent(py4.replaceAll("\n", "\r\n"), "a.py").unit).toBe("    ");
});

test("uma linha alinhada fora do passo não muda o passo mais comum", () => {
  const doc = "def f(a,\n      b):\n    x = 1\n    if x:\n        y = 2\n    return x\n";
  expect(detectIndent(doc, "a.py").unit).toBe("    ");
});

test("o Tab do editor recua com o passo do arquivo (o indentMore com o indentUnit detectado)", () => {
  for (const [doc, name, want] of [[py4, "a.py", "    x"], [js2, "a.js", "  x"], [tabbed, "a.go", "\tx"]] as const) {
    const { unit, tabSize } = detectIndent(doc, name);
    let state = EditorState.create({ doc: "x", extensions: [indentUnit.of(unit), EditorState.tabSize.of(tabSize)] });
    indentMore({ state, dispatch: (tr) => (state = tr.state) });
    expect(state.doc.toString()).toBe(want);
  }
});
