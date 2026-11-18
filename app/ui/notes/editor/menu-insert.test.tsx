// O Inserir do menu do botão direito e o menu do "/" com ícones (spec #17703, T18386): cada opção mostra o que ela
// põe na nota, com os mesmos desenhos de `menuIcons.tsx`.

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import type { MenuItem } from "../ContextMenu.tsx";
import { editorMenu } from "./context-menu.ts";
import { MENU_ICON_NAMES, MenuIcon } from "./menuIcons.tsx";
import { SLASH_ITEMS } from "./slash.ts";

const view = { state: EditorState.create({ doc: "Texto de exemplo" }) } as unknown as EditorView;
const inserir = (plain: boolean) => {
  const it = editorMenu(view, {}, () => {}, undefined, undefined, { plain }).find((it) => it.kind === "submenu" && it.label === "Inserir");
  if (!it || it.kind !== "submenu") throw new Error("sem o Inserir");
  return it.items.filter((it): it is Extract<MenuItem, { label: string; onSelect(): void }> => it.kind === undefined || it.kind === "item");
};

describe("Inserir", () => {
  test("cada opção tem o seu ícone, sem repetir", () => {
    expect(inserir(false).map((it) => [it.label, it.icon])).toEqual([
      ["Link", "link"], ["Link para nota", "note-link"], ["Tabela", "table"], ["Bloco de código", "code"],
      ["Separador", "divider"], ["Callout", "callout"], ["Nota de rodapé", "footnote"],
    ]);
  });

  test("no texto puro (.txt), o mesmo sem o link para nota, e todas com ícone", () => {
    const items = inserir(true);
    expect(items.map((it) => it.label)).not.toContain("Link para nota");
    expect(items.every((it) => it.icon && MENU_ICON_NAMES.includes(it.icon))).toBe(true);
  });
});

describe("o menu do /", () => {
  test("todo bloco tem um ícone que existe", () => {
    for (const it of SLASH_ITEMS) expect({ id: it.id, ok: MENU_ICON_NAMES.includes(it.icon) }).toEqual({ id: it.id, ok: true });
  });

  test("o / usa o mesmo desenho do botão direito para o mesmo bloco", () => {
    const menu: Record<string, string | undefined> = Object.fromEntries(inserir(false).map((it) => [it.label, it.icon]));
    const slash: Record<string, string | undefined> = Object.fromEntries(SLASH_ITEMS.map((it) => [it.id, it.icon]));
    expect([slash.link, slash.table, slash.code, slash.divider, slash.callout, slash.footnote]).toEqual(
      [menu["Link para nota"], menu.Tabela, menu["Bloco de código"], menu.Separador, menu.Callout, menu["Nota de rodapé"]],
    );
    // As listas e a citação, os do Parágrafo.
    expect([slash.list, slash.numbered, slash.todo, slash.quote]).toEqual(["bullet", "numbered", "task", "quote"]);
    // As três datas, o calendário.
    expect([slash.today, slash.tomorrow, slash.yesterday]).toEqual(["date", "date", "date"]);
  });

  test("os quatro desenhos novos (h1, h2, modelo, data) seguem o traço: 16 px, currentColor, sem cor fixa", () => {
    for (const name of ["h1", "h2", "template", "date"] as const) {
      const svg = renderToStaticMarkup(<MenuIcon name={name} />);
      expect(svg).toContain('stroke="currentColor"');
      expect(svg).toContain('width="16"');
      expect(svg).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(/i);
      expect(svg).toMatch(/<(path|rect|circle)/);
    }
  });
});
