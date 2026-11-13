// T6412 (issue 254): o FSEvents perde a mudança feita logo depois de o `fs.watch` abrir. A conferida do disco, pouco
// depois do `watch()`, acha o que mudou e avisa como o watcher avisaria, sem barra de progresso e sem reler o resto.
import { afterEach, expect, test } from "bun:test";
import { rmSync, unlinkSync, writeFileSync, renameSync, utimesSync } from "node:fs";
import path from "node:path";

import { type IndexProgress, Vault } from "./vault.ts";
import { until } from "./watch-wait.ts";
import { tempDir } from "../../test/tmp.ts";

const dirs: string[] = [];
const vaults: Vault[] = [];
afterEach(() => {
  for (const v of vaults.splice(0)) v.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function setup(files: Record<string, string>, o: { reconcileMs?: number } = {}) {
  const root = tempDir("kn-reconcile-");
  dirs.push(root);
  for (const [p, c] of Object.entries(files)) writeFileSync(path.join(root, p), c);
  const progress: IndexProgress[] = [];
  const v = new Vault({ root, trash: async () => {}, onIndexProgress: (p) => progress.push(p), ...o });
  vaults.push(v);
  await v.open();
  const changed: string[][] = [];
  const moves: [string, string][] = [];
  v.onChanged((paths) => changed.push(paths));
  v.onExternalMoves((r) => moves.push(...r.moves));
  return { root, v, progress, changed, moves };
}

const later = (file: string) => {
  const t = new Date(Date.now() + 5_000);
  utimesSync(file, t, t);
};

test("a conferida acha a nota mudada, a nova e a apagada, e avisa como o watcher", async () => {
  const { root, v, changed } = await setup({ "A.md": "antes", "B.md": "fica", "C.md": "some" });
  writeFileSync(path.join(root, "A.md"), "depois de abrir");
  later(path.join(root, "A.md"));
  writeFileSync(path.join(root, "Nova.md"), "nasceu lá fora");
  unlinkSync(path.join(root, "C.md"));
  await v.reconcile();
  expect(changed.flat().sort()).toEqual(["A.md", "C.md", "Nova.md"]);
  expect(v.search("abrir").map((h) => h.path)).toEqual(["A.md"]);
  expect(v.search("nasceu").map((h) => h.path)).toEqual(["Nova.md"]);
  expect(v.search("some")).toEqual([]);
});

test("sem mudança, nada é avisado nem relido, e não aparece barra de progresso", async () => {
  const { v, progress, changed } = await setup({ "A.md": "igual", "B.md": "igual também" });
  const reads = v.scanReads;
  progress.length = 0;
  await v.reconcile();
  expect(changed).toEqual([]);
  expect(v.scanReads).toBe(reads);
  expect(progress).toEqual([]);
});

test("um rename feito lá fora chega como mudança de lugar (as fixadas e o histórico seguem)", async () => {
  const { root, v, moves } = await setup({ "A.md": "nota" });
  renameSync(path.join(root, "A.md"), path.join(root, "Renomeada.md"));
  await v.reconcile();
  expect(moves).toEqual([["A.md", "Renomeada.md"]]);
});

test("o watch() agenda a conferida: a mudança de antes de olhar aparece sem nenhum evento do disco", async () => {
  const { root, v } = await setup({ "A.md": "antes" }, { reconcileMs: 50 });
  writeFileSync(path.join(root, "A.md"), "mudou antes do watch");
  later(path.join(root, "A.md"));
  v.watch();
  await until(() => v.search("watch").length === 1, "a conferida depois do watch()");
});

test("fechar antes da conferida cancela", async () => {
  const { root, v, changed } = await setup({ "A.md": "antes" }, { reconcileMs: 50 });
  v.watch();
  v.close();
  writeFileSync(path.join(root, "A.md"), "depois de fechar");
  await Bun.sleep(150);
  expect(changed).toEqual([]);
});

test("um save no meio da conferida continua valendo: a versão é a do save e o save seguinte não dá conflito", async () => {
  const files: Record<string, string> = {};
  for (let i = 0; i < 300; i++) files[`N${i}.md`] = `nota ${i}`;
  const { root, v } = await setup({ ...files, "A.md": "antes" });
  for (let round = 0; round < 20; round++) {
    for (const name of ["A.md", ...Object.keys(files).slice(0, 50)]) later(path.join(root, name));
    const a = await v.get("A.md");
    const running = v.reconcile();
    const saved = await v.save("A.md", `rodada ${round}`, a.version);
    await running;
    expect(saved.saved).toBe(true);
    if (!saved.saved) return;
    expect([round, v.list().notes.find((n) => n.path === "A.md")?.version]).toEqual([round, saved.meta.version]);
    expect([round, v.search(`rodada`).map((h) => h.path)]).toEqual([round, ["A.md"]]);
    expect((await v.get("A.md")).content).toBe(`rodada ${round}`);
    const next = await v.save("A.md", `depois ${round}`, saved.meta.version);
    expect([round, next.saved]).toEqual([round, true]);
  }
});
