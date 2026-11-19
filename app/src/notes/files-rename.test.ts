// O menu da árvore nos arquivos que não são nota (T19878, spec #19256): renomear e mover um pdf, csv ou .py com os
// links das notas atrás dele, apagar com o Desfazer, e o "Mostrar no Finder". Tudo num cofre de mentira, num tmp.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { rewriteFileReferences } from "./refactor.ts";
import { Vault } from "./vault.ts";
import { makeFileResolver } from "../shared/wikilinks.ts";
import { tempDir } from "../../test/tmp.ts";

const dirs: string[] = [];
const vaults: Vault[] = [];
afterEach(() => {
  for (const v of vaults.splice(0)) v.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function vault(files: Record<string, string | Buffer>) {
  const dir = tempDir("kiwinotes-files-rename-");
  dirs.push(dir);
  const root = path.join(dir, "Cofre");
  mkdirSync(root, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  }
  const v = new Vault({ root, debounceMs: 20, trash: async (abs) => rmSync(abs, { recursive: true }) });
  vaults.push(v);
  await v.open();
  return { v, root, read: (rel: string) => readFileSync(path.join(root, rel), "utf8") };
}

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: { code?: string }) => e.code);

describe("rewriteFileReferences", () => {
  const before = makeFileResolver(["docs/exemplo.pdf", "Anexos/foto.png"]);
  const after = makeFileResolver(["docs/Relatório.pdf", "Anexos/foto.png"]);
  const run = (text: string, source = "Projetos/Plano.md") => rewriteFileReferences(text, source, "docs/exemplo.pdf", "docs/Relatório.pdf", before, after);

  test("[[…]] e ![[…]]: o nome novo, com a página e o apelido", () => {
    const r = run("Ver [[exemplo.pdf]], ![[exemplo.pdf#page=2]] e [[docs/exemplo.pdf|o relatório]].");
    expect(r.content).toBe("Ver [[Relatório.pdf]], ![[Relatório.pdf#page=2]] e [[Relatório.pdf|o relatório]].");
    expect(r.count).toBe(3);
  });

  test("[texto](caminho) relativo e da raiz, codificado como no renomear de nota", () => {
    const r = run("[pdf](../docs/exemplo.pdf) e [raiz](/docs/exemplo.pdf) e [outro](../Anexos/foto.png)");
    expect(r.content).toBe("[pdf](../docs/Relat%C3%B3rio.pdf) e [raiz](/docs/Relat%C3%B3rio.pdf) e [outro](../Anexos/foto.png)");
    expect(r.count).toBe(2);
  });

  test("código, um link para outro arquivo e uma nota de mesmo nome ficam", () => {
    const text = "`[[exemplo.pdf]]`\n\n```\n[x](../docs/exemplo.pdf)\n```\n\n[[exemplo]] [[outro.pdf]]\n";
    expect(run(text)).toEqual({ content: text, count: 0 });
  });

  test("o frontmatter também", () => {
    const r = run('---\nanexo: "[[exemplo.pdf]]"\n---\nTexto.\n');
    expect(r.content).toBe('---\nanexo: "[[Relatório.pdf]]"\n---\nTexto.\n');
  });
});

describe("Vault.renameFile", () => {
  test("renomeia um pdf e as notas que apontam para ele seguem", async () => {
    const { v, root, read } = await vault({
      "docs/exemplo.pdf": "%PDF-1.4 exemplo",
      "Plano.md": "# Plano\n\n![[exemplo.pdf]] e [o pdf](docs/exemplo.pdf).\n",
      "Outra.md": "# Outra\n\nNada a ver.\n",
    });
    const r = await v.renameFile("docs/exemplo.pdf", "docs/Relatório.pdf");
    expect(r).toEqual({ path: "docs/Relatório.pdf", updatedLinks: 2, skippedPaths: [] });
    expect(existsSync(path.join(root, "docs/exemplo.pdf"))).toBe(false);
    expect(read("docs/Relatório.pdf")).toBe("%PDF-1.4 exemplo");
    expect(read("Plano.md")).toBe("# Plano\n\n![[Relatório.pdf]] e [o pdf](docs/Relat%C3%B3rio.pdf).\n");
    expect(read("Outra.md")).toBe("# Outra\n\nNada a ver.\n");
    expect(v.list().files?.map((f) => f.path)).toEqual(["docs/Relatório.pdf"]);
  });

  test("move um csv para outra pasta: o [[nome]] continua achando, o [texto](caminho) muda", async () => {
    const { v, read } = await vault({
      "dados.csv": "a,b\n1,2\n",
      "Projetos/Plano.md": "# Plano\n\n[[dados.csv]] e [tabela](../dados.csv).\n",
      "Arquivo/.keep": "",
    });
    const r = await v.renameFile("dados.csv", "Arquivo/dados.csv");
    expect(r.updatedLinks).toBe(1);
    expect(read("Projetos/Plano.md")).toBe("# Plano\n\n[[dados.csv]] e [tabela](../Arquivo/dados.csv).\n");
  });

  test("com outro de mesmo nome, o [[…]] ganha o caminho", async () => {
    const { v, read } = await vault({
      "a/script.py": "print(1)\n",
      "b/script.py": "print(2)\n",
      "Nota.md": "[[a/script.py]]\n",
    });
    await v.renameFile("a/script.py", "c/script.py");
    expect(read("Nota.md")).toBe("[[c/script.py]]\n");
  });

  test("a extensão fica, nada vai por cima, e nota não passa por aqui", async () => {
    const { v } = await vault({ "x.pdf": "1", "y.pdf": "2", "N.md": "" });
    expect(await code(v.renameFile("x.pdf", "x.txt"))).toBe("E_BAD_ARGS");
    expect(await code(v.renameFile("x.pdf", "y.pdf"))).toBe("E_EXISTS");
    expect(await code(v.renameFile("N.md", "M.md"))).toBe("E_BAD_ARGS");
    expect(await code(v.renameFile("nada.pdf", "z.pdf"))).toBe("E_NOT_FOUND");
    expect(await code(v.renameFile("x.pdf", "../fora.pdf"))).not.toBe("ok");
  });

  test("só a maiúscula muda", async () => {
    const { v, root } = await vault({ "relatorio.pdf": "1", "N.md": "[[relatorio.pdf]]\n" });
    await v.renameFile("relatorio.pdf", "Relatorio.pdf");
    expect(existsSync(path.join(root, "Relatorio.pdf"))).toBe(true);
    expect(v.list().files?.map((f) => f.path)).toEqual(["Relatorio.pdf"]);
  });
});

describe("apagar e mostrar um arquivo", () => {
  test("o Apagar sem versão, e o Desfazer devolve", async () => {
    const { v, root } = await vault({ "docs/exemplo.pdf": "%PDF" });
    expect(await v.deleteFile("docs/exemplo.pdf")).toBe(true);
    expect(existsSync(path.join(root, "docs/exemplo.pdf"))).toBe(false);
    expect(v.list().files ?? []).toEqual([]);
    expect(await v.restore("docs/exemplo.pdf")).toEqual({ path: "docs/exemplo.pdf" });
    expect(readFileSync(path.join(root, "docs/exemplo.pdf"), "utf8")).toBe("%PDF");
    expect(v.list().files?.map((f) => f.path)).toEqual(["docs/exemplo.pdf"]);
  });

  // O Desfazer sem o scan inteiro (T20166): o arquivo volta para a lista de arquivos, nunca para a das notas.
  test("o Desfazer de um arquivo não vira nota", async () => {
    const { v } = await vault({ "docs/exemplo.pdf": "%PDF", "Nota.md": "# Nota\n" });
    expect(await v.deleteFile("docs/exemplo.pdf")).toBe(true);
    await v.restore("docs/exemplo.pdf");
    expect(v.list().files?.map((f) => f.path)).toEqual(["docs/exemplo.pdf"]);
    expect(v.list().notes.map((n) => n.path)).toEqual(["Nota.md"]);
    expect(v.list().folders).toEqual(["docs"]);
  });

  test("um PDF de vários MB volta com os mesmos bytes", async () => {
    const big = Buffer.alloc(6 * 1024 * 1024);
    for (let i = 0; i < big.length; i++) big[i] = (i * 31 + (i >> 11)) & 0xff;
    const { v, root } = await vault({ "docs/grande.pdf": big });
    expect(await v.deleteFile("docs/grande.pdf")).toBe(true);
    expect(existsSync(path.join(root, "docs/grande.pdf"))).toBe(false);
    await v.restore("docs/grande.pdf");
    expect(readFileSync(path.join(root, "docs/grande.pdf")).equals(big)).toBe(true);
  });

  test("o Mostrar no Finder acha o arquivo", async () => {
    const { v, root } = await vault({ "docs/exemplo.pdf": "%PDF" });
    expect(await v.locate("docs/exemplo.pdf")).toBe(path.join(root, "docs/exemplo.pdf"));
  });
});

describe("o menu da árvore num pacote (.pages) (T20402)", () => {
  const pkg = { "Nota.md": "Ver [[Relatório.pages]].\n", "Relatório.pages/Index.zip": "zip", "Relatório.pages/Data/foto.png": "png" };

  test("apagar o pacote vai para a Lixeira, e o desfazer traz ele de volta", async () => {
    const { v, root } = await vault(pkg);
    // Sem scan: quem põe o pacote de volta na lista é o ramo de pacote do `restore` (o `isDirectory()`).
    const inner = v as unknown as { scan(o?: unknown): Promise<void> };
    const scan = inner.scan.bind(v);
    let scans = 0;
    inner.scan = (o?: unknown) => (scans++, scan(o));
    await v.deleteFile("Relatório.pages");
    expect(existsSync(path.join(root, "Relatório.pages"))).toBe(false);
    expect((v.list().files ?? []).map((f) => f.path)).not.toContain("Relatório.pages");
    await v.restore("Relatório.pages");
    expect(readFileSync(path.join(root, "Relatório.pages/Data/foto.png"), "utf8")).toBe("png");
    expect((v.list().files ?? []).map((f) => f.path)).toContain("Relatório.pages");
    expect(v.list().folders).not.toContain("Relatório.pages");
    expect(scans).toBe(0);
    // Volta como pacote, não como pasta: dá para apagar de novo pelo menu.
    await v.deleteFile("Relatório.pages");
    expect(existsSync(path.join(root, "Relatório.pages"))).toBe(false);
  });

  test("renomear e mover o pacote, com o link da nota atrás", async () => {
    const { v, root, read } = await vault(pkg);
    const r = await v.renameFile("Relatório.pages", "Arquivo/Relatório final.pages");
    expect(r.updatedLinks).toBe(1);
    expect(existsSync(path.join(root, "Arquivo/Relatório final.pages/Index.zip"))).toBe(true);
    expect(read("Nota.md")).toBe("Ver [[Relatório final.pages]].\n");
    expect((v.list().files ?? []).map((f) => f.path)).toContain("Arquivo/Relatório final.pages");
  });

  test("o que está dentro do pacote continua de fora do menu", async () => {
    const { v } = await vault(pkg);
    expect(await code(v.deleteFile("Relatório.pages/Index.zip"))).toBe("E_NOT_FOUND");
    expect(await code(v.renameFile("Relatório.pages/Index.zip", "Index.zip"))).toBe("E_NOT_FOUND");
    // Com `baseVersion`, o desfazer do agente: só arquivo comum.
    expect(await code(v.deleteFile("Relatório.pages", "x"))).toBe("E_NOT_FOUND");
  });
});

describe("mover um arquivo para uma pasta que ainda não existe (T20516)", () => {
  test("a pasta nova, e as de cima dela, entram na lista na hora, como num cofre aberto do zero", async () => {
    const { v, root } = await vault({ "docs/exemplo.pdf": "pdf", "docs/dados.csv": "a\n" });
    const changed: string[][] = [];
    v.onChanged((p) => changed.push(p));
    await v.renameFile("docs/exemplo.pdf", "Nova/Funda/exemplo.pdf");
    await v.renameFile("docs/dados.csv", "Outra/dados.csv");
    for (const f of ["Nova", "Nova/Funda", "Outra"]) expect(v.folderList()).toContain(f);
    // A árvore fica sabendo pelo aviso, como no criar pasta.
    expect(changed.flat()).toEqual(expect.arrayContaining(["Nova/Funda", "Nova", "Outra"]));
    expect([...v.list().folders].sort()).toEqual(["Nova", "Nova/Funda", "Outra", "docs"]);
    const fresh = new Vault({ root });
    vaults.push(fresh);
    await fresh.open();
    expect([...v.list().folders].sort()).toEqual([...fresh.list().folders].sort());
  });
});

describe("um arquivo não entra num pacote (T20517)", () => {
  test("mover um arquivo para dentro de um .key é recusado, e nada muda", async () => {
    const { v, root } = await vault({ "docs/exemplo.pdf": "pdf", "docs/Plano.key/Index.zip": "zip" });
    expect(await code(v.renameFile("docs/exemplo.pdf", "docs/Plano.key/exemplo.pdf"))).toBe("E_BAD_ARGS");
    expect(await code(v.renameFile("docs/exemplo.pdf", "docs/Plano.key/Data/exemplo.pdf"))).toBe("E_BAD_ARGS");
    expect(existsSync(path.join(root, "docs/exemplo.pdf"))).toBe(true);
    expect(existsSync(path.join(root, "docs/Plano.key/Data"))).toBe(false);
    expect((v.list().files ?? []).map((f) => f.path).sort()).toEqual(["docs/Plano.key", "docs/exemplo.pdf"]);
  });
});
