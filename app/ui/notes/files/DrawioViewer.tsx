// O `.drawio` dentro das Notas (T7112, spec #7079): o diagrama pelo viewer oficial do draw.io (JGraph, Apache-2.0),
// com as páginas, o zoom e a rolagem dele. Só leitura. O viewer vai no pack (`files/drawio/`, versão e sha256 fixos em
// `scripts/drawio-viewer.ts`) e só carrega quando um diagrama abre.
//
// A exceção (escolha B do harry, #7312): o viewer põe na página o HTML dos rótulos do diagrama, limpo pelo DOMPurify
// que vem nele. Em todo o resto, a janela Notas nunca põe HTML de um arquivo na página. Rede e `eval` seguem
// bloqueados pela CSP das views: os caminhos de recursos apontam para o próprio pack, e nada sai para a internet. Um
// rótulo ou uma forma com imagem de fora nem tenta buscá-la, nem a fonte ou a fórmula de fora (`drawioGuard.ts`).
// O HTML dos rótulos fica preso na área do diagrama (`contain: paint` em `files.css`): um `position: fixed` não cobre
// o resto da janela.
//
// A pinça e o ⌘+/⌘−/⌘0 (T22178, spec #21198) usam o zoom do próprio viewer, e o papel branco cresce junto: o diagrama
// segue nítido, e o clique e o link continuam caindo onde o viewer espera. Os botões de zoom da barra dele fazem o mesmo.

import viewerUrl from "./drawio/viewer-static.min.js?url";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FindBar, useFindKey } from "../FindBar.tsx";
import { findIds, stepFind } from "../find.ts";
import { checkDrawio, drawioPages } from "./drawio.ts";
import { installDrawioGuard, pointViewerAtPack } from "./drawioGuard.ts";
import { useViewerZoom } from "./useViewerZoom.ts";
import type { FileViewerProps } from "./viewers.ts";
import { recallZoom, rememberZoom } from "./zoom.ts";

/** Os limites do zoom, em vezes o ajuste à janela. */
const DRAWIO_ZOOM = { min: 0.25, max: 4 };


/** As dicas da barra do viewer em português (sem os textos dele, que viriam da rede, elas ficariam em inglês). */
const TOOLBAR_PT = [
  "previousPage=Página anterior",
  "nextPage=Próxima página",
  "zoomOut=Diminuir o zoom",
  "zoomIn=Aumentar o zoom",
  "fit=Ajustar à janela",
  "layers=Camadas",
].join("\n");

/** O pouco do mxGraph que o ⌘F usa (T22217): a célula pelo id e onde ela está desenhada. */
interface DrawioCellState {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** O pedaço do grafo do viewer (mxGraph) que o ⌘F e o zoom (T22178) usam. */
interface DrawioGraph {
  container?: HTMLElement;
  centerZoom?: boolean;
  model: { getCell(id: string): unknown };
  view: {
    getState(cell: unknown): DrawioCellState | null;
    scale: number;
    setScale(scale: number): void;
    scaleAndTranslate(scale: number, dx: number, dy: number): void;
    addListener(name: string, fn: () => void): void;
    removeListener(fn: () => void): void;
  };
  initialViewState?: { scale: number; translate: { x: number; y: number } };
}

interface DrawioViewerInstance {
  graph?: DrawioGraph;
  currentPage?: number;
  selectPage?(index: number): void;
  destroy?: () => void;
}

interface DrawioHighlight {
  highlight(state: unknown): void;
  destroy(): void;
}

interface DrawioGlobals {
  mxResources?: { parse(text: string): void };
  GraphViewer?: new (container: HTMLElement, xml: Element, config: Record<string, unknown>) => DrawioViewerInstance;
  mxUtils?: { parseXml(xml: string): Document };
  mxCellHighlight?: new (graph: DrawioGraph, color: string, strokeWidth: number) => DrawioHighlight;
}

let loading: Promise<DrawioGlobals> | null = null;

function loadViewer(): Promise<DrawioGlobals> {
  loading ??= new Promise<DrawioGlobals>((resolve, reject) => {
    const w = window as unknown as Record<string, unknown> & DrawioGlobals;
    // Os caminhos que o viewer usaria na internet passam a apontar para o pack: o que ele pedir não sai do app.
    pointViewerAtPack(w);
    const script = document.createElement("script");
    script.src = viewerUrl;
    script.onload = () => {
      if (!w.GraphViewer) return reject(new Error("draw.io viewer did not load"));
      installDrawioGuard(w as Parameters<typeof installDrawioGuard>[0]);
      w.mxResources?.parse(TOOLBAR_PT);
      resolve(w);
    };
    script.onerror = () => reject(new Error("draw.io viewer did not load"));
    document.head.appendChild(script);
  }).catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

type State = { kind: "loading" } | { kind: "ready" } | { kind: "tooLarge" } | { kind: "error" };

export function DrawioViewer({ path, file }: FileViewerProps) {
  const text = "text" in file ? file.text : "";
  const box = useRef<HTMLDivElement>(null);
  // O arquivo é conferido antes do viewer carregar: um que não é diagrama, ou que passa do teto, nem chega nele.
  const check = useMemo(() => checkDrawio(text), [text]);
  const [state, setState] = useState<State>({ kind: "loading" });
  const wrap = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<{ viewer: DrawioViewerInstance; dx: DrawioGlobals } | null>(null);
  const mark = useRef<DrawioHighlight | null>(null);

  // ---------------------------------------------------------------- o ⌘F (T22217)

  // Os rótulos de todas as páginas, na ordem delas: o id de cada um é `página:célula`.
  const labels = useMemo(
    () => (check.ok ? (drawioPages(text) ?? []) : []).flatMap((p, page) => p.labels.map((l) => ({ id: `${page}:${l.id}`, text: l.text }))),
    [text, check],
  );
  const [find, setFind] = useState<{ query: string; index: number } | null>(null);
  const findInput = useRef<HTMLInputElement>(null);
  const found = useMemo(() => (find ? findIds(labels, find.query) : []), [labels, find?.query]);

  const unmark = () => {
    mark.current?.destroy();
    mark.current = null;
  };
  // O achado da vez: a página dele na frente, a célula com o contorno verde, e o diagrama rolado até ela.
  const goToFound = (index: number) => {
    setFind((f) => (f ? { ...f, index } : f));
    unmark();
    const id = found[index];
    const v = viewerRef.current;
    if (id === undefined || !v) return;
    const cut = id.indexOf(":");
    const page = Number(id.slice(0, cut));
    try {
      if (v.viewer.currentPage !== page) v.viewer.selectPage?.(page);
      const graph = v.viewer.graph;
      const cell = graph?.model.getCell(id.slice(cut + 1));
      const shown = cell ? graph!.view.getState(cell) : null;
      if (!graph || !shown || !v.dx.mxCellHighlight) return;
      mark.current = new v.dx.mxCellHighlight(graph, "#2ea05a", 4);
      mark.current.highlight(shown);
      // A área rola, o papel do diagrama não (overflow hidden): o meio da célula vai para o meio da área.
      const area = box.current;
      const paper = graph.container?.getBoundingClientRect();
      if (area && paper) {
        const a = area.getBoundingClientRect();
        area.scrollBy({
          left: paper.left + shown.x + shown.width / 2 - (a.left + a.width / 2),
          top: paper.top + shown.y + shown.height / 2 - (a.top + a.height / 2),
        });
      }
    } catch {
      // Uma célula numa camada escondida, ou que o viewer não desenhou: a contagem anda, sem o contorno.
    }
  };
  useEffect(() => {
    if (find && found.length && (find.index < 0 || find.index >= found.length)) goToFound(0);
    if (find && !found.length) unmark();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [found]);
  const openFind = () => {
    if (state.kind !== "ready") return;
    if (find) findInput.current?.select();
    else setFind({ query: "", index: -1 });
  };
  const closeFind = () => {
    unmark();
    setFind(null);
  };
  useFindKey(wrap, openFind);

  // O zoom (T22178), em vezes o ajuste à janela que o viewer escolheu ao abrir (`fit`). O papel tem o tamanho do ajuste
  // vezes o zoom; o diagrama cresce a partir do canto dele, e o ponto embaixo dos dedos fica parado pela rolagem.
  const graph = useRef<{ g: DrawioGraph; fit: number; width: number; height: number } | null>(null);
  const [scale, setScale] = useState(1);
  const zoomTo = useCallback((z: number | null) => {
    const v = graph.current;
    if (!v) return;
    const init = v.g.initialViewState;
    if (z === null && init) v.g.view.scaleAndTranslate(init.scale, init.translate.x, init.translate.y);
    else v.g.view.setScale(v.fit * (z ?? 1));
  }, []);
  useViewerZoom({ path, target: box, scale, set: zoomTo, ...DRAWIO_ZOOM, anchor: ".kn-file-drawio-graph", enabled: state.kind === "ready" });

  useEffect(() => {
    let alive = true;
    const host = box.current;
    if (!host) return;
    if (!check.ok) {
      setState({ kind: check.reason === "too-large" ? "tooLarge" : "error" });
      return;
    }
    setState({ kind: "loading" });
    let viewer: DrawioViewerInstance | null = null;
    let unlisten = () => {};
    const container = document.createElement("div");
    container.className = "kn-file-drawio-graph";
    loadViewer().then(
      (dx) => {
        if (!alive) return;
        try {
          host.replaceChildren(container);
          const xml = dx.mxUtils!.parseXml(text).documentElement;
          const made = new dx.GraphViewer!(container, xml, {
            toolbar: "pages zoom layers",
            "toolbar-nohide": true,
            nav: true,
            resize: false,
            center: true,
            lightbox: false,
            edit: null,
            "auto-fit": true,
            highlight: "#2ea05a",
          });
          viewer = made;
          viewerRef.current = { viewer, dx };
          const g = made.graph;
          if (g) {
            // O zoom da barra do viewer, sem mexer no deslocamento: o diagrama cresce do canto, como o papel.
            g.centerZoom = false;
            const fit = g.view.scale;
            const v = { g, fit, width: container.offsetWidth, height: container.offsetHeight };
            graph.current = v;
            const sync = () => {
              const k = g.view.scale / fit;
              container.style.width = `${v.width * k}px`;
              container.style.height = `${v.height * k}px`;
              const fitted = Math.abs(k - 1) < 1e-4 && (!g.initialViewState || g.view.scale === g.initialViewState.scale);
              rememberZoom(path, fitted ? null : k);
              setScale(k);
            };
            g.view.addListener("scale", sync);
            g.view.addListener("scaleAndTranslate", sync);
            unlisten = () => g.view.removeListener(sync);
            const z = recallZoom(path);
            if (z !== null) g.view.setScale(fit * z);
            else setScale(1);
          }
          setState({ kind: "ready" });
        } catch {
          host.replaceChildren();
          setState({ kind: "error" });
        }
      },
      () => alive && setState({ kind: "error" }),
    );
    return () => {
      alive = false;
      mark.current?.destroy();
      mark.current = null;
      viewerRef.current = null;
      setFind(null);
      unlisten();
      graph.current = null;
      viewer?.destroy?.();
      host.replaceChildren();
    };
  }, [text, check, path]);

  const failed = state.kind === "tooLarge" || state.kind === "error";
  return (
    <div className="kn-file-drawio" data-state={state.kind} ref={wrap}>
      {find && state.kind === "ready" ? (
        <div className="kn-file-drawio-find">
          <FindBar
            label="Procurar no diagrama"
            query={find.query}
            index={find.index}
            total={found.length}
            inputRef={findInput}
            onQuery={(query) => setFind({ query, index: -1 })}
            onStep={(dir) => goToFound(stepFind(find.index, found.length, dir))}
            onClose={closeFind}
          />
        </div>
      ) : null}
      {failed ? (
        <div className="kn-file-notice" role="status">
          <p>{state.kind === "tooLarge" ? "Este diagrama é grande demais para abrir aqui. Abra no app padrão." : "Não deu para abrir este diagrama. Abra no app padrão."}</p>
        </div>
      ) : null}
      {/* A área fica montada mesmo com o aviso (escondida), para o próximo arquivo abrir nela. */}
      <div className="kn-file-drawio-area" ref={box} hidden={failed} aria-busy={state.kind === "loading" ? "true" : undefined} />
    </div>
  );
}
