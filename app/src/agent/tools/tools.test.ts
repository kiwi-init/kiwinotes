// As ferramentas do Kiwi para o agente (spec #7496), pelo servidor MCP de verdade, sobre um cofre de verdade num tmp e
// as mesmas capacidades das janelas (`uiCapabilities`). Nenhum agente, nenhuma rede além do 127.0.0.1.

import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { uiCapabilities } from "../../bun/ui-capabilities.ts";
import { Vault } from "../../notes/vault.ts";
import { DEFAULT_SETTINGS } from "../../store/settings.ts";
import { READER_CAPABILITIES, readerFromCapabilities, type VaultReader } from "./reader.ts";
import { KIWI_TOOLS, kiwiTools, LIST_PAGE, READ_MAX_CHARS, runKiwiTool, SEARCH_MAX } from "./tools.ts";
import { readDocument } from "./files.ts";
import { SecretGuard } from "../../guardrail/filter.ts";
import * as XLSX from "xlsx";
import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow } from "docx";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { KiwiToolServer, MCP_VERSIONS, TOKEN_HEADER, type KiwiMcpServerConfig, type ToolCallEvent } from "./server.ts";
import { tempDir } from "../../../test/tmp.ts";

const dirs: string[] = [];
const servers: KiwiToolServer[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.stop();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const SEG = (n: number, who: string) => `%%meeting-segment:${n.toString(16).padStart(24, "0")} {"s":${n},"e":${n + 1},"c":"system","l":"${who}"}%%`;

const MEETING = `---
type: meeting
date: 2026-11-10
start: 2026-11-10T14:00:00.000Z
end: 2026-11-10T14:30:00.000Z
duration: 1800
app: Teams
participants:
  - Ana
  - Bruno
---

## Minhas notas

lembrar do orçamento

## Transcrição

**Ana** (00:00): Bom dia, vamos falar do orçamento. ${SEG(1, "Ana")}
**Bruno** (00:05): O orçamento fecha em dezembro. ${SEG(2, "Bruno")}
`;

const BIG = "# Grande\n\n" + Array.from({ length: 900 }, (_, i) => `Linha ${i} do texto grande, com algumas palavras.`).join("\n") + "\n";

async function setup(extra: Record<string, string> = {}) {
  const base = tempDir("kiwi-tools-");
  dirs.push(base);
  const root = path.join(base, "KiwiNotes");
  const files: Record<string, string> = {
    "Projetos/Kiwi.md": "---\ntags: [app]\n---\n# Kiwi\n\nO Kiwi é um app de notas.\n\n## Prazo\n\nO prazo do Kiwi é março.\n\n## Equipe\n\nharry e jow.\n",
    "Projetos/Antigo/Velho.md": "nada",
    "Ideias.md": "ideias soltas sobre gatos",
    "Grande.md": BIG,
    "Reuniões/Orçamento.md": MEETING,
    ...extra,
  };
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  }
  // Um projeto marcado (spec #9874), como o `projects.mark` grava: a pasta, a nota principal e o inode dela.
  if (files["Projetos/Kiwi.md"] !== undefined) {
    const main = "Projetos/Kiwi.md";
    mkdirSync(path.join(root, ".kiwi"), { recursive: true });
    const projects = [{ folder: "Projetos", main, mainIno: statSync(path.join(root, main)).ino, folderIno: statSync(path.join(root, "Projetos")).ino }];
    writeFileSync(path.join(root, ".kiwi/projects.json"), `${JSON.stringify({ version: 1, projects }, null, 2)}\n`);
  }
  // Um segredo fora do cofre, e um link simbólico de dentro para ele.
  writeFileSync(path.join(base, "fora.md"), "SEGREDO DE FORA");
  symlinkSync(path.join(base, "fora.md"), path.join(root, "Atalho.md"));
  const v = new Vault({ root, debounceMs: 20, trash: async () => {} });
  const caps = uiCapabilities({
    dictionary: { load: async () => [], save: async (t) => t },
    snippets: { load: async () => [], save: async (s) => s },
    history: { search: async () => ({ entries: [] }), delete: async () => true, get: async () => null },
    dictationNotes: { toNew: async () => { throw new Error("not used"); }, append: async () => { throw new Error("not used"); } },
    settings: { load: async () => ({ ...DEFAULT_SETTINGS, notesShortcut: null }), save: async () => ({ ...DEFAULT_SETTINGS, notesShortcut: null }) },
    clipboardWrite: () => {},
    notes: v,
  });
  // As capacidades que o leitor chama, anotadas: o teste confere que só as de leitura passam por ele.
  const called = new Set<string>();
  const recorded = new Proxy(caps as Record<string, (a: unknown) => unknown>, {
    get: (t, cap: string) => (args: unknown) => {
      called.add(cap);
      return t[cap]!(args);
    },
  });
  const reader = readerFromCapabilities(recorded as never);
  const calls: ToolCallEvent[] = [];
  const methods: string[] = [];
  const server = new KiwiToolServer({ reader, onCall: (e) => calls.push(e), onRequest: (m) => methods.push(m) });
  servers.push(server);
  const config = server.start();
  return { root, base, v, reader, server, config, calls, methods, called };
}

let id = 0;
async function rpc(config: KiwiMcpServerConfig, method: string, params?: unknown, headers?: Record<string, string>) {
  const h = Object.fromEntries(config.headers.map((x) => [x.name, x.value]));
  return fetch(config.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...h, ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
}

async function tool(config: KiwiMcpServerConfig, name: string, args: unknown = {}): Promise<{ value: any; error?: string }> {
  const res = await rpc(config, "tools/call", { name, arguments: args });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { result: { content: { text: string }[]; isError?: boolean } };
  const text = body.result.content[0]!.text;
  return body.result.isError ? { value: null, error: text } : { value: JSON.parse(text) };
}

/** O hash e o mtime de cada arquivo do cofre: nada pode mudar depois das ferramentas. */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile()) out[path.relative(root, abs)] = `${createHash("sha256").update(readFileSync(abs)).digest("hex")} ${statSync(abs).mtimeMs}`;
    }
  };
  walk(root);
  return out;
}

describe("o servidor MCP do Kiwi", () => {
  test("só escuta no 127.0.0.1, numa porta sorteada, e cada abertura tem uma senha nova", async () => {
    const { server, config } = await setup();
    expect(config.type).toBe("http");
    expect(config.name).toBe("kiwi");
    expect(config.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    const token = config.headers.find((h) => h.name === TOKEN_HEADER)!.value;
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    server.stop();
    const again = server.start();
    expect(again.headers[0]!.value).not.toBe(token);
    // A senha velha não vale mais.
    const res = await rpc({ ...again, headers: [{ name: TOKEN_HEADER, value: token }] }, "tools/list");
    expect(res.status).toBe(401);
  });

  test("sem a senha, com a senha errada ou de uma página do navegador, nada entra", async () => {
    const { config, methods } = await setup();
    expect((await rpc({ ...config, headers: [] }, "tools/list")).status).toBe(401);
    expect((await rpc({ ...config, headers: [{ name: TOKEN_HEADER, value: "x".repeat(64) }] }, "tools/list")).status).toBe(401);
    expect((await rpc(config, "tools/list", undefined, { Origin: "http://evil.example" })).status).toBe(403);
    expect(methods).toEqual([]);
    // O GET (stream do servidor) não existe; outro caminho, 404.
    const h = Object.fromEntries(config.headers.map((x) => [x.name, x.value]));
    expect((await fetch(config.url, { headers: h })).status).toBe(405);
    expect((await fetch(config.url.replace("/mcp", "/outra"), { method: "POST", headers: h })).status).toBe(404);
  });

  test("o initialize combina a versão do MCP, e o tools/list traz as nove, só de leitura", async () => {
    const { config } = await setup();
    const init = (await (await rpc(config, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } })).json()) as any;
    expect(init.result.protocolVersion).toBe("2025-06-18");
    expect(init.result.capabilities.tools).toBeDefined();
    const unknown = (await (await rpc(config, "initialize", { protocolVersion: "1999-01-01" })).json()) as any;
    expect(unknown.result.protocolVersion).toBe(MCP_VERSIONS[0]);
    // Uma notificação não tem resposta: 202.
    const h = Object.fromEntries(config.headers.map((x) => [x.name, x.value]));
    const note = await fetch(config.url, { method: "POST", headers: { "Content-Type": "application/json", ...h }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
    expect(note.status).toBe(202);
    const list = (await (await rpc(config, "tools/list")).json()) as any;
    const names = list.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(["notes_search", "notes_outline", "notes_read", "notes_list", "meetings_list", "meetings_get", "projects_list", "project_status", "files_read"]);
    for (const t of list.result.tools) {
      expect(t.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/); // o que a API do Claude aceita
      expect(t.annotations.readOnlyHint).toBe(true);
      expect(t.annotations.openWorldHint).toBe(false);
      expect(t.inputSchema.type).toBe("object");
    }
    // Sem o escritor, só as nove de leitura (com o files_read, #11549); as quatro de escrita (spec #8356 e o organizar a pasta, #11102) e as propostas
    // (a da reunião, spec #8360, e o resumo executivo, #11546) e as duas da memória (#11469) existem, mas não aparecem.
    expect(kiwiTools(false)).toHaveLength(9);
    expect(KIWI_TOOLS).toHaveLength(21);
  });

  test("uma ferramenta que não existe é recusada, e um método desconhecido também", async () => {
    const { config } = await setup();
    const bad = (await (await rpc(config, "tools/call", { name: "notes_write", arguments: {} })).json()) as any;
    expect(bad.error.code).toBe(-32602);
    const other = (await (await rpc(config, "resources/list")).json()) as any;
    expect(other.error.code).toBe(-32601);
  });

  test("fechado, ninguém mais conecta", async () => {
    const { server, config } = await setup();
    server.stop();
    await expect(rpc(config, "tools/list")).rejects.toThrow();
  });
});

describe("as ferramentas", () => {
  test("notes_search: o caminho, o título e o trecho, com o teto de resultados", async () => {
    const { config, calls } = await setup();
    const r = await tool(config, "notes_search", { query: "prazo" });
    expect(r.value.resultados[0].path).toBe("Projetos/Kiwi.md");
    expect(r.value.resultados[0].titulo).toBe("Kiwi");
    expect(r.value.resultados[0].trecho).toContain("prazo");
    expect(calls.at(-1)).toEqual({ tool: "notes_search", target: '"prazo"', ok: true });
    const tooMany = await tool(config, "notes_search", { query: "prazo", limit: SEARCH_MAX + 1 });
    expect(tooMany.error).toContain("E_BAD_ARGS");
    expect((await tool(config, "notes_search", { query: "prazo", extra: 1 })).error).toContain("campo desconhecido");
  });

  test("notes_outline: os títulos e o tamanho de cada seção", async () => {
    const { config } = await setup();
    const r = await tool(config, "notes_outline", { path: "Projetos/Kiwi.md" });
    expect(r.value.secoes.map((s: { titulo: string; nivel: number }) => [s.nivel, s.titulo])).toEqual([[1, "Kiwi"], [2, "Prazo"], [2, "Equipe"]]);
    const prazo = r.value.secoes[1];
    expect(prazo.caracteres).toBe("## Prazo\n\nO prazo do Kiwi é março.\n\n".length);
  });

  test("notes_read: a nota como está, ou só uma seção", async () => {
    const { config, root, calls } = await setup();
    const whole = await tool(config, "notes_read", { path: "Projetos/Kiwi.md" });
    expect(whole.value.texto).toBe(readFileSync(path.join(root, "Projetos/Kiwi.md"), "utf8"));
    expect(whole.value.proximoOffset).toBeUndefined();
    const section = await tool(config, "notes_read", { path: "Projetos/Kiwi.md", section: "Prazo" });
    expect(section.value.secao).toBe("Prazo");
    expect(section.value.texto).toBe("## Prazo\n\nO prazo do Kiwi é março.\n\n");
    expect(calls.at(-1)).toEqual({ tool: "notes_read", target: "Projetos/Kiwi.md › Prazo", ok: true });
    expect((await tool(config, "notes_read", { path: "Projetos/Kiwi.md", section: "Não existe" })).error).toContain("E_NOT_FOUND");
  });

  test("notes_read: o teto, o aviso de que há mais e a continuação, até o fim", async () => {
    const { config } = await setup();
    expect(BIG.length).toBeGreaterThan(READ_MAX_CHARS * 2);
    let offset: number | undefined = 0;
    let text = "";
    let rounds = 0;
    while (offset !== undefined) {
      const r = await tool(config, "notes_read", { path: "Grande.md", offset });
      expect(r.value.texto.length).toBeLessThanOrEqual(READ_MAX_CHARS);
      expect(r.value.total).toBe(BIG.length);
      if (r.value.proximoOffset !== undefined) {
        expect(r.value.aviso).toContain(`offset=${r.value.proximoOffset}`);
        // Corta numa quebra de linha.
        expect(r.value.texto.endsWith("\n")).toBe(true);
      }
      text += r.value.texto;
      offset = r.value.proximoOffset;
      rounds++;
    }
    expect(text).toBe(BIG);
    expect(rounds).toBeGreaterThanOrEqual(3);
    expect((await tool(config, "notes_read", { path: "Grande.md", offset: BIG.length + 1 })).error).toContain("E_BAD_ARGS");
  });

  test("notes_list: as pastas e as notas de uma pasta, só o 1º nível", async () => {
    const { config } = await setup();
    const top = await tool(config, "notes_list", {});
    expect(top.value.pastas).toEqual(expect.arrayContaining(["Projetos", "Reuniões"]));
    expect(top.value.pastas).not.toContain("Projetos/Antigo");
    expect(top.value.notas.map((n: { path: string }) => n.path)).toEqual(expect.arrayContaining(["Ideias.md", "Grande.md"]));
    expect(top.value.notas.map((n: { path: string }) => n.path)).not.toContain("Projetos/Kiwi.md");
    const proj = await tool(config, "notes_list", { folder: "Projetos" });
    expect(proj.value.pastas).toEqual(["Projetos/Antigo"]);
    expect(proj.value.notas.map((n: { path: string }) => n.path)).toEqual(["Projetos/Kiwi.md"]);
    expect((await tool(config, "notes_list", { folder: "Nada" })).error).toContain("E_NOT_FOUND");
    expect((await tool(config, "notes_list", { folder: "../.." })).error).toContain("E_NOT_FOUND");
  });

  test("notes_list: uma pasta grande vem em páginas, com a continuação", async () => {
    const many = Object.fromEntries(Array.from({ length: LIST_PAGE + 5 }, (_, i) => [`Muitas/N${String(i).padStart(3, "0")}.md`, "x"]));
    const { config } = await setup(many);
    const first = await tool(config, "notes_list", { folder: "Muitas" });
    expect(first.value.notas).toHaveLength(LIST_PAGE);
    expect(first.value.total).toBe(LIST_PAGE + 5);
    expect(first.value.proximoOffset).toBe(LIST_PAGE);
    const rest = await tool(config, "notes_list", { folder: "Muitas", offset: first.value.proximoOffset });
    expect(rest.value.notas).toHaveLength(5);
    expect(rest.value.proximoOffset).toBeUndefined();
  });

  test("meetings_list e meetings_get: as reuniões e a transcrição, sem as marcas internas", async () => {
    const { config } = await setup();
    const list = await tool(config, "meetings_list", {});
    expect(list.value.reunioes).toEqual([
      { path: "Reuniões/Orçamento.md", titulo: "Orçamento", dia: "2026-11-10", inicio: "2026-11-10T14:00:00.000Z", duracaoSegundos: 1800, app: "Teams", participantes: ["Ana", "Bruno"] },
    ]);
    const get = await tool(config, "meetings_get", { path: "Reuniões/Orçamento.md" });
    expect(get.value.participantes).toEqual(["Ana", "Bruno"]);
    expect(get.value.texto).toBe("**Ana** (00:00): Bom dia, vamos falar do orçamento.\n**Bruno** (00:05): O orçamento fecha em dezembro.");
    expect(get.value.texto).not.toContain("meeting-segment");
    // Por trecho: a partir de um offset.
    const part = await tool(config, "meetings_get", { path: "Reuniões/Orçamento.md", offset: get.value.texto.indexOf("**Bruno**") });
    expect(part.value.texto).toBe("**Bruno** (00:05): O orçamento fecha em dezembro.");
    // Uma nota comum não é reunião.
    expect((await tool(config, "meetings_get", { path: "Ideias.md" })).error).toContain("E_NOT_MEETING");
  });

  test("meetings_get: uma transcrição longa vem em trechos, com a continuação", async () => {
    const lines = Array.from({ length: 600 }, (_, i) => `**Ana** (00:${String(i % 60).padStart(2, "0")}): fala número ${i} sobre o orçamento do ano. ${SEG(i + 10, "Ana")}`).join("\n");
    const { config } = await setup({ "Reuniões/Longa.md": MEETING.replace(/## Transcrição[\s\S]*$/, `## Transcrição\n\n${lines}\n`) });
    const first = await tool(config, "meetings_get", { path: "Reuniões/Longa.md" });
    expect(first.value.proximoOffset).toBeGreaterThan(0);
    let text = first.value.texto;
    let next = first.value.proximoOffset;
    while (next !== undefined) {
      const r = await tool(config, "meetings_get", { path: "Reuniões/Longa.md", offset: next });
      text += r.value.texto;
      next = r.value.proximoOffset;
    }
    expect(text.split("\n")).toHaveLength(600);
    expect(text).not.toContain("%%");
  });
});

describe("os projetos (spec #9874)", () => {
  const projects = (root: string, list: { folder: string; main: string | null }[]) => {
    mkdirSync(path.join(root, ".kiwi"), { recursive: true });
    writeFileSync(path.join(root, ".kiwi/projects.json"), JSON.stringify({ version: 1, projects: list }));
  };

  test("projects_list devolve os projetos, e o project_status acha pelo nome ou pela pasta, só contando", async () => {
    const { config, calls } = await setup({ "Projetos/Tarefas.md": "- [ ] a\n- [x] b\n\n```\n- [ ] código\n```\n" });
    const list = await tool(config, "projects_list");
    expect(list.value).toEqual({
      projetos: [{ nome: "Projetos", pasta: "Projetos", notaPrincipal: "Projetos/Kiwi.md", mudou: expect.any(String), notas: 3 }],
      total: 1,
    });
    for (const projeto of ["Projetos", "projetos", "/Projetos/"]) {
      const s = await tool(config, "project_status", { projeto });
      expect(s.value).toMatchObject({
        projeto: "Projetos",
        pasta: "Projetos",
        notaPrincipal: "Projetos/Kiwi.md",
        notas: 3,
        sumario: [
          { nivel: 1, titulo: "Kiwi" },
          { nivel: 2, titulo: "Prazo" },
          { nivel: 2, titulo: "Equipe" },
        ],
        tarefasAbertas: { total: 1, notas: 1, porNota: [{ path: "Projetos/Tarefas.md", abertas: 1 }] },
      });
      expect(s.value.recentes).toHaveLength(3);
      // Só contado: nada do texto das notas vai junto.
      expect(JSON.stringify(s.value)).not.toContain("março");
      expect(s.value.aviso).toBeUndefined();
    }
    expect(calls.filter((c) => c.tool === "project_status").map((c) => c.target)).toEqual(["Projetos", "Projetos", "Projetos"]);
  });

  test("o projeto sem nota principal avisa; o nome repetido pede a pasta; o que não é projeto é E_NOT_FOUND", async () => {
    const { config, root } = await setup({ "A/Kiwi/x.md": "", "B/Kiwi/y.md": "", "Solto/z.md": "" });
    projects(root, [
      { folder: "A/Kiwi", main: null },
      { folder: "B/Kiwi", main: "B/Kiwi/y.md" },
    ]);
    const list = await tool(config, "projects_list");
    expect(list.value.projetos[0]).toMatchObject({ pasta: "A/Kiwi", notaPrincipal: null, aviso: expect.stringContaining("apagada") });
    expect((await tool(config, "project_status", { projeto: "Kiwi" })).error).toMatch(/E_AMBIGUOUS.*A\/Kiwi, B\/Kiwi/);
    const a = await tool(config, "project_status", { projeto: "A/Kiwi" });
    expect(a.value).toMatchObject({ pasta: "A/Kiwi", notaPrincipal: null, sumario: [], aviso: expect.stringContaining("apagada") });
    expect((await tool(config, "project_status", { projeto: "Solto" })).error).toContain("E_NOT_FOUND");
    expect((await tool(config, "project_status", {})).error).toContain("E_BAD_ARGS");
    expect((await tool(config, "project_status", { projeto: "B/Kiwi", folder: "x" })).error).toContain("E_BAD_ARGS");
  });

  test("o agente não marca nem desmarca: não há ferramenta para isso", async () => {
    const { config } = await setup();
    for (const name of ["projects_mark", "projects_unmark", "projects_setMain"]) {
      const bad = (await (await rpc(config, "tools/call", { name, arguments: { folder: "Projetos" } })).json()) as any;
      expect(bad.error.code).toBe(-32602);
    }
    expect(READER_CAPABILITIES).not.toContain("projects.mark");
    expect(READER_CAPABILITIES).not.toContain("projects.unmark");
    expect(READER_CAPABILITIES).not.toContain("projects.setMain");
  });
});

describe("a fronteira do cofre: nada escreve, nada sai", () => {
  test("caminho com .., absoluto ou por link simbólico para fora é recusado", async () => {
    const { config, base } = await setup();
    for (const p of ["../fora.md", "Projetos/../../fora.md", path.join(base, "fora.md"), "Atalho.md"]) {
      for (const name of ["notes_read", "notes_outline", "meetings_get"]) {
        const r = await tool(config, name, { path: p });
        expect(r.error ?? "").toMatch(/E_BAD_ARGS|E_OUTSIDE_VAULT|E_NOT_FOUND/);
        expect(r.error ?? "").not.toContain("SEGREDO");
      }
    }
    // O link simbólico é recusado pela fronteira das Notas, e não por não existir.
    expect((await tool(config, "notes_read", { path: "Atalho.md" })).error).toContain("E_OUTSIDE_VAULT");
    const search = await tool(config, "notes_search", { query: "SEGREDO" });
    expect(search.value.resultados).toEqual([]);
  });

  test("depois de usar todas as ferramentas, nenhum arquivo do cofre mudou, e só as capacidades de leitura foram chamadas", async () => {
    const { config, root, called } = await setup({ "Dados/tabela.csv": "Nome;Valor\nAna;10\n" });
    await Bun.sleep(30);
    const before = snapshot(root);
    await tool(config, "notes_search", { query: "Kiwi" });
    await tool(config, "notes_outline", { path: "Projetos/Kiwi.md" });
    await tool(config, "notes_read", { path: "Projetos/Kiwi.md" });
    await tool(config, "notes_read", { path: "Grande.md", offset: 100 });
    await tool(config, "notes_list", { folder: "Projetos" });
    await tool(config, "meetings_list", {});
    await tool(config, "meetings_get", { path: "Reuniões/Orçamento.md" });
    expect((await tool(config, "projects_list", {})).value.total).toBe(1);
    expect((await tool(config, "project_status", { projeto: "Projetos" })).value.pasta).toBe("Projetos");
    expect((await tool(config, "files_read", { caminho: "Dados/tabela.csv" })).value.formato).toBe("csv");
    await Bun.sleep(50);
    expect(snapshot(root)).toEqual(before);
    expect([...called].sort()).toEqual([...READER_CAPABILITIES].sort());
  });

  test("o leitor só conhece as sete capacidades de leitura", () => {
    const reader: VaultReader = readerFromCapabilities(
      new Proxy({} as never, {
        get: (_t, cap: string) => {
          if (!(READER_CAPABILITIES as readonly string[]).includes(cap)) throw new Error(`chamou ${cap}`);
          return () => ({ meetings: [] });
        },
      }),
    );
    expect(Object.keys(reader).sort()).toEqual(["file", "get", "list", "meetings", "projectStatus", "projects", "search"]);
  });
});

// Os arquivos de exemplo, criados aqui: nunca um arquivo de verdade da pessoa.
function xlsxBytes(sheets: Record<string, string[][]>): Uint8Array {
  const book = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  return new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}
async function docxBytes(): Promise<Uint8Array> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: "Relatório da migração", heading: HeadingLevel.HEADING_1 }),
          new Paragraph("O arquivo de 2019 vai primeiro."),
          new Paragraph({ text: "Próximos passos", heading: HeadingLevel.HEADING_2 }),
          new Paragraph({ text: "Confirmar a janela", bullet: { level: 0 } }),
          new Table({ rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph("Ano")] }), new TableCell({ children: [new Paragraph("Exames")] })] }), new TableRow({ children: [new TableCell({ children: [new Paragraph("2019")] }), new TableCell({ children: [new Paragraph("1200")] })] })] }),
        ],
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}
async function pdfBytes(pages: string[][]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = pdf.addPage([595, 842]);
    lines.forEach((l, i) => page.drawText(l, { x: 50, y: 780 - i * 20, size: 12, font }));
  }
  return pdf.save();
}

describe("files_read: o agente lê planilhas, documentos e pdfs do cofre (spec #11549)", () => {
  async function vault(files: Record<string, Uint8Array | string>) {
    const s = await setup();
    for (const [rel, data] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(s.root, rel)), { recursive: true });
      writeFileSync(path.join(s.root, rel), data);
    }
    return s;
  }
  const GH = "ghp_0123456789abcdefghijABCDEFGHIJ012345";

  test("o csv vira a tabela com o cabeçalho, e o segredo de uma célula vira o marcador", async () => {
    const { reader } = await vault({ "Dados/contas.csv": `Nome;Nota\nAna;${GH}\nBruno;nada\n` });
    const guard = new SecretGuard();
    const r = await runKiwiTool({ reader, guard }, "files_read", { caminho: "Dados/contas.csv" });
    expect(r.value).toMatchObject({ formato: "csv", partes: 1, parte: 1, sumario: { linhas: 3 } });
    const texto = r.value.texto as string;
    expect(texto.split("\n")).toEqual(["| Nome | Nota |", "| --- | --- |", expect.stringMatching(/^\| Ana \| ‹segredo [^›]+› \|$/), "| Bruno | nada |"]);
    expect(texto).not.toContain(GH);
    // A contagem do que o filtro segurou vai para a Atividade (nunca o valor).
    expect(r.held).toBe(1);
  });

  test("o xlsx com várias abas: o sumário, o índice e as partes de até 2.000 linhas, com o cabeçalho em cada uma", async () => {
    const vendas = [["Mês", "Valor"], ...Array.from({ length: 2500 }, (_, i) => [`M${i + 1}`, String(i)])];
    const bytes = xlsxBytes({ Vendas: vendas, Resumo: [["Total"], ["2500"]] });
    // As partes pelas linhas: sem o limite de caracteres, só as 2.000 linhas cortam.
    const doc = await readDocument("x.xlsx", bytes, 10_000_000);
    expect(doc.summary.abas).toEqual([
      { nome: "Vendas", linhas: 2501, colunas: 2 },
      { nome: "Resumo", linhas: 2, colunas: 1 },
    ]);
    expect(doc.parts.map((p) => p.label)).toEqual(["Aba Vendas, linhas 2–2001", "Aba Vendas, linhas 2002–2501", "Aba Resumo, linhas 2–2"]);
    expect(doc.parts[1]!.text.startsWith("| Mês | Valor |\n| --- | --- |\n| M2001 | 2000 |")).toBe(true);
    // Pela ferramenta, as partes cabem no pedaço de leitura: a 1ª, o índice, e a próxima pelo número.
    const { reader } = await vault({ "Dados/vendas.xlsx": bytes });
    const first = await runKiwiTool({ reader }, "files_read", { caminho: "Dados/vendas.xlsx" });
    expect(first.value.partes).toBeGreaterThan(3);
    expect((first.value.texto as string).length).toBeLessThanOrEqual(READ_MAX_CHARS);
    expect(first.value).toMatchObject({ parte: 1, proximaParte: 2, rotulo: expect.stringMatching(/^Aba Vendas, linhas 2–/) });
    expect(first.value.aviso).toContain("Há mais");
    const last = await runKiwiTool({ reader }, "files_read", { caminho: "Dados/vendas.xlsx", parte: first.value.partes });
    expect(last.value).toMatchObject({ rotulo: "Aba Resumo, linhas 2–2", texto: "| Total |\n| --- |\n| 2500 |" });
    expect(last.value.proximaParte).toBeUndefined();
    await expect(runKiwiTool({ reader }, "files_read", { caminho: "Dados/vendas.xlsx", parte: (first.value.partes as number) + 1 })).rejects.toMatchObject({ code: "E_BAD_ARGS" });
  });

  test("o nome de uma aba também passa pelo filtro: no sumário, no índice e no rótulo (revisão do T11691)", async () => {
    const KEY = "AKIA2E0A8F3B244C9986";
    const { reader } = await vault({ "Dados/chaves.xlsx": xlsxBytes({ [KEY]: [["a"], ["b"]] }) });
    const guard = new SecretGuard();
    const r = await runKiwiTool({ reader, guard }, "files_read", { caminho: "Dados/chaves.xlsx" });
    expect(JSON.stringify(r.value)).not.toContain(KEY);
    const v = r.value as { sumario: { abas: { nome: string }[] }; rotulo: string; indice: { rotulo: string }[] };
    expect(v.sumario.abas[0]!.nome).toMatch(/^‹segredo [^›]+›$/);
    expect(v.rotulo).toMatch(/^Aba ‹segredo [^›]+›, linhas 2–2$/);
    expect(v.indice[0]!.rotulo).toBe(v.rotulo);
  });

  test("o docx vira o texto com os títulos, a lista e a tabela", async () => {
    const { reader } = await vault({ "Docs/relatorio.docx": await docxBytes() });
    const r = await runKiwiTool({ reader }, "files_read", { caminho: "Docs/relatorio.docx" });
    expect(r.value.formato).toBe("docx");
    expect(r.value.texto).toBe("# Relatório da migração\nO arquivo de 2019 vai primeiro.\n## Próximos passos\n- Confirmar a janela\n| Ano | Exames |\n| 2019 | 1200 |");
  });

  test("o pdf vira o texto de cada página, uma parte por página; um pdf sem texto avisa", async () => {
    const { reader } = await vault({
      "Docs/laudo.pdf": await pdfBytes([["Primeira página", "com duas linhas"], ["Segunda página"]]),
      "Docs/escaneado.pdf": await pdfBytes([[]]),
    });
    const r = await runKiwiTool({ reader }, "files_read", { caminho: "Docs/laudo.pdf" });
    expect(r.value).toMatchObject({ formato: "pdf", sumario: { paginas: 2 }, partes: 2, rotulo: "Página 1", texto: "Primeira página\ncom duas linhas" });
    expect(r.value.indice).toEqual([
      { parte: 1, rotulo: "Página 1" },
      { parte: 2, rotulo: "Página 2" },
    ]);
    expect((await runKiwiTool({ reader }, "files_read", { caminho: "Docs/laudo.pdf", parte: 2 })).value.texto).toBe("Segunda página");
    const scanned = await runKiwiTool({ reader }, "files_read", { caminho: "Docs/escaneado.pdf" });
    expect(scanned.value.aviso).toContain("não tem texto");
    expect(scanned.value.texto).toBe("");
  });

  test("só dentro do cofre, só os formatos do spec, e até 20 MB", async () => {
    const s = await vault({ "Docs/nota.txt": "uma linha\noutra", "Docs/foto.png": "x", "Docs/grande.txt": "a".repeat(21 * 1024 * 1024) });
    writeFileSync(path.join(s.base, "fora.csv"), `Segredo\nSEGREDO DE FORA`);
    symlinkSync(path.join(s.base, "fora.csv"), path.join(s.root, "Atalho.csv"));
    const r = await runKiwiTool({ reader: s.reader }, "files_read", { caminho: "Docs/nota.txt" });
    expect(r.value).toMatchObject({ formato: "txt", texto: "uma linha\noutra" });
    for (const caminho of ["../fora.csv", "/etc/hosts.txt", "Atalho.csv"]) {
      const e = await runKiwiTool({ reader: s.reader }, "files_read", { caminho }).catch((x) => x);
      expect(e.code).toMatch(/E_OUTSIDE_VAULT|E_NOT_FOUND|E_BAD_ARGS/);
      expect(String(e.message)).not.toContain("SEGREDO");
    }
    expect((await runKiwiTool({ reader: s.reader }, "files_read", { caminho: "../fora.csv" }).catch((x) => x)).code).toBe("E_OUTSIDE_VAULT");
    await expect(runKiwiTool({ reader: s.reader }, "files_read", { caminho: "Docs/foto.png" })).rejects.toMatchObject({ code: "E_BAD_ARGS" });
    await expect(runKiwiTool({ reader: s.reader }, "files_read", { caminho: "Projetos/Kiwi.md" })).rejects.toThrow("notes_read");
    await expect(runKiwiTool({ reader: s.reader }, "files_read", { caminho: "Docs/grande.txt" })).rejects.toMatchObject({ code: "E_TOO_LARGE" });
    await expect(runKiwiTool({ reader: s.reader }, "files_read", { caminho: "Docs/nada.csv" })).rejects.toMatchObject({ code: "E_NOT_FOUND" });
  });
});
