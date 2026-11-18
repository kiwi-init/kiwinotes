// O áudio e o vídeo nas Notas (T19315, spec #19277): os tipos que tocam dentro da janela, e o tipo MIME de cada um.
// Os bytes vêm do `files.read` em base64 e viram um `blob:`, a única fonte de mídia que a CSP das views deixa
// (`media-src blob:`, em `window-security.ts`): nada toca da rede nem de outro lugar.
//
// Só os formatos que o próprio macOS toca (o AVFoundation, por baixo do WebKit). WebM e Ogg tocam no WebKit headless
// dos testes, mas não há como provar que tocam no WebView do app: seguem no app padrão. Um arquivo destes tipos que
// mesmo assim não toca (um codec raro dentro de um .mov) mostra o aviso com o "Abrir no app padrão".

export type MediaKind = "audio" | "video";

/** Por extensão, em minúsculas e sem o ponto: se é áudio ou vídeo, e o tipo MIME do `Blob`. */
export const MEDIA_MIME: Readonly<Record<string, { kind: MediaKind; mime: string }>> = {
  mp3: { kind: "audio", mime: "audio/mpeg" },
  m4a: { kind: "audio", mime: "audio/mp4" },
  aac: { kind: "audio", mime: "audio/aac" },
  wav: { kind: "audio", mime: "audio/wav" },
  aiff: { kind: "audio", mime: "audio/aiff" },
  aif: { kind: "audio", mime: "audio/aiff" },
  caf: { kind: "audio", mime: "audio/x-caf" },
  mp4: { kind: "video", mime: "video/mp4" },
  m4v: { kind: "video", mime: "video/x-m4v" },
  mov: { kind: "video", mime: "video/quicktime" },
};

/** O tipo de mídia de um arquivo pelo nome, ou `undefined` se ele não toca nas Notas. */
export function mediaType(path: string): { kind: MediaKind; mime: string } | undefined {
  const ext = /\.([a-z0-9]+)$/i.exec(path.split("/").at(-1) ?? "")?.[1]?.toLowerCase();
  return ext && Object.hasOwn(MEDIA_MIME, ext) ? MEDIA_MIME[ext] : undefined;
}
