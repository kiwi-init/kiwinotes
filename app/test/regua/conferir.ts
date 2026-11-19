// As conferências da régua que rodam sem tela (spec #21156, T21236), por tipo: abrir a fixture difícil e o tempo, o
// arquivo grande, a busca achar, editar e gravar sem perda, o gato (falso) ler e editar, recusar o que não abre, e
// nenhum pedido de rede. Cada uma devolve null quando passa, ou o motivo. O que só se vê na tela (buscar dentro com
// ⌘F, o histórico no painel, o trackpad) não tem conferência aqui: a tabela diz o estado pela leitura do código.
//
// Tudo vai pelo mesmo caminho do app: o `Vault` (as capacidades `notes.*` e `files.*`), as leituras das Notas
// (`ui/notes/files/`), as do agente (`files_read`) e o escritor do agente (`writerFromCapabilities`). A planilha (csv,
// tsv, xlsx) grava como a grade (`openDoc`, `inputOp`, `docBytes` e o `files.save` em base64) e o gato a muda pelo
// `sheets_edit` (T22627).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

import { MAX_VIEW_BYTES, MAX_VIEW_TEXT_BYTES } from "../../src/shared/file-view.ts";
import { Vault, type FileContent } from "../../src/notes/vault.ts";
import { TextIndex } from "../../src/notes/text-index.ts";
import { fileFormat, readDocument } from "../../src/agent/tools/files.ts";
import { isTextFile } from "../../src/agent/tools/reader.ts";
import { writerFromCapabilities } from "../../src/agent/tools/writer.ts";
import { readerFromCapabilities } from "../../src/agent/tools/reader.ts";
import { runKiwiTool } from "../../src/agent/tools/tools.ts";
import { isSheetPath } from "../../src/agent/tools/sheets.ts";
import { columnName } from "../../src/notes/doc-text.ts";
import { readXlsx } from "../../src/shared/sheet/xlsx.ts";
import { readZip } from "../../src/shared/sheet/zip.ts";
import { base64Of, parseTable } from "../../ui/notes/files/csv.ts";
import { docBytes, inputOp, openDoc, replay, type SheetDoc } from "../../ui/notes/files/sheet-doc.ts";
import type { GridCell } from "../../src/shared/sheet/ops.ts";
import { parseDocHtml, docText } from "../../ui/notes/files/docx.ts";
import { checkDrawio } from "../../ui/notes/files/drawio.ts";
import { imageInfo, imageProblem } from "../../ui/notes/files/imageInfo.ts";
import { mediaType } from "../../ui/notes/files/media.ts";
import { readWorkbook } from "../../ui/notes/files/sheet.ts";
import { checkZip } from "../../ui/notes/files/zipSize.ts";
import { ABA_LARGA, csvGrande, esparso, jsonGrande, MARCA, PASTA, TITULO_LONGO, xlsxGrande } from "./arquivos.ts";

/** Abrir a fixture pequena: até 1,5 s (a do pdf inclui carregar o PDF.js). */
export const ABRE_MS = 1_500;
/** Abrir a grande (50 mil linhas): até 10 s, no M1 da máquina compartilhada. */
export const GRANDE_MS = 10_000;

type Como = "nota" | "quadro" | "texto" | "binario";

export interface Familia {
  /** A fixture pequena, em `test/regua/arquivos/`. */
  arquivo: string;
  como: Como;
  /** O texto que o visualizador mostra (para procurar a marca), "" se não tem texto, ou null se não abre. */
  abrir(bytes: Uint8Array, nome: string): Promise<string | null>;
  /** O texto aberto tem a marca (as imagens sem texto e a mídia não). */
  temTexto: boolean;
  /** O que mais tem de aparecer aberto: o título comprido, a aba de nome comprido (os casos difíceis do #21018). */
  tambem?: string[];
  /** Um arquivo pesado mas abaixo do limite, que tem de abrir em `GRANDE_MS`. */
  pesado?: () => string | Uint8Array;
}

const texto = (b: Uint8Array) => new TextDecoder().decode(b);

/**
 * O docx aberto: o tamanho aberto do zip, como o `DocxViewer` confere antes do motor, e o texto pelo mammoth, como o
 * agente lê. O motor das Notas (T21151) desenha num canvas, fora do `bun test`: a prova dele é o `scripts/docx-check.ts`.
 */
async function abrirDocx(b: Uint8Array): Promise<string | null> {
  if (!checkZip(b).ok) return null;
  const mammoth = (await import("mammoth")).default;
  const r = await mammoth.convertToHtml({ buffer: Buffer.from(b) }, { externalFileAccess: false });
  return docText(parseDocHtml(r.value));
}

const tabela = (rows: string[][]) => rows.map((r) => r.join("\t")).join("\n");

export const FAMILIAS: Record<string, Familia> = {
  nota: { arquivo: "estoque.md", como: "nota", temTexto: true, abrir: async (b) => texto(b) },
  txt: { arquivo: "estoque.txt", como: "texto", temTexto: true, abrir: async (b) => texto(b) },
  log: { arquivo: "estoque.log", como: "texto", temTexto: true, abrir: async (b) => texto(b) },
  json: {
    arquivo: "estoque.json",
    como: "texto",
    temTexto: true,
    abrir: async (b) => (JSON.parse(texto(b)), texto(b)),
  },
  yaml: { arquivo: "estoque.yaml", como: "texto", temTexto: true, abrir: async (b) => texto(b) },
  csv: {
    arquivo: "estoque.csv",
    como: "texto",
    temTexto: true,
    abrir: async (b, nome) => tabela(parseTable(texto(b), nome).rows),
    pesado: () => csvGrande(),
  },
  "código": { arquivo: "estoque.py", como: "texto", temTexto: true, abrir: async (b) => texto(b) },
  pdf: {
    arquivo: "estoque.pdf",
    como: "binario",
    temTexto: true,
    abrir: async (b, nome) => JSON.stringify(await readDocument(nome, b, 100_000)),
  },
  docx: { arquivo: "estoque.docx", como: "binario", temTexto: true, abrir: abrirDocx, tambem: [TITULO_LONGO] },
  xlsx: {
    arquivo: "estoque.xlsx",
    como: "binario",
    temTexto: true,
    // A marca está só na 256ª coluna (IV) da aba larga: uma coluna cortada perde a marca.
    abrir: async (b) => readWorkbook(XLSX, b, ",").sheets.map((s) => `${s.name}\n${tabela(s.rows)}`).join("\n"),
    tambem: [ABA_LARGA, TITULO_LONGO],
    pesado: () => xlsxGrande(),
  },
  imagem: {
    arquivo: "estoque.png",
    como: "binario",
    temTexto: false,
    abrir: async (b) => (imageProblem(imageInfo(b)) === null ? "" : null),
  },
  svg: {
    arquivo: "estoque.svg",
    como: "binario",
    temTexto: true,
    abrir: async (b) => (imageProblem(imageInfo(b)) === null ? texto(b) : null),
  },
  drawio: {
    arquivo: "estoque.drawio",
    como: "texto",
    temTexto: true,
    abrir: async (b) => (checkDrawio(texto(b)).ok ? texto(b) : null),
  },
  "mídia": {
    arquivo: "estoque.wav",
    como: "binario",
    temTexto: false,
    abrir: async (b, nome) => (mediaType(nome) && b.length > 44 && texto(b.subarray(0, 4)) === "RIFF" ? "" : null),
  },
  "quadro branco": {
    arquivo: "estoque.canvas",
    como: "quadro",
    temTexto: true,
    abrir: async (b) => (JSON.parse(texto(b)) as { nodes: { text?: string }[] }).nodes.map((n) => n.text ?? "").join("\n"),
  },
};

const ext = (nome: string) => nome.slice(nome.indexOf(".") + 1);
const corrompido = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xde, 0xad, 0xbe, 0xef, 0x00, 0x11, 0x22, 0x33]);
/** O texto que não é UTF-8 (um "ç" em Latin-1, de um app antigo do Windows). */
const latin1 = (b: Uint8Array) => Buffer.concat([Buffer.from(b), Buffer.from([0x63, 0x6f, 0x72, 0x61, 0xe7, 0xe3, 0x6f, 0x0a])]);

/** O cofre da régua, num tmp: as fixtures pequenas, as cópias para escrever e as grandes. */
export class Cofre {
  readonly vault: Vault;
  /** O índice do texto dos arquivos (T21240, T22218), nos dados do app, fora do cofre: a outra metade da busca. */
  readonly texto: TextIndex;
  /** Os pedidos de rede vistos (o `fetch` fica preso durante a régua). */
  rede = 0;
  private readonly fetchAntes = globalThis.fetch;

  constructor(readonly root: string) {
    this.vault = new Vault({ root, debounceMs: 20, trash: async () => {} });
    this.texto = new TextIndex({ root, dir: `${root}-indice-texto`, pause: async () => {} });
  }

  /** A busca do app e do ⌘K (`notes.search`): as notas e, depois, os arquivos de texto pelo conteúdo. */
  async buscar(q: string, limite = 200): Promise<{ path: string; approx?: boolean }[]> {
    const notas = this.vault.search(q, limite);
    const arquivos = await this.texto.search(q, limite, (p) => this.vault.fileInfo(p));
    return [...notas, ...arquivos];
  }

  /** Prepara os arquivos antes de abrir o cofre (o índice das notas os vê na abertura). */
  async abrir(): Promise<void> {
    for (const [tipo, f] of Object.entries(FAMILIAS)) {
      const bytes = new Uint8Array(readFileSync(path.join(PASTA, f.arquivo)));
      const e = ext(f.arquivo);
      for (const d of ["Loja", "Editar", "Gravar", "Gato"]) this.escrever(`${d}/${tipo}.${e}`, bytes);
      this.escrever(`Recusa/${tipo}.${e}`, f.como === "binario" ? corrompido : latin1(bytes));
      if (f.pesado) this.escrever(`Grandes/pesado-${tipo}.${e}`, f.pesado());
      if (f.como === "texto" || f.como === "binario") esparso(path.join(this.root, `Grandes/limite-${tipo}.${e}`), (f.como === "texto" ? MAX_VIEW_TEXT_BYTES : MAX_VIEW_BYTES) + 1);
    }
    // O json de mais de 5 MB, de verdade (não esparso), e a nota e o quadro grandes.
    this.escrever("Grandes/limite-json-real.json", jsonGrande());
    this.escrever("Grandes/pesado-nota.md", `# Estoque grande\n\n${"Uma linha do estoque da loja, com a contagem de sexta.\n".repeat(40_000)}${MARCA}\n`);
    this.escrever("Grandes/limite-quadro branco.canvas", `{"nodes":[${'{"id":"x","type":"text","text":"estoque","x":0,"y":0,"width":10,"height":10},'.repeat(70_000)}{"id":"y","type":"text","text":"fim","x":0,"y":0,"width":10,"height":10}],"edges":[]}`);
    await this.vault.open();
    const self = this;
    globalThis.fetch = Object.assign(async () => {
      self.rede++;
      throw new Error("a régua não deixa abrir rede");
    }, { preconnect: () => {} }) as unknown as typeof fetch;
    // O índice lê depois do `fetch` preso: tirar o texto do pdf, do docx e do xlsx também não pede rede.
    await this.texto.sync(this.vault.otherFiles());
  }

  async fechar(): Promise<void> {
    globalThis.fetch = this.fetchAntes;
    this.vault.close();
    await this.texto.destroy();
  }

  private escrever(rel: string, conteudo: string | Uint8Array): void {
    mkdirSync(path.dirname(path.join(this.root, rel)), { recursive: true });
    writeFileSync(path.join(this.root, rel), conteudo);
  }

  /** Lê como o app lê esse tipo: a nota, o quadro, ou o `files.read` em texto ou binário. */
  async ler(tipo: string, rel: string): Promise<{ bytes: Uint8Array } | { limite: true }> {
    const f = FAMILIAS[tipo]!;
    if (f.como === "nota") return { bytes: new TextEncoder().encode((await this.vault.get(rel)).content) };
    if (f.como === "quadro") return { bytes: new TextEncoder().encode((await this.vault.getCanvas(rel)).content) };
    const r: FileContent = await this.vault.readFile(rel, f.como === "texto" ? "text" : "binary");
    if ("tooLarge" in r) return { limite: true };
    return { bytes: "text" in r ? new TextEncoder().encode(r.text) : Buffer.from(r.base64, "base64") };
  }

  /**
   * A planilha (csv, tsv, xlsx) como a grade a abre (T22627): os bytes do `files.read` binário, o `openDoc` e a célula
   * com a marca, com a versão para gravar por cima.
   */
  async planilha(rel: string): Promise<{ doc: SheetDoc; version: string; sheet: string; row: number; col: number; cell: GridCell }> {
    const r = await this.vault.readFile(rel, "binary");
    if (!("base64" in r)) throw new Error("a planilha não abriu");
    const doc = openDoc(new Uint8Array(Buffer.from(r.base64, "base64")), rel);
    for (const s of doc.base.sheets)
      for (const [row, cells] of s.rows.entries())
        for (const [col, cell] of cells.entries()) if (cell?.text.includes(MARCA)) return { doc, version: r.version, sheet: s.name, row, col, cell };
    throw new Error("a marca não está na grade");
  }

  /**
   * Grava a planilha como a pessoa digitando na grade (T21109): a marca ganha um "2" pelo `inputOp`, os bytes saem do
   * `docBytes` (o xlsx pelo `patchXlsx`, o csv pelo `writeDelimited`) e vão pelo `files.save` em base64.
   */
  async gravarPlanilha(rel: string): Promise<string | null> {
    try {
      const p = await this.planilha(rel);
      const ops = [inputOp(p.doc, p.sheet, p.row, p.col, mudado(p.cell.text), p.cell, ",")];
      const bytes = docBytes(p.doc, ops, replay(p.doc, ops));
      return (await this.vault.saveFileBytes(rel, base64Of(bytes), p.version)).saved ? null : "o files.save não gravou a planilha";
    } catch (e) {
      return `o Kiwi não grava a planilha: ${motivo(e)}`;
    }
  }

  /** O caminho de `tipo` na pasta `d`. */
  caminho(d: string, tipo: string): string {
    return `${d}/${tipo}.${ext(FAMILIAS[tipo]!.arquivo)}`;
  }

  /** Grava o texto novo como o app grava esse tipo. Devolve null se gravou, ou o motivo. */
  async gravar(tipo: string, rel: string, novo: string): Promise<string | null> {
    const f = FAMILIAS[tipo]!;
    try {
      if (f.como === "nota") {
        const n = await this.vault.get(rel);
        return (await this.vault.save(rel, novo, n.version)).saved ? null : "o notes.save não gravou";
      }
      if (f.como === "quadro") {
        const c = await this.vault.getCanvas(rel);
        return (await this.vault.saveCanvas(rel, novo, c.version)).saved ? null : "o saveCanvas não gravou";
      }
      const r = await this.vault.readFile(rel, "text");
      if (!("version" in r)) return "grande demais para gravar";
      return (await this.vault.saveFile(rel, novo, r.version)).saved ? null : "o files.save não gravou";
    } catch (e) {
      return `o Kiwi não grava .${ext(f.arquivo)}: ${(e as Error).message}`;
    }
  }
}

/** O texto da fixture com uma mudança só: a marca ganha um "2". */
const mudado = (t: string) => t.replace(MARCA, `${MARCA}2`);

const tempo = async <T>(f: () => Promise<T>): Promise<[T, number]> => {
  const t0 = performance.now();
  const r = await f();
  return [r, Math.round(performance.now() - t0)];
};

/** Quantas vezes o tempo de abrir é medido antes de falhar (T22099): uma máquina do CI ocupada atrasa uma medida, não três. */
export const MEDIDAS = 3;

/**
 * Mede `f` até `vezes` vezes e para na primeira que fica em `max` ms. Devolve o resultado da última e os tempos de todas.
 * A 1ª medida é a fria, a que a pessoa vê (o pdf carrega o PDF.js nela); as outras já vêm com o código carregado e são
 * muito mais rápidas. Por isso a fria tem um teto próprio, `tetoFrio` (2× o máximo): acima dele, `ok` é falso e não se
 * repete, porque uma abertura fria que dobrou de tempo não é tremor do CI. Abaixo dele, `ok` só é falso se todas passam
 * de `max`.
 */
export async function medirAte<T>(
  f: () => Promise<T>,
  max: number,
  vezes = MEDIDAS,
  tetoFrio = 2 * max,
): Promise<{ r: T; ms: number[]; ok: boolean; fria: boolean }> {
  const ms: number[] = [];
  let r!: T;
  for (let i = 0; i < vezes; i++) {
    let t: number;
    [r, t] = await tempo(f);
    ms.push(t);
    if (i === 0 && t > tetoFrio) return { r, ms, ok: false, fria: true };
    if (t <= max) return { r, ms, ok: true, fria: false };
  }
  return { r, ms, ok: false, fria: false };
}

const motivo = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n")[0]!;

/** As partes do zip pelo nome, com os bytes compactados de cada uma. */
function partes(bytes: Uint8Array): Map<string, Uint8Array> {
  return new Map(readZip(bytes).map((p) => [p.name, bytes.subarray(p.data, p.data + p.compressed)]));
}

/** O xlsx gravado mudou só a célula da marca: as outras partes do zip, byte a byte, e as outras células, pelo valor. */
function xlsxSoAMudanca(rel: string, antes: Uint8Array, depois: Uint8Array): string | null {
  const a = partes(antes);
  const d = partes(depois);
  if ([...a.keys()].sort().join() !== [...d.keys()].sort().join()) return "o xlsx gravado ganhou ou perdeu partes do zip";
  const mudaram = [...a].filter(([nome, b]) => !Buffer.from(b).equals(d.get(nome)!)).map(([nome]) => nome);
  if (mudaram.length !== 1 || !/^xl\/worksheets\/sheet\d+\.xml$/.test(mudaram[0]!)) return `o xlsx gravado mudou além da aba da edição: ${mudaram.join(", ")}`;
  const celulas = (b: Uint8Array) =>
    readXlsx(b, rel).sheets.flatMap((s) => s.rows.flatMap((r, i) => r.map((x, j) => (x ? `${s.name}!${columnName(j)}${i + 1}=${JSON.stringify([x.value, x.formula ?? null, x.format ?? null])}` : "")).filter(Boolean)));
  const ca = celulas(antes);
  const cd = new Set(celulas(depois));
  const sumiram = ca.filter((x) => !cd.has(x));
  if (sumiram.length !== 1 || !sumiram[0]!.includes(MARCA)) return `o xlsx gravado mudou outras células: ${sumiram.length}`;
  if (cd.size !== ca.length) return `o xlsx gravado ganhou células além da edição: ${cd.size - ca.length}`;
  return [...cd].some((x) => x.includes(`${MARCA}2`)) ? null : "o xlsx gravado não tem a edição";
}

/** O gato muda a planilha como no app (T21114): o `sheets_read` e o `sheets_edit` do agente, sobre as capacidades. */
async function gatoNaPlanilha(c: Cofre, rel: string): Promise<string | null> {
  const v = c.vault;
  const fora = () => Promise.reject(new Error("fora da régua"));
  const caps = {
    "notes.search": fora,
    "notes.list": fora,
    "notes.get": fora,
    "meetings.list": fora,
    "projects.list": fora,
    "projects.status": fora,
    "notes.save": fora,
    "notes.create": fora,
    "notes.folder": fora,
    "files.create": fora,
    "files.read": (a: unknown) => {
      const x = a as { path: string; as: "text" | "binary" };
      return v.readFile(x.path, x.as);
    },
    "files.save": (a: unknown) => {
      const x = a as { path: string; base64: string; baseVersion: string };
      return v.saveFileBytes(x.path, x.base64, x.baseVersion);
    },
  };
  const journal = { keep: async () => "copia", drop: async () => {} };
  const ctx = { reader: readerFromCapabilities(caps), writer: writerFromCapabilities(caps), journal };
  try {
    const p = await c.planilha(rel);
    const lido = (await runKiwiTool(ctx, "sheets_read", { caminho: rel, ...(p.sheet ? { aba: p.sheet } : {}) })).value;
    if (typeof lido.versao !== "string") return `o sheets_read não leu: ${JSON.stringify(lido).slice(0, 120)}`;
    const celula = `${columnName(p.col)}${p.row + 1}`;
    const mudancas = [{ tipo: "celulas", ...(p.sheet ? { aba: p.sheet } : {}), celulas: { [celula]: mudado(p.cell.text) } }];
    const feito = (await runKiwiTool(ctx, "sheets_edit", { caminho: rel, versao: lido.versao, mudancas })).value;
    if (typeof feito.versao !== "string") return `o sheets_edit não gravou: ${JSON.stringify(feito).slice(0, 120)}`;
    return (await c.planilha(rel)).cell.text.includes(`${MARCA}2`) ? null : "o sheets_edit gravou outra coisa";
  } catch (e) {
    return `o gato não edita a planilha: ${motivo(e)}`;
  }
}

/** As conferências, pelo índice do item (0 = "Abre rápido"). As que faltam (⌘F, histórico, trackpad) são de tela. */
export const CONFERIR: Partial<Record<number, (c: Cofre, tipo: string) => Promise<string | null>>> = {
  // 1. Abre rápido e legível de primeira.
  0: async (c, tipo) => {
    const f = FAMILIAS[tipo]!;
    const rel = c.caminho("Loja", tipo);
    try {
      const { r: aberto, ms, ok, fria } = await medirAte(async () => {
        const r = await c.ler(tipo, rel);
        return "bytes" in r ? f.abrir(r.bytes, rel) : null;
      }, ABRE_MS);
      if (aberto === null) return "não abriu";
      if (f.temTexto && !aberto.includes(MARCA)) return "abriu sem o texto de dentro";
      const sem = (f.tambem ?? []).filter((t) => !aberto.includes(t));
      if (sem.length) return `abriu sem: ${sem.map((t) => `"${t.slice(0, 30)}…"`).join(", ")}`;
      if (ok) return null;
      if (fria) return `a 1ª abertura levou ${ms[0]} ms (o teto dela é ${2 * ABRE_MS})`;
      return `levou ${ms.join(", ")} ms em ${ms.length} medidas (o máximo é ${ABRE_MS})`;
    } catch (e) {
      return `não abriu: ${motivo(e)}`;
    }
  },

  // 2. O arquivo grande não trava: acima do limite, avisa; o pesado abaixo dele abre a tempo.
  1: async (c, tipo) => {
    const f = FAMILIAS[tipo]!;
    const e = ext(f.arquivo);
    try {
      if (f.como === "nota") {
        const [n, ms] = await tempo(() => c.vault.get("Grandes/pesado-nota.md"));
        return n.content.includes(MARCA) && ms <= GRANDE_MS ? null : `a nota de 2 MB levou ${ms} ms`;
      }
      if (f.como === "quadro") {
        try {
          await c.vault.getCanvas(`Grandes/limite-${tipo}.${e}`);
          return "o quadro de mais de 5 MB abriu sem aviso";
        } catch (err) {
          return /larger/.test(motivo(err)) ? null : `o quadro grande falhou sem o aviso: ${motivo(err)}`;
        }
      }
      if (!("limite" in (await c.ler(tipo, `Grandes/limite-${tipo}.${e}`)))) return "acima do limite, abriu sem avisar";
      if (tipo === "json" && !("limite" in (await c.ler(tipo, "Grandes/limite-json-real.json")))) return "o json de 5 MB abriu sem avisar";
      if (f.pesado) {
        const rel = `Grandes/pesado-${tipo}.${e}`;
        const [aberto, ms] = await tempo(async () => {
          const r = await c.ler(tipo, rel);
          return "bytes" in r ? f.abrir(r.bytes, rel) : null;
        });
        if (aberto === null || !aberto.includes(MARCA)) return "o arquivo de 50 mil linhas não abriu inteiro";
        if (ms > GRANDE_MS) return `o arquivo de 50 mil linhas levou ${ms} ms`;
      }
      return null;
    } catch (err) {
      return `travou: ${motivo(err)}`;
    }
  },

  // 4. Entra na busca do app (a mesma do ⌘K): uma palavra que só existe dentro do arquivo.
  3: async (c, tipo) => {
    const rel = c.caminho("Loja", tipo);
    const hits = (await c.buscar(MARCA)).filter((h) => !h.approx);
    return hits.some((h) => h.path === rel) ? null : "a busca não acha o conteúdo";
  },

  // 5. Editar (o desfazer e o refazer são da tela).
  4: async (c, tipo) => {
    const rel = c.caminho("Editar", tipo);
    if (isSheetPath(rel)) {
      const erro = await c.gravarPlanilha(rel);
      if (erro) return erro;
      return (await c.planilha(rel)).cell.text.includes(`${MARCA}2`) ? null : "a planilha reaberta não tem a edição";
    }
    const r = await c.ler(tipo, rel);
    if (!("bytes" in r)) return "não abriu";
    return c.gravar(tipo, rel, mudado(texto(r.bytes)));
  },

  // 6. Gravar não estraga: só a mudança muda, o resto fica byte a byte (tabs, acento, o fim de linha \r\n).
  5: async (c, tipo) => {
    const rel = c.caminho("Gravar", tipo);
    const antes = new Uint8Array(readFileSync(path.join(c.root, rel)));
    const esperado = mudado(texto(antes));
    // A planilha grava pela grade (T22627): o csv tem de sair byte a byte como o texto com a mudança; o xlsx, com cada
    // parte do zip intacta menos a aba da célula, e nessa aba só a célula mudada.
    const erro = isSheetPath(rel) ? await c.gravarPlanilha(rel) : await c.gravar(tipo, rel, esperado);
    if (erro) return erro;
    const depois = readFileSync(path.join(c.root, rel));
    if (/\.xlsx$/i.test(rel)) return xlsxSoAMudanca(rel, antes, new Uint8Array(depois));
    return depois.equals(Buffer.from(esperado)) ? null : "o arquivo gravado mudou além da edição";
  },

  // 8. O gato lê: o notes_read (a nota e o .txt) ou o files_read.
  7: async (c, tipo) => {
    const rel = c.caminho("Loja", tipo);
    try {
      if (rel.endsWith(".md")) return (await c.vault.get(rel)).content.includes(MARCA) ? null : "o notes_read não traz o texto";
      if (isTextFile(rel)) {
        const r = await c.vault.readFile(rel, "text");
        return "text" in r && r.text.includes(MARCA) ? null : "o notes_read não traz o texto";
      }
      if (!fileFormat(rel)) return `o files_read não lê .${ext(rel)}`;
      const doc = await readDocument(rel, new Uint8Array(readFileSync(path.join(c.root, rel))), 100_000);
      return JSON.stringify(doc).includes(MARCA) ? null : "o files_read não traz o texto";
    } catch (e) {
      return `o gato não lê: ${motivo(e)}`;
    }
  },

  // 9. O gato edita: o escritor do agente, sobre as capacidades do app.
  8: async (c, tipo) => {
    const rel = c.caminho("Gato", tipo);
    const v = c.vault;
    if (isSheetPath(rel)) return gatoNaPlanilha(c, rel);
    const w = writerFromCapabilities({
      "notes.get": (a) => v.get((a as { path: string }).path),
      "notes.save": (a) => {
        const x = a as { path: string; content: string; baseVersion: string };
        return v.save(x.path, x.content, x.baseVersion);
      },
      "notes.create": () => Promise.reject(new Error("fora da régua")),
      "notes.folder": () => Promise.reject(new Error("fora da régua")),
      "files.create": () => Promise.reject(new Error("fora da régua")),
      "files.read": (a) => {
        const x = a as { path: string; as: "text" | "binary" };
        return v.readFile(x.path, x.as);
      },
      "files.save": (a) => {
        const x = a as { path: string; content: string; baseVersion: string };
        return v.saveFile(x.path, x.content, x.baseVersion);
      },
      "notes.canvasGet": (a) => v.getCanvas((a as { path: string }).path),
      "notes.canvasSave": (a) => {
        const x = a as { path: string; content: string; baseVersion: string };
        return v.saveCanvas(x.path, x.content, x.baseVersion);
      },
    });
    try {
      const n = await w.get(rel);
      const r = await w.save(rel, mudado(n.content), n.version);
      if (!r.saved) return "o escritor não gravou";
      return readFileSync(path.join(c.root, rel), "utf8").includes(`${MARCA}2`) ? null : "o escritor gravou outra coisa";
    } catch (e) {
      return `o gato não edita: ${motivo(e)}`;
    }
  },

  // 10. Recusa em vez de arriscar: o texto que não é UTF-8 fica só leitura; o binário estragado não abre.
  9: async (c, tipo) => {
    const f = FAMILIAS[tipo]!;
    const rel = c.caminho("Recusa", tipo);
    try {
      if (f.como === "binario") {
        const r = await c.ler(tipo, rel);
        return "bytes" in r && (await f.abrir(r.bytes, rel).catch(() => null)) !== null ? "abriu um arquivo estragado como se estivesse bom" : null;
      }
      if (f.como === "nota") {
        if (!(await c.vault.get(rel)).readOnly) return "a nota que não é UTF-8 não ficou só leitura";
      } else if (f.como === "quadro") {
        const bom = await f.abrir(new Uint8Array(readFileSync(path.join(c.root, rel))), rel).catch(() => null);
        if (bom !== null) return "abriu um quadro estragado";
      } else {
        const r = await c.vault.readFile(rel, "text");
        if (!("text" in r) || !r.readOnly) return "o texto que não é UTF-8 não ficou só leitura";
      }
      const gravou = await c.gravar(tipo, rel, "por cima");
      return gravou === null ? "gravou por cima de um arquivo que não entende" : null;
    } catch (e) {
      return `quebrou em vez de recusar: ${motivo(e)}`;
    }
  },
};
