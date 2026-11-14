// O vault das notas (T1316, spec #1107): Markdown puro em ~/KiwiNotes, um .md por nota, frontmatter YAML e links
// [[nota]]. Abre no Obsidian sem perder nada: o app não reescreve uma nota que a pessoa não salvou, e só mexe no texto
// de outra nota para atualizar um [[link]] num rename. Não há banco: o índice vive na memória e se refaz do disco
// (no início e pelo watcher, que pega também o que muda fora do app, como no Obsidian).

import { NoteSearchIndex } from "./search-index.ts";
import { embedContent, type EmbedKind, parseEmbed } from "./embed.ts";
import { noteChunks } from "./semantic/chunks.ts";
import type { SemanticDocument, SemanticHit } from "./semantic/index.ts";
import { lexicalMatch, lexicalWords } from "../shared/lexical.ts";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { type FSWatcher, watch } from "node:fs";
import { isUtf8 } from "node:buffer";
import { chmod, lstat, mkdir, open as openFile, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import type { Stats } from "node:fs";
import path from "node:path";

import { makeFileResolver, makeResolver, noteName, parseLinks, type Resolver, rewriteLinksMany } from "../shared/wikilinks.ts";
import { fold, foldWithMap } from "../store/text.ts";
import { extOf, isPackageDir, PACKAGE_MARKS } from "../shared/attachments.ts";
import { isEditableText, MAX_VIEW_BYTES, MAX_VIEW_TEXT_BYTES, viewLimit } from "../shared/file-view.ts";
import { approxWord, typoBudget, wordsOf } from "../shared/fuzzy.ts";
import { hasPositive, MAX_SEARCH_QUERY, oneSpace, parseQuery, searchTooLong } from "../shared/query.ts";
import { bodyTags, cleanTag, hasTag, tagKey, type TagNode, tagTree, uniqueTags } from "../shared/tags.ts";
import { fillTemplate } from "../shared/templates.ts";
import { contextOf, linkSpans, unlinkedSpans } from "./mentions.ts";
import { canvasPath, fileNameFor, filePath, folderPath, inside, linkSafeTarget, notePath, VaultError } from "./paths.ts";
import { CanvasParseError, parseCanvas, stringifyCanvas } from "../shared/json-canvas.ts";
import { applyTextEdits, headingFor, headingKey, markdownStructure } from "../shared/markdown-structure.ts";
import { noteReferences, referenceTarget, rewriteHeadingReferences, rewriteNoteReferences, rewriteTag, validTag, type LinkWarning, type RefactorResult } from "./refactor.ts";

export interface NoteMeta {
  /** Relativo ao vault, POSIX, com `.md`. */
  path: string;
  /** O nome do arquivo sem `.md`, como no Obsidian. */
  title: string;
  /** A pasta, relativa ao vault ("" na raiz). */
  folder: string;
  /** ISO 8601. */
  mtime: string;
  /** Quando a nota nasceu (o birthtime do arquivo), ISO 8601 (T2468: "ordenar por criação"). */
  ctime: string;
  size: number;
  /** Muda a cada mudança do conteúdo: é o `baseVersion` do `save`. */
  version: string;
  tags: string[];
}

export interface Note extends NoteMeta {
  /** O .md inteiro, com o frontmatter. */
  content: string;
  /**
   * O arquivo não é UTF-8 (Latin-1 de um app antigo do Windows, T7575): o texto perdeu os bytes que o Kiwi não entendeu
   * (viraram U+FFFD). A janela só mostra, e nada grava por cima: o `write` recusa com `E_NOT_UTF8`.
   */
  readOnly?: true;
}

export type SaveResult = { saved: true; meta: NoteMeta } | { saved: false; current: Note };

/** Um quadro branco (T6600): o texto do `.canvas` como está no disco, e a versão (o mesmo hash das notas). */
export interface CanvasFile {
  path: string;
  content: string;
  version: string;
}
/**
 * Um arquivo do cofre que não é nota, lido para as Notas mostrarem (spec #7079): o texto, ou os bytes em base64. Acima
 * do limite (`viewLimit`), só o tamanho: a UI avisa e oferece o app padrão.
 */
export type FileContent =
  | { path: string; size: number; version: string; text: string; /** Não é UTF-8: o texto perdeu bytes, e o `files.save` o recusaria (T7105). */ readOnly?: true }
  | { path: string; size: number; version: string; base64: string }
  | { path: string; size: number; tooLarge: true; limit: number };

/** O `files.save` (T7105): gravou, ou o arquivo mudou desde `baseVersion` e volta o de agora, sem escrever. */
export type FileSaveResult =
  | { saved: true; path: string; size: number; version: string }
  | { saved: false; current: FileContent };

export type CanvasSaveResult = { saved: true; path: string; version: string } | { saved: false; current: CanvasFile };

/** O `.canvas` novo: o quadro vazio, no formato do Obsidian. */
const EMPTY_CANVAS = stringifyCanvas({ nodes: [], edges: [] });

export interface SearchHit {
  path: string;
  title: string;
  snippet: string;
  score: number;
  /** Achou só por aproximação (T2966): alguma palavra casou com erro de digitação. O exato vem antes. */
  approx?: boolean;
  /** Achou só pelo sentido (T6013): nenhuma palavra casou, e o trecho é o da nota mais perto da busca. */
  semantic?: boolean;
}

/** Quantas notas a busca pelo sentido traz no máximo, além das que casam pelas palavras. */
export const SEMANTIC_LIMIT = 8;
/** A constante do Reciprocal Rank Fusion (Cormack et al., 2009): a soma de 1/(k + posição) em cada lista. */
const RRF_K = 60;

/** O trecho que casou pelo sentido, refeito da nota (o índice não guarda texto): até ~160 caracteres. */
function semanticSnippet(title: string, content: string, chunk: number): string {
  const text = noteChunks(title, content)[chunk] ?? "";
  const body = text.startsWith(`${title.trim()}. `) ? text.slice(title.trim().length + 2) : text;
  return body.length > 160 ? `${body.slice(0, 160).trimEnd()}…` : body;
}

/** Um arquivo do vault que não é nota (T3370): anexo, PDF, o `.canvas` do Obsidian. A árvore mostra todos. */
export interface VaultFile {
  path: string;
  size: number;
  mtime: string;
}

/**
 * O que o `list` devolve. `filesVersion` (spec #13384): a versão dos arquivos que não são nota; com ela no pedido, vem
 * nada (`files` e `filesDelta` ausentes: não mudou), só a diferença, ou a lista inteira.
 */
export interface VaultList {
  folders: string[];
  notes: NoteMeta[];
  tree: FolderNode;
  files?: VaultFile[];
  filesDelta?: { set: VaultFile[]; removed: string[] };
  filesVersion?: string;
}

/** Uma pasta do vault com o que tem dentro (T2468): a raiz tem `path` e `name` vazios. */
export interface FolderNode {
  path: string;
  name: string;
  folders: FolderNode[];
  /** Os caminhos das notas desta pasta (não das de dentro das filhas). */
  notes: string[];
}

export interface Backlink {
  path: string;
  title: string;
  context: string;
}

interface Entry {
  meta: NoteMeta;
  /** O texto dobrado (sem acento nem maiúscula), para a busca. */
  folded: string;
  foldedTitle: string;
  /** Os alvos dos [[links]] desta nota, como estão escritos. */
  links: string[];
  content: string;
  /** O inode do arquivo: um rename feito fora (Obsidian, Finder) mantém, e é assim que a gente reconhece (T2559). */
  ino: number;
  /** Os `aliases:` do frontmatter (T5352): outros nomes pelos quais um [[link]] acha esta nota. */
  aliases: string[];
  /** O mtime em ms e o tamanho de quando a entrada foi feita (T5352): igual no disco, o scan reaproveita sem reler. */
  mtimeMs: number;
}

/** O que mudou de lugar ou sumiu por fora do app, visto pelo watcher (T2559). */
export interface ExternalMoves {
  /** De onde para onde, nota a nota. */
  moves: Map<string, string>;
  /** As notas que sumiram sem aparecer em outro lugar. */
  gone: string[];
}

type Snapshot = Map<string, { ino: number; version: string }>;

/**
 * As notas que sumiram de `before` e apareceram em `after`: a mesma pelo inode (um rename de fora); sem o inode, pelo
 * mesmo conteúdo, quando só uma bate (um mover que copiou e apagou). O resto que sumiu é `gone`.
 */
export function reconcileMoves(before: Snapshot, after: Snapshot): ExternalMoves {
  const vanished = [...before.keys()].filter((p) => !after.has(p));
  const appeared = [...after.keys()].filter((p) => !before.has(p));
  const moves = new Map<string, string>();
  const taken = new Set<string>();
  for (const from of vanished) {
    const b = before.get(from)!;
    let to = appeared.find((p) => !taken.has(p) && after.get(p)!.ino === b.ino);
    if (!to) {
      const same = appeared.filter((p) => !taken.has(p) && after.get(p)!.version === b.version);
      if (same.length === 1) to = same[0];
    }
    if (to) {
      moves.set(from, to);
      taken.add(to);
    }
  }
  return { moves, gone: vanished.filter((p) => !moves.has(p)) };
}

/**
 * As fixadas depois de uma mudança por fora: a nota que mudou de lugar vai junto; a pasta que sumiu vai para onde as
 * notas dela foram (pelo mesmo resto de caminho); o que sumiu de vez, ou não existe mais, sai.
 */
export function followPinned(pinned: readonly string[], r: ExternalMoves, now: { notes: ReadonlySet<string>; folders: ReadonlySet<string> }): string[] {
  const out: string[] = [];
  for (const p of pinned) {
    let next: string | null = p;
    if (/\.md$/i.test(p)) {
      next = r.moves.get(p) ?? (now.notes.has(p) ? p : null);
    } else if (!now.folders.has(p)) {
      next = null;
      for (const [from, to] of r.moves) {
        if (!from.startsWith(`${p}/`)) continue;
        const rest = from.slice(p.length);
        if (to.endsWith(rest) && to.length > rest.length) {
          next = to.slice(0, to.length - rest.length);
          break;
        }
      }
      if (next !== null && !now.folders.has(next)) next = null;
    }
    if (next !== null && !out.includes(next)) out.push(next);
  }
  return out;
}

export interface IndexProgress { seen: number; notes: number; done: boolean }

export interface VaultOptions {
  root: string;
  onIndexProgress?(progress: IndexProgress): void;
  strictRoot?: boolean;
  /** Manda para a Lixeira do macOS. Nos testes, de mentira. */
  trash?: (abs: string) => Promise<void>;
  /** Quanto o watcher junta mudanças antes de avisar. */
  debounceMs?: number;
  /** Quanto depois de começar a olhar vem a conferida do disco (T6412). Padrão: `RECONCILE_MS`. */
  reconcileMs?: number;
  /** Liga o watcher ao abrir (o app liga; os testes ligam na mão). */
  watch?: boolean;
  /** Quanto o apagado espera em `.kiwi-trash` (o "Desfazer") antes de ir para a Lixeira do macOS. */
  undoMs?: number;
  /** Agora, em ms (os testes fixam). */
  now?: () => number;
}

/** A pasta oculta do "Desfazer" (T2468): o vault ignora pontos, e o Obsidian também. */
export const UNDO_DIR = ".kiwi-trash";
/** 10 min para desfazer um apagar. */
export const UNDO_MS = 10 * 60_000;
/** A conferida depois do `watch()` (T6412): o FSEvents perde o que muda logo no começo; 1 s depois ele já está de pé. */
export const RECONCILE_MS = 1_000;

/** O que foi apagado, para a Lixeira do app (T2593): no "Desfazer" (`kiwi`) ou já no Lixo do macOS (`macos`). */
export interface TrashItem {
  path: string;
  kind: "note" | "folder";
  deletedAt: string;
  where: "kiwi" | "macos";
  /** Até quando o `restore` vale (só no `kiwi`). */
  until?: string;
}

/** Quantas entradas do Lixo do macOS o registro guarda, e por quanto tempo. */
export const REGISTRY_MAX = 200;
export const REGISTRY_DAYS = 30;
const REGISTRY_FILE = "registry.json";
/** Em cada caixa do `.kiwi-trash`: de onde o item veio, para uma sessão que caiu ainda saber (T2593). */
const BOX_META = ".meta.json";

interface RegistryEntry {
  path: string;
  kind: "note" | "folder";
  deletedAt: string;
}

/** Um `AAAA-MM-DD` que existe no calendário. */
export function isDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** A data local de `ms`, `AAAA-MM-DD` (a nota do dia é a do relógio da pessoa, não a do UTC). */
export function localDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface Staged {
  /** Onde o item está agora, dentro de `.kiwi-trash`. */
  abs: string;
  kind: "note" | "folder";
  at: number;
  timer: ReturnType<typeof setTimeout> | null;
}

/** O `trash` do macOS (macOS 14+): a nota vai para a Lixeira, de onde dá para voltar. */
export function macTrash(abs: string): Promise<void> {
  // T7681: o headless (os testes dos agentes) nunca manda nada para o Lixo da pessoa do Mac. Ele passa o próprio lixo;
  // um vault que escapou disso falha aqui em vez de apagar de verdade.
  if (process.env.KIWI_HEADLESS === "1") return Promise.reject(new Error("the headless never uses the macOS Trash"));
  return new Promise((resolve, reject) => {
    const p = spawn("/usr/bin/trash", [abs], { stdio: "ignore" });
    p.on("error", reject);
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`trash exited with ${code}`))));
  });
}

export const versionOf = (content: string) => createHash("sha256").update(content).digest("hex").slice(0, 16);

/** O texto de um quadro para gravar: uma string de até 5 MB que abre como JSON Canvas (T6600). */
function canvasText(content: unknown): string {
  if (typeof content !== "string") throw new VaultError("E_BAD_ARGS", "content must be a string");
  if (content.length > 5_000_000) throw new VaultError("E_BAD_ARGS", "content is larger than 5 MB");
  try {
    parseCanvas(content);
  } catch (e) {
    if (e instanceof CanvasParseError) throw new VaultError("E_BAD_ARGS", e.message);
    throw e;
  }
  return content;
}

/** Os `aliases:` (ou `alias:`) do frontmatter, como o Obsidian lê: lista YAML, `[a, b]` ou um texto só (T5352). */
export function aliasesOf(content: string): string[] {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!fm || !/^(aliases|alias)\s*:/m.test(fm[1]!)) return [];
  try {
    const data = Bun.YAML.parse(fm[1]!) as Record<string, unknown> | null;
    const raw = data && typeof data === "object" ? (data.aliases ?? data.alias) : undefined;
    const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
    return [...new Set(list.filter((a): a is string => typeof a === "string").map((a) => a.trim()).filter((a) => a && a.length <= 200))];
  } catch {
    return [];
  }
}

/**
 * Escreve e garante no disco antes da troca (T5352): o `fsync` do arquivo temporário vem antes do `rename`, e o da pasta
 * depois, para uma queda de energia nunca deixar uma nota vazia ou pela metade no lugar da boa.
 */
export async function writeDurable(file: string, content: string): Promise<void> {
  const fh = await openFile(file, "w");
  try {
    await fh.writeFile(content);
    await fh.sync();
  } finally {
    await fh.close();
  }
}

async function syncDir(dir: string): Promise<void> {
  const fh = await openFile(dir, "r").catch(() => null);
  if (!fh) return;
  await fh.sync().catch(() => {});
  await fh.close().catch(() => {});
}

/** Até quantas leituras de nota ao mesmo tempo no scan (T5352): o disco responde melhor em paralelo, sem abrir demais. */
const READ_AT_ONCE = 16;

/** As tags do frontmatter (`tags: [a, b]` ou lista YAML) e as `#tag` do texto. */
function tagsOf(content: string): string[] {
  const tags = new Set<string>();
  const fm = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (fm) {
    try {
      const data = Bun.YAML.parse(fm[1]!) as Record<string, unknown> | null;
      const raw = data && typeof data === "object" ? (data.tags ?? data.tag) : undefined;
      for (const t of Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,\s]+/) : []) {
        if (typeof t === "string" && t.trim()) tags.add(t.trim());
      }
    } catch {
      // frontmatter que não é YAML: fica como texto, sem tags
    }
  }
  // As do texto com as regras do Obsidian (T2619: fora de código, nada de número puro), sem repetir maiúscula.
  for (const t of bodyTags(fm ? content.slice(fm[0].length) : content)) tags.add(t);
  return uniqueTags(tags);
}

/** O texto da nota com cada sequência de espaços (inclusive quebra de linha) num espaço só, feito na 1ª busca por frase. */
const flatText = new WeakMap<Entry, string>();

/** O termo está no texto. Uma "frase" (com espaço) compara com os espaços juntados: casa mesmo quebrada (T2751). */
function inText(e: Entry, t: string): boolean {
  if (!t.includes(" ")) return e.folded.includes(t);
  let flat = flatText.get(e);
  if (flat === undefined) flatText.set(e, (flat = oneSpace(e.folded)));
  return flat.includes(t);
}

/** As palavras distintas do título e do texto, feitas na 1ª busca aproximada (T2966) e jogadas fora com a nota. */
const wordSet = new WeakMap<Entry, Set<string>>();

function wordsOfEntry(e: Entry): Set<string> {
  let set = wordSet.get(e);
  if (!set) wordSet.set(e, (set = new Set([...wordsOf(e.foldedTitle), ...wordsOf(e.folded)])));
  return set;
}

/** O trecho em volta do termo, sem o frontmatter (revisão #2654): uma busca por tag não mostra o `--- tags: … ---`. */
function snippetAround(content: string, term: string): string {
  const fm = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(content);
  const bodyAt = fm ? fm[0].length : 0;
  const { folded, map } = foldWithMap(content);
  // Onde o corpo começa no texto dobrado (o `map` leva do dobrado ao original).
  let foldedBody = 0;
  while (foldedBody < map.length && map[foldedBody]! < bodyAt) foldedBody++;
  const at = term ? folded.indexOf(term, foldedBody) : -1;
  const start = at < 0 ? bodyAt : map[at]!;
  const from = Math.max(bodyAt, start - 60);
  const text = content.slice(from, start + 100).replace(/\s+/g, " ").trim();
  return `${from > bodyAt ? "…" : ""}${text}${start + 100 < content.length ? "…" : ""}`;
}

export class Vault {
  readonly root: string;
  private readonly onIndexProgress?: (progress: IndexProgress) => void;
  private readonly strictRoot: boolean;
  private readonly trash: (abs: string) => Promise<void>;
  private readonly debounceMs: number;
  private readonly watchOnOpen: boolean;
  private notes = new Map<string, Entry>();
  private folders = new Set<string>();
  /** Os arquivos que não são nota (T3370), para a árvore. O conteúdo não é lido. */
  private files = new Map<string, VaultFile>();
  /**
   * A versão dos arquivos que não são nota (spec #13384): muda só quando um deles entra, sai ou muda. O `list()` manda
   * os arquivos só a quem tem outra versão: no cofre do harry eram 150 mil, 15 MB a cada save de uma nota.
   */
  private filesRev = 0;
  private readonly filesId = randomBytes(4).toString("hex");
  /**
   * O que mudou em cada versão recente (o caminho e a versão em que mudou), para mandar só a diferença a quem está pouco
   * atrás. `filesLogFrom`: a versão mais velha que o registro ainda cobre.
   */
  private filesLog: { rev: number; path: string }[] = [];
  private filesLogFrom = 0;
  /** Os arquivos em ordem e o resolvedor dos `[[arquivo.pdf]]`, feitos uma vez por versão. */
  private sortedFiles: VaultFile[] | null = null;
  private fileResolver: Resolver | null = null;
  /** Os documentos-pacote (`.pages`, `.key`… com a marca do formato) que o scan achou (T3371). */
  private packages = new Set<string>();
  /** Fechado (`close`): um `flush` que já estava rodando para no meio e não avisa ninguém (revisão #3499). */
  private closed = false;
  private watcher: FSWatcher | null = null;
  private pendingPaths = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private reconcileTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Cada nota escrita ou apagada pelo app ganha um número (T6412): o scan monta o mapa novo devagar e troca tudo no fim,
   * e uma nota que mudou no meio dele fica com a versão de agora, não com a que o scan leu antes.
   */
  private seq = 0;
  private touchedAt = new Map<string, number>();
  private scans = 0;
  private readonly reconcileMs: number;
  private readonly listeners = new Set<(paths: string[]) => void>();
  private readonly otherListeners = new Set<(paths: string[]) => void>();
  private readonly moveListeners = new Set<(r: ExternalMoves) => void>();
  private ready: Promise<void> | null = null;
  /** A resolução de [[links]] para as notas de agora; refeita quando uma nota entra, sai ou muda de nome. */
  private resolver: Resolver | null = null;
  private searchIndex: NoteSearchIndex | null = null;
  private searchDirty = true;
  /** Só para os testes: roda entre gravar o arquivo temporário e conferir a versão (uma edição de fora bem ali). */
  private beforeReplace?: () => void;
  /** O que foi apagado e ainda dá para desfazer, pelo caminho original (T2468). */
  private staged = new Map<string, Staged>();
  private readonly undoMs: number;
  private readonly now: () => number;
  /** O que já foi para o Lixo do macOS (T2593), do `.kiwi-trash/registry.json`. */
  private registry: RegistryEntry[] = [];
  /** Quantas notas os scans leram do disco (T5352): os testes e o bench conferem que o cache poupa a releitura. */
  scanReads = 0;
  /** Quantos trechos a busca montou (T8236): o teste confere que são só os dos resultados que voltam, sem cronômetro. */
  snippetsBuilt = 0;
  /** Quantas notas os refactors (renomear, mover, título) releram do disco (T7877): o bench mostra o que o filtro poupa. */
  refactorReads = 0;

  constructor(o: VaultOptions) {
    this.root = o.root;
    this.onIndexProgress = o.onIndexProgress;
    this.strictRoot = o.strictRoot ?? false;
    this.trash = o.trash ?? macTrash;
    this.debounceMs = o.debounceMs ?? 150;
    this.reconcileMs = o.reconcileMs ?? RECONCILE_MS;
    this.watchOnOpen = o.watch ?? false;
    this.undoMs = o.undoMs ?? UNDO_MS;
    this.now = o.now ?? Date.now;
  }

  /** Cria a pasta se não existe e monta o índice. Uma vez só. */
  open(): Promise<void> {
    this.ready ??= (async () => {
      await mkdir(this.root, { recursive: true });
      // O que sobrou de um "Desfazer" de antes (o app fechou sem esvaziar): sem a memória de onde estava, vai para a
      // Lixeira do macOS, como teria ido.
      await this.loadRegistry();
      await this.flushLeftoverUndo();
      await this.scan();
      if (this.watchOnOpen) this.watch();
    })();
    return this.ready;
  }

  /** Avisa quando notas mudam de lugar ou somem por fora do app (o Obsidian, o Finder), já reconhecidas (T2559). */
  onExternalMoves(fn: (r: ExternalMoves) => void): () => void {
    this.moveListeners.add(fn);
    return () => this.moveListeners.delete(fn);
  }

  /** O que existe agora no índice, para a limpeza das fixadas. */
  existing(): { notes: Set<string>; folders: Set<string> } {
    return { notes: new Set(this.notes.keys()), folders: new Set(this.folders) };
  }

  /** O inode de cada nota de agora (spec #9874): a nota principal de um projeto acha a pasta que mudou com o app fechado. */
  noteInodes(): Map<string, number> {
    return new Map([...this.notes].map(([p, e]) => [p, e.ino] as const));
  }

  /** Avisa quando notas mudam, inclusive fora do app. */
  /** Arquivos do vault que não são nota (um anexo trocado por fora, T2709): os caminhos, como o watcher viu. */
  onOtherFiles(fn: (paths: string[]) => void): () => void {
    this.otherListeners.add(fn);
    return () => this.otherListeners.delete(fn);
  }

  onChanged(fn: (paths: string[]) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Começa a olhar o disco (o Obsidian, o Finder, um git pull). */
  watch(): void {
    if (this.watcher) return;
    this.closed = false;
    this.watcher = watch(this.root, { recursive: true }, (_event, file) => {
      if (!file) return;
      const rel = String(file).split(path.sep).join("/").normalize("NFC");
      if (rel.split("/").some((s) => s.startsWith(".") || s === "node_modules")) return;
      this.pendingPaths.add(rel);
      this.flushTimer ??= setTimeout(() => void this.flush().catch((e) => console.error("[notes] watcher flush failed:", e)), this.debounceMs);
    });
    // O FSEvents perde a mudança feita logo depois de começar a olhar (T6412, issue 254: 37 de 90 com o Mac ocupado).
    // Uma conferida pouco depois relê só o que mudou de mtime ou tamanho (o cache do T5352) e avisa como o watcher.
    this.reconcileTimer = setTimeout(() => {
      this.reconcileTimer = null;
      void this.reconcile().catch((e) => console.error("[notes] watcher reconcile failed:", e));
    }, this.reconcileMs);
  }

  /** O que mudou no disco desde o índice de agora, sem esperar o watcher: relê com o cache e avisa os ouvintes. */
  async reconcile(): Promise<void> {
    if (this.closed) return;
    const before = this.snapshot();
    const files = new Map(this.files);
    await this.scan({ quiet: true });
    if (this.closed) return;
    const after = this.snapshot();
    const changed = [...after].filter(([p, v]) => before.get(p)?.version !== v.version).map(([p]) => p);
    for (const p of before.keys()) if (!after.has(p)) changed.push(p);
    const others = [...this.files].filter(([p, f]) => files.get(p)?.mtime !== f.mtime || files.get(p)?.size !== f.size).map(([p]) => p);
    for (const p of files.keys()) if (!this.files.has(p)) others.push(p);
    if (changed.length) this.emit(changed);
    if (others.length) {
      for (const fn of this.otherListeners) {
        try {
          fn(others);
        } catch (e) {
          console.error("[notes] file listener failed:", e);
        }
      }
    }
    const r = reconcileMoves(before, after);
    if (r.moves.size || r.gone.length) {
      for (const fn of this.moveListeners) {
        try {
          fn(r);
        } catch (e) {
          console.error("[notes] move listener failed:", e);
        }
      }
    }
  }

  close(): void {
    this.searchIndex?.close();
    this.searchIndex = null;
    this.searchDirty = true;
    this.closed = true;
    this.watcher?.close();
    this.watcher = null;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (this.reconcileTimer) clearTimeout(this.reconcileTimer);
    this.reconcileTimer = null;
    // O que esperava o "Desfazer" vai para a Lixeira agora; se o processo sair antes, o próximo `open` termina.
    void this.expireAll();
  }

  // ---------------------------------------------------------------- leitura

  /**
   * Só os nomes das pastas, em ordem (spec #12918): o que os seletores de pasta precisam, sem montar e mandar à tela as
   * notas, a árvore e os arquivos do cofre inteiro, como o `list()`.
   */
  /** O tamanho do cofre (spec #12918), só números: vai para o log ao indexar, sem nenhum nome. */
  counts(): { notes: number; folders: number; files: number } {
    return { notes: this.notes.size, folders: this.folders.size, files: this.files.size };
  }

  folderList(): string[] {
    return [...this.folders].sort((a, b) => a.localeCompare(b));
  }

  /**
   * As pastas, as notas, a árvore e os arquivos. Com `filesVersion` (spec #13384): igual à de agora, sem os arquivos
   * (quem pediu já tem a lista); um pouco atrás, só a diferença (`filesDelta`); senão, a lista inteira.
   */
  list(): { folders: string[]; notes: NoteMeta[]; tree: FolderNode; files: VaultFile[]; filesVersion?: string };
  list(opts: { filesVersion?: unknown }): VaultList;
  list(opts: { filesVersion?: unknown } = {}): VaultList {
    const folders = [...this.folders].sort((a, b) => a.localeCompare(b));
    const notes = [...this.notes.values()].map((e) => e.meta).sort((a, b) => a.path.localeCompare(b.path));
    const filesVersion = this.filesVersion();
    const tree = buildTree(folders, notes);
    if (opts.filesVersion === filesVersion) return { folders, notes, tree, filesVersion };
    const filesDelta = this.filesDeltaSince(opts.filesVersion);
    if (filesDelta) return { folders, notes, tree, filesDelta, filesVersion };
    this.sortedFiles ??= [...this.files.values()].sort((a, b) => a.path.localeCompare(b.path));
    return { folders, notes, tree, files: this.sortedFiles, filesVersion };
  }

  /**
   * Só o que mudou desde `version` (spec #13384): os arquivos que entraram ou mudaram, e os que saíram. `null` quando a
   * versão é de outro cofre, mais velha que o registro, ou a diferença é grande (aí vai a lista inteira).
   */
  private filesDeltaSince(version: unknown): { set: VaultFile[]; removed: string[] } | null {
    if (typeof version !== "string") return null;
    const [id, n] = version.split(".");
    const rev = Number(n);
    if (id !== this.filesId || !Number.isInteger(rev) || rev < this.filesLogFrom || rev > this.filesRev) return null;
    const touched = new Set<string>();
    for (let i = this.filesLog.length - 1; i >= 0 && this.filesLog[i]!.rev > rev; i--) touched.add(this.filesLog[i]!.path);
    if (touched.size > FILES_DELTA_MAX) return null;
    const set: VaultFile[] = [];
    const removed: string[] = [];
    for (const p of touched) {
      const f = this.files.get(p);
      if (f) set.push(f);
      else removed.push(p);
    }
    return { set, removed };
  }

  /** A versão de agora dos arquivos que não são nota (ver `filesRev`). */
  filesVersion(): string {
    return `${this.filesId}.${this.filesRev}`;
  }

  /** Um arquivo que não é nota entrou, saiu ou mudou: a lista em ordem e o resolvedor se refazem quando pedidos. */
  private filesChanged(paths: Iterable<string> | null) {
    this.filesRev++;
    this.sortedFiles = null;
    this.fileResolver = null;
    // Sem os caminhos (muita coisa de uma vez), o registro recomeça: quem estava atrás recebe a lista inteira.
    if (paths) for (const path of paths) this.filesLog.push({ rev: this.filesRev, path });
    if (!paths || this.filesLog.length > FILES_LOG_MAX) {
      this.filesLog = [];
      this.filesLogFrom = this.filesRev;
    }
  }

  private resolveFile(target: string): string | null {
    this.fileResolver ??= makeFileResolver([...this.files.keys()]);
    return this.fileResolver(target);
  }

  /**
   * O caminho absoluto de um arquivo que não é nota, para abrir no app padrão do Mac (T3370), e o `mode` dele: com o bit
   * de execução, o `files.open` só mostra no Finder (revisão #3458).
   */
  async locateFile(input: unknown): Promise<{ abs: string; mode: number }> {
    const p = filePath(input);
    const abs = inside(this.root, p);
    const s = await lstat(abs).catch(() => null);
    // Um pacote (`.pages`, `.numbers`, `.key`) é uma pasta: o bit "x" dela é o de entrar, não o de executar.
    if (s?.isDirectory() && this.packages.has(p)) return { abs, mode: 0 };
    if (!s?.isFile()) throw new VaultError("E_NOT_FOUND", `no file ${p}`);
    return { abs, mode: s.mode };
  }

  /**
   * Lê um arquivo do cofre que não é nota (spec #7079), como texto (UTF-8) ou em binário (base64). Só arquivo de
   * verdade: um link simbólico, uma pasta, um pacote (`.pages`, `.key`) ou o que está dentro de um pacote dão
   * E_NOT_FOUND, e nada sai do cofre (`inside`). O tamanho é conferido antes de ler; acima do limite, volta `tooLarge`
   * sem o conteúdo. Um texto que não é UTF-8 volta com `readOnly`: ele aparece, mas não é gravado por cima.
   */
  async readFile(input: unknown, as: unknown = "binary"): Promise<FileContent> {
    if (as !== "text" && as !== "binary") throw new VaultError("E_BAD_ARGS", "as must be text or binary");
    const p = filePath(input);
    const abs = inside(this.root, p);
    const s = await lstat(abs).catch(() => null);
    // O que está dentro de um pacote é do app dono dele (revisão do T7103).
    if (!s?.isFile() || this.packageOf(p)) throw new VaultError("E_NOT_FOUND", `no file ${p}`);
    const limit = viewLimit(as);
    if (s.size > limit) return { path: p, size: s.size, tooLarge: true, limit };
    let bytes: Buffer;
    try {
      bytes = await readFile(abs);
    } catch {
      throw new VaultError("E_NOT_FOUND", `no file ${p}`);
    }
    // O arquivo cresceu entre o `lstat` e a leitura.
    if (bytes.length > limit) return { path: p, size: bytes.length, tooLarge: true, limit };
    const version = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    if (as === "binary") return { path: p, size: bytes.length, version, base64: bytes.toString("base64") };
    const text = bytes.toString("utf8");
    const utf8 = Buffer.from(text, "utf8").equals(bytes);
    return { path: p, size: bytes.length, version, text, ...(utf8 ? {} : { readOnly: true as const }) };
  }

  /**
   * Grava um texto do cofre que as Notas abrem editável (T7105): só `.txt`, `.log`, `.json`, `.yaml` e `.yml`, só num
   * arquivo que já existe, e só se ninguém o mudou desde `baseVersion` (senão devolve o de agora, sem escrever). A
   * escrita é a troca atômica das notas. Um arquivo que não é UTF-8 nunca casa com a versão: não é gravado por cima.
   */
  async saveFile(input: unknown, content: unknown, baseVersion: unknown): Promise<FileSaveResult> {
    const p = filePath(input);
    if (!isEditableText(p)) throw new VaultError("E_BAD_ARGS", "only txt, log, json, yaml and yml files are saved");
    if (typeof content !== "string") throw new VaultError("E_BAD_ARGS", "content must be a string");
    const size = Buffer.byteLength(content, "utf8");
    if (size > MAX_VIEW_TEXT_BYTES) throw new VaultError("E_BAD_ARGS", "content is larger than 5 MB");
    if (typeof baseVersion !== "string") throw new VaultError("E_BAD_ARGS", "baseVersion must be a string");
    const current = await this.readFile(p, "text");
    if ("tooLarge" in current || !("text" in current) || current.readOnly) throw new VaultError("E_BAD_ARGS", `${p} can't be saved as text`);
    if (current.version !== baseVersion) return { saved: false, current };
    if (!(await this.replaceChecked(p, content, baseVersion))) return { saved: false, current: await this.readFile(p, "text") };
    await this.fileWritten(p);
    return { saved: true, path: p, size, version: versionOf(content) };
  }

  /**
   * Um arquivo novo que o agente gerou (spec #11549): só txt, csv, xlsx, docx e pdf, nunca por cima de outro (com o nome
   * já usado na pasta, ele ganha um número, "Vendas 2.xlsx"). A versão é a mesma do `readFile` (o hash dos bytes).
   */
  async createFile(folder: unknown, name: unknown, bytes: unknown): Promise<{ path: string; size: number; version: string }> {
    const dir = folderPath(folder ?? "");
    if (!(bytes instanceof Uint8Array)) throw new VaultError("E_BAD_ARGS", "bytes must be binary data");
    if (bytes.length > MAX_VIEW_BYTES) throw new VaultError("E_BAD_ARGS", "the file is larger than 25 MB");
    if (typeof name !== "string") throw new VaultError("E_BAD_ARGS", "name must be a string");
    const m = /^(.*?)\.(txt|csv|xlsx|docx|pdf)$/i.exec(name.trim());
    if (!m) throw new VaultError("E_BAD_ARGS", "name must end in .txt, .csv, .xlsx, .docx or .pdf");
    const base = fileNameFor(m[1]);
    const ext = m[2]!.toLowerCase();
    for (let n = 1; n < 1000; n++) {
      const p = filePath(`${dir ? `${dir}/` : ""}${n === 1 ? base : `${base} ${n}`}.${ext}`);
      const abs = inside(this.root, p);
      if (await exists(abs)) continue;
      await mkdir(path.dirname(abs), { recursive: true });
      // `wx`: só se o arquivo ainda não existe (outro pode ter chegado entre a conferência e a escrita).
      const wrote = await writeFile(abs, bytes, { flag: "wx" }).then(
        () => true,
        (e: { code?: string }) => {
          if (e?.code === "EEXIST") return false;
          throw e;
        },
      );
      if (!wrote) continue;
      await this.fileWritten(p);
      return { path: p, size: bytes.length, version: createHash("sha256").update(bytes).digest("hex").slice(0, 16) };
    }
    throw new VaultError("E_EXISTS", `too many files called ${base}.${ext}`);
  }

  /**
   * Manda para a Lixeira um arquivo que não é nota, se ele ainda está em `baseVersion` (o desfazer de um arquivo que o
   * agente gerou, spec #11549): os 10 minutos no Desfazer do app, depois a Lixeira do macOS, como uma nota.
   */
  async deleteFile(input: unknown, baseVersion: unknown): Promise<true> {
    const p = filePath(input);
    if (typeof baseVersion !== "string") throw new VaultError("E_BAD_ARGS", "baseVersion must be a string");
    const abs = inside(this.root, p);
    const s = await lstat(abs).catch(() => null);
    if (!s?.isFile() || this.packageOf(p)) throw new VaultError("E_NOT_FOUND", `no file ${p}`);
    // O tipo "note" da Lixeira do app é o de um arquivo só: a volta é pelo caminho, como a de uma nota.
    await this.stage(p, abs, "note", baseVersion);
    if (this.files.delete(p)) this.filesChanged([p]);
    this.touch(p);
    await this.fileWritten(p);
    return true;
  }

  async get(input: unknown): Promise<Note> {
    const p = notePath(input);
    const abs = inside(this.root, p);
    let bytes: Buffer;
    try {
      bytes = await readFile(abs);
    } catch {
      throw new VaultError("E_NOT_FOUND", `no note ${p}`);
    }
    const content = bytes.toString("utf8");
    const entry = await this.index(p, content, abs);
    return { ...entry.meta, content, ...(isUtf8(bytes) ? {} : { readOnly: true as const }) };
  }

  /**
   * O que um `![[nota]]`, `![[nota#Título]]` ou `![[nota#^id]]` mostra (T6594, E15): a nota que o link acha e o pedaço
   * dela, já cortado. `missing` quando a nota existe mas o título ou o bloco não; `null` quando nem a nota existe.
   */
  embed(link: unknown): { path: string; title: string; kind: EmbedKind; content: string } | { path: string; title: string; missing: string } | null {
    if (typeof link !== "string" || link.length > 1024) throw new VaultError("E_BAD_ARGS", "link must be a string");
    const parsed = parseEmbed(link);
    if (!parsed || !parsed.target) return null;
    const p = this.resolve_()(parsed.target);
    const e = p ? this.notes.get(p) : undefined;
    if (!p || !e) return null;
    const cut = embedContent(e.content, parsed.fragment);
    if (!cut) return { path: p, title: e.meta.title, missing: parsed.fragment };
    return { path: p, title: e.meta.title, ...cut };
  }

  resolve(link: unknown): string | null {
    if (typeof link !== "string" || link.length > 1024) throw new VaultError("E_BAD_ARGS", "link must be a string");
    return this.resolve_()(link.replace(/^!?\[\[|\]\]$/g, "").split(/[|#]/)[0]!);
  }

  /** As notas para o índice da busca pelo sentido (T6013): o texto fica na memória, o índice guarda só os vetores. */
  semanticDocuments(): SemanticDocument[] {
    return [...this.notes.values()].map((e) => ({ path: e.meta.path, title: e.meta.title, version: e.meta.version, content: e.content }));
  }

  /**
   * `semantic` (T6013): as notas mais perto da busca pelo sentido, do `SemanticIndex`. Sem ele, a busca é a de antes.
   * Com ele, o exato continua antes e é reordenado pelo RRF do BM25 com o sentido; as notas achadas só pelo sentido vêm
   * depois do exato e antes do aproximado, sempre com os filtros valendo.
   */
  search(query: unknown, limit: unknown = 20, semantic?: readonly SemanticHit[]): SearchHit[] {
    if (typeof query !== "string") throw new VaultError("E_BAD_ARGS", "query must be a string");
    // T7791: o motivo vai na mensagem, para quem colou um texto longo saber que a busca tem limite.
    if (searchTooLong(query)) throw new VaultError("E_BAD_ARGS", `query is longer than ${MAX_SEARCH_QUERY} characters`);
    const max = limit === undefined ? 20 : limit;
    if (typeof max !== "number" || !Number.isInteger(max) || max < 1 || max > 100_000) {
      throw new VaultError("E_BAD_ARGS", "limit must be an integer from 1 to 100000");
    }
    // Os filtros (T2660, src/shared/query.ts): palavras, "frases", tag:, path: e as exclusões com "-".
    const q = parseQuery(query);
    if (!hasPositive(q)) return [];
    const accepts = (e: Entry) => {
      if (!q.tags.every(t => hasTag(e.meta.tags, t)) || q.notTags.some(t => hasTag(e.meta.tags, t))) return false;
      const foldedPath = fold(e.meta.path);
      if (!q.paths.every(p => foldedPath.includes(p)) || q.notPaths.some(p => foldedPath.includes(p))) return false;
      if (q.notText.some(t => e.foldedTitle.includes(t) || inText(e, t))) return false;
      return q.phrases.every(t => e.foldedTitle.includes(t) || inText(e, t));
    };
    const hits: { e: Entry; score: number; approx: boolean; near?: string }[] = [];
    const rawWords = parseQuery(query, { preserveWords: true }).words;
    const terms = [...q.words, ...q.phrases];
    if (!terms.length) {
      for (const e of this.notes.values()) if (accepts(e)) hits.push({e, score: Date.parse(e.meta.mtime) / 1e12, approx: false});
    } else {
      this.searchIndex ??= new NoteSearchIndex();
      if (this.searchDirty) { this.searchIndex.sync(this.notes.values()); this.searchDirty = false; }
      const ranks = new Map(this.searchIndex.search(rawWords, q.phrases).map(hit => [hit.path, hit.score]));
      const lexicalByWord = new Map(q.words.map((word, i) => [word, /^[\p{L}\p{N}]+$/u.test(word)
        ? new Set(this.searchIndex!.search([rawWords[i]!], []).map(hit => hit.path))
        : new Set<string>()]));
      for (const e of this.notes.values()) {
        if (!accepts(e)) continue;
        if (q.words.every(word => e.foldedTitle.includes(word) || inText(e, word) || lexicalByWord.get(word)?.has(e.meta.path))) {
          hits.push({ e, score: ranks.get(e.meta.path) ?? 0, approx: false });
        }
      }
      if (!hits.length && q.words.length) {
        const memos = new Map<string, Map<string, boolean>>();
        for (const e of this.notes.values()) {
          if (!accepts(e)) continue;
          let score = 0;
          let all = true;
          let approx = false;
          let near: string | undefined;
          for (const t of terms) {
            const inTitle = e.foldedTitle.includes(t);
            const inBody = inText(e, t);
            if (inTitle || inBody || lexicalByWord.get(t)?.has(e.meta.path)) {
              score += (inTitle ? 10 : 0) + (inBody ? 1 : 0) + (e.foldedTitle === t ? 20 : 0);
              continue;
            }
            // Sem o exato, a palavra solta (não a "frase") aceita erro de digitação (T2966, spec #2934).
            if (q.words.includes(t) && /^[\p{L}\p{N}]+$/u.test(t) && typoBudget(t)) {
              let memo = memos.get(t);
              if (!memo) memos.set(t, (memo = new Map()));
              const w = approxWord(t, wordsOfEntry(e), memo);
              if (w) {
                approx = true;
                near ??= t === terms[0] ? w : undefined;
                score += wordsOf(e.foldedTitle).includes(w) ? 5 : 0.5;
                continue;
              }
            }
            all = false;
            break;
          }
          if (!all) continue;
          hits.push({ e, score, approx, near });
        }
      }
    }
    // O trecho só para os que voltam: montar para cada nota que casa custava mais que a busca (288 ms com 1.000 notas).
    // O exato antes do aproximado; o trecho do aproximado mostra a palavra que casou.
    const first = q.phrases[0] ?? q.words[0] ?? (q.tags[0] ? `#${fold(q.tags[0])}` : "");
    const sorted = hits.sort((a, b) => Number(a.approx) - Number(b.approx) || b.score - a.score || a.e.meta.path.localeCompare(b.e.meta.path));
    const lexicalSnippet = (e: Entry, near?: string) => {
      this.snippetsBuilt++;
      return snippetAround(e.content, near ?? (q.phrases[0] || lexicalWords(e.content).find(w => lexicalMatch(w, rawWords)) || first));
    };
    if (semantic?.length && terms.length) return this.fuse(sorted, semantic, accepts, max, lexicalSnippet);
    return sorted
      .slice(0, max)
      .map(({ e, score, approx, near }) => ({
        path: e.meta.path,
        title: e.meta.title,
        snippet: lexicalSnippet(e, near),
        score,
        ...(approx ? { approx: true } : {}),
      }));
  }

  /** O BM25 somado ao sentido (T6013), pelo RRF. O exato fica na frente; o achado só pelo sentido, entre ele e o aproximado. */
  private fuse(
    sorted: { e: Entry; score: number; approx: boolean; near?: string }[],
    semantic: readonly SemanticHit[],
    accepts: (e: Entry) => boolean,
    max: number,
    lexicalSnippet: (e: Entry, near?: string) => string,
  ): SearchHit[] {
    const ranked = semantic.filter((h) => Number.isFinite(h.score));
    const near = ranked.filter((h) => h.near);
    const semanticRank = new Map<string, number>();
    ranked.forEach((h, i) => {
      if (!semanticRank.has(h.path)) semanticRank.set(h.path, i);
    });
    const rrf = (lexical: number | null, path: string) =>
      (lexical === null ? 0 : 1 / (RRF_K + lexical + 1)) + (semanticRank.has(path) ? 1 / (RRF_K + semanticRank.get(path)! + 1) : 0);
    const exact = sorted.filter((h) => !h.approx);
    const approx = sorted.filter((h) => h.approx);
    const found = new Set(sorted.map((h) => h.e.meta.path));
    const exactOut: SearchHit[] = exact
      .map(({ e, near: n }, i) => ({ path: e.meta.path, title: e.meta.title, snippet: lexicalSnippet(e, n), score: rrf(i, e.meta.path) }))
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    const semanticOut: SearchHit[] = [];
    for (const h of near) {
      if (semanticOut.length >= SEMANTIC_LIMIT) break;
      const e = this.notes.get(h.path);
      if (!e || found.has(h.path) || !accepts(e)) continue;
      found.add(h.path);
      semanticOut.push({ path: e.meta.path, title: e.meta.title, snippet: semanticSnippet(e.meta.title, e.content, h.chunk), score: rrf(null, h.path), semantic: true });
    }
    const approxOut: SearchHit[] = approx.map(({ e, score, near: n }) => ({ path: e.meta.path, title: e.meta.title, snippet: lexicalSnippet(e, n), score, approx: true }));
    return [...exactOut, ...semanticOut, ...approxOut].slice(0, max);
  }

  /** A árvore das tags do vault, com quantas notas cada uma tem (T2619). */
  tags(): TagNode[] {
    return tagTree([...this.notes.values()].map((e) => e.meta.tags));
  }

  /** As notas de uma pasta de modelos (T2619), por nome; a pasta pode não existir. */
  templates(folder: unknown): NoteMeta[] {
    const dir = folderPath(folder ?? "");
    if (!dir) throw new VaultError("E_BAD_ARGS", "the templates folder can't be the vault root");
    return [...this.notes.values()]
      .filter((e) => e.meta.folder === dir)
      .map((e) => e.meta)
      .sort((a, b) => a.title.localeCompare(b.title, "pt-BR"));
  }

  /**
   * As notas cujo texto, pelo índice em memória, tem `text` exato (T1320, T1565: achar um ditado já mandado). O índice
   * pode estar atrasado com o que o watcher ainda não viu: quem decide relê a nota do disco.
   */
  notesContaining(text: string): NoteMeta[] {
    if (!text) return [];
    return [...this.notes.values()].filter((e) => e.content.includes(text)).map((e) => e.meta);
  }

  backlinks(input: unknown): Backlink[] {
    const p = notePath(input);
    const resolve = this.resolve_();
    const out: Backlink[] = [];
    for (const e of this.notes.values()) {
      if (e.meta.path === p || !e.links.some((t) => resolve(t) === p)) continue;
      const link = parseLinks(e.content).find((l) => resolve(l.target) === p);
      if (!link) continue;
      const line = e.content.slice(e.content.lastIndexOf("\n", link.index) + 1, (e.content.indexOf("\n", link.index) + 1 || e.content.length + 1) - 1);
      out.push({ path: e.meta.path, title: e.meta.title, context: line.trim().slice(0, 200) });
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  // ---------------------------------------------------------------- escrita

  /** Salva se ninguém mudou a nota desde `baseVersion`; senão devolve a versão de agora, sem escrever. */
  async save(input: unknown, content: unknown, baseVersion: unknown): Promise<SaveResult> {
    const p = notePath(input);
    if (typeof content !== "string") throw new VaultError("E_BAD_ARGS", "content must be a string");
    if (content.length > 5_000_000) throw new VaultError("E_BAD_ARGS", "content is larger than 5 MB");
    if (typeof baseVersion !== "string") throw new VaultError("E_BAD_ARGS", "baseVersion must be a string");
    const current = await this.get(p);
    if (current.version !== baseVersion) return { saved: false, current };
    // A escrita confere a versão de novo, logo antes de trocar o arquivo: uma edição de fora no meio não se perde.
    const entry = await this.write(p, content, baseVersion);
    if (!entry) return { saved: false, current: await this.get(p) };
    return { saved: true, meta: entry.meta };
  }

  // ---------------------------------------------------------------- os quadros (T6600)
  // O `.canvas` não entra no índice das notas: é um arquivo do vault (`files`) que o Kiwi abre, com a mesma escrita
  // atômica e condicional das notas. O texto só é aceito se for um JSON Canvas que abre: nada grava um quadro quebrado.

  async getCanvas(input: unknown): Promise<CanvasFile> {
    const p = canvasPath(input);
    let content: string;
    try {
      content = await readFile(inside(this.root, p), "utf8");
    } catch {
      throw new VaultError("E_NOT_FOUND", `no board ${p}`);
    }
    if (content.length > 5_000_000) throw new VaultError("E_BAD_ARGS", "the board is larger than 5 MB");
    return { path: p, content, version: versionOf(content) };
  }

  /** Salva se ninguém mudou o quadro desde `baseVersion`; senão devolve o de agora, sem escrever. */
  async saveCanvas(input: unknown, content: unknown, baseVersion: unknown): Promise<CanvasSaveResult> {
    const p = canvasPath(input);
    const text = canvasText(content);
    if (typeof baseVersion !== "string") throw new VaultError("E_BAD_ARGS", "baseVersion must be a string");
    const current = await this.getCanvas(p);
    if (current.version !== baseVersion) return { saved: false, current };
    if (!(await this.replaceChecked(p, text, baseVersion))) return { saved: false, current: await this.getCanvas(p) };
    await this.fileWritten(p);
    return { saved: true, path: p, version: versionOf(text) };
  }

  /** Cria o quadro na pasta, com o nome livre seguinte ("Quadro 2" se "Quadro" já existe). Vazio, ou com `content`. */
  async createCanvas(folder: unknown, title: unknown, content: unknown = EMPTY_CANVAS): Promise<CanvasFile> {
    const dir = folderPath(folder ?? "");
    const text = canvasText(content);
    const name = fileNameFor(title);
    for (let n = 1; n < 1000; n++) {
      const p = canvasPath(`${dir ? `${dir}/` : ""}${n === 1 ? name : `${name} ${n}`}.canvas`);
      const abs = inside(this.root, p);
      if (this.files.has(p) || (await exists(abs))) continue;
      await mkdir(path.dirname(abs), { recursive: true });
      if (!(await this.replaceChecked(p, text, null))) continue;
      await this.fileWritten(p);
      return { path: p, content: text, version: versionOf(text) };
    }
    throw new VaultError("E_EXISTS", `too many boards called ${name}`);
  }

  /** Renomeia ou move o quadro; não troca um arquivo que já existe no destino. */
  async renameCanvas(from: unknown, to: unknown): Promise<CanvasFile> {
    const a = canvasPath(from);
    const b = canvasPath(to);
    const absA = inside(this.root, a);
    const absB = inside(this.root, b);
    if (!(await exists(absA))) throw new VaultError("E_NOT_FOUND", `no board ${a}`);
    // Só a caixa mudou ("quadro" → "Quadro"): no APFS é o mesmo arquivo, e o rename troca o nome.
    if (a !== b && a.toLowerCase() !== b.toLowerCase() && (await exists(absB))) throw new VaultError("E_EXISTS", `${b} already exists`);
    await mkdir(path.dirname(absB), { recursive: true });
    await rename(absA, absB);
    await syncDir(path.dirname(absB));
    if (this.files.delete(a)) this.filesChanged([a]);
    await this.fileWritten(b, [a]);
    return this.getCanvas(b);
  }

  /** O arquivo que o próprio Kiwi escreveu entra na lista na hora, e a árvore fica sabendo (o watcher repete depois). */
  private async fileWritten(p: string, alsoGone: string[] = []) {
    const s = await stat(inside(this.root, p)).catch(() => null);
    if (s?.isFile()) this.keepFile(p, s);
    for (const fn of this.otherListeners) {
      try {
        fn([...alsoGone, p]);
      } catch (e) {
        console.error("[notes] file listener failed:", e);
      }
    }
  }

  /**
   * Cria a nota. Com `template` (o path de uma nota modelo, T2619), o conteúdo é o do modelo com `{{title}}`, `{{date}}`
   * e `{{time}}` trocados; o título trocado é o nome final ("Ata 2" se "Ata" já existe).
   */
  async create(folder: unknown, title: unknown, content: unknown = "", template?: unknown, now: Date = new Date(this.now())): Promise<Note> {
    const dir = folderPath(folder ?? "");
    if (typeof content !== "string" || content.length > 5_000_000) throw new VaultError("E_BAD_ARGS", "content must be a string up to 5 MB");
    const model = template === undefined ? null : await this.get(template);
    if (model && content) throw new VaultError("E_BAD_ARGS", "give content or template, not both");
    const name = fileNameFor(title);
    for (let n = 1; n < 1000; n++) {
      const p = notePath(`${dir ? `${dir}/` : ""}${n === 1 ? name : `${name} ${n}`}.md`);
      if (this.notes.has(p) || (await exists(inside(this.root, p)))) continue;
      await mkdir(path.dirname(inside(this.root, p)), { recursive: true });
      const text = model ? fillTemplate(model.content, { title: noteName(p), now }) : content;
      const entry = await this.write(p, text, null); // null: só se o arquivo ainda não existe
      if (!entry) continue;
      return { ...entry.meta, content: text };
    }
    throw new VaultError("E_EXISTS", `too many notes called ${name}`);
  }

  /** Renomeia ou move, e atualiza os [[links]] das outras notas que apontavam para ela. */
  async rename(input: unknown, target: unknown): Promise<{ meta: NoteMeta; updatedLinks: number; skippedPaths: string[] }> {
    const from = notePath(input);
    const to = linkSafeTarget(from, notePath(target));
    const fromAbs = inside(this.root, from);
    const toAbs = inside(this.root, to);
    if (!(await exists(fromAbs))) throw new VaultError("E_NOT_FOUND", `no note ${from}`);
    // O índice pode estar atrás do disco (o debounce do watcher, um evento perdido, uma nota criada fora): o rename
    // reescreve outras notas, então parte do disco, nunca do que está na memória (revisão #1397).
    await this.scan();
    // Num disco sem diferença de maiúscula, "nota.md" → "Nota.md" é a mesma nota: vale.
    if (from.toLowerCase() !== to.toLowerCase() && (await exists(toAbs))) throw new VaultError("E_EXISTS", `${to} already exists`);
    const before = [...this.notes.keys()];
    if (!before.includes(from)) before.push(from);
    const after = before.map((p) => (p === from ? to : p));
    await mkdir(path.dirname(toAbs), { recursive: true });
    await rename(fromAbs, toAbs);
    const moved = this.notes.get(from);
    this.notes.delete(from);
    this.touch(from);
    this.searchDirty = true;
    this.resolver = null;
    const content = moved?.content ?? (await readFile(toAbs, "utf8"));
    const entry = await this.index(to, content, toAbs);

    let updatedLinks = 0;
    const skippedPaths: string[] = [];
    // Com os apelidos (T5352): os da nota vão com ela para o caminho novo.
    const aliasesBefore = this.aliasMap();
    aliasesBefore.delete(to);
    if (moved?.aliases.length) aliasesBefore.set(from, moved.aliases);
    const aliasesAfter = new Map([...aliasesBefore].map(([p, a]) => [p === from ? to : p, a] as const));
    const resolveBefore = makeResolver(before, aliasesBefore);
    const resolveAfter = makeResolver(after, aliasesAfter);
    // Só lê do disco quem pode citar a nota (T7877): ler o cofre inteiro custava segundos com 10 mil notas. O [[link]]
    // se confere pelo índice; o [texto](caminho.md), pelo nome do arquivo no texto (decodificado, sem maiúscula).
    const fromKey = noteName(from).normalize("NFC").toLowerCase();
    const mayCite = (e: Entry) =>
      e.meta.path === to ||
      e.links.some((t) => resolveBefore(t) === from) ||
      ((e.content.includes("](") || e.content.includes("]:")) && looseDecode(e.content).normalize("NFC").toLowerCase().includes(fromKey));
    const rewriteOne = async (p: string) => {
      const result = await this.refactorNote(p, (disk) => rewriteNoteReferences(disk, p === to ? from : p, p, from, to, resolveBefore, resolveAfter));
      if (result.skipped) skippedPaths.push(p);
      updatedLinks += result.count;
    };
    const discarded: Entry[] = [];
    for (const e of [...this.notes.values()]) {
      if (mayCite(e)) await rewriteOne(e.meta.path);
      else discarded.push(e);
    }
    // O filtro olha o índice do scan(): uma nota escrita por fora depois dele pode ter ganhado um link (revisão do T7877,
    // #7980). As descartadas que mudaram no disco desde então são relidas e conferidas como as outras. O stat vai pelo
    // caminho direto (o `inside` faz um lstat por pasta, e eram 20 mil a mais); a releitura passa pelo `inside` como sempre.
    const changed = await Promise.all(discarded.map((e) =>
      stat(path.join(this.root, e.meta.path)).then((st) => st.mtimeMs !== e.mtimeMs || st.size !== e.meta.size, () => false)));
    for (const [i, e] of discarded.entries()) if (changed[i]) await rewriteOne(e.meta.path);
    this.emit([from, to]);
    return { meta: (this.notes.get(to) ?? entry).meta, updatedLinks, skippedPaths };
  }

  /** E11: rewrite current disk text with the same CAS/retry guard as save. Never replace a concurrent edit. */
  private async refactorNote(p: string, rewrite: (content: string) => { content: string; count: number; unsupported?: boolean }) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const disk = await readFile(inside(this.root, p), "utf8").catch(() => null);
      this.refactorReads++;
      if (disk === null) return { count: 0, skipped: true };
      const next = rewrite(disk);
      if (next.content === disk) return { count: 0, skipped: !!next.unsupported };
      try {
        if (await this.write(p, next.content, versionOf(disk))) return { count: next.count, skipped: !!next.unsupported };
      } catch (error) {
        if (["ENOENT", "EACCES", "EPERM", "EROFS", "ENOSPC", "E_NOT_UTF8"].includes((error as NodeJS.ErrnoException).code ?? "")) return { count: 0, skipped: true };
        throw error;
      }
    }
    return { count: 0, skipped: true };
  }

  async renameHeading(input: unknown, offset: unknown, title: unknown, baseVersion: unknown): Promise<RefactorResult> {
    const p = notePath(input);
    if (!Number.isInteger(offset) || (offset as number) < 0 || typeof title !== "string" || !title.trim() || title.length > 200 || /[\r\n\x00-\x1f\[\]#|]/.test(title) || typeof baseVersion !== "string")
      throw new VaultError("E_BAD_ARGS", "a heading needs an offset, a single-line title and baseVersion");
    const wanted = title.trim();
    await this.scan();
    const source = await this.get(p);
    if (source.version !== baseVersion) throw new VaultError("E_CONFLICT", "the note changed; reopen the rename");
    const headings = markdownStructure(source.content).headings;
    const selected = headings.find(h => h.from <= (offset as number) && (offset as number) <= h.to);
    if (!selected) throw new VaultError("E_BAD_ARGS", "no heading at offset");
    const replacement = markdownStructure("# " + wanted).headings[0];
    if (!replacement || !replacement.title || replacement.title !== wanted)
      throw new VaultError("E_BAD_ARGS", "use a plain heading title");
    if (headings.some(h => h !== selected && (headingKey(h.title) === headingKey(wanted) || h.slug === replacement.slug)))
      throw new VaultError("E_EXISTS", "another heading already has this title");
    if (source.content.slice(selected.textFrom, selected.textTo) === wanted) return { updatedNotes: 0, updatedReferences: 0, skippedPaths: [], warnings: await this.linkWarnings(p) };
    const resolve = makeResolver([...this.notes.keys()], this.aliasMap());
    const self = rewriteHeadingReferences(source.content, p, p, selected, headings, wanted, resolve);
    // Rename the source heading first, then parse fresh reference ranges against the original heading identity.
    const renamed = applyTextEdits(source.content, [{ from: selected.textFrom, to: selected.textTo, insert: wanted }]);
    const selfAfter = rewriteHeadingReferences(renamed, p, p, selected, headings, wanted, resolve);
    if (!await this.write(p, selfAfter.content, baseVersion)) throw new VaultError("E_CONFLICT", "the note changed; reopen the rename");
    const result: RefactorResult = { updatedNotes: 1, updatedReferences: self.count, skippedPaths: [], warnings: [] };
    for (const path of [...this.notes.keys()]) {
      if (path === p) continue;
      const r = await this.refactorNote(path, disk => rewriteHeadingReferences(disk, path, p, selected, headings, wanted, resolve));
      if (r.count) result.updatedNotes++;
      result.updatedReferences += r.count;
      if (r.skipped) result.skippedPaths.push(path);
    }
    result.warnings = await this.linkWarnings(p);
    return result;
  }

  async renameTag(from: unknown, to: unknown): Promise<RefactorResult> {
    if (!validTag(from) || !validTag(to)) throw new VaultError("E_BAD_ARGS", "invalid tag");
    const old = cleanTag(from)!, wanted = cleanTag(to)!;
    await this.scan();
    const entries = [...this.notes.values()];
    if (!entries.some(e => hasTag(e.meta.tags, old))) throw new VaultError("E_NOT_FOUND", "no such tag");
    if (tagKey(old) !== tagKey(wanted) && entries.some(e => e.meta.tags.some(t => !hasTag([t], old) && hasTag([t], wanted))))
      throw new VaultError("E_EXISTS", "the destination tag already exists");
    const result: RefactorResult = { updatedNotes: 0, updatedReferences: 0, skippedPaths: [], warnings: [] };
    for (const e of entries) {
      const r = await this.refactorNote(e.meta.path, disk => rewriteTag(disk, old, wanted));
      if (r.count) result.updatedNotes++;
      result.updatedReferences += r.count;
      if (r.skipped) result.skippedPaths.push(e.meta.path);
    }
    return result;
  }

  /** At most 100 source locations. Missing fragments are distinct from missing notes; code is never a link. */
  async linkWarnings(input: unknown): Promise<LinkWarning[]> {
    const p = notePath(input), source = await this.get(p), resolve = makeResolver([...this.notes.keys()], this.aliasMap());
    const file = (t: string) => this.resolveFile(t);
    const warnings: LinkWarning[] = [];
    for (const ref of noteReferences(source.content)) {
      const target = referenceTarget(ref, p, resolve);
      let reason: LinkWarning["reason"] | undefined;
      // Um `[[relatorio.pdf]]` que acha um arquivo do vault não está quebrado (T7616).
      if (!target && !file(ref.target)) reason = "note";
      else if (target && ref.fragment && !ref.fragment.startsWith("^") && !headingFor(markdownStructure(target === p ? source.content : this.notes.get(target)?.content ?? "").headings, ref.fragment)) reason = "heading";
      if (reason) warnings.push({ path: p, target: ref.target + (ref.fragment ? "#" + ref.fragment : ""), reason, line: source.content.slice(0, ref.from).split("\n").length });
      if (warnings.length === 100) break;
    }
    return warnings;
  }

  /**
   * Apaga a nota: ela espera 10 min em `.kiwi-trash` (o "Desfazer", `restore`) e então vai para a Lixeira do macOS. Não
   * vai direto para a Lixeira porque tirar de lá pede o Acesso Total ao Disco (o ~/.Trash é protegido pelo TCC).
   *
   * Com `baseVersion` (o desfazer do agente, spec #9353), só apaga se a nota ainda está naquela versão, relida logo
   * antes de sair do lugar, como o `save`; senão `E_CONFLICT`, e nada muda.
   */
  async delete(input: unknown, baseVersion?: unknown): Promise<true> {
    const p = notePath(input);
    if (baseVersion !== undefined && typeof baseVersion !== "string") throw new VaultError("E_BAD_ARGS", "baseVersion must be a string");
    const abs = inside(this.root, p);
    if (!(await exists(abs))) throw new VaultError("E_NOT_FOUND", `no note ${p}`);
    await this.stage(p, abs, "note", baseVersion);
    this.notes.delete(p);
    this.touch(p);
    this.searchDirty = true;
    this.resolver = null;
    this.emit([p]);
    return true;
  }

  /** Move a nota para outra pasta ("" é a raiz), com o mesmo nome; os [[links]] seguem, como no `rename`. */
  async moveNote(input: unknown, folder: unknown): Promise<{ meta: NoteMeta; updatedLinks: number }> {
    const p = notePath(input);
    const dir = folderPath(folder ?? "");
    const name = p.split("/").at(-1)!;
    return this.rename(p, dir ? `${dir}/${name}` : name);
  }

  /** Uma cópia na mesma pasta, "Título 2" (ou o próximo número livre), com o mesmo conteúdo. */
  async duplicate(input: unknown): Promise<Note> {
    const note = await this.get(input);
    return this.create(note.folder, note.title, note.content);
  }

  /** Cria a pasta e as de cima que faltarem. */
  async createFolder(input: unknown): Promise<{ path: string }> {
    const p = folderPath(input);
    if (!p) throw new VaultError("E_BAD_ARGS", "path must name a folder");
    const abs = inside(this.root, p);
    if (await exists(abs)) throw new VaultError("E_EXISTS", `${p} already exists`);
    await mkdir(abs, { recursive: true });
    for (let f = p; f; f = parentOf(f)) this.folders.add(f);
    this.emit([p]);
    return { path: p };
  }

  /**
   * Renomeia ou move a pasta inteira (`target` é o caminho novo dela), e atualiza os [[links]] de todas as notas que
   * apontavam para alguma nota de dentro, inclusive os das que se moveram. Uma pasta não vai para dentro dela mesma.
   */
  async moveFolder(input: unknown, target: unknown): Promise<{ path: string; moved: number; updatedLinks: number }> {
    const from = folderPath(input);
    const to = folderPath(target);
    if (!from || !to) throw new VaultError("E_BAD_ARGS", "path and the new path must name folders");
    if (to === from) return { path: to, moved: 0, updatedLinks: 0 };
    if (to.startsWith(`${from}/`)) throw new VaultError("E_BAD_ARGS", `${from} can't go inside itself`);
    const fromAbs = inside(this.root, from);
    const toAbs = inside(this.root, to);
    const s = await lstat(fromAbs).catch(() => null);
    if (!s?.isDirectory()) throw new VaultError("E_NOT_FOUND", `no folder ${from}`);
    if (from.toLowerCase() !== to.toLowerCase() && (await exists(toAbs))) throw new VaultError("E_EXISTS", `${to} already exists`);
    // Do disco, como o rename de nota (revisão #1397): o índice pode estar atrás.
    await this.scan();
    const before = [...this.notes.keys()];
    const moves = new Map<string, string>();
    for (const p of before) if (p.startsWith(`${from}/`)) moves.set(p, `${to}${p.slice(from.length)}`);
    const after = before.map((p) => moves.get(p) ?? p);
    const aliasesBefore = this.aliasMap();
    const aliasesAfter = new Map([...aliasesBefore].map(([p, a]) => [moves.get(p) ?? p, a] as const));
    await mkdir(path.dirname(toAbs), { recursive: true });
    await rename(fromAbs, toAbs);
    await this.scan();
    const updatedLinks = await this.rewriteAll(moves, makeResolver(before, aliasesBefore), makeResolver(after, aliasesAfter));
    this.emit([from, to, ...moves.keys(), ...moves.values()]);
    return { path: to, moved: moves.size, updatedLinks };
  }

  /** Apaga a pasta com o que tem dentro: espera o "Desfazer" em `.kiwi-trash`, como a nota. */
  async deleteFolder(input: unknown): Promise<true> {
    const p = folderPath(input);
    if (!p) throw new VaultError("E_BAD_ARGS", "the vault itself can't be deleted");
    const abs = inside(this.root, p);
    const s = await lstat(abs).catch(() => null);
    if (!s?.isDirectory()) throw new VaultError("E_NOT_FOUND", `no folder ${p}`);
    const gone = [...this.notes.keys()].filter((n) => n.startsWith(`${p}/`));
    await this.stage(p, abs, "folder");
    await this.scan();
    this.emit([p, ...gone]);
    return true;
  }

  /** Desfaz um apagar dos últimos 10 min (nota ou pasta), de volta ao mesmo lugar, se ele ainda estiver livre. */
  async restore(input: unknown): Promise<{ path: string }> {
    if (typeof input !== "string") throw new VaultError("E_BAD_ARGS", "path must be a string");
    const p = /\.md$/i.test(input) ? notePath(input) : folderPath(input);
    const item = this.staged.get(p);
    if (!item) throw new VaultError("E_NOT_FOUND", `nothing deleted at ${p} to restore`);
    const abs = inside(this.root, p);
    if (await exists(abs)) throw new VaultError("E_EXISTS", `${p} is taken again`);
    await mkdir(path.dirname(abs), { recursive: true });
    await rename(item.abs, abs);
    if (item.timer) clearTimeout(item.timer);
    this.staged.delete(p);
    await rm(path.dirname(item.abs), { recursive: true, force: true });
    await this.scan();
    const back = item.kind === "note" ? [p] : [p, ...[...this.notes.keys()].filter((n) => n.startsWith(`${p}/`))];
    this.emit(back);
    return { path: p };
  }

  /** O caminho absoluto de uma nota ou pasta que existe, para o "Mostrar no Finder" (quem abre o Finder é o app). */
  async locate(input: unknown): Promise<string> {
    if (typeof input !== "string") throw new VaultError("E_BAD_ARGS", "path must be a string");
    const p = /\.md$/i.test(input) ? notePath(input) : folderPath(input);
    const abs = inside(this.root, p);
    if (!(await exists(abs))) throw new VaultError("E_NOT_FOUND", `nothing at ${p}`);
    return abs;
  }

  // ---------------------------------------------------------------- T2593: nota do dia, link que cria, menções, Lixeira

  /** A nota do dia (`<folder>/AAAA-MM-DD.md`), criada vazia se ainda não existe. Sem data, a de hoje (local). */
  async daily(date: unknown, folder: unknown): Promise<Note> {
    const day = date === undefined ? localDate(this.now()) : date;
    if (!isDate(day)) throw new VaultError("E_BAD_ARGS", "date must be YYYY-MM-DD");
    const dir = folderPath(folder ?? "");
    return this.ensure(notePath(`${dir ? `${dir}/` : ""}${day}.md`));
  }

  /**
   * A nota de um `[[link]]`: a que ele já acha, ou uma nova. Com pasta (`[[Pasta/Nota]]`), nela; sem pasta, na pasta de
   * `from` (a nota onde o link está), ou na raiz. A `#seção` e o `|apelido` não entram no nome.
   */
  async createFromLink(link: unknown, from: unknown): Promise<Note> {
    if (typeof link !== "string" || link.length > 1024) throw new VaultError("E_BAD_ARGS", "link must be a string");
    const target = link.replace(/^!?\[\[|\]\]$/g, "").split(/[|#]/)[0]!.trim().replace(/\.md$/i, "");
    if (!target) throw new VaultError("E_BAD_ARGS", "link is empty");
    // O link acha um arquivo do vault que não é nota (T7616): seguir abre o arquivo, nunca cria "relatorio.pdf.md".
    const file = this.resolveFile(link.replace(/^!?\[\[|\]\]$/g, "").split(/[|#]/)[0]!);
    if (file) throw new VaultError("E_EXISTS", `${file} is a file in the vault, not a note`);
    const found = this.resolve_()(target);
    if (found) return this.get(found);
    const parts = target.split("/").filter(Boolean);
    const name = fileNameFor(parts.pop() ?? "");
    const dir = parts.length ? folderPath(parts.join("/")) : from === undefined || from === null ? "" : noteFolder(notePath(from));
    return this.ensure(notePath(`${dir ? `${dir}/` : ""}${name}.md`));
  }

  /** As notas que citam o título de `input` sem `[[ ]]`, com a linha de cada uma (a 1ª menção). */
  unlinkedMentions(input: unknown): { path: string; title: string; context: string }[] {
    const p = notePath(input);
    const title = noteName(p);
    const out: { path: string; title: string; context: string }[] = [];
    for (const e of this.notes.values()) {
      if (e.meta.path === p) continue;
      const spans = unlinkedSpans(e.content, title);
      if (spans.length) out.push({ path: e.meta.path, title: e.meta.title, context: contextOf(e.content, spans[0]!) });
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Na nota `input`, as menções de `target` viram `[[link]]` (escrita condicional, do disco). */
  async linkMentions(input: unknown, target: unknown): Promise<{ meta: NoteMeta; count: number }> {
    const p = notePath(input);
    const t = notePath(target);
    if (!this.notes.has(t)) throw new VaultError("E_NOT_FOUND", `no note ${t}`);
    const title = noteName(t);
    const linkText = this.resolve_()(title) === t ? title : t.replace(/\.md$/i, "");
    for (let attempt = 0; attempt < 3; attempt++) {
      const disk = await readFile(inside(this.root, p), "utf8").catch(() => null);
      if (disk === null) throw new VaultError("E_NOT_FOUND", `no note ${p}`);
      const spans = unlinkedSpans(disk, title);
      if (!spans.length) {
        const { content: _content, ...meta } = await this.get(p);
        return { meta, count: 0 };
      }
      const entry = await this.write(p, linkSpans(disk, spans, linkText), versionOf(disk));
      if (entry) return { meta: entry.meta, count: spans.length };
    }
    throw new VaultError("E_EXISTS", `${p} kept changing; try again`);
  }

  /** A Lixeira do app: o que espera o "Desfazer" e o que já foi para o Lixo do macOS, o mais novo primeiro. */
  trashList(): { items: TrashItem[] } {
    const kiwi: TrashItem[] = [...this.staged].map(([p, s]) => ({
      path: p,
      kind: s.kind,
      deletedAt: new Date(s.at).toISOString(),
      where: "kiwi",
      until: new Date(s.at + this.undoMs).toISOString(),
    }));
    const macos: TrashItem[] = this.registry.map((r) => ({ ...r, where: "macos" }));
    return { items: [...kiwi, ...macos].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt)) };
  }

  /** "Esvaziar": o que espera o "Desfazer" vai já para o Lixo do macOS. */
  async trashEmpty(): Promise<{ trashed: number }> {
    const n = this.staged.size;
    await this.expireAll();
    return { trashed: n };
  }

  /** A nota em `p`, criando vazia se não existe (sem numerar: é aquela nota). */
  private async ensure(p: string): Promise<Note> {
    const abs = inside(this.root, p);
    if (!(await exists(abs))) {
      await mkdir(path.dirname(abs), { recursive: true });
      await this.write(p, "", null); // null: só se ainda não existe; se alguém criou no meio, fica a dele
    }
    return this.get(p);
  }

  // ---------------------------------------------------------------- interno

  /** Troca os [[links]] de todas as notas para os lugares novos de `moves`, com escrita condicional (como o rename). */
  private async rewriteAll(moves: ReadonlyMap<string, string>, before: Resolver, after: Resolver): Promise<number> {
    if (!moves.size) return 0;
    let updated = 0;
    for (const e of [...this.notes.values()]) {
      if (!e.links.some((t) => moves.has(before(t) ?? ""))) continue;
      for (let attempt = 0; attempt < 3; attempt++) {
        const disk = await readFile(inside(this.root, e.meta.path), "utf8").catch(() => null);
        if (disk === null) break;
        const { content: next, count } = rewriteLinksMany(disk, moves, before, after);
        if (!count) break;
        // Uma nota que não é UTF-8 fica como está (T7575): o resto da mudança de pasta segue.
        const written = await this.write(e.meta.path, next, versionOf(disk)).catch((error: unknown) => {
          if (error instanceof VaultError && error.code === "E_NOT_UTF8") return "skip" as const;
          throw error;
        });
        if (written === "skip") break;
        if (written) {
          updated += count;
          break;
        }
      }
    }
    return updated;
  }

  /**
   * Tira o item do vault para `.kiwi-trash/<id>/`, e marca a hora de ir para a Lixeira do macOS. Com `expect`, confere a
   * versão da nota logo antes do `rename`, sem nada no meio: mudou, a caixa sai e nada é apagado (`E_CONFLICT`).
   */
  private async stage(p: string, abs: string, kind: Staged["kind"], expect?: string): Promise<void> {
    if (expect !== undefined && !(await this.atVersion(abs, expect))) throw new VaultError("E_CONFLICT", `${p} changed; nothing was deleted`);
    const box = path.join(this.root, UNDO_DIR, `${this.now()}-${randomBytes(4).toString("hex")}`);
    await mkdir(box, { recursive: true });
    const staged = path.join(box, path.basename(abs));
    const at = this.now();
    await writeFile(path.join(box, BOX_META), JSON.stringify({ path: p, kind, deletedAt: new Date(at).toISOString() }));
    this.beforeReplace?.();
    if (expect !== undefined && !(await this.atVersion(abs, expect))) {
      await rm(box, { recursive: true, force: true });
      throw new VaultError("E_CONFLICT", `${p} changed; nothing was deleted`);
    }
    await rename(abs, staged);
    // O mesmo caminho apagado de novo: o de antes segue para a Lixeira, só depois que este saiu do lugar. Uma recusa
    // acima (`E_CONFLICT`) não leva embora o Desfazer de 10 min do apagar anterior (revisão do T9398).
    const old = this.staged.get(p);
    if (old) await this.expire(p, old);
    const item: Staged = { abs: staged, kind, at, timer: null };
    item.timer = setTimeout(() => void this.expire(p, item), this.undoMs);
    (item.timer as { unref?: () => void }).unref?.();
    this.staged.set(p, item);
  }

  /** O arquivo está naquela versão agora (lido do disco, não do índice). */
  private async atVersion(abs: string, version: string): Promise<boolean> {
    const raw = await readFile(abs).catch(() => null);
    // A versão de uma nota é a do texto; a de um arquivo que não é nota (o `readFile`), a dos bytes.
    return raw !== null && (versionOf(raw.toString("utf8")) === version || createHash("sha256").update(raw).digest("hex").slice(0, 16) === version);
  }

  /** O "Desfazer" acabou: o item vai para a Lixeira do macOS. */
  private async expire(p: string, item: Staged): Promise<void> {
    if (item.timer) clearTimeout(item.timer);
    if (this.staged.get(p) === item) this.staged.delete(p);
    try {
      await this.trash(item.abs);
      await rm(path.dirname(item.abs), { recursive: true, force: true });
      await this.remember({ path: p, kind: item.kind, deletedAt: new Date(item.at).toISOString() });
    } catch (e) {
      console.error(`[notes] couldn't move ${item.abs} to the Trash:`, e);
    }
  }

  private async expireAll(): Promise<void> {
    for (const [p, item] of [...this.staged]) await this.expire(p, item);
  }

  private async flushLeftoverUndo(): Promise<void> {
    const dir = path.join(this.root, UNDO_DIR);
    let boxes: string[];
    try {
      boxes = await readdir(dir);
    } catch {
      return;
    }
    for (const box of boxes) {
      const boxAbs = path.join(dir, box);
      // Só as caixas (o registry.json fica).
      if (!(await lstat(boxAbs).catch(() => null))?.isDirectory()) continue;
      const meta = await readFile(path.join(boxAbs, BOX_META), "utf8").then((t) => JSON.parse(t) as RegistryEntry, () => null);
      let moved = false;
      for (const name of await readdir(boxAbs).catch(() => [] as string[])) {
        if (name === BOX_META) continue;
        await this.trash(path.join(boxAbs, name)).then(
          () => (moved = true),
          (e) => console.error(`[notes] couldn't move ${name} to the Trash:`, e),
        );
      }
      await rm(boxAbs, { recursive: true, force: true });
      if (moved && meta && typeof meta.path === "string") await this.remember(meta);
    }
  }

  private async loadRegistry(): Promise<void> {
    const raw = await readFile(path.join(this.root, UNDO_DIR, REGISTRY_FILE), "utf8").catch(() => null);
    let list: unknown = [];
    try {
      list = raw ? JSON.parse(raw) : [];
    } catch {
      list = [];
    }
    this.registry = (Array.isArray(list) ? list : []).filter(
      (e): e is RegistryEntry =>
        !!e && typeof e.path === "string" && (e.kind === "note" || e.kind === "folder") && typeof e.deletedAt === "string",
    );
  }

  /** Anota no registro o que foi para o Lixo do macOS: as últimas `REGISTRY_MAX`, dos últimos `REGISTRY_DAYS` dias. */
  private async remember(e: RegistryEntry): Promise<void> {
    const oldest = this.now() - REGISTRY_DAYS * 86_400_000;
    this.registry = [e, ...this.registry].filter((r) => Date.parse(r.deletedAt) >= oldest).slice(0, REGISTRY_MAX);
    const dir = path.join(this.root, UNDO_DIR);
    await mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `.registry-${randomBytes(4).toString("hex")}.tmp`);
    try {
      await writeDurable(tmp, JSON.stringify(this.registry));
      await rename(tmp, path.join(dir, REGISTRY_FILE));
    } catch (e) {
      // O disco cheio no meio (T7942): o temporário sai, e o erro segue.
      await rm(tmp, { force: true }).catch(() => {});
      throw e;
    }
  }

  private resolve_(): Resolver {
    this.resolver ??= makeResolver([...this.notes.keys()], this.aliasMap());
    return this.resolver;
  }

  /**
   * Escreve ao lado e troca: o Obsidian, o watcher ou um crash nunca veem metade de uma nota. Com `expect`, só troca
   * se o arquivo ainda está naquela versão (`null`: se ele ainda não existe), relida logo antes da troca; senão não
   * escreve e devolve null. A janela que sobra é a do próprio `rename`, de microssegundos.
   */
  private async write(p: string, content: string, expect?: string | null): Promise<Entry | null> {
    if (!(await this.replaceChecked(p, content, expect))) return null;
    const entry = await this.index(p, content, inside(this.root, p));
    this.emit([p]);
    return entry;
  }

  /** A troca atômica e condicional do `write`, sem o índice das notas (o quadro usa a mesma, T6600). */
  private async replaceChecked(p: string, content: string, expect?: string | null): Promise<boolean> {
    const abs = inside(this.root, p);
    const temp = path.join(path.dirname(abs), `.kiwi-${randomBytes(6).toString("hex")}.tmp`);
    try {
      // Dentro do try (T7942): com o disco cheio, o `open` cria o temporário e a escrita falha; ele não fica na pasta.
      await writeDurable(temp, content);
      this.beforeReplace?.();
      const raw = await readFile(abs).catch(() => null);
      // Um arquivo que não é UTF-8 (T7575): o texto que chega aqui já perdeu os acentos na leitura, e gravar por cima
      // apagaria os bytes de vez. Nada troca esse arquivo: quem reescreve outras notas pula este e conta como pulado.
      if (raw && !isUtf8(raw)) throw new VaultError("E_NOT_UTF8", `${p} is not UTF-8; Kiwi won't write over it`);
      if (expect !== undefined) {
        const now = raw === null ? null : raw.toString("utf8");
        if (expect === null ? now !== null : now === null || versionOf(now) !== expect) {
          await rm(temp, { force: true });
          return false;
        }
      }
      // O arquivo novo fica com as permissões do que ele troca (revisão do T7105): sem isto, um `600` privado ou um
      // `755` voltava `644` a cada save, de nota, de quadro ou de texto.
      const old = await stat(abs).catch(() => null);
      if (old) await chmod(temp, old.mode & 0o7777);
      await rename(temp, abs);
      await syncDir(path.dirname(abs));
    } catch (e) {
      await rm(temp, { force: true });
      throw e;
    }
    return true;
  }

  private async index(p: string, content: string, abs: string): Promise<Entry> {
    const entry = await this.entryFor(p, content, abs);
    const old = this.notes.get(p);
    if (!old || old.aliases.join("\n") !== entry.aliases.join("\n")) this.resolver = null;
    this.notes.set(p, entry);
    this.touch(p);
    this.searchDirty = true;
    for (let f = entry.meta.folder; f; f = parentOf(f)) this.folders.add(f);
    return entry;
  }

  /** A entrada do índice de uma nota, sem pôr no índice (o `scan` monta um índice novo e troca de uma vez). */
  private async entryFor(p: string, content: string, abs: string, known?: Stats): Promise<Entry> {
    // O scan já fez o `lstat`: sem outro `stat` por nota (T5352, ~150 ms com 10 mil notas).
    const s = known ?? (await stat(abs));
    const title = noteName(p);
    const folder = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
    const entry: Entry = {
      meta: {
        path: p,
        title,
        folder,
        mtime: s.mtime.toISOString(),
        ctime: s.birthtime.toISOString(),
        size: s.size,
        version: versionOf(content),
        tags: tagsOf(content),
      },
      folded: fold(content),
      foldedTitle: fold(title),
      links: parseLinks(content).map((l) => l.target),
      content,
      ino: s.ino,
      aliases: aliasesOf(content),
      mtimeMs: s.mtimeMs,
    };
    return entry;
  }

  /** O caminho → os apelidos, só das notas que têm algum (para o resolver). */
  private aliasMap(notes: ReadonlyMap<string, Entry> = this.notes): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const [p, e] of notes) if (e.aliases.length) out.set(p, e.aliases);
    return out;
  }

  /**
   * A entrada de antes, se o arquivo não mudou (T5352, o cache por mtime e tamanho, como o fsal-cache do Zettlr): mesmo
   * inode, mesmo tamanho e mesmo mtime. Num rename (de pasta, ou feito fora), o inode acha a entrada pelo caminho velho
   * e ela só troca o caminho, o título e a pasta.
   */
  private reuse(p: string, s: Stats, byIno: ReadonlyMap<number, Entry>): Entry | null {
    const prev = this.notes.get(p)?.ino === s.ino ? this.notes.get(p)! : byIno.get(s.ino);
    if (!prev || prev.meta.size !== s.size || prev.mtimeMs !== s.mtimeMs) return null;
    if (prev.meta.path === p) return prev;
    const title = noteName(p);
    return {
      ...prev,
      meta: { ...prev.meta, path: p, title, folder: p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "" },
      foldedTitle: fold(title),
    };
  }

  /**
   * Relê o cofre inteiro. Monta o índice novo à parte e troca tudo de uma vez no fim: um `list()` ou uma busca no meio
   * nunca veem um cofre pela metade (revisão #3499). Um item que some no meio (o Obsidian renomeando) só fica de fora.
   */
  private touch(p: string): void {
    if (this.scans) this.touchedAt.set(p, ++this.seq);
  }

  private async scan(o: { quiet?: boolean } = {}): Promise<void> {
    this.scans++;
    const started = ++this.seq;
    try {
      await this.scanFrom(started, o);
    } finally {
      if (--this.scans === 0) this.touchedAt.clear();
    }
  }

  private async scanFrom(started: number, o: { quiet?: boolean }): Promise<void> {
    const progress = o.quiet ? undefined : this.onIndexProgress;
    const notes = new Map<string, Entry>();
    const folders = new Set<string>();
    const files = new Map<string, VaultFile>();
    const packages = new Set<string>();
    let seen = 0;
    progress?.({ seen, notes: 0, done: false });
    // O cache (T5352): as entradas de agora pelo inode, para reconhecer uma nota que mudou de caminho sem reler.
    const byIno = new Map<number, Entry>();
    for (const e of this.notes.values()) byIno.set(e.ino, e);
    const toRead: { key: string; abs: string; s: Stats }[] = [];
    const walk = async (rel: string) => {
      const directory = path.join(this.root, rel);
      const names = await readdir(directory).catch(error => {
        if (!rel && this.strictRoot) throw new VaultError("E_ACCESS", `Não foi possível ler a pasta ${directory}: ${(error as Error).message}`);
        return [] as string[];
      });
      // Os `lstat` de uma pasta em paralelo, alguns de cada vez (T5352): é a maior parte de um scan que não relê.
      const visible = names.filter((name) => !name.startsWith(".") && name !== "node_modules");
      const stats: (Stats | null)[] = [];
      for (let i = 0; i < visible.length; i += 64) {
        stats.push(...(await Promise.all(visible.slice(i, i + 64).map((name) => lstat(path.join(directory, name)).catch(() => null)))));
      }
      for (const [at, name] of visible.entries()) {
        const child = rel ? `${rel}/${name}` : name;
        const key = child.normalize("NFC");
        const abs = path.join(this.root, child);
        const s = stats[at] ?? null;
        if (!s || s.isSymbolicLink()) continue;
        if (s.isFile() || s.isDirectory() && PACKAGE_MARKS[extOf(name)]) {
          seen++;
          if (seen % 128 === 0) {
            progress?.({ seen, notes: notes.size, done: false });
            await new Promise(resolve => setTimeout(resolve, 0));
            if (this.closed) return;
          }
        }
        if (s.isDirectory() && isPackageDir(name, await packageEntries(abs))) {
          // Um documento-pacote: arquivo, não pasta (T3371). Só com a marca do formato e sem nota dentro (#3476).
          packages.add(key);
          files.set(key, fileEntry(key, s));
        } else if (s.isDirectory()) {
          folders.add(key);
          await walk(child);
        } else if (s.isFile() && /\.md$/i.test(name)) {
          // Igual ao que já está no índice (T5352): fica, sem reler. Senão, entra na fila de leitura.
          const kept = this.reuse(key, s, byIno);
          if (kept) notes.set(key, kept);
          else toRead.push({ key, abs, s });
        } else if (s.isFile()) {
          files.set(key, fileEntry(key, s));
        }
      }
    };
    await walk("");
    if (this.closed) return;
    // As que mudaram (ou todas, no 1º scan), algumas de cada vez em paralelo. Uma que some no meio fica de fora.
    for (let i = 0; i < toRead.length; i += READ_AT_ONCE) {
      await Promise.all(
        toRead.slice(i, i + READ_AT_ONCE).map(async ({ key, abs, s }) => {
          this.scanReads++;
          const content = await readFile(abs, "utf8").catch(() => null);
          const entry = content === null ? null : await this.entryFor(key, content, abs, s).catch(() => null);
          if (entry) notes.set(key, entry);
        }),
      );
      if (this.closed) return;
    }
    for (const [p, at] of this.touchedAt) {
      if (at < started) continue;
      const now = this.notes.get(p);
      if (now) notes.set(p, now);
      else notes.delete(p);
    }
    this.searchIndex ??= new NoteSearchIndex();
    this.searchIndex.sync(notes.values());
    this.searchDirty = false;
    this.notes = notes;
    this.folders = folders;
    const diff = filesDiff(this.files, files);
    if (diff === null || diff.length) this.filesChanged(diff);
    this.files = files;
    this.packages = packages;
    this.resolver = null;
    progress?.({ seen, notes: notes.size, done: true });
  }

  /** O que o watcher juntou: relê o que mudou, tira o que sumiu, e avisa. */
  private async flush(): Promise<void> {
    this.flushTimer = null;
    if (this.closed) return;
    const paths = [...this.pendingPaths];
    this.pendingPaths.clear();
    const changed: string[] = [];
    const others: string[] = [];
    const before = this.snapshot();
    for (const rel of paths) {
      // Uma pasta conhecida com nome de pacote que acabou de ganhar a marca (o Keynote cria a pasta e, um instante
      // depois, o Index.zip): agora é documento, e a releitura a tira das pastas (revisão #3492).
      if (await this.becamePackage(rel)) {
        await this.scan();
        changed.push(rel);
        others.push(rel);
        continue;
      }
      // Dentro de um documento-pacote (o Pages salvando): conta como o pacote inteiro mudando (T3371).
      const pkg = this.packageOf(rel);
      if (pkg) {
        const ps = await lstat(path.join(this.root, pkg)).catch(() => null);
        if (ps?.isDirectory() && !ps.isSymbolicLink()) this.keepFile(pkg, ps);
        else {
          if (this.files.delete(pkg)) this.filesChanged([pkg]);
          this.packages.delete(pkg);
        }
        if (!others.includes(pkg)) others.push(pkg);
        continue;
      }
      const abs = path.join(this.root, rel);
      let s;
      try {
        s = await lstat(abs);
      } catch {
        s = null;
      }
      if (s?.isDirectory() && !s.isSymbolicLink()) {
        if (!this.folders.has(rel)) {
          await this.scan(); // uma pasta nova (copiada, puxada): mais simples reler tudo
          changed.push(rel);
          others.push(rel); // com os arquivos de dentro: a árvore relê (T3370)
        }
        continue;
      }
      if (!s && this.folders.has(rel)) {
        // Uma pasta que sumiu (renomeada ou apagada por fora): as notas de dentro também, e o mais simples é reler.
        await this.scan();
        changed.push(rel);
        others.push(rel);
        continue;
      }
      if (!/\.md$/i.test(rel)) {
        // Um arquivo numa pasta que o índice ainda não conhece (uma pasta ou um pacote criados por fora, e o FSEvents só
        // contou o de dentro): relê tudo, e o scan decide se é pasta ou documento-pacote (T3371).
        const dir = parentOf(rel);
        if (s && dir && !this.folders.has(dir)) {
          await this.scan();
          changed.push(rel);
          others.push(rel);
          continue;
        }
        if (s?.isFile()) this.keepFile(rel, s);
        else if (this.files.delete(rel)) this.filesChanged([rel]);
        others.push(rel);
        continue;
      }
      if (!s || !s.isFile()) {
        if (this.notes.delete(rel)) {
          this.touch(rel);
          this.searchDirty = true;
          this.resolver = null;
          changed.push(rel);
        }
        continue;
      }
      const content = await readFile(abs, "utf8").catch(() => null);
      if (content === null) continue;
      if (this.notes.get(rel)?.meta.version === versionOf(content)) continue; // o próprio app escreveu
      // Sumiu entre a leitura e o stat (renomeada de novo): o próximo evento do watcher conta como ficou.
      if (!(await this.index(rel, content, abs).catch(() => null))) continue;
      changed.push(rel);
    }
    if (this.closed) return; // fechou no meio: ninguém mais escuta (revisão #3499)
    if (changed.length) this.emit(changed);
    if (others.length) {
      for (const fn of this.otherListeners) {
        try {
          fn(others);
        } catch (e) {
          console.error("[notes] file listener failed:", e);
        }
      }
    }
    const r = reconcileMoves(before, this.snapshot());
    if (r.moves.size || r.gone.length) {
      for (const fn of this.moveListeners) {
        try {
          fn(r);
        } catch (e) {
          console.error("[notes] move listener failed:", e);
        }
      }
    }
  }

  /** Se uma pasta conhecida acima de `rel`, com nome de pacote, agora tem a marca do formato e nenhuma nota. */
  private async becamePackage(rel: string): Promise<boolean> {
    for (let p = parentOf(rel); p; p = parentOf(p)) {
      if (!this.folders.has(p) || !PACKAGE_MARKS[extOf(p)]) continue;
      if (isPackageDir(p, await packageEntries(path.join(this.root, p)))) return true;
    }
    return false;
  }

  /** O pacote conhecido que contém `rel` (ou é ele), ou null. Um pacote novo entra pelo scan (pasta nova relê tudo). */
  private packageOf(rel: string): string | null {
    for (let p = rel; p; p = parentOf(p)) if (this.packages.has(p)) return p;
    return null;
  }

  private keepFile(rel: string, s: { size: number; mtimeMs: number }) {
    const entry = fileEntry(rel, s);
    const was = this.files.get(rel);
    if (was && was.size === entry.size && was.mtime === entry.mtime) return;
    this.files.set(rel, entry);
    this.filesChanged([rel]);
  }

  private snapshot(): Snapshot {
    return new Map([...this.notes].map(([p, e]) => [p, { ino: e.ino, version: e.meta.version }]));
  }

  private emit(paths: string[]) {
    for (const fn of this.listeners) {
      try {
        fn(paths);
      } catch (e) {
        console.error("[notes] listener failed:", e);
      }
    }
  }
}

async function exists(abs: string): Promise<boolean> {
  try {
    await lstat(abs);
    return true;
  } catch {
    return false;
  }
}

/**
 * Os itens de uma pasta para o `isPackageDir`: os de primeiro nível e, com uma pasta `Index`, os de dentro dela como
 * `Index/<nome>`. O iWork de hoje guarda o documento em `Index/Document.iwa`, sem `Index.zip` (T3918).
 */
async function packageEntries(abs: string): Promise<string[]> {
  const top = await readdir(abs).catch(() => [] as string[]);
  if (!top.includes("Index")) return top;
  const inner = await readdir(path.join(abs, "Index")).catch(() => [] as string[]);
  return [...top, ...inner.map((e) => `Index/${e}`)];
}

const parentOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

const fileEntry = (rel: string, s: { size: number; mtimeMs: number }): VaultFile => ({ path: rel, size: s.size, mtime: new Date(s.mtimeMs).toISOString() });

/** Quantas mudanças de arquivo o registro guarda, e a maior diferença que vai no lugar da lista inteira. */
const FILES_LOG_MAX = 20_000;
const FILES_DELTA_MAX = 5_000;

/**
 * Os caminhos que entraram, saíram ou mudaram de tamanho ou de data entre `a` e `b` (o scan de conferência não muda a
 * versão à toa). `null` quando são mais que o registro guarda.
 */
function filesDiff(a: ReadonlyMap<string, VaultFile>, b: ReadonlyMap<string, VaultFile>): string[] | null {
  const out: string[] = [];
  for (const [p, f] of b) {
    const was = a.get(p);
    if (!was || was.size !== f.size || was.mtime !== f.mtime) out.push(p);
    if (out.length > FILES_LOG_MAX) return null;
  }
  for (const p of a.keys()) {
    if (!b.has(p)) out.push(p);
    if (out.length > FILES_LOG_MAX) return null;
  }
  return out;
}

/** A árvore das pastas a partir das listas: pastas vazias entram, e as filhas e as notas vêm em ordem. */
export function buildTree(folders: readonly string[], notes: readonly { path: string; folder: string }[]): FolderNode {
  const root: FolderNode = { path: "", name: "", folders: [], notes: [] };
  const byPath = new Map<string, FolderNode>([["", root]]);
  const node = (p: string): FolderNode => {
    const found = byPath.get(p);
    if (found) return found;
    const n: FolderNode = { path: p, name: p.split("/").at(-1)!, folders: [], notes: [] };
    byPath.set(p, n);
    node(parentOf(p)).folders.push(n);
    return n;
  };
  for (const f of folders) node(f);
  for (const n of notes) node(n.folder).notes.push(n.path);
  const sort = (n: FolderNode) => {
    n.folders.sort((a, b) => a.name.localeCompare(b.name));
    n.notes.sort((a, b) => a.localeCompare(b));
    n.folders.forEach(sort);
  };
  sort(root);
  return root;
}

const noteFolder = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

/** O `%xx` vira o caractere, e o que não decodifica fica como está (T7877). */
function looseDecode(text: string): string {
  if (!text.includes("%")) return text;
  return text.replace(/(?:%[0-9a-f]{2})+/gi, (s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });
}
