// O scan mais barato, o eco das pastas e as notas sem a lista inteira (T20227, spec #20118: E3, E0b e E4). Tudo
// inventado, num tmp.

import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { type IndexProgress, Vault } from "./vault.ts";
import { tempDir } from "../../test/tmp.ts";

const dirs: string[] = [];
const vaults: Vault[] = [];
afterEach(() => {
  for (const v of vaults.splice(0)) v.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function vaultDir(files: Record<string, string>) {
  const dir = tempDir("kiwinotes-scan-cheap-");
  dirs.push(dir);
  const root = path.join(dir, "Cofre");
  mkdirSync(root, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  }
  return root;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("o scan em paralelo (E3)", () => {
  test("uma árvore funda e larga entra inteira: cada nota, pasta, arquivo e pacote", async () => {
    const files: Record<string, string> = {};
    // 40 níveis numa linha só (mais fundo que as vagas em paralelo) e 60 pastas lado a lado.
    let deep = "Fundo";
    for (let i = 0; i < 40; i++) deep += `/n${i}`;
    files[`${deep}/Lá embaixo.md`] = "# Lá embaixo\n";
    for (let i = 0; i < 60; i++) {
      files[`Larga/p${i}/Nota ${i}.md`] = `# Nota ${i}\n[[Nota ${(i + 1) % 60}]]\n`;
      files[`Larga/p${i}/dados.csv`] = "a\n";
    }
    files["Larga/p3/Relatório.pages/Index/Document.iwa"] = "x";
    const root = vaultDir(files);
    const v = new Vault({ root });
    vaults.push(v);
    await v.open();
    const l = v.list();
    expect(l.notes.map((n) => n.path)).toContain(`${deep}/Lá embaixo.md`);
    expect(l.notes.length).toBe(61);
    expect(l.folders).toContain(deep);
    expect(l.folders.length).toBe(1 + 40 + 1 + 60);
    expect((l.files ?? []).length).toBe(61);
    expect(l.folders).not.toContain("Larga/p3/Relatório.pages");
    expect(v.resolve("Nota 0")).toBe("Larga/p0/Nota 0.md");
  });

  test("a raiz que não se lê ainda falha com o strictRoot", async () => {
    const root = vaultDir({ "Nota.md": "# Nota\n" });
    chmodSync(root, 0o000);
    try {
      const v = new Vault({ root, strictRoot: true });
      vaults.push(v);
      await expect(v.open()).rejects.toThrow("Não foi possível ler a pasta");
    } finally {
      chmodSync(root, 0o755);
    }
  });

  test("a barra de progresso anda por tempo e termina com tudo contado", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 300; i++) files[`P${i % 30}/Nota ${i}.md`] = `# Nota ${i}\n`;
    const root = vaultDir(files);
    const progress: IndexProgress[] = [];
    const v = new Vault({ root, onIndexProgress: (p) => progress.push(p) });
    vaults.push(v);
    await v.open();
    expect(progress[0]).toEqual({ seen: 0, notes: 0, done: false });
    expect(progress.at(-1)).toEqual({ seen: 300, notes: 300, done: true });
  });
});

describe("o eco das pastas (E0b)", () => {
  async function watched() {
    const root = vaultDir({ "Projetos/Plano.md": "# Plano\n", "Projetos/Velhos/Lista.md": "# Lista\n", "Projetos/dados.csv": "a\n" });
    const v = new Vault({ root, trash: async (abs) => rmSync(abs, { recursive: true, force: true }), debounceMs: 30, reconcileMs: 60_000 });
    vaults.push(v);
    await v.open();
    v.watch();
    await sleep(200);
    const notes: string[][] = [];
    const others: string[][] = [];
    v.onChanged((p) => notes.push(p));
    v.onOtherFiles((p) => others.push(p));
    return { v, root, notes, others };
  }

  test("renomear, mover e apagar pasta pelo app: só o aviso da operação, sem o do watcher", async () => {
    const { v, notes, others } = await watched();
    await v.moveFolder("Projetos", "Trabalho");
    await v.moveFolder("Trabalho/Velhos", "Velhos");
    await v.deleteFolder("Velhos");
    const fromOps = notes.length;
    await sleep(400);
    expect(notes.length).toBe(fromOps);
    expect(others).toEqual([]);
  });

  test("um arquivo que o índice conhece, apagado por fora, ainda avisa", async () => {
    const { root, others } = await watched();
    rmSync(path.join(root, "Projetos/dados.csv"));
    for (let i = 0; i < 100 && !others.length; i++) await sleep(20);
    expect(others.flat()).toContain("Projetos/dados.csv");
  });
});

describe("as notas sem a lista inteira (E4)", () => {
  test("noteMetas: as mesmas notas da lista", async () => {
    const root = vaultDir({ "A/Um.md": "# Um\n#x\n", "Dois.md": "# Dois\n", "A/b.csv": "1\n" });
    const v = new Vault({ root });
    vaults.push(v);
    await v.open();
    const byPath = (a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path);
    expect([...v.noteMetas()].sort(byPath)).toEqual(v.list().notes);
  });
});
