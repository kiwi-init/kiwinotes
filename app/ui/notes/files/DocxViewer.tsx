// O docx dentro das Notas (T7110; desde o T21151, spec #21080, como no Word): as páginas do documento, com a fonte, as
// tabelas, as imagens, o cabeçalho e o rodapé, pelo motor do @docx-editor.dev/core (`docxEngine.ts`), que só carrega
// quando um docx abre. Só leitura: o arquivo não é gravado, e fica como estava, byte a byte. O ⌘F acha no texto do
// corpo; o zoom é o de todo arquivo (a pinça e o ⌘+, ⌘−, ⌘0). Ao fechar, o motor é solto (#22186, a decisão do harry
// em #22216): a memória do documento volta.

import { type KeyboardEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { NO_TEXT_ASSIST } from "../../src/textAssist.ts";
import { externalUrl } from "../links.ts";
import { bytesOf } from "./csv.ts";
import type { DocxHandle } from "./docxEngine.ts";
import { type DocxMatch, type DocxParagraph, docxParagraphs, findInDocx } from "./docxFind.ts";
import { stepMatch } from "./pdfSearch.ts";
import { useViewerZoom } from "./useViewerZoom.ts";
import type { FileViewerProps } from "./viewers.ts";
import { checkZip } from "./zipSize.ts";
import { recallZoom, stepZoom } from "./zoom.ts";

type State = { kind: "loading" } | { kind: "ready"; pages: number } | { kind: "tooLarge" } | { kind: "error" };

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;

export function DocxViewer({ path, file }: FileViewerProps) {
  const base64 = "base64" in file ? file.base64 : "";
  const [state, setState] = useState<State>({ kind: "loading" });
  const scroller = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<DocxHandle | null>(null);
  const queryBox = useRef<HTMLInputElement>(null);
  // O zoom (T21238): `null` é 100%, como o Word abre.
  const [zoom, setZoom] = useState<number | null>(() => recallZoom(path));
  useEffect(() => setZoom(recallZoom(path)), [path]);
  const z = zoom ?? 1;
  const zoomAtMount = useRef(z);
  zoomAtMount.current = z;
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<DocxMatch[] | null>(null);
  const [current, setCurrent] = useState(-1);
  const paragraphs = useRef<DocxParagraph[] | null>(null);

  // Abre o documento no motor. Outro arquivo, ou o mesmo que mudou no disco: solta o de antes.
  useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    setMatches(null);
    setCurrent(-1);
    paragraphs.current = null;
    void (async () => {
      try {
        const bytes = bytesOf(base64);
        // Antes do motor, o tamanho aberto (revisão do T7110): um docx pequeno pode descompactar em centenas de MB.
        const zip = checkZip(bytes);
        if (!zip.ok) {
          if (alive) setState({ kind: zip.reason === "too-large" ? "tooLarge" : "error" });
          return;
        }
        const { mountDocx } = await import("./docxEngine.ts");
        const el = host.current;
        if (!alive || !el) return;
        const r = mountDocx(el, bytes, {
          zoom: zoomAtMount.current,
          onLink: (href) => {
            const url = externalUrl(href);
            // O `newWindow: "external"` da janela manda para o navegador padrão.
            if (url) window.open(url, "_blank", "noopener,noreferrer");
          },
        });
        if (!r.ok) return setState({ kind: "error" });
        engine.current = r.handle;
        setState({ kind: "ready", pages: r.handle.pages() });
      } catch {
        if (alive) setState({ kind: "error" });
      }
    })();
    return () => {
      alive = false;
      engine.current?.destroy();
      engine.current = null;
      paragraphs.current = null;
    };
  }, [base64]);

  // O zoom vai ao motor, que desenha as páginas de novo na escala nova (o texto fica nítido, sem esticar a imagem). Antes
  // do `useViewerZoom`, e também num efeito de layout: quando ele mede onde o ponto dos dedos foi parar, as páginas já
  // estão no tamanho novo.
  useLayoutEffect(() => {
    engine.current?.setZoom(z);
  }, [z, state.kind]);
  const { zoomBy, zoomTo } = useViewerZoom({ path, target: scroller, scale: z, set: setZoom, min: MIN_ZOOM, max: MAX_ZOOM, anchor: ".docx-page", enabled: state.kind === "ready" });

  // A busca, um pouco depois da última tecla. O texto dos parágrafos é lido do motor uma vez, na primeira busca.
  useEffect(() => {
    if (state.kind !== "ready") return;
    if (!query.trim()) {
      setMatches(null);
      setCurrent(-1);
      return;
    }
    const timer = setTimeout(() => {
      if (!engine.current) return;
      paragraphs.current ??= docxParagraphs(engine.current.pieces());
      const found = findInDocx(paragraphs.current, query);
      setMatches(found);
      setCurrent(found.length ? 0 : -1);
    }, 150);
    return () => clearTimeout(timer);
  }, [query, state.kind]);

  // As marcas na página, e o achado da vez à vista.
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    e.mark(matches ?? [], current);
    const m = matches && current >= 0 ? matches[current] : undefined;
    if (m) e.reveal(m);
  }, [matches, current]);

  const step = useCallback((direction: 1 | -1) => setCurrent((c) => stepMatch(c, matches?.length ?? 0, direction)), [matches]);

  // ⌘F em qualquer lugar do documento vai para a busca; ⌘G e ⇧⌘G andam pelos achados.
  const onKeyDown = (e: KeyboardEvent) => {
    if (!e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "f") {
      e.preventDefault();
      queryBox.current?.focus();
      queryBox.current?.select();
    } else if (k === "g" && matches?.length) {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    }
  };

  const count = useMemo(() => (matches === null ? "" : matches.length ? `${current + 1} de ${matches.length.toLocaleString("pt-BR")}` : "Nada encontrado"), [matches, current]);

  if (state.kind === "error") {
    return (
      <div className="kn-file-notice" role="status">
        <p>Não deu para abrir este documento. Ele pode estar corrompido ou ser de outro formato (o .doc antigo, por exemplo).</p>
      </div>
    );
  }
  if (state.kind === "tooLarge") {
    return (
      <div className="kn-file-notice" role="status">
        <p>Este documento é grande demais para abrir aqui. Abra no app padrão.</p>
      </div>
    );
  }
  const ready = state.kind === "ready";
  return (
    // biome-ignore lint: o ⌘F e o ⌘G do documento; o foco fica nos controles e nas páginas
    <div className="kn-file-pdf kn-file-docx" aria-busy={ready ? undefined : "true"} onKeyDown={onKeyDown}>
      <div className="kn-file-pdf-bar" role="toolbar" aria-label="Documento">
        <span className="kn-file-pdf-group">
          <button type="button" className="kn-bt" aria-label="Diminuir o zoom" disabled={!ready || z <= MIN_ZOOM} onClick={() => zoomBy(stepZoom(z, -1, MIN_ZOOM, MAX_ZOOM) / z)}>
            −
          </button>
          <span className="kn-file-pdf-zoom" aria-live="polite">{`${Math.round(z * 100)}%`}</span>
          <button type="button" className="kn-bt" aria-label="Aumentar o zoom" disabled={!ready || z >= MAX_ZOOM} onClick={() => zoomBy(stepZoom(z, 1, MIN_ZOOM, MAX_ZOOM) / z)}>
            +
          </button>
          <button type="button" className="kn-bt" disabled={!ready || zoom === null} onClick={() => zoomTo(null)}>
            100%
          </button>
        </span>
        <span className="kn-file-pdf-page">{ready ? `${state.pages} ${state.pages === 1 ? "página" : "páginas"}` : ""}</span>
        <span className="kn-file-pdf-group kn-file-pdf-find">
          <input
            ref={queryBox}
            className="kn-file-pdf-query"
            type="search"
            placeholder="Buscar no documento"
            aria-label="Buscar no documento"
            value={query}
            disabled={!ready}
            {...NO_TEXT_ASSIST}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                step(e.shiftKey ? -1 : 1);
              }
              if (e.key === "Escape") setQuery("");
            }}
          />
          <span className="kn-file-pdf-count" aria-live="polite">
            {count}
          </span>
          <button type="button" className="kn-bt" aria-label="Achado anterior" disabled={!matches?.length} onClick={() => step(-1)}>
            ↑
          </button>
          <button type="button" className="kn-bt" aria-label="Próximo achado" disabled={!matches?.length} onClick={() => step(1)}>
            ↓
          </button>
        </span>
      </div>
      {/* Com foco (o clique numa página): as setas e o Page Down rolam, e o ⌘F chega aqui. */}
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a área rolável do documento, como a do pdf no Preview */}
      <div className="kn-file-docx-scroll docx-editor docx-editor__scroll-container" ref={scroller} tabIndex={0} aria-label="Páginas do documento">
        <div className="docx-paginated-surface" ref={host} />
      </div>
    </div>
  );
}
