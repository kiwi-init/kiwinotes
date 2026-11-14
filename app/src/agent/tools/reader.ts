// O que as ferramentas do Kiwi leem (spec #7496): só leitura, pelas mesmas capacidades que as janelas usam. Assim o
// agente vê a pasta de notas aberta agora, com a busca pelo sentido e o texto dos anexos quando estão ligados, e passa
// pela mesma fronteira do cofre (sem `..`, sem link simbólico para fora: `E_OUTSIDE_VAULT`).
//
// Nada aqui escreve: o leitor só conhece sete capacidades de leitura (`notes.search`, `notes.list`, `notes.get`,
// `meetings.list`, `projects.list`, `projects.status` e `files.read`, spec #11549), e nenhuma outra passa por ele. Marcar ou desmarcar um projeto
// é da pessoa (spec #9874): o leitor não tem como.

import type { MeetingNote } from "../../shared/meetings.ts";
import type { ProjectInfo, ProjectStatus } from "../../notes/projects.ts";
import type { FileContent } from "../../notes/vault.ts";

export interface ReaderHit {
  path: string;
  title: string;
  snippet: string;
  approx?: boolean;
  semantic?: boolean;
}

export interface ReaderNoteMeta {
  path: string;
  title: string;
  folder: string;
  size: number;
  mtime: string;
}

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

/** As únicas capacidades que o leitor chama. */
export const READER_CAPABILITIES = ["notes.search", "notes.list", "notes.get", "meetings.list", "projects.list", "projects.status", "files.read"] as const;
type ReaderCapability = (typeof READER_CAPABILITIES)[number];

/** O leitor sobre as capacidades do app (as de `uiCapabilities`): só as sete de leitura. */
export function readerFromCapabilities(caps: Record<ReaderCapability, (args: unknown) => unknown>): VaultReader {
  const call = async <T>(cap: ReaderCapability, args: unknown): Promise<T> => (await caps[cap](args)) as T;
  return {
    search: (query, limit) => call("notes.search", { query, limit }),
    list: () => call("notes.list", undefined),
    get: (path) => call("notes.get", { path }),
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
