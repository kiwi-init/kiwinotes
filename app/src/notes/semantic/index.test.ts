// T6013: o índice do sentido acompanha as notas pela versão, guarda só vetores fora do cofre e acha pelo assunto.
import { afterEach, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { noteChunks, plainText } from "./chunks.ts";
import { DIM, fakeEmbedder } from "./fake.ts";
import { applyJournal, decodeIndex, DUTY, PER_CALL, encodeIndex, type SemanticDocument, SemanticIndex } from "./index.ts";
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
  const content = "---\ntags: [x]\n---\n# Backup\n\n- [ ] ver o [[Servidor SILO|servidor]] e o **storage**\n\n" + "palavra ".repeat(300);
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
    doc("Backup.md", "Lista de compras.\n\nConfigurar o backup do servidor SILO toda noite no storage."),
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

// ── a CPU (spec #24228) ──────────────────────────────────────────────────────────────────────────────────────────

const notesOf = (n: number, version = "v1") => Array.from({ length: n }, (_, i) => doc(`N${i}.md`, `backup do servidor ${i}`, version));

test("o modelo trabalha no máximo um quarto do tempo: depois de um lote de t ms, espera 3t", async () => {
  let t = 0;
  const model = fakeEmbedder();
  const slow = { ...model, embed: async (texts: readonly string[], kind: "query" | "passage") => ((t += 100), model.embed(texts, kind)) };
  const pauses: number[] = [];
  const index = new SemanticIndex({
    dir: tmp(),
    engine: { start: async () => slow, loaded: () => slow },
    dim: DIM,
    now: () => t,
    pause: async (ms) => void pauses.push(ms),
  });
  index.sync(notesOf(20));
  await index.idle();
  // 20 notas em lotes de 8: 8, 8 e 4, cada nota uma chamada de 100 ms.
  expect(pauses).toEqual([2400, 2400, 1200]);
  for (const [i, ms] of pauses.entries()) {
    const busy = [800, 800, 400][i]!;
    expect(busy / (busy + ms)).toBeCloseTo(DUTY);
  }
});

test("com o portão fechado (a pessoa no Mac), o modelo não roda; aberto, a fila anda", async () => {
  const { dir, model } = setup();
  let open!: () => void;
  const opened = new Promise<void>((r) => (open = r));
  let waits = 0;
  const index = new SemanticIndex({
    dir,
    engine: { start: async () => model, loaded: () => model },
    dim: DIM,
    pause: async () => {},
    gate: { wait: async () => void (waits++, await opened) },
  });
  index.sync(notesOf(3));
  await Bun.sleep(30);
  expect(waits).toBe(1);
  expect(model.calls).toEqual([]);
  open();
  await index.idle();
  expect(index.status()).toEqual({ notes: 3, indexed: 3 });
});

test("fechar o índice com o portão fechado não fica esperando", async () => {
  const model = fakeEmbedder();
  let stop: (() => boolean) | undefined;
  const index = new SemanticIndex({
    dir: tmp(),
    engine: { start: async () => model, loaded: () => model },
    dim: DIM,
    pause: async () => {},
    gate: {
      wait: async (s) => {
        stop = s;
        while (!s?.()) await Bun.sleep(5);
      },
    },
  });
  index.sync(notesOf(2));
  await Bun.sleep(20);
  await index.close();
  expect(stop?.()).toBe(true);
  expect(model.calls).toEqual([]);
});

test("mudar uma nota não regrava o retrato: o que mudou vai para o fim do vectors.add", async () => {
  const { dir, index } = setup();
  const notes = notesOf(50);
  index.sync(notes);
  await index.idle();
  const bin = path.join(dir, "vectors.bin");
  const add = path.join(dir, "vectors.add");
  const snapshot = readFileSync(bin);
  // O retrato sai do 1º lote; o resto da 1ª passada já vai para o .add.
  const first = existsSync(add) ? statSync(add).size : 0;

  index.sync([...notes.slice(0, 49), doc("N49.md", "receita de bolo", "v2")]);
  await index.idle();
  expect(readFileSync(bin)).toEqual(snapshot);
  const one = statSync(add).size;
  // Um bloco com uma nota só, não as 50.
  expect(one - first).toBeGreaterThan(0);
  expect(one - first).toBeLessThan((snapshot.length + first) / 10);

  // Uma nota que sai também vai para o .add, e reabrir não refaz nada.
  index.sync(notes.slice(0, 48).concat(doc("N49.md", "receita de bolo", "v2")));
  await index.idle();
  expect(statSync(add).size).toBeGreaterThan(one);
  expect(readFileSync(bin)).toEqual(snapshot);

  const again = setup(dir);
  again.index.sync(notes.slice(0, 48).concat(doc("N49.md", "receita de bolo", "v2")));
  await again.index.idle();
  expect(again.model.calls.filter((c) => c.kind === "passage")).toEqual([]);
  expect(again.index.status()).toEqual({ notes: 49, indexed: 49 });
  expect((await again.index.query("cozinha", 1))[0]!.path).toBe("N49.md");
  expect((await again.index.query("cópia de segurança", 100)).map((h) => h.path)).not.toContain("N48.md");
});

test("o fim cortado do vectors.add (o app caiu gravando) sai, e só aquela nota volta ao modelo", async () => {
  const { dir, index } = setup();
  const notes = notesOf(10);
  index.sync(notes);
  await index.idle();
  const changed = [...notes.slice(0, 8), doc("N8.md", "receita de bolo", "v2")];
  index.sync([...changed, notes[9]!]);
  await index.idle();
  const two = [...changed, doc("N9.md", "viagem de férias", "v2")];
  index.sync(two);
  await index.idle();
  const add = path.join(dir, "vectors.add");
  const full = readFileSync(add);
  writeFileSync(add, full.subarray(0, full.length - 6));

  const again = setup(dir);
  again.index.sync(two);
  await again.index.idle();
  // O N8 estava no 1º bloco, que valeu; o N9, no bloco cortado, volta ao modelo.
  expect(again.model.calls.flatMap((c) => (c.kind === "passage" ? c.texts : []))).toEqual(["N9. viagem de férias"]);
  expect(again.index.status()).toEqual({ notes: 10, indexed: 10 });
  // O .add ficou sem o pedaço cortado, e o bloco novo do N9 veio atrás dele.
  const fixed = new Map<string, { version: string; vectors: Float32Array[] }>();
  expect(applyJournal(new Uint8Array(readFileSync(add)), DIM, fixed)).toBe(statSync(add).size);
  expect(fixed.get("N9.md")?.version).toBe("v2");
});

test("o vectors.add grande vira um retrato novo, e sai", async () => {
  const dir = tmp();
  const model = fakeEmbedder();
  const make = () =>
    new SemanticIndex({ dir, engine: { start: async () => model, loaded: () => model }, dim: DIM, pause: async () => {}, compactMinBytes: 300 });
  const index = make();
  const notes = notesOf(20);
  index.sync(notes);
  await index.idle();
  const bin = path.join(dir, "vectors.bin");
  const add = path.join(dir, "vectors.add");
  const snapshots = new Set<string>();
  let current = notes;
  for (let round = 2; round < 12; round++) {
    current = current.map((d, i) => (i < 5 ? doc(d.path, `receita de bolo ${round}`, `v${round}`) : d));
    index.sync(current);
    await index.idle();
    snapshots.add(readFileSync(bin).toString("base64"));
  }
  // O retrato foi refeito no caminho (mais de um retrato visto), e o .add nunca passa muito do limite.
  expect(snapshots.size).toBeGreaterThan(1);
  // O .add passou do limite e da metade do retrato pelo menos uma vez: o retrato tem as versões novas, e o .add sumiu ou recomeçou pequeno.
  const snap = decodeIndex(new Uint8Array(readFileSync(bin)), DIM)!;
  expect(existsSync(add) ? statSync(add).size : 0).toBeLessThan(statSync(bin).size);
  expect([...snap.values()].some((s) => s.version !== "v1")).toBe(true);
  const again = new SemanticIndex({ dir, engine: { start: async () => model, loaded: () => model }, dim: DIM, pause: async () => {} });
  const before = model.calls.length;
  again.sync(current);
  await again.idle();
  expect(model.calls.length).toBe(before);
  expect(again.status()).toEqual({ notes: 20, indexed: 20 });
});

test("o e5 roda com 1 thread", () => {
  const src = readFileSync(path.join(import.meta.dir, "embedder.ts"), "utf8");
  expect(src).toContain("intraOpNumThreads: o.threads ?? 1,");
});

test("um trecho por chamada ao modelo: a inferência segura o laço do Bun enquanto roda", async () => {
  const { index, model } = setup();
  index.sync([doc("Longa.md", Array.from({ length: 5 }, (_, i) => `backup do servidor ${i} `.repeat(60)).join("\n\n"))]);
  await index.idle();
  expect(PER_CALL).toBe(1);
  const passages = model.calls.filter((c) => c.kind === "passage");
  expect(passages.length).toBeGreaterThan(1);
  for (const c of passages) expect(c.texts).toHaveLength(1);
});
