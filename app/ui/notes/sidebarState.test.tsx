// A barra das Notas mais limpa (T7390, spec #7383): Recolher tudo e Expandir tudo, as seções que recolhem pelo título e
// o que fica guardado entre aberturas.

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Sidebar, type SidebarProps } from "./Sidebar.tsx";
import { allFolders, loadCollapsed, loadOpenFolders, saveCollapsed, saveOpenFolders, type SectionId, toggled } from "./sidebarState.ts";
import { buildTree } from "./tree.ts";
import type { NoteMeta, VaultListing } from "./types.ts";

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
};

const note = (path: string, title: string): NoteMeta =>
  ({ path, title, folder: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "", mtime: "2026-11-01T10:00:00.000Z", ctime: "2026-11-01T10:00:00.000Z", tags: [], version: "v", size: 1 }) as unknown as NoteMeta;
const listing: VaultListing = {
  folders: ["Projetos", "Projetos/2026", "Projetos/2026/Q4", "Arquivo"],
  notes: [note("Projetos/2026/Q4/Plano.md", "Plano"), note("Inbox.md", "Inbox")],
};
const tree = buildTree(listing);

describe("o que a barra guarda", () => {
  test("as seções recolhidas: só as conhecidas, na ordem da barra, e o padrão é tudo aberto", () => {
    const store = memory();
    expect([...loadCollapsed(store)]).toEqual([]);
    saveCollapsed(new Set<SectionId>(["tags", "recent"]), store);
    expect(store.data.get("kiwi.notes.sections")).toBe('["recent","tags"]');
    store.setItem("kiwi.notes.sections", '["tags","velha",3]');
    expect([...loadCollapsed(store)]).toEqual(["tags"]);
    store.setItem("kiwi.notes.sections", "{quebrado");
    expect([...loadCollapsed(store)]).toEqual([]);
  });

  test("as pastas abertas são de cada cofre", () => {
    const store = memory();
    saveOpenFolders("cofre-a", new Set(["Projetos", "Arquivo"]), store);
    expect([...loadOpenFolders("cofre-a", store)]).toEqual(["Arquivo", "Projetos"]);
    expect([...loadOpenFolders("cofre-b", store)]).toEqual([]);
  });

  test("sem armazenamento (janela privada, teste), nada quebra e tudo abre", () => {
    const broken = { getItem: () => { throw new Error("sem storage"); }, setItem: () => { throw new Error("sem storage"); } };
    expect([...loadCollapsed(broken)]).toEqual([]);
    expect(() => saveCollapsed(new Set<SectionId>(["tags"]), broken)).not.toThrow();
    expect([...loadOpenFolders("x", null)]).toEqual([]);
  });

  test("Expandir tudo pega todas as pastas, também as de dentro; toggled liga e desliga", () => {
    expect(allFolders(tree).sort()).toEqual(["Arquivo", "Projetos", "Projetos/2026", "Projetos/2026/Q4"]);
    expect([...toggled(new Set(["a"]), "b")]).toEqual(["a", "b"]);
    expect([...toggled(new Set(["a", "b"]), "a")]).toEqual(["b"]);
  });
});

describe("a barra", () => {
  const base: SidebarProps = {
    tree,
    open: new Set(),
    current: null,
    selectedFolder: "",
    query: "",
    onQuery: () => {},
    pinned: [note("Inbox.md", "Inbox")],
    recent: [note("Projetos/2026/Q4/Plano.md", "Plano")],
    renaming: null,
    onRename: () => {},
    onToggle: () => {},
    onOpen: () => {},
    onSelectFolder: () => {},
    onMenu: () => {},
    tags: [{ tag: "ideia", name: "ideia", count: 2, children: [] }],
    onTag: () => {},
    saved: [{ name: "Abertas", query: "tag:ideia" }],
    onSaved: () => {},
    onNewNote: () => {},
    onNewFolder: () => {},
    onCollapseAll: () => {},
    onExpandAll: () => {},
    onSection: () => {},
  };
  const html = (p: Partial<SidebarProps>) => renderToStaticMarkup(<Sidebar {...base} {...p} />);
  const count = (s: string, part: string) => s.split(part).length - 1;

  test("os botões Recolher tudo e Expandir tudo ficam no topo, junto de Nova nota e Nova pasta", () => {
    const out = html({});
    const top = out.slice(out.indexOf("kn-side-top"), out.indexOf("Hoje") > 0 ? out.indexOf("Hoje") : out.indexOf("kn-side-head"));
    expect(top).toContain('data-new="note"');
    expect(top).toContain('data-new="folder"');
    expect(top).toContain('data-all="collapse"');
    expect(top).toContain('aria-label="Recolher todas as pastas"');
    expect(top).toContain('data-all="expand"');
    expect(top).toContain('aria-label="Expandir todas as pastas"');
    expect(html({ onCollapseAll: undefined, onExpandAll: undefined })).not.toContain("data-all=");
  });

  test("com tudo aberto (o padrão), cada título é um botão com aria-expanded=true e o conteúdo aparece", () => {
    const out = html({});
    for (const id of ["pinned", "saved", "recent", "notes", "tags"]) expect(out).toContain(`<button type="button" class="kn-side-head" data-section="${id}" aria-expanded="true">`);
    expect(out).toContain(">#ideia<");
    expect(out).toContain(">Abertas<");
    expect(count(out, 'data-kind="folder"')).toBe(2);
  });

  test("uma seção recolhida mostra só o título; as outras seguem abertas", () => {
    const out = html({ collapsed: new Set<SectionId>(["tags", "saved", "pinned", "recent"]) });
    expect(out).toContain('data-section="tags" aria-expanded="false"');
    expect(out).not.toContain("ideia");
    expect(out).not.toContain(">Abertas<");
    expect(out).not.toContain(">Plano<"); // a recente
    expect(out).toContain('data-section="notes" aria-expanded="true"');
    expect(out).toContain(">Inbox<"); // a da árvore
  });

  test("a seção Notas recolhida esconde a árvore, mas a busca mostra o resultado inteiro", () => {
    const shut = new Set<SectionId>(["notes"]);
    expect(count(html({ collapsed: shut }), 'data-kind="folder"')).toBe(0);
    const searching = html({ collapsed: shut, query: "plano", open: new Set(["Projetos", "Projetos/2026", "Projetos/2026/Q4"]) });
    expect(searching).toContain(">Resultado<");
    expect(searching).not.toContain('data-section="notes" aria-expanded');
    expect(count(searching, 'data-kind="folder"')).toBeGreaterThan(0);
  });

  test("as pastas abertas aparecem com as de dentro, e as fechadas não", () => {
    expect(count(html({ open: new Set(allFolders(tree)) }), 'data-kind="folder"')).toBe(4);
    expect(count(html({ open: new Set() }), 'data-kind="folder"')).toBe(2);
  });

  test("sem onSection, os títulos são texto, como antes", () => {
    const out = html({ onSection: undefined, collapsed: new Set<SectionId>(["tags"]) });
    expect(out).not.toContain('class="kn-side-head" data-section="tags" aria-expanded');
    expect(out).toContain('<div class="kn-side-head" data-section="tags">Tags</div>');
    expect(out).toContain(">#ideia<");
  });
});
