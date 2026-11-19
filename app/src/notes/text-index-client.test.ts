// O índice do conteúdo num Worker (P0 #23988, 2ª metade), num cofre inventado num tmp.

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { tempDir } from "../../test/tmp.ts";
import { createTextIndex, TextIndexWorker, textIndexWorkerScript } from "./text-index-client.ts";
import { TextIndex } from "./text-index.ts";
import type { VaultFile } from "./vault.ts";

const open: { close(): unknown }[] = [];
afterEach(async () => {
  for (const o of open.splice(0)) await o.close();
});

function folder(files: Record<string, string>) {
  const base = tempDir("kiwi-text-worker-");
  const root = path.join(base, "Notas");
  const write = (rel: string, data: string) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), data);
  };
  for (const [rel, data] of Object.entries(files)) write(rel, data);
  const stat = (rel: string): VaultFile | undefined => {
    const abs = path.join(root, rel);
    if (!existsSync(abs)) return undefined;
    const s = statSync(abs);
    return { path: rel, size: s.size, mtime: s.mtime.toISOString() };
  };
  const all = () => Object.keys(files).map(stat).filter((f): f is VaultFile => !!f);
  const worker = (extra: { batchText?: number } = {}) => {
    const t = new TextIndexWorker({ root, dir: path.join(base, "dados", "text-index"), ...extra }, textIndexWorkerScript()!, 0);
    open.push(t);
    return t;
  };
  return { base, root, write, stat, all, worker };
}

const paths = (hits: { path: string }[]) => hits.map((h) => h.path).sort();

describe("o índice num Worker (P0 #23988)", () => {
  test("acha o texto, segue os avisos e tira o que saiu", async () => {
    const f = folder({ "Loja/caixa.txt": "fechamento com goiaba", "Loja/estoque.csv": "item;qtd\ngoiaba;3", "nota.md": "goiaba na nota" });
    const t = f.worker();
    await t.sync(f.all());
    await t.idle();
    // Uma passada só: o 1º worker não recebe a lista duas vezes.
    expect(await t.stats()).toMatchObject({ read: 2, skipped: 0 });
    // A nota é das Notas, não deste índice.
    expect(paths(await t.search("goiaba", 10, f.stat))).toEqual(["Loja/caixa.txt", "Loja/estoque.csv"]);

    f.write("Loja/novo.log", "uma goiaba nova");
    rmSync(path.join(f.root, "Loja/caixa.txt"));
    await t.update(["Loja/novo.log", "Loja/caixa.txt"], f.stat);
    await t.idle();
    expect(paths(await t.search("goiaba", 10, f.stat))).toEqual(["Loja/estoque.csv", "Loja/novo.log"]);
  });

  test("o achado volta com o arquivo de agora, e o que saiu antes do aviso não volta", async () => {
    const f = folder({ "a.txt": "manga verde", "b.txt": "manga madura" });
    const t = f.worker();
    await t.sync(f.all());
    await t.idle();
    // `b.txt` saiu e o aviso ainda não chegou ao worker: o `stat` do main já não o tem.
    const hits = await t.search("manga", 10, (p) => (p === "b.txt" ? undefined : { ...f.stat(p)!, size: 999 }));
    expect(hits.map((h) => [h.path, h.file.size])).toEqual([["a.txt", 999]]);
  });

  test("o índice roda fora do main: lê, extrai e grava no worker", async () => {
    // O tempo do laço se prova pela sonda na pasta de 250 mil (o PR): num teste deste tamanho, mesmo no main, o lote
    // custa uns 10 ms, e o FTS5 só pesa com o índice grande. Aqui, o que se confere é onde o trabalho roda.
    const f = folder({ "logs/a.log": "uma linha com acerola", "logs/b.json": '{"fruta":"acerola"}' });
    const t = f.worker();
    await t.sync(f.all());
    await t.idle();
    expect(await t.stats()).toMatchObject({ read: 2, mainThread: false });
    expect(Bun.isMainThread).toBe(true);
    expect(paths(await t.search("acerola", 10, f.stat))).toEqual(["logs/a.log", "logs/b.json"]);
  });

  test("se o worker cai, o próximo pedido abre outro, sobre o mesmo banco", async () => {
    const f = folder({ "x.txt": "pitanga", "y.txt": "pitanga e jambo" });
    const t = f.worker();
    await t.sync(f.all());
    await t.idle();
    t.kill();
    expect(paths(await t.search("jambo", 10, f.stat))).toEqual(["y.txt"]);
    expect(t.starts).toBe(2);
    // O banco ficou: o worker novo não lê de novo o que não mudou.
    await t.idle();
    expect((await t.stats()).read).toBe(0);
  });

  test("depois de fechado, não abre outro worker", async () => {
    const f = folder({ "x.txt": "carambola" });
    const t = f.worker();
    await t.sync(f.all());
    await t.close();
    expect(await t.search("carambola", 10, f.stat)).toEqual([]);
    await t.sync(f.all());
    expect(t.starts).toBe(1);
  });

  test("sem o worker (KIWI_TEXT_INDEX_WORKER=0), o índice roda no main", () => {
    const before = process.env.KIWI_TEXT_INDEX_WORKER;
    process.env.KIWI_TEXT_INDEX_WORKER = "0";
    try {
      const t = createTextIndex({ root: "/nao/existe", dir: "/nao/existe/idx" });
      expect(t).toBeInstanceOf(TextIndex);
    } finally {
      if (before === undefined) delete process.env.KIWI_TEXT_INDEX_WORKER;
      else process.env.KIWI_TEXT_INDEX_WORKER = before;
    }
    expect(createTextIndex({ root: "/nao/existe", dir: "/nao/existe/idx" })).toBeInstanceOf(TextIndexWorker);
  });

  test("um build sem o workers/ roda no main e avisa no log (lead, #24141)", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const t = createTextIndex({ root: "/nao/existe", dir: "/nao/existe/idx" }, "/nao/existe/bun");
      expect(t).toBeInstanceOf(TextIndex);
      expect(String(warn.mock.calls[0]?.[0])).toContain("workers/text-index-worker.js");
    } finally {
      warn.mockRestore();
    }
  });
});
