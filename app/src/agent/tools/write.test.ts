// As ferramentas de escrita do Kiwi (spec #8356), pelo servidor MCP de verdade, sobre um cofre de verdade num tmp, as
// mesmas capacidades das janelas (`uiCapabilities`), o histórico de versões das Notas e o registro do agente. Nenhum
// agente, nenhuma rede além do 127.0.0.1.

import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { uiCapabilities } from "../../bun/ui-capabilities.ts";
import { Vault } from "../../notes/vault.ts";
import { MAX_VERSIONS, NoteVersions } from "../../notes/versions.ts";
import { DEFAULT_SETTINGS } from "../../store/settings.ts";
import { AgentActivity } from "../activity.ts";
import { readerFromCapabilities } from "./reader.ts";
import { KiwiToolServer, MAX_BODY, type KiwiMcpServerConfig, type ToolCallEvent } from "./server.ts";
import { DIARY_LINE_MAX, DIARY_STATUS_LINES, localDay, runKiwiTool, WRITE_MAX_CHARS, type ToolChange, type WriteJournal } from "./tools.ts";
import { EMPTY_READER } from "./reader.ts";
import { SecretGuard } from "../../guardrail/filter.ts";
import { WRITER_CAPABILITIES, writerFromCapabilities, type VaultWriter } from "./writer.ts";
import { undoNotesFromCapabilities } from "../undo.ts";
import { CSV_DELIMITER } from "./files-create.ts";
import { tempDir } from "../../../test/tmp.ts";

const dirs: string[] = [];
const servers: KiwiToolServer[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.stop();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const MEETING = "---\ntype: meeting\ndate: 2026-11-10\nduration: 60\n---\n\n## Minhas notas\n\norçamento\n\n## Transcrição\n\n**Ana** (00:00): Bom dia.\n";
const KIWI = "# Kiwi\n\nO Kiwi é um app de notas.\n\n## Prazo\n\nO prazo do Kiwi é março.\n\n## Equipe\n\nharry e jow.\n";
const versionOf = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

async function setup(o: { wrap?: (w: VaultWriter, root: string) => VaultWriter } = {}) {
  const base = tempDir("kiwi-write-");
  dirs.push(base);
  const root = path.join(base, "KiwiNotes");
  const files: Record<string, string> = { "Projetos/Kiwi.md": KIWI, "Ideias.md": "ideias soltas", "Reuniões/Orçamento.md": MEETING };
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  }
  // Um segredo fora do cofre, com um link simbólico para ele e outro para a pasta de fora.
  mkdirSync(path.join(base, "fora"));
  writeFileSync(path.join(base, "fora.md"), "SEGREDO DE FORA");
  symlinkSync(path.join(base, "fora.md"), path.join(root, "Atalho.md"));
  symlinkSync(path.join(base, "fora"), path.join(root, "Link"));
  // Uma nota em Latin-1 (um app antigo do Windows): o Kiwi só mostra.
  writeFileSync(path.join(root, "Latin.md"), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
  const v = new Vault({ root, debounceMs: 20, trash: async () => {} });
  const versions = new NoteVersions({ dir: path.join(base, "history") });
  const caps = uiCapabilities({
    dictionary: { load: async () => [], save: async (t) => t },
    snippets: { load: async () => [], save: async (s) => s },
    history: { search: async () => ({ entries: [] }), delete: async () => true, get: async () => null },
    dictationNotes: { toNew: async () => { throw new Error("not used"); }, append: async () => { throw new Error("not used"); } },
    settings: { load: async () => ({ ...DEFAULT_SETTINGS, notesShortcut: null }), save: async () => ({ ...DEFAULT_SETTINGS, notesShortcut: null }) },
    clipboardWrite: () => {},
    notes: v,
    versions,
  });
  // As capacidades que o escritor chama, anotadas: só as quatro dele passam por ele.
  const called = new Set<string>();
  const recorded = new Proxy(caps as Record<string, (a: unknown) => unknown>, {
    get: (t, cap: string) => (args: unknown) => {
      called.add(cap);
      return t[cap]!(args);
    },
  });
  const reader = readerFromCapabilities(caps as never);
  const plain = writerFromCapabilities(recorded as never);
  const writer = o.wrap ? o.wrap(plain, root) : plain;
  const activity = new AgentActivity({ dir: path.join(base, "agent", "activity") });
  const kept: string[] = [];
  const dropped: string[] = [];
  const journal: WriteJournal = {
    keep: async (_p, before) => {
      const c = await activity.keep("pedido-1", before);
      kept.push(c);
      return c;
    },
    drop: async (c) => {
      dropped.push(c);
      await activity.drop(c);
    },
  };
  const calls: ToolCallEvent[] = [];
  const server = new KiwiToolServer({ reader, writer, journal, onCall: (e) => calls.push(e) });
  servers.push(server);
  const config = server.start();
  const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
  const changes = () => calls.filter((c) => c.change).map((c) => c.change as ToolChange);
  return { base, root, v, caps, versions, activity, server, config, calls, called, kept, dropped, read, changes };
}

let id = 0;
async function rpc(config: KiwiMcpServerConfig, method: string, params?: unknown) {
  const h = Object.fromEntries(config.headers.map((x) => [x.name, x.value]));
  return fetch(config.url, { method: "POST", headers: { "Content-Type": "application/json", ...h }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
}

async function tool(config: KiwiMcpServerConfig, name: string, args: unknown = {}): Promise<{ value: any; error?: string }> {
  const res = await rpc(config, "tools/call", { name, arguments: args });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { result?: { content: { text: string }[]; isError?: boolean }; error?: { message: string } };
  if (body.error) return { value: null, error: body.error.message };
  const text = body.result!.content[0]!.text;
  return body.result!.isError ? { value: null, error: text } : { value: JSON.parse(text) };
}

describe("o servidor com o escritor (spec #8356)", () => {
  test("o tools/list traz as quinze, e só as seis de escrita (com o organizar a pasta, spec #11102, o diário do projeto, T11670, e o files_create, #11549) dizem que mudam o cofre", async () => {
    const { config } = await setup();
    const init = (await (await rpc(config, "initialize", { protocolVersion: "2025-06-18" })).json()) as any;
    expect(init.result.instructions).toContain("notes_write");
    expect(init.result.instructions).toContain("Versões");
    const list = (await (await rpc(config, "tools/list")).json()) as any;
    const byName = Object.fromEntries(list.result.tools.map((t: any) => [t.name, t]));
    expect(Object.keys(byName)).toEqual([
      "notes_search",
      "notes_outline",
      "notes_read",
      "notes_list",
      "meetings_list",
      "meetings_get",
      "projects_list",
      "project_status",
      "files_read",
      "notes_create",
      "notes_append",
      "notes_write",
      "project_diary_add",
      "notes_organize_folder",
      "files_create",
    ]);
    for (const name of ["notes_create", "notes_append", "notes_write", "project_diary_add", "notes_organize_folder", "files_create"]) {
      expect(byName[name].annotations).toMatchObject({ readOnlyHint: false, idempotentHint: false, openWorldHint: false });
      // Os campos internos da definição não vão para o agente.
      expect(byName[name].writes).toBeUndefined();
    }
    expect(byName.notes_write.annotations.destructiveHint).toBe(true);
    expect(byName.notes_append.annotations.destructiveHint).toBe(false);
    expect(byName.project_diary_add.annotations.destructiveHint).toBe(false);
    expect(init.result.instructions).toContain("project_diary_add");
    expect(byName.notes_read.annotations.readOnlyHint).toBe(true);
    expect(byName.notes_write.inputSchema.required).toEqual(["path", "text", "version"]);
  });

  test("não há ferramenta para apagar, renomear nem mover", async () => {
    const { config, read } = await setup();
    for (const name of ["notes_delete", "notes_rename", "notes_move", "folders_delete"]) {
      expect((await tool(config, name, { path: "Ideias.md" })).error).toContain("não tem a ferramenta");
    }
    expect(read("Ideias.md")).toBe("ideias soltas");
  });

  test("o notes_read devolve a versão da nota, também numa seção", async () => {
    const { config } = await setup();
    expect((await tool(config, "notes_read", { path: "Projetos/Kiwi.md" })).value.versao).toBe(versionOf(KIWI));
    expect((await tool(config, "notes_read", { path: "Projetos/Kiwi.md", section: "Prazo" })).value.versao).toBe(versionOf(KIWI));
  });
});

describe("notes_create", () => {
  test("cria a nota na pasta, criando a pasta, e diz o caminho e a versão", async () => {
    const { config, read, calls, changes } = await setup();
    const r = await tool(config, "notes_create", { folder: "Projetos/Novos", title: "Plano", text: "# Plano\n\n- um\n" });
    expect(r.value).toEqual({ path: "Projetos/Novos/Plano.md", titulo: "Plano", versao: versionOf("# Plano\n\n- um\n"), caracteres: 14 });
    expect(read("Projetos/Novos/Plano.md")).toBe("# Plano\n\n- um\n");
    expect(calls.at(-1)).toMatchObject({ tool: "notes_create", target: "Projetos/Novos/Plano.md", ok: true });
    expect(changes()).toEqual([{ kind: "created", path: "Projetos/Novos/Plano.md", before: 0, after: 14, version: versionOf("# Plano\n\n- um\n") }]);
  });

  test("com o título já usado, a nova ganha um número, e a outra fica como estava", async () => {
    const { config, read } = await setup();
    const r = await tool(config, "notes_create", { folder: "Projetos", title: "Kiwi", text: "outra" });
    expect(r.value.path).toBe("Projetos/Kiwi 2.md");
    expect(read("Projetos/Kiwi.md")).toBe(KIWI);
  });

  test("um título com barras ou pontos fica dentro da pasta; uma pasta com .. ou por link para fora é recusada", async () => {
    const { config, base, root } = await setup();
    const odd = (await tool(config, "notes_create", { title: "../../fora", text: "x" })).value.path as string;
    expect(odd).not.toContain("/");
    expect(odd.endsWith("fora.md")).toBe(true);
    expect(readFileSync(path.join(root, odd), "utf8")).toBe("x");
    expect(readFileSync(path.join(base, "fora.md"), "utf8")).toBe("SEGREDO DE FORA");
    expect((await tool(config, "notes_create", { folder: "../fora", title: "x", text: "x" })).error).toMatch(/E_BAD_ARGS|E_OUTSIDE_VAULT/);
    expect((await tool(config, "notes_create", { folder: "Link", title: "x", text: "x" })).error).toContain("E_OUTSIDE_VAULT");
    expect(readdirSync(path.join(base, "fora"))).toEqual([]);
  });

  test("não cria uma nota de reunião", async () => {
    const { config, root } = await setup();
    const r = await tool(config, "notes_create", { folder: "Reuniões", title: "Falsa", text: "---\ntype: meeting\n---\n\nnada\n" });
    expect(r.error).toContain("E_MEETING_NOTE");
    expect(existsSync(path.join(root, "Reuniões/Falsa.md"))).toBe(false);
  });
});

describe("notes_append", () => {
  test("no fim da nota, numa linha nova, sem mudar o resto; e o texto de antes vai para as Versões e para o registro", async () => {
    const { config, read, caps, activity, kept, changes } = await setup();
    const r = await tool(config, "notes_append", { path: "Ideias.md", text: "- uma ideia nova" });
    expect(read("Ideias.md")).toBe("ideias soltas\n- uma ideia nova\n");
    expect(r.value.versao).toBe(versionOf("ideias soltas\n- uma ideia nova\n"));
    // A cópia de antes, nos dois lugares.
    expect(await activity.copy(kept[0]!)).toBe("ideias soltas");
    const list = (await caps["notes.versions"]({ path: "Ideias.md" })) as { versions: { id: string }[] };
    const texts = await Promise.all(list.versions.map(async (x) => ((await caps["notes.version"]({ path: "Ideias.md", id: x.id })) as { content: string }).content));
    expect(texts).toContain("ideias soltas");
    expect(changes()).toEqual([
      { kind: "appended", path: "Ideias.md", before: 13, after: 31, version: versionOf("ideias soltas\n- uma ideia nova\n"), copy: kept[0] },
    ]);
    // A 2ª escrita, logo depois: a cópia de antes entra nas Versões na hora, sem os 2 minutos do histórico.
    await tool(config, "notes_append", { path: "Ideias.md", text: "- outra" });
    const again = (await caps["notes.versions"]({ path: "Ideias.md" })) as { versions: { id: string }[] };
    const texts2 = await Promise.all(again.versions.map(async (x) => ((await caps["notes.version"]({ path: "Ideias.md", id: x.id })) as { content: string }).content));
    expect(texts2).toContain("ideias soltas\n- uma ideia nova\n");
    expect(await activity.copy(kept[1]!)).toBe("ideias soltas\n- uma ideia nova\n");
  });

  test("no fim de uma seção, antes do próximo título, com a linha em branco no lugar", async () => {
    const { config, read, calls } = await setup();
    await tool(config, "notes_append", { path: "Projetos/Kiwi.md", section: "Prazo", text: "Pode mudar para abril." });
    expect(read("Projetos/Kiwi.md")).toBe(KIWI.replace("O prazo do Kiwi é março.\n\n", "O prazo do Kiwi é março.\nPode mudar para abril.\n\n"));
    expect(calls.at(-1)).toMatchObject({ tool: "notes_append", target: "Projetos/Kiwi.md › Prazo" });
    // A última seção vai até o fim da nota.
    await tool(config, "notes_append", { path: "Projetos/Kiwi.md", section: "Equipe", text: "\nE o Kiwi-cat." });
    expect(read("Projetos/Kiwi.md").endsWith("## Equipe\n\nharry e jow.\n\nE o Kiwi-cat.\n")).toBe(true);
    expect((await tool(config, "notes_append", { path: "Projetos/Kiwi.md", section: "Não existe", text: "x" })).error).toContain("E_NOT_FOUND");
  });

  test("um texto que começa com --- ou === não transforma o parágrafo de antes em título (revisão do T9251)", async () => {
    const { config, read } = await setup();
    const titles = async (p: string) => ((await tool(config, "notes_outline", { path: p })).value.secoes as { nivel: number; titulo: string }[]).map((x) => `${x.nivel} ${x.titulo}`);
    const before = await titles("Projetos/Kiwi.md");
    await tool(config, "notes_append", { path: "Projetos/Kiwi.md", section: "Prazo", text: "---\nResumo de hoje: nada mudou." });
    expect(await titles("Projetos/Kiwi.md")).toEqual(before);
    expect(read("Projetos/Kiwi.md")).toContain("O prazo do Kiwi é março.\n\n---\nResumo de hoje: nada mudou.\n\n## Equipe");
    await tool(config, "notes_append", { path: "Projetos/Kiwi.md", section: "Equipe", text: "  ===" });
    expect(await titles("Projetos/Kiwi.md")).toEqual(before);
    // No fim da nota também; e uma lista acrescentada a uma lista continua colada (#9305).
    await tool(config, "notes_create", { title: "Lista", text: "Compras\n- pão" });
    await tool(config, "notes_append", { path: "Lista.md", text: "- leite" });
    await tool(config, "notes_append", { path: "Lista.md", text: "===" });
    expect(read("Lista.md")).toBe("Compras\n- pão\n- leite\n\n===\n");
    expect(await titles("Lista.md")).toEqual([]);
  });

  test("com a versão lida, recusa se a nota mudou depois, e nada é escrito", async () => {
    const { config, read, root, kept, dropped } = await setup();
    const { versao } = (await tool(config, "notes_read", { path: "Ideias.md" })).value;
    writeFileSync(path.join(root, "Ideias.md"), "a pessoa mudou");
    const r = await tool(config, "notes_append", { path: "Ideias.md", text: "do agente", version: versao });
    expect(r.error).toContain("E_CHANGED");
    expect(r.error).toContain("leia de novo");
    expect(read("Ideias.md")).toBe("a pessoa mudou");
    expect(kept).toEqual([]);
    expect(dropped).toEqual([]);
  });

  test("um texto vazio é recusado", async () => {
    const { config } = await setup();
    expect((await tool(config, "notes_append", { path: "Ideias.md", text: "  \n" })).error).toContain("E_BAD_ARGS");
  });
});

describe("notes_write", () => {
  test("troca só o texto de uma seção, e o título fica (mandado junto ou não)", async () => {
    const { config, read, changes } = await setup();
    const v1 = (await tool(config, "notes_read", { path: "Projetos/Kiwi.md", section: "Prazo" })).value.versao;
    const r = await tool(config, "notes_write", { path: "Projetos/Kiwi.md", section: "Prazo", text: "O prazo é abril.", version: v1 });
    const after = KIWI.replace("O prazo do Kiwi é março.", "O prazo é abril.");
    expect(read("Projetos/Kiwi.md")).toBe(after);
    expect(r.value).toMatchObject({ path: "Projetos/Kiwi.md", secao: "Prazo", versao: versionOf(after) });
    // O agente manda a seção como o notes_read devolveu, com o título: ele não sai em dobro.
    await tool(config, "notes_write", { path: "Projetos/Kiwi.md", section: "Prazo", text: "## Prazo\n\nO prazo é maio.\n\n", version: versionOf(after) });
    expect(read("Projetos/Kiwi.md")).toBe(KIWI.replace("O prazo do Kiwi é março.", "O prazo é maio."));
    expect(changes().map((c) => [c.kind, c.section, c.before])).toEqual([
      ["replaced", "Prazo", KIWI.length],
      ["replaced", "Prazo", after.length],
    ]);
  });

  test("um título parecido no começo do texto não é tomado pelo da seção", async () => {
    const { config, read } = await setup();
    await tool(config, "notes_write", { path: "Projetos/Kiwi.md", section: "Prazo", text: "## Prazos antigos\n\nnenhum", version: versionOf(KIWI) });
    expect(read("Projetos/Kiwi.md")).toContain("## Prazo\n\n## Prazos antigos\n\nnenhum\n\n## Equipe");
  });

  test("sem seção, o texto vira a nota inteira", async () => {
    const { config, read } = await setup();
    await tool(config, "notes_write", { path: "Ideias.md", text: "---\ntags: [x]\n---\ntudo novo\n", version: versionOf("ideias soltas") });
    expect(read("Ideias.md")).toBe("---\ntags: [x]\n---\ntudo novo\n");
  });

  test("sem a versão, ou com uma versão velha, nada é escrito", async () => {
    const { config, read } = await setup();
    expect((await tool(config, "notes_write", { path: "Ideias.md", text: "x" })).error).toContain("E_BAD_ARGS");
    expect((await tool(config, "notes_write", { path: "Ideias.md", text: "x", version: "0000000000000000" })).error).toContain("E_CHANGED");
    expect(read("Ideias.md")).toBe("ideias soltas");
  });
});

describe("uma edição da pessoa nunca se perde", () => {
  /** Um escritor que deixa a pessoa mudar a nota bem entre a leitura do agente e a gravação. */
  const racing = (times: number) => (w: VaultWriter, root: string): VaultWriter => {
    let left = times;
    return {
      ...w,
      get: async (p) => {
        const n = await w.get(p);
        if (left-- > 0) writeFileSync(path.join(root, p), `${n.content}\nda pessoa ${times - left}`);
        return n;
      },
    };
  };

  test("o notes_write com a nota mudada no meio: recusa, a edição da pessoa fica, e a cópia sai do registro", async () => {
    const s = await setup({ wrap: racing(1) });
    const r = await tool(s.config, "notes_write", { path: "Ideias.md", text: "do agente", version: versionOf("ideias soltas") });
    expect(r.error).toContain("E_CHANGED");
    expect(s.read("Ideias.md")).toBe("ideias soltas\nda pessoa 1");
    expect(s.kept).toHaveLength(1);
    expect(s.dropped).toEqual(s.kept);
    expect(s.changes()).toEqual([]);
    await expect(s.activity.copy(s.kept[0]!)).rejects.toThrow();
  });

  test("o notes_append sem versão lê de novo e acrescenta depois da edição da pessoa", async () => {
    const s = await setup({ wrap: racing(2) });
    await tool(s.config, "notes_append", { path: "Ideias.md", text: "do agente" });
    expect(s.read("Ideias.md")).toBe("ideias soltas\nda pessoa 1\nda pessoa 2\ndo agente\n");
    expect(s.changes()).toHaveLength(1);
  });
});

describe("a cópia de antes", () => {
  test(`a do registro sobrevive ao limite de ${MAX_VERSIONS} versões por nota`, async () => {
    const { config, caps, activity, kept } = await setup();
    let version = versionOf("ideias soltas");
    for (let i = 0; i < MAX_VERSIONS + 5; i++) {
      version = (await tool(config, "notes_write", { path: "Ideias.md", text: `versão ${i}`, version })).value.versao;
    }
    const list = (await caps["notes.versions"]({ path: "Ideias.md" })) as { versions: { id: string }[] };
    expect(list.versions).toHaveLength(MAX_VERSIONS);
    const texts = await Promise.all(list.versions.map(async (x) => ((await caps["notes.version"]({ path: "Ideias.md", id: x.id })) as { content: string }).content));
    // Nas Versões, a mais velha já saiu; no registro, a cópia de antes da 1ª escrita continua.
    expect(texts).not.toContain("ideias soltas");
    expect(await activity.copy(kept[0]!)).toBe("ideias soltas");
    expect(kept).toHaveLength(MAX_VERSIONS + 5);
  }, 30_000);
});

describe("as notas de reunião ficam só para leitura", () => {
  test("acrescentar ou trocar numa nota de reunião é recusado, e ela fica como estava", async () => {
    const { config, read, kept } = await setup();
    const v = versionOf(MEETING);
    for (const [name, args] of [
      ["notes_append", { path: "Reuniões/Orçamento.md", text: "x" }],
      ["notes_append", { path: "Reuniões/Orçamento.md", section: "Minhas notas", text: "x" }],
      ["notes_write", { path: "Reuniões/Orçamento.md", text: "nada de reunião", version: v }],
      ["notes_write", { path: "Reuniões/Orçamento.md", section: "Minhas notas", text: "x", version: v }],
    ] as const) {
      expect((await tool(config, name, args)).error).toContain("E_MEETING_NOTE");
    }
    expect(read("Reuniões/Orçamento.md")).toBe(MEETING);
    expect(kept).toEqual([]);
  });

  test("uma nota comum não vira nota de reunião", async () => {
    const { config, read } = await setup();
    const r = await tool(config, "notes_write", { path: "Ideias.md", text: "---\ntype: meeting\n---\nfalsa\n", version: versionOf("ideias soltas") });
    expect(r.error).toContain("E_MEETING_NOTE");
    // Nem acrescentando o frontmatter numa nota vazia.
    await tool(config, "notes_create", { title: "Vazia", text: "" });
    expect((await tool(config, "notes_append", { path: "Vazia.md", text: "---\ntype: meeting\n---" })).error).toContain("E_MEETING_NOTE");
    expect(read("Ideias.md")).toBe("ideias soltas");
    expect(read("Vazia.md")).toBe("");
  });
});

describe("o teto de cada escrita", () => {
  test(`acima de ${WRITE_MAX_CHARS} caracteres, o aviso claro, nas três; no teto, grava`, async () => {
    const { config, read } = await setup();
    const big = "a".repeat(WRITE_MAX_CHARS + 1);
    for (const [name, args] of [
      ["notes_create", { title: "Grande", text: big }],
      ["notes_append", { path: "Ideias.md", text: big }],
      ["notes_write", { path: "Ideias.md", text: big, version: versionOf("ideias soltas") }],
    ] as const) {
      const r = await tool(config, name, args);
      expect(r.error).toContain("E_TOO_LARGE");
      expect(r.error).toContain(`até ${WRITE_MAX_CHARS}`);
      expect(r.error).toContain("por seção");
    }
    expect(read("Ideias.md")).toBe("ideias soltas");
    expect((await tool(config, "notes_append", { path: "Ideias.md", text: "b".repeat(WRITE_MAX_CHARS) })).value.caracteres).toBe(13 + 1 + WRITE_MAX_CHARS + 1);
  });

  test("um texto de 3 bytes por caractere, no teto e acima dele, chega à ferramenta (sem o 413 do servidor)", async () => {
    const { config, read } = await setup();
    const at = "語".repeat(WRITE_MAX_CHARS);
    expect(Buffer.byteLength(JSON.stringify({ text: at }))).toBeGreaterThan(64 * 1024);
    expect(Buffer.byteLength(JSON.stringify({ text: at }))).toBeLessThan(MAX_BODY);
    expect((await tool(config, "notes_create", { title: "Japonês", text: at })).value.caracteres).toBe(WRITE_MAX_CHARS);
    expect((await tool(config, "notes_create", { title: "Japonês 2", text: at + "語" })).error).toContain("E_TOO_LARGE");
    expect(read("Japonês.md")).toBe(at);
  });
});

describe("a fronteira do cofre", () => {
  test("fora do cofre, por link simbólico, uma nota que não é .md ou que não é UTF-8: nada é escrito", async () => {
    const { config, base, root } = await setup();
    for (const p of ["../fora.md", "Projetos/../../fora.md", path.join(base, "fora.md"), "Atalho.md", "Link/x.md"]) {
      expect((await tool(config, "notes_append", { path: p, text: "x" })).error).toMatch(/E_BAD_ARGS|E_OUTSIDE_VAULT|E_NOT_FOUND/);
      expect((await tool(config, "notes_write", { path: p, text: "x", version: "x" })).error).toMatch(/E_BAD_ARGS|E_OUTSIDE_VAULT|E_NOT_FOUND/);
    }
    expect((await tool(config, "notes_append", { path: "quadro.canvas", text: "x" })).error).toContain("E_BAD_ARGS");
    expect((await tool(config, "notes_append", { path: "Latin.md", text: "x" })).error).toContain("E_READ_ONLY");
    expect(readFileSync(path.join(base, "fora.md"), "utf8")).toBe("SEGREDO DE FORA");
    expect(readdirSync(path.join(base, "fora"))).toEqual([]);
    expect(readFileSync(path.join(root, "Latin.md"))).toEqual(Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
  });

  test("o escritor só chama as sete capacidades dele", async () => {
    const { config, called } = await setup();
    await tool(config, "notes_create", { title: "Nova", text: "x" });
    await tool(config, "files_create", { formato: "txt", nome: "Novo", conteudo: { blocos: [{ tipo: "paragrafo", texto: "x" }] } });
    await tool(config, "notes_append", { path: "Nova.md", text: "y" });
    // O .txt (spec #13379) se lê e grava pelos arquivos do cofre.
    await tool(config, "notes_append", { path: "Novo.txt", text: "y" });
    await tool(config, "notes_write", { path: "Nova.md", text: "z", version: versionOf("x\ny\n") });
    expect([...called].sort()).toEqual([...WRITER_CAPABILITIES].sort());
  });
});

describe("o diário do projeto (spec #11469, T11670)", () => {
  const mark = (root: string, main: string | null = "Projetos/Kiwi.md") => {
    mkdirSync(path.join(root, ".kiwi"), { recursive: true });
    writeFileSync(path.join(root, ".kiwi/projects.json"), JSON.stringify({ version: 1, projects: [{ folder: "Projetos", main }] }));
  };

  test("a 1ª linha cria a seção no fim da nota principal; as próximas entram no fim dela; o project_status devolve o diário", async () => {
    const { root, config, read, activity, kept, changes } = await setup();
    mark(root);
    const first = await tool(config, "project_diary_add", { projeto: "Projetos", texto: "  Mudei o   prazo para abril.  " });
    const day = localDay(new Date());
    expect(read("Projetos/Kiwi.md")).toBe(`${KIWI}\n## Diário do agente\n\n- ${day}: Mudei o prazo para abril.\n`);
    expect(first.value).toEqual({ projeto: "Projetos", path: "Projetos/Kiwi.md", linha: `- ${day}: Mudei o prazo para abril.`, versao: expect.any(String) });
    // Uma escrita como as outras: a cópia de antes (o [Desfazer]) e a Atividade, com a seção.
    expect(await activity.copy(kept[0]!)).toBe(KIWI);
    expect(changes()[0]).toMatchObject({ kind: "appended", path: "Projetos/Kiwi.md", section: "Diário do agente", before: KIWI.length, copy: kept[0] });
    // Pelo nome, e com um "- " que o agente pôs na frente: sai um só.
    await tool(config, "project_diary_add", { projeto: "projetos", texto: "- Pus o gato na equipe." });
    expect(read("Projetos/Kiwi.md")).toBe(`${KIWI}\n## Diário do agente\n\n- ${day}: Mudei o prazo para abril.\n- ${day}: Pus o gato na equipe.\n`);
    const s = await tool(config, "project_status", { projeto: "Projetos" });
    expect(s.value.diario).toEqual([`${day}: Mudei o prazo para abril.`, `${day}: Pus o gato na equipe.`]);
  });

  test("com a seção no meio da nota, a linha entra no fim dela e o resto não muda; o status leva só as últimas linhas", async () => {
    const { root, config, read } = await setup();
    mark(root);
    const old = Array.from({ length: DIARY_STATUS_LINES + 2 }, (_, i) => `- 2026-01-${String(i + 1).padStart(2, "0")}: passo ${i + 1}`).join("\n");
    const note = `# Kiwi\n\n## Diário do agente\n\n${old}\n\n## Equipe\n\nharry e jow.\n`;
    writeFileSync(path.join(root, "Projetos/Kiwi.md"), note);
    await tool(config, "project_diary_add", { projeto: "Projetos", texto: "Mais um passo." });
    const day = localDay(new Date());
    expect(read("Projetos/Kiwi.md")).toBe(`# Kiwi\n\n## Diário do agente\n\n${old}\n- ${day}: Mais um passo.\n\n## Equipe\n\nharry e jow.\n`);
    const s = await tool(config, "project_status", { projeto: "Projetos" });
    expect(s.value.diario).toHaveLength(DIARY_STATUS_LINES);
    expect(s.value.diario.at(-1)).toBe(`${day}: Mais um passo.`);
    expect(s.value.aviso).toContain(`O diário tem ${DIARY_STATUS_LINES + 3} linhas`);
    // Uma seção vazia ganha a linha com a linha em branco depois do título.
    writeFileSync(path.join(root, "Projetos/Kiwi.md"), "# Kiwi\n\n## Diário do agente\n");
    await tool(config, "project_diary_add", { projeto: "Projetos", texto: "Começo." });
    expect(read("Projetos/Kiwi.md")).toBe(`# Kiwi\n\n## Diário do agente\n\n- ${day}: Começo.\n`);
  });

  test("recusa o que não dá: um projeto que não existe, sem nota principal, a frase vazia ou longa, sem o escritor", async () => {
    const { root, config, read } = await setup();
    mark(root);
    expect((await tool(config, "project_diary_add", { projeto: "Solto", texto: "x" })).error).toContain("E_NOT_FOUND");
    expect((await tool(config, "project_diary_add", { projeto: "Projetos", texto: "   " })).error).toContain("E_BAD_ARGS");
    expect((await tool(config, "project_diary_add", { projeto: "Projetos", texto: "x".repeat(DIARY_LINE_MAX + 1) })).error).toContain("E_BAD_ARGS");
    expect(read("Projetos/Kiwi.md")).toBe(KIWI);
    // A nota principal apagada (os projetos são lidos uma vez por cofre: um cofre novo).
    const other = await setup();
    mark(other.root, null);
    expect((await tool(other.config, "project_diary_add", { projeto: "Projetos", texto: "x" })).error).toMatch(/E_NOT_FOUND.*sem nota principal/);
    // Só leitura (o agente sem escrever): a ferramenta nem existe.
    const ro = new KiwiToolServer({ reader: readerFromCapabilities({} as never) });
    servers.push(ro);
    expect((await tool(ro.start(), "project_diary_add", { projeto: "Projetos", texto: "x" })).error).toContain("não tem a ferramenta project_diary_add");
  });
});

describe("files_create: o Kiwi gera o arquivo com o que o agente manda (spec #11549)", () => {
  const TABELA = [["Mês", "Exames", "Obs"], ["Outubro", "1200", "ok; revisado"], ["Novembro", "980", "aspas \"assim\""]];
  const BLOCOS = [
    { tipo: "titulo", texto: "Relatório da migração", nivel: 1 },
    { tipo: "paragrafo", texto: "O arquivo de 2019 vai primeiro. Ação: revisar a cotação." },
    { tipo: "titulo", texto: "Próximos passos", nivel: 2 },
    { tipo: "item", texto: "Confirmar a janela" },
    { tipo: "tabela", linhas: [["Ano", "Exames"], ["2019", "1200"]] },
  ];

  test("gera txt, csv, xlsx, docx e pdf, e cada um abre certo (relido pelo files_read)", async () => {
    const { config, changes, root } = await setup();
    const make = async (formato: string, conteudo: unknown, nome = "Relatório") => {
      const r = await tool(config, "files_create", { formato, nome, pasta: "Saída", conteudo });
      expect(r.error).toBeUndefined();
      expect(r.value).toMatchObject({ caminho: `Saída/${nome}.${formato}`, formato });
      return (await tool(config, "files_read", { caminho: r.value.caminho })).value;
    };
    expect((await make("txt", { blocos: BLOCOS })).texto).toBe(
      "# Relatório da migração\n\nO arquivo de 2019 vai primeiro. Ação: revisar a cotação.\n\n## Próximos passos\n\n- Confirmar a janela\n| Ano | Exames |\n| 2019 | 1200 |",
    );
    // O csv com `;` e o BOM (o Excel em português), as aspas e o `;` dentro da célula protegidos.
    const csv = await make("csv", { tabela: TABELA });
    expect(csv.texto).toBe("| Mês | Exames | Obs |\n| --- | --- | --- |\n| Outubro | 1200 | ok; revisado |\n| Novembro | 980 | aspas \"assim\" |");
    const bytes = readFileSync(path.join(root, "Saída/Relatório.csv"));
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.toString("utf8")).toContain(`Outubro${CSV_DELIMITER}1200${CSV_DELIMITER}"ok; revisado"`);
    // O xlsx com duas abas; o número vira número (o Excel soma), e volta igual na leitura.
    const xlsx = await make("xlsx", { abas: [{ nome: "Exames", tabela: TABELA }, { nome: "Resumo", tabela: [["Total"], ["2180"]] }] });
    expect(xlsx.sumario.abas).toEqual([
      { nome: "Exames", linhas: 3, colunas: 3 },
      { nome: "Resumo", linhas: 2, colunas: 1 },
    ]);
    expect(xlsx.texto).toContain("| Outubro | 1200 | ok; revisado |");
    const docx = await make("docx", { blocos: BLOCOS });
    expect(docx.texto).toBe("# Relatório da migração\nO arquivo de 2019 vai primeiro. Ação: revisar a cotação.\n## Próximos passos\n- Confirmar a janela\n| Ano | Exames |\n| 2019 | 1200 |");
    const pdf = await make("pdf", { blocos: BLOCOS });
    expect(pdf.texto).toBe("Relatório da migração\nO arquivo de 2019 vai primeiro. Ação: revisar a cotação.\nPróximos passos\n• Confirmar a janela\nAno | Exames\n2019 | 1200");
    // Cada arquivo é uma mudança "created" do registro, com o tamanho e a versão dos bytes.
    expect(changes().map((c) => [c.kind, c.path])).toEqual(["txt", "csv", "xlsx", "docx", "pdf"].map((f) => ["created", `Saída/Relatório.${f}`]));
    const pdfBytes = readFileSync(path.join(root, "Saída/Relatório.pdf"));
    expect(changes().at(-1)).toMatchObject({ before: 0, after: pdfBytes.length, version: createHash("sha256").update(pdfBytes).digest("hex").slice(0, 16) });
  });

  test("nunca por cima de outro arquivo: o nome usado ganha um número", async () => {
    const { config, root } = await setup();
    writeFileSync(path.join(root, "Vendas.csv"), "antigo");
    const r = await tool(config, "files_create", { formato: "csv", nome: "Vendas.csv", conteudo: { tabela: [["a"]] } });
    expect(r.value.caminho).toBe("Vendas 2.csv");
    expect(readFileSync(path.join(root, "Vendas.csv"), "utf8")).toBe("antigo");
  });

  test("o conteúdo errado para o formato, o nome com outra extensão, a pasta fora do cofre e o segredo de outra nota são recusados", async () => {
    const { config, root } = await setup();
    const bad = async (args: unknown) => (await tool(config, "files_create", args)).error ?? "";
    expect(await bad({ formato: "csv", nome: "x", conteudo: { blocos: [{ tipo: "paragrafo", texto: "a" }] } })).toContain("E_BAD_ARGS");
    expect(await bad({ formato: "xlsx", nome: "x", conteudo: {} })).toContain("E_BAD_ARGS");
    expect(await bad({ formato: "pdf", nome: "x", conteudo: { blocos: [], tabela: [["a"]] } })).toContain("E_BAD_ARGS");
    expect(await bad({ formato: "pdf", nome: "x.docx", conteudo: { blocos: [] } })).toContain("E_BAD_ARGS");
    expect(await bad({ formato: "exe", nome: "x", conteudo: { blocos: [] } })).toContain("E_BAD_ARGS");
    expect(await bad({ formato: "txt", nome: "x", pasta: "../fora", conteudo: { blocos: [] } })).toMatch(/E_OUTSIDE_VAULT|E_BAD_ARGS/);
    expect(await bad({ formato: "txt", nome: "x", pasta: "Link", conteudo: { blocos: [] } })).toContain("E_OUTSIDE_VAULT");
    expect(readdirSync(path.join(root, "..", "fora"))).toEqual([]);
  });

  test("o [Desfazer] manda o arquivo para a Lixeira, só se ele ainda é o que o agente gerou", async () => {
    const { config, caps, root, changes } = await setup();
    const undo = undoNotesFromCapabilities(caps as never);
    await tool(config, "files_create", { formato: "pdf", nome: "Laudo", conteudo: { blocos: [{ tipo: "paragrafo", texto: "a" }] } });
    await tool(config, "files_create", { formato: "txt", nome: "Notas", conteudo: { blocos: [{ tipo: "paragrafo", texto: "a" }] } });
    const [pdf, txt] = changes();
    expect((await undo.get(pdf!.path))?.version).toBe(pdf!.version);
    // O txt mudou depois do agente: não sai do lugar.
    writeFileSync(path.join(root, "Notas.txt"), "a pessoa mudou");
    expect(await undo.trash(txt!.path, txt!.version)).toBe("changed");
    expect(existsSync(path.join(root, "Notas.txt"))).toBe(true);
    expect(await undo.trash(pdf!.path, pdf!.version)).toBe("trashed");
    expect(existsSync(path.join(root, "Laudo.pdf"))).toBe(false);
    expect(await undo.trash(pdf!.path, pdf!.version)).toBe("gone");
    expect(await undo.get(pdf!.path)).toBeNull();
  });
});

test("files_create: o segredo de outra nota (o marcador do filtro) não vai para um arquivo", async () => {
  const guard = new SecretGuard();
  const marker = /‹segredo [^›]+›/.exec(guard.request("a chave é ghp_0123456789abcdefghijABCDEFGHIJ012345 e pronto").text)?.[0];
  expect(marker).toBeDefined();
  const made: string[] = [];
  const writer: VaultWriter = {
    get: async () => {
      throw new Error("não usado");
    },
    save: async () => ({ saved: false }),
    create: async () => {
      throw new Error("não usado");
    },
    folder: async () => null,
    createFile: async (_f, name, bytes) => (made.push(name), { path: name, size: bytes.length, version: "v" }),
  };
  const journal: WriteJournal = { keep: async () => "c", drop: async () => {} };
  const ctx = { reader: EMPTY_READER, writer, journal, guard };
  await expect(runKiwiTool(ctx, "files_create", { formato: "txt", nome: "x", conteudo: { blocos: [{ tipo: "paragrafo", texto: `usar ${marker}` }] } })).rejects.toThrow(/marcador/);
  await expect(runKiwiTool(ctx, "files_create", { formato: "csv", nome: "x", conteudo: { tabela: [["Token"], [marker!]] } })).rejects.toThrow(/marcador/);
  expect(made).toEqual([]);
});
