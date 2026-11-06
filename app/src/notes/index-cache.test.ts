// T5352 (issue #171): o índice com cache por mtime e tamanho, os `aliases:` no resolver e a escrita com fsync.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { makeResolver, rewriteLinks, rewriteLinksMany } from "../shared/wikilinks.ts";
import { aliasesOf, Vault, writeDurable } from "./vault.ts";

const dirs: string[] = [];
const vaults: Vault[] = [];
afterEach(() => {
  for (const v of vaults.splice(0)) v.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function vault(files: Record<string, string>) {
  const root = path.join(mkdtempSync(path.join(tmpdir(), "kiwinotes-cache-")), "KiwiNotes");
  dirs.push(path.dirname(root));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  }
  const v = new Vault({ root, trash: async (abs) => rmSync(abs, { recursive: true }) });
  vaults.push(v);
  await v.open();
  return { v, root };
}

describe("aliases do frontmatter (T5352)", () => {
  test("lê lista YAML, [a, b], texto só e `alias:`; sem frontmatter ou YAML ruim, nada", () => {
    expect(aliasesOf("---\naliases:\n  - Ana Souza\n  - AS\n---\ntexto")).toEqual(["Ana Souza", "AS"]);
    expect(aliasesOf("---\naliases: [Projeto X, PX]\n---\n")).toEqual(["Projeto X", "PX"]);
    expect(aliasesOf("---\nalias: Só um\n---\n")).toEqual(["Só um"]);
    expect(aliasesOf("aliases: [fora do frontmatter]")).toEqual([]);
    expect(aliasesOf("---\naliases: [quebrado\n---\n")).toEqual([]);
    expect(aliasesOf("---\ntags: [a]\n---\n")).toEqual([]);
  });

  test("o resolver acha pelo apelido, sem acento nem maiúscula; o nome do arquivo ganha do apelido", () => {
    const paths = ["Pessoas/Ana.md", "PX.md", "Projetos/Projeto X.md"];
    const resolve = makeResolver(paths, new Map([["Pessoas/Ana.md", ["Ana Souza"]], ["Projetos/Projeto X.md", ["PX", "Atlas"]]]));
    expect(resolve("ana souza")).toBe("Pessoas/Ana.md");
    expect(resolve("Atlas")).toBe("Projetos/Projeto X.md");
    expect(resolve("PX")).toBe("PX.md");
    expect(resolve("Ninguém")).toBeNull();
  });

  test("no vault: resolve, backlinks e o rename que não mexe no [[apelido]] e atualiza o [[nome]]", async () => {
    const { v, root } = await vault({
      "Pessoas/Ana.md": "---\naliases: [Ana Souza]\n---\nA Ana.",
      "Reunião.md": "Com [[Ana Souza]] e [[Ana]] e [[Ana Souza|ela]].",
    });
    expect(v.resolve("[[Ana Souza]]")).toBe("Pessoas/Ana.md");
    expect((await v.backlinks("Pessoas/Ana.md")).map((b) => b.path)).toEqual(["Reunião.md"]);
    const r = await v.rename("Pessoas/Ana.md", "Pessoas/Ana Paula.md");
    expect(r.updatedLinks).toBe(1);
    expect(readFileSync(path.join(root, "Reunião.md"), "utf8")).toBe("Com [[Ana Souza]] e [[Ana Paula]] e [[Ana Souza|ela]].");
    expect(v.resolve("Ana Souza")).toBe("Pessoas/Ana Paula.md");
  });

  test("o apelido entra e sai com a edição da nota", async () => {
    const { v } = await vault({ "Ana.md": "sem apelido" });
    expect(v.resolve("Aninha")).toBeNull();
    const note = await v.get("Ana.md");
    await v.save("Ana.md", "---\naliases: [Aninha]\n---\nagora com", note.version);
    expect(v.resolve("Aninha")).toBe("Ana.md");
  });

  test("rewriteLinks e rewriteLinksMany deixam o [[apelido]] que continua achando a nota", () => {
    const before = makeResolver(["A/Ana.md", "B.md"], new Map([["A/Ana.md", ["Aninha"]]]));
    const after = makeResolver(["C/Ana.md", "B.md"], new Map([["C/Ana.md", ["Aninha"]]]));
    expect(rewriteLinksMany("[[Aninha]] [[A/Ana]]", new Map([["A/Ana.md", "C/Ana.md"]]), before, after)).toEqual({ content: "[[Aninha]] [[Ana]]", count: 1 });
    const afterRename = makeResolver(["A/Ana Paula.md", "B.md"], new Map([["A/Ana Paula.md", ["Aninha"]]]));
    expect(rewriteLinks("[[Aninha]] [[Ana]]", "A/Ana.md", "A/Ana Paula.md", before, afterRename)).toEqual({ content: "[[Aninha]] [[Ana Paula]]", count: 1 });
  });
});

describe("o cache do índice por mtime e tamanho (T5352)", () => {
  const files = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`P${i % 3}/N${i}.md`, `nota ${i} [[N${(i + 1) % 30}]]`]));

  test("o 1º scan lê tudo; o rename relê só o que mudou (nada), e o índice continua certo", async () => {
    const { v } = await vault({ ...files, "Solta.md": "sem link" });
    expect(v.scanReads).toBe(31);
    const r = await v.rename("Solta.md", "Outra/Solta.md");
    expect(r.updatedLinks).toBe(0);
    expect(v.scanReads).toBe(31);
    expect(v.list().notes.map((n) => n.path)).toContain("Outra/Solta.md");
    expect(v.search("sem link", 5).map((h) => h.path)).toEqual(["Outra/Solta.md"]);
  });

  test("uma edição feita fora, com o mesmo tamanho, entra pelo mtime", async () => {
    const { v, root } = await vault({ "A.md": "aaaa", "B.md": "bbbb" });
    const abs = path.join(root, "A.md");
    writeFileSync(abs, "zzzz");
    const t = statSync(abs).mtimeMs / 1000 + 5;
    utimesSync(abs, t, t);
    await v.rename("B.md", "C.md");
    expect(v.scanReads).toBe(3);
    expect(v.search("zzzz", 5).map((h) => h.path)).toEqual(["A.md"]);
  });

  test("uma pasta renomeada fora: o inode acha as notas de antes, que trocam de caminho sem reler", async () => {
    const { v, root } = await vault(files);
    renameSync(path.join(root, "P0"), path.join(root, "Q0"));
    await v.rename("P1/N1.md", "P1/Um.md");
    expect(v.scanReads).toBe(30);
    const paths = v.list().notes.map((n) => n.path);
    expect(paths).toContain("Q0/N0.md");
    expect(paths.some((p) => p.startsWith("P0/"))).toBe(false);
    const meta = v.list().notes.find((n) => n.path === "Q0/N3.md")!;
    expect(meta.folder).toBe("Q0");
    expect(meta.title).toBe("N3");
    expect(v.search("N3", 3).some((h) => h.path === "Q0/N3.md")).toBe(true);
  });

  test("mover uma pasta pelo app atualiza os links sem reler as notas", async () => {
    const { v } = await vault(files);
    const r = await v.moveFolder("P2", "Arquivo/P2");
    expect(r.moved).toBe(10);
    expect(v.scanReads).toBe(30);
    expect(v.resolve("N2")).toBe("Arquivo/P2/N2.md");
  });
});

describe("a escrita atômica com fsync (T5352)", () => {
  test("writeDurable grava o texto inteiro; o save não deixa .tmp para trás", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "kiwinotes-durable-"));
    dirs.push(dir);
    await writeDurable(path.join(dir, "a.txt"), "olá ".repeat(10_000));
    expect(readFileSync(path.join(dir, "a.txt"), "utf8")).toBe("olá ".repeat(10_000));
    const { v, root } = await vault({ "A.md": "um" });
    const note = await v.get("A.md");
    await v.save("A.md", "dois", note.version);
    expect(readFileSync(path.join(root, "A.md"), "utf8")).toBe("dois");
    expect(readdirSync(root).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });
});
