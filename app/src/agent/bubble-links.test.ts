import { describe, expect, test } from "bun:test";
import { makeFileResolver, makeResolver } from "../shared/wikilinks.ts";
import { kiwiFileHref, kiwiFilePath, linkify } from "../shared/bubble-links.ts";
import { type BubbleLinkResolver, findBubbleLinks } from "./bubble-links.ts";

// Uma pasta inventada (spec #17952).
const notes = ["Plano.md", "Reuniões/Ata de março.md", "Projeto X/Roteiro.md"];
const files = ["Anexos/orcamento.pdf", "lista.txt", "Projeto X/fotos/capa.png", "dados (v2).csv"];
const note = makeResolver(notes);
const file = makeFileResolver(files);
const r: BubbleLinkResolver = { note: (t) => note(t), file: (t) => file(t) };
const pick = (text: string) => findBubbleLinks(text, r).map((l) => [l.text, l.path, l.kind]);

describe("findBubbleLinks (spec #17683)", () => {
  test("uma nota, um pdf e um caminho que não existe, que fica texto", () => {
    const text = "Veja [[Plano]], o orcamento.pdf e o relatorio.pdf.";
    const links = findBubbleLinks(text, r);
    expect(links.map((l) => [l.text, l.path, l.kind])).toEqual([
      ["[[Plano]]", "Plano.md", "note"],
      ["orcamento.pdf", "Anexos/orcamento.pdf", "file"],
    ]);
    for (const l of links) expect(text.slice(l.from, l.to)).toBe(l.text);
  });

  test("as quatro formas: wikilink com apelido, link markdown, crase e caminho solto", () => {
    expect(pick("[[Ata de março|a ata]] e [o roteiro](Projeto%20X/Roteiro.md), `lista.txt`, fotos/capa.png")).toEqual([
      ["[[Ata de março|a ata]]", "Reuniões/Ata de março.md", "note"],
      ["[o roteiro](Projeto%20X/Roteiro.md)", "Projeto X/Roteiro.md", "note"],
      ["`lista.txt`", "lista.txt", "note"],
      ["fotos/capa.png", "Projeto X/fotos/capa.png", "file"],
    ]);
    expect(pick("[[Plano#Prazo]] e ![[Plano]] e [x](<Projeto X/Roteiro.md>)")).toEqual([
      ["[[Plano#Prazo]]", "Plano.md", "note"],
      ["![[Plano]]", "Plano.md", "note"],
      ["[x](<Projeto X/Roteiro.md>)", "Projeto X/Roteiro.md", "note"],
    ]);
  });

  test("solto, um caminho com espaço só entra pelo fim sem espaço (o começo do trecho é ambíguo)", () => {
    expect(pick("Projeto X/fotos/capa.png")).toEqual([]);
  });

  test(".txt é nota; o resto é arquivo", () => {
    expect(pick("lista.txt e Anexos/orcamento.pdf")).toEqual([
      ["lista.txt", "lista.txt", "note"],
      ["Anexos/orcamento.pdf", "Anexos/orcamento.pdf", "file"],
    ]);
  });

  test("nada fora da pasta: .., absoluto, ~ e esquema", () => {
    expect(pick("[a](../Plano.md) [b](/Plano.md) `~/Plano.md` [c](file:///Plano.md) ../lista.txt [[../Plano]]")).toEqual([]);
  });

  test("nada em bloco de código, em URL, em imagem nem no meio de uma palavra", () => {
    expect(pick("```\nPlano.md e lista.txt\n```\nhttps://exemplo.com/lista.txt ![capa](Projeto%20X/fotos/capa.png) xlista.txt lista.txtx")).toEqual([]);
    expect(pick("~~~md\n[[Plano]]\n~~~")).toEqual([]);
    expect(pick("Nome: ana@lista.txt")).toEqual([]);
  });

  test("crase sem extensão nem barra não vira nota, nem quando o nome existe", () => {
    expect(pick("Rode `Plano` e `kiwi status`.")).toEqual([]);
    expect(pick("`Plano.md` e `Projeto X/Roteiro`")).toEqual([
      ["`Plano.md`", "Plano.md", "note"],
      ["`Projeto X/Roteiro`", "Projeto X/Roteiro.md", "note"],
    ]);
  });

  test("um link web fica com o construtor, e a menção não se repete por dentro de outra", () => {
    expect(pick("[site](https://exemplo.com/Plano.md) e [[lista.txt]] no fim.")).toEqual([["[[lista.txt]]", "lista.txt", "note"]]);
    expect(pick("[`Plano.md`](Plano.md)")).toEqual([["[`Plano.md`](Plano.md)", "Plano.md", "note"]]);
  });

  test("ponto final e parênteses em volta não entram no trecho", () => {
    expect(pick("(lista.txt). Fim com Plano.md.")).toEqual([
      ["lista.txt", "lista.txt", "note"],
      ["Plano.md", "Plano.md", "note"],
    ]);
  });

  test("limite de links e resposta vazia", () => {
    expect(findBubbleLinks("", r)).toEqual([]);
    expect(findBubbleLinks("lista.txt ".repeat(80), r).length).toBe(50);
  });
});

describe("linkify (spec #17683)", () => {
  test("cada menção vira um link kiwi-file com o rótulo certo", () => {
    const text = "Veja [[Ata de março|a ata]], `Plano.md`, [o roteiro](Projeto%20X/Roteiro.md) e dados (v2).csv.";
    const out = linkify(text, findBubbleLinks(text, r));
    expect(out).toBe(
      `Veja [a ata](${kiwiFileHref("Reuniões/Ata de março.md")}), [\`Plano.md\`](kiwi-file:Plano.md), [o roteiro](kiwi-file:Projeto%20X%2FRoteiro.md) e dados (v2).csv.`,
    );
    expect(kiwiFilePath(kiwiFileHref("dados (v2).csv"))).toBe("dados (v2).csv");
    expect(kiwiFileHref("dados (v2).csv")).not.toMatch(/[()]/);
  });

  test("um link que não bate com o texto (a resposta mudou) fica de fora", () => {
    expect(linkify("Veja Plano.md", [{ text: "Plano.md", from: 0, to: 8, path: "Plano.md", kind: "note" }])).toBe("Veja Plano.md");
    expect(linkify("Veja Plano.md", undefined)).toBe("Veja Plano.md");
    expect(kiwiFilePath("https://exemplo.com")).toBeNull();
    expect(kiwiFilePath("kiwi-file:%E0")).toBeNull();
  });
});
