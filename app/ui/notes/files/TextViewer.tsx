// txt, log, json e yaml dentro das Notas (T7105, spec #7079): o texto num editor simples, que grava sozinho no
// arquivo. Sem realce nem formatação: o arquivo sai como a pessoa escreveu, com o fim de linha que tinha (`\r\n` do
// Windows volta `\r\n`, embora o editor trabalhe em `\n`). Só é lido, sem gravar: um texto que não é UTF-8
// (`readOnly`), porque gravar trocaria os bytes que o Kiwi não entendeu, e um com fins de linha misturados, porque
// não há como devolver cada linha com o fim que tinha.
//
// O editor é o CodeMirror, o mesmo das notas .md, sem o Markdown (spec #13382). O `<textarea>` de antes refazia o
// texto inteiro a cada tecla: num .txt de 1 MB, de 47 a 53 ms por tecla no WebKit, e a escrita travava. O CodeMirror só
// desenha as linhas na tela, e a sessão lê o texto só quando grava. Como no .md, a gravação é silenciosa (sem
// "Gravando…/Gravado"), e o texto quebra na largura da nota.

import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { Annotation, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { useEffect, useMemo, useRef, useState } from "react";

import { detectEol, TextSession, type TextSaveState, toEditor } from "./textSession.ts";
import type { FileViewerProps } from "./viewers.ts";

/** Uma troca que veio de fora (o arquivo mudou no disco): não é a pessoa digitando. */
const fromDisk = Annotation.define<boolean>();

const theme = EditorView.theme({
  "&": { height: "100%", color: "var(--text)", background: "none" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--mono, var(--font-mono, ui-monospace, Menlo, monospace))", fontSize: "13px", lineHeight: "1.6" },
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

export function TextViewer({ path, file, files, flushRef }: FileViewerProps) {
  const initial = "text" in file ? file : { text: "", version: file.version };
  const notUtf8 = "readOnly" in file && file.readOnly === true;
  const mixedEol = detectEol(initial.text) === null;
  const readOnly = !files.save || notUtf8 || mixedEol;
  const [state, setState] = useState<TextSaveState>("idle");
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);

  // Uma sessão por arquivo aberto (o `FileView` monta de novo a cada caminho).
  const session = useMemo(
    () =>
      new TextSession({
        text: initial.text,
        version: initial.version,
        save: (content, baseVersion) => files.save!(path, content, baseVersion),
        onState: setState,
        // O texto de fora entrou: troca no editor, sem contar como digitação.
        onText: (t) => {
          const v = view.current;
          if (!v || v.state.doc.toString() === t) return;
          v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: t }, annotations: fromDisk.of(true) });
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [path],
  );

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const v = new EditorView({
      parent,
      state: EditorState.create({
        doc: toEditor(initial.text),
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorView.lineWrapping,
          EditorState.tabSize.of(2),
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
          theme,
          // A pessoa digitou: a sessão só marca, e lê o texto inteiro quando grava (depois da pausa).
          EditorView.updateListener.of((u) => {
            if (!u.docChanged || u.transactions.some((tr) => tr.annotation(fromDisk))) return;
            session.touch(() => u.view.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    return () => {
      view.current = null;
      v.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, readOnly]);

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

  // O arquivo mudou no disco e o `FileView` leu de novo.
  useEffect(() => {
    if ("text" in file) session.external({ text: file.text, version: file.version });
  }, [file, session]);

  // Sem "Gravando…/Gravado" na tela (spec #13382): como numa nota .md, a gravação é silenciosa, e só o erro e o conflito
  // aparecem. O `data-save` diz o estado aos scripts de prova.
  return (
    <div className="kn-file-text" data-save={state}>
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
      <div ref={host} className="kn-file-text-editor" />
    </div>
  );
}
