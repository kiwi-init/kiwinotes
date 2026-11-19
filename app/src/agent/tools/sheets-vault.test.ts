// O Kiwi Cat muda uma planilha de verdade (T21114, spec #21065): o `sheets_read` e o `sheets_edit` sobre um cofre num
// tmp, pelas capacidades das janelas (`uiCapabilities`) e pelo escritor ao vivo (`liveWriter`), e o desfazer da
// Atividade volta o arquivo byte a byte. As chamadas são as do agente falso (`runKiwiTool`); nenhum agente roda aqui.
// Tudo inventado: o estoque de uma loja.

import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { uiCapabilities } from "../../bun/ui-capabilities.ts";
import { Vault } from "../../notes/vault.ts";
import { NoteVersions } from "../../notes/versions.ts";
import { readXlsx } from "../../shared/sheet/xlsx.ts";
import { DEFAULT_SETTINGS } from "../../store/settings.ts";
import { tempDir } from "../../../test/tmp.ts";
import { AgentActivity } from "../activity.ts";
import { LiveWrites, liveWriter } from "../live-write.ts";
import { undo, undoNotesFromCapabilities } from "../undo.ts";
import * as reader from "./reader.ts";
import { runKiwiTool, ToolError } from "./tools.ts";
import { writerFromCapabilities } from "./writer.ts";

const vaults: Vault[] = [];
afterEach(() => {
  for (const v of vaults.splice(0)) v.close?.();
});

const ESTOQUE = readFileSync(path.join(import.meta.dir, "../../../test/fixtures/sheet/estoque.xlsx"));
const CSV = "Nome;Cidade;Pedidos\r\nAna;Cidade A;3\r\nBeto;Cidade B;5\r\n";

type Caps = Record<string, (a: unknown) => unknown>;

function setup() {
  const base = tempDir("kiwi-sheets-");
  const root = path.join(base, "KiwiNotes");
  mkdirSync(path.join(root, "Loja"), { recursive: true });
  writeFileSync(path.join(root, "Loja/estoque.xlsx"), ESTOQUE);
  writeFileSync(path.join(root, "Loja/clientes.csv"), CSV);
  const v = new Vault({ root, debounceMs: 20, trash: async () => {} });
  vaults.push(v);
  const caps = uiCapabilities({
    dictionary: { load: async () => [], save: async (t) => t },
    snippets: { load: async () => [], save: async (s) => s },
    history: { search: async () => ({ entries: [] }), delete: async () => true, get: async () => null },
    dictationNotes: { toNew: async () => { throw new Error("not used"); }, append: async () => { throw new Error("not used"); } },
    settings: { load: async () => ({ ...DEFAULT_SETTINGS, notesShortcut: null }), save: async () => ({ ...DEFAULT_SETTINGS, notesShortcut: null }) },
    clipboardWrite: () => {},
    notes: v,
    versions: new NoteVersions({ dir: path.join(base, "history") }),
  }) as Caps;
  let clock = Date.parse("2026-11-19T12:00:00.000Z");
  const now = () => clock;
  const activity = new AgentActivity({ dir: path.join(base, "agent", "activity"), now });
  const id = `p-${randomUUID()}`;
  const live = new LiveWrites();
  // O servidor pega o aviso no `files.changed`, enquanto a gravação ainda corre: aqui, logo depois de o disco mudar.
  const avisos: ReturnType<LiveWrites["take"]> = [];
  const inner = writerFromCapabilities(caps as never);
  const disk = {
    ...inner,
    saveBytes: async (...a: Parameters<NonNullable<typeof inner.saveBytes>>) => {
      const r = await inner.saveBytes!(...a);
      avisos.push(...live.take([a[0]]));
      return r;
    },
  };
  const writer = liveWriter(disk, live, () => id);
  const ctx = { reader: reader.readerFromCapabilities(caps as never), writer };
  const tool = async (name: string, args: unknown) => {
    clock += 1000;
    const journal = { keep: (_p: string, before: string) => activity.keep(id, before), drop: (c: string) => activity.drop(c) };
    const r = await runKiwiTool({ ...ctx, journal }, name, args);
    if (r.change) await activity.change(id, r.change);
    return r.value as Record<string, any>;
  };
  return {
    root,
    tool,
    avisos,
    begin: () => activity.begin(id, "acerte o estoque"),
    undo: () => undo({ activity, notes: undoNotesFromCapabilities(caps as never), now }, id),
    bytes: (rel: string) => readFileSync(path.join(root, rel)),
    write: (rel: string, data: string | Buffer) => writeFileSync(path.join(root, rel), data),
  };
}

const cell = (bytes: Uint8Array, sheet: string, row: number, col: number) => readXlsx(new Uint8Array(bytes), "x.xlsx").sheets.find((s) => s.name === sheet)!.rows[row]?.[col];

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof ToolError ? e.code : String(e);
  }
};

describe("o Kiwi Cat muda a planilha no cofre (T21114)", () => {
  test("lê, muda pela versão, o disco fica com o recálculo, e a janela recebe as operações", async () => {
    const t = setup();
    await t.begin();
    const lido = await t.tool("sheets_read", { caminho: "Loja/estoque.xlsx", intervalo: "A1:E3" });
    expect(lido.linhas[1][2]).toBe(7);
    const feito = await t.tool("sheets_edit", { caminho: "Loja/estoque.xlsx", versao: lido.versao, mudancas: [{ tipo: "celulas", celulas: { C2: 10 } }] });
    const disco = t.bytes("Loja/estoque.xlsx");
    expect(cell(disco, "Estoque", 1, 2)?.value).toBe(10);
    expect(cell(disco, "Estoque", 1, 4)).toMatchObject({ formula: "C2*D2", value: 249 });
    // O aviso da janela (spec #20843) vem pelo caminho, com as operações e a versão do que gravou.
    const aviso = t.avisos;
    expect(aviso).toHaveLength(1);
    expect(aviso[0]).toMatchObject({ path: "Loja/estoque.xlsx", version: feito.versao, turnId: expect.any(String) });
    expect(aviso[0]!.sheetOps![0]).toEqual({ op: "set", sheet: "Estoque", row: 1, col: 2, value: 10 });
    // A versão velha não grava mais.
    expect(await code(t.tool("sheets_edit", { caminho: "Loja/estoque.xlsx", versao: lido.versao, mudancas: [{ tipo: "celulas", celulas: { C2: 1 } }] }))).toBe("E_CHANGED");
  });

  test("o desfazer volta o xlsx e o csv byte a byte", async () => {
    const t = setup();
    await t.begin();
    const x = await t.tool("sheets_read", { caminho: "Loja/estoque.xlsx" });
    await t.tool("sheets_edit", { caminho: "Loja/estoque.xlsx", versao: x.versao, mudancas: [{ tipo: "inserir_linhas", linha: 3, quantidade: 2 }, { tipo: "celulas", celulas: { A3: "Jarra" } }] });
    const c = await t.tool("sheets_read", { caminho: "Loja/clientes.csv" });
    await t.tool("sheets_edit", { caminho: "Loja/clientes.csv", versao: c.versao, mudancas: [{ tipo: "celulas", celulas: { C2: 4 } }] });
    expect(t.bytes("Loja/clientes.csv").toString("utf8")).toBe("Nome;Cidade;Pedidos\r\nAna;Cidade A;4\r\nBeto;Cidade B;5\r\n");
    const r = await t.undo();
    expect(r.notes.map((n: { path: string; result: string }) => `${n.path} ${n.result}`).sort()).toEqual(["Loja/clientes.csv restored", "Loja/estoque.xlsx restored"]);
    expect(Buffer.compare(t.bytes("Loja/estoque.xlsx"), ESTOQUE)).toBe(0);
    expect(t.bytes("Loja/clientes.csv").toString("utf8")).toBe(CSV);
  });

  test("a planilha mudada por fora depois do gato: o desfazer recusa e não apaga o de fora", async () => {
    const t = setup();
    await t.begin();
    const c = await t.tool("sheets_read", { caminho: "Loja/clientes.csv" });
    await t.tool("sheets_edit", { caminho: "Loja/clientes.csv", versao: c.versao, mudancas: [{ tipo: "celulas", celulas: { C3: 6 } }] });
    const fora = "Nome;Cidade;Pedidos\r\nAna;Cidade A;3\r\nBeto;Cidade B;8\r\n";
    t.write("Loja/clientes.csv", fora);
    const r = await t.undo();
    expect(r.notes.some((n: { result: string }) => n.result === "restored")).toBe(false);
    expect(t.bytes("Loja/clientes.csv").toString("utf8")).toBe(fora);
  });
});
