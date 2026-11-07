// T6594: qual linha vira embed de nota.
import { expect, test } from "bun:test";

import { noteEmbedLine } from "./embeds.tsx";

test("só a linha que é um embed de nota; anexo, link comum e embed no meio do texto, não", () => {
  expect(noteEmbedLine("![[Projeto]]")).toBe("Projeto");
  expect(noteEmbedLine("  ![[Pasta/Projeto#Plano|veja]]  ")).toBe("Pasta/Projeto#Plano|veja");
  expect(noteEmbedLine("![[Projeto#^item2]]")).toBe("Projeto#^item2");
  expect(noteEmbedLine("![[foto.png]]")).toBeNull();
  expect(noteEmbedLine("![[relatorio.pdf|300]]")).toBeNull();
  expect(noteEmbedLine("[[Projeto]]")).toBeNull();
  expect(noteEmbedLine("veja ![[Projeto]] aqui")).toBeNull();
  expect(noteEmbedLine("![[#Título da mesma nota]]")).toBeNull();
});
