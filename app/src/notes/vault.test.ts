import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { DEFAULT_SETTINGS } from "../store/settings.ts";
import path from "node:path";

import { parseLinks, resolveLink, rewriteLinks } from "../shared/wikilinks.ts";
import { Vault, versionOf } from "./vault.ts";
import { tempDir } from "../../test/tmp.ts";

const dirs: string[] = [];
const vaults: Vault[] = [];
afterEach(() => {
  for (const v of vaults.splice(0)) v.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tmp(): string {
  const d = tempDir("kiwinotes-vault-test-");
  dirs.push(d);
  return d;
}

async function vault(files: Record<string, string> = {}, undoMs?: number) {
  const root = path.join(tmp(), "KiwiNotes");
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  }
  const trashed: string[] = [];
  const v = new Vault({
    root,
    debounceMs: 20,
    undoMs,
    trash: async (abs) => {
      trashed.push(path.relative(root, abs));
      rmSync(abs, { recursive: true });
    },
  });
  vaults.push(v);
  await v.open();
  return { v, root, trashed };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
};

async function waitFor<T>(probe: () => T | undefined | null | false, ms = 3000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = probe();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out");
    await Bun.sleep(10);
  }
}

describe("[[links]] com a regra do Obsidian (T1316)", () => {
  const paths = ["Projetos/Kiwi.md", "Kiwi.md", "Diário/2026-11-03.md", "Arquivo/Velho/Kiwi.md", "Ideias.md"];

  test("parse de fragmentos locais", () => {
    expect(parseLinks("[[#Título]] [[]] [[|alias]]")).toMatchObject([{ target: "", heading: "#Título" }]);
  });

  test("parse: alvo, seção, apelido e embed", () => {
    expect(parseLinks("ver [[Kiwi]], [[Projetos/Kiwi#Fase 1|a fase]] e ![[Ideias]]")).toMatchObject([
      { target: "Kiwi", heading: "", alias: "", embed: false },
      { target: "Projetos/Kiwi", heading: "#Fase 1", alias: "|a fase", embed: false },
      { target: "Ideias", embed: true },
    ]);
  });

  test("resolve: nome sem pasta, sem maiúscula nem acento; com dois iguais, o caminho mais curto", () => {
    expect(resolveLink("Kiwi", paths)).toBe("Kiwi.md");
    expect(resolveLink("kiwi", paths)).toBe("Kiwi.md");
    expect(resolveLink("ideias.md", paths)).toBe("Ideias.md");
    expect(resolveLink("diario/2026-11-03", paths)).toBe("Diário/2026-11-03.md");
    expect(resolveLink("Velho/Kiwi", paths)).toBe("Arquivo/Velho/Kiwi.md");
    expect(resolveLink("Projetos/Kiwi", paths)).toBe("Projetos/Kiwi.md");
    expect(resolveLink("Nada", paths)).toBeNull();
  });

  test("rewrite: troca só os links da nota renomeada, mantendo seção, apelido e embed", () => {
    const before = ["A.md", "Pasta/B.md", "C.md"];
    const after = ["A.md", "Pasta/Novo.md", "C.md"];
    const out = rewriteLinks("[[B]] [[Pasta/B#x|y]] ![[B]] [[C]] [[A]]", "Pasta/B.md", "Pasta/Novo.md", before, after);
    expect(out).toEqual({ content: "[[Novo]] [[Novo#x|y]] ![[Novo]] [[C]] [[A]]", count: 3 });
    // O nome novo fica ambíguo: vai o caminho.
    const amb = rewriteLinks("[[B]]", "Pasta/B.md", "Pasta/A.md", ["A.md", "Pasta/B.md"], ["A.md", "Pasta/A.md"]);
    expect(amb.content).toBe("[[Pasta/A]]");
  });
});

describe("Vault (T1316)", () => {
  test("lista pastas e notas, sem as pastas com ponto (.obsidian) e sem o que não é .md", async () => {
    const { v } = await vault({
      "Kiwi.md": "# Kiwi\n#projeto",
      "Projetos/Fase 1.md": "---\ntags: [kiwi, notas]\n---\ntexto",
      ".obsidian/workspace.md": "x",
      "imagem.png": "x",
    });
    const { folders, notes } = v.list();
    expect(folders).toEqual(["Projetos"]);
    expect(notes.map((n) => n.path)).toEqual(["Kiwi.md", "Projetos/Fase 1.md"]);
    expect(notes[1]).toMatchObject({ title: "Fase 1", folder: "Projetos", tags: ["kiwi", "notas"] });
    expect(notes[0]!.tags).toEqual(["projeto"]);
    expect(notes[0]!.version).toBe(versionOf("# Kiwi\n#projeto"));
  });

  test("get, create (nome repetido vira 'Título 2') e o arquivo fica byte a byte", async () => {
    const { v, root } = await vault({ "Ideias.md": "---\ntitle: X\n---\n[[Kiwi]] é *legal*\r\n" });
    expect((await v.get("Ideias.md")).content).toBe("---\ntitle: X\n---\n[[Kiwi]] é *legal*\r\n");
    const a = await v.create("Projetos", "Reunião: sexta?", "oi");
    expect(a.path).toBe("Projetos/Reunião sexta.md");
    const b = await v.create("Projetos", "Reunião: sexta?");
    expect(b.path).toBe("Projetos/Reunião sexta 2.md");
    expect(readFileSync(path.join(root, "Projetos/Reunião sexta.md"), "utf8")).toBe("oi");
    expect(await code(v.get("Nada.md"))).toBe("E_NOT_FOUND");
  });

  test("save com a versão certa salva; com a versão velha devolve a de agora e não escreve", async () => {
    const { v, root } = await vault({ "Nota.md": "um" });
    const note = await v.get("Nota.md");
    const ok = await v.save("Nota.md", "dois", note.version);
    expect(ok).toMatchObject({ saved: true, meta: { version: versionOf("dois") } });
    // Mudou fora (no Obsidian): o save com a versão antiga não sobrescreve.
    writeFileSync(path.join(root, "Nota.md"), "três, do Obsidian");
    const conflict = await v.save("Nota.md", "quatro", versionOf("dois"));
    expect(conflict).toMatchObject({ saved: false, current: { content: "três, do Obsidian", version: versionOf("três, do Obsidian") } });
    expect(readFileSync(path.join(root, "Nota.md"), "utf8")).toBe("três, do Obsidian");
  });

  test("rename move a nota e atualiza os [[links]] das outras", async () => {
    const { v, root } = await vault({
      "Kiwi.md": "a nota",
      "Diário.md": "hoje: [[Kiwi]] e [[Kiwi#Fase|fase]]",
      "Outra.md": "nada aqui",
    });
    const out = await v.rename("Kiwi.md", "Projetos/Kiwi Notes.md");
    expect(out).toMatchObject({ meta: { path: "Projetos/Kiwi Notes.md" }, updatedLinks: 2 });
    expect(existsSync(path.join(root, "Kiwi.md"))).toBe(false);
    expect(readFileSync(path.join(root, "Diário.md"), "utf8")).toBe("hoje: [[Kiwi Notes]] e [[Kiwi Notes#Fase|fase]]");
    expect(readFileSync(path.join(root, "Outra.md"), "utf8")).toBe("nada aqui");
    expect(await code(v.rename("Outra.md", "Diário.md"))).toBe("E_EXISTS");
  });

  // T7437: um [[link]] para um arquivo que está no cofre (pdf, quadro, draw.io), comum num vault do Obsidian. Ele não é
  // link quebrado, e seguir o link não cria uma nota vazia "relatorio.pdf.md" ao lado do pdf.
  test("[[arquivo.pdf]] que existe no cofre não é link quebrado nem vira nota nova", async () => {
    const { v, root } = await vault({
      "Docs/relatorio.pdf": "%PDF-1.4\n",
      "Mapa.canvas": '{"nodes":[],"edges":[]}',
      "F.md": "ver [[relatorio.pdf]], ![[relatorio.pdf]] e [[Mapa.canvas]]\n",
    });
    expect(await v.linkWarnings("F.md")).toEqual([]);
    await code(v.createFromLink("relatorio.pdf", "F.md"));
    expect(existsSync(path.join(root, "relatorio.pdf.md"))).toBe(false);
  });

  // T7436: `#`, `|`, `[`, `]` e `^` são sintaxe do [[link]]. Um nome com eles não pode virar links reescritos que não
  // acham mais a nota. Recusar o nome ou trocar o caractere resolve; o que não pode é dizer "atualizei" e quebrar.
  for (const name of ["Reunião #2", "Ana | Bia", "Plano [v2]"])
    test(`rename para "${name}" não quebra os links das outras notas`, async () => {
      const { v } = await vault({ "Reuniao.md": "# Reuniao\n\n## Pauta\n", "L.md": "veja [[Reuniao]] e [[Reuniao#Pauta]]" });
      const out = await v.rename("Reuniao.md", `${name}.md`).catch(() => null);
      const path_ = out?.meta.path ?? "Reuniao.md";
      expect((await v.backlinks(path_)).map((b) => b.path)).toEqual(["L.md"]);
      for (const link of parseLinks(readFileSync(path.join(v.root, "L.md"), "utf8"))) expect(v.resolve(link.target)).toBe(path_);
    });

  test("rename troca # ^ | [ ] por espaço, como o create; mover não troca o nome que a nota já tem (T7520)", async () => {
    const { v } = await vault({ "A.md": "a", "B.md": "b", "Pasta/C.md": "c", "Feita fora #1.md": "x", "L.md": "[[Feita fora #1]]" });
    expect((await v.rename("A.md", "Reunião #2.md")).meta.path).toBe("Reunião 2.md");
    expect((await v.rename("B.md", "Pasta/Ana | Bia [v2] ^3.md")).meta.path).toBe("Pasta/Ana Bia v2 3.md");
    // Só mudar a pasta: o nome fica, mesmo com `#`.
    expect((await v.moveNote("Feita fora #1.md", "Pasta")).meta.path).toBe("Pasta/Feita fora #1.md");
    expect(await code(v.rename("Pasta/C.md", "Pasta/#|^.md"))).toBe("E_BAD_ARGS");
    expect(existsSync(path.join(v.root, "Pasta/C.md"))).toBe(true);
  });

  // T7437: uma nota que não é UTF-8 (Latin-1, de um app antigo do Windows) volta do disco com U+FFFD no lugar dos
  // acentos. Gravar esse texto por cima apaga os acentos de vez. Como no files.save (T7105): os bytes não mudam.
  const latin = Buffer.from("# Reunião\n\nAção: ver [[Alvo]].\n", "latin1");
  test("rename não reescreve os links de uma nota que não é UTF-8; ela sai em skippedPaths", async () => {
    const { v, root } = await vault({ "Alvo.md": "# Alvo\n", "Latin.md": latin as unknown as string });
    const r = await v.rename("Alvo.md", "Alvo novo.md");
    expect(readFileSync(path.join(root, "Latin.md"))).toEqual(latin);
    expect(r.skippedPaths).toContain("Latin.md");
  });
  test("save não grava por cima de uma nota que não é UTF-8", async () => {
    const { v, root } = await vault({ "Latin.md": latin as unknown as string });
    const note = await v.get("Latin.md");
    await code(v.save("Latin.md", note.content + "mais uma linha\n", note.version));
    expect(readFileSync(path.join(root, "Latin.md"))).toEqual(latin);
  });
  test("a nota que não é UTF-8 volta com readOnly, e o save diz E_NOT_UTF8 (T7575)", async () => {
    const { v } = await vault({ "Latin.md": latin as unknown as string, "Boa.md": "Ação em UTF-8.\n" });
    const note = await v.get("Latin.md");
    expect(note.readOnly).toBe(true);
    expect((await v.get("Boa.md")).readOnly).toBeUndefined();
    expect(await code(v.save("Latin.md", "outro texto", note.version))).toBe("E_NOT_UTF8");
  });
  test("renomear a tag e mover a pasta pulam a nota que não é UTF-8; os bytes não mudam (T7575)", async () => {
    // A tag em ASCII: o acento lido de um Latin-1 vira U+FFFD, e a tag não casaria.
    const tagged = Buffer.from("Ação #projeto e [[Pasta/Alvo]].\n", "latin1");
    const { v, root } = await vault({ "Latin.md": tagged as unknown as string, "Boa.md": "#projeto\n", "Pasta/Alvo.md": "alvo" });
    const r = await v.renameTag("projeto", "plano");
    expect(r.skippedPaths).toContain("Latin.md");
    expect(readFileSync(path.join(root, "Boa.md"), "utf8")).toBe("#plano\n");
    await v.moveFolder("Pasta", "Outra");
    expect(existsSync(path.join(root, "Outra/Alvo.md"))).toBe(true);
    expect(readFileSync(path.join(root, "Latin.md"))).toEqual(tagged);
  });

  test("rename não apaga o que mudou fora e o índice ainda não viu (revisão #1397)", async () => {
    const { v, root } = await vault({ "A.md": "a", "B.md": "Veja [[A]].\n" });
    // Editada no Obsidian depois do open, antes do watcher (ou sem ele): o índice ainda tem a versão velha.
    writeFileSync(path.join(root, "B.md"), "Veja [[A]].\nUma linha nova escrita no Obsidian.\n");
    await v.rename("A.md", "C.md");
    expect(readFileSync(path.join(root, "B.md"), "utf8")).toBe("Veja [[C]].\nUma linha nova escrita no Obsidian.\n");
    // E uma nota que ganhou o link fora do app também é atualizada.
    writeFileSync(path.join(root, "D.md"), "nova, aponta para [[C]]");
    await v.rename("C.md", "E.md");
    expect(readFileSync(path.join(root, "D.md"), "utf8")).toBe("nova, aponta para [[E]]");
  });

  test("save não sobrescreve uma edição de fora que chega entre a leitura e a escrita (#1397)", async () => {
    const { v, root } = await vault({ "N.md": "um" });
    const base = (await v.get("N.md")).version;
    // Simula o Obsidian salvando bem no meio: a escrita confere a versão de novo, logo antes de trocar o arquivo.
    const original = (v as unknown as { beforeReplace?: () => void }).beforeReplace;
    (v as unknown as { beforeReplace: () => void }).beforeReplace = () => writeFileSync(path.join(root, "N.md"), "do Obsidian");
    const out = await v.save("N.md", "meu", base);
    (v as unknown as { beforeReplace?: () => void }).beforeReplace = original;
    expect(out).toMatchObject({ saved: false, current: { content: "do Obsidian" } });
    expect(readFileSync(path.join(root, "N.md"), "utf8")).toBe("do Obsidian");
  });

  test("delete manda para a Lixeira (não apaga direto), depois do tempo do Desfazer (T2468)", async () => {
    const { v, root, trashed } = await vault({ "Velha.md": "x" }, 40);
    expect(await v.delete("Velha.md")).toBe(true);
    expect(v.list().notes).toEqual([]);
    expect(existsSync(path.join(root, "Velha.md"))).toBe(false);
    expect(await code(v.delete("Velha.md"))).toBe("E_NOT_FOUND");
    expect(trashed).toEqual([]); // ainda dá para desfazer
    await Bun.sleep(120);
    expect(trashed).toHaveLength(1);
    expect(trashed[0]).toMatch(/^\.kiwi-trash\/[^/]+\/Velha\.md$/);
    expect(existsSync(path.join(root, ".kiwi-trash"))).toBe(true); // a pasta fica, vazia
  });

  // T7441: a busca longa demais diz o motivo. Antes vinha "query must be a string", que não ajuda quem colou um texto.
  test("search: mais de 500 caracteres dá E_BAD_ARGS que fala do tamanho", async () => {
    const { v } = await vault({ "A.md": "a" });
    let err: { code?: string; message?: string } = {};
    try {
      v.search("x".repeat(501));
    } catch (e) {
      err = e as typeof err;
    }
    expect(err.code).toBe("E_BAD_ARGS");
    expect(err.message).toMatch(/500/);
  });

  test("search: título vale mais, sem acento nem maiúscula, com o trecho; backlinks e resolve", async () => {
    const { v } = await vault({
      "Reunião.md": "pauta da semana",
      "Diário.md": "hoje teve reuniao com o time, ver [[Reunião]]",
      "Compras.md": "pão",
    });
    const hits = v.search("REUNIÃO");
    expect(hits.map((h) => h.path)).toEqual(["Reunião.md", "Diário.md"]);
    expect(hits[1]!.snippet).toContain("reuniao com o time");
    expect(v.search("reuniao time").map((h) => h.path)).toEqual(["Diário.md"]);
    expect(v.search("")).toEqual([]);
    expect(v.backlinks("Reunião.md")).toEqual([{ path: "Diário.md", title: "Diário", context: "hoje teve reuniao com o time, ver [[Reunião]]" }]);
    expect(v.resolve("reuniao")).toBe("Reunião.md");
    expect(v.resolve("[[Compras|lista]]")).toBe("Compras.md");
    expect(v.resolve("Nada")).toBeNull();
  });

  test("search fuzzy (T2966): erro de digitação no texto, o exato antes, e os filtros exatos", async () => {
    const { v } = await vault({
      "Ata.md": "A reunião de terça foi longa.",
      "Pauta.md": "reuniao marcada para amanhã",
      "Compras.md": "pão, café, 2026",
      "Projetos/Plano.md": "---\ntags: [kiwi]\n---\nO projeto da reunião.",
      "Velho.md": "#velho uma reunião antiga",
    });
    // "reuniao" (sem acento) é exato; "reunaio" (letras trocadas) acha pelo erro, com o trecho na palavra que casou.
    expect(v.search("reuniao").every((h) => !h.approx)).toBe(true);
    const typo = v.search("reunaio");
    expect(typo.map((h) => h.path).sort()).toEqual(["Ata.md", "Pauta.md", "Projetos/Plano.md", "Velho.md"]);
    expect(typo.every((h) => h.approx)).toBe(true);
    expect(typo.find((h) => h.path === "Ata.md")!.snippet).toContain("reunião de terça");
    // Duas palavras: "projeto" exata e "reunaio" aproximada. E o exato vem antes do aproximado.
    expect(v.search("projeto reunaio").map((h) => [h.path, !!h.approx])).toEqual([["Projetos/Plano.md", true]]);
    const mixed = [...v.search("marcada"), ...v.search("marcdaa")];
    expect(mixed.map((h) => [h.path, !!h.approx])).toEqual([
      ["Pauta.md", false],
      ["Pauta.md", true],
    ]);
    // Palavra curta e número não aceitam erro.
    expect(v.search("pai")).toEqual([]);
    expect(v.search("2025")).toEqual([]);
    // Os filtros continuam exatos: a "frase", o tag:, o path: e o "-".
    expect(v.search('"reunaio"')).toEqual([]);
    expect(v.search("reunaio tag:kiwi").map((h) => h.path)).toEqual(["Projetos/Plano.md"]);
    expect(v.search("reunaio tag:kiwii")).toEqual([]);
    expect(v.search("reunaio path:projetos").map((h) => h.path)).toEqual(["Projetos/Plano.md"]);
    expect(v.search("reunaio path:projetoss")).toEqual([]);
    expect(v.search("reunaio -tag:velho -terca -marcada").map((h) => h.path)).toEqual(["Projetos/Plano.md"]);
    expect(v.search("reunaio -terxa").map((h) => h.path)).toContain("Ata.md");
  });

  test("nada sai do vault: .., absoluto, link simbólico, pasta com ponto", async () => {
    const { v, root } = await vault({ "A.md": "a" });
    const outside = tmp();
    writeFileSync(path.join(outside, "segredo.md"), "não");
    symlinkSync(outside, path.join(root, "atalho"));
    for (const bad of ["../segredo.md", "/etc/passwd.md", "~/x.md", "atalho/segredo.md", ".obsidian/x.md", "a/./b.md", "a//b.md", "pasta\\x.md"]) {
      expect(await code(v.get(bad))).toBe("E_OUTSIDE_VAULT");
    }
    for (const bad of ["A", "A.txt", "", 42, null]) expect(await code(v.get(bad))).toBe("E_BAD_ARGS");
    expect(await code(v.create("../fora", "x"))).toBe("E_OUTSIDE_VAULT");
    expect(await code(v.rename("A.md", "../A.md"))).toBe("E_OUTSIDE_VAULT");
    expect(await code(v.save("atalho/segredo.md", "x", "v"))).toBe("E_OUTSIDE_VAULT");
    // O link simbólico não entra na lista nem na busca.
    expect(v.list().notes.map((n) => n.path)).toEqual(["A.md"]);
    expect(readFileSync(path.join(outside, "segredo.md"), "utf8")).toBe("não");
  });

  test("o watcher pega o que muda fora do app e avisa", async () => {
    const { v, root } = await vault({ "Nota.md": "um" });
    const seen: string[][] = [];
    v.onChanged((p) => void seen.push(p));
    v.watch();
    await Bun.sleep(50);
    writeFileSync(path.join(root, "Nota.md"), "editada no Obsidian");
    writeFileSync(path.join(root, "Nova.md"), "criada fora");
    await waitFor(() => v.list().notes.length === 2 && v.search("Obsidian").length === 1);
    rmSync(path.join(root, "Nova.md"));
    await waitFor(() => v.list().notes.length === 1);
    expect(seen.flat()).toEqual(expect.arrayContaining(["Nota.md", "Nova.md"]));
  });

  test("1.000 notas: a busca monta o trecho só dos 20 que voltam, e fica dentro da meta", async () => {
    const files: Record<string, string> = {};
    const words = "kiwi nota reunião projeto ditado vault obsidian markdown índice busca semana time pauta ideia".split(" ");
    for (let i = 0; i < 1000; i++) {
      const body = Array.from({ length: 200 }, (_, k) => words[(i * 7 + k * 3) % words.length]).join(" ");
      files[`Pasta ${i % 20}/Nota ${i}.md`] = `---\ntags: [t${i % 10}]\n---\n# Nota ${i}\n${body}\n[[Nota ${(i + 1) % 1000}]]`;
    }
    const { v } = await vault(files);
    expect(v.list().notes.length).toBe(1000);
    const built = v.snippetsBuilt;
    const t0 = performance.now();
    const hits = v.search("reunião projeto", 20);
    const ms = performance.now() - t0;
    expect(hits.length).toBe(20);
    // A guarda sem relógio (T8236): montar o trecho de cada nota que casa (mil, aqui) custava 288 ms. Só os 20 que voltam.
    expect(v.snippetsBuilt - built).toBe(20);
    // O tempo vai para o log, com um teto de 10× a meta de ~200 ms: um engasgo do runner não derruba o CI.
    console.log(`[vault.test] busca em 1.000 notas: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(2000);
    expect(v.backlinks("Pasta 1/Nota 1.md").map((b) => b.path)).toEqual(["Pasta 0/Nota 0.md"]);
  });
});

describe("as capacidades notes.* pelo contrato 1.1.0 (T1316)", () => {
  test("validação, códigos de erro e o conflito do save chegam à UI como estão", async () => {
    const { uiCapabilities } = await import("../bun/ui-capabilities.ts");
    const { directInvoke } = await import("../bun/ui-engine.ts");
    const { UI_CONTRACT_VERSION, UI_CAPABILITIES } = await import("../shared/ui-contract.ts");
    const { v, root } = await vault({ "Kiwi.md": "oi [[Ideias]]", "Ideias.md": "x" });
    const caps = uiCapabilities({
      dictionary: { load: async () => [], save: async (t) => t },
      snippets: { load: async () => [], save: async (s) => s },
      history: { search: async () => ({ entries: [] }), delete: async () => true, get: async () => null },
      dictationNotes: { toNew: async () => { throw new Error("not used") }, append: async () => { throw new Error("not used") } },
      settings: { load: async () => ({ ...DEFAULT_SETTINGS, notesShortcut: null }), save: async () => ({ ...DEFAULT_SETTINGS, notesShortcut: null }) },
      clipboardWrite: () => {},
      notes: v,
    });
    const call = (cap: string, args: unknown) => directInvoke(caps, cap, args);

    expect(UI_CONTRACT_VERSION).toBe("1.59.0");
    expect(UI_CAPABILITIES).toContain("notes.resolve");
    expect(await call("notes.list", {})).toMatchObject({ ok: true, value: { notes: [{ path: "Ideias.md" }, { path: "Kiwi.md" }] } });
    expect(await call("notes.list", { folder: "x" })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(await call("notes.get", { path: "../fora.md" })).toMatchObject({ ok: false, code: "E_OUTSIDE_VAULT" });
    expect(await call("notes.get", { path: "Nada.md" })).toMatchObject({ ok: false, code: "E_NOT_FOUND" });
    expect(await call("notes.get", { path: "Kiwi.md", pth: "x" })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(await call("notes.search", { query: "oi", limit: 0 })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(await call("notes.resolve", { link: "ideias" })).toEqual({ ok: true, value: "Ideias.md" });
    expect(await call("notes.backlinks", { path: "Ideias.md" })).toMatchObject({ ok: true, value: [{ path: "Kiwi.md" }] });

    const note = await call("notes.get", { path: "Kiwi.md" });
    const version = (note as { value: { version: string } }).value.version;
    writeFileSync(path.join(root, "Kiwi.md"), "mudou fora");
    expect(await call("notes.save", { path: "Kiwi.md", content: "meu texto", baseVersion: version })).toMatchObject({
      ok: true,
      value: { saved: false, current: { content: "mudou fora" } },
    });
    // O apagar conferido (1.45.0): a versão velha não apaga; a de agora, sim.
    expect(await call("notes.delete", { path: "Kiwi.md", baseVersion: version })).toMatchObject({ ok: false, code: "E_CONFLICT" });
    expect(await call("notes.delete", { path: "Kiwi.md", baseVersion: 7 })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(readFileSync(path.join(root, "Kiwi.md"), "utf8")).toBe("mudou fora");
    const now = (await call("notes.get", { path: "Kiwi.md" })) as { value: { version: string } };
    expect(await call("notes.delete", { path: "Kiwi.md", baseVersion: now.value.version })).toEqual({ ok: true, value: true });
    expect(await call("notes.restore", { path: "Kiwi.md" })).toMatchObject({ ok: true });
    expect(await call("notes.create", { title: "Kiwi" })).toMatchObject({ ok: true, value: { path: "Kiwi 2.md" } });
    expect(await call("notes.rename", { path: "Ideias.md", newPath: "Kiwi.md" })).toMatchObject({ ok: false, code: "E_EXISTS" });
    expect(await call("notes.renameTag", { from: "old", to: "new", extra: true })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(await call("notes.linkWarnings", { path: "../fora.md" })).toMatchObject({ ok: false, code: "E_OUTSIDE_VAULT" });
    const e11 = await v.create(undefined, "Refactor", "# Antigo\n#old\n[[#Antigo]] [[Sumiu]]");
    expect(await call("notes.renameHeading", { path: e11.path, offset: 0, title: "Novo", baseVersion: e11.version })).toMatchObject({ ok: true, value: { updatedNotes: 1, updatedReferences: 1 } });
    expect(await call("notes.renameTag", { from: "old", to: "new" })).toMatchObject({ ok: true, value: { updatedNotes: 1, updatedReferences: 1 } });
    expect(await call("notes.linkWarnings", { path: e11.path })).toMatchObject({ ok: true, value: { warnings: [{ target: "Sumiu", reason: "note" }] } });
  });
});
