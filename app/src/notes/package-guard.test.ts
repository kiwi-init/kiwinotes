// Nota, arquivo e pasta não entram num pacote (T20554, depois do T20517): o que está dentro de um `.key` ou `.pages` é
// do app dono dele. Tudo inventado, num tmp.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Vault } from "./vault.ts";
import { tempDir } from "../../test/tmp.ts";

const dirs: string[] = [];
const vaults: Vault[] = [];
afterEach(() => {
  for (const v of vaults.splice(0)) v.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function setup() {
  const dir = tempDir("kiwinotes-pkg-guard-");
  dirs.push(dir);
  const root = path.join(dir, "Cofre");
  const files: Record<string, string> = {
    "docs/Plano.key/Index.zip": "z",
    "docs/Ideia.md": "# Ideia\n",
    "Rascunhos/Lista.md": "# Lista\n",
  };
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  }
  const v = new Vault({ root });
  vaults.push(v);
  await v.open();
  return { v, root };
}

const pkgItems = (root: string) => readdirSync(path.join(root, "docs/Plano.key")).sort();
const bad = { code: "E_BAD_ARGS" };

describe("nada entra num pacote (T20554)", () => {
  test("mover nota para dentro do pacote: recusado, e a nota fica onde estava", async () => {
    const { v, root } = await setup();
    await expect(v.moveNote("docs/Ideia.md", "docs/Plano.key")).rejects.toMatchObject(bad);
    await expect(v.rename("docs/Ideia.md", "docs/Plano.key/Data/Ideia.md")).rejects.toMatchObject(bad);
    expect(existsSync(path.join(root, "docs/Ideia.md"))).toBe(true);
    expect(pkgItems(root)).toEqual(["Index.zip"]);
    expect(v.list().files?.map((f) => f.path)).toEqual(["docs/Plano.key"]);
    expect(v.list().folders).not.toContain("docs/Plano.key");
  });

  test("criar nota ou arquivo dentro do pacote: recusado", async () => {
    const { v, root } = await setup();
    await expect(v.create("docs/Plano.key", "Nova")).rejects.toMatchObject(bad);
    await expect(v.createFile("docs/Plano.key/Data", "tabela.csv", new Uint8Array([49]))).rejects.toMatchObject(bad);
    expect(pkgItems(root)).toEqual(["Index.zip"]);
  });

  test("criar pasta dentro do pacote ou mover uma pasta para lá: recusado", async () => {
    const { v, root } = await setup();
    await expect(v.createFolder("docs/Plano.key/Nova")).rejects.toMatchObject(bad);
    await expect(v.moveFolder("Rascunhos", "docs/Plano.key/Rascunhos")).rejects.toMatchObject(bad);
    expect(existsSync(path.join(root, "Rascunhos/Lista.md"))).toBe(true);
    expect(pkgItems(root)).toEqual(["Index.zip"]);
  });

  test("criar quadro dentro do pacote ou mover um para lá: recusado (rodada 2)", async () => {
    const { v, root } = await setup();
    await expect(v.createCanvas("docs/Plano.key", "Quadro")).rejects.toMatchObject(bad);
    const q = await v.createCanvas("docs", "Quadro");
    await expect(v.renameCanvas(q.path, "docs/Plano.key/Quadro.canvas")).rejects.toMatchObject(bad);
    expect(existsSync(path.join(root, "docs/Quadro.canvas"))).toBe(true);
    expect(pkgItems(root)).toEqual(["Index.zip"]);
  });

  test("um pacote criado por fora agora há pouco, que o índice ainda não viu, também conta", async () => {
    const { v, root } = await setup();
    mkdirSync(path.join(root, "docs/Novo.pages/Index"), { recursive: true });
    writeFileSync(path.join(root, "docs/Novo.pages/Index/Document.iwa"), "x");
    await expect(v.moveNote("docs/Ideia.md", "docs/Novo.pages")).rejects.toMatchObject(bad);
    await expect(v.createFolder("docs/Novo.pages/Nova")).rejects.toMatchObject(bad);
    expect(readdirSync(path.join(root, "docs/Novo.pages")).sort()).toEqual(["Index"]);
  });

  test("uma pasta com nome de pacote mas com nota dentro é pasta: vale", async () => {
    const { v, root } = await setup();
    mkdirSync(path.join(root, "docs/Pasta.key"));
    writeFileSync(path.join(root, "docs/Pasta.key/nota.md"), "# Nota\n");
    writeFileSync(path.join(root, "docs/Pasta.key/Index.zip"), "z");
    await v.moveNote("docs/Ideia.md", "docs/Pasta.key");
    expect(existsSync(path.join(root, "docs/Pasta.key/Ideia.md"))).toBe(true);
  });

  test("ao lado do pacote, tudo continua valendo", async () => {
    const { v, root } = await setup();
    await v.moveNote("Rascunhos/Lista.md", "docs");
    await v.create("docs", "Nova");
    await v.createFile("docs", "tabela.csv", new Uint8Array([49]));
    await v.createFolder("docs/Plano");
    expect(readdirSync(path.join(root, "docs")).sort()).toEqual(["Ideia.md", "Lista.md", "Nova.md", "Plano", "Plano.key", "tabela.csv"]);
  });
});
