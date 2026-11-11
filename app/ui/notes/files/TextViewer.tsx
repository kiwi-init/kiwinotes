// txt, log, json e yaml dentro das Notas (T7105, spec #7079): o texto num editor simples, que grava sozinho no
// arquivo. Sem realce nem formatação: o arquivo sai como a pessoa escreveu, com o fim de linha que tinha (`\r\n` do
// Windows volta `\r\n`, embora o `<textarea>` trabalhe em `\n`). Só é lido, sem gravar: um texto que não é UTF-8
// (`readOnly`), porque gravar trocaria os bytes que o Kiwi não entendeu, e um com fins de linha misturados, porque
// não há como devolver cada linha com o fim que tinha.

import { useEffect, useMemo, useRef, useState } from "react";

import { detectEol, TextSession, type TextSaveState, toEditor } from "./textSession.ts";
import type { FileViewerProps } from "./viewers.ts";

export function TextViewer({ path, file, files, flushRef }: FileViewerProps) {
  const initial = "text" in file ? file : { text: "", version: file.version };
  const notUtf8 = "readOnly" in file && file.readOnly === true;
  const mixedEol = detectEol(initial.text) === null;
  const readOnly = !files.save || notUtf8 || mixedEol;
  const [text, setText] = useState(() => toEditor(initial.text));
  const [state, setState] = useState<TextSaveState>("idle");
  const area = useRef<HTMLTextAreaElement>(null);

  // Uma sessão por arquivo aberto (o `FileView` monta de novo a cada caminho).
  const session = useMemo(
    () =>
      new TextSession({
        text: initial.text,
        version: initial.version,
        save: (content, baseVersion) => files.save!(path, content, baseVersion),
        onState: setState,
        onText: setText,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [path],
  );

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

  const status = state === "saving" || state === "pending" ? "Gravando…" : state === "saved" ? "Gravado" : "";

  return (
    <div className="kn-file-text">
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
      <textarea
        ref={area}
        className="kn-file-text-area"
        aria-label={`Texto de ${path.split("/").at(-1)}`}
        value={text}
        readOnly={readOnly}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        wrap="off"
        onChange={(e) => {
          setText(e.target.value);
          session.edit(e.target.value);
        }}
      />
      <span className="kn-file-text-status" aria-live="polite">
        {status}
      </span>
    </div>
  );
}
