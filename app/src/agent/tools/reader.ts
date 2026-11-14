// O que as ferramentas do Kiwi leem (spec #7496): só leitura, pelas mesmas capacidades que as janelas usam. Assim o
// agente vê a pasta de notas aberta agora, com a busca pelo sentido e o texto dos anexos quando estão ligados, e passa
// pela mesma fronteira do cofre (sem `..`, sem link simbólico para fora: `E_OUTSIDE_VAULT`).
//
// Nada aqui escreve: o leitor só conhece sete capacidades de leitura (`notes.search`, `notes.list`, `notes.get`,
// `meetings.list`, `projects.list`, `projects.status` e `files.read`, spec #11549), e nenhuma outra passa por ele. Marcar ou desmarcar um projeto
// é da pessoa (spec #9874): o leitor não tem como.

import type { MeetingNote } from "../../shared/meetings.ts";
import type { ProjectInfo, ProjectStatus } from "../../notes/projects.ts";
import type { FileContent, VaultFile } from "../../notes/vault.ts";

/**
 * Uma nota de texto puro (spec #13379): o agente trata o `.txt` como nota, junto do `.md`. Ela aparece no `notes_list`
 * e na busca, e se lê e escreve pelos arquivos do cofre (`files.read` e `files.save`), não pelas notas.
 */
export const isTextNote = (path: string) => /\.txt$/i.test(path);

/** O título de um `.txt`: o nome sem a extensão. */
export const textNoteTitle = (path: string) => (path.split("/").pop() ?? path).replace(/\.txt$/i, "");

/** Quantos `.txt` a busca abre, no máximo, e o maior que ela lê (os maiores entram só pelo nome). */
export const TEXT_SEARCH_FILES = 400;
export const TEXT_SEARCH_MAX_BYTES = 512 * 1024;

export interface ReaderHit {
  path: string;
  title: string;
  snippet: string;
  approx?: boolean;
  semantic?: boolean;
}

const fold = (t: string) => t.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
const terms = (q: string) =>
  [...new Set(fold(q).split(/\s+/).filter((w) => w && !/^-|^(tag|path):/.test(w)).map((w) => w.replace(/^"|"$/g, "")).filter((w) => w.length >= 2))];

/** Um trecho em volta da 1ª palavra achada (ou o começo). */
function textSnippet(text: string, words: string[]): string {
  const f = fold(text);
  const at = words.map((w) => f.indexOf(w)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, at - 80);
  const end = Math.min(text.length, at + 160);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
}

/**
 * A busca nos `.txt` (spec #13379): todas as palavras no caminho ou no texto, sem diferenciar maiúscula nem acento. O
 * `path:pasta` da busca vale aqui também. Lê no máximo `TEXT_SEARCH_FILES` arquivos, de até `TEXT_SEARCH_MAX_BYTES`; um
 * maior só casa pelo nome.
 */
export async function searchTextNotes(
  query: string,
  files: readonly VaultFile[],
  read: (path: string) => Promise<string | null>,
  limit: number,
): Promise<ReaderHit[]> {
  const words = terms(query);
  const inPath = fold(query).match(/(?:^|\s)path:("[^"]+"|\S+)/)?.[1]?.replace(/^"|"$/g, "");
  if (!words.length && !inPath) return [];
  const hits: ReaderHit[] = [];
  for (const f of files.filter((x) => isTextNote(x.path)).slice(0, TEXT_SEARCH_FILES)) {
    if (hits.length >= limit) break;
    const where = fold(f.path);
    if (inPath && !where.startsWith(`${inPath.replace(/\/+$/, "")}/`)) continue;
    let text = "";
    if (words.some((w) => !where.includes(w)) && f.size <= TEXT_SEARCH_MAX_BYTES) text = (await read(f.path)) ?? "";
    const all = `${where}\n${fold(text)}`;
    if (!words.every((w) => all.includes(w))) continue;
    hits.push({ path: f.path, title: textNoteTitle(f.path), snippet: text ? textSnippet(text, words) : "" });
  }
  return hits;
}

export interface ReaderNoteMeta {
  path: string;
  title: string;
  folder: string;
  size: number;
  mtime: string;
}

/** Um `.txt` da lista dos arquivos como uma nota da lista (spec #13379). */
const textMeta = (f: VaultFile): ReaderNoteMeta => {
  const i = f.path.lastIndexOf("/");
  return { path: f.path, title: textNoteTitle(f.path), folder: i < 0 ? "" : f.path.slice(0, i), size: f.size, mtime: f.mtime };
};

export interface VaultReader {
  search(query: string, limit: number): Promise<ReaderHit[]>;
  list(): Promise<{ folders: string[]; notes: ReaderNoteMeta[] }>;
  /** `version` (spec #8356): a versão da nota, que o `notes_write` pede para mudar o texto. */
  get(path: string): Promise<{ path: string; title: string; mtime: string; content: string; version?: string }>;
  meetings(): Promise<MeetingNote[]>;
  /** Os projetos (spec #9874). */
  projects(): Promise<ProjectInfo[]>;
  /** O estado de um projeto, só contado. */
  projectStatus(folder: string): Promise<ProjectStatus>;
  /** Um arquivo do cofre que não é nota (spec #11549), em binário; acima do limite, só o tamanho (`tooLarge`). */
  file(path: string): Promise<FileContent>;
}

/** O `.txt` lido como uma nota (spec #13379): o texto e a versão do `files.read`. */
export function textNote(f: FileContent): { path: string; title: string; mtime: string; content: string; version: string; readOnly?: true } {
  if ("tooLarge" in f) throw Object.assign(new Error(`${f.path} tem ${Math.round(f.size / 1024 / 1024)} MB: grande demais para ler como nota`), { code: "E_TOO_LARGE" });
  if (!("text" in f)) throw Object.assign(new Error(`não deu para ler ${f.path} como texto`), { code: "E_FAILED" });
  return { path: f.path, title: textNoteTitle(f.path), mtime: "", content: f.text, version: f.version, ...(f.readOnly ? { readOnly: true as const } : {}) };
}

/** As únicas capacidades que o leitor chama. */
export const READER_CAPABILITIES = ["notes.search", "notes.list", "notes.get", "meetings.list", "projects.list", "projects.status", "files.read"] as const;
type ReaderCapability = (typeof READER_CAPABILITIES)[number];

/** O leitor sobre as capacidades do app (as de `uiCapabilities`): só as sete de leitura. */
export function readerFromCapabilities(caps: Record<ReaderCapability, (args: unknown) => unknown>): VaultReader {
  const call = async <T>(cap: ReaderCapability, args: unknown): Promise<T> => (await caps[cap](args)) as T;
  const listed = () => call<{ folders: string[]; notes: ReaderNoteMeta[]; files?: VaultFile[] }>("notes.list", undefined);
  return {
    search: async (query, limit) => {
      const hits = await call<ReaderHit[]>("notes.search", { query, limit });
      if (hits.length >= limit) return hits;
      // Os `.txt` (spec #13379) completam a lista, depois das notas.
      const files = (await listed()).files ?? [];
      const text = async (path: string) => {
        const f = await call<FileContent>("files.read", { path, as: "text" }).catch(() => null);
        return f && "text" in f ? f.text : null;
      };
      return [...hits, ...(await searchTextNotes(query, files, text, limit - hits.length))];
    },
    list: async () => {
      const r = await listed();
      return { folders: r.folders, notes: [...r.notes, ...(r.files ?? []).filter((f) => isTextNote(f.path)).map(textMeta)] };
    },
    get: async (path) => (isTextNote(path) ? textNote(await call<FileContent>("files.read", { path, as: "text" })) : call("notes.get", { path })),
    meetings: async () => (await call<{ meetings: MeetingNote[] }>("meetings.list", undefined)).meetings,
    projects: async () => (await call<{ projects: ProjectInfo[] }>("projects.list", undefined)).projects,
    projectStatus: (folder) => call("projects.status", { folder }),
    file: (path) => call("files.read", { path, as: "binary" }),
  };
}

/** Um cofre vazio: a prova de verdade abre a sessão com as ferramentas, e nenhuma nota da pessoa entra nela. */
export const EMPTY_READER: VaultReader = {
  search: async () => [],
  list: async () => ({ folders: [], notes: [] }),
  get: async (path) => {
    throw Object.assign(new Error(`no note ${path}`), { code: "E_NOT_FOUND" });
  },
  meetings: async () => [],
  projects: async () => [],
  projectStatus: async (folder) => {
    throw Object.assign(new Error(`${folder} não é um projeto`), { code: "E_NOT_FOUND" });
  },
  file: async (path) => {
    throw Object.assign(new Error(`no file ${path}`), { code: "E_NOT_FOUND" });
  },
};
