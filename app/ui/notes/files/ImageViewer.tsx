// A imagem dentro das Notas (T7113, spec #7079): inteira, ajustada à janela, com zoom em degraus e o tamanho real. O
// tipo vem dos bytes e não do nome, e uma imagem com pixels demais (`imageInfo.ts`) é recusada antes de o WebKit
// decodificar. O SVG entra como <img>, onde script não roda e nada de fora carrega. Só leitura.

import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { bytesOf } from "./csv.ts";
import { fitScale, imageInfo, imageProblem, stepImageZoom } from "./imageInfo.ts";
import type { FileViewerProps } from "./viewers.ts";

export function ImageViewer({ path, file }: FileViewerProps) {
  const base64 = "base64" in file ? file.base64 : "";
  const info = useMemo(() => imageInfo(bytesOf(base64.slice(0, 96 * 1024 - (96 * 1024) % 4))), [base64]);
  const problem = imageProblem(info);
  /** `null`: ajustada à janela. */
  const [zoom, setZoom] = useState<number | null>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [area, setArea] = useState({ width: 0, height: 0 });
  const box = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setArea({ width: el.clientWidth - 48, height: el.clientHeight - 48 });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [problem]);

  if (problem || failed || !info) {
    return (
      <div className="kn-file-notice" role="status">
        <p>
          {problem === "tooLarge"
            ? `Esta imagem tem ${info?.width?.toLocaleString("pt-BR")} × ${info?.height?.toLocaleString("pt-BR")} pixels, grande demais para abrir aqui. Abra no app padrão.`
            : "Não deu para mostrar esta imagem aqui. Abra no app padrão."}
        </p>
      </div>
    );
  }

  const name = path.split("/").at(-1)!;
  // O SVG sem tamanho no arquivo: o WebKit dá 150 × 150, e o ajuste trata como qualquer outra.
  const size = natural ?? (info.width && info.height ? { width: info.width, height: info.height } : null);
  const fit = size ? fitScale(size.width, size.height, area.width, area.height) : 1;
  const scale = zoom ?? fit;
  const width = size ? Math.max(1, Math.round(size.width * scale)) : undefined;

  return (
    <div className="kn-file-image">
      <div className="kn-file-pdf-bar" role="toolbar" aria-label="Imagem">
        <span className="kn-file-pdf-group">
          <button type="button" className="kn-bt" aria-label="Diminuir o zoom" onClick={() => setZoom(stepImageZoom(scale, -1))}>
            −
          </button>
          <span className="kn-file-pdf-zoom" aria-live="polite">{`${Math.round(scale * 100)}%`}</span>
          <button type="button" className="kn-bt" aria-label="Aumentar o zoom" onClick={() => setZoom(stepImageZoom(scale, 1))}>
            +
          </button>
          <button type="button" className="kn-bt" disabled={zoom === null} onClick={() => setZoom(null)}>
            Ajustar à janela
          </button>
          <button type="button" className="kn-bt" disabled={zoom === 1} onClick={() => setZoom(1)}>
            Tamanho real
          </button>
        </span>
        <span className="kn-file-pdf-page">{size ? `${size.width.toLocaleString("pt-BR")} × ${size.height.toLocaleString("pt-BR")} px` : ""}</span>
      </div>
      <div className="kn-file-image-area" ref={box} data-zoomed={zoom !== null && scale > fit ? "true" : undefined}>
        <img
          className="kn-file-image-img"
          src={`data:${info.mime};base64,${base64}`}
          alt={name}
          draggable={false}
          style={width ? { width } : undefined}
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth && img.naturalHeight) setNatural({ width: img.naturalWidth, height: img.naturalHeight });
          }}
          onError={() => setFailed(true)}
        />
      </div>
    </div>
  );
}
