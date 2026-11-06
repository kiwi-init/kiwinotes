// A lógica da janela Notas (T1317): links, frontmatter, árvore e o vault de mentira com a forma do contrato 1.1.0.

import { describe, expect, test } from "bun:test";
import { engineNotes } from "./api.ts";
import { joinFrontmatter, splitFrontmatter, tagsOf } from "./frontmatter.ts";
import { folderOf, linkAt, linkTextFor, noteName, parseLinks, plainContext, plainSnippet } from "./links.ts";
import { MockVault, snippetAround } from "./mock.ts";
import { paletteItems, snippetRanges, titleMatches, titleRanges } from "./palette.ts";
import { ancestors, buildTree, editedLabel } from "./tree.ts";

describe("links", () => {
  test("reconhece wikilink de título da própria nota", () => {
    expect(parseLinks("[[#Título]]")).toMatchObject([{ target: "", heading: "Título" }]);
  });
  test("acha [[nota]], [[nota|apelido]] e [[nota#título]]", () => {
    const text = "veja [[Ana]], a [[Projetos/Site novo|o site]] e [[Mudança#Custos]]";
    expect(parseLinks(text).map(({ target, heading, alias }) => ({ target, heading, alias }))).toEqual([
      { target: "Ana", heading: undefined, alias: undefined },
      { target: "Projetos/Site novo", heading: undefined, alias: "o site" },
      { target: "Mudança", heading: "Custos", alias: undefined },
    ]);
  });

  test("ignora colchete vazio, aberto ou quebrado em duas linhas", () => {
    expect(parseLinks("[[]] [[ ]] [[Ana] [[An\na]]")).toEqual([]);
  });

  test("link sob o cursor, inclusive nos colchetes", () => {
    const text = "oi [[Ana]] tchau";
    expect(linkAt(text, 3)?.target).toBe("Ana");
    expect(linkAt(text, 6)?.target).toBe("Ana");
    expect(linkAt(text, 10)?.target).toBe("Ana");
    expect(linkAt(text, 11)).toBeNull();
  });

  test("nome e pasta do path", () => {
    expect(noteName("Projetos/Site novo.md")).toBe("Site novo");
    expect(folderOf("Projetos/2026/X.md")).toBe("Projetos/2026");
    expect(folderOf("X.md")).toBe("");
  });

  const paths = ["Ana.md", "Pessoas/Ana.md", "Projetos/Site.md"];
  test("o autocomplete escreve o nome, ou o caminho quando há outra nota com o mesmo nome", () => {
    expect(linkTextFor("Projetos/Site.md", paths)).toBe("Site");
    expect(linkTextFor("Pessoas/Ana.md", paths)).toBe("Pessoas/Ana");
    expect(linkTextFor("Ana.md", paths)).toBe("Ana");
  });

  test("a linha do \"Citada em\" sai sem marcação", () => {
    expect(plainContext("- Começar pela [[Mudança de escritório]] e o [[Site|site novo]]")).toBe("Começar pela Mudança de escritório e o site novo");
    expect(plainContext("- [x] Falar com a [[Ana#Contato]]")).toBe("Falar com a Ana");
    expect(plainContext("## Com a [[Ana]]")).toBe("Com a Ana");
  });

  test("o trecho da busca sai sem marcação", () => {
    expect(plainSnippet("…o orçamento da [[Mudança]] Ligar para a [[Ana|Aninha]]")).toBe("…o orçamento da Mudança Ligar para a Aninha");
    expect(plainSnippet("…texto é a [[Ana]]. ``` npm run `build` **já**")).toBe("…texto é a Ana. npm run build já");
    expect(plainSnippet("- [ ] Pedir o orçamento - [x] Medir")).toBe("Pedir o orçamento Medir");
  });

});

describe("frontmatter", () => {
  test("separa e junta sem mudar um byte", () => {
    const content = "---\ntags: [a, b]\nalias: x\n---\n# Título\n\ntexto\n";
    const split = splitFrontmatter(content);
    expect(split.frontmatter).toBe("---\ntags: [a, b]\nalias: x\n---\n");
    expect(split.body).toBe("# Título\n\ntexto\n");
    expect(joinFrontmatter(split)).toBe(content);
  });

  test("sem frontmatter, ou com --- no meio do texto, o corpo é tudo", () => {
    expect(splitFrontmatter("texto\n---\nmais").frontmatter).toBe("");
    expect(splitFrontmatter("").body).toBe("");
  });

  test("tags do frontmatter, em lista e no corpo, sem título nem código", () => {
    expect(tagsOf("---\ntags: [projeto, \"q4\"]\n---\noi #pessoa\n# Título\n`#nao` e #pessoa")).toEqual(["projeto", "q4", "pessoa"]);
    expect(tagsOf("---\ntags:\n  - a\n  - b\n---\n")).toEqual(["a", "b"]);
    expect(tagsOf("---\ntags: solta\n---\n")).toEqual(["solta"]);
  });
});

describe("árvore", () => {
  test("pastas antes das notas, em ordem, e pastas vazias aparecem", () => {
    const tree = buildTree({
      folders: ["Projetos", "Vazia", "Projetos/2026"],
      notes: [
        { path: "Zeta.md", title: "Zeta" },
        { path: "Projetos/Nota 10.md", title: "Nota 10" },
        { path: "Projetos/Nota 2.md", title: "Nota 2" },
        { path: "Alfa.md", title: "Alfa" },
      ].map((n) => ({ ...n, folder: folderOf(n.path), mtime: "", ctime: "", size: 0, version: "1", tags: [] })),
    });
    expect(tree.map((n) => n.name)).toEqual(["Projetos", "Vazia", "Alfa", "Zeta"]);
    const projetos = tree[0]!;
    expect(projetos.kind === "folder" && projetos.children.map((n) => n.name)).toEqual(["2026", "Nota 2", "Nota 10"]);
  });

  test("as pastas acima da nota, de fora para dentro", () => {
    expect(ancestors("A/B/C.md")).toEqual(["A", "A/B"]);
    expect(ancestors("C.md")).toEqual([]);
  });

  test("quando foi editada", () => {
    const now = new Date("2026-11-03T15:00:00");
    expect(editedLabel({ mtime: "2026-11-03T09:00:00" }, now)).toBe("editada hoje");
    expect(editedLabel({ mtime: "2026-11-02T22:00:00" }, now)).toBe("editada ontem");
    expect(editedLabel({ mtime: "2026-10-28T10:00:00" }, now)).toMatch(/^editada em 28 de out/);
    expect(editedLabel({ mtime: "2025-10-28T10:00:00" }, now)).toMatch(/2025/);
  });
});

describe("vault de mentira (forma do contrato 1.1.0)", () => {
  const vault = () =>
    new MockVault({
      "Ana.md": "Financeiro.",
      "Projetos/Site.md": "---\ntags: [projeto]\n---\nTexto do site com a [[Ana]].\n",
      "Reuniões/Planejamento.md": "Decidimos o [[Site]] e falamos com a [[Ana|Aninha]].\n",
    });

  test("lista pastas e notas com a meta do contrato", async () => {
    const { folders, notes } = await vault().list();
    expect(folders).toEqual(["Projetos", "Reuniões"]);
    const site = notes.find((n) => n.path === "Projetos/Site.md")!;
    expect(site).toMatchObject({ title: "Site", folder: "Projetos", version: "1", tags: ["projeto"] });
    expect(site.size).toBeGreaterThan(0);
  });

  test("save com a versão certa grava; com a velha devolve a nota atual sem gravar", async () => {
    const v = vault();
    const note = await v.get("Ana.md");
    const ok = await v.save("Ana.md", "Financeiro e RH.", note.version);
    expect(ok.saved && ok.meta.version).toBe("2");
    v.editOutside("Ana.md", "Mudou no Obsidian.");
    const late = await v.save("Ana.md", "minha versão", ok.saved ? ok.meta.version : "");
    expect(late.saved).toBe(false);
    expect(!late.saved && late.current.content).toBe("Mudou no Obsidian.");
    expect((await v.get("Ana.md")).content).toBe("Mudou no Obsidian.");
  });

  test("backlinks com a linha que cita", async () => {
    expect(await vault().backlinks("Ana.md")).toEqual([
      { path: "Reuniões/Planejamento.md", title: "Planejamento", context: "Decidimos o [[Site]] e falamos com a [[Ana|Aninha]]." },
      { path: "Projetos/Site.md", title: "Site", context: "Texto do site com a [[Ana]]." },
    ]);
  });

  test("rename atualiza os links de quem cita e avisa", async () => {
    const v = vault();
    const changed: string[][] = [];
    v.onChanged((p) => changed.push(p));
    const r = await v.rename("Ana.md", "Pessoas/Ana Souza.md");
    expect(r).toMatchObject({ meta: { path: "Pessoas/Ana Souza.md", title: "Ana Souza" }, updatedLinks: 2 });
    expect((await v.get("Reuniões/Planejamento.md")).content).toContain("[[Ana Souza|Aninha]]");
    expect(changed[0]).toContain("Pessoas/Ana Souza.md");
  });

  test("create com título repetido vira \"Título 2\"", async () => {
    const v = vault();
    expect((await v.create("Ana")).path).toBe("Ana 2.md");
    expect((await v.create("Ideia", "Projetos")).path).toBe("Projetos/Ideia.md");
  });

  test("busca por título e texto, sem acento nem maiúscula, título primeiro", async () => {
    const hits = await vault().search("site");
    expect(hits.map((h) => h.path)).toEqual(["Projetos/Site.md", "Reuniões/Planejamento.md"]);
    expect((await vault().search("reunioes decidimos")).length).toBe(0);
    expect((await vault().search("DECIDIMOS"))[0]!.title).toBe("Planejamento");
  });

  test("resolve e delete", async () => {
    const v = vault();
    expect(await v.resolve("site")).toBe("Projetos/Site.md");
    expect(await v.delete("Ana.md")).toBe(true);
    expect(await v.resolve("Ana")).toBeNull();
  });

  test("o trecho da busca é curto e sem marcação de Markdown", () => {
    const text = `# Título\n\n- [ ] ${"palavra ".repeat(40)}alvo ${"fim ".repeat(40)}`;
    const s = snippetAround(text, text.indexOf("alvo"));
    expect(s).toContain("alvo");
    expect(s.length).toBeLessThanOrEqual(144);
    expect(s).not.toContain("[ ]");
  });
});

describe("as capacidades pelo engine", () => {
  test("cada chamada vai com o nome e os argumentos do contrato", async () => {
    const calls: [string, unknown][] = [];
    const api = engineNotes(
      async (cap, args) => {
        calls.push([cap, args]);
        return null;
      },
      () => () => {},
    );
    await api.list();
    await api.save("A.md", "x", "3");
    await api.create("Nova");
    await api.create("Nova", "Projetos", "texto");
    await api.search("oi", 8);
    await api.resolve("Ana");
    expect(calls).toEqual([
      ["notes.list", {}],
      ["notes.save", { path: "A.md", content: "x", baseVersion: "3" }],
      ["notes.create", { title: "Nova" }],
      ["notes.create", { title: "Nova", folder: "Projetos", content: "texto" }],
      ["notes.search", { query: "oi", limit: 8 }],
      ["notes.resolve", { link: "Ana" }],
    ]);
  });

  test("pastas e fixadas só num engine com o contrato 1.7.0 (T2468), com os nomes de #2493", async () => {
    expect(engineNotes(async () => null, () => () => {}).folders).toBeUndefined();
    expect(engineNotes(async () => null, () => () => {}, (c) => c === "notes.list").pins).toBeUndefined();
    const calls: [string, unknown][] = [];
    const api = engineNotes(
      async (cap, args) => {
        calls.push([cap, args]);
        return cap.startsWith("settings.") ? { pinned: ["A.md"] } : true;
      },
      () => () => {},
      () => true,
    );
    await api.folders!.create("Projetos/2026");
    await api.folders!.move("Projetos", "");
    await api.folders!.moveNote("A.md", "Projetos");
    await api.folders!.restore("A.md");
    expect(await api.pins!.list()).toEqual(["A.md"]);
    expect(await api.pins!.set(["A.md"])).toEqual(["A.md"]);
    expect(calls).toEqual([
      ["folders.create", { path: "Projetos/2026" }],
      ["folders.move", { path: "Projetos", parent: "" }],
      ["notes.move", { path: "A.md", folder: "Projetos" }],
      ["notes.restore", { path: "A.md" }],
      ["settings.get", {}],
      ["settings.set", { pinned: ["A.md"] }],
    ]);
  });

  test("o evento notes.changed chega com os paths", () => {
    let listener: ((p: unknown) => void) | undefined;
    const api = engineNotes(async () => null, (name, fn) => {
      expect(name).toBe("notes.changed");
      listener = fn;
      return () => {};
    });
    const got: string[][] = [];
    api.onChanged((p) => got.push(p));
    listener!({ paths: ["A.md"] });
    expect(got).toEqual([["A.md"]]);
  });
});

describe("⌘K", () => {
  const meta = (path: string, mtime: string) => ({ path, title: noteName(path), folder: folderOf(path), mtime, ctime: mtime, size: 0, version: "1", tags: [] });
  const notes = [
    meta("Ana.md", "2026-11-01"),
    meta("Pessoas/Anabela.md", "2026-11-03"),
    meta("Projetos/Plano da Ana.md", "2026-11-02"),
    meta("Diário.md", "2026-11-04"),
  ];

  test("sem busca, as mais recentes", () => {
    expect(paletteItems(notes, "", []).map((i) => i.kind === "note" && i.title)).toEqual(["Diário", "Anabela", "Plano da Ana", "Ana"]);
  });

  test("título igual, depois começando, depois contendo; sem acento", () => {
    expect(titleMatches(notes, "ana").map((n) => n.title)).toEqual(["Ana", "Anabela", "Plano da Ana"]);
    expect(titleMatches(notes, "diario").map((n) => n.title)).toEqual(["Diário"]);
  });

  test("o texto do notes.search vem depois dos títulos, sem repetir, e Criar só sem título igual", () => {
    const hits = [
      { path: "Ana.md", title: "Ana", snippet: "x", score: 9 },
      { path: "Diário.md", title: "Diário", snippet: "falei com a ana", score: 1 },
    ];
    const items = paletteItems(notes, "ana", hits);
    expect(items.map((i) => (i.kind === "note" ? i.title : `+${i.title}`))).toEqual(["Ana", "Anabela", "Plano da Ana", "Diário"]);
    expect(items.at(-1)).toMatchObject({ kind: "note", snippet: "falei com a ana" });
    expect(paletteItems(notes, "Reunião nova", []).at(-1)).toEqual({ kind: "create", title: "Reunião nova" });
  });

  test("fuzzy (T2966): kg acha hgkjgkj, e o título exato fica acima do aproximado", () => {
    const fuzzy = [...notes, meta("hgkjgkj.md", "2026-11-05"), meta("Peso em kg.md", "2026-10-01")];
    // "Peso em kg" é exato (mais velho); "hgkjgkj" é só subsequência (mais novo) e vem depois.
    expect(titleMatches(fuzzy, "kg").map((n) => n.title)).toEqual(["Peso em kg", "hgkjgkj"]);
    const items = paletteItems(fuzzy, "kg", []);
    expect(items.map((i) => (i.kind === "note" ? i.title : `+${i.title}`))).toEqual(["Peso em kg", "hgkjgkj", "+kg"]);
  });

  test("fuzzy (T2966): título exato, texto exato, título aproximado, texto aproximado", () => {
    const fuzzy = ["Ata", "Pauta", "Agenda da tarde", "Diário", "Notas"].map((t, i) => meta(`${t}.md`, `2026-11-0${i + 1}`));
    // "Ata" é exato no título; "Pauta" e "Agenda da tarde" casam "ata" só por subsequência.
    // "Agenda da tarde" ganha o início do título e o início de "tarde"; "Pauta", não.
    expect(titleMatches(fuzzy, "ata").map((n) => n.title)).toEqual(["Ata", "Agenda da tarde", "Pauta"]);
    const hits = [
      { path: "Diário.md", title: "Diário", snippet: "a ata saiu", score: 1 },
      // aproximado no título, mas exato no texto: sobe para o texto exato
      { path: "Pauta.md", title: "Pauta", snippet: "ler a ata", score: 1 },
      { path: "Notas.md", title: "Notas", snippet: "atas", score: 0.5, approx: true },
    ];
    const items = paletteItems(fuzzy, "ata", hits);
    expect(items.map((i) => (i.kind === "note" ? i.title : `+${i.title}`))).toEqual(["Ata", "Diário", "Pauta", "Agenda da tarde", "Notas"]);
    expect(items[2]).toMatchObject({ snippet: "ler a ata" });
  });

  test("o destaque (T2966): as palavras exatas, as letras da subsequência e o erro no trecho", () => {
    expect(titleRanges("Peso em kg", "kg")).toEqual([[8, 10]]);
    expect(titleRanges("hgkjgkj", "kg")).toEqual([
      [2, 3],
      [4, 5],
    ]);
    expect(titleRanges("Reunião", "tag:x reuniao")).toEqual([[0, 7]]);
    expect(snippetRanges("a reunião de terça", "reunaio")).toEqual([[2, 9]]);
  });
});

test("ranked palette preserves local title matches after engine hits", () => {
  const note = { path: "nOtEs99.md", title: "nOtEs99", folder: "", mtime: "2026-11-01", ctime: "2026-11-01", size: 0, version: "1", tags: [] };
  const hits = [{ path: "Other.md", title: "Other", score: 1, snippet: "nt99" }];
  expect(paletteItems([note], "nt99", hits, [], true).filter(item => item.kind === "note").map(item => item.path)).toEqual(["Other.md", "nOtEs99.md"]);
});

test("L16: completed engine ranking is retained by the palette, with inflected snippets highlighted", () => {
  const hits = [
    {path:'B.md',title:'Plano',score:9,snippet:'Organização das reuniões'},
    {path:'A.md',title:'Organizar',score:1,snippet:'Assunto'},
  ];
  expect(paletteItems([], 'organizar', hits, [], true).filter(i=>i.kind==='note').map(i=>i.path)).toEqual(['B.md','A.md']);
  expect(snippetRanges('Organização das reuniões', 'organizar reuniao')).toEqual([[0,11],[16,24]]);
});
