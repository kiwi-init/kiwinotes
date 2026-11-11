// Os visualizadores das Notas (spec #7079): que tipo de arquivo abre dentro da janela, e como o conteúdo é lido.
// Cada formato entra aqui no seu PR (txt, csv, pdf, docx, xlsx, draw.io, imagens). Um tipo sem visualizador segue
// como sempre: o clique na árvore abre no app padrão do Mac.

import type { ComponentType, MutableRefObject } from "react";

import { extOf } from "../../../src/shared/attachments.ts";
import type { FileReadAs } from "../../../src/shared/file-view.ts";
import type { FileContent, NotesApi } from "../types.ts";
import { TableViewer } from "./TableViewer.tsx";
import { TextViewer } from "./TextViewer.tsx";

/** O `files` das Notas num engine que tem o `files.read` (contrato 1.39.0). */
export type FilesApi = NonNullable<NotesApi["files"]> & { read: NonNullable<NonNullable<NotesApi["files"]>["read"]> };

/** O conteúdo lido, já sem o caso "grande demais". */
export type LoadedFile = Exclude<FileContent, { tooLarge: true }>;

export interface FileViewerProps {
  path: string;
  /** O arquivo como está no disco; muda quando o `FileView` lê de novo (outro app gravou). */
  file: LoadedFile;
  files: FilesApi;
  /** Um visualizador que edita põe aqui o "grava antes de sair": `false` segura a pessoa no arquivo. */
  flushRef: MutableRefObject<(() => Promise<boolean>) | null>;
}

export interface FileViewer {
  /** Como o `files.read` entrega o arquivo: texto em UTF-8 ou os bytes em base64. */
  as: FileReadAs;
  View: ComponentType<FileViewerProps>;
}

/** Por extensão, em minúsculas e sem o ponto. */
const text: FileViewer = { as: "text", View: TextViewer };
const table: FileViewer = { as: "text", View: TableViewer };

export const VIEWERS: Record<string, FileViewer> = {
  // T7105: os textos, editáveis (os mesmos tipos que o `files.save` aceita).
  txt: text,
  log: text,
  json: text,
  yaml: text,
  yml: text,
  // T7107: a tabela, só leitura.
  csv: table,
  tsv: table,
};

/** O visualizador de um arquivo pelo nome, ou `undefined`. `.drawio.svg` conta como `drawio.svg` antes de `svg`. */
export function viewerFor(name: string, viewers: Record<string, FileViewer> = VIEWERS): FileViewer | undefined {
  const base = name.split("/").at(-1)!.toLowerCase();
  const double = /\.([a-z0-9]+\.[a-z0-9]+)$/.exec(base)?.[1];
  return (double ? viewers[double] : undefined) ?? viewers[extOf(base)];
}

/** O que o view mostra: carregando, o conteúdo, grande demais, sem visualizador ou erro. */
export type FileState =
  | { kind: "loading" }
  | { kind: "ready"; file: LoadedFile; viewer: FileViewer }
  | { kind: "tooLarge"; size: number; limit: number }
  | { kind: "unsupported" }
  | { kind: "missing" }
  | { kind: "error" };

/**
 * Lê o arquivo para o visualizador dele. Sem visualizador, nada é lido: o view só oferece o app padrão. Um arquivo
 * que sumiu (apagado ou movido fora do Kiwi) não é erro do app: `missing`.
 */
export async function loadFile(
  read: (path: string, as: FileReadAs) => Promise<FileContent>,
  path: string,
  viewer: FileViewer | undefined,
): Promise<FileState> {
  if (!viewer) return { kind: "unsupported" };
  try {
    const file = await read(path, viewer.as);
    if ("tooLarge" in file) return { kind: "tooLarge", size: file.size, limit: file.limit };
    return { kind: "ready", file, viewer };
  } catch (e) {
    return { kind: /E_NOT_FOUND/.test(String((e as { code?: string })?.code ?? e)) ? "missing" : "error" };
  }
}
