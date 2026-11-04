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
