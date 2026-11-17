// O agente vê todo arquivo da pasta, não só as notas (spec #17587), sobre um cofre de verdade num tmp, com as mesmas
// capacidades das janelas (`uiCapabilities`). As chamadas são as das ferramentas do Kiwi (`runKiwiTool`), como o agente
// falso as faz; nenhum agente roda aqui. Os arquivos são inventados: o conteúdo não importa para listar nem para achar
// pelo nome.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { uiCapabilities } from "../../bun/ui-capabilities.ts";
import { Vault } from "../../notes/vault.ts";
import { NoteVersions } from "../../notes/versions.ts";
import { DEFAULT_SETTINGS } from "../../store/settings.ts";
import { readerFromCapabilities, searchFileNames } from "./reader.ts";
import { fileCard, LIST_PAGE, runKiwiTool } from "./tools.ts";
import { runKiwiCall } from "./kiwi-tool.ts";
import { buildFile } from "./files-create.ts";
import { pptxBytes, zipBytes } from "../../../test/office-files.ts";
import { writerFromCapabilities } from "./writer.ts";
import { tempDir } from "../../../test/tmp.ts";

const vaults: Vault[] = [];
afterEach(() => {
  for (const v of vaults.splice(0)) v.close?.();
});

/** A pasta do spec: uma nota e seis arquivos de outros tipos, mais uma imagem que o Kiwi não lê. */
const PASTA = {
  "Projeto X/Resumo.md": "# Resumo\n\no projeto X em uma página\n",
  "Projeto X/Proposta Comercial.pdf": "%PDF-1.4 inventado",
  "Projeto X/contrato.docx": "PK inventado",
  "Projeto X/orcamento.xlsx": "PK inventado",
  "Projeto X/apresentacao.pptx": "PK inventado",
  "Projeto X/clientes.csv": "nome,cidade\nAna,Recife\n",
  "Projeto X/anexos.zip": "PK inventado",
  "Projeto X/foto.png": "png inventado",
  "Projeto X/LEIAME": "sem extensão",
  "Projeto X/fase 2/cronograma.pdf": "%PDF-1.4 inventado",
  "Pessoal/Ideias.md": "# Ideias\n\nnada do projeto aqui\n",
  "Pessoal/proposta-antiga.pdf": "%PDF-1.4 inventado",
};

function setup(files: Record<string, string | Uint8Array> = PASTA) {
  const base = tempDir("kiwi-arquivos-");
  const root = path.join(base, "KiwiNotes");
  for (const [rel, content] of Object.entries(files)) {
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
  }) as Record<string, (a: unknown) => unknown>;
  const reader = readerFromCapabilities(caps as never);
  const writer = writerFromCapabilities(caps as never);
  const decider = { request: "p-arquivos", answers: {} as never, questions: { confirm: async () => true } as never };
  const journal = { keep: async () => "", drop: async () => {} };
  const ctx = { reader, writer, journal: journal as never, decider };
  const tool = async (name: string, args: unknown) => (await runKiwiTool(ctx, name, args)).value as Record<string, any>;
  /** O que o agente falso faz: uma chamada da `kiwi`, como `kiwi ler <alvo>`, só com leitura. */
  const kiwi = async (call: Record<string, unknown>) => {
    const r = await runKiwiCall(ctx, call, { writes: false, proposes: false, memory: false });
    return { tool: r.tool, value: r.value as Record<string, any> };
  };
  return Object.assign(tool, { kiwi });
}

describe("o agente vê todo arquivo da pasta (spec #17587)", () => {
  test("listar a pasta mostra a nota e os outros arquivos, cada um com o tipo, o tamanho e a leitura", async () => {
    const tool = setup();
    const r = await tool("notes_list", { folder: "Projeto X" });
    expect(r.notas.map((n: { path: string }) => n.path)).toEqual(["Projeto X/Resumo.md"]);
    const tipos = Object.fromEntries(r.arquivos.map((a: { nome: string; tipo: string }) => [a.nome, a.tipo]));
    expect(tipos).toEqual({
      "Proposta Comercial.pdf": "pdf",
      "contrato.docx": "docx",
      "orcamento.xlsx": "xlsx",
      "apresentacao.pptx": "pptx",
      "clientes.csv": "csv",
      "anexos.zip": "zip",
      "foto.png": "png",
      LEIAME: "sem extensão",
    });
    // A nota e os 6 do spec, mais a imagem e o sem extensão; a subpasta fica como pasta, sem o pdf de dentro.
    expect(r.total).toBe(9);
    expect(r.pastas).toEqual(["Projeto X/fase 2"]);
    const csv = r.arquivos.find((a: { nome: string }) => a.nome === "clientes.csv");
    expect(csv).toMatchObject({ path: "Projeto X/clientes.csv", bytes: PASTA["Projeto X/clientes.csv"].length, leitura: "files_read" });
    expect(typeof csv.mudou).toBe("string");
    expect(r.arquivos.find((a: { nome: string }) => a.nome === "foto.png").leitura).toBe("sem leitura");
    expect(r.arquivos.find((a: { nome: string }) => a.nome === "Proposta Comercial.pdf").leitura).toBe("files_read");
  });

  test("uma pasta só com arquivos, sem nota, não volta vazia", async () => {
    const tool = setup();
    const r = await tool("notes_list", { folder: "fase 2" });
    expect(r.pasta).toBe("Projeto X/fase 2");
    expect(r.notas).toEqual([]);
    expect(r.arquivos.map((a: { path: string }) => a.path)).toEqual(["Projeto X/fase 2/cronograma.pdf"]);
    expect(r.total).toBe(1);
  });

  test("uma pasta só com notas não traz `arquivos`", async () => {
    const tool = setup({ "Só notas/A.md": "# A\n", "Só notas/B.txt": "b\n" });
    const r = await tool("notes_list", { folder: "Só notas" });
    expect(r.arquivos).toBeUndefined();
    expect(r.total).toBe(2);
  });

  test("a busca pelo nome do pdf acha o pdf, ao lado das notas", async () => {
    const tool = setup();
    const r = await tool("notes_search", { query: "proposta comercial" });
    expect(r.arquivos.map((a: { path: string }) => a.path)).toEqual(["Projeto X/Proposta Comercial.pdf"]);
    expect(r.arquivos[0]).toMatchObject({ tipo: "pdf", leitura: "files_read" });
    // Sem acento e sem maiúscula, e pelo nome da pasta também.
    expect((await tool("notes_search", { query: "PROJETO x cronograma" })).arquivos.map((a: { nome: string }) => a.nome)).toEqual(["cronograma.pdf"]);
    // Duas propostas, uma em cada pasta; o path: escolhe a pasta.
    expect((await tool("notes_search", { query: "proposta" })).arquivos).toHaveLength(2);
    expect((await tool("notes_search", { query: "proposta path:Pessoal" })).arquivos.map((a: { path: string }) => a.path)).toEqual(["Pessoal/proposta-antiga.pdf"]);
    // A nota segue nos resultados, e nada pelo nome não traz `arquivos`.
    const nota = await tool("notes_search", { query: "resumo" });
    expect(nota.resultados.map((h: { path: string }) => h.path)).toContain("Projeto X/Resumo.md");
    expect(nota.arquivos).toBeUndefined();
  });

  test("a lista longa pagina notas e arquivos juntos, sem perder nenhum", async () => {
    const many: Record<string, string> = { "Grande/Nota.md": "# Nota\n" };
    for (let i = 0; i < LIST_PAGE + 5; i++) many[`Grande/arquivo-${String(i).padStart(3, "0")}.pdf`] = "x";
    const tool = setup(many);
    const first = await tool("notes_list", { folder: "Grande" });
    expect(first.total).toBe(LIST_PAGE + 6);
    expect(first.notas).toHaveLength(1);
    expect(first.arquivos).toHaveLength(LIST_PAGE - 1);
    expect(first.proximoOffset).toBe(LIST_PAGE);
    const second = await tool("notes_list", { folder: "Grande", offset: first.proximoOffset });
    expect(second.notas).toEqual([]);
    expect(second.arquivos).toHaveLength(6);
    expect(second.proximoOffset).toBeUndefined();
    const seen = new Set([...first.arquivos, ...second.arquivos].map((a: { path: string }) => a.path));
    expect(seen.size).toBe(LIST_PAGE + 5);
  });
});

describe("searchFileNames e fileCard", () => {
  const files = [
    { path: "a/Relatório Final.pdf", size: 10, mtime: "2026-11-01T00:00:00.000Z" },
    { path: "a/notas.txt", size: 5, mtime: "2026-11-01T00:00:00.000Z" },
    { path: "b/relatorio.xlsx", size: 20, mtime: "2026-11-02T00:00:00.000Z" },
  ];
  test("todas as palavras, sem acento nem maiúscula; o .txt é nota e fica de fora; o limite vale", () => {
    expect(searchFileNames("relatorio", files, 10).map((f) => f.path)).toEqual(["a/Relatório Final.pdf", "b/relatorio.xlsx"]);
    expect(searchFileNames("relatorio final", files, 10).map((f) => f.path)).toEqual(["a/Relatório Final.pdf"]);
    expect(searchFileNames("notas", files, 10)).toEqual([]);
    expect(searchFileNames("relatorio", files, 1)).toHaveLength(1);
    expect(searchFileNames("path:b", files, 10)).toEqual([]);
  });
  test("o cartão diz o tipo pela extensão e se há leitura", () => {
    expect(fileCard(files[0]!)).toEqual({ path: "a/Relatório Final.pdf", nome: "Relatório Final.pdf", tipo: "pdf", bytes: 10, mudou: "2026-11-01T00:00:00.000Z", leitura: "files_read" });
    expect(fileCard({ path: "x/.config/arquivo", size: 1, mtime: "" }).tipo).toBe("sem extensão");
    expect(fileCard({ path: "foto.HEIC", size: 1, mtime: "" })).toMatchObject({ tipo: "heic", leitura: "sem leitura" });
  });
});

describe("o agente falso acha e lê cada arquivo da pasta pelo `kiwi` (spec #17587)", () => {
  test("uma nota, um pdf, um docx, um xlsx, um pptx, um csv e um zip: listar mostra os 7, e o `kiwi ler` dá o texto de cada um", async () => {
    const pasta = {
      "Projeto X/Resumo.md": "# Resumo\n\nmarca-nota: o projeto X em uma página\n",
      "Projeto X/Proposta.pdf": await buildFile("pdf", { blocos: [{ tipo: "paragrafo", texto: "marca-pdf proposta para a Ana" }] }),
      "Projeto X/Contrato.docx": await buildFile("docx", { blocos: [{ tipo: "paragrafo", texto: "marca-docx cláusula primeira" }] }),
      "Projeto X/Orcamento.xlsx": await buildFile("xlsx", { abas: [{ nome: "Custos", tabela: [["Item", "Valor"], ["marca-xlsx", "10"]] }] }),
      "Projeto X/Apresentacao.pptx": pptxBytes([[["marca-pptx slide um"]], [["segundo slide"]]]),
      "Projeto X/clientes.csv": "Nome;Cidade\nmarca-csv;Recife\n",
      "Projeto X/Anexos.zip": zipBytes({ "planilha.csv": "A;B\nmarca-zip;1\n", "foto.png": "x" }, { deflate: true }),
    };
    const tool = setup(pasta);

    // kiwi achar pasta: os 7, cada um com o tipo.
    const lista = (await tool.kiwi({ fazer: "achar", alvo: "Projeto X", opcoes: { como: "pasta" } })).value;
    expect(lista.total).toBe(7);
    expect(lista.notas.map((n: { path: string }) => n.path)).toEqual(["Projeto X/Resumo.md"]);
    expect(Object.fromEntries(lista.arquivos.map((a: { nome: string; tipo: string; leitura: string }) => [a.nome, `${a.tipo} ${a.leitura}`]))).toEqual({
      "Anexos.zip": "zip files_read",
      "Apresentacao.pptx": "pptx files_read",
      "Contrato.docx": "docx files_read",
      "Orcamento.xlsx": "xlsx files_read",
      "Proposta.pdf": "pdf files_read",
      "clientes.csv": "csv files_read",
    });

    // kiwi achar pelo nome do pdf: acha o pdf.
    const achou = (await tool.kiwi({ fazer: "achar", texto: "proposta", opcoes: { como: "texto" } })).value;
    expect(achou.arquivos.map((a: { path: string }) => a.path)).toEqual(["Projeto X/Proposta.pdf"]);

    // kiwi ler, sem dizer o como: a nota vai ao notes_read, o resto ao files_read, e cada um devolve o texto.
    const ler = async (alvo: string) => {
      const r = await tool.kiwi({ fazer: "ler", alvo });
      return { tool: r.tool, texto: String(r.value.texto ?? r.value.content ?? r.value.conteudo ?? "") };
    };
    const nota = await ler("Projeto X/Resumo.md");
    expect(nota.tool).toBe("notes_read");
    expect(nota.texto).toContain("marca-nota");
    for (const [arquivo, marca] of [
      ["Proposta.pdf", "marca-pdf"],
      ["Contrato.docx", "marca-docx"],
      ["Orcamento.xlsx", "marca-xlsx"],
      ["Apresentacao.pptx", "marca-pptx"],
      ["clientes.csv", "marca-csv"],
    ]) {
      const r = await ler(`Projeto X/${arquivo}`);
      expect({ arquivo, tool: r.tool }).toEqual({ arquivo, tool: "files_read" });
      expect(r.texto).toContain(marca!);
    }

    // O zip devolve a lista do que tem dentro, e lê um arquivo de dentro pelo mesmo caminho.
    const zip = await ler("Projeto X/Anexos.zip");
    expect(zip.tool).toBe("files_read");
    expect(zip.texto).toContain("planilha.csv");
    expect(zip.texto).toContain("foto.png");
    const dentro = await ler("Projeto X/Anexos.zip/planilha.csv");
    expect(dentro.tool).toBe("files_read");
    expect(dentro.texto).toContain("marca-zip");
  });
});
