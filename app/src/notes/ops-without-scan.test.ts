// Renomear, mover e apagar sem o scan inteiro do disco (T20166, spec #20118): cada operação conta zero scans, e o índice
// que sobra é igual ao de um cofre aberto do zero na mesma pasta. Tudo inventado, num tmp.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { type IndexProgress, Vault } from "./vault.ts";
import { tempDir } from "../../test/tmp.ts";

const dirs: string[] = [];
const vaults: Vault[] = [];
afterEach(() => {
  for (const v of vaults.splice(0)) v.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const files: Record<string, string> = {
  "Projetos/Plano.md": "# Plano\n\nVer [[Ideias]] e [[Lista]].\n",
  "Projetos/Velhos/Lista.md": "# Lista\n#arquivo\n",
  "Projetos/Velhos/dados.csv": "a,b\n1,2\n",
  "Projetos/Relatório.pages/Index/Document.iwa": "x",
  "Ideias.md": "# Ideias\n\n[[Plano]]\n",
  "Diário/2026/Segunda.md": "# Segunda\n[[Lista]]\n",
  "Diário/2026/foto.png": "png",
};

async function setup() {
  const dir = tempDir("kiwinotes-ops-scan-");
  dirs.push(dir);
  const root = path.join(dir, "Cofre");
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  }
  const progress: IndexProgress[] = [];
  const v = new Vault({ root, trash: async (abs) => rmSync(abs, { recursive: true, force: true }), onIndexProgress: (p) => progress.push(p) });
  vaults.push(v);
  await v.open();
  const inner = v as unknown as { scan(o?: unknown): Promise<void> };
  const scan = inner.scan.bind(v);
  let scans = 0;
  inner.scan = (o?: unknown) => (scans++, scan(o));
  return { v, root, progress, scans: () => scans };
}

/** O que a árvore e a busca enxergam: as notas (com pasta, título e versão), as pastas e os arquivos. */
function view(v: Vault) {
  const l = v.list();
  return {
    notes: l.notes.map((n) => `${n.path}|${n.folder}|${n.title}|${n.version}|${n.tags.join(",")}`).sort(),
    folders: [...l.folders].sort(),
    files: (l.files ?? []).map((f) => `${f.path}|${f.size}`).sort(),
  };
}

/** O mesmo cofre aberto do zero: o que o scan inteiro teria dado. */
async function fresh(root: string) {
  const v = new Vault({ root });
  vaults.push(v);
  await v.open();
  return view(v);
}

describe("sem o scan inteiro (T20166)", () => {
  test("renomear e mover nota: zero scans, e o índice bate com o disco", async () => {
    const { v, root, scans } = await setup();
    await v.rename("Ideias.md", "Ideias boas.md");
    await v.moveNote("Projetos/Velhos/Lista.md", "Diário");
    expect(scans()).toBe(0);
    expect(view(v)).toEqual(await fresh(root));
    expect(v.resolve("Lista")).toBe("Diário/Lista.md");
  });

  test("renomear e mover pasta, com subpasta, arquivo e pacote dentro: zero scans", async () => {
    const { v, root, scans } = await setup();
    const r = await v.moveFolder("Projetos", "Trabalho/Projetos");
    expect(r.moved).toBe(2);
    await v.moveFolder("Trabalho/Projetos/Velhos", "Arquivo");
    expect(scans()).toBe(0);
    const now = view(v);
    expect(now).toEqual(await fresh(root));
    expect(now.files.some((f) => f.startsWith("Trabalho/Projetos/Relatório.pages|"))).toBe(true);
    expect(now.files).toContain("Arquivo/dados.csv|8");
    expect(now.folders).not.toContain("Trabalho/Projetos/Relatório.pages");
    expect(v.resolve("Lista")).toBe("Arquivo/Lista.md");
  });

  test("o que entrou e saiu por fora da pasta, antes do watcher, vai junto no mover (rodada 2)", async () => {
    const { v, root, scans } = await setup();
    // Dentro do debounce do watcher: o índice ainda não viu nada disso.
    writeFileSync(path.join(root, "Projetos/Velhos/novo.csv"), "x,y\n");
    rmSync(path.join(root, "Projetos/Velhos/dados.csv"));
    mkdirSync(path.join(root, "Projetos/Nova/Funda"), { recursive: true });
    writeFileSync(path.join(root, "Projetos/Nova/Funda/Rascunho.md"), "# Rascunho\n");
    writeFileSync(path.join(root, "Projetos/Nova/tabela.csv"), "1\n");
    await v.moveFolder("Projetos", "B/A");
    expect(scans()).toBe(0);
    const now = view(v);
    expect(now.files).toContain("B/A/Velhos/novo.csv|4");
    expect(now.files).toContain("B/A/Nova/tabela.csv|2");
    expect(now.files.some((f) => f.startsWith("B/A/Velhos/dados.csv"))).toBe(false);
    expect(now.folders).toContain("B/A/Nova/Funda");
    expect(now).toEqual(await fresh(root));
  });

  test("apagar pasta e nota, e o desfazer da nota: zero scans", async () => {
    const { v, root, scans } = await setup();
    await v.deleteFolder("Diário");
    await v.delete("Ideias.md");
    await v.restore("Ideias.md");
    expect(scans()).toBe(0);
    expect(view(v)).toEqual(await fresh(root));
    expect(v.resolve("Segunda")).toBeNull();
  });

  test("o desfazer da pasta traz o que tinha dentro, sem scan (T20227)", async () => {
    const { v, root, scans } = await setup();
    await v.deleteFolder("Projetos");
    await v.restore("Projetos");
    expect(scans()).toBe(0);
    const now = view(v);
    expect(now).toEqual(await fresh(root));
    expect(now.files.some((f) => f.startsWith("Projetos/Relatório.pages|"))).toBe(true);
    expect(v.resolve("Lista")).toBe("Projetos/Velhos/Lista.md");
  });

  test("o desfazer de uma subpasta cuja mãe foi apagada depois: a mãe volta junto", async () => {
    const { v, root, scans } = await setup();
    // Vazia: sem nota dentro, só a volta das pastas de cima põe a mãe no índice.
    await v.createFolder("Projetos/Vazia");
    await v.deleteFolder("Projetos/Vazia");
    await v.deleteFolder("Projetos");
    await v.restore("Projetos/Vazia");
    expect(scans()).toBe(0);
    const now = view(v);
    expect(now.folders).toEqual(["Diário", "Diário/2026", "Projetos", "Projetos/Vazia"]);
    expect(now).toEqual(await fresh(root));
  });

  test("uma nota criada e outra apagada por fora, que o índice não viu, entram no rename", async () => {
    const { v, root } = await setup();
    writeFileSync(path.join(root, "Nova.md"), "aponta para [[Plano]]\n");
    rmSync(path.join(root, "Diário/2026/Segunda.md"));
    const r = await v.rename("Projetos/Plano.md", "Projetos/Plano novo.md");
    expect(r.skippedPaths).toEqual([]);
    expect(view(v)).toEqual(await fresh(root));
    expect((await v.get("Nova.md")).content).toBe("aponta para [[Plano novo]]\n");
  });

  test("a barra de progresso é só da abertura (E0)", async () => {
    const { v, progress } = await setup();
    const atOpen = progress.length;
    expect(atOpen).toBeGreaterThan(0);
    await v.rename("Ideias.md", "Outra.md");
    await v.moveFolder("Projetos", "Outros");
    await v.deleteFolder("Diário");
    await v.restore("Diário");
    await v.reconcile();
    expect(progress.length).toBe(atOpen);
  });

  test("um scan que já andava quando a pasta mudou de lugar: no fim, outro acerta pastas e arquivos", async () => {
    const { v, root, scans } = await setup();
    // O scan de conferência para entre o walk (o disco de antes) e a troca do índice: na releitura da nota mudada.
    writeFileSync(path.join(root, "Ideias.md"), "# Ideias\n\nmudou por fora\n");
    const inner = v as unknown as { entryFor(...a: unknown[]): Promise<unknown>; scans: number; staleScan: boolean };
    const entryFor = inner.entryFor.bind(v);
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    let walked!: () => void;
    const atGate = new Promise<void>((r) => (walked = r));
    let first = true;
    inner.entryFor = async (...a: unknown[]) => {
      if (first) {
        first = false;
        walked();
        await gate;
      }
      return entryFor(...a);
    };
    const running = v.reconcile();
    await atGate;
    await v.moveFolder("Projetos", "Outros");
    open();
    await running;
    for (let i = 0; i < 400 && (inner.scans || inner.staleScan); i++) await new Promise((r) => setTimeout(r, 5));
    // O de conferência e o que corrige.
    expect(scans()).toBe(2);
    expect(view(v)).toEqual(await fresh(root));
  });
});
