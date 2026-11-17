import { expect, test } from "bun:test";

import { trilhaHint, trilhaLabel } from "./trailsText.ts";

test("a trilha na tela: as palavras, a nota e as vezes", () => {
  expect(trilhaLabel({ palavras: ["orçamento", "viagem"] })).toBe("orçamento · viagem");
  expect(trilhaHint({ titulo: "Gastos", path: "Pessoal/Gastos.md", vezes: 1 })).toBe("leva a Gastos (Pessoal/Gastos.md) · 1 vez");
  expect(trilhaHint({ titulo: "Gastos", path: "Pessoal/Gastos.md", vezes: 3 })).toBe("leva a Gastos (Pessoal/Gastos.md) · 3 vezes");
});
