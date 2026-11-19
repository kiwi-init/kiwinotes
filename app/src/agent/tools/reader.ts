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
import { isEditableText } from "../../shared/file-view.ts";

/**
 * Um arquivo de texto (spec #13379, e o #21158 para todos): o agente lê e edita como a nota, junto do `.md`, todo tipo
 * que a pessoa já edita nas Notas (`EDITABLE_TEXT`: o `.txt`, o `.log`, o json, o yaml e o código). Entrou um tipo na
 * lista, o gato já edita. Ele aparece no `notes_list` com o formato e na busca, e se lê e escreve pelos arquivos do
 * cofre (`files.read` e `files.save`), não pelas notas.
 */
export const isTextFile = (path: string): boolean => isEditableText(path) && !isSecretFile(path);

/**
 * O arquivo de segredos por convenção (`.env`, `.env.teste`, `prod.env`): fica fora do Kiwi Cat inteiro (T21237). Ele
 * não lê, não lista, não acha na busca e não grava; a pessoa segue editando nas Notas. O guardrail só pega os formatos
 * que conhece, e uma senha qualquer num `.env` iria inteira ao modelo (ADR 0011).
 */
export const isSecretFile = (path: string): boolean => /^\.env(?:\..*)?$|\.env$/i.test(path.split("/").pop() ?? path);

/** O formato de um arquivo de texto, para o agente não tratar código como nota: "txt", "py", "json"… */
export const textFormat = (path: string): string => (/\.([a-z0-9]+)$/i.exec(path)?.[1] ?? "").toLowerCase();

/**
 * O que é só de Markdown (spec #21158): a seção (ler, trocar, mover, renomear, juntar), o sumário. Vale na nota e no
 * `.txt`, que o Kiwi já tratava como nota (spec #13379); num `.py` ou num `.json`, um `#` é comentário, não título.
 */
export const hasSections = (path: string): boolean => /\.(md|txt)$/i.test(path);

/** O título de um arquivo de texto: o `.txt` sem a extensão, como a nota; o código e os outros, com ela. */
export const textNoteTitle = (path: string) => (path.split("/").pop() ?? path).replace(/\.txt$/i, "");

/**
 * Os limites da busca nos `.txt` (spec #13379): quantos ela olha, o maior que ela lê, e quanto lê no total por busca
 * (revisão do #524: sem o total, 400 arquivos de 512 KB davam uns 200 MB por busca). Passado um limite, o resto casa
 * só pelo nome.
 */
export const TEXT_SEARCH_FILES = 400;
export const TEXT_SEARCH_MAX_BYTES = 512 * 1024;
export const TEXT_SEARCH_TOTAL_BYTES = 4 * 1024 * 1024;

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
 * `path:pasta` da busca vale aqui também. Olha no máximo `TEXT_SEARCH_FILES` arquivos e lê os de até
 * `TEXT_SEARCH_MAX_BYTES`, até `TEXT_SEARCH_TOTAL_BYTES` no total; o que passa disso só casa pelo nome.
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
  let budget = TEXT_SEARCH_TOTAL_BYTES;
  for (const f of files.filter((x) => isTextFile(x.path)).slice(0, TEXT_SEARCH_FILES)) {
    if (hits.length >= limit) break;
    const where = fold(f.path);
    if (inPath && !where.startsWith(`${inPath.replace(/\/+$/, "")}/`)) continue;
    let text = "";
    if (words.some((w) => !where.includes(w)) && f.size <= TEXT_SEARCH_MAX_BYTES && f.size <= budget) {
      budget -= f.size;
      text = (await read(f.path)) ?? "";
    }
    const all = `${where}\n${fold(text)}`;
    if (!words.every((w) => all.includes(w))) continue;
    hits.push({ path: f.path, title: textNoteTitle(f.path), snippet: text ? textSnippet(text, words) : "" });
  }
  return hits;
}

/**
 * A busca pelo nome nos arquivos que não são nota (spec #17587): um pdf, uma planilha ou um zip cujo caminho tem todas
 * as palavras do pedido, sem diferenciar maiúscula nem acento. O `path:pasta` vale aqui também. Não lê o arquivo: o
 * texto dele, o agente pede pelo `files_read`.
 */
export function searchFileNames(query: string, files: readonly VaultFile[], limit: number): VaultFile[] {
  const words = terms(query);
  const inPath = fold(query).match(/(?:^|\s)path:("[^"]+"|\S+)/)?.[1]?.replace(/^"|"$/g, "");
  if (!words.length || limit <= 0) return [];
  const out: VaultFile[] = [];
  for (const f of files) {
    if (out.length >= limit) break;
    if (isTextFile(f.path) || isSecretFile(f.path)) continue;
    const where = fold(f.path);
    if (inPath && !where.startsWith(`${inPath.replace(/\/+$/, "")}/`)) continue;
    if (words.every((w) => where.includes(w))) out.push(f);
  }
  return out;
}

export interface ReaderNoteMeta {
  path: string;
  title: string;
  folder: string;
  size: number;
  mtime: string;
}

/** Um arquivo de texto da lista dos arquivos como uma nota da lista (spec #13379). */
const textMeta = (f: VaultFile): ReaderNoteMeta => {
  const i = f.path.lastIndexOf("/");
  return { path: f.path, title: textNoteTitle(f.path), folder: i < 0 ? "" : f.path.slice(0, i), size: f.size, mtime: f.mtime };
};

export interface VaultReader {
  search(query: string, limit: number): Promise<ReaderHit[]>;
  /** `files` (spec #17587): os arquivos que não são nota (o pdf, a planilha, o zip, o que for), para o agente ver tudo. */
  list(): Promise<{ folders: string[]; notes: ReaderNoteMeta[]; files?: VaultFile[] }>;
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

/** O arquivo de texto lido como uma nota (spec #13379): o texto e a versão do `files.read`. */
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
      // Os arquivos de texto (spec #13379, #21158) completam a lista, depois das notas.
      const files = (await listed()).files ?? [];
      const text = async (path: string) => {
        const f = await call<FileContent>("files.read", { path, as: "text" }).catch(() => null);
        return f && "text" in f ? f.text : null;
      };
      return [...hits, ...(await searchTextNotes(query, files, text, limit - hits.length))];
    },
    list: async () => {
      const r = await listed();
      const files = (r.files ?? []).filter((f) => !isSecretFile(f.path));
      return { folders: r.folders, notes: [...r.notes, ...files.filter((f) => isTextFile(f.path)).map(textMeta)], files: files.filter((f) => !isTextFile(f.path)) };
    },
    get: async (path) => (isTextFile(path) ? textNote(await call<FileContent>("files.read", { path, as: "text" })) : call("notes.get", { path })),
    meetings: async () => (await call<{ meetings: MeetingNote[] }>("meetings.list", undefined)).meetings,
    projects: async () => (await call<{ projects: ProjectInfo[] }>("projects.list", undefined)).projects,
    projectStatus: (folder) => call("projects.status", { folder }),
    file: (path) => call("files.read", { path, as: "binary" }),
  };
}

/** Um cofre vazio: a prova de verdade abre a sessão com as ferramentas, e nenhuma nota da pessoa entra nela. */
export const EMPTY_READER: VaultReader = {
  search: async () => [],
  list: async () => ({ folders: [], notes: [], files: [] }),
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
