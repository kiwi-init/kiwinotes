// Os visualizadores das Notas (spec #7079): que tipo de arquivo abre dentro da janela, e como o conteúdo é lido.
// Cada formato entra aqui no seu PR (txt, csv, pdf, docx, xlsx, draw.io, imagens). Um tipo sem visualizador segue
// como sempre: o clique na árvore abre no app padrão do Mac.

import type { ComponentType } from "react";

import { extOf } from "../../../src/shared/attachments.ts";
import type { FileReadAs } from "../../../src/shared/file-view.ts";
import type { FileContent } from "../types.ts";

/** O conteúdo lido, já sem o caso "grande demais". */
export type LoadedFile = Exclude<FileContent, { tooLarge: true }>;

export interface FileViewerProps {
  path: string;
  file: LoadedFile;
}

export interface FileViewer {
  /** Como o `files.read` entrega o arquivo: texto em UTF-8 ou os bytes em base64. */
  as: FileReadAs;
  View: ComponentType<FileViewerProps>;
}

/** Por extensão, em minúsculas e sem o ponto. */
export const VIEWERS: Record<string, FileViewer> = {};

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
