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
 * Arquivos que o `open` do macOS executaria em vez de mostrar (um script no Terminal, um AppleScript, um instalador).
 * O "abrir no app padrão" da árvore (T3370) só mostra esses no Finder: um clique num arquivo do cofre não roda nada.
 */
export const RUNS_ON_OPEN = new Set([
  "app", "command", "tool", "sh", "zsh", "bash", "csh", "ksh", "fish", "terminal", "scpt", "scptd", "applescript",
  "workflow", "action", "pkg", "mpkg", "dmg", "jar", "py", "pl", "rb", "php", "js", "mjs", "osascript", "shortcut",
  "prefpane", "saver", "kext", "plugin", "webloc", "inetloc", "fileloc", "url", "mobileconfig", "configprofile",
]);

/** O `open` de um arquivo do cofre (T3370): no app padrão, ou só no Finder se ele rodaria algo. */
export const openMode = (name: string): "app" | "finder" => (RUNS_ON_OPEN.has(extOf(name)) ? "finder" : "app");
