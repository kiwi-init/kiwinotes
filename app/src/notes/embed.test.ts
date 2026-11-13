// T6594 (E15): o pedaço que cada embed mostra, cortado no engine.
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { embedContent, parseEmbed } from "./embed.ts";
import { Vault } from "./vault.ts";
import { tempDir } from "../../test/tmp.ts";

const NOTE = `---
tags: [projeto]
---
Introdução da nota.

# Plano

Primeiro passo do plano.

## Detalhes

Os detalhes ficam aqui. ^detalhe

- item um
- item dois ^item2
- item três

# Fim

Até logo.
`;

test("o link: a nota, o título ou o bloco; o apelido não muda nada", () => {
  expect(parseEmbed("![[Projeto]]")).toEqual({ target: "Projeto", fragment: "" });
  expect(parseEmbed("![[Pasta/Projeto#Plano|veja]]")).toEqual({ target: "Pasta/Projeto", fragment: "Plano" });
  expect(parseEmbed("![[Projeto#^item2]]")).toEqual({ target: "Projeto", fragment: "^item2" });
  expect(parseEmbed("![[]]")).toBeNull();
});

test("a nota inteira, sem o frontmatter e sem as marcas ^id", () => {
  const r = embedContent(NOTE, "")!;
  expect(r.kind).toBe("note");
  expect(r.content.startsWith("Introdução da nota.")).toBe(true);
  expect(r.content).not.toContain("tags:");
  expect(r.content).not.toContain("^detalhe");
  expect(r.content).toContain("Os detalhes ficam aqui.");
});

test("o título traz a seção até o próximo título do mesmo nível, com os subtítulos", () => {
  const plano = embedContent(NOTE, "Plano")!;
  expect(plano.kind).toBe("heading");
  expect(plano.content.startsWith("# Plano")).toBe(true);
  expect(plano.content).toContain("## Detalhes");
  expect(plano.content).toContain("item três");
  expect(plano.content).not.toContain("Até logo");
  const detalhes = embedContent(NOTE, "detalhes")!;
  expect(detalhes.content.startsWith("## Detalhes")).toBe(true);
  expect(detalhes.content).not.toContain("# Fim");
});

test("o bloco ^id: o parágrafo, ou só o item de lista", () => {
  expect(embedContent(NOTE, "^detalhe")).toEqual({ kind: "block", content: "Os detalhes ficam aqui." });
  expect(embedContent(NOTE, "^item2")).toEqual({ kind: "block", content: "- item dois" });
});

test("título ou bloco que não existe: null", () => {
  expect(embedContent(NOTE, "Nada")).toBeNull();
  expect(embedContent(NOTE, "^sumiu")).toBeNull();
});

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

test("Vault.embed resolve o link como o Obsidian e diz o que falta", async () => {
  const root = tempDir("kn-embed-");
  dirs.push(root);
  mkdirSync(path.join(root, "Pasta"));
  writeFileSync(path.join(root, "Pasta", "Projeto.md"), NOTE);
  const v = new Vault({ root, trash: async () => {} });
  await v.open();
  expect(v.embed("![[Projeto#^detalhe]]")).toEqual({ path: "Pasta/Projeto.md", title: "Projeto", kind: "block", content: "Os detalhes ficam aqui." });
  expect(v.embed("Projeto#Fim")).toMatchObject({ kind: "heading", content: "# Fim\n\nAté logo." });
  expect(v.embed("![[Projeto#Sem isso]]")).toEqual({ path: "Pasta/Projeto.md", title: "Projeto", missing: "Sem isso" });
  expect(v.embed("![[Ninguém]]")).toBeNull();
  expect(() => v.embed(42)).toThrow();
  v.close();
});
