// T6580: a conta da medida do ditado longo, sem `say` nem helper.
import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { align, seamReport, sentences, words } from "./long-dictation.ts";

test("as palavras sem pontuação nem maiúscula, e o hífen separa", () => {
  expect(words("Hoje, de manhã: e-mails!")).toEqual(["hoje", "de", "manhã", "e", "mails"]);
});

test("o alinhamento diz o que trocou, sumiu e sobrou", () => {
  const r = align(["a", "b", "c", "d"], ["a", "c", "d", "e"]);
  expect(r.errors).toBe(2);
  expect(r.ops.map((o) => o.kind)).toEqual(["ok", "del", "ok", "ok", "ins"]);
  expect(align(["a", "b"], ["a", "x"]).ops.map((o) => o.kind)).toEqual(["ok", "sub"]);
});

test("conta como da emenda só o que o longo perdeu e o frase a frase não, com o segundo e a distância da emenda", () => {
  const ref = Array.from({ length: 60 }, (_, i) => `p${i}`).join(" ");
  const long = ref.replace("p30 ", "").replace("p10 ", "");
  const baseline = ref.replace("p10 ", "");
  const r = seamReport(ref, long, baseline, 60);
  expect(r.lost).toEqual([{ word: "p30", at: 30, fromSeam: 0 }]);
  expect([r.errors, r.baselineErrors]).toEqual([2, 1]);
});

test("os textos longos da medida existem e passam de 60 s faladas (~2,6 palavras por segundo)", () => {
  const dir = path.resolve(import.meta.dirname, "..", "test", "dictation", "longos");
  const texts = readdirSync(dir).filter((f) => f.endsWith(".txt"));
  expect(texts.length).toBeGreaterThanOrEqual(3);
  for (const f of texts) {
    const text = readFileSync(path.join(dir, f), "utf8");
    expect([f, words(text).length >= 160]).toEqual([f, true]);
    expect(sentences(text).length).toBeGreaterThan(5);
  }
  expect(existsSync(path.join(dir, "..", "falados.jsonl"))).toBe(true);
});
