import { describe, expect, test } from "bun:test";

import { bodyTags, cleanTag, hasTag, splitTagQuery, tagTree, uniqueTags } from "./tags.ts";
import { fillTemplate, formatDate } from "./templates.ts";

describe("tags (T2619)", () => {
  test("no texto: #tag e #tag/sub, fora de código, título, link e número puro", () => {
    const body = [
      "# Título",
      "Fala da #reuniao e do #projeto/kiwi, (#entre) parênteses.",
      "`#codigo` e https://x.com/#ancora e #2026 e #2026-plano",
      "```",
      "#dentro",
      "```",
      "%% #comentario %%",
      "#fim/",
    ].join("\n");
    expect(bodyTags(body)).toEqual(["reuniao", "projeto/kiwi", "entre", "2026-plano", "fim"]);
  });

  test("cleanTag, uniqueTags sem diferença de maiúscula, e hasTag com as filhas", () => {
    expect(cleanTag("#a//b")).toBeNull();
    expect(cleanTag("123")).toBeNull();
    expect(uniqueTags(["Projeto", "projeto", "#outra"])).toEqual(["Projeto", "outra"]);
    expect(hasTag(["projeto/kiwi"], "Projeto")).toBe(true);
    expect(hasTag(["projetos"], "projeto")).toBe(false);
  });

  test("a árvore conta cada nota uma vez por nó, em ordem de nome", () => {
    const tree = tagTree([["projeto/kiwi", "projeto/site"], ["Projeto/kiwi"], ["ideia"]]);
    expect(tree.map((t) => [t.tag, t.count])).toEqual([
      ["ideia", 1],
      ["projeto", 2],
    ]);
    expect(tree[1]!.children.map((t) => [t.tag, t.name, t.count])).toEqual([
      ["projeto/kiwi", "kiwi", 2],
      ["projeto/site", "site", 1],
    ]);
  });

  test("tag: e # na busca", () => {
    expect(splitTagQuery("tag:projeto reunião #ideia tag:")).toEqual({ tags: ["projeto", "ideia"], text: "reunião" });
  });
});

describe("modelos (T2619)", () => {
  const now = new Date(2026, 10, 4, 9, 5, 7);
  test("as variáveis do Obsidian, com AAAA ou YYYY", () => {
    expect(fillTemplate("# {{title}}\n{{date}} {{time}} {{date:DD/MM/AAAA}} {{ date : YYYY }} {{time:HH:mm:ss}}", { title: "Ata", now })).toBe(
      "# Ata\n2026-11-04 09:05 04/11/2026 2026 09:05:07",
    );
  });
  test("o que não é variável conhecida fica", () => {
    expect(fillTemplate("{{autor}} {{title:x}} {title}", { title: "A", now })).toBe("{{autor}} {{title:x}} {title}");
    expect(formatDate(now, "HHh")).toBe("09h");
  });
});
