// O Parágrafo do menu do botão direito mostra o que cada opção faz (spec #17703, T18385): os títulos em cascata, o
// Corpo no normal, e um ícone em toda opção que não é título; cada ícone desenha, no traço da cor do tema.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import type { MenuItem } from "../ContextMenu.tsx";
import { editorMenu } from "./context-menu.ts";
import { MENU_ICON_NAMES, MenuIcon } from "./menuIcons.tsx";

const view = { state: EditorState.create({ doc: "Texto de exemplo" }) } as unknown as EditorView;
const submenu = (label: string) => {
  const it = editorMenu(view, {}, () => {}).find((it) => it.kind === "submenu" && it.label === label);
  if (!it || it.kind !== "submenu") throw new Error(`sem o submenu ${label}`);
  return it.items.filter((it): it is Extract<MenuItem, { label: string; onSelect(): void }> => it.kind === undefined || it.kind === "item");
};

describe("Parágrafo", () => {
  const items = submenu("Parágrafo");

  test("os títulos vêm em cascata, do 1 ao 6, e o Corpo sem classe", () => {
    expect(items.slice(0, 6).map((it) => [it.label, it.labelClass])).toEqual(
      [1, 2, 3, 4, 5, 6].map((n) => [`Título ${n}`, `kn-menu-h${n}`]),
    );
    const corpo = items.find((it) => it.label === "Corpo")!;
    expect(corpo.labelClass).toBeUndefined();
    expect(corpo.icon).toBeUndefined();
  });

  test("toda opção que não é título nem o Corpo tem o seu ícone, sem repetir", () => {
    const rest = items.filter((it) => !it.label.startsWith("Título") && it.label !== "Corpo");
    expect(rest.map((it) => [it.label, it.icon])).toEqual([
      ["Lista", "bullet"], ["Lista numerada", "numbered"], ["Lista de tarefas", "task"], ["Citação", "quote"], ["Marcar tarefa", "check"],
    ]);
  });

  test("o CSS diminui o tamanho a cada nível, no peso dos títulos da nota, e o 6 não fica menor que o menu", () => {
    const css = readFileSync(new URL("../notes.css", import.meta.url), "utf8");
    const size = (n: number) => Number(css.match(new RegExp(`\\.kn-menu-h${n} \\{ font-size: (\\d+)px`))?.[1]);
    const sizes = [1, 2, 3, 4, 5, 6].map(size);
    expect(sizes.every((s, i) => i === 0 || s < sizes[i - 1]!)).toBe(true);
    expect(sizes[5]).toBe(13); // --t-ui, o tamanho do menu
    expect(css).toMatch(/\.kn-menu-h1, [^{]*\.kn-menu-h6 \{\s*font-weight: 600;/);
  });
});

describe("os ícones", () => {
  test("cada um desenha no traço da cor do texto, sem cor fixa", () => {
    for (const name of MENU_ICON_NAMES) {
      const svg = renderToStaticMarkup(<MenuIcon name={name} />);
      expect(svg).toContain(`data-icon="${name}"`);
      expect(svg).toContain('stroke="currentColor"');
      expect(svg).toMatch(/<(path|rect|circle)/);
      expect(svg).not.toMatch(/#[0-9a-f]{3,6}|rgb\(/i);
    }
  });

  test("os que o Inserir vai usar existem (T18386)", () => {
    for (const name of ["link", "note-link", "table", "code", "divider", "callout", "footnote"]) expect(MENU_ICON_NAMES).toContain(name as never);
  });
});
