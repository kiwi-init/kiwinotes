import { expect, test } from "bun:test";

import { hasFilters, hasPositive, parseQuery, sanitizeSavedSearches } from "./query.ts";

test("palavras, frases, tag:, #, path:, e as exclusões", () => {
  expect(parseQuery('Reunião "Frase Exata" tag:projeto #ideia path:Projetos/2026 path:"Minha pasta" -rascunho -"não quero" -tag:velho -#feio -path:Arquivo -')).toEqual({
    words: ["reuniao"],
    phrases: ["frase exata"],
    tags: ["projeto", "ideia"],
    paths: ["projetos/2026", "minha pasta"],
    notText: ["rascunho", "nao quero"],
    notTags: ["velho", "feio"],
    notPaths: ["arquivo"],
  });
});

test("aspas sem fechar vão até o fim, e tag: vazia some", () => {
  expect(parseQuery('a "b c').phrases).toEqual(["b c"]);
  expect(parseQuery("tag: x").words).toEqual(["x"]);
  expect(parseQuery("#2026").tags).toEqual([]);
});

test("hasFilters e hasPositive", () => {
  expect(hasFilters(parseQuery("só palavras"))).toBe(false);
  expect(hasFilters(parseQuery("-x"))).toBe(true);
  expect(hasPositive(parseQuery("-x"))).toBe(false);
  expect(hasPositive(parseQuery("path:a"))).toBe(true);
});

test("buscas salvas: sem nome ou sem busca saem, e a busca não repete", () => {
  expect(sanitizeSavedSearches([{ name: "A", query: "tag:a" }, { name: "B", query: "tag:a" }, { name: "", query: "x" }, { name: "C" }, "x"])).toEqual([{ name: "A", query: "tag:a" }]);
  expect(sanitizeSavedSearches(null)).toEqual([]);
});

test("frases e exclusões com espaços juntados (T2751)", () => {
  expect(parseQuery('"a   b\tc" -"x  y"')).toMatchObject({ phrases: ["a b c"], notText: ["x y"] });
});
