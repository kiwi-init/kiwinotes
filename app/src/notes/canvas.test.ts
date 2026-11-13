// O quadro branco no vault (T6600, E16): o `.canvas` abre, salva com a versão, nasce e muda de nome sem entrar no índice
// das notas, e nada grava um quadro que não abre.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { uiCapabilities } from "../bun/ui-capabilities.ts";
import { directInvoke } from "../bun/ui-engine.ts";
import { parseCanvas, stringifyCanvas, updateNode } from "../shared/json-canvas.ts";
import { DEFAULT_SETTINGS } from "../store/settings.ts";
import { Vault, versionOf } from "./vault.ts";
import { tempDir } from "../../test/tmp.ts";

const dirs: string[] = [];
const vaults: Vault[] = [];
afterEach(() => {
  for (const v of vaults.splice(0)) v.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const BOARD = `{
\t"nodes":[
\t\t{"id":"a1","type":"text","text":"Oi","x":0,"y":0,"width":250,"height":60,"futuro":{"x":1}},
\t\t{"id":"b2","type":"file","file":"Ana.md","x":400,"y":0,"width":400,"height":300}
\t],
\t"edges":[
\t\t{"id":"e1","fromNode":"a1","fromSide":"right","toNode":"b2","toSide":"left"}
\t]
}`;

async function vault(files: Record<string, string>) {
  const dir = tempDir("kiwinotes-canvas-test-");
  dirs.push(dir);
  const root = path.join(dir, "KiwiNotes");
  mkdirSync(root, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  }
  const v = new Vault({ root, debounceMs: 20, trash: async (abs) => rmSync(abs, { recursive: true }) });
  vaults.push(v);
  await v.open();
  return { v, root };
}

describe("o quadro no vault (T6600)", () => {
  test("abre com o texto e a versão; fica fora das notas e dentro dos arquivos", async () => {
    const { v } = await vault({ "Projetos/Mudança.canvas": BOARD, "Ana.md": "# Ana\n" });
    const c = await v.getCanvas("Projetos/Mudança.canvas");
    expect(c).toEqual({ path: "Projetos/Mudança.canvas", content: BOARD, version: versionOf(BOARD) });
    const l = v.list();
    expect(l.notes.map((n) => n.path)).toEqual(["Ana.md"]);
    expect(l.files?.map((f) => f.path)).toContain("Projetos/Mudança.canvas");
  });

  test("salva com a versão certa, sem perder o que o Kiwi não conhece; com a velha, não escreve", async () => {
    const { v, root } = await vault({ "Q.canvas": BOARD });
    const c = await v.getCanvas("Q.canvas");
    const moved = stringifyCanvas(updateNode(parseCanvas(c.content), "a1", { x: 40 }));
    const r = await v.saveCanvas("Q.canvas", moved, c.version);
    expect(r).toEqual({ saved: true, path: "Q.canvas", version: versionOf(moved) });
    const disk = readFileSync(path.join(root, "Q.canvas"), "utf8");
    expect(disk).toBe(moved);
    expect(parseCanvas(disk).nodes[0]).toEqual({ id: "a1", type: "text", text: "Oi", x: 40, y: 0, width: 250, height: 60, futuro: { x: 1 } });
    // A versão de antes já não vale: devolve o de agora.
    const stale = await v.saveCanvas("Q.canvas", BOARD, c.version);
    expect(stale.saved).toBe(false);
    if (!stale.saved) expect(stale.current.content).toBe(moved);
    expect(readFileSync(path.join(root, "Q.canvas"), "utf8")).toBe(moved);
  });

  test("não grava o que não abre como JSON Canvas, nem fora de .canvas", async () => {
    const { v, root } = await vault({ "Q.canvas": BOARD });
    const { version } = await v.getCanvas("Q.canvas");
    await expect(v.saveCanvas("Q.canvas", "{ quebrado", version)).rejects.toThrow(/não é JSON/);
    await expect(v.saveCanvas("Q.canvas", "[]", version)).rejects.toThrow(/objeto/);
    await expect(v.saveCanvas("Q.md", BOARD, version)).rejects.toThrow(/\.canvas/);
    await expect(v.getCanvas("../fora.canvas")).rejects.toThrow();
    await expect(v.getCanvas("Nada.canvas")).rejects.toThrow(/no board/);
    expect(readFileSync(path.join(root, "Q.canvas"), "utf8")).toBe(BOARD);
  });

  test("criar: o quadro vazio no formato do Obsidian, com o nome livre seguinte, e a árvore fica sabendo", async () => {
    const { v, root } = await vault({ "Quadro.canvas": "{}" });
    const seen: string[][] = [];
    v.onOtherFiles((p) => seen.push(p));
    const c = await v.createCanvas("Ideias", "Quadro");
    expect(c.path).toBe("Ideias/Quadro.canvas");
    expect(c.content).toBe('{\n\t"nodes":[],\n\t"edges":[]\n}');
    expect(readFileSync(path.join(root, "Ideias/Quadro.canvas"), "utf8")).toBe(c.content);
    expect((await v.createCanvas("", "Quadro")).path).toBe("Quadro 2.canvas");
    expect((await v.createCanvas("", "Com texto", BOARD)).content).toBe(BOARD);
    await expect(v.createCanvas("", "Ruim", "nope")).rejects.toThrow(/não é JSON/);
    expect(seen).toContainEqual(["Ideias/Quadro.canvas"]);
    expect(v.list().files?.map((f) => f.path)).toContain("Quadro 2.canvas");
    expect(v.list().notes).toEqual([]);
  });

  test("renomear e mover; não passa por cima de outro quadro", async () => {
    const { v, root } = await vault({ "A.canvas": BOARD, "B.canvas": "{}" });
    const r = await v.renameCanvas("A.canvas", "Pasta/Novo.canvas");
    expect(r.path).toBe("Pasta/Novo.canvas");
    expect(r.content).toBe(BOARD);
    expect(existsSync(path.join(root, "A.canvas"))).toBe(false);
    expect(v.list().files?.map((f) => f.path)).not.toContain("A.canvas");
    await expect(v.renameCanvas("Pasta/Novo.canvas", "B.canvas")).rejects.toThrow(/already exists/);
    expect((await v.renameCanvas("B.canvas", "b.canvas")).path).toBe("b.canvas");
  });

  test("pelas capacidades do contrato", async () => {
    const { root } = await vault({ "Q.canvas": BOARD });
    const caps = uiCapabilities({
      settings: { load: async () => DEFAULT_SETTINGS, save: async (s: unknown) => s },
      notes: (() => {
        const v = new Vault({ root, debounceMs: 20 });
        vaults.push(v);
        return v;
      })(),
    } as never);
    const got = (await directInvoke(caps, "notes.canvasGet", { path: "Q.canvas" })) as { ok: true; value: { version: string } };
    expect(got.ok).toBe(true);
    const saved = await directInvoke(caps, "notes.canvasSave", { path: "Q.canvas", content: "{}", baseVersion: got.value.version });
    expect(saved).toEqual({ ok: true, value: { saved: true, path: "Q.canvas", version: versionOf("{}") } });
    expect(((await directInvoke(caps, "notes.canvasGet", { path: "Q.canvas", extra: 1 })) as { ok: boolean }).ok).toBe(false);
    expect(((await directInvoke(caps, "notes.canvasSave", { path: "Q.canvas", content: "nope", baseVersion: "x" })) as { ok: boolean }).ok).toBe(false);
  });
});
