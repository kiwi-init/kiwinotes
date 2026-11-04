import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { uiCapabilities } from "../bun/ui-capabilities.ts";
import { directInvoke } from "../bun/ui-engine.ts";
import { type AppSettings, DEFAULT_SETTINGS } from "../store/settings.ts";
import { Attachments } from "./attachments.ts";
import { attachmentHits, lowBattery, OcrIndex, type OcrLine, snippetOf, whereLabel } from "./ocr.ts";
import { Vault } from "./vault.ts";

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});
const tmp = (name: string) => {
  const d = mkdtempSync(path.join(tmpdir(), `kiwi-ocr-${name}-`));
  dirs.push(d);
  return d;
};

/** Um helper de mentira: o "texto" de cada arquivo é o que o teste disse, e conta as chamadas. */
function fakeRunner(texts: Record<string, string>) {
  const calls: string[] = [];
  return {
    calls,
    run: async (abs: string[]): Promise<OcrLine[]> =>
      abs.map((f) => {
        calls.push(path.basename(f));
        const t = texts[path.basename(f)];
        return t === undefined ? { file: f, error: "can't read" } : { file: f, text: t, method: "vision", pages: 1, ms: 5 };
      }),
  };
}

const AC = "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t80%; charging; 1:00 remaining present: true";

function setup(texts: Record<string, string>, opts: { enabled?: boolean; battery?: string[] } = {}) {
  const root = tmp("vault");
  const cache = tmp("cache");
  mkdirSync(path.join(root, "Anexos"));
  const runner = fakeRunner(texts);
  const batteries = [...(opts.battery ?? [])];
  const slept: number[] = [];
  const ocr = new OcrIndex({
    root,
    cacheDir: cache,
    runner,
    enabled: async () => opts.enabled ?? true,
    battery: async () => batteries.shift() ?? AC,
    sleep: async (ms) => void slept.push(ms),
  });
  return { root, cache, runner, ocr, slept };
}

describe("o OCR dos anexos (T2709)", () => {
  test("a bateria: pausa só abaixo de 20% e fora da tomada", () => {
    expect(lowBattery("Now drawing from 'Battery Power'\n -InternalBattery-0\t15%; discharging; 0:40 remaining")).toBe(true);
    expect(lowBattery("Now drawing from 'Battery Power'\n -InternalBattery-0\t55%; discharging; 3:00 remaining")).toBe(false);
    expect(lowBattery(AC)).toBe(false);
    expect(lowBattery("Now drawing from 'AC Power'")).toBe(false); // um Mac sem bateria
    expect(lowBattery("")).toBe(false);
  });

  test("lê cada anexo uma vez, guarda pelo hash fora do vault, e o cache vale para um índice novo e para o nome novo", async () => {
    const { root, cache, runner, ocr } = setup({ "foto.png": "Planta da sala\nKiwi" });
    writeFileSync(path.join(root, "Anexos/foto.png"), "png-1");
    ocr.enqueue(["Anexos/foto.png", "Anexos/foto.png", "nota.md"]);
    await ocr.idle();
    expect(runner.calls).toEqual(["foto.png"]);
    expect(ocr.textOf("Anexos/foto.png")).toBe("Planta da sala\nKiwi");
    expect(readdirSync(cache)).toHaveLength(1);
    expect(existsSync(path.join(root, ".kiwi-ocr"))).toBe(false);

    // Renomeado: o mesmo conteúdo, o mesmo hash, nenhuma leitura nova.
    renameSync(path.join(root, "Anexos/foto.png"), path.join(root, "Anexos/sala.png"));
    const again = new OcrIndex({ root, cacheDir: cache, runner, enabled: async () => true, battery: async () => AC });
    again.enqueue(["Anexos/sala.png"]);
    await again.idle();
    expect(runner.calls).toEqual(["foto.png"]);
    expect(again.textOf("Anexos/sala.png")).toBe("Planta da sala\nKiwi");
    expect(again.stats).toMatchObject({ read: 0, cached: 1 });
  });

  test("desligado nas Configurações, ou sem o helper, a fila não anda", async () => {
    const off = setup({ "a.png": "x" }, { enabled: false });
    writeFileSync(path.join(off.root, "Anexos/a.png"), "1");
    off.ocr.enqueue(["Anexos/a.png"]);
    await off.ocr.idle();
    expect(off.runner.calls).toEqual([]);

    const none = setup({ "a.png": "x" });
    none.ocr.setRunner(null);
    writeFileSync(path.join(none.root, "Anexos/a.png"), "1");
    none.ocr.enqueue(["Anexos/a.png"]);
    await none.ocr.idle();
    expect(none.runner.calls).toEqual([]);
  });

  test("com a bateria baixa, espera e tenta de novo", async () => {
    const low = "Now drawing from 'Battery Power'\n -InternalBattery-0\t12%; discharging;";
    const { root, runner, ocr, slept } = setup({ "a.png": "texto" }, { battery: [low, low] });
    writeFileSync(path.join(root, "Anexos/a.png"), "1");
    ocr.enqueue(["Anexos/a.png"]);
    await ocr.idle();
    expect(slept).toEqual([5 * 60_000, 5 * 60_000]);
    expect(runner.calls).toEqual(["a.png"]);
  });

  test("um arquivo que o helper não lê conta como falha e não trava a fila", async () => {
    const { root, runner, ocr } = setup({ "b.png": "segundo" });
    writeFileSync(path.join(root, "Anexos/a.png"), "1");
    writeFileSync(path.join(root, "Anexos/b.png"), "2");
    ocr.enqueue(["Anexos/a.png", "Anexos/b.png", "Anexos/sumiu.png"]);
    await ocr.idle();
    expect(runner.calls).toEqual(["a.png", "b.png"]);
    expect(ocr.stats.failed).toBe(1);
    expect(ocr.textOf("Anexos/b.png")).toBe("segundo");
  });

  test("o trecho e o rótulo", () => {
    expect(snippetOf("linha um\nPlanta da sala com janela", "sala", 6)).toBe("…ta da sala com j…");
    expect(whereLabel("Anexos/foto.png")).toBe("na imagem foto.png");
    expect(whereLabel("Docs/contrato.PDF")).toBe("no PDF contrato.PDF");
  });
});

describe("a busca acha a nota pelo texto do anexo", () => {
  async function world() {
    const { root, cache, runner, ocr } = setup({ "planta.png": "Planta da sala\nMedidas 3x4", "recibo.pdf": "Recibo de pagamento" });
    const vault = new Vault({ root, trash: async () => {} });
    await vault.open();
    writeFileSync(path.join(root, "Anexos/planta.png"), "img");
    writeFileSync(path.join(root, "Anexos/recibo.pdf"), "pdf");
    await vault.create("", "Casa", "A planta:\n![[planta.png]]\n");
    await vault.create("", "Contas", "Pago.\n![[recibo.pdf]]\n");
    await vault.create("", "Outra", "Fala de planta.png sem embutir.\n");
    ocr.enqueue(["Anexos/planta.png", "Anexos/recibo.pdf"]);
    await ocr.idle();
    return { root, cache, runner, ocr, vault };
  }

  test("o anexo que casa vira a nota que o embute, com o trecho", async () => {
    const { ocr, vault } = await world();
    const hits = await attachmentHits(ocr, vault, "medidas 3x4", [], 20);
    expect(hits).toEqual([{ path: "Casa.md", title: "Casa", snippet: "na imagem planta.png: Planta da sala Medidas 3x4", score: 0.5 }]);
    const pdf = await attachmentHits(ocr, vault, "recibo", [], 20);
    expect(pdf.map((h) => [h.path, h.snippet.startsWith("no PDF recibo.pdf: ")])).toEqual([["Contas.md", true]]);
    // A nota que a busca de texto já achou não repete; tag e nada casando, nada.
    expect(await attachmentHits(ocr, vault, "sala", [{ path: "Casa.md", title: "Casa", snippet: "", score: 9 }], 20)).toEqual([]);
    expect(await attachmentHits(ocr, vault, "tag:casa", [], 20)).toEqual([]);
    // Os filtros da busca (T2660): a frase exata, o "-" que exclui, e o path: que é da nota.
    expect((await attachmentHits(ocr, vault, '"medidas 3x4"', [], 20)).map((h) => h.path)).toEqual(["Casa.md"]);
    expect(await attachmentHits(ocr, vault, '"3x4 medidas"', [], 20)).toEqual([]);
    expect(await attachmentHits(ocr, vault, "planta -medidas", [], 20)).toEqual([]);
    expect(await attachmentHits(ocr, vault, "planta path:Casa", [], 20)).toEqual([]);
    expect(await attachmentHits(ocr, vault, "inexistente", [], 20)).toEqual([]);
  });

  test("pelo contrato: o notes.search completa com os anexos, e o interruptor desliga", async () => {
    const { root, ocr, vault } = await world();
    let settings: AppSettings = { ...DEFAULT_SETTINGS };
    const c = uiCapabilities({
      dictionary: { load: async () => [], save: async (t) => t },
      snippets: { load: async () => [], save: async (s) => s },
      history: { search: async () => ({ entries: [] }), delete: async () => true, get: async () => null },
      dictationNotes: { toNew: async () => { throw new Error("not used"); }, append: async () => { throw new Error("not used"); } },
      settings: {
        load: async () => settings,
        save: async (patch) => (settings = { ...settings, ...patch, appearance: { ...settings.appearance, ...patch.appearance } }),
      },
      clipboardWrite: () => {},
      notes: vault,
      attachments: new Attachments(vault),
      ocr,
    });
    const call = (cap: string, args: unknown) => directInvoke(c, cap, args);
    const r = (await call("notes.search", { query: "medidas" })) as { ok: boolean; value: { path: string; snippet: string }[] };
    expect(r.ok).toBe(true);
    expect(r.value.map((h) => h.path)).toEqual(["Casa.md"]);
    expect(r.value[0]!.snippet).toContain("na imagem planta.png");
    expect(await call("settings.set", { ocr: false })).toMatchObject({ ok: true, value: { ocr: false } });
    expect(await call("notes.search", { query: "medidas" })).toMatchObject({ ok: true, value: [] });
    expect(await call("settings.set", { ocr: "sim" })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(existsSync(path.join(root, "Anexos"))).toBe(true);
  });
});
