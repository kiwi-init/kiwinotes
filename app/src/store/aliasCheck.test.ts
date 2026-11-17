import { describe, expect, test } from "bun:test";

import { aliasRisk, aliasWarnings, aliasWarningText, type Lexicon, systemLexicon } from "./aliasCheck.ts";

const lex: Lexicon = {
  words: new Set(["new", "cube", "control", "time", "segue", "paris"]),
  names: new Set(["york", "ana", "paris"]),
  phrases: new Set(["new york"]),
};

describe("aliasRisk", () => {
  test("the T51 case: a common phrase or a proper name", () => {
    expect(aliasRisk("New York", lex)).toEqual({ reason: "phrase" });
    expect(aliasRisk("Ana Clara", lex)).toEqual({ reason: "name", word: "ana" });
    expect(aliasRisk("ana", lex)).toEqual({ reason: "name", word: "ana" });
  });

  test("a single common word", () => {
    expect(aliasRisk("time", lex)).toEqual({ reason: "word" });
    expect(aliasRisk("Paris", lex)).toEqual({ reason: "word" });
  });

  test("what the STT writes for a technical term is fine", () => {
    expect(aliasRisk("cube control", lex)).toBeUndefined();
    expect(aliasRisk("cubectl", lex)).toBeUndefined();
    expect(aliasRisk("  ", lex)).toBeUndefined();
  });
});

describe("aliasWarnings", () => {
  test("lists each risky alias with its term, and says what will happen", () => {
    const w = aliasWarnings(
      [
        { term: "IAM", aliases: ["New York", "i am"] },
        { term: "kubectl", aliases: ["cube control"] },
      ],
      lex,
    );
    expect(w).toEqual([{ term: "IAM", alias: "New York", reason: "phrase" }]);
    expect(aliasWarningText(w[0]!)).toBe("“New York” é uma expressão comum: sempre que você disser isso, vai sair “IAM”.");
  });

  test("the macOS lists and the Portuguese ones catch the real cases", () => {
    const sys = systemLexicon();
    expect(aliasRisk("New York", sys)?.reason).toBe("phrase");
    expect(aliasRisk("segue", sys)?.reason).toBe("word");
    expect(aliasRisk("São Paulo", sys)?.reason).toBe("phrase");
    expect(aliasRisk("cube control", sys)).toBeUndefined();
    expect(aliasRisk("cubectuget", sys)).toBeUndefined();
  });
});
