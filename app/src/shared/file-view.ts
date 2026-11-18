// O que as Notas abrem dentro da própria janela (spec #7079, T7103), para o engine e para a UI: os limites de tamanho
// do `files.read`. Acima deles, o Kiwi avisa e oferece o app padrão do Mac, em vez de carregar o arquivo na memória.

/** O maior arquivo lido em binário (pdf, docx, xlsx, imagem): 25 MB, como o maior anexo. */
export const MAX_VIEW_BYTES = 25 * 1024 * 1024;

/** O maior arquivo lido como texto (txt, csv, json…): 5 MB, como o quadro branco. */
export const MAX_VIEW_TEXT_BYTES = 5 * 1024 * 1024;

export type FileReadAs = "text" | "binary";

/**
 * O código que as Notas abrem editável e com cor (spec #19277, T19312). A cor de cada um (a linguagem do CodeMirror) fica
 * em `ui/notes/files/code-languages.ts`, e o teste de lá confere que as duas listas batem.
 */
export const CODE_TYPES: readonly string[] = [
  "py", "js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx", "css", "scss", "less", "html", "htm", "xml", "sql",
  "sh", "bash", "zsh", "swift", "rb", "go", "rs", "c", "h", "cpp", "cc", "hpp", "java", "kt", "kts", "cs", "scala",
  "dart", "lua", "r", "pl", "ps1", "php", "tex", "toml", "ini", "cfg", "conf", "env", "properties", "proto", "diff", "patch",
];

/** Os textos que as Notas abrem editáveis e gravam de volta (T7105, e o código do T19312): só estes o `files.save` aceita. */
export const EDITABLE_TEXT = new Set(["txt", "log", "json", "yaml", "yml", ...CODE_TYPES]);

export const isEditableText = (name: string): boolean => EDITABLE_TEXT.has((/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? "").toLowerCase());

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

/**
 * Os tipos que as Notas mostram na própria janela, num visualizador (spec #7079): a UI tem o componente de cada um em
 * `ui/notes/files/viewers.ts` (`VIEWERS`), e o teste de lá confere que as duas listas batem. O `.txt` também abre nas
 * Notas, mas conta como nota (spec #17683). `.drawio.svg` vem antes de `.svg`.
 */
export const VIEWER_TYPES: readonly string[] = [
  "txt", "log", "json", "yaml", "yml", "csv", "tsv", "pdf", "docx", "xlsx",
  "png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "bmp", "svg", "drawio", "drawio.svg", ...CODE_TYPES,
];

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
