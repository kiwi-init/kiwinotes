// A busca no conteúdo de todo arquivo de texto (T21240, spec #21165): o `.txt`, o código, o json, o yaml, o log, o csv e
// o tsv entram na mesma busca das notas, do ⌘K e do Kiwi Cat.
//
// - Um SQLite FTS5 num arquivo dos dados do app (`<dados>/text-index/index.sqlite`, ou `folders/<pasta>/text-index/`),
//   nunca na pasta da pessoa. Cada arquivo guarda o mtime e o tamanho: na abertura seguinte, só o que mudou é lido.
// - O índice guarda só as palavras, não o texto (`content=''`, `detail=column`): com 2.000 arquivos e 97 MB de texto,
//   o banco caiu de 70 MB para uns 10 MB. A busca lê do disco só os candidatos, para conferir o termo e achar a linha.
// - Em segundo plano: lotes pequenos, com uma pausa entre eles, para a busca e a tela seguirem respondendo.
// - Acima de `MAX_VIEW_TEXT_BYTES` (5 MB), ou com cara de binário, o arquivo entra só pelo nome.
// - O `.env` e afins (`isSecretFile`) ficam de fora, nem pelo nome.
// - O cache do SQLite fica pequeno (o relatório da RAM, #159, pôs o FTS5 entre as causas).
// - O pdf, o docx e o xlsx (T22218, issue #156): o texto de dentro sai pelo `docText`, um pedaço (a página, o parágrafo,
//   a célula) por linha. Como tirar o texto custa (o pdf, ~30 ms), o índice guarda também o texto tirado, com o lugar
//   de cada linha (`docs`), e a busca confere por ele, sem abrir o arquivo de novo. Até `MAX_VIEW_BYTES` (25 MB).

import { Database } from "bun:sqlite";
import { chmod, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { drawioPages } from "../../ui/notes/files/drawio.ts";
import { isSecretFile, textNoteTitle } from "../agent/tools/reader.ts";
import { isEditableText, MAX_VIEW_BYTES, MAX_VIEW_TEXT_BYTES } from "../shared/file-view.ts";
import { canvasTexts, parseCanvas } from "../shared/json-canvas.ts";
import { parseQuery } from "../shared/query.ts";
import { fold, foldWithMap } from "../store/text.ts";
import { type DocPlace, docText, isDocText } from "./doc-text.ts";
import { inside } from "./paths.ts";
import type { VaultFile } from "./vault.ts";

/** O quadro branco e o diagrama (T22217): a busca vê o texto dos cartões e os rótulos, não o JSON nem o XML. */
const isDrawing = (p: string): boolean => /\.(canvas|drawio)$/i.test(p);

/**
 * O arquivo que entra no índice: os textos que as Notas editam, o csv, o tsv, o quadro branco e o diagrama; nunca um
 * arquivo de segredos.
 */
export const isIndexedText = (p: string): boolean => (isEditableText(p) || /\.(csv|tsv)$/i.test(p) || isDrawing(p)) && !isSecretFile(p);

/**
 * O texto que a busca vê. No quadro branco, o texto de cada cartão, seta e grupo (`canvasTexts`); no diagrama, o nome
 * de cada página e os rótulos (`drawioPages`, que descompacta a página do draw.io). Assim a palavra do cartão é achada
 * e o `"id"`, o `"x"` e o `mxCell` não. O que não abre como quadro ou diagrama fica só pelo nome. No resto, o texto
 * como está.
 */
export function searchableText(p: string, raw: string): string {
  if (/\.canvas$/i.test(p)) {
    try {
      return canvasTexts(parseCanvas(raw)).map((t) => t.text).join("\n");
    } catch {
      return "";
    }
  }
  if (/\.drawio$/i.test(p)) return (drawioPages(raw) ?? []).flatMap((pg) => [pg.name, ...pg.labels.map((l) => l.text)]).filter(Boolean).join("\n");
  return raw;
}

/** O que o índice lê: os textos acima, o pdf, o docx e o xlsx (T22218). */
export const isIndexedFile = (p: string): boolean => isIndexedText(p) || (isDocText(p) && !isSecretFile(p));

/** O lugar de uma linha do texto tirado, guardado numa linha só: `p3`, `§12`, `cA1\tAba`. */
const placeKey = (at: DocPlace): string => ("page" in at ? `p${at.page}` : "paragraph" in at ? `§${at.paragraph}` : `c${at.cell}\t${at.sheet}`);
function placeOf(key: string): DocPlace | undefined {
  if (key[0] === "p") return { page: Number(key.slice(1)) };
  if (key[0] === "§") return { paragraph: Number(key.slice(1)) };
  if (key[0] === "c") {
    const tab = key.indexOf("\t");
    return { sheet: key.slice(tab + 1), cell: key.slice(1, tab) };
  }
  return undefined;
}

/** O formato que a busca mostra: "py", "json", "csv"… */
export const formatOf = (p: string): string => (/\.([a-z0-9]+)$/i.exec(p)?.[1] ?? "").toLowerCase();

/** Muda quando o esquema muda: o índice velho é apagado e refeito. */
const SCHEMA = 4;
/** Quantos arquivos por lote, e a pausa entre os lotes. */
const BATCH = 40;
/** O texto (em caracteres) que um lote segura na memória antes de gravar. */
const BATCH_TEXT = 8 * 1024 * 1024;
/** O cache de páginas do SQLite, em KB (o padrão é 2 MB por conexão; aqui 512 KB). */
const CACHE_KB = 512;
/**
 * O que uma busca lê do disco para conferir os candidatos (revisão do T21240, como o #524 pôs na busca antiga dos
 * `.txt`): no total e por arquivo. Passado um deles, o candidato vem só pelo índice: aproximado, sem trecho nem linha.
 * Sem isso, 80 logs de 4,8 MB davam meio segundo e +230 MB a cada tecla.
 */
export const SEARCH_READ_TOTAL = 4 * 1024 * 1024;
export const SEARCH_READ_FILE = 512 * 1024;

export interface TextHit {
  path: string;
  title: string;
  snippet: string;
  score: number;
  /** A linha do 1º termo achado, contada de 1. Sem ela (achou só pelo nome), o arquivo abre no começo. */
  line?: number;
  /** No pdf, no docx e no xlsx (T22218), onde o arquivo abre: a página, o parágrafo ou a célula. */
  at?: DocPlace;
  /** Veio só pelo índice, sem ler o arquivo (passou do que a busca lê): as palavras estão nele, a frase não é conferida. */
  approx?: boolean;
  file: { format: string; size: number; mtime: string };
}

export interface TextIndexOptions {
  /** A raiz da pasta de notas. */
  root: string;
  /** `<dados do app>/text-index` (ou o da pasta). */
  dir: string;
  /** O maior texto lido; acima disto, só o nome (testes usam um menor). */
  maxBytes?: number;
  /** O maior pdf, docx ou xlsx lido (o arquivo, não o texto); acima disto, só o nome. */
  maxDocBytes?: number;
  /** A pausa entre os lotes (nos testes, nenhuma). */
  pause?(): Promise<void>;
  /** O que uma busca lê no total e por arquivo (testes usam menos). */
  readTotal?: number;
  readFile?: number;
}

interface FileRow {
  path: string;
  mtime: string;
  size: number;
}

const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;

/** Binário disfarçado de texto: um NUL nos primeiros 8 KB. */
const looksBinary = (b: Uint8Array) => b.subarray(0, 8192).includes(0);

/** O texto do arquivo: UTF-8; se não for UTF-8 válido, latin1 (um `.txt` antigo do Windows). */
function decode(b: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(b);
  } catch {
    return new TextDecoder("latin1").decode(b);
  }
}

/** O texto antes do termo no trecho de um documento (T22218): umas quatro palavras. */
const DOC_SNIPPET_LEAD = 24;

/**
 * A linha (de 1) e o trecho em volta do 1º termo que aparece numa linha, sem diferenciar maiúscula nem acento. A posição
 * vem do mesmo texto que o trecho corta (os espaços já juntados), pelo mapa da dobra: numa linha com recuo ou com
 * espaços no meio, o trecho não se perde (revisão do T21240). `lead`: quanto do texto antes do termo o trecho leva; a
 * linha do pdf é a página inteira, e a lista do ⌘K corta o trecho numa linha só, então o documento leva menos (T22218).
 */
export function lineOf(text: string, terms: readonly string[], lead = 60): { line: number; snippet: string } | null {
  const lines = text.split(/\r?\n/);
  for (const t of terms) {
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i]!;
      if (!fold(raw).includes(t)) continue;
      const flat = raw.replace(/\s+/g, " ");
      const { folded, map } = foldWithMap(flat);
      const k = folded.indexOf(t);
      if (k < 0) continue;
      const at = map[k] ?? 0;
      const to = (map[k + t.length - 1] ?? at) + 1;
      const start = Math.max(0, at - lead);
      const end = Math.min(flat.length, to + 100);
      return { line: i + 1, snippet: `${start > 0 ? "…" : ""}${flat.slice(start, end).trim()}${end < flat.length ? "…" : ""}` };
    }
  }
  return null;
}

export class TextIndex {
  private db: Database | null = null;
  private opening: Promise<Database> | null = null;
  /** Uma passada por vez: a abertura e os avisos do watcher entram na fila. */
  private chain: Promise<void> = Promise.resolve();
  private closed = false;
  private readonly maxBytes: number;
  private readonly pause: () => Promise<void>;
  /** O que a sessão fez (o teste da 2ª abertura e a medição). */
  readonly stats = { read: 0, nameOnly: 0, removed: 0, skipped: 0, docs: 0 };
  /** Os bytes que a última busca leu do disco (o teste do orçamento). */
  lastSearchBytes = 0;

  constructor(private readonly o: TextIndexOptions) {
    this.maxBytes = o.maxBytes ?? MAX_VIEW_TEXT_BYTES;
    this.pause = o.pause ?? (() => new Promise((r) => setTimeout(r, 5)));
  }

  get file(): string {
    return path.join(this.o.dir, "index.sqlite");
  }

  private async open(): Promise<Database> {
    if (this.db) return this.db;
    this.opening ??= (async () => {
      await mkdir(this.o.dir, { recursive: true, mode: 0o700 });
      let db: Database;
      try {
        db = this.connect();
      } catch {
        // Corrompido ou de outro formato: apaga e refaz (é só um cache).
        await rm(this.o.dir, { recursive: true, force: true });
        await mkdir(this.o.dir, { recursive: true, mode: 0o700 });
        db = this.connect();
      }
      await chmod(this.file, 0o600).catch(() => {});
      this.db = db;
      return db;
    })();
    return this.opening;
  }

  private connect(): Database {
    const db = new Database(this.file, { create: true });
    db.exec(`PRAGMA cache_size=-${CACHE_KB}; PRAGMA mmap_size=0; PRAGMA temp_store=FILE; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL`);
    const v = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
    if (v !== SCHEMA) {
      db.exec("DROP TABLE IF EXISTS files; DROP TABLE IF EXISTS body; DROP TABLE IF EXISTS docs");
      // O texto tirado do pdf, do docx e do xlsx: `places` tem o lugar de cada linha de `text`, na mesma ordem.
      db.exec("CREATE TABLE docs(id INTEGER PRIMARY KEY, bytes INTEGER NOT NULL, text TEXT NOT NULL, places TEXT NOT NULL)");
      db.exec("CREATE TABLE files(id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, mtime TEXT NOT NULL, size INTEGER NOT NULL, name_only INTEGER NOT NULL)");
      const fts = "name, text, detail=column, tokenize='unicode61 remove_diacritics 2'";
      try {
        db.exec(`CREATE VIRTUAL TABLE body USING fts5(${fts}, content='', contentless_delete=1)`);
      } catch {
        // Um SQLite antes do 3.43 não tem o `contentless_delete`: o FTS guarda o texto também (maior, mas funciona).
        db.exec(`CREATE VIRTUAL TABLE body USING fts5(${fts})`);
      }
      db.exec(`PRAGMA user_version=${SCHEMA}`);
    }
    return db;
  }

  private queue(job: () => Promise<void>): Promise<void> {
    const next = this.chain.then(job, job).catch((e) => console.error("[text-index]", e instanceof Error ? e.message : e));
    this.chain = next;
    return next;
  }

  /** Todos os arquivos da pasta (na abertura): lê só os novos e os que mudaram, e tira os que saíram. */
  sync(files: Iterable<VaultFile>): Promise<void> {
    const want = new Map<string, VaultFile>();
    for (const f of files) if (isIndexedFile(f.path)) want.set(f.path, f);
    return this.queue(async () => {
      const db = await this.open();
      if (this.closed) return;
      const have = new Map((db.query("SELECT path, mtime, size FROM files").all() as FileRow[]).map((r) => [r.path, r]));
      const gone = [...have.keys()].filter((p) => !want.has(p));
      if (gone.length) this.remove(db, gone);
      const changed = [...want.values()].filter((f) => {
        const h = have.get(f.path);
        return !h || h.mtime !== f.mtime || h.size !== f.size;
      });
      this.stats.skipped += want.size - changed.length;
      await this.index(changed);
    });
  }

  /**
   * Os caminhos que o watcher avisou: `stat` diz o arquivo de agora, ou `undefined` (saiu). O que não é texto é
   * ignorado.
   */
  update(paths: readonly string[], stat: (p: string) => VaultFile | undefined): Promise<void> {
    const list = paths.filter(isIndexedFile);
    if (!list.length) return Promise.resolve();
    return this.queue(async () => {
      const db = await this.open();
      if (this.closed) return;
      const now: VaultFile[] = [];
      const gone: string[] = [];
      for (const p of list) {
        const f = stat(p);
        if (f) now.push(f);
        else gone.push(p);
      }
      if (gone.length) this.remove(db, gone);
      await this.index(now);
    });
  }

  /** Espera as passadas da fila (testes e a medição). */
  idle(): Promise<void> {
    return this.chain;
  }

  private remove(db: Database, paths: readonly string[]) {
    const delFile = db.query("DELETE FROM files WHERE path=? RETURNING id");
    const delBody = db.query("DELETE FROM body WHERE rowid=?");
    const delDoc = db.query("DELETE FROM docs WHERE id=?");
    db.transaction(() => {
      for (const p of paths) {
        const row = delFile.get(p) as { id: number } | null;
        if (row) {
          delBody.run(row.id);
          delDoc.run(row.id);
        }
      }
    })();
    this.stats.removed += paths.length;
  }

  private async index(files: readonly VaultFile[]): Promise<void> {
    let i = 0;
    while (i < files.length) {
      if (this.closed) return;
      const batch: { f: VaultFile; text: string | null; places?: string }[] = [];
      // O lote fecha em `BATCH` arquivos ou em `BATCH_TEXT` de texto guardado na memória (T22218: uma planilha tirada
      // chega a 5 MB de texto, e 40 delas de uma vez seriam 200 MB).
      let held = 0;
      while (i < files.length && batch.length < BATCH && held < BATCH_TEXT) {
        const f = files[i++]!;
        let text: string | null = null;
        if (isDocText(f.path)) {
          const doc = await this.readDoc(f);
          if (doc === undefined) continue; // sumiu ou saiu da pasta por um link
          batch.push(doc ? { f, text: doc.text, places: doc.places } : { f, text: null });
          held += doc ? doc.text.length + doc.places.length : 0;
          continue;
        }
        if (f.size <= this.maxBytes) {
          let abs: string;
          try {
            abs = inside(this.o.root, f.path);
          } catch {
            continue; // passa por um link simbólico para fora: não entra
          }
          const bytes = await readFile(abs).catch(() => undefined);
          if (bytes === undefined) continue; // sumiu entre o aviso e a leitura: o próximo aviso diz
          if (bytes.byteLength <= this.maxBytes && !looksBinary(bytes)) text = searchableText(f.path, decode(bytes));
        }
        batch.push({ f, text });
        held += text?.length ?? 0;
      }
      const db = this.db;
      if (!db || this.closed) return;
      const upFile = db.query(
        "INSERT INTO files(path, mtime, size, name_only) VALUES (?,?,?,?) ON CONFLICT(path) DO UPDATE SET mtime=excluded.mtime, size=excluded.size, name_only=excluded.name_only RETURNING id",
      );
      const delBody = db.query("DELETE FROM body WHERE rowid=?");
      const addBody = db.query("INSERT INTO body(rowid, name, text) VALUES (?,?,?)");
      const delDoc = db.query("DELETE FROM docs WHERE id=?");
      const addDoc = db.query("INSERT INTO docs(id, bytes, text, places) VALUES (?,?,?,?)");
      db.transaction(() => {
        for (const { f, text, places } of batch) {
          const { id } = upFile.get(f.path, f.mtime, f.size, text === null ? 1 : 0) as { id: number };
          delBody.run(id);
          delDoc.run(id);
          addBody.run(id, fold(f.path), text ?? "");
          if (text !== null && places !== undefined) addDoc.run(id, Buffer.byteLength(text), text, places);
          if (text === null) this.stats.nameOnly++;
          else this.stats.read++;
        }
      })();
      if (i < files.length) await this.pause();
    }
  }

  /**
   * Os arquivos com todas as palavras e "frases" no caminho ou no texto, sem os excluídos (`-palavra`, `-path:`), na
   * ordem do BM25. O `path:` vale; `tag:` é de nota, e com ele a busca fica só nas notas.
   */
  async search(query: string, limit: number, stat: (p: string) => VaultFile | undefined): Promise<TextHit[]> {
    if (limit <= 0) return [];
    const q = parseQuery(query);
    if (q.tags.length || q.notTags.length) return [];
    const terms = [...q.words, ...q.phrases].filter(Boolean);
    if (!terms.length) return [];
    const db = await this.open();
    if (this.closed) return [];
    // O FTS escolhe os candidatos (cada termo como prefixo, no nome ou no texto); a conferência abaixo exige o termo
    // inteiro no texto dobrado, como a busca das notas.
    // O índice não guarda posições (`detail=column`): a "frase" entra palavra por palavra, e a conferência pede a frase.
    const tokens = [...new Set(terms.flatMap((t) => t.split(/[^\p{L}\p{N}]+/u)).filter(Boolean))];
    if (!tokens.length) return [];
    // O `-palavra` também vai ao índice, para o candidato aproximado (que não é lido) já vir sem ela.
    const not = [...new Set(q.notText.map((t) => t.split(/[^\p{L}\p{N}]+/u).filter(Boolean)).filter((w) => w.length === 1).map((w) => w[0]!))];
    const match = tokens.map((t) => `{name text}: ${quote(t)}${/^\d+$/.test(t) ? "" : "*"}`).join(" AND ") + not.map((t) => ` NOT {name text}: ${quote(t)}`).join("");
    let rows: { path: string; nameOnly: number; rank: number }[];
    try {
      rows = db
        .query("SELECT f.path AS path, f.name_only AS nameOnly, bm25(body, 2, 1) AS rank FROM body JOIN files f ON f.id = body.rowid WHERE body MATCH ? ORDER BY rank LIMIT ?")
        .all(match, Math.max(limit * 4, 50)) as typeof rows;
    } catch {
      return [];
    }
    const out: TextHit[] = [];
    let budget = this.o.readTotal ?? SEARCH_READ_TOTAL;
    const perFile = this.o.readFile ?? SEARCH_READ_FILE;
    this.lastSearchBytes = 0;
    for (const r of rows) {
      if (out.length >= limit) break;
      const where = fold(r.path);
      if (q.paths.length && !q.paths.some((p) => where.startsWith(`${p}/`) || where === p)) continue;
      if (q.notPaths.some((p) => where.startsWith(`${p}/`) || where === p)) continue;
      const f = stat(r.path);
      if (!f) continue; // saiu e o aviso ainda não chegou
      const hit = { path: r.path, title: textNoteTitle(r.path), score: -r.rank, file: { format: formatOf(r.path), size: f.size, mtime: f.mtime } };
      // O pdf, o docx e o xlsx contam pelo texto já tirado, que é o que a busca lê (T22218).
      const isDoc = !r.nameOnly && isDocText(r.path);
      const cost = isDoc ? this.storedDocSize(db, r.path) : f.size;
      // Passou do que a busca lê: vem pelo índice só, aproximado (o FTS já tem todas as palavras e nenhuma do `-`).
      if (!r.nameOnly && (cost > perFile || cost > budget)) {
        out.push({ ...hit, snippet: "", approx: true });
        continue;
      }
      // O texto vem do disco (o índice só tem as palavras); o arquivo grande demais ou binário fica só pelo nome. O do
      // pdf, do docx e do xlsx vem do texto já tirado, com o lugar de cada linha.
      const doc = isDoc ? this.storedDoc(db, r.path) : null;
      const raw = r.nameOnly ? "" : isDoc ? (doc?.text ?? "") : await this.readText(r.path, perFile);
      if (!r.nameOnly) {
        budget -= cost;
        this.lastSearchBytes += cost;
      }
      if (raw === null) continue;
      const body = fold(raw).replace(/\s+/g, " ");
      if (q.notText.some((t) => body.includes(t))) continue;
      if (!terms.every((t) => body.includes(t) || where.includes(t))) continue;
      // No quadro e no diagrama, a linha é do texto extraído, não do arquivo: o trecho vai, a linha não.
      const at = raw ? lineOf(raw, terms, doc ? DOC_SNIPPET_LEAD : undefined) : null;
      if (at && isDrawing(r.path)) {
        out.push({ ...hit, snippet: at.snippet });
        continue;
      }
      const place = at && doc ? placeOf(doc.places.split("\n")[at.line - 1] ?? "") : undefined;
      out.push({ ...hit, snippet: at?.snippet ?? "", ...(at && !doc ? { line: at.line } : {}), ...(place ? { at: place } : {}) });
    }
    return out;
  }

  /**
   * O texto de dentro de um pdf, docx ou xlsx (T22218), uma linha por pedaço, e o lugar de cada linha. `null`: entra só
   * pelo nome (grande demais, quebrado, com senha, sem texto); `undefined`: sumiu ou saiu da pasta por um link.
   */
  private async readDoc(f: VaultFile): Promise<{ text: string; places: string } | null | undefined> {
    if (f.size > (this.o.maxDocBytes ?? MAX_VIEW_BYTES)) return null;
    let abs: string;
    try {
      abs = inside(this.o.root, f.path);
    } catch {
      return undefined;
    }
    const bytes = await readFile(abs).catch(() => undefined);
    if (bytes === undefined) return undefined;
    if (bytes.byteLength > (this.o.maxDocBytes ?? MAX_VIEW_BYTES)) return null;
    try {
      const d = await docText(f.path, new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), this.maxBytes);
      if (!d.segments.length) return null;
      this.stats.docs++;
      return { text: d.segments.map((s) => s.text).join("\n"), places: d.segments.map((s) => placeKey(s.at)).join("\n") };
    } catch {
      return null; // não abre: fica pelo nome, como o binário
    }
  }

  /** O tamanho (em bytes) do texto já tirado de um pdf, docx ou xlsx: o que a busca leria. */
  private storedDocSize(db: Database, rel: string): number {
    return (db.query("SELECT d.bytes AS bytes FROM docs d JOIN files f ON f.id = d.id WHERE f.path=?").get(rel) as { bytes: number } | null)?.bytes ?? 0;
  }

  /** O texto já tirado de um pdf, docx ou xlsx (T22218), para a busca conferir sem abrir o arquivo. */
  private storedDoc(db: Database, rel: string): { text: string; places: string } | null {
    return db.query("SELECT d.text AS text, d.places AS places FROM docs d JOIN files f ON f.id = d.id WHERE f.path=?").get(rel) as { text: string; places: string } | null;
  }

  /** O texto de um arquivo indexado, para a busca conferir; `null` se sumiu ou saiu da pasta por um link. */
  private async readText(rel: string, max: number): Promise<string | null> {
    let abs: string;
    try {
      abs = inside(this.o.root, rel);
    } catch {
      return null;
    }
    const bytes = await readFile(abs).catch(() => undefined);
    if (bytes === undefined) return null;
    return bytes.byteLength <= Math.min(max, this.maxBytes) && !looksBinary(bytes) ? searchableText(rel, decode(bytes)) : "";
  }

  /** Fecha o banco (a pasta saiu de cena). */
  async close(): Promise<void> {
    this.closed = true;
    await this.chain;
    this.db?.close();
    this.db = null;
  }

  /** Fecha e apaga o índice (a pasta saiu do Kiwi). */
  async destroy(): Promise<void> {
    await this.close();
    await rm(this.o.dir, { recursive: true, force: true });
  }
}
