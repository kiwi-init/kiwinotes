// As capacidades `notes.*` do contrato 1.1.0 (A1, T1316, src/shared/ui-contract.ts), do lado da janela Notas (T1317).

import type { UiCapabilities } from "../../src/shared/ui-contract.ts";

export type { Backlink, Note, NoteMeta, SaveResult, SearchHit } from "../../src/shared/ui-contract.ts";

/** As pastas e as notas do vault (`notes.list`). */
export type VaultListing = UiCapabilities["notes.list"]["result"];

type Result<C extends keyof UiCapabilities> = Promise<UiCapabilities[C]["result"]>;

/** As capacidades `notes.*` do contrato, como a janela chama. */
export interface NotesApi {
  list(): Result<"notes.list">;
  get(path: string): Result<"notes.get">;
  /** Se a nota mudou fora (no Obsidian, por exemplo), não grava e devolve a versão do disco. */
  save(path: string, content: string, baseVersion: string): Result<"notes.save">;
  /** Título repetido vira "Título 2". */
  create(title: string, folder?: string, content?: string): Result<"notes.create">;
  rename(path: string, newPath: string): Result<"notes.rename">;
  /** Vai para a Lixeira do macOS. */
  delete(path: string): Result<"notes.delete">;
  search(query: string, limit?: number): Result<"notes.search">;
  backlinks(path: string): Result<"notes.backlinks">;
  /** `[[alvo]]` → o path da nota, ou `null` se ela não existe. A regra fica só no engine (#1335). */
  resolve(link: string): Result<"notes.resolve">;
  /** Uma nota foi criada, mudada, apagada ou renomeada, inclusive fora do app. Devolve a função que desliga. */
  onChanged(fn: (paths: string[]) => void): () => void;
}
