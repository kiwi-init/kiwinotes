// O que as ferramentas de escrita do Kiwi gravam (spec #8356): pelas mesmas capacidades que a janela das Notas usa,
// na pasta de notas aberta agora e com a mesma fronteira do cofre (só `.md`, sem `..`, sem link simbólico para fora).
//
// - **A gravação é condicional:** o `notes.save` só escreve se a nota ainda está na versão lida; senão devolve a de
//   agora, sem escrever. É o mesmo salvar das Notas, então o texto novo entra no histórico de versões.
// - **A cópia de antes nas Versões:** o `notes.save` vai com `snapshot: true`, e o texto de antes vira uma versão na
//   hora, sem o intervalo de 2 minutos do histórico.
// - **Nada apaga, renomeia nem move:** o escritor só conhece nove capacidades (`notes.get`, `notes.save`,
//   `notes.create`, `notes.folder`, `files.create`, o arquivo novo do spec #11549, `files.read` e `files.save`, os
//   textos do spec #13379, e `notes.canvasGet` e `notes.canvasSave`, o quadro do T22217), e nenhuma outra passa por ele.
// - **O `.txt` e os outros textos (spec #13379, #21158):** o log, o json, o yaml e o código (`EDITABLE_TEXT`) se leem e
//   gravam como texto, com a mesma conferência da versão (`files.save` com `baseVersion`). Desde o T21239 (spec #21160)
//   eles têm as Versões como a nota: o `files.save` vai com `snapshot: true`, e o texto de antes vira uma versão na hora.
//   A cópia de antes também fica no registro do agente, e o [Desfazer] volta. A planilha (`saveBytes`) também.
// - **O quadro branco (T22217):** o `.canvas` se lê e grava como texto (o JSON do arquivo), pelo `notes.canvasGet` e o
//   `notes.canvasSave`, com a mesma conferência da versão. O save só aceita um JSON Canvas que abre, e a janela do
//   quadro aberto recarrega com a mudança. Como nos textos, a cópia de antes fica no registro do agente, e o [Desfazer] volta.

import type { CanvasFile, CanvasSaveResult, FileContent, FileSaveResult } from "../../notes/vault.ts";
import type { EditingCell } from "../sheet-editing.ts";
import type { SheetOp } from "../../shared/sheet/ops.ts";
import type { DocxOp } from "../../shared/docx/ops.ts";
import { canvasNote, isCanvasFile, isTextFile, textNote } from "./reader.ts";

/** A nota que o escritor lê antes de mudar. */
export interface WriterNote {
  path: string;
  title: string;
  content: string;
  version: string;
  /** A nota não é UTF-8: o Kiwi só mostra, e nada grava por cima. */
  readOnly?: boolean;
}

export interface VaultWriter {
  get(path: string): Promise<WriterNote>;
  /**
   * Grava se ninguém mudou a nota desde `baseVersion`, guardando antes o texto de agora nas Versões. O `before` (o texto
   * lido nessa versão) é para o Kiwi ao vivo (spec #20843): o `liveWriter` diz à janela onde a escrita mudou.
   */
  save(path: string, content: string, baseVersion: string, before?: string): Promise<{ saved: true; path: string; version: string } | { saved: false }>;
  /** Uma nota nova; com o título já usado na pasta, ela ganha um número ("Título 2"). */
  create(folder: string, title: string, content: string): Promise<WriterNote>;
  /** O id da pasta de notas aberta, ou null num app que não troca de pasta. */
  folder(): Promise<string | null>;
  /** Um arquivo novo (spec #11549): txt, csv, xlsx, docx ou pdf; com o nome já usado na pasta, ganha um número. */
  createFile(folder: string, name: string, bytes: Uint8Array): Promise<{ path: string; size: number; version: string }>;
  /** Os bytes de uma planilha (T21114, spec #21033) ou de um docx (T21231), em base64, com a versão. */
  getBytes?(path: string): Promise<{ base64: string; version: string } | { tooLarge: true; limit: number }>;
  /**
   * Grava a planilha ou o docx se ninguém o mudou desde `baseVersion`. As `sheetOps` e as `docxOps` (as operações que
   * levaram aos bytes novos) são para o Kiwi ao vivo: a grade e o docx abertos tocam cada uma na frente da pessoa.
   */
  saveBytes?(path: string, base64: string, baseVersion: string, sheetOps?: readonly SheetOp[], docxOps?: readonly DocxOp[]): Promise<{ saved: true; path: string; version: string } | { saved: false }>;
  /**
   * Espera a pessoa sair da célula que as `ops` mudariam (a caixa aberta numa planilha, T21114), por até `ms`. Dá a que
   * ainda prende no fim, ou `null`; `waited` diz se houve espera.
   */
  waitCells?(path: string, ops: readonly SheetOp[], ms?: number): Promise<{ busy: EditingCell | null; waited: boolean }>;
  /**
   * Espera a pessoa sair do parágrafo do docx em que ela escreve, se ele é um dos `paragraphIds` (T21231), por até `ms`.
   * Dá o que ainda prende no fim, ou `null`; `waited` diz se houve espera.
   */
  waitParagraphs?(path: string, paragraphIds: readonly string[], ms?: number): Promise<{ busy: string | null; waited: boolean }>;
}

/** As únicas capacidades que o escritor chama. */
export const WRITER_CAPABILITIES = ["notes.get", "notes.save", "notes.create", "notes.folder", "files.create", "files.read", "files.save", "notes.canvasGet", "notes.canvasSave"] as const;
type WriterCapability = (typeof WRITER_CAPABILITIES)[number];
/** As do quadro (T22217) são opcionais: um app sem quadros responde que o gato não muda quadro ali. */
type OptionalWriterCapability = "notes.canvasGet" | "notes.canvasSave";

type NoteResult = { path: string; title: string; content: string; version: string; readOnly?: boolean };

const note = (n: NoteResult): WriterNote => ({
  path: n.path,
  title: n.title,
  content: n.content,
  version: n.version,
  ...(n.readOnly ? { readOnly: true } : {}),
});

/** O escritor sobre as capacidades do app (as de `uiCapabilities`): só as de cima. */
export function writerFromCapabilities(
  caps: Record<Exclude<WriterCapability, OptionalWriterCapability>, (args: unknown) => unknown> & Partial<Record<OptionalWriterCapability, (args: unknown) => unknown>>,
): VaultWriter {
  const call = async <T>(cap: WriterCapability, args: unknown): Promise<T> => {
    const fn = caps[cap];
    if (!fn) throw Object.assign(new Error("o Kiwi não muda quadros aqui"), { code: "E_BAD_ARGS" });
    return (await fn(args)) as T;
  };
  return {
    get: async (path) =>
      isCanvasFile(path)
        ? note(canvasNote(await call<CanvasFile>("notes.canvasGet", { path })))
        : isTextFile(path)
          ? note(textNote(await call<FileContent>("files.read", { path, as: "text" })))
          : note(await call<NoteResult>("notes.get", { path })),
    save: async (path, content, baseVersion) => {
      if (isCanvasFile(path)) {
        const r = await call<CanvasSaveResult>("notes.canvasSave", { path, content, baseVersion });
        return r.saved ? { saved: true, path: r.path, version: r.version } : { saved: false };
      }
      if (isTextFile(path)) {
        const r = await call<FileSaveResult>("files.save", { path, content, baseVersion, snapshot: true });
        return r.saved ? { saved: true, path: r.path, version: r.version } : { saved: false };
      }
      const r = await call<{ saved: true; meta: { path: string; version: string } } | { saved: false }>("notes.save", {
        path,
        content,
        baseVersion,
        snapshot: true,
      });
      return r.saved ? { saved: true, path: r.meta.path, version: r.meta.version } : { saved: false };
    },
    create: async (folder, title, content) => note(await call<NoteResult>("notes.create", { folder, title, content })),
    createFile: (folder, name, bytes) => call("files.create", { folder, name, base64: Buffer.from(bytes).toString("base64") }),
    getBytes: async (path) => {
      const f = await call<FileContent>("files.read", { path, as: "binary" });
      if ("tooLarge" in f) return { tooLarge: true, limit: f.limit };
      if (!("base64" in f)) throw Object.assign(new Error("not a spreadsheet"), { code: "E_BAD_ARGS" });
      return { base64: f.base64, version: f.version };
    },
    saveBytes: async (path, base64, baseVersion) => {
      const r = await call<FileSaveResult>("files.save", { path, base64, baseVersion, snapshot: true });
      return r.saved ? { saved: true, path: r.path, version: r.version } : { saved: false };
    },
    folder: async () => {
      try {
        return (await call<{ current?: { id?: string } }>("notes.folder", {})).current?.id ?? null;
      } catch {
        // O engine sem pastas (`E_NO_FOLDERS`): só há uma.
        return null;
      }
    },
  };
}
