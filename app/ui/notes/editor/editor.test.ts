// O editor sem DOM: o autocomplete do `[[` e o parser do Markdown do GitHub (tabelas e tarefas), que o preview usa.

import { describe, expect, test } from "bun:test";

import { CompletionContext } from "@codemirror/autocomplete";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";

import { externalUrl } from "../links.ts";
import { linkCompletion, urlAt, wikiLinkSyntax } from "./index.ts";
import { rawCellStart } from "./livePreview.ts";

const targets = () => [
  { title: "Ana", folder: "Pessoas", link: "Ana" },
  { title: "Site novo", folder: "Projetos", link: "Site novo" },
];

function complete(doc: string, pos = doc.length) {
  const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
  return linkCompletion(targets)(new CompletionContext(state, pos, false));
}

describe("autocomplete do [[", () => {
  test("abre depois de [[ e começa no nome", () => {
    const r = complete("fale com a [[An");
    expect(r?.from).toBe("fale com a [[".length);
    expect(r?.options.map((o) => o.label)).toEqual(["Ana", "Site novo"]);
    expect(r?.options[0]!.detail).toBe("Pessoas");
  });

  test("não abre fora de [[, depois de | ou #, nem com um [ só", () => {
    expect(complete("fale com a An")).toBeNull();
    expect(complete("[[Ana|apel")).toBeNull();
    expect(complete("[[Ana#Tít")).toBeNull();
    expect(complete("[Ana")).toBeNull();
  });
});

describe("Markdown do GitHub", () => {
  const nodes = (doc: string) => {
    const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage, extensions: [wikiLinkSyntax] })] });
    const names: string[] = [];
    ensureSyntaxTree(state, state.doc.length, 5000)!.iterate({ enter: (n) => void names.push(n.name) });
    return names;
  };

  test("tabela, tarefa e riscado", () => {
    const names = nodes("| a | b |\n| - | - |\n| 1 | 2 |\n\n- [x] feito\n- [ ] falta\n\n~~velho~~");
    expect(names).toContain("Table");
    expect(names.filter((n) => n === "TaskMarker")).toHaveLength(2);
    expect(names).toContain("Strikethrough");
  });

  test("[[link]] vira WikiLink, não link do Markdown", () => {
    expect(nodes("veja [[Ana]] e [[Site|o site]]").filter((n) => n === "WikiLink")).toHaveLength(2);
    expect(nodes("veja [[Ana]]")).not.toContain("Link");
    expect(nodes("[[]] e [[a\nb]]")).not.toContain("WikiLink");
    expect(nodes("[normal](https://x.y)")).toContain("Link");
  });
});

test("o clique numa célula da tabela cai no começo do texto dela", () => {
  expect(rawCellStart("| Mudança | 4.200 |", 0)).toBe(2);
  expect(rawCellStart("| Mudança | 4.200 |", 1)).toBe(12);
  expect(rawCellStart("Mudança | 4.200", 0)).toBe(0);
  expect(rawCellStart("Mudança | 4.200", 1)).toBe(10);
  expect(rawCellStart("| a \\| b | c |", 1)).toBe(11);
});

describe("link externo (#1375, #1379)", () => {
  const state = (doc: string) =>
    EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage, extensions: [wikiLinkSyntax] })] });

  test("só http, https e mailto abrem fora", () => {
    expect(externalUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(externalUrl("<mailto:ana@example.com>")).toBe("mailto:ana@example.com");
    for (const bad of ["javascript:alert(1)", " JavaScript:alert(1)", "views://internal/index.html", "file:///etc/passwd", "data:text/html,<b>x</b>", "nada"]) {
      expect(externalUrl(bad)).toBeNull();
    }
  });

  test("⌘-clique acha o endereço do link do Markdown sob o cursor", () => {
    const doc = "veja [o site](https://example.com) ou [mal](javascript:alert(1)) e <https://kiwi.example>";
    const s = state(doc);
    ensureSyntaxTree(s, s.doc.length, 5000);
    expect(urlAt(s, doc.indexOf("o site"))).toBe("https://example.com/");
    expect(urlAt(s, doc.indexOf("mal"))).toBeNull();
    expect(urlAt(s, doc.indexOf("kiwi.example"))).toBe("https://kiwi.example/");
    expect(urlAt(s, 0)).toBeNull();
  });
});

test("a janela Notas nunca põe HTML do texto na página (o Markdown é só texto no editor)", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const root = join(import.meta.dir, "..");
  const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes(".test."));
  for (const f of files) {
    const code = readFileSync(join(root, f), "utf8");
    expect({ f, html: /innerHTML|outerHTML|insertAdjacentHTML|dangerouslySetInnerHTML|document\.write/.test(code) }).toEqual({ f, html: false });
  }
});
