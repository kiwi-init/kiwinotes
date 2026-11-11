// O pdf dentro das Notas (T7109, spec #7079): as páginas com rolagem, zoom e busca, pelo pdf.js (Apache-2.0), que vai
// no pack da UI. Só leitura. Nada vem da rede: o pdf chega pelo `files.read`, o worker é um arquivo do próprio pack, e
// o pdf.js fica sem os extras que ele buscaria por `fetch` (CMaps, fontes padrão, decodificadores em wasm), que a CSP
// das views nem deixaria sair. O pdf.js só carrega quando um pdf abre (import dinâmico).
//
// Cada página é desenhada num <canvas> só quando chega perto da tela, e sai dele quando vai longe: um pdf de
// centenas de páginas não vira centenas de canvases. A busca usa o texto de cada página (`pdfSearch.ts`) e marca os
// achados por cima do canvas.

import type { PageViewport, PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { NO_TEXT_ASSIST } from "../../src/textAssist.ts";
import { bytesOf } from "./csv.ts";
import { findInPages, fitWidth, type PageText, pageText, type PdfMatch, type PdfRect, type PdfTextItem, stepMatch, stepZoom } from "./pdfSearch.ts";
import type { FileViewerProps } from "./viewers.ts";

type PdfJs = typeof import("pdfjs-dist");
let pdfjs: Promise<PdfJs> | null = null;
const loadPdfJs = () =>
  (pdfjs ??= import("pdfjs-dist").then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = workerUrl;
    return lib;
  }));

/** O espaço em volta das páginas, e entre elas. */
const GUTTER = 24;
/** O ajuste à largura não passa disto: numa janela larga, a página de carta ficaria enorme. */
const FIT_MAX = 1.5;

interface Size {
  width: number;
  height: number;
}

type Problem = "password" | "error";

export function PdfViewer({ path, file }: FileViewerProps) {
  const base64 = "base64" in file ? file.base64 : "";
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<Size[]>([]);
  const [problem, setProblem] = useState<Problem | null>(null);
  /** `null`: ajustado à largura. */
  const [zoom, setZoom] = useState<number | null>(null);
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<PdfMatch[] | null>(null);
  const [current, setCurrent] = useState(-1);
  const [searching, setSearching] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const texts = useRef<Promise<PageText[]> | null>(null);

  // Abre o documento. Outro arquivo, ou o mesmo que mudou no disco: fecha o de antes.
  useEffect(() => {
    let alive = true;
    let task: PDFDocumentLoadingTask | null = null;
    setDoc(null);
    setSizes([]);
    setProblem(null);
    setMatches(null);
    setCurrent(-1);
    texts.current = null;
    void (async () => {
      try {
        const lib = await loadPdfJs();
        if (!alive) return;
        task = lib.getDocument({
          data: bytesOf(base64),
          useWorkerFetch: false,
          useWasm: false,
          useSystemFonts: true,
          verbosity: 0,
        });
        const pdf = await task.promise;
        const all: Size[] = [];
        for (let n = 1; n <= pdf.numPages; n++) {
          const viewport = (await pdf.getPage(n)).getViewport({ scale: 1 });
          all.push({ width: viewport.width, height: viewport.height });
          if (!alive) return;
        }
        setSizes(all);
        setDoc(pdf);
      } catch (e) {
        if (alive) setProblem((e as { name?: string })?.name === "PasswordException" ? "password" : "error");
      }
    })();
    return () => {
      alive = false;
      void task?.destroy();
    };
  }, [base64, path]);

  // A largura disponível, para o ajuste à largura.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [doc]);

  const widest = useMemo(() => sizes.reduce((w, s) => Math.max(w, s.width), 0), [sizes]);
  const scale = zoom ?? Math.min(FIT_MAX, fitWidth(widest, width - GUTTER * 2));

  // A página que está na tela, pela rolagem.
  const tops = useMemo(() => {
    let y = GUTTER;
    return sizes.map((s) => {
      const top = y;
      y += s.height * scale + GUTTER;
      return top;
    });
  }, [sizes, scale]);
  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const middle = el.scrollTop + el.clientHeight / 3;
    let at = 0;
    for (let i = 0; i < tops.length; i++) if (tops[i]! <= middle) at = i;
    setPage(at + 1);
  }, [tops]);

  /** O texto de todas as páginas, lido uma vez por documento, na primeira busca. */
  const loadTexts = useCallback((pdf: PDFDocumentProxy) => {
    texts.current ??= (async () => {
      const pages: PageText[] = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        const content = await (await pdf.getPage(n)).getTextContent();
        pages.push(pageText(content.items.filter((i): i is typeof i & PdfTextItem => "str" in i)));
      }
      return pages;
    })();
    return texts.current;
  }, []);

  // A busca, um pouco depois da última tecla.
  useEffect(() => {
    if (!doc) return;
    if (!query.trim()) {
      setMatches(null);
      setCurrent(-1);
      setSearching(false);
      return;
    }
    let alive = true;
    setSearching(true);
    const timer = setTimeout(() => {
      loadTexts(doc).then(
        (pages) => {
          if (!alive) return;
          const found = findInPages(pages, query);
          setMatches(found);
          setCurrent(found.length ? 0 : -1);
          setSearching(false);
        },
        () => {
          if (!alive) return;
          setMatches([]);
          setCurrent(-1);
          setSearching(false);
        },
      );
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [doc, query, loadTexts]);

  // O achado da vez vai para a tela.
  useEffect(() => {
    const el = scroller.current;
    const match = matches && current >= 0 ? matches[current] : undefined;
    const size = match ? sizes[match.page - 1] : undefined;
    if (!el || !match || !size) return;
    // Em páginas sem rotação, o y do pdf cresce para cima: o topo do achado é a altura menos o y2.
    const top = tops[match.page - 1]! + Math.max(0, size.height - match.rects[0]![3]) * scale;
    el.scrollTo({ top: Math.max(0, top - el.clientHeight / 3) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, matches]);

  const step = (direction: 1 | -1) => setCurrent((c) => stepMatch(c, matches?.length ?? 0, direction));
  const byPage = useMemo(() => {
    const map = new Map<number, { rects: PdfRect[]; current: boolean }[]>();
    matches?.forEach((m, i) => {
      const list = map.get(m.page) ?? [];
      list.push({ rects: m.rects, current: i === current });
      map.set(m.page, list);
    });
    return map;
  }, [matches, current]);

  if (problem) {
    return (
      <div className="kn-file-notice" role="status">
        <p>{problem === "password" ? "Este pdf tem senha. Para ler, abra no app padrão." : "Não deu para abrir este pdf."}</p>
      </div>
    );
  }

  const count = matches === null ? "" : searching ? "" : matches.length ? `${current + 1} de ${matches.length.toLocaleString("pt-BR")}` : "Nada encontrado";

  return (
    <div className="kn-file-pdf" aria-busy={doc ? undefined : "true"}>
      <div className="kn-file-pdf-bar" role="toolbar" aria-label="Pdf">
        <span className="kn-file-pdf-group">
          <button type="button" className="kn-bt" aria-label="Diminuir o zoom" disabled={!doc} onClick={() => setZoom(stepZoom(scale, -1))}>
            −
          </button>
          <span className="kn-file-pdf-zoom" aria-live="polite">{`${Math.round(scale * 100)}%`}</span>
          <button type="button" className="kn-bt" aria-label="Aumentar o zoom" disabled={!doc} onClick={() => setZoom(stepZoom(scale, 1))}>
            +
          </button>
          <button type="button" className="kn-bt" disabled={!doc || zoom === null} onClick={() => setZoom(null)}>
            Ajustar à largura
          </button>
        </span>
        <span className="kn-file-pdf-page" aria-live="polite">
          {doc ? `Página ${page} de ${doc.numPages}` : ""}
        </span>
        <span className="kn-file-pdf-group kn-file-pdf-find">
          <input
            className="kn-file-pdf-query"
            type="search"
            placeholder="Buscar no pdf"
            aria-label="Buscar no pdf"
            value={query}
            disabled={!doc}
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
      <div className="kn-file-pdf-scroll" ref={scroller} onScroll={onScroll}>
        {doc
          ? sizes.map((size, i) => (
              <PdfPage key={i} doc={doc} number={i + 1} size={size} scale={scale} root={scroller} marks={byPage.get(i + 1)} />
            ))
          : null}
      </div>
    </div>
  );
}

interface PageProps {
  doc: PDFDocumentProxy;
  number: number;
  size: Size;
  scale: number;
  root: React.RefObject<HTMLDivElement | null>;
  marks?: { rects: PdfRect[]; current: boolean }[];
}

/** Uma página: o lugar dela sempre, e o canvas só quando está perto da tela. */
function PdfPage({ doc, number, size, scale, root, marks }: PageProps) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);
  const [viewport, setViewport] = useState<PageViewport | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // Uma tela de folga para cima e para baixo: a página já está desenhada quando chega.
    const observer = new IntersectionObserver(([entry]) => setNear(Boolean(entry?.isIntersecting)), { root: root.current, rootMargin: "100% 0px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [root]);

  useEffect(() => {
    if (!near) {
      setViewport(null);
      return;
    }
    let alive = true;
    let task: RenderTask | null = null;
    void (async () => {
      try {
        const page = await doc.getPage(number);
        const target = canvas.current;
        if (!alive || !target) return;
        const view = page.getViewport({ scale });
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        target.width = Math.floor(view.width * ratio);
        target.height = Math.floor(view.height * ratio);
        setViewport(view);
        task = page.render({ canvas: target, viewport: view, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
        await task.promise;
        if (alive) box.current?.setAttribute("data-rendered", "true");
      } catch (e) {
        // Trocar o zoom ou sair da tela no meio do desenho cancela: não é erro.
        if (alive && (e as { name?: string })?.name !== "RenderingCancelledException") box.current?.setAttribute("data-rendered", "error");
      }
    })();
    return () => {
      alive = false;
      task?.cancel();
      box.current?.removeAttribute("data-rendered");
    };
  }, [doc, number, scale, near]);

  return (
    <div
      ref={box}
      className="kn-file-pdf-sheet"
      data-page={number}
      style={{ width: Math.floor(size.width * scale), height: Math.floor(size.height * scale) }}
      aria-label={`Página ${number}`}
    >
      {near ? <canvas ref={canvas} className="kn-file-pdf-canvas" /> : null}
      {viewport && marks
        ? marks.flatMap((mark, m) =>
            mark.rects.map((rect, r) => {
              const [x1, y1] = viewport.convertToViewportPoint(rect[0], rect[1]) as [number, number];
              const [x2, y2] = viewport.convertToViewportPoint(rect[2], rect[3]) as [number, number];
              return (
                <span
                  key={`${m}-${r}`}
                  className="kn-file-pdf-mark"
                  data-current={mark.current ? "true" : undefined}
                  style={{ left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) }}
                />
              );
            }),
          )
        : null}
    </div>
  );
}
