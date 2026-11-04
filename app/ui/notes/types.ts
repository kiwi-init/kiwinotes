// As capacidades `notes.*` do contrato (A1, T1316, src/shared/ui-contract.ts), do lado da janela Notas (T1317), mais as
// de pastas do contrato 1.7.0 (T2468): `folders.*`, `notes.move|duplicate|restore|reveal`, o `ctime` e o `pinned`.

import type { UiCapabilities } from "../../src/shared/ui-contract.ts";

export type { Backlink, Note, NoteMeta, SaveResult, SearchHit, TagNode } from "../../src/shared/ui-contract.ts";
import type { TagNode } from "../../src/shared/ui-contract.ts";
import type { Note, NoteMeta } from "../../src/shared/ui-contract.ts";

/**
 * As pastas e as notas do vault (`notes.list`). A UI pode rodar num engine mais velho (o `requiresContract` é ^1.0.0):
 * aí o `ctime` não vem, e a ordem por criação cai na edição (tree.ts).
 */
export interface VaultListing {
  folders: string[];
  notes: NoteMeta[];
}

type Result<C extends keyof UiCapabilities> = Promise<UiCapabilities[C]["result"]>;

/** As capacidades `notes.*` do contrato, como a janela chama. */
export interface NotesApi {
  list(): Promise<VaultListing>;
  get(path: string): Promise<Note>;
  /** Se a nota mudou fora (no Obsidian, por exemplo), não grava e devolve a versão do disco. */
  save(path: string, content: string, baseVersion: string): Result<"notes.save">;
  /** Título repetido vira "Título 2". */
  create(title: string, folder?: string, content?: string, template?: string): Promise<Note>;
  /** As tags em árvore (T2619). Num engine antes do 1.9.0, não existe. */
  tags?(): Promise<TagNode[]>;
  /** A pasta de modelos e as notas dela (T2619). Num engine antes do 1.9.0, não existe. */
  templates?(): Promise<{ folder: string; templates: NoteMeta[] }>;
  rename(path: string, newPath: string): Result<"notes.rename">;
  /** Com o T2468, vai antes para `<vault>/.kiwi-trash/` por 10 min (o "Desfazer", `restore`), e depois para a Lixeira. */
  delete(path: string): Result<"notes.delete">;
  search(query: string, limit?: number): Result<"notes.search">;
  backlinks(path: string): Result<"notes.backlinks">;
  /** `[[alvo]]` → o path da nota, ou `null` se ela não existe. A regra fica só no engine (#1335). */
  resolve(link: string): Result<"notes.resolve">;
  /** Uma nota foi criada, mudada, apagada ou renomeada, inclusive fora do app. Devolve a função que desliga. */
  onChanged(fn: (paths: string[]) => void): () => void;
  /** As de pastas (T2468). Num engine sem elas, a janela esconde o que depende delas (`has`). */
  folders?: FoldersApi;
  /**
   * As notas fixadas (T2469): ficam nas `AppSettings` (`pinned`, #2475), fora do frontmatter, para não mexer no arquivo
   * da pessoa por uma preferência da janela. O engine corrige os paths quando a nota muda de nome, de pasta ou some.
   */
  pins?: { list(): Promise<string[]>; set(paths: string[]): Promise<string[]> };
}

/** `moved`: quantas notas mudaram de path. */
export type FolderMoved = UiCapabilities["folders.rename"]["result"];

export interface FoldersApi {
  /** Cria a pasta (e os pais que faltarem). */
  create(path: string): Promise<{ path: string }>;
  /** As notas de dentro mudam de path, e os `[[Pasta/Nota]]` que apontavam para elas também. */
  rename(path: string, newPath: string): Promise<FolderMoved>;
  /** `parent` "" é a raiz. */
  move(path: string, parent: string): Promise<FolderMoved>;
  /** Com o que tiver dentro, como o `delete` da nota: dá para desfazer por 10 min. */
  delete(path: string): Promise<true>;
  moveNote(path: string, folder: string): Promise<{ meta: NoteMeta; updatedLinks: number }>;
  /** "Título 2", na mesma pasta. */
  duplicateNote(path: string): Promise<Note>;
  /** O "Desfazer" do apagar (nota ou pasta, nos últimos 10 min), pelo caminho original. `E_EXISTS` se o lugar foi ocupado. */
  restore(path: string): Promise<{ path: string }>;
  /** "Mostrar no Finder". */
  reveal(path: string): Promise<true>;
}
