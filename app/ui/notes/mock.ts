// Um vault em memória com a mesma forma das capacidades `notes.*` do contrato 1.1.0, e a mesma regra de links do
// engine (src/shared/wikilinks.ts). Serve para o Vite no navegador e para os testes; nunca para o app de verdade
// (api.ts só usa fora do AppEngine, em dev). As notas são inventadas.

import { approxWord, wordsOf } from "../../src/shared/fuzzy.ts";
import { splitFrontmatter, tagsOf } from "./frontmatter.ts";
import { linkSafeName, makeResolver, parseLinks as sharedLinks, resolveLink, rewriteLinks } from "../../src/shared/wikilinks.ts";
import { folderOf, noteName } from "./links.ts";
import { hasTag, splitTagQuery, tagTree } from "../../src/shared/tags.ts";
import { type SavedSearch, sanitizeSavedSearches } from "../../src/shared/query.ts";
import { DEFAULT_TEMPLATES_FOLDER, fillTemplate } from "../../src/shared/templates.ts";
import type { TagNode } from "./types.ts";
import { linkSpans, unlinkedSpans, contextOf } from "../../src/notes/mentions.ts";
import type { VersionsApi } from "./types.ts";
import type { Backlink, ExtrasApi, FolderMoved, FoldersApi, Note, NoteMeta, NotesApi, SaveResult, SearchHit, TrashItem, VaultListing } from "./types.ts";

interface Stored {
  content: string;
  version: number;
  mtime: string;
  ctime: string;
}

/** O que foi para o `.kiwi-trash` de mentira, pelo caminho original: as notas e as pastas, para o `restore` (T2469). */
interface InTrash {
  notes: Map<string, Stored>;
  dirs: string[];
  /** Quando foi apagado (a Lixeira do T2593). */
  at?: string;
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR");

export class MockVault implements NotesApi {
  private notes = new Map<string, Stored>();
  private dirs = new Set<string>();
  private listeners = new Set<(paths: string[]) => void>();
  private trash = new Map<string, InTrash>();
  /** O último "Mostrar no Finder" (para os testes). */
  revealed: string | null = null;
  private clock: () => Date;

  constructor(seed: Record<string, string> = SAMPLE, options: { folders?: string[]; now?: () => Date } = {}) {
    this.clock = options.now ?? (() => new Date());
    for (const f of options.folders ?? []) this.addFolder(f);
    for (const [path, content] of Object.entries(seed)) this.write(path, content);
  }

  private addFolder(folder: string) {
    for (let f = folder; f; f = folderOf(f)) this.dirs.add(f);
  }

  private write(path: string, content: string): Stored {
    const old = this.notes.get(path);
    const now = this.clock().toISOString();
    const stored = { content, version: (old?.version ?? 0) + 1, mtime: now, ctime: old?.ctime ?? now };
    this.notes.set(path, stored);
    this.addFolder(folderOf(path));
    return stored;
  }

  private note(path: string): Note {
    const s = this.notes.get(path);
    if (!s) throw new Error(`E_NOT_FOUND: ${path}`);
    return {
      path,
      title: noteName(path),
      folder: folderOf(path),
      mtime: s.mtime,
      ctime: s.ctime,
      size: new TextEncoder().encode(s.content).length,
      version: String(s.version),
      tags: tagsOf(s.content),
      content: s.content,
    };
  }

  private meta(path: string): NoteMeta {
    const { content: _c, ...meta } = this.note(path);
    return meta;
  }

  private emit(paths: string[]) {
    for (const fn of this.listeners) fn(paths);
  }

  /** Simula uma edição feita fora do app (no Obsidian): muda a versão e avisa como o watcher do A1 avisaria. */
  editOutside(path: string, content: string): void {
    this.write(path, content);
    this.emit([path]);
  }

  async list(): Promise<VaultListing> {
    return {
      folders: [...this.dirs].sort((a, b) => a.localeCompare(b, "pt-BR")),
      notes: [...this.notes.keys()].map((p) => this.meta(p)),
    };
  }

  async get(path: string): Promise<Note> {
    return this.note(path);
  }

  async save(path: string, content: string, baseVersion: string): Promise<SaveResult> {
    const s = this.notes.get(path);
    if (!s) throw new Error(`E_NOT_FOUND: ${path}`);
    if (String(s.version) !== baseVersion) return { saved: false, current: this.note(path) };
    // O histórico de versões de mentira (T2680): o texto de antes na 1ª vez, e cada save (sem o intervalo de 2 min).
    const h = this.versionsOf.get(path) ?? [];
    if (!h.length && s.content !== content) h.push(this.version(s.content));
    if (h.at(-1)?.content !== content) h.push(this.version(content));
    this.versionsOf.set(path, h);
    this.write(path, content);
    this.emit([path]);
    return { saved: true, meta: this.meta(path) };
  }

  async create(title: string, folder = "", content = "", template?: string): Promise<Note> {
    const clean = title.replace(/[\\/:]/g, "-").trim() || "Sem título";
    const base = folder ? `${folder}/${clean}` : clean;
    let path = `${base}.md`;
    for (let n = 2; this.notes.has(path); n++) path = `${base} ${n}.md`;
    if (template && content) throw new Error("E_BAD_ARGS: content e template juntos");
    const text = template ? fillTemplate(this.note(template).content, { title: noteName(path), now: this.clock() }) : content;
    this.write(path, text);
    this.emit([path]);
    return this.note(path);
  }

  async rename(path: string, newPath: string): Promise<{ meta: NoteMeta; updatedLinks: number }> {
    const s = this.notes.get(path);
    if (!s) throw new Error(`E_NOT_FOUND: ${path}`);
    if (!newPath.endsWith(".md")) newPath += ".md";
    // Como o engine (T7520): o nome novo sai sem `# ^ | [ ]`; mover de pasta não troca o nome.
    if (noteName(newPath) !== noteName(path)) {
      const safe = linkSafeName(noteName(newPath));
      if (!safe) throw new Error("E_BAD_ARGS: the new name is empty");
      newPath = `${folderOf(newPath) ? `${folderOf(newPath)}/` : ""}${safe}.md`;
    }
    if (newPath !== path && this.notes.has(newPath)) throw new Error(`E_EXISTS: ${newPath}`);
    const before = [...this.notes.keys()];
    const after = before.map((p) => (p === path ? newPath : p));
    let updatedLinks = 0;
    const changed = [path, newPath];
    for (const p of before) {
      if (p === path) continue;
      const r = rewriteLinks(this.notes.get(p)!.content, path, newPath, before, after);
      if (r.count) {
        updatedLinks += r.count;
        this.write(p, r.content);
        changed.push(p);
      }
    }
    this.notes.delete(path);
    this.notes.set(newPath, { ...s, version: s.version + 1, mtime: this.clock().toISOString() });
    this.addFolder(folderOf(newPath));
    this.repin((p) => (p === path ? newPath : p));
    this.emit(changed);
    return { meta: this.meta(newPath), updatedLinks };
  }

  async delete(path: string): Promise<true> {
    const s = this.notes.get(path);
    if (!s) throw new Error(`E_NOT_FOUND: ${path}`);
    this.notes.delete(path);
    this.trash.set(path, { notes: new Map([[path, s]]), dirs: [], at: this.clock().toISOString() });
    this.unpin((p) => p === path);
    this.emit([path]);
    return true;
  }

  /** Como o engine (#2493): as fixadas seguem a nota que mudou de path e saem quando ela some. */
  private repin(swap: (p: string) => string) {
    this.pinned = this.pinned.map(swap);
  }
  private unpin(gone: (p: string) => boolean) {
    this.pinned = this.pinned.filter((p) => !gone(p));
  }

  /** Muda o path de várias notas de uma vez (renomear ou mover uma pasta), reescrevendo os [[links]] de quem cita. */
  private movePaths(moves: [string, string][]): number {
    let updated = 0;
    for (const [from, to] of moves) {
      const before = [...this.notes.keys()];
      const after = before.map((p) => (p === from ? to : p));
      for (const p of before) {
        if (p === from) continue;
        const r = rewriteLinks(this.notes.get(p)!.content, from, to, before, after);
        if (r.count) {
          updated += r.count;
          this.write(p, r.content);
        }
      }
      const s = this.notes.get(from)!;
      this.notes.delete(from);
      this.notes.set(to, { ...s, version: s.version + 1 });
      this.addFolder(folderOf(to));
      this.repin((p) => (p === from ? to : p));
    }
    return updated;
  }

  /** As tags em árvore (T2619). */
  async tags(): Promise<TagNode[]> {
    return tagTree([...this.notes.values()].map((s) => tagsOf(s.content)));
  }

  /** A pasta de modelos (T2619). */
  templatesFolder = DEFAULT_TEMPLATES_FOLDER;
  async templates(): Promise<{ folder: string; templates: NoteMeta[] }> {
    const folder = this.templatesFolder;
    const templates = [...this.notes.keys()].filter((p) => folderOf(p) === folder).sort().map((p) => this.meta(p));
    return { folder, templates };
  }

  private saved: SavedSearch[] = [];
  /** As buscas salvas (T2660), como nas settings. */
  readonly savedSearches = {
    list: async () => this.saved,
    set: async (list: SavedSearch[]) => (this.saved = sanitizeSavedSearches(list)),
  };

  private pinned: string[] = [];
  /** As fixadas (nas settings, #2475). Como o engine, o mock tira o que não existe mais. */
  readonly pins = {
    list: async () => (this.pinned = this.pinned.filter((p) => this.notes.has(p))),
    set: async (paths: string[]) => (this.pinned = [...new Set(paths)].filter((p) => this.notes.has(p))),
  };

  /** As de pastas (T2468), na forma de #2475. */
  readonly folders: FoldersApi = {
    create: async (path) => {
      const clean = path.replace(/^\/+|\/+$/g, "");
      if (!clean || clean.split("/").some((p) => !p || p.startsWith(".") || p === "..")) throw new Error("E_BAD_ARGS");
      if (this.dirs.has(clean)) throw new Error(`E_EXISTS: ${clean}`);
      this.addFolder(clean);
      this.emit([clean]);
      return { path: clean };
    },
    rename: async (path, newPath) => this.moveFolder(path, newPath),
    move: async (path, parent) => {
      const name = path.slice(path.lastIndexOf("/") + 1);
      return this.moveFolder(path, parent ? `${parent}/${name}` : name);
    },
    delete: async (path) => {
      if (!this.dirs.has(path)) throw new Error(`E_NOT_FOUND: ${path}`);
      const inside = (p: string) => p === path || p.startsWith(`${path}/`);
      const notes = new Map([...this.notes].filter(([p]) => inside(folderOf(p))));
      const dirs = [...this.dirs].filter(inside);
      for (const p of notes.keys()) this.notes.delete(p);
      for (const d of dirs) this.dirs.delete(d);
      this.trash.set(path, { notes, dirs, at: this.clock().toISOString() });
      this.unpin((p) => notes.has(p));
      this.emit([path, ...notes.keys()]);
      return true as const;
    },
    moveNote: async (path, folder) => {
      const name = path.slice(path.lastIndexOf("/") + 1);
      return this.rename(path, folder ? `${folder}/${name}` : name);
    },
    duplicateNote: async (path) => {
      const n = this.note(path);
      return this.create(n.title, n.folder, n.content);
    },
    restore: async (path) => {
      const t = this.trash.get(path);
      if (!t) throw new Error(`E_NOT_FOUND: ${path}`);
      for (const p of t.notes.keys()) if (this.notes.has(p)) throw new Error(`E_EXISTS: ${p}`);
      for (const d of t.dirs) this.dirs.add(d);
      for (const [p, s] of t.notes) {
        this.notes.set(p, s);
        this.addFolder(folderOf(p));
      }
      this.trash.delete(path);
      this.emit([path, ...t.notes.keys()]);
      return { path };
    },
    reveal: async (path) => {
      if (!this.notes.has(path) && !this.dirs.has(path)) throw new Error(`E_NOT_FOUND: ${path}`);
      this.revealed = path;
      return true as const;
    },
  };

  private async moveFolder(path: string, newPath: string): Promise<FolderMoved> {
    if (!this.dirs.has(path)) throw new Error(`E_NOT_FOUND: ${path}`);
    if (newPath === path) return { path, moved: 0, updatedLinks: 0 };
    if (newPath.startsWith(`${path}/`)) throw new Error("E_BAD_ARGS: para dentro de si mesma");
    if (this.dirs.has(newPath)) throw new Error(`E_EXISTS: ${newPath}`);
    const inside = (p: string) => p === path || p.startsWith(`${path}/`);
    const swap = (p: string) => newPath + p.slice(path.length);
    const moves = [...this.notes.keys()].filter((p) => inside(folderOf(p))).map((p): [string, string] => [p, swap(p)]);
    const dirs = [...this.dirs].filter(inside);
    for (const d of dirs) this.dirs.delete(d);
    for (const d of dirs) this.addFolder(swap(d));
    const updatedLinks = this.movePaths(moves);
    this.emit([path, newPath, ...moves.flat()]);
    return { path: newPath, moved: moves.length, updatedLinks };
  }

  async search(query: string, limit = 20): Promise<SearchHit[]> {
    // `tag:x` e `#x` filtram pelas tags, como no engine (T2619).
    const { tags, text } = splitTagQuery(query);
    const words = fold(text).split(/\s+/).filter(Boolean);
    if (!words.length && !tags.length) return [];
    const hits: SearchHit[] = [];
    for (const [path, s] of this.notes) {
      if (tags.length && !tags.every((t) => hasTag(tagsOf(s.content), t))) continue;
      if (!words.length) {
        hits.push({ path, title: noteName(path), snippet: snippetAround(splitFrontmatter(s.content).body, 0), score: Date.parse(s.mtime) / 1e12 });
        continue;
      }
      const title = noteName(path);
      const ft = fold(title);
      const body = splitFrontmatter(s.content).body;
      const fb = fold(body);
      // Como no engine (T2966): sem o exato, a palavra de 4 letras ou mais aceita erro de digitação.
      const bodyWords = wordsOf(`${ft} ${fb}`);
      const near = words.map((w) => (ft.includes(w) || fb.includes(w) ? w : approxWord(w, bodyWords)));
      if (near.some((w) => w === null)) continue;
      const approx = near.some((w, i) => w !== words[i]);
      const inTitle = words.filter((w) => ft.includes(w)).length;
      const score = (ft.startsWith(words[0]!) ? 4 : 0) + inTitle * 2;
      const at = Math.max(0, ...near.map((w) => fb.indexOf(w!)).filter((i) => i >= 0).slice(0, 1));
      hits.push({ path, title, snippet: snippetAround(body, at), score, ...(approx ? { approx: true } : {}) });
    }
    hits.sort((a, b) => Number(!!a.approx) - Number(!!b.approx) || b.score - a.score || a.title.localeCompare(b.title, "pt-BR"));
    return hits.slice(0, limit);
  }

  async backlinks(path: string): Promise<Backlink[]> {
    const resolve = makeResolver([...this.notes.keys()]);
    const out: Backlink[] = [];
    for (const [p, s] of this.notes) {
      if (p === path) continue;
      const line = s.content.split("\n").find((l) => sharedLinks(l).some((k) => resolve(k.target) === path));
      if (line !== undefined) out.push({ path: p, title: noteName(p), context: line.trim() });
    }
    return out.sort((a, b) => a.title.localeCompare(b.title, "pt-BR"));
  }

  private versionsOf = new Map<string, { id: string; at: string; content: string }[]>();
  private versionSeq = 0;
  private version(content: string) {
    const at = new Date(this.clock().getTime() + this.versionSeq++).toISOString();
    return { id: at.replace(/[:.]/g, "-"), at, content };
  }

  /** O histórico de versões (T2680), como o engine. */
  /** O exportar de mentira (T2684): não grava nada, só diz onde gravaria. */
  readonly exported: { path: string; format: string }[] = [];
  async export(path: string, format: "md" | "html" | "pdf"): Promise<{ file: string }> {
    this.note(path);
    this.exported.push({ path, format });
    return { file: `/Users/voce/Documents/${noteName(path)}.${format}` };
  }

  readonly versions: VersionsApi = {
    list: async (path) => [...(this.versionsOf.get(path) ?? [])].reverse().map((v) => ({ id: v.id, at: v.at, size: v.content.length })),
    get: async (path, id) => {
      const v = this.versionsOf.get(path)?.find((x) => x.id === id);
      if (!v) throw new Error(`E_NOT_FOUND: ${id}`);
      return { content: v.content, at: v.at };
    },
    restore: async (path, id) => {
      const v = await this.versions.get(path, id);
      return this.save(path, v.content, String(this.notes.get(path)?.version ?? ""));
    },
  };

  /** O que já foi para o Lixo do macOS de mentira (o `trash.empty`), e se o Lixo foi aberto no Finder (T2593). */
  private emptied: TrashItem[] = [];
  revealedTrash = false;

  /** A nota do dia, o link que cria, as menções e a Lixeira (T2593), como o engine (contrato 1.8.0). */
  readonly extras: ExtrasApi = {
    daily: async (date) => {
      const d = date ?? this.clock().toISOString().slice(0, 10);
      const path = `Diário/${d}.md`;
      if (!this.notes.has(path)) {
        this.write(path, "");
        this.emit([path]);
      }
      return this.note(path);
    },
    createFromLink: async (link, from) => {
      const target = link.replace(/^!?\[\[|\]\]$/g, "").split(/[|#]/)[0]!.trim();
      const found = resolveLink(target, [...this.notes.keys()]);
      if (found) return this.note(found);
      const parts = target.split("/");
      const name = parts.pop()!;
      const folder = parts.length ? parts.join("/") : from ? folderOf(from) : "";
      const path = `${folder ? `${folder}/` : ""}${name}.md`;
      this.write(path, "");
      this.emit([path]);
      return this.note(path);
    },
    unlinkedMentions: async (path) => {
      const title = noteName(path);
      return [...this.notes]
        .filter(([p]) => p !== path)
        .flatMap(([p, st]) => {
          const spans = unlinkedSpans(st.content, title);
          return spans.length ? [{ path: p, title: noteName(p), context: contextOf(st.content, spans[0]!) }] : [];
        });
    },
    linkMentions: async (path, target) => {
      const st = this.notes.get(path);
      if (!st) throw new Error(`E_NOT_FOUND: ${path}`);
      const spans = unlinkedSpans(st.content, noteName(target));
      if (spans.length) {
        this.write(path, linkSpans(st.content, spans, noteName(target)));
        this.emit([path]);
      }
      return { meta: this.meta(path), count: spans.length };
    },
    trashList: async () => {
      const kiwi: TrashItem[] = [...this.trash].map(([p, t]) => {
        const at = t.at ?? this.clock().toISOString();
        return { path: p, kind: t.dirs.length ? "folder" : "note", deletedAt: at, where: "kiwi", until: new Date(Date.parse(at) + 600_000).toISOString() };
      });
      return [...kiwi, ...this.emptied].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
    },
    trashEmpty: async () => {
      const items = await this.extras.trashList();
      const n = this.trash.size;
      this.emptied = items.map(({ until: _until, ...i }) => ({ ...i, where: "macos" as const }));
      this.trash.clear();
      return n;
    },
    trashReveal: async () => {
      this.revealedTrash = true;
      return true as const;
    },
  };

  async resolve(link: string): Promise<string | null> {
    return resolveLink(link, [...this.notes.keys()]);
  }

  onChanged(fn: (paths: string[]) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

/** ~140 caracteres em volta da posição, cortando em espaço e sem marcação de Markdown no começo da linha. */
export function snippetAround(text: string, at: number): string {
  const flat = text.replace(/^\s*(?:#+|[-*]\s+\[[ x]\]|[-*]|\d+\.)\s+/gm, "").replace(/\s+/g, " ").trim();
  const ratio = text.length ? at / text.length : 0;
  const center = Math.round(flat.length * ratio);
  let start = Math.max(0, center - 50);
  let end = Math.min(flat.length, start + 140);
  if (start > 0) start = flat.indexOf(" ", start) + 1 || start;
  if (end < flat.length) end = flat.lastIndexOf(" ", end) > start ? flat.lastIndexOf(" ", end) : end;
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}

/** O vault de exemplo do Vite no navegador. Inventado. */
export const SAMPLE: Record<string, string> = {
  "Caixa de entrada.md": "Ideias soltas e ditados que ainda não têm lugar.\n\n- Ver o orçamento da [[Mudança de escritório]]\n- Ligar para a [[Ana]] sobre o contrato\n",
  "Projetos/Mudança de escritório.md":
    "---\ntags: [projeto]\n---\nLevar o time para o novo andar sem parar o atendimento. A ordem foi combinada na [[2026-11-02 Planejamento|reunião de planejamento]].\n\n## Próximos passos\n\n- [x] Medir as salas\n- [ ] Pedir o orçamento da mudança\n- [ ] Marcar o fim de semana da mudança\n\n## Custos\n\n| Item | Fornecedor | Valor |\n| --- | --- | --- |\n| Mudança | Leva e Traz | 4.200 |\n| Rede | Fio Certo | 1.800 |\n| Móveis | Casa Nova | 9.500 |\n",
  "Projetos/Site novo.md": "---\ntags: [projeto]\n---\nRefazer o site com as fotos novas. Quem cuida do texto é a [[Ana]].\n\n```\nnpm run build\n```\n",
  "Reuniões/2026-11-02 Planejamento.md":
    "Com a [[Ana]] e o Bruno.\n\n## Decisões\n\n- Começar pela [[Mudança de escritório]] e deixar o [[Site novo]] para dezembro.\n- O orçamento passa por mim antes de fechar.\n",
  "Pessoas/Ana.md": "Cuida do financeiro e do texto do site.\n\n#pessoa\n",
  "Diário/2026-11-03.md": "Ditei a lista de compras e ela já entrou na [[Caixa de entrada]].\n",
};
