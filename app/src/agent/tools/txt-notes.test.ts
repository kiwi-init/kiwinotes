// As notas .txt nas ferramentas do agente e a pasta pelo nome (spec #13379), sobre um cofre de verdade num tmp, com as
// mesmas capacidades das janelas (`uiCapabilities`). As chamadas são as das ferramentas do Kiwi (`runKiwiTool`), como o
// agente falso as faz; nenhum agente roda aqui.

import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { uiCapabilities } from "../../bun/ui-capabilities.ts";
import { Vault } from "../../notes/vault.ts";
import { NoteVersions } from "../../notes/versions.ts";
import { DEFAULT_SETTINGS } from "../../store/settings.ts";
import { AgentActivity } from "../activity.ts";
import { undo, undoNotesFromCapabilities } from "../undo.ts";
import { readerFromCapabilities, searchTextNotes } from "./reader.ts";
import { folderNamed, runKiwiTool, ToolError } from "./tools.ts";
import { writerFromCapabilities } from "./writer.ts";
import { tempDir } from "../../../test/tmp.ts";

const vaults: Vault[] = [];
afterEach(() => {
  for (const v of vaults.splice(0)) v.close?.();
});

const ANOTACOES = "reunião com o time do PACS\n- migrar o legado até março\n- revisar os PRs abertos\nresponsável: harry\n";

type Caps = Record<string, (a: unknown) => unknown>;

function setup(files: Record<string, string> = {}) {
  const base = tempDir("kiwi-txt-");
  const root = path.join(base, "KiwiNotes");
  const all = {
    "Trabalho/legacy-pr/anotacoes.txt": ANOTACOES,
    "Trabalho/legacy-pr/Plano.md": "# Plano\n\nfase 1\n",
    "Pessoal/Ideias.md": "# Ideias\n\nnada do legado aqui\n",
    ...files,
  };
  for (const [rel, content] of Object.entries(all)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  }
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
  let clock = Date.parse("2026-11-14T12:00:00.000Z");
  const now = () => clock;
  const activity = new AgentActivity({ dir: path.join(base, "agent", "activity"), now });
  const reader = readerFromCapabilities(caps as never);
  const writer = writerFromCapabilities(caps as never);
  const asked: string[] = [];
  let answer = true;
  // Um pedido novo a cada montagem: a resposta da pergunta do .txt vale só dentro do pedido.
  const id = `p-${randomUUID()}`;
  const decider = {
    request: id,
    answers: {} as never,
    questions: { confirm: async (_r: string, q: string) => (asked.push(q), answer) } as never,
  };
  const tool = async (name: string, args: unknown) => {
    clock += 1000;
    const journal = { keep: (_p: string, before: string) => activity.keep(id, before), drop: (c: string) => activity.drop(c) };
    const r = await runKiwiTool({ reader, writer, journal, decider }, name, args);
    if (r.change) await activity.change(id, r.change);
    return r.value as Record<string, any>;
  };
  return {
    root,
    tool,
    asked,
    answer: (yes: boolean) => (answer = yes),
    begin: () => activity.begin(id, "organize as anotações da pasta Legacy PR"),
    undo: () => undo({ activity, notes: undoNotesFromCapabilities(caps as never), now }, id),
    read: (rel: string) => readFileSync(path.join(root, rel), "utf8"),
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

describe("o agente acha e organiza as notas .txt (spec #13379)", () => {
  test('"organize as anotações da pasta Legacy PR": uma chamada acha a pasta legacy-pr, e a lista traz o .txt', async () => {
    const t = setup();
    const r = await t.tool("notes_list", { folder: "Legacy PR" });
    expect(r.pasta).toBe("Trabalho/legacy-pr");
    expect(r.aviso).toContain('Achei a pasta "Trabalho/legacy-pr" pelo nome "Legacy PR".');
    expect(r.notas.map((n: { path: string }) => n.path).sort()).toEqual(["Trabalho/legacy-pr/Plano.md", "Trabalho/legacy-pr/anotacoes.txt"]);
    expect(r.notas.find((n: { path: string }) => n.path.endsWith(".txt"))).toMatchObject({ titulo: "anotacoes", formato: "txt", caracteres: Buffer.byteLength(ANOTACOES) });
    // O organizar a pasta também acha pelo nome, e conta o .txt.
    const o = await t.tool("notes_organize_folder", { folder: "legacy_PR" });
    expect(o).toMatchObject({ pasta: "Trabalho/legacy-pr", total: 2, confirmou: true });
    expect(o.notas).toContain("Trabalho/legacy-pr/anotacoes.txt");
  });

  test("a busca acha o .txt pelo texto e pelo nome, sem diferenciar acento, e respeita o path:", async () => {
    const t = setup();
    const byText = await t.tool("notes_search", { query: "migrar legado" });
    expect(byText.resultados.map((h: { path: string }) => h.path)).toContain("Trabalho/legacy-pr/anotacoes.txt");
    const hit = byText.resultados.find((h: { path: string }) => h.path.endsWith(".txt"));
    expect(hit).toMatchObject({ titulo: "anotacoes" });
    expect(hit.trecho).toContain("migrar o legado");
    expect((await t.tool("notes_search", { query: "anotações" })).resultados.map((h: { path: string }) => h.path)).toContain("Trabalho/legacy-pr/anotacoes.txt");
    expect((await t.tool("notes_search", { query: "migrar path:Pessoal" })).resultados).toEqual([]);
    expect((await t.tool("notes_search", { query: "palavra-que-nao-existe" })).resultados).toEqual([]);
  });

  test("ler, acrescentar e reescrever um .txt; reescrever pergunta antes, uma vez; o [Desfazer] volta o texto", async () => {
    const t = setup();
    await t.begin();
    const r = await t.tool("notes_read", { path: "Trabalho/legacy-pr/anotacoes.txt" });
    expect(r).toMatchObject({ path: "Trabalho/legacy-pr/anotacoes.txt", titulo: "anotacoes", texto: ANOTACOES });
    expect(typeof r.versao).toBe("string");

    const a = await t.tool("notes_append", { path: "Trabalho/legacy-pr/anotacoes.txt", text: "- marcar a próxima reunião", version: r.versao });
    expect(t.read("Trabalho/legacy-pr/anotacoes.txt")).toBe(`${ANOTACOES}- marcar a próxima reunião\n`);
    expect(t.asked).toEqual([]); // acrescentar não perde nada: não pergunta

    const organized = "# Legacy PR\n\n## Tarefas\n\n- migrar o legado até março\n- revisar os PRs abertos\n- marcar a próxima reunião\n\nResponsável: harry\n";
    await t.tool("notes_write", { path: "Trabalho/legacy-pr/anotacoes.txt", text: organized, version: a.versao });
    expect(t.read("Trabalho/legacy-pr/anotacoes.txt")).toBe(organized);
    expect(t.asked).toHaveLength(1);
    expect(t.asked[0]).toContain("Reescrever Trabalho/legacy-pr/anotacoes.txt organizado");

    // Mesmo arquivo, mesmo pedido: a resposta vale, sem perguntar de novo.
    const again = await t.tool("notes_read", { path: "Trabalho/legacy-pr/anotacoes.txt" });
    await t.tool("notes_write", { path: "Trabalho/legacy-pr/anotacoes.txt", text: `${organized}\n`, version: again.versao });
    expect(t.asked).toHaveLength(1);

    // O [Desfazer] do pedido volta o .txt ao texto de antes da primeira escrita.
    expect(await t.undo()).toMatchObject({ notes: [{ path: "Trabalho/legacy-pr/anotacoes.txt", result: "restored" }] });
    expect(t.read("Trabalho/legacy-pr/anotacoes.txt")).toBe(ANOTACOES);
  });

  test("com o não, o .txt fica como está, e o agente sabe que deve oferecer um .md ao lado", async () => {
    const t = setup({ "Trabalho/legacy-pr/outro.txt": "texto solto\n" });
    t.answer(false);
    const r = await t.tool("notes_read", { path: "Trabalho/legacy-pr/outro.txt" });
    let message = "";
    try {
      await t.tool("notes_write", { path: "Trabalho/legacy-pr/outro.txt", text: "# Outro\n\ntexto solto\n", version: r.versao });
    } catch (e) {
      expect((e as ToolError).code).toBe("E_DECLINED");
      message = (e as Error).message;
    }
    expect(message).toContain("ofereça criar uma nota .md organizada ao lado");
    expect(t.read("Trabalho/legacy-pr/outro.txt")).toBe("texto solto\n");
    // A pessoa pediu o .md: ele nasce ao lado, e o .txt continua igual.
    const md = await t.tool("notes_create", { folder: "Trabalho/legacy-pr", title: "outro", text: "# Outro\n\ntexto solto\n" });
    expect(md.path).toBe("Trabalho/legacy-pr/outro.md");
    expect(t.read("Trabalho/legacy-pr/outro.txt")).toBe("texto solto\n");
  });

  test("um .txt mudado depois da leitura não é escrito por cima", async () => {
    const t = setup();
    const r = await t.tool("notes_read", { path: "Trabalho/legacy-pr/anotacoes.txt" });
    writeFileSync(path.join(t.root, "Trabalho/legacy-pr/anotacoes.txt"), "a pessoa mudou\n");
    expect(await code(t.tool("notes_write", { path: "Trabalho/legacy-pr/anotacoes.txt", text: "x", version: r.versao }))).toBe("E_CHANGED");
    expect(t.read("Trabalho/legacy-pr/anotacoes.txt")).toBe("a pessoa mudou\n");
  });
});

describe("a pasta pelo nome (spec #13379)", () => {
  const folders = ["Trabalho", "Trabalho/legacy-pr", "Pessoal", "Pessoal/Viagens", "Arquivo/Legacy_PR", "Clientes", "Clientes/Ação Social"];
  test("a exata, a única parecida pelo caminho ou pelo último nome, sem maiúscula, acento, espaço, - e _", () => {
    expect(folderNamed(folders, "Pessoal")).toBe("Pessoal");
    expect(folderNamed(folders, "")).toBe("");
    expect(folderNamed(folders, "/viagens/")).toBe("Pessoal/Viagens");
    expect(folderNamed(folders, "acao social")).toBe("Clientes/Ação Social");
    expect(folderNamed(folders, "trabalho/Legacy PR")).toBe("Trabalho/legacy-pr");
  });
  test("duas com o mesmo nome: pergunta qual; nenhuma: diz as parecidas", () => {
    expect(() => folderNamed(folders, "Legacy PR")).toThrow(/há 2 pastas chamadas Legacy PR; diga qual: Trabalho\/legacy-pr, Arquivo\/Legacy_PR/);
    expect(() => folderNamed(folders, "Legacy")).toThrow(/a pasta Legacy não existe; as parecidas: Trabalho\/legacy-pr, Arquivo\/Legacy_PR/);
    expect(() => folderNamed(folders, "Nada")).toThrow(/^a pasta Nada não existe$/);
  });
});

describe("a busca nos .txt (spec #13379)", () => {
  test("lê no máximo 4 MB por busca (revisão do #524): passado o total, o resto casa só pelo nome", async () => {
    const files = Array.from({ length: 20 }, (_, i) => ({ path: `a/nota-${i}.txt`, size: 500 * 1024, mtime: "" }));
    files.push({ path: "a/legado-no-nome.txt", size: 500 * 1024, mtime: "" });
    let bytes = 0;
    const hits = await searchTextNotes("legado", files, async (p) => {
      bytes += files.find((f) => f.path === p)!.size;
      return "sem a palavra";
    }, 10);
    expect(bytes).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect(hits.map((h) => h.path)).toEqual(["a/legado-no-nome.txt"]);
  });

  test("lê no máximo os de até 512 KB; o maior casa só pelo nome", async () => {
    const files = [
      { path: "a/grande-legado.txt", size: 600 * 1024, mtime: "" },
      { path: "a/grande.txt", size: 600 * 1024, mtime: "" },
      { path: "a/x.md", size: 10, mtime: "" },
    ];
    const read: string[] = [];
    const hits = await searchTextNotes("legado", files, async (p) => (read.push(p), "legado"), 10);
    expect(hits.map((h) => h.path)).toEqual(["a/grande-legado.txt"]);
    expect(read).toEqual([]);
  });
});

/**
 * Um agente de teste, sem modelo: o caminho que o agente fez no pedido do harry (#13473), com cada chamada de
 * ferramenta contando como uma ida ao modelo. Tenta a pasta pelo nome; sem ela, lista a raiz e desce pelas pastas
 * comparando os nomes; dentro dela, procura as anotações na lista e, sem elas, na busca; e lê o que achou.
 */
async function hunt(call: (name: string, args: unknown) => Promise<Record<string, any>>, folder: string) {
  let calls = 0;
  let errors = 0;
  const use = async (name: string, args: unknown) => {
    calls++;
    try {
      return await call(name, args);
    } catch {
      errors++;
      return null;
    }
  };
  const key = (t: string) => t.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[\s_-]+/g, "");
  let list = await use("notes_list", { folder });
  if (!list) {
    const queue = [""];
    while (queue.length && !list) {
      const here = await use("notes_list", { folder: queue.shift() });
      for (const p of (here?.pastas ?? []) as string[]) {
        if (key(p.split("/").pop()!) === key(folder)) {
          list = await use("notes_list", { folder: p });
          break;
        }
        queue.push(p);
      }
    }
  }
  let path = ((list?.notas ?? []) as { path: string }[]).find((n) => /anota/i.test(n.path))?.path;
  if (!path) {
    const found = await use("notes_search", { query: `anotações path:${list?.pasta ?? ""}` });
    path = found?.resultados?.[0]?.path;
    // A busca não achou: o agente tenta os nomes de sempre.
    for (const guess of path ? [] : ["anotacoes.md", "anotacoes.txt", "Anotações.md"]) {
      const r = await use("notes_read", { path: `${list?.pasta}/${guess}` });
      if (r) {
        path = r.path;
        break;
      }
    }
  }
  const text = path ? (await use("notes_read", { path }))?.texto : undefined;
  return { calls, errors, text };
}

describe("as idas ao modelo no pedido do harry (spec #13379, #13473)", () => {
  test('"organize as anotações da pasta Legacy PR": de muitas idas com erro para 2, sem erro', async () => {
    // Um cofre com o formato do do harry: a pasta mais funda e outras pastas no caminho.
    const t = setup({ "Arquivo/2025/velho.md": "# Velho\n", "Clientes/Acme/Acme.md": "# Acme\n", "Trabalho/Outros/x.md": "# x\n" });
    const now = await hunt((n, a) => t.tool(n, a), "Legacy PR");
    expect(now).toEqual({ calls: 2, errors: 0, text: ANOTACOES });

    // O mesmo agente com as ferramentas como eram na main: a pasta só pelo nome exato, e o .txt fora da lista, da
    // busca e do notes_read (o vault só lê .md como nota).
    const folders = new Set(
      readdirSync(t.root, { recursive: true, withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => path.relative(t.root, path.join(d.parentPath, d.name)).split(path.sep).join("/")),
    );
    const before = await hunt(async (name, args) => {
      const a = args as Record<string, unknown>;
      if (name === "notes_list" && typeof a.folder === "string" && a.folder && !folders.has(a.folder))
        throw new ToolError("E_NOT_FOUND", `a pasta ${a.folder} não existe`);
      if (name === "notes_read" && /\.txt$/i.test(String(a.path))) throw new ToolError("E_BAD_ARGS", "path must end in .md");
      const r = await t.tool(name, args);
      if (name === "notes_list") r.notas = r.notas.filter((n: { path: string }) => !n.path.endsWith(".txt"));
      if (name === "notes_search") r.resultados = r.resultados.filter((h: { path: string }) => !h.path.endsWith(".txt"));
      return r;
    }, "Legacy PR");
    // 11 idas, 4 com erro, e as anotações não aparecem (no pedido do harry, 19 idas e 10 leituras com erro).
    expect(before).toEqual({ calls: 11, errors: 4, text: undefined });
  });
});
