import { describe, expect, test } from "bun:test";

import { slashInsert, slashMatches, slashTrigger } from "./slash.ts";
import { toggleHeading, toggleWrap, wrapLink } from "./text.ts";

describe("comando / (T2660)", () => {
  test("abre no começo da linha ou depois de espaço, não no meio de uma palavra nem num endereço", () => {
    expect(slashTrigger("/")).toEqual({ typed: "", from: 0, atLineStart: true });
    expect(slashTrigger("  /tab")).toEqual({ typed: "tab", from: 2, atLineStart: true });
    expect(slashTrigger("texto /da")).toEqual({ typed: "da", from: 6, atLineStart: false });
    expect(slashTrigger("e/ou")).toBeNull();
    expect(slashTrigger("https://x")).toBeNull();
  });

  test("os itens casam pelo nome e pelas palavras, sem acento", () => {
    expect(slashMatches("").length).toBe(15);
    expect(slashMatches("cod").map((i) => i.id)).toEqual(["code"]);
    expect(slashMatches("todo").map((i) => i.id)).toEqual(["todo"]);
    expect(slashMatches("citacao").map((i) => i.id)).toEqual(["quote"]);
  });

  test("o Markdown de cada um, com o cursor no lugar", () => {
    const now = new Date(2026, 10, 4);
    expect(slashInsert("todo", true, now)).toEqual({ insert: "- [ ] ", cursor: 6 });
    expect(slashInsert("h1", false, now)).toEqual({ insert: "\n# ", cursor: 3 });
    expect(slashInsert("code", true, now)).toEqual({ insert: "```\n\n```", cursor: 4 });
    const t = slashInsert("table", true, now)!;
    expect(t.insert.slice(t.cursor - 2, t.cursor + 2)).toBe("|  |");
    expect(slashInsert("today", false, now)).toEqual({ insert: "2026-11-04", cursor: 10 });
    expect(slashInsert("link", false, now)).toEqual({ insert: "[[]]", cursor: 2 });
    expect(slashInsert("template", true, now)).toBeNull();
  });
});

describe("barra de formatação (T2660)", () => {
  test("negrito, itálico e código põem e tiram", () => {
    expect(toggleWrap("a ", "texto", " b", "**")).toMatchObject({ insert: "**texto**", selFrom: 2, selTo: 7 });
    expect(toggleWrap("a **", "texto", "** b", "**")).toMatchObject({ from: -2, to: 7, insert: "texto" });
    expect(toggleWrap("", "**texto**", "", "**")).toMatchObject({ insert: "texto" });
    expect(toggleWrap("a *", "x", "* b", "*")).toMatchObject({ insert: "x", from: -1 });
    // itálico em volta de negrito não confunde os marcadores
    expect(toggleWrap("**", "x", "**", "*")).toMatchObject({ insert: "*x*" });
    expect(toggleWrap("", "`x`", "", "`")).toMatchObject({ insert: "x" });
  });

  test("link e cabeçalho", () => {
    expect(wrapLink("o [site]")).toEqual({ insert: "[o \\[site\\]]()", cursor: 13 });
    expect(toggleHeading("Ideias")).toBe("## Ideias");
    expect(toggleHeading("### Ideias")).toBe("Ideias");
  });
});


test("slash ranks exact aliases above prefixes above contains and usage breaks ties", () => {
  expect(slashMatches("lista", { numbered: 100 }).map(i => i.id)).toEqual(["list", "numbered"]);
  expect(slashMatches("titu").map(i => i.id)).toEqual(["h1", "h2"]);
  expect(slashMatches("odigo").map(i => i.id)).toEqual(["code"]);
  expect(slashMatches("", { code: 4, table: 2 }).slice(0,2).map(i=>i.id)).toEqual(["code","table"]);
});
test("tomorrow and yesterday roll over months/years without mutating the clock", () => {
 const d=new Date(2026,11,31,23,30); expect(slashInsert("tomorrow",false,d)?.insert).toBe("2027-01-01");
 expect(slashInsert("yesterday",false,new Date(2026,0,1))?.insert).toBe("2025-12-31"); expect(d.getDate()).toBe(31);
});
