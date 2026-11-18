// O áudio e o vídeo dentro das Notas (T19315, spec #19277): o player do próprio WebKit (`controls`), sem nada nosso por
// cima. Os bytes viram um `blob:` (a CSP das views só deixa esse, `media-src blob:`), que é solto quando o arquivo
// muda ou o view fecha. Nada toca sozinho: o vídeo só carrega (`preload="auto"`, os bytes já estão na memória), para
// mostrar o primeiro quadro em vez de um retângulo preto. Só leitura.

import { useEffect, useMemo, useState } from "react";

import { bytesOf } from "./csv.ts";
import { mediaType } from "./media.ts";
import type { FileViewerProps } from "./viewers.ts";

export function MediaViewer({ path, file }: FileViewerProps) {
  const base64 = "base64" in file ? file.base64 : "";
  const type = mediaType(path);
  const [failed, setFailed] = useState(false);
  /** O WebKit leu a duração do áudio, ou o primeiro quadro do vídeo: o arquivo toca. */
  const [loaded, setLoaded] = useState(false);
  const url = useMemo(
    () => (type ? URL.createObjectURL(new Blob([bytesOf(base64) as BlobPart], { type: type.mime })) : null),
    [base64, type?.mime],
  );
  useEffect(() => {
    setFailed(false);
    setLoaded(false);
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  if (!type || !url || failed) {
    return (
      <div className="kn-file-notice" role="status">
        <p>Não deu para tocar este arquivo aqui. Abra no app padrão.</p>
      </div>
    );
  }

  const name = path.split("/").at(-1)!;
  return (
    <div className="kn-file-media" data-kind={type.kind} data-loaded={loaded ? "" : undefined}>
      {type.kind === "video" ? (
        <video className="kn-file-media-player" src={url} controls preload="auto" aria-label={name} onLoadedData={() => setLoaded(true)} onError={() => setFailed(true)} />
      ) : (
        <audio className="kn-file-media-player" src={url} controls preload="metadata" aria-label={name} onLoadedMetadata={() => setLoaded(true)} onError={() => setFailed(true)} />
      )}
    </div>
  );
}
