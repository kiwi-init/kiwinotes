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
