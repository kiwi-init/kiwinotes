// T6383: os callouts do Obsidian, sem DOM.
import { describe, expect, test } from "bun:test";

import { CALLOUT_KINDS, calloutAt, calloutKind, parseCallout } from "./callouts.ts";

describe("os tipos", () => {
  test("os 13 do Obsidian, cada um com o título em PT", () => {
    expect(CALLOUT_KINDS.map((k) => k.id)).toEqual([
      "note", "abstract", "info", "todo", "tip", "success", "question", "warning", "failure", "danger", "bug", "example", "quote",
    ]);
    expect(CALLOUT_KINDS.map((k) => k.title)).toEqual([
      "Nota", "Resumo", "Info", "A fazer", "Dica", "Sucesso", "Pergunta", "Atenção", "Falha", "Perigo", "Bug", "Exemplo", "Citação",
    ]);
    expect(new Set(CALLOUT_KINDS.map((k) => k.glyph)).size).toBe(13);
  });

  test("os outros nomes vão para o tipo deles, sem diferença de maiúscula; o desconhecido desenha como nota", () => {
    const of = (name: string) => calloutKind(name).id;
    expect([of("summary"), of("TLDR"), of("hint"), of("important"), of("check"), of("done")]).toEqual(["abstract", "abstract", "tip", "tip", "success", "success"]);
    expect([of("help"), of("faq"), of("caution"), of("attention"), of("fail"), of("missing"), of("error"), of("cite")]).toEqual([
      "question", "question", "warning", "warning", "failure", "failure", "danger", "quote",
    ]);
    expect(of("meu-tipo")).toBe("note");
  });
});

describe("parseCallout", () => {
  test("título da nota, ou o do tipo em PT; o corpo sem o `>`", () => {
    expect(parseCallout("> [!tip] Atalho bom\n> use ⌘K\n>\n> - item")).toMatchObject({
      kind: { id: "tip" }, title: "Atalho bom", custom: true, fold: null, body: "use ⌘K\n\n- item",
    });
    expect(parseCallout("> [!faq]\n> por quê?")).toMatchObject({ kind: { id: "question" }, title: "Pergunta", custom: false });
    expect(parseCallout("> [!meu-tipo]\n> x")).toMatchObject({ kind: { id: "note" }, title: "Meu-tipo" });
  });

  test("`+` aberto e `-` recolhido", () => {
    expect(parseCallout("> [!warning]- Cuidado\n> x")?.fold).toBe("-");
    expect(parseCallout("> [!warning]+\n> x")?.fold).toBe("+");
  });

  test("onde está o nome, para trocar o tipo", () => {
    const src = "> [!INFO] Olá";
    const c = parseCallout(src)!;
    expect(src.slice(c.nameFrom, c.nameTo)).toBe("INFO");
  });

  test("citação comum, ou o [!x] no meio, não é callout", () => {
    expect(parseCallout("> só uma citação")).toBeNull();
    expect(parseCallout("texto [!note]")).toBeNull();
  });
});

describe("calloutAt", () => {
  const doc = "Antes\n\n> [!bug]- Falha no login\n> o token expira\n> de novo\n\nDepois\n> citação comum";

  test("de qualquer linha do callout, acha o nome do tipo no documento", () => {
    for (const word of ["Falha no login", "o token", "de novo"]) {
      const c = calloutAt(doc, doc.indexOf(word) + 2)!;
      expect([c.kind.id, doc.slice(c.from, c.to)]).toEqual(["bug", "bug"]);
    }
  });

  test("fora de callout, nada; trocar o tipo é trocar só o nome", () => {
    expect(calloutAt(doc, doc.indexOf("Antes"))).toBeNull();
    expect(calloutAt(doc, doc.indexOf("Depois"))).toBeNull();
    expect(calloutAt(doc, doc.indexOf("citação comum"))).toBeNull();
    const c = calloutAt(doc, doc.indexOf("token"))!;
    expect(doc.slice(0, c.from) + "danger" + doc.slice(c.to)).toContain("> [!danger]- Falha no login\n> o token");
  });

  test("começo do documento e linha vazia em cima não travam", () => {
    expect(calloutAt("\n> [!note]\n> x", 12)?.kind.id).toBe("note");
    expect(calloutAt("> x\n> y", 5)).toBeNull();
    expect(calloutAt("> [!tip]", 0)?.kind.id).toBe("tip");
  });
});
