import { expect, test } from "bun:test";
import { headingFor, markdownStructure } from "./markdown-structure.ts";

test("heading lookup prefers literal percent text while accepting encoded fragments", () => {
  const headings = markdownStructure("# Taxa 20%20\n# Taxa 20\n# Espaço azul\n").headings;
  expect(headingFor(headings, "Taxa 20%20")?.title).toBe("Taxa 20%20");
  expect(headingFor(headings, "Espaço%20azul")?.title).toBe("Espaço azul");
  expect(headingFor(headings, "Taxa%2020%2520")?.title).toBe("Taxa 20%20");
});
