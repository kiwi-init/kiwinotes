// Os menus do editor em inglês (T29842, spec #28171): o botão direito, o "/", a barra de formatação, a tabela, os
// callouts, as ferramentas de texto e a busca do CodeMirror. Em inglês, nenhum texto do `editor.pt.ts` sobra; de volta
// ao português, sai o mesmo de antes.

import { afterEach, describe, expect, test } from "bun:test";

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import { enEditor } from "../../../src/shared/i18n/editor.en.ts";
import { ptEditor } from "../../../src/shared/i18n/editor.pt.ts";
import { appLocale, setAppLocale } from "../../src/i18n.ts";
import type { MenuItem } from "../ContextMenu.tsx";
import { CALLOUT_KINDS, parseCallout } from "./callouts.ts";
import { editorMenu } from "./context-menu.ts";
import { footnoteText, footnotesOf } from "./footnotes.ts";
import { FORMAT_KEYS } from "./index.ts";
import { editorPhrases } from "./search-fold.ts";
import { SLASH_ITEMS, slashMatches } from "./slash.ts";
import { spellingMenu } from "./spelling.ts";
import { TABLE_ACTIONS } from "./table.ts";
import { TEXT_TOOLS } from "./tools.ts";

const start = appLocale();
const lang = (locale: "pt" | "en") => setAppLocale({ ...start, locale });
afterEach(() => setAppLocale(start));

/** Os textos em português que mudam em inglês ("Callout", "Info" e "Bug" são iguais nas duas). */
const PT_ONLY = new Set(
  (Object.keys(ptEditor) as (keyof typeof ptEditor)[])
    .filter((k) => ptEditor[k] !== enEditor[k])
    .map((k) => ptEditor[k].replace(/\{\w+\}/g, "").trim()),
);

/** Todo rótulo do menu do botão direito, com os submenus, numa tabela com o cursor e num callout. */
function allLabels(doc: string, at: number): string[] {
  const view = { state: EditorState.create({ doc, selection: { anchor: at }, extensions: [markdown({ base: markdownLanguage })] }), dom: { isConnected: true } } as unknown as EditorView;
  const walk = (items: MenuItem[]): string[] =>
    items.flatMap((it) => ("label" in it ? [it.label, ...(it.kind === "submenu" ? walk(it.items) : [])] : []));
  return walk(editorMenu(view, { read: async () => "", write: async () => {} }, () => {}, () => {}, () => {}));
}

const TABLE = "| A | B |\n| --- | --- |\n| 1 | 2 |\n";
const CALLOUT = "> [!tip]\n> texto\n";

/** Todos os textos que os menus do editor mostram, na língua de agora. */
function shown(): string[] {
  const phrases = (editorPhrases() as unknown as { value: Record<string, string> }).value;
  return [
    ...allLabels(TABLE, 22),
    ...allLabels(CALLOUT, 12),
    ...SLASH_ITEMS.flatMap((it) => [it.label, it.detail]),
    ...CALLOUT_KINDS.map((k) => k.title),
    ...FORMAT_KEYS.map((k) => k.label),
    ...TABLE_ACTIONS.map((a) => a.label),
    ...TEXT_TOOLS.map((tt) => tt.label),
    ...spellingMenu({} as never, {} as never, { available: true, misspelled: true, suggestions: [] } as never).flatMap((it) => ("label" in it ? [it.label] : [])),
    footnoteText(footnotesOf(EditorState.create({ doc: "Texto[^1].\n" })), { label: "1" })!.text,
    ...Object.values(phrases),
  ];
}

describe("os menus do editor em inglês (T29842)", () => {
  test("em inglês, nenhum texto do editor fica em português", () => {
    lang("en");
    const texts = shown();
    expect(texts.length).toBeGreaterThan(100);
    expect(texts.filter((x) => PT_ONLY.has(x))).toEqual([]);
    expect(texts).toContain("Paste as plain text");
    expect(texts).toContain("Heading 3");
    expect(texts).toContain("Sort by column");
    expect(texts).toContain("YYYY-MM-DD");
  });

  test("em português, os mesmos textos de antes", () => {
    lang("pt");
    const texts = shown();
    for (const x of ["Recortar", "Colar sem formatação", "Título 3", "Ordenar pela coluna", "Tipo do callout", "Inserir acima", "AAAA-MM-DD", "Dica", "Buscar", "Ortografia"]) expect(texts).toContain(x);
  });

  test("o mesmo item troca de língua sem recarregar o módulo", () => {
    const bold = FORMAT_KEYS.find((k) => k.key === "Mod-b")!;
    lang("pt");
    expect(bold.label).toBe("Negrito");
    lang("en");
    expect(bold.label).toBe("Bold");
    expect(parseCallout(CALLOUT)?.title).toBe("Tip");
  });

  test("o / acha o bloco pelo nome em inglês e pelo de português", () => {
    lang("en");
    expect(slashMatches("heading")[0]?.id).toBe("h1");
    expect(slashMatches("table")[0]?.id).toBe("table");
    expect(slashMatches("tabela")[0]?.id).toBe("table");
    expect(slashMatches("divider")[0]?.id).toBe("divider");
  });
});
