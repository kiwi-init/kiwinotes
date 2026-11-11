// Um arquivo do cofre que não é nota, aberto no lugar da nota (spec #7079, T7103): o nome no topo, o botão "Abrir no
// app padrão" e, embaixo, o visualizador do tipo (`viewers.ts`). O view só lê: nada aqui escreve no arquivo. Grande
// demais, sem visualizador, sumido ou com erro, ele diz o que houve e oferece o app padrão.

import { useEffect, useState } from "react";

import { fileSize } from "../../../src/shared/file-view.ts";
import { fileType } from "../tree.ts";
import { TreeIcon } from "../treeIcons.tsx";
import type { NotesApi } from "../types.ts";
import { type FileState, type FileViewer, loadFile, viewerFor } from "./viewers.ts";
import "./files.css";

export type FilesApi = NonNullable<NotesApi["files"]> & { read: NonNullable<NonNullable<NotesApi["files"]>["read"]> };

interface Props {
  files: FilesApi;
  path: string;
  /** O "Abrir no app padrão": quem abre é as Notas, que já sabem dizer quando não deu. */
  onOpenExternal(path: string): void;
  /** Só para testes e para os PRs dos formatos: no app, o visualizador vem do registro. */
  viewer?: FileViewer;
}

export function FileView({ files, path, onOpenExternal, viewer = viewerFor(path) }: Props) {
  const [state, setState] = useState<FileState>({ kind: "loading" });
  const name = path.split("/").at(-1)!;

  useEffect(() => {
    let alive = true;
    const load = () =>
      void loadFile(files.read, path, viewer).then((s) => {
        if (alive) setState(s);
      });
    setState({ kind: "loading" });
    load();
    // Mudou no disco (outro app gravou): o view lê de novo, sem piscar o "carregando".
    const off = files.onChanged((paths) => {
      if (!paths.length || paths.includes(path)) load();
    });
    return () => {
      alive = false;
      off();
    };
  }, [files, path, viewer]);

  const open = (
    <button type="button" className="kn-bt kn-file-open" onClick={() => onOpenExternal(path)}>
      Abrir no app padrão
    </button>
  );
  const notice = (text: string) => (
    <div className="kn-file-notice" role="status">
      <p>{text}</p>
      {open}
    </div>
  );

  return (
    <div className="kn-file" data-state={state.kind}>
      <header className="kn-file-head">
        <span className="kn-file-icon" aria-hidden="true">
          <TreeIcon name={fileType(name)} />
        </span>
        <h1 className="kn-file-title" title={path}>
          {name}
        </h1>
        {state.kind === "ready" ? <span className="kn-file-meta">{fileSize(state.file.size)}</span> : null}
        <span className="kn-file-actions">{open}</span>
      </header>
      <div className="kn-file-body" aria-busy={state.kind === "loading" ? "true" : undefined}>
        {state.kind === "ready" ? (
          <state.viewer.View path={path} file={state.file} />
        ) : state.kind === "tooLarge" ? (
          notice(`Este arquivo tem ${fileSize(state.size)}, e o Kiwi Notes mostra aqui até ${fileSize(state.limit)}.`)
        ) : state.kind === "unsupported" ? (
          notice("O Kiwi Notes ainda não mostra este tipo de arquivo aqui.")
        ) : state.kind === "missing" ? (
          <div className="kn-file-notice" role="alert">
            <p>Este arquivo não está mais na pasta das notas. Ele pode ter sido movido ou apagado fora do Kiwi Notes.</p>
          </div>
        ) : state.kind === "error" ? (
          notice("Não deu para ler este arquivo.")
        ) : null}
      </div>
    </div>
  );
}
