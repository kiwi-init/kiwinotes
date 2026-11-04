// A barra de ditado (T2502, C · Foco): o composer do Channels, embaixo da nota. O que se escreve (ou se dita, segurando
// Fn: o ditado do app cola onde está o foco) entra na nota, no lugar onde o cursor do editor ficou, com Enter.
//
// Não há botão de gravar: a UI não liga o microfone (o ditado é do atalho Fn, no helper). A tecla "Fn" no canto só
// lembra o atalho.

import { useState } from "react";

import { insertIntoEditor } from "./NoteEditor.tsx";

export function Composer({ disabled }: { disabled: boolean }) {
  const [text, setText] = useState("");
  const send = () => {
    if (insertIntoEditor(text)) setText("");
  };
  return (
    <div className="kn-composer-wrap">
      <div className="kn-composer">
        <input
          className="kn-composer-input"
          aria-label="Escrever ou ditar para a nota"
          placeholder={disabled ? "Abra uma nota para escrever nela" : "Segure Fn e dite, ou escreva aqui…"}
          value={text}
          disabled={disabled}
          spellCheck
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            } else if (e.key === "Escape" && text) {
              e.preventDefault();
              setText("");
            }
          }}
        />
        <span className="kn-composer-hint">↩ para a nota</span>
        <kbd className="kn-composer-fn" title="Segure Fn para ditar">
          fn
        </kbd>
      </div>
      <div className="kn-composer-foot">o texto entra onde está o cursor da nota</div>
    </div>
  );
}
