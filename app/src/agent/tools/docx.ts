// As ferramentas do docx do agente (T21231, spec #21155 3b): o `docx_read` lê os parágrafos de um docx, numerados, e o
// `docx_edit` muda o texto deles (trocar um trecho, reescrever, inserir, apagar) e grava. Os dois usam o motor das Notas
// sem tela (o `createServerAutomationHost` do @docx-editor.dev/core, Apache-2.0, o mesmo pacote que a tela usa): o
// que não muda no arquivo (estilos, tabelas, imagens, o negrito fora do trecho) fica como estava. As operações vão
// junto da gravação para o Kiwi ao vivo (`liveWriter.saveBytes`): o docx aberto mostra cada uma.

import { createServerAutomationHost } from "@docx-editor.dev/core/automation";

import { type DocxOp, docxOpsTouch } from "../../shared/docx/ops.ts";
import type { VaultReader } from "./reader.ts";
import type { VaultWriter } from "./writer.ts";

/** Quantos parágrafos o `docx_read` devolve sem intervalo, e o máximo de caracteres numa leitura. */
export const DOCX_READ_PARAGRAPHS = 150;
export const DOCX_READ_CHARS = 40_000;
/** O máximo de mudanças num `docx_edit`. */
export const DOCX_EDIT_CHANGES = 100;
/** O maior arquivo que as ferramentas abrem. */
export const DOCX_MAX_BYTES = 20 * 1024 * 1024;

export const isDocxPath = (path: string) => /\.docx$/i.test(path);

/** O erro que o agente lê; o `tools.ts` o converte no `ToolError`. */
export class DocxToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const fromBase64 = (b64: string) => new Uint8Array(Buffer.from(b64, "base64"));

type Handle = { kind: string; ref: string };

/** O documento aberto no motor sem tela, com as poucas leituras e escritas que as ferramentas usam. */
export class DocxDoc {
  private constructor(
    private host: { execute(r: { operations: unknown[] }): { ok: boolean; results: readonly { status: string; value?: unknown; error?: { code: string; message: string } }[] }; save(): { ok: true; bytes: Uint8Array } | { ok: false }; dispose(): void },
    private body: Handle,
  ) {}

  static open(bytes: Uint8Array, path: string): DocxDoc {
    let r: ReturnType<typeof createServerAutomationHost>;
    try {
      r = createServerAutomationHost(bytes);
    } catch (e) {
      throw new DocxToolError("E_FAILED", `não deu para abrir ${path} como docx: ${(e as Error).message}`);
    }
    if (!r.ok) throw new DocxToolError("E_FAILED", `não deu para abrir ${path} como docx (${r.reason})`);
    const host = r.host as unknown as DocxDoc["host"];
    const one = (op: Record<string, unknown>) => {
      const res = host.execute({ operations: [op] }).results[0];
      if (res?.status !== "ok") throw new DocxToolError("E_FAILED", `não deu para abrir ${path} como docx`);
      return (res.value as { handle: Handle }).handle;
    };
    const doc = one({ op: "getDocument" });
    return new DocxDoc(host, one({ op: "getBody", document: doc }));
  }

  /** Uma operação; o erro do motor vira `E_BAD_ARGS` com a mensagem dele (um lote recusado não escreve nada). */
  private run<T>(op: Record<string, unknown>, where: string): T {
    let res;
    try {
      res = this.host.execute({ operations: [op] }).results[0];
    } catch (e) {
      throw new DocxToolError("E_BAD_ARGS", `${where}: ${(e as Error).message}`);
    }
    if (res?.status !== "ok") throw new DocxToolError("E_BAD_ARGS", `${where}: ${res?.error?.message ?? "o motor recusou"}`);
    return res.value as T;
  }

  /** Os parágrafos na ordem de leitura, os das tabelas também. */
  paragraphs(): Handle[] {
    return this.run<{ handles: Handle[] }>({ op: "getParagraphs", body: this.body }, "ler").handles;
  }

  /** O texto que a pessoa vê. */
  text(p: Handle): string {
    return this.run<{ text: string }>({ op: "getText", target: p }, "ler").text;
  }

  /** O texto no modelo do motor: as posições do `DocxOp` contam nele. */
  modelText(p: Handle): string {
    return this.run<{ text: string }>({ op: "getText", target: p, projection: "model" }, "ler").text;
  }

  id(p: Handle): string {
    return this.run<{ text: string }>({ op: "getParagraphId", paragraph: p }, "ler").text;
  }

  /** Onde `text` aparece no parágrafo, em posições do modelo. */
  find(p: Handle, text: string, where: string): { from: number; to: number }[] {
    const v = this.run<{ spans: { start: { offset: number }; end: { offset: number } }[] }>({ op: "search", scope: { paragraph: p }, text, options: { matchCase: true } }, where);
    return v.spans.map((s) => ({ from: s.start.offset, to: s.end.offset }));
  }

  replace(p: Handle, from: number, to: number, text: string, where: string): void {
    this.run({ op: "replaceSpan", span: { start: { paragraph: p, offset: from }, end: { paragraph: p, offset: to } }, text }, where);
  }

  /** Um parágrafo novo depois de `after` (null: antes do primeiro); devolve o handle dele. */
  insert(after: Handle | null, text: string, where: string): Handle {
    const anchor = after ? { paragraph: after } : { body: this.body, at: "first" };
    return this.run<{ handle: Handle }>({ op: "insertParagraph", anchor, where: after ? "after" : "before", text }, where).handle;
  }

  /**
   * As células das tabelas, as de dentro de outra tabela também: o id de cada parágrafo de uma célula dá a tabela (a
   * partir de 1, na ordem do documento), a linha e a coluna, e o handle da linha.
   */
  cells(): Map<string, { tabela: number; linha: number; coluna: number; row: Handle }> {
    const out = new Map<string, { tabela: number; linha: number; coluna: number; row: Handle }>();
    let n = 0;
    const walk = (body: Handle) => {
      for (const t of this.run<{ handles: Handle[] }>({ op: "getTables", scope: { body } }, "ler").handles) {
        const tabela = ++n;
        this.run<{ handles: Handle[] }>({ op: "getTableRows", table: t }, "ler").handles.forEach((row, l) => {
          this.rowBodies(row).forEach((cb, c) => {
            // O `getParagraphs` da célula traz também os da tabela de dentro: ela marca os dela primeiro.
            walk(cb);
            for (const p of this.run<{ handles: Handle[] }>({ op: "getParagraphs", body: cb }, "ler").handles) {
              const id = this.id(p);
              if (!out.has(id)) out.set(id, { tabela, linha: l + 1, coluna: c + 1, row });
            }
          });
        });
      }
    };
    walk(this.body);
    return out;
  }

  private rowBodies(row: Handle): Handle[] {
    return this.run<{ handles: Handle[] }>({ op: "getTableCells", row }, "ler").handles.map(
      (cell) => this.run<{ handle: Handle }>({ op: "getTableCellBody", cell }, "ler").handle,
    );
  }

  /** Quantas células a linha tem. */
  rowWidth(row: Handle): number {
    return this.rowBodies(row).length;
  }

  /** Uma linha nova logo abaixo de `row`, uma célula por texto; devolve o handle dela e o primeiro parágrafo de cada célula. */
  insertRow(row: Handle, values: readonly string[], where: string): { row: Handle; cells: Handle[] } {
    const v = this.run<{ handles: Handle[] }>({ op: "insertTableRows", row, location: "after", count: 1, values: [values] }, where);
    const fresh = v.handles[0];
    if (!fresh) throw new DocxToolError("E_FAILED", `${where}: o motor não devolveu a linha nova`);
    const cells = this.rowBodies(fresh).map((cb) => this.run<{ handles: Handle[] }>({ op: "getParagraphs", body: cb }, where).handles[0]!);
    return { row: fresh, cells };
  }

  remove(p: Handle, where: string): void {
    this.run({ op: "deleteParagraph", paragraph: p }, where);
  }

  bytes(path: string): Uint8Array {
    const r = this.host.save();
    if (!r.ok) throw new DocxToolError("E_FAILED", `não deu para gravar ${path}`);
    return r.bytes;
  }

  close(): void {
    this.host.dispose();
  }
}

export interface DocxReadArgs {
  caminho: string;
  /** O primeiro parágrafo (a partir de 1) e o último. */
  de?: number;
  ate?: number;
}

/**
 * Os parágrafos de um intervalo, numerados como o `docx_edit` os pede, com o texto que a pessoa vê. `filtrar` passa o
 * texto pelo filtro dos segredos.
 */
export async function docxRead(reader: VaultReader, a: DocxReadArgs, filtrar: (text: string) => Promise<string>): Promise<Record<string, unknown>> {
  const path = a.caminho.trim().replace(/^\/+/, "");
  if (!isDocxPath(path)) throw new DocxToolError("E_BAD_ARGS", `o \`docx_read\` lê só docx; para ${path}, use files_read`);
  const f = await reader.file(path);
  if ("tooLarge" in f || f.size > DOCX_MAX_BYTES) throw new DocxToolError("E_TOO_LARGE", `${path} é grande demais para abrir aqui`);
  if (!("base64" in f)) throw new DocxToolError("E_FAILED", `não deu para ler ${path}`);
  const doc = DocxDoc.open(fromBase64(f.base64), path);
  try {
    const all = doc.paragraphs();
    const de = Math.max(1, a.de ?? 1);
    if (de > Math.max(1, all.length)) throw new DocxToolError("E_BAD_ARGS", `${path} tem ${all.length} parágrafos`);
    const ate = Math.min(all.length, a.ate ?? de + DOCX_READ_PARAGRAPHS - 1);
    const out: { n: number; texto: string; tabela?: number; linha?: number; coluna?: number }[] = [];
    const cells = doc.cells();
    let chars = 0;
    for (let n = de; n <= ate; n++) {
      const texto = doc.text(all[n - 1]!);
      if (out.length && chars + texto.length > DOCX_READ_CHARS) break;
      chars += texto.length;
      // O parágrafo de uma célula diz onde está: o inserir_linha pede um deles.
      const c = cells.get(doc.id(all[n - 1]!));
      out.push(c ? { n, texto, tabela: c.tabela, linha: c.linha, coluna: c.coluna } : { n, texto });
    }
    // O texto passa pelo filtro dos segredos de uma vez: um parágrafo por linha (a quebra de dentro vai num marcador).
    const NL = " ";
    const clean = out.length ? (await filtrar(out.map((p) => p.texto.replace(/\r?\n|\r/g, NL)).join("\n"))).split("\n") : [];
    if (clean.length !== out.length) throw new DocxToolError("E_FAILED", `não deu para ler ${path} com o filtro`);
    out.forEach((p, i) => (p.texto = clean[i]!.replaceAll(NL, "\n")));
    const last = out.at(-1)?.n ?? 0;
    const avisos = last < all.length ? [`Há mais: o documento tem ${all.length} parágrafos; peça o resto com de: ${last + 1}.`] : [];
    return {
      caminho: path,
      versao: f.version,
      total: all.length,
      paragrafos: out,
      ...(avisos.length ? { avisos } : {}),
    };
  } finally {
    doc.close();
  }
}

export type DocxChange =
  | { tipo: "trocar"; paragrafo: number; de: string; para: string }
  | { tipo: "reescrever"; paragrafo: number; texto: string }
  | { tipo: "inserir"; depois_de: number; texto: string }
  | { tipo: "apagar"; paragrafo: number }
  | { tipo: "inserir_linha"; depois_de: number; celulas: string[] };

export interface DocxEditArgs {
  caminho: string;
  versao: string;
  mudancas: DocxChange[];
}

export interface DocxEditResult {
  path: string;
  version: string;
  copy: string;
  before: number;
  after: number;
  ops: DocxOp[];
}

/**
 * Aplica as mudanças no documento aberto, na ordem, e devolve as operações para o ao vivo. Os números dos parágrafos são
 * os do `docx_read` (os de antes das mudanças): um parágrafo inserido não muda o número dos outros.
 */
export function applyDocxChanges(doc: DocxDoc, mudancas: readonly DocxChange[], restore: (s: string) => string): DocxOp[] {
  const paras = doc.paragraphs();
  const ids = paras.map((p) => doc.id(p));
  const gone = new Set<number>();
  /** O último parágrafo inserido depois de cada número: o próximo inserido no mesmo lugar vai depois dele. */
  const tail = new Map<number, { h: Handle; id: string }>();
  /** A última linha inserida abaixo de cada linha da tabela, e o primeiro parágrafo dela: a próxima vai depois. */
  const tailRow = new Map<Handle, { row: Handle; id: string }>();
  let cells: ReturnType<DocxDoc["cells"]> | null = null;
  const ops: DocxOp[] = [];
  const text = (m: { [k: string]: unknown }, k: string, where: string) => {
    if (typeof m[k] !== "string") throw new DocxToolError("E_BAD_ARGS", `${where}.${k} é um texto`);
    return restore(m[k] as string);
  };
  const para = (m: { [k: string]: unknown }, k: string, where: string, zero = false) => {
    const n = m[k];
    if (!Number.isInteger(n) || (n as number) < (zero ? 0 : 1) || (n as number) > paras.length)
      throw new DocxToolError("E_BAD_ARGS", `${where}.${k}: o documento tem ${paras.length} parágrafos (de 1 a ${paras.length}${zero ? "; 0 é o início" : ""})`);
    if ((n as number) > 0 && gone.has(n as number)) throw new DocxToolError("E_BAD_ARGS", `${where}.${k}: o parágrafo ${n} foi apagado numa mudança anterior`);
    return n as number;
  };
  mudancas.forEach((m, i) => {
    const where = `mudancas[${i}]`;
    if (!m || typeof m !== "object") throw new DocxToolError("E_BAD_ARGS", `${where} não é um objeto`);
    const mm = m as unknown as { [k: string]: unknown };
    switch (m.tipo) {
      case "trocar": {
        const n = para(mm, "paragrafo", where);
        const de = text(mm, "de", where);
        const para_ = text(mm, "para", where);
        if (!de) throw new DocxToolError("E_BAD_ARGS", `${where}.de está vazio; para escrever o parágrafo inteiro, use reescrever`);
        const hits = doc.find(paras[n - 1]!, de, where);
        if (!hits.length) throw new DocxToolError("E_NOT_FOUND", `${where}: "${de}" não está no parágrafo ${n}. Nada foi escrito: confira com o docx_read.`);
        if (hits.length > 1) throw new DocxToolError("E_BAD_ARGS", `${where}: "${de}" aparece ${hits.length} vezes no parágrafo ${n}; mande um trecho maior, que apareça uma vez só.`);
        const { from, to } = hits[0]!;
        doc.replace(paras[n - 1]!, from, to, para_, where);
        ops.push({ op: "replace", paragraphId: ids[n - 1]!, from, to, text: para_ });
        break;
      }
      case "reescrever": {
        const n = para(mm, "paragrafo", where);
        const texto = text(mm, "texto", where).replace(/\r?\n|\r/g, " ");
        const old = doc.modelText(paras[n - 1]!);
        doc.replace(paras[n - 1]!, 0, old.length, texto, where);
        ops.push({ op: "replace", paragraphId: ids[n - 1]!, from: 0, to: old.length, text: texto });
        break;
      }
      case "inserir": {
        const n = para(mm, "depois_de", where, true);
        // Uma quebra de linha no texto faz um parágrafo para cada linha.
        for (const line of text(mm, "texto", where).split(/\r?\n|\r/)) {
          const prev = tail.get(n) ?? (n > 0 ? { h: paras[n - 1]!, id: ids[n - 1]! } : null);
          const h = doc.insert(prev?.h ?? null, line, where);
          const id = doc.id(h);
          ops.push({ op: "insert", after: prev?.id ?? null, paragraphId: id, text: line });
          tail.set(n, { h, id });
        }
        break;
      }
      case "inserir_linha": {
        const n = para(mm, "depois_de", where);
        const raw = mm.celulas;
        if (!Array.isArray(raw) || !raw.length || raw.some((c) => typeof c !== "string"))
          throw new DocxToolError("E_BAD_ARGS", `${where}.celulas é uma lista de textos, um por célula`);
        cells ??= doc.cells();
        const c = cells.get(ids[n - 1]!);
        if (!c) throw new DocxToolError("E_BAD_ARGS", `${where}.depois_de: o parágrafo ${n} não está numa tabela; mande um parágrafo de uma célula da linha de cima (o docx_read diz a tabela, a linha e a coluna)`);
        // Pela linha, não pelo número: duas células da mesma linha dão o mesmo lugar.
        const at = tailRow.get(c.row) ?? { row: c.row, id: ids[n - 1]! };
        const width = doc.rowWidth(at.row);
        if (raw.length > width) throw new DocxToolError("E_BAD_ARGS", `${where}.celulas: a linha tem ${width} células e vieram ${raw.length}`);
        const values = [...raw.map((c) => restore(c as string).replace(/\r?\n|\r/g, " ")), ...Array<string>(width - raw.length).fill("")];
        const fresh = doc.insertRow(at.row, values, where);
        const out = fresh.cells.map((h, i) => ({ paragraphId: doc.id(h), text: values[i]! }));
        ops.push({ op: "insertRow", after: at.id, cells: out });
        tailRow.set(c.row, { row: fresh.row, id: out[0]!.paragraphId });
        break;
      }
      case "apagar": {
        const n = para(mm, "paragrafo", where);
        if (gone.size + 1 >= paras.length && !tail.size) throw new DocxToolError("E_BAD_ARGS", `${where}: o documento não pode ficar sem parágrafos`);
        doc.remove(paras[n - 1]!, where);
        gone.add(n);
        ops.push({ op: "delete", paragraphId: ids[n - 1]! });
        break;
      }
      default:
        throw new DocxToolError("E_BAD_ARGS", `${where}.tipo: ${(m as { tipo?: unknown }).tipo} não é um tipo de mudança`);
    }
  });
  return ops;
}

/**
 * Muda o docx: confere a versão, aplica as mudanças na ordem, espera a pessoa sair dos parágrafos que elas mudam e grava
 * os bytes com as operações, depois de guardar a cópia de antes no registro.
 */
export async function docxEdit(
  writer: VaultWriter,
  journal: { keep(path: string, before: string): Promise<string>; drop(copy: string): Promise<void> },
  a: DocxEditArgs,
  restore: (path: string, text: string) => string,
): Promise<DocxEditResult> {
  if (!writer.getBytes || !writer.saveBytes) throw new DocxToolError("E_UNKNOWN_TOOL", "o Kiwi não tem a ferramenta `docx_edit`");
  const path = a.caminho.trim().replace(/^\/+/, "");
  if (!isDocxPath(path)) throw new DocxToolError("E_BAD_ARGS", "o `docx_edit` muda só docx");
  if (!Array.isArray(a.mudancas) || !a.mudancas.length) throw new DocxToolError("E_BAD_ARGS", "mudancas está vazio");
  if (a.mudancas.length > DOCX_EDIT_CHANGES) throw new DocxToolError("E_BAD_ARGS", `no máximo ${DOCX_EDIT_CHANGES} mudanças por vez`);
  const f = await writer.getBytes(path);
  if ("tooLarge" in f) throw new DocxToolError("E_TOO_LARGE", `${path} é grande demais para abrir aqui`);
  if (f.version !== a.versao) throw new DocxToolError("E_CHANGED", `${path} mudou desde que você leu. Nada foi escrito: leia de novo com \`docx_read\` e mande a versao nova.`);
  const before = fromBase64(f.base64);
  if (before.length > DOCX_MAX_BYTES) throw new DocxToolError("E_TOO_LARGE", `${path} é grande demais para abrir aqui`);

  const doc = DocxDoc.open(before, path);
  let after: Uint8Array;
  let ops: DocxOp[];
  try {
    ops = applyDocxChanges(doc, a.mudancas, (s) => restore(path, s));
    after = doc.bytes(path);
  } finally {
    doc.close();
  }
  // A pessoa escrevendo num parágrafo que o lote muda: o gato espera ela sair, com teto. Ou o lote grava inteiro
  // depois, ou nada (spec #21155, como a célula da planilha no T21114).
  if (writer.waitParagraphs) {
    const { busy, waited } = await writer.waitParagraphs(path, [...docxOpsTouch(ops)]);
    if (busy) {
      throw new DocxToolError("E_BUSY", `a pessoa está escrevendo no parágrafo que você ia mudar. Nada foi escrito: mude os outros parágrafos num docx_edit sem ele, ou tente de novo daqui a pouco.`);
    }
    if (waited) {
      const now = await writer.getBytes(path);
      if ("tooLarge" in now || now.version !== f.version)
        throw new DocxToolError("E_CHANGED", `a pessoa acabou de mudar ${path} no parágrafo que você ia escrever. Nada foi escrito: leia de novo com \`docx_read\` e decida com o texto dela.`);
    }
  }
  const copy = await journal.keep(path, f.base64);
  let r: Awaited<ReturnType<NonNullable<VaultWriter["saveBytes"]>>>;
  try {
    r = await writer.saveBytes(path, Buffer.from(after).toString("base64"), f.version, undefined, ops);
  } catch (e) {
    await journal.drop(copy);
    throw e;
  }
  if (!r.saved) {
    await journal.drop(copy);
    throw new DocxToolError("E_CHANGED", `${path} mudou enquanto o Kiwi gravava. Nada foi escrito: leia de novo com \`docx_read\`.`);
  }
  return { path: r.path, version: r.version, copy, before: before.length, after: after.length, ops };
}
