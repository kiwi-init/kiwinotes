// O docx dentro das Notas (T7110, spec #7079): o texto formatado, com títulos, listas, tabelas e imagens, pelo mammoth
// (BSD-2-Clause), que vai no pack da UI e só carrega quando um docx abre. Só leitura: para editar, "Abrir no app
// padrão". O HTML do mammoth não entra na página como HTML: `docx.ts` o lê e só o que está na lista vira elemento.
// Um link de fora abre no navegador padrão; uma âncora (nota de rodapé) rola dentro do documento.

import { createElement, type ReactNode, useEffect, useRef, useState } from "react";

import { bytesOf } from "./csv.ts";
import { type DocNode, docWarnings, ID_PREFIX, parseDocHtml } from "./docx.ts";
import { checkZip, MAX_DOC_HTML } from "./zipSize.ts";
import type { FileViewerProps } from "./viewers.ts";

type State = { kind: "loading" } | { kind: "ready"; nodes: DocNode[]; warnings: number } | { kind: "tooLarge" } | { kind: "error" };

export function DocxViewer({ file }: FileViewerProps) {
  const base64 = "base64" in file ? file.base64 : "";
  const [state, setState] = useState<State>({ kind: "loading" });
  const page = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    void (async () => {
      try {
        const bytes = bytesOf(base64);
        // Antes do mammoth, o tamanho aberto (revisão do T7110): um docx pequeno pode descompactar em centenas de MB.
        const zip = checkZip(bytes);
        if (!zip.ok) {
          if (alive) setState({ kind: zip.reason === "too-large" ? "tooLarge" : "error" });
          return;
        }
        const mammoth = (await import("mammoth")).default;
        const r = await mammoth.convertToHtml(
          { arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer },
          // Os arquivos de fora que um docx pode apontar ficam desligados (o padrão do mammoth, escrito aqui de propósito).
          { idPrefix: ID_PREFIX, externalFileAccess: false },
        );
        if (!alive) return;
        // O que o tamanho do zip não pega: uma parte pequena que vira muito HTML.
        if (r.value.length > MAX_DOC_HTML) return setState({ kind: "tooLarge" });
        setState({ kind: "ready", nodes: parseDocHtml(r.value), warnings: docWarnings(r.messages) });
      } catch {
        if (alive) setState({ kind: "error" });
      }
    })();
    return () => {
      alive = false;
    };
  }, [base64]);

  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute("href");
    if (!href) return;
    if (href.startsWith("#")) {
      page.current?.querySelector(`[id="${href.slice(1)}"]`)?.scrollIntoView({ block: "center" });
      return;
    }
    // O `newWindow: "external"` da janela manda para o navegador padrão; `href` já passou pelo `externalUrl`.
    window.open(href, "_blank", "noopener,noreferrer");
  };

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
  if (state.kind === "loading") return <div className="kn-file-docx" aria-busy="true" />;
  return (
    <div className="kn-file-docx">
      {state.warnings ? (
        <div className="kn-file-text-note kn-file-docx-note" role="status">
          Parte da formatação deste documento não aparece aqui. Para ver como ele é, abra no app padrão.
        </div>
      ) : null}
      {/* biome-ignore lint: o clique só trata links (a navegação é do teclado, pelos <a>) */}
      <div className="kn-file-docx-page" ref={page} onClick={onClick}>
        {render(state.nodes)}
      </div>
    </div>
  );
}

function render(nodes: DocNode[]): ReactNode[] {
  return nodes.map((n, i) => (typeof n === "string" ? n : createElement(n.tag, { key: i, ...n.attrs }, ...(n.children.length ? [render(n.children)] : []))));
}
