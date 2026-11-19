// As conferências da régua que rodam sem tela (spec #21156, T21236), por tipo: abrir a fixture difícil e o tempo, o
// arquivo grande, a busca achar, editar e gravar sem perda, o gato (falso) ler e editar, recusar o que não abre, e
// nenhum pedido de rede. Cada uma devolve null quando passa, ou o motivo. O que só se vê na tela (buscar dentro com
// ⌘F, o histórico no painel, o trackpad) não tem conferência aqui: a tabela diz o estado pela leitura do código.
//
// Tudo vai pelo mesmo caminho do app: o `Vault` (as capacidades `notes.*` e `files.*`), as leituras das Notas
// (`ui/notes/files/`), as do agente (`files_read`) e o escritor do agente (`writerFromCapabilities`).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

import { MAX_VIEW_BYTES, MAX_VIEW_TEXT_BYTES } from "../../src/shared/file-view.ts";
import { Vault, type FileContent } from "../../src/notes/vault.ts";
import { fileFormat, readDocument } from "../../src/agent/tools/files.ts";
import { isTextNote } from "../../src/agent/tools/reader.ts";
import { writerFromCapabilities } from "../../src/agent/tools/writer.ts";
import { parseTable } from "../../ui/notes/files/csv.ts";
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

/** O docx como o `DocxViewer`: o tamanho aberto do zip, o mammoth e só o HTML da lista. */
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
  /** Os pedidos de rede vistos (o `fetch` fica preso durante a régua). */
  rede = 0;
  private readonly fetchAntes = globalThis.fetch;

  constructor(readonly root: string) {
    this.vault = new Vault({ root, debounceMs: 20, trash: async () => {} });
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
  }

  fechar(): void {
    globalThis.fetch = this.fetchAntes;
    this.vault.close();
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

const motivo = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n")[0]!;

/** As conferências, pelo índice do item (0 = "Abre rápido"). As que faltam (⌘F, histórico, trackpad) são de tela. */
export const CONFERIR: Partial<Record<number, (c: Cofre, tipo: string) => Promise<string | null>>> = {
  // 1. Abre rápido e legível de primeira.
  0: async (c, tipo) => {
    const f = FAMILIAS[tipo]!;
    const rel = c.caminho("Loja", tipo);
    try {
      const [aberto, ms] = await tempo(async () => {
        const r = await c.ler(tipo, rel);
        return "bytes" in r ? f.abrir(r.bytes, rel) : null;
      });
      if (aberto === null) return "não abriu";
      if (f.temTexto && !aberto.includes(MARCA)) return "abriu sem o texto de dentro";
      const sem = (f.tambem ?? []).filter((t) => !aberto.includes(t));
      if (sem.length) return `abriu sem: ${sem.map((t) => `"${t.slice(0, 30)}…"`).join(", ")}`;
      return ms > ABRE_MS ? `levou ${ms} ms (o máximo é ${ABRE_MS})` : null;
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
    const hits = c.vault.search(MARCA, 200).filter((h) => !h.approx);
    return hits.some((h) => h.path === rel) ? null : "a busca não acha o conteúdo";
  },

  // 5. Editar (o desfazer e o refazer são da tela).
  4: async (c, tipo) => {
    const rel = c.caminho("Editar", tipo);
    const r = await c.ler(tipo, rel);
    if (!("bytes" in r)) return "não abriu";
    return c.gravar(tipo, rel, mudado(texto(r.bytes)));
  },

  // 6. Gravar não estraga: só a mudança muda, o resto fica byte a byte (tabs, acento, o fim de linha \r\n).
  5: async (c, tipo) => {
    const rel = c.caminho("Gravar", tipo);
    const antes = new Uint8Array(readFileSync(path.join(c.root, rel)));
    const esperado = mudado(texto(antes));
    const erro = await c.gravar(tipo, rel, esperado);
    if (erro) return erro;
    const depois = readFileSync(path.join(c.root, rel));
    return depois.equals(Buffer.from(esperado)) ? null : "o arquivo gravado mudou além da edição";
  },

  // 8. O gato lê: o notes_read (a nota e o .txt) ou o files_read.
  7: async (c, tipo) => {
    const rel = c.caminho("Loja", tipo);
    try {
      if (rel.endsWith(".md")) return (await c.vault.get(rel)).content.includes(MARCA) ? null : "o notes_read não traz o texto";
      if (isTextNote(rel)) {
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
