import { describe, expect, test } from "bun:test";

import { ChangeSet, EditorState, Text } from "@codemirror/state";

import { footnoteInsert, footnoteJump, footnoteLabel, footnoteText, insertFootnote, nextFootnoteLabel, scanFootnotes, superscript } from "./footnotes.ts";
import { slashMatches } from "./slash.ts";

// Como o editor aplica: no mesmo ponto, na ordem da lista.
const apply = (doc: string, r: ReturnType<typeof footnoteInsert>) =>
  ChangeSet.of(r.changes, doc.length).apply(Text.of(doc.split("\n"))).toString();

describe("notas de rodapé (T6377)", () => {
  test("chamada, nota em linha e definição, numeradas pela ordem da primeira chamada", () => {
    const doc = "Texto[^b] e outro^[em linha] e de novo[^b] e[^a].\n\n[^a]: Nota A.\n[^b]: Nota B.\n";
    const n = scanFootnotes(doc);
    expect(n.marks.map((m) => [m.kind, m.kind === "ref" ? m.label : m.text, m.n])).toEqual([
      ["ref", "b", 1],
      ["inline", "em linha", 2],
      ["ref", "b", 1],
      ["ref", "a", 3],
    ]);
    expect(n.def("a")?.text).toBe("Nota A.");
    expect(n.def("B")?.text).toBe("Nota B.");
    expect(doc.slice(n.marks[0]!.from, n.marks[0]!.to)).toBe("[^b]");
    expect(doc.slice(n.marks[1]!.from, n.marks[1]!.to)).toBe("^[em linha]");
    const a = n.def("a")!;
    expect(doc.slice(a.from, a.markerTo)).toBe("[^a]:");
    expect(doc.slice(a.textFrom, a.to)).toBe("Nota A.");
  });

  test("a definição continua nas linhas recuadas logo abaixo", () => {
    const doc = "x[^1]\n\n[^1]: Primeira linha\n    segunda linha\n\tterceira\nfora da nota\n";
    const d = scanFootnotes(doc).def("1")!;
    expect(d.text).toBe("Primeira linha\nsegunda linha\nterceira");
    expect(doc.slice(d.from, d.to)).toBe("[^1]: Primeira linha\n    segunda linha\n\tterceira");
  });

  test("código, frontmatter, escape e link do Markdown não são nota", () => {
    const doc = [
      "---",
      "nota: [^yaml]",
      "---",
      "Em `código [^x]` não, \\[^y] nem [^z](https://x.com).",
      "```",
      "[^w]: nem aqui ^[nem isto]",
      "```",
      "Aqui sim[^ok] e ^[com [[link]] dentro].",
    ].join("\n");
    const n = scanFootnotes(doc);
    expect(n.marks.map((m) => (m.kind === "ref" ? m.label : m.text))).toEqual(["ok", "com [[link]] dentro"]);
    expect(n.defs).toEqual([]);
  });

  test("revisão: fórmula, comentário, escape e a chamada dentro da nota em linha não ganham número", () => {
    const doc = "$x^[2]$ e R$ 4.200^[caro]. %% [^oculta] %% <!-- [^html] --> a[^x\\] b ^[ver [^1]] c[^1].\n";
    const n = scanFootnotes(doc);
    expect(n.marks.map((m) => [m.kind === "ref" ? m.label : m.text, m.n])).toEqual([
      ["caro", 1],
      ["ver [^1]", 2],
      ["1", 3],
    ]);
  });

  test("revisão: uma linha cheia de ^[ sem fecho não trava", () => {
    const t = performance.now();
    scanFootnotes(`${"^[".repeat(20_000)}\n${"`".repeat(5000)}`);
    expect(performance.now() - t).toBeLessThan(1000);
  });

  test("revisão: espaço depois da última definição; o ⌘Z desfaz só a nota", () => {
    const doc = "A[^1] e B.\n\n[^1]: Um.   \n";
    expect(apply(doc, footnoteInsert(doc, 9))).toBe("A[^1] e B[^2].\n\n[^1]: Um.   \n[^2]: ");
    const state = EditorState.create({ doc: "Frase.", selection: { anchor: 6 } });
    expect(insertFootnote(state).userEvent).toBe("input.complete");
  });

  test("nota em linha vazia ou sem fecho fica texto", () => {
    expect(scanFootnotes("a ^[] b ^[sem fecho").marks).toEqual([]);
  });

  test("o número aparece em sobrescrito; a nota sem chamada mostra o rótulo", () => {
    expect(superscript(1)).toBe("¹");
    expect(superscript(12)).toBe("¹²");
    const n = scanFootnotes("a[^x]\n\n[^x]: X\n[^solta]: Y\n");
    expect(footnoteLabel(n, "x")).toBe("¹");
    expect(footnoteLabel(n, "solta")).toBe("[solta]");
  });

  test("o próximo rótulo é um a mais que o maior número em uso", () => {
    expect(nextFootnoteLabel(scanFootnotes("nada"))).toBe("1");
    expect(nextFootnoteLabel(scanFootnotes("a[^1] b[^nome] c[^3]\n\n[^7]: sete\n"))).toBe("8");
  });

  test("inserir: a chamada no cursor e a definição no fim, com o cursor nela", () => {
    const doc = "Uma frase.\nOutra.";
    const r = footnoteInsert(doc, 10);
    const out = apply(doc, r);
    expect(out).toBe("Uma frase.[^1]\nOutra.\n\n[^1]: ");
    expect(r.cursor).toBe(out.length);
    expect(r.label).toBe("1");
  });

  test("inserir junta a definição às outras do fim, sem linha em branco no meio", () => {
    const doc = "A[^1] e B.\n\n[^1]: Um.\n";
    const r = footnoteInsert(doc, 9);
    const out = apply(doc, r);
    expect(out).toBe("A[^1] e B[^2].\n\n[^1]: Um.\n[^2]: ");
    expect(out.slice(r.cursor - 6, r.cursor)).toBe("[^2]: ");
  });

  test("inserir no fim da nota e numa nota vazia", () => {
    const end = "Fim";
    expect(apply(end, footnoteInsert(end, 3))).toBe("Fim[^1]\n\n[^1]: ");
    expect(apply("", footnoteInsert("", 0))).toBe("[^1]\n\n[^1]: ");
  });

  test("pelo /: o \"/rodapé\" vira a chamada", () => {
    const doc = "Texto /rodapé\n";
    const r = footnoteInsert(doc, 13, undefined, { from: 6, to: 13 });
    const out = apply(doc, r);
    expect(out).toBe("Texto [^1]\n\n[^1]: ");
    expect(r.cursor).toBe(out.length);
  });

  test("o \"/\" acha a nota de rodapé", () => {
    expect(slashMatches("rodape")[0]?.id).toBe("footnote");
    expect(slashMatches("nota de")[0]?.id).toBe("footnote");
  });

  test("no editor: inserir põe o cursor na definição nova", () => {
    const state = EditorState.create({ doc: "Frase.", selection: { anchor: 6 } });
    const next = state.update(insertFootnote(state)).state;
    expect(next.doc.toString()).toBe("Frase.[^1]\n\n[^1]: ");
    expect(next.selection.main.head).toBe(next.doc.length);
  });

  test("o clique anda da chamada para a definição e de volta; sem definição, cria", () => {
    const doc = "A[^1] B[^2] C^[em linha].\n\n[^1]: Um.\n";
    const state = EditorState.create({ doc });
    const toDef = state.update(footnoteJump(state, { kind: "footnote", label: "1" })!).state;
    expect(toDef.selection.main.head).toBe(doc.indexOf("Um.") + 3);
    const back = state.update(footnoteJump(state, { kind: "footnoteDef", label: "1" })!).state;
    expect(back.selection.main.head).toBe(doc.indexOf("[^1]") + 4);
    const inline = state.update(footnoteJump(state, { kind: "footnoteInline", n: 3 })!).state;
    expect(doc.slice(inline.selection.main.from, inline.selection.main.to)).toBe("em linha");
    const created = state.update(footnoteJump(state, { kind: "footnote", label: "2" })!).state;
    expect(created.doc.toString()).toBe(`${doc}[^2]: `);
    expect(created.selection.main.head).toBe(created.doc.length);
  });

  test("o texto do hover", () => {
    const n = scanFootnotes("a[^1] b[^2] c^[em **linha**]\n\n[^1]: Um [[Ana]].\n");
    expect(footnoteText(n, { label: "1" })).toEqual({ text: "Um [[Ana]].", missing: false });
    expect(footnoteText(n, { label: "2" })?.missing).toBe(true);
    expect(footnoteText(n, { n: 3 })).toEqual({ text: "em **linha**", missing: false });
  });
});
