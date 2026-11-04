// T2469: o básico de app de notas na janela. A lógica pura (árvore, busca, recentes, colar link, palavras) e as pastas no
// vault de mentira, na forma do contrato proposto em #2475.

import { describe, expect, test } from "bun:test";

import { linkFromPaste, listIndent, wordCount } from "./editor/text.ts";
import { MockVault } from "./mock.ts";
import { buildTree, filterTree, recentNotes, type TreeNode } from "./tree.ts";
import type { NoteMeta } from "./types.ts";

// Sem `ctime`, como num engine antes do 1.7.0 (a UI pode rodar num mais velho).
const meta = (path: string, mtime: string, ctime?: string): NoteMeta => ({ ...old(path, mtime), ...(ctime ? { ctime } : {}) }) as NoteMeta;
const old = (path: string, mtime: string) => ({
  path,
  title: path.replace(/^.*\//, "").replace(/\.md$/, ""),
  folder: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "",
  mtime,
  size: 1,
  version: "1",
  tags: [],
});
const names = (nodes: TreeNode[]) => nodes.map((n) => n.name);

describe("a árvore (T2469)", () => {
  const listing = {
    folders: ["Projetos", "Projetos/2026", "Vazia"],
    notes: [
      meta("Beta.md", "2026-11-01", "2026-10-01"),
      meta("alfa.md", "2026-11-03", "2026-09-01"),
      meta("Projetos/Site.md", "2026-11-02", "2026-11-02"),
      meta("Projetos/2026/Plano.md", "2026-11-04", "2026-08-01"),
    ],
  };

  test("pastas antes, e as notas por nome, edição ou criação", () => {
    expect(names(buildTree(listing))).toEqual(["Projetos", "Vazia", "alfa", "Beta"]);
    expect(names(buildTree(listing, "edited"))).toEqual(["Projetos", "Vazia", "alfa", "Beta"]);
    expect(names(buildTree(listing, "created"))).toEqual(["Projetos", "Vazia", "Beta", "alfa"]);
  });

  test("a contagem de cada pasta conta as subpastas", () => {
    const [projetos, vazia] = buildTree(listing) as [Extract<TreeNode, { kind: "folder" }>, Extract<TreeNode, { kind: "folder" }>];
    expect(projetos.count).toBe(2);
    expect(vazia.count).toBe(0);
  });

  test("sem ctime (engine antigo), criação ordena pela edição", () => {
    const old = { folders: [], notes: [meta("A.md", "2026-11-01"), meta("B.md", "2026-11-05")] };
    expect(names(buildTree(old, "created"))).toEqual(["B", "A"]);
  });

  test("a busca na árvore mostra o que casa, com as pastas até lá abertas", () => {
    const { tree, open } = filterTree(buildTree(listing), "plano");
    expect(names(tree)).toEqual(["Projetos"]);
    expect([...open].sort()).toEqual(["Projetos", "Projetos/2026"]);
    // a pasta que casa pelo nome vem inteira
    expect(names(filterTree(buildTree(listing), "proj").tree)).toEqual(["Projetos"]);
    // sem acento nem maiúscula, e vazia devolve tudo
    expect(names(filterTree(buildTree(listing), "ALFA").tree)).toEqual(["alfa"]);
    expect(filterTree(buildTree(listing), "  ").tree).toHaveLength(4);
  });

  test("as recentes, pela última edição", () => {
    expect(recentNotes(listing.notes, 2).map((n) => n.title)).toEqual(["Plano", "alfa"]);
  });
});

describe("o editor (T2469)", () => {
  test("colar um link sobre o texto selecionado vira [texto](url)", () => {
    expect(linkFromPaste("o site", "https://example.com/a")).toBe("[o site](https://example.com/a)");
    expect(linkFromPaste("ver [isto]", "https://x.y")).toBe("[ver \\[isto\\]](https://x.y/)");
    expect(linkFromPaste("wiki", "https://pt.wikipedia.org/wiki/Gato_(desambiguação)")).toBe(
      "[wiki](https://pt.wikipedia.org/wiki/Gato_%28desambigua%C3%A7%C3%A3o%29)",
    );
  });

  test("sem seleção, com texto que não é link, javascript: ou várias linhas: cola como sempre", () => {
    expect(linkFromPaste("", "https://x.y")).toBeNull();
    expect(linkFromPaste("o site", "não é link")).toBeNull();
    expect(linkFromPaste("o site", "javascript:alert(1)")).toBeNull();
    expect(linkFromPaste("duas\nlinhas", "https://x.y")).toBeNull();
    expect(linkFromPaste("https://a.b", "https://x.y")).toBeNull();
  });

  test("as palavras, sem a marcação", () => {
    expect(wordCount("")).toBe(0);
    expect(wordCount("---\ntags: [a, b]\n---\n# Título da nota\n\n- [x] uma tarefa feita\n- item **forte**\n")).toBe(8);
    expect(wordCount("Veja [o site](https://example.com) e a [[Ana|Aninha]] %%nada%%")).toBe(6);
    expect(wordCount("```\nconst a = 1\n```\nbem-vindo, d'água")).toBe(2);
  });
});

describe("as pastas no vault de mentira (o contrato de #2475)", () => {
  const vault = () =>
    new MockVault({
      "Ana.md": "Financeiro.",
      "Projetos/Site.md": "Texto do site com a [[Ana]].",
      "Projetos/2026/Plano.md": "Plano do [[Projetos/Site]].",
      "Reuniões/Planejamento.md": "Decidimos o [[Site]].",
    });

  test("criar pasta (com os pais), e não deixar sair do vault nem repetir", async () => {
    const v = vault();
    expect(await v.folders.create("Arquivo/Velho")).toEqual({ path: "Arquivo/Velho" });
    expect((await v.list()).folders).toContain("Arquivo");
    await expect(v.folders.create("../fora")).rejects.toThrow("E_BAD_ARGS");
    await expect(v.folders.create(".obsidian")).rejects.toThrow("E_BAD_ARGS");
    await expect(v.folders.create("Projetos")).rejects.toThrow("E_EXISTS");
  });

  test("renomear e mover pasta levam as notas de dentro e reescrevem os links", async () => {
    const v = vault();
    const r = await v.folders.rename("Projetos", "Trabalho");
    expect(r.path).toBe("Trabalho");
    const paths = (await v.list()).notes.map((n) => n.path).sort();
    expect(paths).toEqual(["Ana.md", "Reuniões/Planejamento.md", "Trabalho/2026/Plano.md", "Trabalho/Site.md"]);
    expect((await v.get("Trabalho/2026/Plano.md")).content).toContain("[[Site]]");
    expect((await v.folders.move("Trabalho/2026", "")).path).toBe("2026");
    await expect(v.folders.move("Trabalho", "Trabalho/Sub")).rejects.toThrow("E_BAD_ARGS");
  });

  test("mover nota, duplicar e mostrar no Finder", async () => {
    const v = vault();
    expect((await v.folders.moveNote("Ana.md", "Projetos")).meta.path).toBe("Projetos/Ana.md");
    expect((await v.get("Projetos/Site.md")).content).toContain("[[Ana]]");
    expect((await v.folders.duplicateNote("Projetos/Site.md")).path).toBe("Projetos/Site 2.md");
    await v.folders.reveal("Projetos");
    expect(v.revealed).toBe("Projetos");
  });

  test("apagar (nota ou pasta) dá para desfazer pelo caminho original, e o lugar ocupado dá E_EXISTS", async () => {
    const v = vault();
    expect(await v.delete("Ana.md")).toBe(true);
    await v.folders.restore("Ana.md");
    expect((await v.get("Ana.md")).content).toBe("Financeiro.");

    expect(await v.folders.delete("Projetos")).toBe(true);
    expect((await v.list()).notes.map((n) => n.path)).not.toContain("Projetos/Site.md");
    expect(await v.folders.restore("Projetos")).toEqual({ path: "Projetos" });
    expect((await v.list()).notes.map((n) => n.path)).toContain("Projetos/2026/Plano.md");
    await expect(v.folders.restore("Projetos")).rejects.toThrow("E_NOT_FOUND");

    await v.delete("Ana.md");
    await v.create("Ana");
    await expect(v.folders.restore("Ana.md")).rejects.toThrow("E_EXISTS");
  });

  test("as fixadas seguem a nota ao renomear e mover, e saem quando ela é apagada", async () => {
    const v = vault();
    await v.pins.set(["Ana.md", "Projetos/Site.md", "Projetos/Site.md"]);
    expect(await v.pins.list()).toEqual(["Ana.md", "Projetos/Site.md"]);
    await v.rename("Ana.md", "Ana Paula.md");
    expect((await v.folders.rename("Projetos", "Trabalho")).moved).toBeGreaterThan(0);
    expect(await v.pins.list()).toEqual(["Ana Paula.md", "Trabalho/Site.md"]);
    await v.folders.delete("Trabalho");
    expect(await v.pins.list()).toEqual(["Ana Paula.md"]);
  });

  test("o ctime fica quando a nota é editada", async () => {
    let t = 0;
    const v = new MockVault({ "A.md": "x" }, { now: () => new Date(Date.UTC(2026, 10, 1, 0, 0, t++)) });
    const before = await v.get("A.md");
    await v.save("A.md", "y", before.version);
    const after = await v.get("A.md");
    expect(after.ctime).toBe(before.ctime);
    expect(after.mtime).not.toBe(before.mtime);
  });
});

describe("Tab e ⇧Tab nas listas", () => {
  const apply = (text: string, first: number, last: number, dir: 1 | -1) => {
    const lines = text.split("\n");
    const ch = listIndent(lines, first, last, dir);
    if (!ch) return null;
    for (const c of ch) lines[c.line] = " ".repeat(c.add) + lines[c.line]!.slice(c.remove);
    return lines.join("\n");
  };

  test("o item desce para a coluna do texto de cima: 2 em `- `, 3 em `1. `", () => {
    expect(apply("- a\n- b", 1, 1, 1)).toBe("- a\n  - b");
    expect(apply("1. a\n2. b", 1, 1, 1)).toBe("1. a\n   2. b");
    expect(apply("- [ ] a\n- [ ] b", 1, 1, 1)).toBe("- [ ] a\n  - [ ] b");
  });

  test("o primeiro item e o que já é o primeiro filho não mudam, mas o Tab não escapa", () => {
    expect(apply("- a\n- b", 0, 0, 1)).toBe("- a\n- b");
    expect(apply("- a\n  - b", 1, 1, 1)).toBe("- a\n  - b");
  });

  test("os filhos vão junto, e o ⇧Tab volta para o recuo do pai", () => {
    expect(apply("- a\n- b\n  - c\n- d", 1, 1, 1)).toBe("- a\n  - b\n    - c\n- d");
    expect(apply("- a\n  - b\n    - c\n- d", 1, 1, -1)).toBe("- a\n- b\n  - c\n- d");
    expect(apply("- a", 0, 0, -1)).toBe("- a");
  });

  test("fora de lista, ou com tab no recuo, o Tab segue como sempre", () => {
    expect(listIndent(["texto"], 0, 0, 1)).toBeNull();
    expect(listIndent(["- a", "\t- b"], 1, 1, 1)).toBeNull();
    expect(listIndent(["- a", "parágrafo"], 0, 1, 1)).toBeNull();
  });
});
