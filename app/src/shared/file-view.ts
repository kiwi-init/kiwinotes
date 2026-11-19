// O que as Notas abrem dentro da própria janela (spec #7079, T7103), para o engine e para a UI: os limites de tamanho
// do `files.read`. Acima deles, o Kiwi avisa e oferece o app padrão do Mac, em vez de carregar o arquivo na memória.

import { PACKAGE_MARKS } from "./attachments.ts";

/** O maior arquivo lido em binário (pdf, docx, xlsx, imagem): 25 MB, como o maior anexo. */
export const MAX_VIEW_BYTES = 25 * 1024 * 1024;

/** O maior arquivo lido como texto (txt, csv, json…): 5 MB, como o quadro branco. */
export const MAX_VIEW_TEXT_BYTES = 5 * 1024 * 1024;

export type FileReadAs = "text" | "binary";

/** Onde um achado da busca está dentro do pdf, do docx ou do xlsx (T22218): a página, o parágrafo com texto, a célula. */
export type DocPlace = { page: number } | { paragraph: number } | { sheet: string; cell: string };

/** Onde abrir o arquivo achado pela busca: a linha do texto (T21240) ou o lugar no documento (T22218). */
export type FileAt = { line: number } | DocPlace;

/** "IV3" → a linha 3 e a coluna 255 (a A é a 0); null se não é uma referência de célula. */
export function cellRef(cell: string): { line: number; col: number } | null {
  const m = /^([A-Z]{1,3})([1-9]\d*)$/.exec(cell.toUpperCase());
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]!) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { line: Number(m[2]), col: col - 1 };
}

/** O lugar curto, para a lista: "linha 3", "pág. 2", "§4", "Aba!B7". */
export function fileAtLabel(at: FileAt): string {
  if ("line" in at) return `linha ${at.line}`;
  if ("page" in at) return `pág. ${at.page}`;
  if ("paragraph" in at) return `§${at.paragraph}`;
  return `${at.sheet}!${at.cell}`;
}

/**
 * O código que as Notas abrem editável e com cor (spec #19277, T19312). A cor de cada um (a linguagem do CodeMirror) fica
 * em `ui/notes/files/code-languages.ts`, e o teste de lá confere que as duas listas batem.
 */
export const CODE_TYPES: readonly string[] = [
  "py", "js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx", "css", "scss", "less", "html", "htm", "xml", "sql",
  "sh", "bash", "zsh", "swift", "rb", "go", "rs", "c", "h", "cpp", "cc", "hpp", "java", "kt", "kts", "cs", "scala",
  "dart", "lua", "r", "pl", "ps1", "php", "tex", "toml", "ini", "cfg", "conf", "env", "properties", "proto", "diff", "patch",
  // T19313: `app.dockerfile` e `regras.mk`; o `Dockerfile` e o `Makefile` sem extensão vão pelo nome (`code-languages.ts`).
  "dockerfile", "mk",
];

/** Os textos que as Notas abrem editáveis e gravam de volta (T7105, e o código do T19312): só estes o `files.save` aceita. */
export const EDITABLE_TEXT = new Set(["txt", "log", "json", "yaml", "yml", ...CODE_TYPES]);

export const isEditableText = (name: string): boolean => EDITABLE_TEXT.has((/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? "").toLowerCase());

/**
 * O arquivo que não é nota e tem o painel Versões com o diff (T21239, spec #21160): o texto editável e a tabela em texto
 * (csv, tsv), que grava em bytes mas se lê como texto.
 */
export const hasTextVersions = (name: string): boolean => isEditableText(name) || /\.(csv|tsv)$/i.test(name);

/**
 * Tudo o que tem o painel Versões (T22432, issue #182): os de texto, o xlsx e o docx (a versão abre só leitura no
 * visualizador dele; o docx desde o T22797, quando o Kiwi passou a gravá-lo) e o quadro branco (o diff dos cartões e
 * das setas).
 */
export const hasVersions = (name: string): boolean => hasTextVersions(name) || /\.(xlsx|docx|canvas)$/i.test(name);

export const viewLimit = (as: FileReadAs): number => (as === "text" ? MAX_VIEW_TEXT_BYTES : MAX_VIEW_BYTES);

/** "1,2 MB", "340 KB", "12 B": o tamanho como o Finder diz. */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1).replace(".", ",").replace(/,0$/, "")} ${units[unit]}`;
}

/** O áudio e o vídeo que tocam nas Notas (T19315): o tipo MIME de cada um fica em `ui/notes/files/media.ts`. */
export const MEDIA_TYPES: readonly string[] = ["mp3", "m4a", "aac", "wav", "aiff", "aif", "caf", "mp4", "m4v", "mov"];

/**
 * Os tipos que as Notas mostram na própria janela, num visualizador (spec #7079): a UI tem o componente de cada um em
 * `ui/notes/files/viewers.ts` (`VIEWERS`), e o teste de lá confere que as duas listas batem. O `.txt` também abre nas
 * Notas, mas conta como nota (spec #17683). `.drawio.svg` vem antes de `.svg`.
 */
export const VIEWER_TYPES: readonly string[] = [
  "txt", "log", "json", "yaml", "yml", "csv", "tsv", "pdf", "docx", "xlsx",
  "png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "bmp", "svg", "drawio", "drawio.svg", ...CODE_TYPES,
  ...MEDIA_TYPES,
];

/**
 * Os tipos que nunca são texto (T19313): abrem direto no app padrão do Mac (ou no Finder), sem o Kiwi ler o arquivo
 * para conferir. O resto sem visualizador próprio passa pela conferência de `looksLikeText`.
 */
export const NEVER_TEXT: ReadonlySet<string> = new Set([
  // os de `OPENS_IN_APP` sem visualizador nas Notas (imagem, áudio, vídeo, escritório)
  "avif", "tif", "tiff", "rtf", "mp3", "m4a", "wav", "aac", "aiff", "aif", "flac", "caf", "mp4", "mov", "m4v",
  "pages", "numbers", "key", "doc", "xls", "ppt", "pptx", "odt", "ods", "odp",
  // compactados, instaladores e discos
  "zip", "gz", "tgz", "bz2", "xz", "zst", "7z", "rar", "tar", "dmg", "pkg", "iso", "jar", "apk", "ipa",
  // programas e bibliotecas
  "exe", "dll", "so", "dylib", "o", "a", "class", "wasm", "pyc", "bin",
  // mídia, fontes e bancos
  "mkv", "avi", "webm", "ogg", "opus", "ico", "icns", "psd", "ai", "sketch", "fig",
  "ttf", "otf", "woff", "woff2", "sqlite", "db", "epub", "mobi",
]);

/**
 * Um arquivo sem visualizador próprio que pode abrir como texto (T19313): o `Dockerfile`, um `LEIAME`, um `.vue` ou
 * uma extensão que ninguém lembrou. Nem nota (`.md`), nem quadro branco, nem um tipo com visualizador, nem um de
 * `NEVER_TEXT`, nem um documento-pacote (`PACKAGE_MARKS`). O conteúdo decide: `looksLikeText`.
 */
export function mayBeText(name: string): boolean {
  const base = (name.split("/").at(-1) ?? "").toLowerCase();
  if (!base || /\.(md|markdown|canvas)$/.test(base)) return false;
  const double = /\.([a-z0-9]+\.[a-z0-9]+)$/.exec(base)?.[1];
  const single = /\.([a-z0-9]+)$/.exec(base)?.[1];
  if ((double && VIEWER_TYPES.includes(double)) || (single && VIEWER_TYPES.includes(single))) return false;
  // Um documento-pacote (`.rtfd`, `.pages`…) é uma pasta no disco: ler como texto daria "não está mais na pasta".
  return !single || !(NEVER_TEXT.has(single) || Object.hasOwn(PACKAGE_MARKS, single));
}

/** É texto: lido em UTF-8 sem perda (sem `readOnly`) e sem o byte zero, que nenhum texto tem e todo binário tem. */
export const looksLikeText = (text: string): boolean => !text.includes("\0");

/** Onde um arquivo do cofre abre pelo clique no balão do gato (spec #17683): nas Notas, num visualizador, ou no app do Mac. */
export type OpenTarget = "note" | "viewer" | "app";

/** `.md` e `.txt` são nota; um tipo com visualizador (ou o quadro branco) abre nas Notas; o resto, no app padrão do Mac. */
export function openTarget(name: string): OpenTarget {
  const base = (name.split("/").at(-1) ?? "").toLowerCase();
  if (/\.(md|txt)$/.test(base)) return "note";
  if (/\.canvas$/.test(base)) return "viewer";
  const double = /\.([a-z0-9]+\.[a-z0-9]+)$/.exec(base)?.[1];
  const single = /\.([a-z0-9]+)$/.exec(base)?.[1];
  return (double && VIEWER_TYPES.includes(double)) || (single && VIEWER_TYPES.includes(single)) ? "viewer" : "app";
}
