// Um arquivo do cofre que não é nota, aberto no lugar da nota (spec #7079, T7103): o nome no topo, o botão "Abrir no
// app padrão" (e, num .html, o "Prévia", T19314) e, embaixo, o visualizador do tipo (`viewers.ts`). O view só lê: nada
// aqui escreve no arquivo. Sem visualizador, grande demais ou com erro, vem o cartão do arquivo (T19316, spec #19277):
// o nome, o tipo, o tamanho, "Abrir no app padrão" e "Mostrar no Finder", nunca uma tela vazia. Com o cartão, o botão
// sai do topo (um só, #19747). Sumido, ele só diz o que houve.

import { type MutableRefObject, type ReactNode, Suspense, useEffect, useRef, useState } from "react";

import type { VaultFile } from "../types.ts";

import { fileSize } from "../../../src/shared/file-view.ts";
import { isPackageName, modified, typeLabel } from "./fileCard.ts";
import { fileType } from "../tree.ts";
import { isHtmlFile } from "./htmlPreview.ts";
import { TreeIcon } from "../treeIcons.tsx";
import { type FilesApi, type FileState, type FileViewer, loadFile, viewerFor } from "./viewers.ts";
import "./files.css";
import type { KiwiSheetSource } from "./kiwi-sheet.ts";

export type { FilesApi };

interface Props {
  files: FilesApi;
  path: string;
  /** O "Abrir no app padrão": quem abre é as Notas, que já sabem dizer quando não deu. */
  onOpenExternal(path: string): void;
  /** O "Mostrar no Finder" do cartão. Sem ele (um engine antigo), o cartão só tem o app padrão. */
  onReveal?(path: string): void;
  /** O tamanho e a data do arquivo, para o cartão: da árvore, ou do engine. `null` se não deu para saber. */
  stat?(path: string): Promise<VaultFile | null>;
  /** O "grava antes de sair" do visualizador que edita (T7105); as Notas chamam antes de trocar de nota ou de view. */
  flushRef: MutableRefObject<(() => Promise<boolean>) | null>;
  /** As alças da largura da nota (spec #13383), para o visualizador de texto. */
  widthHandles?: ReactNode;
  /** O Kiwi Cat editando a planilha ao vivo (T21114). */
  kiwi?: KiwiSheetSource;
  /** Só para testes e para os PRs dos formatos: no app, o visualizador vem do registro. */
  viewer?: FileViewer;
}

export function FileView({ files, path, onOpenExternal, onReveal, stat, flushRef, widthHandles, kiwi, viewer = viewerFor(path) }: Props) {
  const [state, setState] = useState<FileState>({ kind: "loading" });
  const [info, setInfo] = useState<VaultFile | null>(null);
  const generation = useRef(0);
  const name = path.split("/").at(-1)!;
  // O .html abre com a prévia ao lado do código (T19314); o botão "Prévia" a esconde para dar a largura ao código.
  const [preview, setPreview] = useState(true);
  const html = isHtmlFile(path);

  useEffect(() => {
    let alive = true;
    // Duas leituras seguidas podem chegar fora de ordem: só a última pedida vale (revisão do T7103).
    const load = () => {
      const mine = ++generation.current;
      void loadFile(files.read, path, viewer).then((s) => {
        if (alive && mine === generation.current) setState(s);
      });
    };
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

  const card = state.kind === "unsupported" || state.kind === "tooLarge" || state.kind === "error";
  // O cartão sem o tamanho na mão (o grande demais já o tem) pergunta à árvore ou ao engine, uma vez por arquivo.
  useEffect(() => {
    setInfo(null);
  }, [path]);
  useEffect(() => {
    if (!card || !stat) return;
    let alive = true;
    void stat(path).then(
      (f) => alive && setInfo(f && f.path === path ? f : null),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [card, stat, path]);

  const open = (
    <button type="button" className="kn-bt kn-file-open" onClick={() => onOpenExternal(path)}>
      Abrir no app padrão
    </button>
  );
  // O tamanho de um pacote seria o da pasta, não o do documento: fica de fora (revisão #19798).
  const size = state.kind === "tooLarge" ? state.size : isPackageName(name) ? undefined : info?.size;
  const fileCard = (text: string) => (
    <section className="kn-file-notice kn-file-card" role="status" aria-label={name}>
      <span className="kn-file-card-icon" aria-hidden="true">
        <TreeIcon name={fileType(name)} />
      </span>
      <h2 className="kn-file-card-name">{name}</h2>
      <dl className="kn-file-card-facts">
        <div>
          <dt>Tipo</dt>
          <dd>{typeLabel(name)}</dd>
        </div>
        {size !== undefined ? (
          <div>
            <dt>Tamanho</dt>
            <dd>{fileSize(size)}</dd>
          </div>
        ) : null}
        {info?.mtime ? (
          <div>
            <dt>Modificado</dt>
            <dd>{modified(info.mtime)}</dd>
          </div>
        ) : null}
      </dl>
      <p>{text}</p>
      <div className="kn-file-card-actions">
        {open}
        {onReveal ? (
          <button type="button" className="kn-bt kn-file-reveal" onClick={() => onReveal(path)}>
            Mostrar no Finder
          </button>
        ) : null}
      </div>
    </section>
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
        {card ? null : (
          <span className="kn-file-actions">
            {html && state.kind === "ready" ? (
              <button type="button" className="kn-bt kn-file-preview-toggle" aria-pressed={preview} onClick={() => setPreview((on) => !on)}>
                Prévia
              </button>
            ) : null}
            {open}
          </span>
        )}
      </header>
      <div className="kn-file-body" aria-busy={state.kind === "loading" ? "true" : undefined}>
        {state.kind === "ready" ? (
          // Um visualizador pesado (o pdf) chega depois, por import dinâmico.
          <Suspense fallback={null}>
            <state.viewer.View path={path} file={state.file} files={files} flushRef={flushRef} widthHandles={widthHandles} preview={html && preview} kiwi={kiwi} />
          </Suspense>
        ) : state.kind === "tooLarge" ? (
          fileCard(`Este arquivo tem ${fileSize(state.size)}, e o Kiwi Notes mostra aqui até ${fileSize(state.limit)}.`)
        ) : state.kind === "unsupported" ? (
          fileCard("O Kiwi Notes não mostra este tipo de arquivo aqui. Ele abre no app padrão do Mac.")
        ) : state.kind === "missing" ? (
          <div className="kn-file-notice" role="alert">
            <p>Este arquivo não está mais na pasta das notas. Ele pode ter sido movido ou apagado fora do Kiwi Notes.</p>
          </div>
        ) : state.kind === "error" ? (
          fileCard("Não deu para ler este arquivo.")
        ) : null}
      </div>
    </div>
  );
}
