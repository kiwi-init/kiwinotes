// Spec #17703: no menu do botão direito, cada opção mostra o que faz. O Formatar, cada uma no próprio estilo; o
// Parágrafo, com a cascata dos títulos e os ícones (parte B); o Inserir, com um ícone em cada opção (parte C).
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { MenuItem } from "../ContextMenu.tsx";
import { editorMenu, FORMAT_STYLE } from "./context-menu.ts";

const css = readFileSync(join(import.meta.dir, "../notes.css"), "utf8");
/** O bloco de regras de uma classe no notes.css, sem comentários. */
const ruleOf = (cls: string) => css.replace(/\/\*[\s\S]*?\*\//g, "").match(new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`))?.[1]?.trim() ?? "";

function menu(doc = "Uma nota de exemplo, sobre a feira.") {
  const state = EditorState.create({ doc, selection: { anchor: 4, head: 8 } });
  const view = { state, dom: { isConnected: true }, dispatch() {}, focus() {} } as unknown as EditorView;
  return editorMenu(view, {}, () => {});
}
const submenu = (items: MenuItem[], label: string) => {
  const found = items.find((it) => it.kind === "submenu" && it.label === label);
  if (!found || found.kind !== "submenu") throw new Error(`sem o submenu ${label}`);
  return found.items.filter((it): it is Extract<MenuItem, { onSelect(): void }> => it.kind !== "separator" && it.kind !== "title");
};

test("cada opção do Formatar vem no próprio estilo, e o estilo existe no notes.css", () => {
  const items = submenu(menu(), "Formatar");
  expect(items.map((it) => it.label)).toEqual(["Negrito", "Itálico", "Tachado", "Realce", "Código", "Comentário", "Limpar formatação"]);
  for (const it of items) {
    expect(it.labelClass, it.label).toBeString();
    const rule = ruleOf(it.labelClass!) || ruleOf(`${it.labelClass}::before`);
    expect(rule, `${it.label}: .${it.labelClass}`).not.toBe("");
  }
  // Cada uma no seu: nenhuma repete o estilo de outra.
  expect(new Set(items.map((it) => it.labelClass)).size).toBe(items.length);
  expect(Object.values(FORMAT_STYLE).sort()).toEqual(items.map((it) => it.labelClass!).sort());
});

test("o estilo do rótulo é o que a opção faz no texto", () => {
  expect(ruleOf("kn-menu-bold")).toContain("font-weight: 700");
  expect(ruleOf("kn-menu-italic")).toContain("font-style: italic");
  expect(ruleOf("kn-menu-strike")).toContain("line-through");
  expect(ruleOf("kn-menu-highlight")).toContain("#f6c945"); // o HIGHLIGHT_BACKGROUND do editor
  expect(ruleOf("kn-menu-code")).toContain("var(--font-mono)");
  // O comentário: o `%%` do editor em volta, apagado; o rótulo não fica na cor de um item desligado (revisão do T18383).
  expect(ruleOf("kn-menu-comment::before")).toContain('content: "%% "');
  expect(ruleOf("kn-menu-comment::after")).toContain('content: " %%"');
  expect(ruleOf("kn-menu-comment")).toBe("");
  const disabled = css.match(/\.kn-menu-item\[aria-disabled\]\s*\{([^}]*)\}/)![1];
  for (const it of submenu(menu(), "Formatar")) {
    const color = ruleOf(it.labelClass!).match(/(?:^|;)\s*color:\s*([^;]+)/)?.[1]?.trim();
    if (color) expect(disabled, `${it.label} na cor do item desligado`).not.toContain(color);
  }
});

test("o rótulo leva a classe; sem ela, fica como antes", () => {
  const src = readFileSync(join(import.meta.dir, "../ContextMenu.tsx"), "utf8");
  expect(src).toContain('it.labelClass ? `kn-menu-label ${it.labelClass}` : "kn-menu-label"');
  // O resto do menu não muda: Recortar, Copiar e Colar sem classe.
  const top = menu().filter((it) => it.kind !== "separator" && it.kind !== "title" && it.kind !== "submenu");
  for (const it of top) if (["Recortar", "Copiar", "Colar"].includes(it.label)) expect((it as { labelClass?: string }).labelClass).toBeUndefined();
});

test("o Parágrafo: os títulos em cascata, do 1 (maior) ao 6 (menor), e ícone no resto, menos o Corpo", () => {
  const items = submenu(menu(), "Parágrafo");
  const titles = items.filter((it) => it.label.startsWith("Título"));
  expect(titles.map((it) => it.labelClass)).toEqual([1, 2, 3, 4, 5, 6].map((n) => `kn-menu-h${n}`));
  // A regra só do tamanho (a primeira com a classe é a do grupo, com o peso).
  const sizes = titles.map((it) => Number(css.match(new RegExp(`\\.${it.labelClass} \\{ font-size: (\\d+)px`))?.[1]));
  expect(sizes.every((n) => n > 0)).toBe(true);
  for (let i = 1; i < sizes.length; i++) expect(sizes[i], `Título ${i + 1} menor que o ${i}`).toBeLessThan(sizes[i - 1]!);
  for (const it of items.filter((it) => !it.label.startsWith("Título") && it.label !== "Corpo")) expect(it.icon, it.label).toBeString();
});

test("o Inserir: cada opção com o seu ícone, sem repetir", () => {
  const items = submenu(menu(), "Inserir");
  expect(items.length).toBe(7);
  for (const it of items) expect(it.icon, it.label).toBeString();
  expect(new Set(items.map((it) => it.icon)).size).toBe(items.length);
});
