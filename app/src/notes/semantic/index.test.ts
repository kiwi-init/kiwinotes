// T6013: o índice do sentido acompanha as notas pela versão, guarda só vetores fora do cofre e acha pelo assunto.
import { afterEach, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

import { noteChunks, plainText } from "./chunks.ts";
import { DIM, fakeEmbedder } from "./fake.ts";
import { decodeIndex, encodeIndex, type SemanticDocument, SemanticIndex } from "./index.ts";
import { meanPool } from "./embedder.ts";
import { tempDir } from "../../../test/tmp.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = tempDir("kn-semantic-");
  dirs.push(d);
  return d;
};

const doc = (p: string, content: string, version = "v1"): SemanticDocument => ({ path: p, title: p.replace(/\.md$/, ""), version, content });

function setup(dir = tmp()) {
  const model = fakeEmbedder();
  const engine = { start: async () => model, loaded: () => model };
  const index = new SemanticIndex({ dir, engine, dim: DIM, pause: async () => {} });
  return { dir, model, index };
}

test("os trechos: sem frontmatter nem sintaxe, com o título, cortados entre parágrafos", () => {
  const content = "---\ntags: [x]\n---\n# Backup\n\n- [ ] ver o [[Servidor PACS|servidor]] e o **storage**\n\n" + "palavra ".repeat(300);
  expect(plainText(content)).not.toContain("tags:");
  const chunks = noteChunks("Plano", content);
  expect(chunks[0]).toStartWith("Plano. Backup ver o servidor e o storage");
  expect(chunks.length).toBeGreaterThan(1);
  for (const c of chunks) expect(c.length).toBeLessThan(900);
  expect(noteChunks("Só título", "")).toEqual(["Só título"]);
});

test("a média dos tokens ignora o padding e sai normalizada", () => {
  const data = new Float32Array([1, 0, 3, 0, 100, 100]);
  const mask = new BigInt64Array([1n, 1n, 0n]);
  const [v] = meanPool(data, mask, 1, 3, 2);
  expect(v![0]).toBeCloseTo(1);
  expect(v![1]).toBeCloseTo(0);
});

test("acha pelo assunto, sem palavra em comum, e diz o trecho que casou", async () => {
  const { index } = setup();
  index.sync([
    doc("Backup.md", "Lista de compras.\n\nConfigurar o backup do servidor PACS toda noite no storage."),
    doc("Bolo.md", "Receita de bolo de cenoura com chocolate."),
  ]);
  await index.idle();
  const hits = await index.query("cópia de segurança das imagens", 5);
  expect(hits[0]!.path).toBe("Backup.md");
  expect(hits[0]!.score).toBeGreaterThan(0.9);
  expect(hits[1]!.score).toBeLessThan(0.1);
  expect(index.status()).toEqual({ notes: 2, indexed: 2 });
});

test("só a nota que mudou de versão volta ao modelo; a que sumiu sai", async () => {
  const { index, model } = setup();
  index.sync([doc("A.md", "backup do servidor"), doc("B.md", "receita de bolo")]);
  await index.idle();
  const before = model.calls.length;
  index.sync([doc("A.md", "backup do servidor"), doc("B.md", "receita de bolo")]);
  await index.idle();
  expect(model.calls.length).toBe(before);
  index.sync([doc("A.md", "viagem de férias na praia", "v2")]);
  await index.idle();
  expect(model.calls.length).toBe(before + 1);
  expect((await index.query("passagens", 5)).map((h) => h.path)).toEqual(["A.md"]);
});

test("os vetores ficam no disco, fora do cofre e sem o texto das notas; reabrir não refaz", async () => {
  const { dir, index } = setup();
  index.sync([doc("Segredo.md", "A senha do login é cenoura-azul-42 e o token expira.")]);
  await index.idle();
  const file = path.join(dir, "vectors.bin");
  expect(existsSync(file)).toBe(true);
  const raw = readFileSync(file).toString("latin1");
  expect(raw).not.toContain("cenoura-azul");
  expect(raw).not.toContain("senha");
  const again = setup(dir);
  again.index.sync([doc("Segredo.md", "A senha do login é cenoura-azul-42 e o token expira.")]);
  await again.index.idle();
  expect(again.model.calls.filter((c) => c.kind === "passage")).toEqual([]);
  expect((await again.index.query("autenticação", 1))[0]!.path).toBe("Segredo.md");
});

test("um arquivo de outro formato ou cortado é ignorado e refeito", () => {
  const notes = new Map([["A.md", { version: "v1", vectors: [new Float32Array(DIM).fill(0.5)] }]]);
  const bytes = encodeIndex(DIM, notes);
  expect(decodeIndex(bytes, DIM)?.get("A.md")?.vectors[0]?.[0]).toBeCloseTo(0.5);
  expect(decodeIndex(bytes.slice(0, bytes.length - 8), DIM)).toBeNull();
  expect(decodeIndex(bytes, DIM + 1)).toBeNull();
  expect(decodeIndex(new Uint8Array([1, 2]), DIM)).toBeNull();
});

test("sem o modelo, a busca pelo sentido não acha nada e não espera; desligar apaga os vetores", async () => {
  const dir = tmp();
  const index = new SemanticIndex({ dir, engine: { start: async () => null, loaded: () => null }, dim: DIM, pause: async () => {} });
  index.sync([doc("A.md", "backup")]);
  await index.idle();
  expect(await index.query("backup", 5)).toEqual([]);
  expect(index.status()).toEqual({ notes: 1, indexed: 0 });
  const on = setup(dir);
  on.index.sync([doc("A.md", "backup")]);
  await on.index.idle();
  expect(existsSync(path.join(dir, "vectors.bin"))).toBe(true);
  await on.index.clear();
  expect(existsSync(dir)).toBe(false);
});
