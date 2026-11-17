import { describe, expect, test } from "bun:test";
import { markdownStructure } from "../shared/markdown-structure.ts";
import { makeResolver } from "../shared/wikilinks.ts";
import { noteReferences, rewriteHeadingReferences, rewriteNoteReferences, rewriteTag } from "./refactor.ts";

describe("E11 source-preserving refactors", () => {
  test("prose references exclude code, comments, frontmatter and external links", () => {
    const doc = '---\nname: "[[A]]"\n---\n[[A#Seção|rótulo]] [r](A.md#Se%C3%A7%C3%A3o) [[#Local]]\n`[[A]]`\n~~~\n[[A]]\n~~~\n    [[A]]\n%% [[A]] %%\n<!-- [[A]] -->\n[site](https://a.test)';
    expect(noteReferences(doc).map(r => [r.target, r.fragment])).toEqual([["A", "Seção"], ["A.md", "Se%C3%A7%C3%A3o"], ["", "Local"]]);
  });
  test("headings have exact source offsets, skip literals and support setext", () => {
    const doc = '---\nx: y\n---\n# **Olá** ##\n\nSegunda\n-------\n\n```\n# falso\n```\n%%\n# falso\n%%';
    const h = markdownStructure(doc).headings;
    expect(h.map(x => [x.title, x.level])).toEqual([["Olá", 1], ["Segunda", 2]]);
    expect(doc.slice(h[0]!.textFrom, h[0]!.textTo)).toBe("**Olá**");
  });
  test("heading rename preserves labels and updates local and URI fragments", () => {
    const h = markdownStructure("# Seção\n\n## Seção").headings;
    const resolve = makeResolver(["A.md", "B.md"]);
    const doc = '[[A#seção|rotulo]] [r](A.md#se%C3%A7%C3%A3o) [[#Seção]] `[[A#Seção]]`';
    expect(rewriteHeadingReferences(doc, "A.md", "A.md", h[0]!, h, "Nova seção", resolve)).toEqual({ content: '[[A#Nova seção|rotulo]] [r](A.md#Nova%20se%C3%A7%C3%A3o) [[#Nova seção]] `[[A#Seção]]`', count: 3 });
    expect(rewriteHeadingReferences(doc, "A.md", "A.md", h[1]!, h, "Outra", resolve).count).toBe(0);
  });
  test("note rename retains aliases and rebases relative Markdown links", () => {
    const before = makeResolver(["P/A.md", "B.md"], new Map([["P/A.md", ["Alias"]]]));
    const after = makeResolver(["Q/Nova.md", "B.md"], new Map([["Q/Nova.md", ["Alias"]]]));
    expect(rewriteNoteReferences('[[A#x|R]] [[Alias]] [r](P/A.md#x) `[[A]]`', "B.md", "B.md", "P/A.md", "Q/Nova.md", before, after).content).toBe('[[Nova#x|R]] [[Alias]] [r](Q/Nova.md#x) `[[A]]`');
    expect(rewriteNoteReferences('[b](../B.md)', "P/A.md", "Q/Sub/Nova.md", "P/A.md", "Q/Sub/Nova.md", before, after).content).toBe('[b](../../B.md)');
  });
  test("tag hierarchy edits only tag scalars and prose, preserving YAML style", () => {
    const doc = `---\ntitle: projeto\naliases: [projeto]\ntags: ['projeto', "projeto/filha", outra] # keep\ntag: projeto,projeto/sub\n---\n#projeto #Projeto/sub #projetor\n\`#projeto\`\n~~~\n#projeto\n~~~\n%% #projeto %%\n[site](#projeto)\n`;
    const r = rewriteTag(doc, "projeto", "trabalho");
    expect(r.unsupported).toBe(false);
    expect(r.content).toContain(`title: projeto\naliases: [projeto]\ntags: ['trabalho', "trabalho/filha", outra] # keep\ntag: trabalho,trabalho/sub`);
    expect(r.content).toContain('#trabalho #trabalho/sub #projetor');
    expect(r.content).toContain('`#projeto`');
    expect(r.content).toContain('[site](#projeto)');
    expect(r.content).toContain('~~~\n#projeto\n~~~');
  });
  test("non-map YAML and aliases do not throw or corrupt unrelated data", () => {
    expect(() => rewriteTag('---\ntext\n---\n#x', 'x', 'y')).not.toThrow();
    expect(rewriteTag('---\nother: &a [x]\ntags: *a\n---\n#x', 'x', 'y').content).toContain('other: &a [x]\ntags: *a');
  });
});
test("literal escaped wiki syntax and ambiguous Markdown suffixes are not refactored", () => {
  const before = makeResolver(['Else/A.md']), after = makeResolver(['Else/New.md']);
  expect(rewriteNoteReferences('\\[[A]] [wrong](A.md) [ok](Else/A.md)', 'B.md', 'B.md', 'Else/A.md', 'Else/New.md', before, after).content).toBe('\\[[A]] [wrong](A.md) [ok](Else/New.md)');
});
test("a tag that YAML could treat as a boolean is serialized as a string", () => {
  const r = rewriteTag('---\ntags: [old]\n---\n#old', 'old', 'true');
  expect(Bun.YAML.parse(r.content.split('---')[1]!) as object).toEqual({tags:['true']});
});
test("reference-style Markdown destinations follow title changes", () => {
  const before = makeResolver(['A.md']), after = makeResolver(['New.md']);
  const r = rewriteNoteReferences('[read][r]\n\n[r]: A.md#Heading "tooltip"', 'B.md', 'B.md', 'A.md', 'New.md', before, after);
  expect(r).toEqual({content:'[read][r]\n\n[r]: New.md#Heading "tooltip"',count:1});
});
test("YAML anchors shared with another field are reported, never silently changed", () => {
  const original='---\ntags: [&shared old]\nother: *shared\n---\n#old';
  const r = rewriteTag(original, 'old', 'new');
  expect(r.unsupported).toBe(true);expect(r.content).toBe(original.replace('#old','#new'));
});
test("CRLF frontmatter and comments survive scalar replacements byte-for-byte", () => {
  expect(rewriteTag('---\r\ntags: old # keep\r\naliases: [old]\r\n---\r\n#old\r\n', 'old', 'new').content).toBe('---\r\ntags: new # keep\r\naliases: [old]\r\n---\r\n#new\r\n');
});
