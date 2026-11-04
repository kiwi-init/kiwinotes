// O vault das notas (T1316, spec #1107): Markdown puro em ~/KiwiNotes, um .md por nota, frontmatter YAML e links
// [[nota]]. Abre no Obsidian sem perder nada: o app não reescreve uma nota que a pessoa não salvou, e só mexe no texto
// de outra nota para atualizar um [[link]] num rename. Não há banco: o índice vive na memória e se refaz do disco
// (no início e pelo watcher, que pega também o que muda fora do app, como no Obsidian).

import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { type FSWatcher, watch } from "node:fs";
import { lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { makeResolver, noteName, parseLinks, type Resolver, rewriteLinks, rewriteLinksMany } from "../shared/wikilinks.ts";
import { fold, foldWithMap } from "../store/text.ts";
import { hasPositive, parseQuery } from "../shared/query.ts";
import { bodyTags, hasTag, type TagNode, tagTree, uniqueTags } from "../shared/tags.ts";
import { fillTemplate } from "../shared/templates.ts";
import { contextOf, linkSpans, unlinkedSpans } from "./mentions.ts";
import { fileNameFor, folderPath, inside, notePath, VaultError } from "./paths.ts";

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
}

export type SaveResult = { saved: true; meta: NoteMeta } | { saved: false; current: Note };

export interface SearchHit {
  path: string;
  title: string;
  snippet: string;
  score: number;
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

export interface VaultOptions {
  root: string;
  /** Manda para a Lixeira do macOS. Nos testes, de mentira. */
  trash?: (abs: string) => Promise<void>;
  /** Quanto o watcher junta mudanças antes de avisar. */
  debounceMs?: number;
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
  return new Promise((resolve, reject) => {
    const p = spawn("/usr/bin/trash", [abs], { stdio: "ignore" });
    p.on("error", reject);
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`trash exited with ${code}`))));
  });
}

export const versionOf = (content: string) => createHash("sha256").update(content).digest("hex").slice(0, 16);

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
  private readonly trash: (abs: string) => Promise<void>;
  private readonly debounceMs: number;
  private readonly watchOnOpen: boolean;
  private notes = new Map<string, Entry>();
  private folders = new Set<string>();
  private watcher: FSWatcher | null = null;
  private pendingPaths = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<(paths: string[]) => void>();
  private readonly moveListeners = new Set<(r: ExternalMoves) => void>();
  private ready: Promise<void> | null = null;
  /** A resolução de [[links]] para as notas de agora; refeita quando uma nota entra, sai ou muda de nome. */
  private resolver: Resolver | null = null;
  /** Só para os testes: roda entre gravar o arquivo temporário e conferir a versão (uma edição de fora bem ali). */
  private beforeReplace?: () => void;
  /** O que foi apagado e ainda dá para desfazer, pelo caminho original (T2468). */
  private staged = new Map<string, Staged>();
  private readonly undoMs: number;
  private readonly now: () => number;
  /** O que já foi para o Lixo do macOS (T2593), do `.kiwi-trash/registry.json`. */
  private registry: RegistryEntry[] = [];

  constructor(o: VaultOptions) {
    this.root = o.root;
    this.trash = o.trash ?? macTrash;
    this.debounceMs = o.debounceMs ?? 150;
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

  /** Avisa quando notas mudam, inclusive fora do app. */
  onChanged(fn: (paths: string[]) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Começa a olhar o disco (o Obsidian, o Finder, um git pull). */
  watch(): void {
    if (this.watcher) return;
    this.watcher = watch(this.root, { recursive: true }, (_event, file) => {
      if (!file) return;
      const rel = String(file).split(path.sep).join("/").normalize("NFC");
      if (rel.split("/").some((s) => s.startsWith("."))) return;
      this.pendingPaths.add(rel);
      this.flushTimer ??= setTimeout(() => void this.flush(), this.debounceMs);
    });
  }

  close(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    // O que esperava o "Desfazer" vai para a Lixeira agora; se o processo sair antes, o próximo `open` termina.
    void this.expireAll();
  }

  // ---------------------------------------------------------------- leitura

  list(): { folders: string[]; notes: NoteMeta[]; tree: FolderNode } {
    const folders = [...this.folders].sort((a, b) => a.localeCompare(b));
    const notes = [...this.notes.values()].map((e) => e.meta).sort((a, b) => a.path.localeCompare(b.path));
    return { folders, notes, tree: buildTree(folders, notes) };
  }

  async get(input: unknown): Promise<Note> {
    const p = notePath(input);
    const abs = inside(this.root, p);
    let content: string;
    try {
      content = await readFile(abs, "utf8");
    } catch {
      throw new VaultError("E_NOT_FOUND", `no note ${p}`);
    }
    const entry = await this.index(p, content, abs);
    return { ...entry.meta, content };
  }

  resolve(link: unknown): string | null {
    if (typeof link !== "string" || link.length > 1024) throw new VaultError("E_BAD_ARGS", "link must be a string");
    return this.resolve_()(link.replace(/^!?\[\[|\]\]$/g, "").split(/[|#]/)[0]!);
  }

  search(query: unknown, limit: unknown = 20): SearchHit[] {
    if (typeof query !== "string" || query.length > 500) throw new VaultError("E_BAD_ARGS", "query must be a string");
    const max = limit === undefined ? 20 : limit;
    if (typeof max !== "number" || !Number.isInteger(max) || max < 1 || max > 100) {
      throw new VaultError("E_BAD_ARGS", "limit must be an integer from 1 to 100");
    }
    // Os filtros (T2660, src/shared/query.ts): palavras, "frases", tag:, path: e as exclusões com "-".
    const q = parseQuery(query);
    if (!hasPositive(q)) return [];
    const hits: { e: Entry; score: number }[] = [];
    for (const e of this.notes.values()) {
      if (!q.tags.every((t) => hasTag(e.meta.tags, t)) || q.notTags.some((t) => hasTag(e.meta.tags, t))) continue;
      const foldedPath = fold(e.meta.path);
      if (!q.paths.every((p) => foldedPath.includes(p)) || q.notPaths.some((p) => foldedPath.includes(p))) continue;
      if (q.notText.some((t) => e.foldedTitle.includes(t) || e.folded.includes(t))) continue;
      if (!q.phrases.every((t) => e.foldedTitle.includes(t) || e.folded.includes(t))) continue;
      const terms = [...q.words, ...q.phrases];
      // Só filtros: todas as notas que passam, das mais recentes para as mais velhas.
      if (!terms.length) {
        hits.push({ e, score: Date.parse(e.meta.mtime) / 1e12 });
        continue;
      }
      let score = 0;
      let all = true;
      for (const t of terms) {
        const inTitle = e.foldedTitle.includes(t);
        const inText = e.folded.includes(t);
        if (!inTitle && !inText) {
          all = false;
          break;
        }
        score += (inTitle ? 10 : 0) + (inText ? 1 : 0) + (e.foldedTitle === t ? 20 : 0);
      }
      if (!all) continue;
      hits.push({ e, score });
    }
    // O trecho só para os que voltam: montar para cada nota que casa custava mais que a busca (288 ms com 1.000 notas).
    const first = q.phrases[0] ?? q.words[0] ?? (q.tags[0] ? `#${fold(q.tags[0])}` : "");
    return hits
      .sort((a, b) => b.score - a.score || a.e.meta.path.localeCompare(b.e.meta.path))
      .slice(0, max)
      .map(({ e, score }) => ({ path: e.meta.path, title: e.meta.title, snippet: snippetAround(e.content, first), score }));
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
  async rename(input: unknown, target: unknown): Promise<{ meta: NoteMeta; updatedLinks: number }> {
    const from = notePath(input);
    const to = notePath(target);
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
    this.resolver = null;
    const content = moved?.content ?? (await readFile(toAbs, "utf8"));
    const entry = await this.index(to, content, toAbs);

    let updatedLinks = 0;
    const resolveBefore = makeResolver(before);
    const resolveAfter = makeResolver(after);
    for (const e of [...this.notes.values()]) {
      if (!e.links.some((t) => resolveBefore(t) === from)) continue;
      // Do disco, e escrita condicional: se a nota mudar entre ler e escrever, lê de novo (até 3 vezes).
      for (let attempt = 0; attempt < 3; attempt++) {
        const abs = inside(this.root, e.meta.path);
        const disk = await readFile(abs, "utf8").catch(() => null);
        if (disk === null) break;
        const { content: next, count } = rewriteLinks(disk, from, to, resolveBefore, resolveAfter);
        if (!count) break;
        if (await this.write(e.meta.path, next, versionOf(disk))) {
          updatedLinks += count;
          break;
        }
      }
    }
    this.emit([from, to]);
    return { meta: (this.notes.get(to) ?? entry).meta, updatedLinks };
  }

  /**
   * Apaga a nota: ela espera 10 min em `.kiwi-trash` (o "Desfazer", `restore`) e então vai para a Lixeira do macOS. Não
   * vai direto para a Lixeira porque tirar de lá pede o Acesso Total ao Disco (o ~/.Trash é protegido pelo TCC).
   */
  async delete(input: unknown): Promise<true> {
    const p = notePath(input);
    const abs = inside(this.root, p);
    if (!(await exists(abs))) throw new VaultError("E_NOT_FOUND", `no note ${p}`);
    await this.stage(p, abs, "note");
    this.notes.delete(p);
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
    await mkdir(path.dirname(toAbs), { recursive: true });
    await rename(fromAbs, toAbs);
    await this.scan();
    const updatedLinks = await this.rewriteAll(moves, makeResolver(before), makeResolver(after));
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
        if (await this.write(e.meta.path, next, versionOf(disk))) {
          updated += count;
          break;
        }
      }
    }
    return updated;
  }

  /** Tira o item do vault para `.kiwi-trash/<id>/`, e marca a hora de ir para a Lixeira do macOS. */
  private async stage(p: string, abs: string, kind: Staged["kind"]): Promise<void> {
    const old = this.staged.get(p);
    if (old) await this.expire(p, old); // o mesmo caminho apagado de novo: o de antes segue para a Lixeira
    const box = path.join(this.root, UNDO_DIR, `${this.now()}-${randomBytes(4).toString("hex")}`);
    await mkdir(box, { recursive: true });
    const staged = path.join(box, path.basename(abs));
    const at = this.now();
    await writeFile(path.join(box, BOX_META), JSON.stringify({ path: p, kind, deletedAt: new Date(at).toISOString() }));
    await rename(abs, staged);
    const item: Staged = { abs: staged, kind, at, timer: null };
    item.timer = setTimeout(() => void this.expire(p, item), this.undoMs);
    (item.timer as { unref?: () => void }).unref?.();
    this.staged.set(p, item);
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
    await writeFile(tmp, JSON.stringify(this.registry));
    await rename(tmp, path.join(dir, REGISTRY_FILE));
  }

  private resolve_(): Resolver {
    this.resolver ??= makeResolver([...this.notes.keys()]);
    return this.resolver;
  }

  /**
   * Escreve ao lado e troca: o Obsidian, o watcher ou um crash nunca veem metade de uma nota. Com `expect`, só troca
   * se o arquivo ainda está naquela versão (`null`: se ele ainda não existe), relida logo antes da troca; senão não
   * escreve e devolve null. A janela que sobra é a do próprio `rename`, de microssegundos.
   */
  private async write(p: string, content: string, expect?: string | null): Promise<Entry | null> {
    const abs = inside(this.root, p);
    const temp = path.join(path.dirname(abs), `.kiwi-${randomBytes(6).toString("hex")}.tmp`);
    await writeFile(temp, content);
    try {
      this.beforeReplace?.();
      if (expect !== undefined) {
        const now = await readFile(abs, "utf8").catch(() => null);
        if (expect === null ? now !== null : now === null || versionOf(now) !== expect) {
          await rm(temp, { force: true });
          return null;
        }
      }
      await rename(temp, abs);
    } catch (e) {
      await rm(temp, { force: true });
      throw e;
    }
    const entry = await this.index(p, content, abs);
    this.emit([p]);
    return entry;
  }

  private async index(p: string, content: string, abs: string): Promise<Entry> {
    const s = await stat(abs);
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
    };
    if (!this.notes.has(p)) this.resolver = null;
    this.notes.set(p, entry);
    for (let f = folder; f; f = f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : "") this.folders.add(f);
    return entry;
  }

  private async scan(): Promise<void> {
    this.resolver = null;
    this.notes = new Map();
    this.folders = new Set();
    const walk = async (rel: string) => {
      for (const name of await readdir(path.join(this.root, rel))) {
        if (name.startsWith(".")) continue;
        const child = rel ? `${rel}/${name}` : name;
        const abs = path.join(this.root, child);
        const s = await lstat(abs);
        if (s.isSymbolicLink()) continue;
        if (s.isDirectory()) {
          this.folders.add(child.normalize("NFC"));
          await walk(child);
        } else if (s.isFile() && /\.md$/i.test(name)) {
          await this.index(child.normalize("NFC"), await readFile(abs, "utf8"), abs);
        }
      }
    };
    await walk("");
  }

  /** O que o watcher juntou: relê o que mudou, tira o que sumiu, e avisa. */
  private async flush(): Promise<void> {
    this.flushTimer = null;
    const paths = [...this.pendingPaths];
    this.pendingPaths.clear();
    const changed: string[] = [];
    const before = this.snapshot();
    for (const rel of paths) {
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
        }
        continue;
      }
      if (!s && this.folders.has(rel)) {
        // Uma pasta que sumiu (renomeada ou apagada por fora): as notas de dentro também, e o mais simples é reler.
        await this.scan();
        changed.push(rel);
        continue;
      }
      if (!/\.md$/i.test(rel)) continue;
      if (!s || !s.isFile()) {
        if (this.notes.delete(rel)) {
          this.resolver = null;
          changed.push(rel);
        }
        continue;
      }
      const content = await readFile(abs, "utf8").catch(() => null);
      if (content === null) continue;
      if (this.notes.get(rel)?.meta.version === versionOf(content)) continue; // o próprio app escreveu
      await this.index(rel, content, abs);
      changed.push(rel);
    }
    if (changed.length) this.emit(changed);
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

const parentOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

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
