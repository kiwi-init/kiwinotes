// O Kiwi Cat edita qualquer arquivo de texto (spec #21158, T21237): o código, o json, o yaml e o log, pelas mesmas
// ferramentas da nota, sobre um cofre de verdade num tmp e com as capacidades das janelas (`uiCapabilities`). As
// chamadas são as do agente falso (`runKiwiTool`); nenhum agente roda aqui. Tudo inventado: o estoque de uma loja.

import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { uiCapabilities } from "../../bun/ui-capabilities.ts";
import { Vault } from "../../notes/vault.ts";
import { TextIndex } from "../../notes/text-index.ts";
import { NoteVersions } from "../../notes/versions.ts";
import { EDITABLE_TEXT } from "../../shared/file-view.ts";
import { DEFAULT_SETTINGS } from "../../store/settings.ts";
import { tempDir } from "../../../test/tmp.ts";
import { AgentActivity } from "../activity.ts";
import { undo, undoNotesFromCapabilities } from "../undo.ts";
import * as reader from "./reader.ts";
import { runKiwiTool, ToolError } from "./tools.ts";
import { writerFromCapabilities } from "./writer.ts";
import { SecretGuard } from "../../guardrail/filter.ts";

const vaults: Vault[] = [];
const indexes: TextIndex[] = [];
afterEach(async () => {
  for (const t of indexes.splice(0)) await t.close();
  for (const v of vaults.splice(0)) v.close?.();
});

const PY = "# o estoque da loja\ndef total(itens):\n\treturn sum(i.qtd for i in itens)\n\nPRECO_CAFE = 12\n";
const JSON_ = '{\n  "loja": "Mercearia Exemplo",\n  "cafe": { "qtd": 40 },\n  "acucar": { "qtd": 15 }\n}\n';
const YAML = "loja: Mercearia Exemplo\nestoque:\n  cafe: 40\n  acucar: 15\n";
const LOG = "2026-11-02 09:00 abriu o caixa\r\n2026-11-02 09:05 vendeu 2 cafés\r\n";

type Caps = Record<string, (a: unknown) => unknown>;

function setup(files: Record<string, string> = {}, guard?: SecretGuard) {
  const base = tempDir("kiwi-texts-");
  const root = path.join(base, "KiwiNotes");
  const all = {
    "Loja/estoque.py": PY,
    "Loja/estoque.json": JSON_,
    "Loja/estoque.yaml": YAML,
    "Loja/caixa.log": LOG,
    "Loja/Plano.md": "# Plano\n\nabrir no sábado\n",
    ...files,
  };
  for (const [rel, content] of Object.entries(all)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  }
  const v = new Vault({ root, debounceMs: 20, trash: async () => {} });
  vaults.push(v);
  // O índice do texto (T21240), num tmp; a busca do agente espera a passada dele, como a pessoa depois da abertura.
  const text = new TextIndex({ root, dir: path.join(base, "text-index"), pause: async () => {} });
  indexes.push(text);
  const caps = uiCapabilities({
    dictionary: { load: async () => [], save: async (t) => t },
    snippets: { load: async () => [], save: async (s) => s },
    history: { search: async () => ({ entries: [] }), delete: async () => true, get: async () => null },
    dictationNotes: { toNew: async () => { throw new Error("not used"); }, append: async () => { throw new Error("not used"); } },
    settings: { load: async () => ({ ...DEFAULT_SETTINGS, notesShortcut: null }), save: async () => ({ ...DEFAULT_SETTINGS, notesShortcut: null }) },
    clipboardWrite: () => {},
    notes: v,
    versions: new NoteVersions({ dir: path.join(base, "history") }),
    textIndex: text,
  }) as Caps;
  let clock = Date.parse("2026-11-19T12:00:00.000Z");
  const now = () => clock;
  const activity = new AgentActivity({ dir: path.join(base, "agent", "activity"), now });
  const asked: string[] = [];
  const id = `p-${randomUUID()}`;
  const decider = { request: id, answers: {} as never, questions: { confirm: async (_r: string, q: string) => (asked.push(q), true) } as never };
  const ctx = { reader: reader.readerFromCapabilities(caps as never), writer: writerFromCapabilities(caps as never), decider, ...(guard ? { guard } : {}) };
  const tool = async (name: string, args: unknown) => {
    clock += 1000;
    if (name === "notes_search") {
      await caps["notes.list"]!(undefined);
      await text.idle();
    }
    const journal = { keep: (_p: string, before: string) => activity.keep(id, before), drop: (c: string) => activity.drop(c) };
    const r = await runKiwiTool({ ...ctx, journal }, name, args);
    if (r.change) await activity.change(id, r.change);
    return r.value as Record<string, any>;
  };
  return {
    root,
    tool,
    asked,
    begin: () => activity.begin(id, "acerte o estoque do café"),
    undo: () => undo({ activity, notes: undoNotesFromCapabilities(caps as never), now }, id),
    read: (rel: string) => readFileSync(path.join(root, rel), "utf8"),
    write: (rel: string, text: string) => writeFileSync(path.join(root, rel), text),
  };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof ToolError ? e.code : String(e);
  }
};

describe("o Kiwi Cat edita qualquer arquivo de texto (spec #21158)", () => {
  test("troca um trecho num .py, num .json e num .yaml, e acrescenta num .log; o resto fica byte a byte, sem perguntar", async () => {
    const t = setup();
    await t.tool("notes_edit", { path: "Loja/estoque.py", old: "PRECO_CAFE = 12", text: "PRECO_CAFE = 14" });
    expect(t.read("Loja/estoque.py")).toBe(PY.replace("12", "14"));
    await t.tool("notes_edit", { path: "Loja/estoque.json", old: '"cafe": { "qtd": 40 }', text: '"cafe": { "qtd": 38 }' });
    expect(t.read("Loja/estoque.json")).toBe(JSON_.replace("40", "38"));
    await t.tool("notes_edit", { path: "Loja/estoque.yaml", old: "acucar: 15", text: "acucar: 12" });
    expect(t.read("Loja/estoque.yaml")).toBe(YAML.replace("15", "12"));
    await t.tool("notes_append", { path: "Loja/caixa.log", text: "2026-11-02 18:00 fechou o caixa" });
    expect(t.read("Loja/caixa.log")).toBe(`${LOG}2026-11-02 18:00 fechou o caixa\r\n`);
    // A pergunta antes de reescrever é só do .txt (spec #13379): o código segue a permissão da nota.
    expect(t.asked).toEqual([]);
  });

  test("lê como a nota, com a versão, e o arquivo inteiro troca pelo notes_write", async () => {
    const t = setup();
    const r = await t.tool("notes_read", { path: "Loja/estoque.yaml" });
    expect(r).toMatchObject({ path: "Loja/estoque.yaml", titulo: "estoque.yaml", texto: YAML });
    const novo = "loja: Mercearia Exemplo\nestoque:\n  cafe: 40\n";
    await t.tool("notes_write", { path: "Loja/estoque.yaml", text: novo, version: r.versao });
    expect(t.read("Loja/estoque.yaml")).toBe(novo);
  });

  test("a regra vem de EDITABLE_TEXT: todo tipo da lista passa no mesmo teste, e o isTextNote saiu", async () => {
    // O `env` é o único de fora: o arquivo de segredos tem o teste dele, abaixo.
    const exts = [...EDITABLE_TEXT].filter((e) => !reader.isSecretFile(`arquivo.${e}`));
    expect(exts.length).toBe(EDITABLE_TEXT.size - 1);
    const t = setup(Object.fromEntries(exts.map((e) => [`Tipos/arquivo.${e}`, "antes do gato\n"])));
    for (const e of exts) {
      await t.tool("notes_edit", { path: `Tipos/arquivo.${e}`, old: "antes", text: "depois" });
      expect(`${e}: ${t.read(`Tipos/arquivo.${e}`)}`).toBe(`${e}: depois do gato\n`);
    }
    expect("isTextNote" in reader).toBe(false);
  });

  test("a lista diz o formato de cada arquivo de texto, para o gato não tratar código como nota", async () => {
    const t = setup();
    const r = await t.tool("notes_list", { folder: "Loja" });
    const formato = Object.fromEntries(r.notas.map((n: { path: string; formato?: string }) => [n.path, n.formato ?? "nota"]));
    expect(formato).toEqual({ "Loja/Plano.md": "nota", "Loja/estoque.py": "py", "Loja/estoque.json": "json", "Loja/estoque.yaml": "yaml", "Loja/caixa.log": "log" });
    // O files_read manda o .py para o notes_read.
    await expect(t.tool("files_read", { caminho: "Loja/estoque.py" })).rejects.toThrow(/notes_read/);
  });

  test("o arquivo mudou por fora: a escrita do gato é recusada, e o de fora fica", async () => {
    const t = setup();
    const r = await t.tool("notes_read", { path: "Loja/estoque.py" });
    const fora = PY.replace("12", "13");
    t.write("Loja/estoque.py", fora);
    expect(await code(t.tool("notes_edit", { path: "Loja/estoque.py", old: "PRECO_CAFE = 12", text: "PRECO_CAFE = 14", version: r.versao }))).toBe("E_CHANGED");
    expect(await code(t.tool("notes_write", { path: "Loja/estoque.py", text: "x = 1\n", version: r.versao }))).toBe("E_CHANGED");
    expect(t.read("Loja/estoque.py")).toBe(fora);
  });

  test("o desfazer do Kiwi volta cada arquivo ao que era", async () => {
    const t = setup();
    await t.begin();
    await t.tool("notes_edit", { path: "Loja/estoque.py", old: "PRECO_CAFE = 12", text: "PRECO_CAFE = 14" });
    await t.tool("notes_edit", { path: "Loja/estoque.json", old: '"qtd": 15', text: '"qtd": 9' });
    await t.tool("notes_append", { path: "Loja/caixa.log", text: "2026-11-02 18:00 fechou o caixa" });
    const r = await t.undo();
    expect(r.notes.map((n: { path: string; result: string }) => `${n.path} ${n.result}`).sort()).toEqual([
      "Loja/caixa.log restored",
      "Loja/estoque.json restored",
      "Loja/estoque.py restored",
    ]);
    expect([t.read("Loja/estoque.py"), t.read("Loja/estoque.json"), t.read("Loja/caixa.log")]).toEqual([PY, JSON_, LOG]);
  });

  test("o .env fica fora do gato: não lê, não lista, não acha, não grava; e a senha não sai em nada", async () => {
    // Uma senha inventada, num formato que o guardrail não reconhece.
    const ENV = "LOJA_SENHA=quindim-azul-42\nLOJA_PORTA=8080\n";
    const t = setup({ "Loja/.env": ENV, "Loja/.env.teste": ENV, "Loja/prod.env": ENV });
    const saidas: string[] = [];
    for (const p of ["Loja/.env", "Loja/.env.teste", "Loja/prod.env"]) {
      for (const [name, args] of [
        ["notes_read", { path: p }],
        ["files_read", { caminho: p }],
        ["notes_edit", { path: p, old: "8080", text: "9090" }],
        ["notes_append", { path: p, text: "LOJA_X=1" }],
        ["notes_write", { path: p, text: "x" }],
      ] as const) {
        const e = await t.tool(name, args).then((v) => (saidas.push(JSON.stringify(v)), null), (x: unknown) => x as ToolError);
        expect(`${name} ${p}: ${e?.code}`).toBe(`${name} ${p}: E_BAD_ARGS`);
        expect(e!.message).toContain("fica fora do Kiwi Cat");
        saidas.push(e!.message);
      }
      expect(t.read(p)).toBe(ENV);
    }
    saidas.push(JSON.stringify(await t.tool("notes_list", { folder: "Loja" })));
    saidas.push(JSON.stringify(await t.tool("notes_search", { query: "quindim" })));
    saidas.push(JSON.stringify(await t.tool("notes_search", { query: "env" })));
    expect(saidas.join("\n")).not.toContain("quindim-azul");
    expect(saidas.join("\n")).not.toMatch(/"[^"]*\.env(\.teste)?"/);
    // Falar de um .env no texto não é apontar para ele.
    await t.tool("notes_append", { path: "Loja/Plano.md", text: "conferir o prod.env com a Ana" });
    expect(t.read("Loja/Plano.md")).toContain("prod.env");
  });

  test("o que é só de Markdown num arquivo de código: erro claro, e nada é gravado", async () => {
    const t = setup();
    const v = (await t.tool("notes_read", { path: "Loja/estoque.py" })).versao;
    // No .py, "# o estoque da loja" é comentário, não título: a seção trocaria o arquivo no lugar errado.
    const tries: [string, Record<string, unknown>][] = [
      ["notes_section_rename", { path: "Loja/estoque.py", section: "o estoque da loja", title: "outro", version: v }],
      ["notes_section_move", { path: "Loja/estoque.py", section: 1, before: 1, version: v }],
      ["notes_write", { path: "Loja/estoque.py", section: "o estoque da loja", text: "x = 1", version: v }],
      ["notes_edit", { path: "Loja/estoque.py", section: "o estoque da loja", old: "12", text: "14" }],
      ["notes_append", { path: "Loja/estoque.py", section: "o estoque da loja", text: "x = 1" }],
      ["notes_outline", { path: "Loja/estoque.py" }],
      ["notes_read", { path: "Loja/estoque.py", section: "o estoque da loja" }],
    ];
    for (const [name, args] of tries) {
      const e = await t.tool(name, args).then(() => null, (x: unknown) => x as ToolError);
      expect(`${name}: ${e?.code}`).toBe(`${name}: E_BAD_ARGS`);
      expect(e!.message).toContain("é só de nota (.md)");
      expect(e!.message).toContain("Nada foi escrito");
    }
    expect(t.read("Loja/estoque.py")).toBe(PY);
  });
});

describe("a busca no conteúdo e o filtro (T21240)", () => {
  // Um token inventado num formato que o filtro reconhece, montado aqui para a linha não parecer um segredo.
  const TOKEN = ["ghp", "0123456789abcdefghijABCDEFGHIJ012345"].join("_");

  test("o trecho e a linha de um yaml saem do texto filtrado; o que só existe dentro do segredo não volta", async () => {
    const t = setup({ "Loja/config.yaml": `loja: cafe\nchave: ${TOKEN}\nentrega: jabuticaba\n` }, new SecretGuard());
    const r = await t.tool("notes_search", { query: "jabuticaba" });
    const hit = r.resultados.find((h: { path: string }) => h.path === "Loja/config.yaml");
    expect(hit).toMatchObject({ formato: "yaml", linha: 3 });
    expect(JSON.stringify(r)).not.toContain(TOKEN);
    // A parte do token não confirma o segredo.
    expect((await t.tool("notes_search", { query: "0123456789abcdefghijABCDEFGHIJ012345" })).resultados).toEqual([]);
  });

  test("o .env não aparece nem pelo conteúdo, nem com o filtro desligado", async () => {
    const t = setup({ "Loja/.env": "LOJA=pitomba\n", "Loja/prod.env": "LOJA=pitomba\n" });
    expect((await t.tool("notes_search", { query: "pitomba" })).resultados).toEqual([]);
  });
});
