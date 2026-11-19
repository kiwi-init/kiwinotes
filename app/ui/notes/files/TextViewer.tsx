// txt, log, json e yaml dentro das Notas (T7105, spec #7079), e o código (py, ts, css, html…, T19312): o texto num
// editor simples, que grava sozinho no arquivo. O código e o json/yaml ganham cor (`code-languages.ts`), carregada
// depois de o texto aparecer; o .txt e o .log seguem sem. Sem formatação: o arquivo sai como a pessoa escreveu, com o fim de linha que tinha (`\r\n` do
// Windows volta `\r\n`, embora o editor trabalhe em `\n`). Só é lido, sem gravar: um texto que não é UTF-8
// (`readOnly`), porque gravar trocaria os bytes que o Kiwi não entendeu, e um com fins de linha misturados, porque
// não há como devolver cada linha com o fim que tinha.
//
// O editor é o CodeMirror, o mesmo das notas .md, sem o Markdown (spec #13382). O `<textarea>` de antes refazia o
// texto inteiro a cada tecla: num .txt de 1 MB, de 47 a 53 ms por tecla no WebKit, e a escrita travava. O CodeMirror só
// desenha as linhas na tela, e a sessão lê o texto só quando grava. Como no .md, a gravação é silenciosa (sem
// "Gravando…/Gravado"), e o texto quebra na largura da nota. O ⌘F busca e troca (T19312); o código tem os números de
// linha, e o Tab recua como o arquivo já recua (T19403). O .html tem a prévia ao lado (T19314, `htmlPreview.ts`).

import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { indentUnit, syntaxHighlighting } from "@codemirror/language";
import { Annotation, Compartment, EditorSelection, EditorState, StateEffect, StateField, Transaction } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, lineNumbers } from "@codemirror/view";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api as appApi, has } from "../../src/api.ts";
import { ContextMenu, type MenuItem } from "../ContextMenu.tsx";
import { NoteWidthFrame } from "../NoteWidth.tsx";
import { editorMenu } from "../editor/context-menu.ts";
import { searchOnly } from "../editor/search-fold.ts";

import { codeHighlight, codeLanguageFor, isCodeFile } from "./code-languages.ts";
import { isHtmlFile, previewDocument } from "./htmlPreview.ts";
import { detectIndent } from "./indent.ts";
import { detectEol, TextSession, type TextSaveState, toEditor } from "./textSession.ts";
import { useViewerZoom } from "./useViewerZoom.ts";
import type { FileViewerProps } from "./viewers.ts";
import { type Point, recallZoom, type Scroll } from "./zoom.ts";

/**
 * A linha que a busca achou (T21240): um fundo nela, que se vê mesmo sem o foco no editor. Sai quando a pessoa escreve.
 */
const markFound = StateEffect.define<number | null>();
const foundLine = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    if (tr.docChanged) return Decoration.none;
    for (const e of tr.effects) if (e.is(markFound)) return e.value === null ? Decoration.none : Decoration.set([Decoration.line({ class: "kn-file-found" }).range(e.value)]);
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Uma troca que veio de fora (o arquivo mudou no disco): não é a pessoa digitando. */
const fromDisk = Annotation.define<boolean>();

const theme = EditorView.theme({
  "&": { height: "100%", color: "var(--text)", background: "none" },
  "&.cm-focused": { outline: "none" },
  // O zoom (T21238) muda o tamanho da letra, pela variável que o visualizador põe na caixa do editor.
  ".cm-scroller": { fontFamily: "var(--mono, var(--font-mono, ui-monospace, Menlo, monospace))", fontSize: "calc(13px * var(--kn-text-zoom, 1))", lineHeight: "1.6" },
  // A coluna da nota (spec #13382): a mesma largura do .md, no meio.
  ".cm-content": {
    boxSizing: "border-box",
    width: "100%",
    maxWidth: "var(--note-width, 760px)",
    margin: "0 auto",
    padding: "18px 40px 40px",
    caretColor: "var(--text)",
  },
  ".cm-line": { padding: "0" },
});

/**
 * Os números de linha do código (T19312). A coluna dos números e o texto andam juntos no meio, na largura da nota: a
 * margem automática da esquerda fica nos números, a da direita no texto.
 */
const codeGutter = [
  lineNumbers(),
  EditorView.theme({
    ".cm-gutters": { marginLeft: "auto", background: "none", border: "none", color: "var(--text-3)" },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 4px 0 12px", fontVariantNumeric: "tabular-nums" },
    ".cm-content": { margin: "0 auto 0 0", paddingLeft: "16px" },
  }),
];

/** A pausa na digitação antes de a prévia do .html desenhar de novo (T19314): uma página grande não pisca a cada tecla. */
export const PREVIEW_DELAY_MS = 300;

export function TextViewer({ path, file, files, flushRef, widthHandles, preview = false, at }: FileViewerProps) {
  const initial = "text" in file ? file : { text: "", version: file.version };
  const notUtf8 = "readOnly" in file && file.readOnly === true;
  const mixedEol = detectEol(initial.text) === null;
  const readOnly = !files.save || notUtf8 || mixedEol;
  const [state, setState] = useState<TextSaveState>("idle");
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [menuError, setMenuError] = useState<string | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // O zoom (T21238): a pinça e o ⌘+/⌘−/⌘0 mudam o tamanho da letra; o lugar que rola é o do CodeMirror. `null` é 100%.
  const scrollEl = useRef<HTMLElement | null>(null);
  const [editorOn, setEditorOn] = useState(false);
  const [zoom, setZoom] = useState<number | null>(() => recallZoom(path));
  useEffect(() => setZoom(recallZoom(path)), [path]);
  const z = zoom ?? 1;
  // O CodeMirror guarda a altura das linhas e segura a linha do alto quando elas mudam: a rolagem vai depois de ele
  // medir a letra nova, e põe a linha embaixo dos dedos de volta no mesmo lugar da tela, maior. Numa pinça, os passos
  // chegam antes de ele medir o anterior: a linha e o ponto nela ficam os do começo do gesto.
  const anchor = useRef<{ pos: number; unit: number; at: Point; t: number } | null>(null);
  const remeasure = useCallback(({ at, from, to }: { at: Point; from: number; to: number; scroll: Scroll }) => {
    const v = view.current;
    if (!v) return false;
    const now = performance.now();
    let a = anchor.current;
    if (!a || now - a.t > 400 || Math.abs(a.at.x - at.x) > 2 || Math.abs(a.at.y - at.y) > 2) {
      // A altura das linhas ainda é a de antes deste zoom: a linha embaixo dos dedos, e onde nela (em px a 100%).
      const y = at.y - (v.documentTop - v.scrollDOM.getBoundingClientRect().top);
      const line = v.lineBlockAtHeight(y);
      a = { pos: line.from, unit: (y - line.top) / from, at, t: now };
    }
    a.t = now;
    anchor.current = a;
    const { pos, unit } = a;
    // Depois de ele medir a letra nova: a linha vai pela rolagem do próprio CodeMirror, que também guarda a âncora dele
    // (um `scrollTop` direto, ele corrige de volta para a linha do alto).
    v.requestMeasure({
      // Ele alinha a caixa da letra, não o alto da linha: a diferença (metade do entrelinha) entra na margem.
      read: (u) => (u.coordsAtPos(pos)?.top ?? 0) - (u.documentTop + u.lineBlockAt(pos).top),
      write: (inset, u) => {
        const yMargin = at.y - unit * to + Math.max(0, inset);
        queueMicrotask(() => u.dispatch({ effects: EditorView.scrollIntoView(pos, { y: "start", yMargin }) }));
      },
    });
    return true;
  }, []);
  useViewerZoom({ path, target: scrollEl, scale: z, set: setZoom, min: 0.5, max: 3, onApplied: remeasure, enabled: editorOn });
  // A linguagem do código (T19312): `undefined` no .txt e no .log, que seguem sem cor nem o menu de código.
  const language = codeLanguageFor(path);
  const code = isCodeFile(path);
  const [colored, setColored] = useState(false);
  // A prévia do .html (T19314): o texto que ela desenha, atrás do editor por `PREVIEW_DELAY_MS`.
  const showPreview = preview && isHtmlFile(path);
  const [previewText, setPreviewText] = useState(initial.text);
  const previewOn = useRef(showPreview);
  previewOn.current = showPreview;
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Uma sessão por arquivo aberto (o `FileView` monta de novo a cada caminho).
  const session = useMemo(
    () =>
      new TextSession({
        text: initial.text,
        version: initial.version,
        save: (content, baseVersion) => files.save!(path, content, baseVersion),
        onState: setState,
        // O texto de fora entrou: troca no editor, sem contar como digitação e fora do desfazer (revisão do #533: um ⌘Z
        // logo depois desfazia a mudança de fora, e o texto antigo era gravado por cima dela).
        onText: (t) => {
          const v = view.current;
          if (!v || v.state.doc.toString() === t) return;
          v.dispatch({
            changes: { from: 0, to: v.state.doc.length, insert: t },
            annotations: [fromDisk.of(true), Transaction.addToHistory.of(false)],
          });
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [path],
  );

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const lang = new Compartment();
    // O Tab recua como o arquivo (T19403): tab, ou o passo de espaços dele; 4 no .py e 2 no resto, sem nada recuado.
    const indent = detectIndent(initial.text, path);
    const v = new EditorView({
      parent,
      state: EditorState.create({
        doc: toEditor(initial.text),
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorView.lineWrapping,
          EditorState.tabSize.of(indent.tabSize),
          indentUnit.of(indent.unit),
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          EditorView.contentAttributes.of({
            class: "kn-file-text-area",
            "aria-label": `Texto de ${path.split("/").at(-1)}`,
            "aria-multiline": "true",
            spellcheck: "false",
            autocapitalize: "off",
            autocorrect: "off",
            ...(readOnly ? { "aria-readonly": "true" } : {}),
          }),
          // O código ganha os números de linha; o tema dele vem antes do `theme`, porque no CodeMirror o tema de antes
          // ganha, e a margem do texto muda.
          ...(code ? [codeGutter] : []),
          theme,
          // ⌘F busca e troca, como na nota .md.
          searchOnly,
          foundLine,
          lang.of([]),
          // A pessoa digitou: a sessão só marca, e lê o texto inteiro quando grava (depois da pausa).
          EditorView.updateListener.of((u) => {
            if (u.docChanged && previewOn.current) {
              if (previewTimer.current) clearTimeout(previewTimer.current);
              previewTimer.current = setTimeout(() => setPreviewText(u.view.state.doc.toString()), PREVIEW_DELAY_MS);
            }
            if (!u.docChanged || u.transactions.some((tr) => tr.annotation(fromDisk))) return;
            session.touch(() => u.view.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    scrollEl.current = v.scrollDOM;
    setEditorOn(true);
    // A cor chega depois do texto: a linguagem é um import à parte, e o arquivo já pode ser lido e editado sem ela.
    let alive = true;
    setColored(false);
    if (language)
      void language()
        .then((ext) => {
          if (!alive) return;
          v.dispatch({ effects: lang.reconfigure([ext, syntaxHighlighting(codeHighlight)]) });
          setColored(true);
        })
        .catch(() => {
          // Sem a linguagem, o arquivo continua aberto e editável, só sem cor.
        });
    return () => {
      alive = false;
      if (previewTimer.current) clearTimeout(previewTimer.current);
      view.current = null;
      scrollEl.current = null;
      setEditorOn(false);
      v.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, readOnly]);

  // A linha da busca (T21240): rola até ela, no meio da tela, e a seleciona inteira.
  useEffect(() => {
    const v = view.current;
    if (!v || !at) return;
    const line = v.state.doc.line(Math.min(Math.max(1, Math.floor(at.line)), v.state.doc.lines));
    v.dispatch({ selection: { anchor: line.from, head: line.to }, effects: [markFound.of(line.from), EditorView.scrollIntoView(line.from, { y: "center" })] });
    v.focus();
  }, [at, session, readOnly]);

  useEffect(() => {
    if (readOnly) return;
    flushRef.current = () => session.flush();
    return () => {
      flushRef.current = null;
      // Trocar de view sem passar pelo `leave` (a janela fechando): o que falta ainda é gravado.
      void session.flush();
      session.dispose();
    };
  }, [flushRef, session, readOnly]);

  // A prévia voltou: desenha o texto de agora, que pode ter mudado enquanto ela estava escondida.
  useEffect(() => {
    if (showPreview && view.current) setPreviewText(view.current.state.doc.toString());
  }, [showPreview]);

  // O arquivo mudou no disco e o `FileView` leu de novo.
  useEffect(() => {
    if ("text" in file) session.external({ text: file.text, version: file.version });
  }, [file, session]);

  /**
   * O botão direito (spec #13385): o mesmo menu do .md, sem o que só existe numa nota. A formatação entra como Markdown
   * simples (`# `, `- `, `**`), e grava como qualquer digitação. Só leitura: sem menu.
   */
  const openMenu = (x: number, y: number, moveCursor: boolean) => {
    const v = view.current;
    if (!v || readOnly) return;
    if (moveCursor) {
      const pos = v.posAtCoords({ x, y });
      if (pos !== null && !v.state.selection.ranges.some((r) => pos >= r.from && pos <= r.to)) v.dispatch({ selection: EditorSelection.cursor(pos) });
    }
    const clipboard = {
      ...(has("clipboard.write") ? { write: (text: string) => appApi.copy(text) } : {}),
      ...(has("clipboard.read") ? { read: () => appApi.readClipboard() } : {}),
    };
    setMenu({ x, y, items: editorMenu(v, clipboard, setMenuError, undefined, undefined, { plain: true, code }) });
  };

  // Sem "Gravando…/Gravado" na tela (spec #13382): como numa nota .md, a gravação é silenciosa, e só o erro e o conflito
  // aparecem. O `data-save` diz o estado aos scripts de prova.
  return (
    <div className="kn-file-text" data-save={state} data-code={language ? (colored ? "colored" : "loading") : undefined}>
      {readOnly ? (
        <div className="kn-file-text-note" role="status">
          {notUtf8
            ? "Este arquivo não está em UTF-8. Aqui ele só é lido; para editar, abra no app padrão."
            : mixedEol
              ? "Este arquivo mistura fins de linha do Windows e do Mac. Aqui ele só é lido; para editar, abra no app padrão."
              : "Aqui este arquivo só é lido; para editar, abra no app padrão."}
        </div>
      ) : state === "conflict" ? (
        <div className="kn-conflict kn-file-text-alert" role="alert">
          O arquivo mudou fora do Kiwi Notes enquanto você editava.
          <span className="kn-conflict-actions">
            <button type="button" className="kn-bt" onClick={() => session.useTheirs()}>
              Usar o de fora
            </button>
            <button type="button" className="kn-bt kn-bt-acc" onClick={() => void session.keepMine()}>
              Manter o meu
            </button>
          </span>
        </div>
      ) : state === "error" ? (
        <div className="kn-conflict kn-file-text-alert" role="alert">
          Não deu para gravar o arquivo.
          <span className="kn-conflict-actions">
            <button type="button" className="kn-bt kn-bt-acc" onClick={() => void session.save()}>
              Tentar de novo
            </button>
          </span>
        </div>
      ) : null}
      {menuError ? (
        <div className="kn-conflict kn-file-text-alert" role="alert">
          {menuError}
        </div>
      ) : null}
      <div className="kn-file-text-body" data-preview={showPreview ? "on" : undefined}>
        {/* As alças da largura (spec #13383): nas bordas da coluna do texto, como na nota. Com a prévia, cada lado tem a
            metade da janela, e as alças saem. */}
        {widthHandles && !showPreview ? <NoteWidthFrame>{widthHandles}</NoteWidthFrame> : null}
        <div
          ref={host}
          className="kn-file-text-editor"
          style={z === 1 ? undefined : ({ "--kn-text-zoom": z } as CSSProperties)}
          data-context-menu-open={menu ? true : undefined}
          onContextMenu={(e) => {
            if (readOnly) return;
            e.preventDefault();
            e.stopPropagation();
            setMenuError(null);
            openMenu(e.clientX, e.clientY, true);
          }}
          onKeyDown={(e) => {
            if (e.key !== "ContextMenu" && !(e.shiftKey && e.key === "F10")) return;
            const v = view.current;
            const at = v?.coordsAtPos(v.state.selection.main.head);
            if (!at || readOnly) return;
            e.preventDefault();
            e.stopPropagation();
            openMenu(at.left, at.bottom, false);
          }}
        />
        {showPreview ? (
          // Isolada (htmlPreview.ts): sem script, sem rede, sem sair dali.
          <iframe className="kn-file-preview" sandbox="" srcDoc={previewDocument(previewText)} title={`Prévia de ${path.split("/").at(-1)}`} />
        ) : null}
      </div>
      {menu ? <ContextMenu {...menu} onClose={() => setMenu(null)} onRestoreFocus={() => view.current?.focus()} /> : null}
    </div>
  );
}
