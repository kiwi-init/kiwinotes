// O áudio e o vídeo dentro das Notas (T19315, spec #19277): o player do próprio WebKit (`controls`), sem nada nosso por
// cima. Os bytes viram um `blob:` (a CSP das views só deixa esse, `media-src blob:`), que é solto quando o arquivo
// muda ou o view fecha. Nada toca sozinho: o vídeo só carrega (`preload="auto"`, os bytes já estão na memória), para
// mostrar o primeiro quadro em vez de um retângulo preto. Só leitura.
//
// O vídeo tem a pinça e o ⌘+/⌘−/⌘0 da imagem (T22178, spec #21198): começa ajustado à área e cresce centrado nos dedos,
// com rolagem. O áudio é só a barra do player: não tem o que ampliar.

import { useT } from "../../src/i18n.ts";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { bytesOf } from "./csv.ts";
import { fitScale, IMAGE_ZOOM } from "./imageInfo.ts";
import { mediaType } from "./media.ts";
import { useViewerZoom } from "./useViewerZoom.ts";
import type { FileViewerProps } from "./viewers.ts";
import { recallZoom } from "./zoom.ts";

/** O `padding` da área do vídeo, que não cresce com o zoom. */
const PAD = { x: 24, y: 24 };

export function MediaViewer({ path, file }: FileViewerProps) {
  const { t } = useT();
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
    setNatural(null);
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  // O zoom do vídeo (T22178): `null` é ajustado à área, e a escala é a do tamanho real do quadro, como na imagem.
  const [zoom, setZoom] = useState<number | null>(() => recallZoom(path));
  useEffect(() => setZoom(recallZoom(path)), [path]);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [area, setArea] = useState({ width: 0, height: 0 });
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setArea({ width: el.clientWidth - 2 * PAD.x, height: el.clientHeight - 2 * PAD.y });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [failed, type?.kind]);
  const fit = natural ? fitScale(natural.width, natural.height, area.width, area.height) : 1;
  const scale = zoom ?? fit;
  const video = type?.kind === "video";
  useViewerZoom({ path, target: box, scale, set: setZoom, min: IMAGE_ZOOM[0], max: IMAGE_ZOOM.at(-1)!, pad: PAD, anchor: ".kn-file-media-player", enabled: video && !failed && !!natural });

  if (!type || !url || failed) {
    return (
      <div className="kn-file-notice" role="status">
        <p>{t("files.media.failed")}</p>
      </div>
    );
  }

  const name = path.split("/").at(-1)!;
  return (
    <div className="kn-file-media" ref={box} data-kind={type.kind} data-loaded={loaded ? "" : undefined} data-zoomed={zoom !== null && scale > fit ? "true" : undefined}>
      {type.kind === "video" ? (
        <video
          className="kn-file-media-player"
          src={url}
          controls
          preload="auto"
          aria-label={name}
          style={natural && zoom !== null ? { width: Math.max(1, Math.round(natural.width * scale)), maxWidth: "none", maxHeight: "none" } : undefined}
          onLoadedData={(e) => {
            const v = e.currentTarget;
            if (v.videoWidth && v.videoHeight) setNatural({ width: v.videoWidth, height: v.videoHeight });
            setLoaded(true);
          }}
          onError={() => setFailed(true)}
        />
      ) : (
        <audio className="kn-file-media-player" src={url} controls preload="metadata" aria-label={name} onLoadedMetadata={() => setLoaded(true)} onError={() => setFailed(true)} />
      )}
    </div>
  );
}
