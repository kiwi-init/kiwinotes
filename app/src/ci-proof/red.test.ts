// Prova do CI (T4928): quebrado de propósito. Este branch nunca é mergeado.
import { expect, test } from "bun:test";

const n: number = "not a number"; // erro de tipo de propósito, para o typecheck

test("o CI fica vermelho com um teste quebrado", () => {
  expect(n).toBe(1);
});
