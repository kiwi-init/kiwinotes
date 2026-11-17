import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hashOf, linesWithTerms, parseTerms, words } from "./privacy-check";

// Termos inventados, só para o teste: a lista de verdade fica em hash (privacy-terms.txt).
const line = (term: string, mode: "p" | "e") => `${words(term).length} ${words(term).join(" ").length} ${mode} ${hashOf(term)}`;
const terms = parseTerms(["# comentário", line("abacaxi", "p"), line("uva", "e"), line("porto alegre azul", "e")].join("\n"));

describe("privacy-check", () => {
  test("as palavras: sem acento, minúsculas e o camelCase separado", () => {
    expect(words("O AbacaxiStore e o ABACAXIWeb, em Pôrto-Alegre")).toEqual(["o", "abacaxi", "store", "e", "o", "abacaxi", "web", "em", "porto", "alegre"]);
  });

  test("acha o termo em qualquer grafia, e diz a linha", () => {
    expect(linesWithTerms("nada aqui\no Abacaxi caiu\nok", terms)).toEqual([2]);
    expect(linesWithTerms("const ABACAXI_URL = 1", terms)).toEqual([1]);
    expect(linesWithTerms('"\\nabacaxi\\n"', terms)).toEqual([1]);
  });

  test("um termo longo pega o começo de uma palavra maior; um curto, só a palavra inteira", () => {
    expect(linesWithTerms("o abacaxiweb e o abacaxiStores", terms)).toEqual([1]);
    expect(linesWithTerms("uvas e uvaia, e um hash uvaB3x9", terms)).toEqual([]);
    expect(linesWithTerms("a uva", terms)).toEqual([1]);
  });

  test("um termo de várias palavras precisa delas em sequência", () => {
    expect(linesWithTerms("Porto Alegre Azul", terms)).toEqual([1]);
    expect(linesWithTerms("porto-alegre/azul", terms)).toEqual([1]);
    expect(linesWithTerms("porto alegre é azul", terms)).toEqual([]);
  });

  test("a lista do repo só tem hashes, no formato certo", () => {
    const text = readFileSync(join(import.meta.dir, "privacy-terms.txt"), "utf8");
    const rows = text.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
    expect(rows.length).toBeGreaterThan(10);
    for (const row of rows) expect(row).toMatch(/^\d+ \d+ [pe] [0-9a-f]{64}$/);
  });
});
