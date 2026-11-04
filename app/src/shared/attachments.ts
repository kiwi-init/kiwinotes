// O que vale como anexo (T2594), para o engine e para a UI: os tipos, o MIME de cada um e o tamanho máximo.

/** O maior anexo: 25 MB (uma foto do iPhone em HEIC tem uns 3 MB; um PDF escaneado, uns 10). */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** A pasta de anexos quando a pessoa não escolheu outra. */
export const DEFAULT_ATTACHMENTS_FOLDER = "Anexos";

/** Os tipos aceitos, com o MIME do `data:` URL. SVG entra só como imagem (`<img>`), onde script não roda. */
export const ATTACHMENT_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  svg: "image/svg+xml",
  pdf: "application/pdf",
};

/** A extensão em minúsculas, sem o ponto ("" sem extensão). */
export const extOf = (name: string): string => (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? "").toLowerCase();

export const isAttachmentName = (name: string): boolean => Boolean(ATTACHMENT_TYPES[extOf(name)]);

/**
 * O que a árvore (T3370) abre no app padrão do Mac: só tipos de documento, que o `open` mostra e não executa (imagem,
 * PDF, áudio, vídeo, o `.canvas` do Obsidian, texto e documentos de escritório). Todo o resto vai só para o Finder:
 * um script, um instalador, um `.webloc`, um `.ics` que importa coisas, um tipo que ninguém lembrou. Lista do que abre,
 * e não do que é perigoso, para que um tipo esquecido caia no lado seguro (revisão #3458).
 */
export const OPENS_IN_APP = new Set([
  // imagem (o SVG fica de fora: abre no navegador, com script)
  "png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "avif", "bmp", "tif", "tiff",
  // PDF e o canvas do Obsidian (JSON)
  "pdf", "canvas",
  // áudio e vídeo
  "mp3", "m4a", "wav", "aac", "aiff", "aif", "flac", "caf", "mp4", "mov", "m4v",
  // texto e dados simples
  "txt", "csv", "tsv", "json", "log", "rtf",
  // documentos de escritório (Pages, Numbers, Keynote, Office, LibreOffice)
  "pages", "numbers", "key", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp",
]);

/** Com o bit de execução, o `open` roda o arquivo no Terminal, qualquer que seja a extensão. */
export const isExecutable = (mode: number): boolean => (mode & 0o111) !== 0;

/**
 * O `open` de um arquivo do cofre (T3370): no app padrão só um tipo da `OPENS_IN_APP` sem o bit de execução; o resto
 * só aparece no Finder. Um clique na árvore nunca roda nada.
 */
export const openMode = (name: string, mode = 0): "app" | "finder" =>
  OPENS_IN_APP.has(extOf(name)) && !isExecutable(mode) ? "app" : "finder";

/**
 * Documentos que o macOS guarda como pacote (uma pasta que o Finder mostra como arquivo): o vault lista como arquivo,
 * sem entrar nem mostrar como pasta, e a árvore abre no app dele (T3371, nit da revisão #3466). O nome só não basta:
 * uma pasta comum chamada "Projeto.key" esconderia as notas de dentro (revisão #3476). É pacote quando, além do nome,
 * tem a marca do formato e nenhuma nota.
 */
export const PACKAGE_MARKS: Readonly<Record<string, readonly string[]>> = {
  pages: ["Index.zip", "Index.xml", "index.xml.gz"],
  numbers: ["Index.zip", "Index.xml", "index.xml.gz"],
  key: ["Index.zip", "Index.xml", "index.apxl", "index.apxl.gz"],
  rtfd: ["TXT.rtf"],
};

/** Se a pasta `name`, com estes itens de primeiro nível, é um documento-pacote. */
export function isPackageDir(name: string, entries: readonly string[]): boolean {
  const marks = PACKAGE_MARKS[extOf(name)];
  if (!marks || entries.some((e) => /\.md$/i.test(e))) return false;
  return entries.some((e) => marks.includes(e));
}
