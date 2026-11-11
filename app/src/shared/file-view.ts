// O que as Notas abrem dentro da própria janela (spec #7079, T7103), para o engine e para a UI: os limites de tamanho
// do `files.read`. Acima deles, o Kiwi avisa e oferece o app padrão do Mac, em vez de carregar o arquivo na memória.

/** O maior arquivo lido em binário (pdf, docx, xlsx, imagem): 25 MB, como o maior anexo. */
export const MAX_VIEW_BYTES = 25 * 1024 * 1024;

/** O maior arquivo lido como texto (txt, csv, json…): 5 MB, como o quadro branco. */
export const MAX_VIEW_TEXT_BYTES = 5 * 1024 * 1024;

export type FileReadAs = "text" | "binary";

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
