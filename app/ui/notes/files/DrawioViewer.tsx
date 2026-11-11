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

import viewerUrl from "./drawio/viewer-static.min.js?url";
import { useEffect, useMemo, useRef, useState } from "react";

import { checkDrawio } from "./drawio.ts";
import { installDrawioGuard, pointViewerAtPack } from "./drawioGuard.ts";
import type { FileViewerProps } from "./viewers.ts";

/** As dicas da barra do viewer em português (sem os textos dele, que viriam da rede, elas ficariam em inglês). */
const TOOLBAR_PT = [
  "previousPage=Página anterior",
  "nextPage=Próxima página",
  "zoomOut=Diminuir o zoom",
  "zoomIn=Aumentar o zoom",
  "fit=Ajustar à janela",
  "layers=Camadas",
].join("\n");

interface DrawioGlobals {
  mxResources?: { parse(text: string): void };
  GraphViewer?: new (container: HTMLElement, xml: Element, config: Record<string, unknown>) => { graph?: unknown; destroy?: () => void };
  mxUtils?: { parseXml(xml: string): Document };
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

export function DrawioViewer({ file }: FileViewerProps) {
  const text = "text" in file ? file.text : "";
  const box = useRef<HTMLDivElement>(null);
  // O arquivo é conferido antes do viewer carregar: um que não é diagrama, ou que passa do teto, nem chega nele.
  const check = useMemo(() => checkDrawio(text), [text]);
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    const host = box.current;
    if (!host) return;
    if (!check.ok) {
      setState({ kind: check.reason === "too-large" ? "tooLarge" : "error" });
      return;
    }
    setState({ kind: "loading" });
    let viewer: { destroy?: () => void } | null = null;
    const container = document.createElement("div");
    container.className = "kn-file-drawio-graph";
    loadViewer().then(
      (dx) => {
        if (!alive) return;
        try {
          host.replaceChildren(container);
          const xml = dx.mxUtils!.parseXml(text).documentElement;
          viewer = new dx.GraphViewer!(container, xml, {
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
      viewer?.destroy?.();
      host.replaceChildren();
    };
  }, [text, check]);

  const failed = state.kind === "tooLarge" || state.kind === "error";
  return (
    <div className="kn-file-drawio" data-state={state.kind}>
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
