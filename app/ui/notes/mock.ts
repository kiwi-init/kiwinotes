// Um vault em memória com a mesma forma das capacidades `notes.*` do contrato 1.1.0, e a mesma regra de links do
// engine (src/shared/wikilinks.ts). Serve para o Vite no navegador e para os testes; nunca para o app de verdade
// (api.ts só usa fora do AppEngine, em dev). As notas são inventadas.

import { splitFrontmatter, tagsOf } from "./frontmatter.ts";
import { makeResolver, parseLinks as sharedLinks, resolveLink, rewriteLinks } from "../../src/shared/wikilinks.ts";
import { folderOf, noteName } from "./links.ts";
import type { Backlink, Note, NoteMeta, NotesApi, SaveResult, SearchHit, VaultListing } from "./types.ts";

interface Stored {
  content: string;
  version: number;
  mtime: string;
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR");

export class MockVault implements NotesApi {
  private notes = new Map<string, Stored>();
  private folders = new Set<string>();
  private listeners = new Set<(paths: string[]) => void>();
  private clock: () => Date;

  constructor(seed: Record<string, string> = SAMPLE, options: { folders?: string[]; now?: () => Date } = {}) {
    this.clock = options.now ?? (() => new Date());
    for (const f of options.folders ?? []) this.addFolder(f);
    for (const [path, content] of Object.entries(seed)) this.write(path, content);
  }

  private addFolder(folder: string) {
    for (let f = folder; f; f = folderOf(f)) this.folders.add(f);
  }

  private write(path: string, content: string): Stored {
    const old = this.notes.get(path);
    const stored = { content, version: (old?.version ?? 0) + 1, mtime: this.clock().toISOString() };
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
      folders: [...this.folders].sort((a, b) => a.localeCompare(b, "pt-BR")),
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
    this.write(path, content);
    this.emit([path]);
    return { saved: true, meta: this.meta(path) };
  }

  async create(title: string, folder = "", content = ""): Promise<Note> {
    const clean = title.replace(/[\\/:]/g, "-").trim() || "Sem título";
    const base = folder ? `${folder}/${clean}` : clean;
    let path = `${base}.md`;
    for (let n = 2; this.notes.has(path); n++) path = `${base} ${n}.md`;
    this.write(path, content);
    this.emit([path]);
    return this.note(path);
  }

  async rename(path: string, newPath: string): Promise<{ meta: NoteMeta; updatedLinks: number }> {
    const s = this.notes.get(path);
    if (!s) throw new Error(`E_NOT_FOUND: ${path}`);
    if (!newPath.endsWith(".md")) newPath += ".md";
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
    this.emit(changed);
    return { meta: this.meta(newPath), updatedLinks };
  }

  async delete(path: string): Promise<true> {
    if (!this.notes.delete(path)) throw new Error(`E_NOT_FOUND: ${path}`);
    this.emit([path]);
    return true;
  }

  async search(query: string, limit = 20): Promise<SearchHit[]> {
    const words = fold(query).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const hits: SearchHit[] = [];
    for (const [path, s] of this.notes) {
      const title = noteName(path);
      const ft = fold(title);
      const body = splitFrontmatter(s.content).body;
      const fb = fold(body);
      if (!words.every((w) => ft.includes(w) || fb.includes(w))) continue;
      const inTitle = words.filter((w) => ft.includes(w)).length;
      const score = (ft.startsWith(words[0]!) ? 4 : 0) + inTitle * 2;
      const at = Math.max(0, ...words.map((w) => fb.indexOf(w)).filter((i) => i >= 0).slice(0, 1));
      hits.push({ path, title, snippet: snippetAround(body, at), score });
    }
    hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, "pt-BR"));
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
