// O vault das notas (T1316, spec #1107): Markdown puro em ~/KiwiNotes, um .md por nota, frontmatter YAML e links
// [[nota]]. Abre no Obsidian sem perder nada: o app não reescreve uma nota que a pessoa não salvou, e só mexe no texto
// de outra nota para atualizar um [[link]] num rename. Não há banco: o índice vive na memória e se refaz do disco
// (no início e pelo watcher, que pega também o que muda fora do app, como no Obsidian).

import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { type FSWatcher, watch } from "node:fs";
import { lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { makeResolver, noteName, parseLinks, type Resolver, rewriteLinks } from "../shared/wikilinks.ts";
import { fold, foldWithMap } from "../store/text.ts";
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
}

export interface VaultOptions {
  root: string;
  /** Manda para a Lixeira do macOS. Nos testes, de mentira. */
  trash?: (abs: string) => Promise<void>;
  /** Quanto o watcher junta mudanças antes de avisar. */
  debounceMs?: number;
  /** Liga o watcher ao abrir (o app liga; os testes ligam na mão). */
  watch?: boolean;
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
        if (typeof t === "string" && t.trim()) tags.add(t.trim().replace(/^#/, ""));
      }
    } catch {
      // frontmatter que não é YAML: fica como texto, sem tags
    }
  }
  const body = fm ? content.slice(fm[0].length) : content;
  for (const m of body.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)) tags.add(m[1]!);
  return [...tags];
}

function snippetAround(content: string, term: string): string {
  const { folded, map } = foldWithMap(content);
  const at = folded.indexOf(term);
  const start = at < 0 ? 0 : map[at]!;
  const from = Math.max(0, start - 60);
  const text = content.slice(from, start + 100).replace(/\s+/g, " ").trim();
  return `${from > 0 ? "…" : ""}${text}${start + 100 < content.length ? "…" : ""}`;
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
  private ready: Promise<void> | null = null;
  /** A resolução de [[links]] para as notas de agora; refeita quando uma nota entra, sai ou muda de nome. */
  private resolver: Resolver | null = null;
  /** Só para os testes: roda entre gravar o arquivo temporário e conferir a versão (uma edição de fora bem ali). */
  private beforeReplace?: () => void;

  constructor(o: VaultOptions) {
    this.root = o.root;
    this.trash = o.trash ?? macTrash;
    this.debounceMs = o.debounceMs ?? 150;
    this.watchOnOpen = o.watch ?? false;
  }

  /** Cria a pasta se não existe e monta o índice. Uma vez só. */
  open(): Promise<void> {
    this.ready ??= (async () => {
      await mkdir(this.root, { recursive: true });
      await this.scan();
      if (this.watchOnOpen) this.watch();
    })();
    return this.ready;
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
  }

  // ---------------------------------------------------------------- leitura

  list(): { folders: string[]; notes: NoteMeta[] } {
    return {
      folders: [...this.folders].sort((a, b) => a.localeCompare(b)),
      notes: [...this.notes.values()].map((e) => e.meta).sort((a, b) => a.path.localeCompare(b.path)),
    };
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
    const terms = fold(query).split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const hits: { e: Entry; score: number }[] = [];
    for (const e of this.notes.values()) {
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
    return hits
      .sort((a, b) => b.score - a.score || a.e.meta.path.localeCompare(b.e.meta.path))
      .slice(0, max)
      .map(({ e, score }) => ({ path: e.meta.path, title: e.meta.title, snippet: snippetAround(e.content, terms[0]!), score }));
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

  async create(folder: unknown, title: unknown, content: unknown = ""): Promise<Note> {
    const dir = folderPath(folder ?? "");
    if (typeof content !== "string" || content.length > 5_000_000) throw new VaultError("E_BAD_ARGS", "content must be a string up to 5 MB");
    const name = fileNameFor(title);
    for (let n = 1; n < 1000; n++) {
      const p = notePath(`${dir ? `${dir}/` : ""}${n === 1 ? name : `${name} ${n}`}.md`);
      if (this.notes.has(p) || (await exists(inside(this.root, p)))) continue;
      await mkdir(path.dirname(inside(this.root, p)), { recursive: true });
      const entry = await this.write(p, content, null); // null: só se o arquivo ainda não existe
      if (!entry) continue;
      return { ...entry.meta, content };
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

  /** Manda a nota para a Lixeira do macOS (não apaga). */
  async delete(input: unknown): Promise<true> {
    const p = notePath(input);
    const abs = inside(this.root, p);
    if (!(await exists(abs))) throw new VaultError("E_NOT_FOUND", `no note ${p}`);
    await this.trash(abs);
    this.notes.delete(p);
    this.resolver = null;
    this.emit([p]);
    return true;
  }

  // ---------------------------------------------------------------- interno

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
      meta: { path: p, title, folder, mtime: s.mtime.toISOString(), size: s.size, version: versionOf(content), tags: tagsOf(content) },
      folded: fold(content),
      foldedTitle: fold(title),
      links: parseLinks(content).map((l) => l.target),
      content,
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
