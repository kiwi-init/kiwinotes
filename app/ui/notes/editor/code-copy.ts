// O botão Copiar dos blocos de código (T6379, E10). Ideia do SilverBullet (MIT, Copyright 2022 Zef Hemel),
// `client/codemirror/syntax/code_copy.ts`: um botão em cada bloco ```, que copia só o código, sem as cercas. Nenhum
// código copiado. Aqui fica o do bloco com o cursor (o texto cru), na linha do ``` de cima. Fora do cursor, o bloco é
// desenhado pela lib, e o botão é o do `renderedWidget` (`CodeCopyButton`). O diagrama (```mermaid) tem os botões dele.

import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";

type Copy = (text: string) => Promise<unknown>;

/** Quanto tempo o "Copiado" (ou o "Não copiou") fica no botão antes de voltar a "Copiar". */
export const COPIED_MS = 1600;

/** O código de um bloco ``` como a pessoa copiaria: as linhas de dentro, sem as cercas e sem a quebra do fim. */
export function fencedCodeText(state: EditorState, from: number, to: number): string {
  const node = syntaxTree(state).resolveInner(from, 1);
  let fenced = node;
  while (fenced.name !== "FencedCode" && fenced.parent) fenced = fenced.parent;
  if (fenced.name !== "FencedCode") return state.sliceDoc(from, to);
  const code = fenced.getChild("CodeText");
  return code ? state.sliceDoc(code.from, code.to).replace(/\n$/, "") : "";
}

/** O botão: "Copiar", e por um instante "Copiado" (ou "Não copiou", sem a permissão ou cedo demais). */
export function copyButton(className: string, text: () => string, copy: Copy): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = "Copiar";
  button.title = "Copiar o código";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const show = (label: string, state: string) => {
    button.textContent = label;
    button.dataset.state = state;
    clearTimeout(timer);
    timer = setTimeout(() => {
      button.textContent = "Copiar";
      delete button.dataset.state;
    }, COPIED_MS);
  };
  // O clique não põe o cursor nem tira o foco do editor.
  button.addEventListener("mousedown", (e) => e.preventDefault());
  button.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    void copy(text()).then(
      () => show("Copiado", "done"),
      () => show("Não copiou", "failed"),
    );
  });
  return button;
}

class CopyWidget extends WidgetType {
  constructor(readonly from: number, readonly to: number, readonly copy: Copy) {
    super();
  }
  eq(other: CopyWidget) {
    return other.from === this.from && other.to === this.to;
  }
  toDOM(view: EditorView) {
    // O texto do clique, não o de quando o botão foi desenhado: o bloco pode ter mudado desde então (o widget fica).
    const button = copyButton("cm-code-copy", () => {
      const open = view.state.doc.lineAt(view.posAtDOM(button));
      return fencedCodeText(view.state, open.from, open.to);
    }, this.copy);
    return button;
  }
  ignoreEvent() {
    return true;
  }
}

function build(view: EditorView, copy: Copy): DecorationSet {
  const out: Range<Decoration>[] = [];
  const { state } = view;
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(n) {
        if (n.name !== "FencedCode") return;
        const info = n.node.getChild("CodeInfo");
        if (info && state.sliceDoc(info.from, info.to).trim().toLowerCase() === "mermaid") return false;
        const open = state.doc.lineAt(n.from);
        out.push(Decoration.line({ class: "cm-code-open" }).range(open.from));
        out.push(Decoration.widget({ widget: new CopyWidget(n.from, n.to, copy), side: 1 }).range(open.to));
        return false;
      },
    });
  }
  return Decoration.set(out, true);
}

export function codeCopy(copy: Copy) {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = build(view, copy);
        }
        update(u: ViewUpdate) {
          if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) this.decorations = build(u.view, copy);
        }
      },
      { decorations: (v) => v.decorations },
    ),
    EditorView.theme({
      ".cm-code-open": { position: "relative" },
      ".cm-code-copy": {
        position: "absolute",
        right: "4px",
        top: "0",
        border: "0",
        borderRadius: "6px",
        padding: "0 8px",
        background: "var(--surface-2)",
        color: "var(--text-3)",
        font: "500 11px/1.9 var(--font)",
        cursor: "pointer",
      },
      ".cm-code-copy:hover": { background: "var(--surface-hover)", color: "var(--text)" },
      ".cm-code-copy[data-state=done]": { color: "var(--accent-text)" },
      ".cm-code-copy[data-state=failed]": { color: "var(--danger)" },
    }),
  ];
}
