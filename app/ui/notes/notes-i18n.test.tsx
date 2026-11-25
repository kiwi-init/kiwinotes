// A casca das Notas em inglês (T29244, spec #28171): a árvore, as propriedades, os diálogos pequenos e os textos que
// saem de funções (editada hoje, "em Projetos", o tempo da Lixeira, a contagem do ⌘F, as datas das propriedades).

import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { setAppLocale } from "../src/i18n.ts";
import { findCount } from "./find.ts";
import { FindBar } from "./FindBar.tsx";
import { formatDate } from "./frontmatter-properties.ts";
import { MeetingSpeakerDialog } from "./MeetingSpeakerDialog.tsx";
import { Properties } from "./Properties.tsx";
import { RefactorDialog } from "./RefactorDialog.tsx";
import { Sidebar, type SidebarProps, whereLabel } from "./Sidebar.tsx";
import { timeLeft } from "./TrashView.tsx";
import { buildTree, editedLabel } from "./tree.ts";
import type { NoteMeta } from "./types.ts";

const english = () => setAppLocale({ setting: "en", locale: "en", system: "en" });
afterEach(() => setAppLocale({ setting: "auto", locale: "pt", system: "pt" }));

const note = (path: string, title: string): NoteMeta =>
  ({ path, title, folder: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "", mtime: "2026-11-01T10:00:00.000Z", ctime: "2026-11-01T10:00:00.000Z", tags: [], version: "v", size: 1 }) as unknown as NoteMeta;

const sidebar: SidebarProps = {
  tree: buildTree({ folders: ["Viagens"], notes: [note("Viagens/Roteiro.md", "Roteiro"), note("Caju.md", "Caju")] }),
  open: new Set(),
  current: null,
  selectedFolder: "Viagens",
  query: "",
  onQuery: () => {},
  pinned: [note("Caju.md", "Caju")],
  recent: [note("Viagens/Roteiro.md", "Roteiro")],
  renaming: null,
  onRename: () => {},
  onToggle: () => {},
  onOpen: () => {},
  onSelectFolder: () => {},
  onMenu: () => {},
  tags: [{ tag: "fruta", name: "fruta", count: 1, children: [] }],
  onTag: () => {},
  saved: [{ name: "Frutas", query: "tag:fruta" }],
  onSaved: () => {},
  onNewNote: () => {},
  onNewFolder: () => {},
  onCollapseAll: () => {},
  onExpandAll: () => {},
  onTrash: () => {},
  onDaily: () => {},
};

describe("a casca das Notas em inglês", () => {
  test("a árvore: busca, botões do topo, seções e Lixeira", () => {
    const pt = renderToStaticMarkup(<Sidebar {...sidebar} />);
    expect(pt).toContain('placeholder="Ir para uma nota ou pasta"');
    expect(pt).toContain('aria-label="Nova nota em Viagens"');
    english();
    const en = renderToStaticMarkup(<Sidebar {...sidebar} />);
    for (const text of ['placeholder="Go to a note or folder"', 'aria-label="New note in Viagens"', 'aria-label="New folder in Viagens"', 'aria-label="Collapse all folders"', ">Today<", ">Pinned<", ">Saved searches<", ">Recent<", ">Notes<", ">Trash<", 'title="Notes with #fruta"'])
      expect(en).toContain(text);
    for (const text of ["Ir para", "Nova nota", "Hoje", "Fixadas", "Recentes", "Lixeira", "Notas com"]) expect(en).not.toContain(text);
  });

  test("as propriedades: título, tipos e o Adicionar", () => {
    english();
    const html = renderToStaticMarkup(
      <Properties frontmatter={"---\nprazo: 2026-11-06\nlido: true\n---\n"} onChange={() => {}} onAdd={() => {}} onOpenTag={() => {}} onOpenLink={() => {}} />,
    );
    expect(html).toContain("Properties");
    expect(html).toContain("Nov 6, 2026");
    expect(html).toContain("+ Add property");
    expect(html).toContain("Date. Options for prazo");
    expect(html).not.toContain("Propriedades");
  });

  test("os diálogos: renomear falante, renomear título e a barra do ⌘F", () => {
    english();
    const speaker = renderToStaticMarkup(<MeetingSpeakerDialog speakers={["Ana"]} onRename={async () => {}} onClose={() => {}} />);
    for (const text of ["Rename speaker", "New name", "Cancel", "Rename"]) expect(speaker).toContain(text);
    expect(speaker).not.toContain("Cancelar");
    const refactor = renderToStaticMarkup(<RefactorDialog kind="heading" name="Plano" onRename={async () => {}} onClose={() => {}} />);
    expect(refactor).toContain("Rename heading");
    expect(refactor).toContain("Links to this heading follow the change");
    const find = renderToStaticMarkup(<FindBar label="Find" query="caju" index={0} total={3} inputRef={{ current: null }} onQuery={() => {}} onStep={() => {}} onClose={() => {}} />);
    expect(find).toContain("1 of 3");
    expect(find).toContain('aria-label="Next match"');
  });

  test("os textos montados por função seguem a língua, e o português continua o padrão", () => {
    const now = new Date("2026-11-03T15:00:00");
    expect(editedLabel({ mtime: "2026-11-03T09:00:00" }, now, "en")).toBe("edited today");
    expect(editedLabel({ mtime: "2026-11-02T22:00:00" }, now, "en")).toBe("edited yesterday");
    expect(editedLabel({ mtime: "2026-10-28T10:00:00" }, now, "en")).toBe("edited Oct 28");
    expect(editedLabel({ mtime: "2025-10-28T10:00:00" }, now, "en")).toBe("edited Oct 28, 2025");
    expect(whereLabel("Viagens/Praia", "en")).toBe("in Praia");
    expect(whereLabel("", "en")).toBe("at the root");
    expect(whereLabel("")).toBe("na raiz");
    const until = new Date(Date.parse("2026-11-03T15:07:30Z")).toISOString();
    expect(timeLeft(until, Date.parse("2026-11-03T15:00:00Z"), "en")).toBe("restorable for 7 more min");
    expect(timeLeft(until, Date.parse("2026-11-03T15:00:00Z"))).toBe("volta por mais 7 min");
    expect(findCount("x", -1, 0, "en")).toBe("Nothing found");
    expect(findCount("x", 0, 1200, "en")).toBe("1 of 1,200");
    expect(formatDate("2026-01-09T08:05", "en")).toBe("Jan 9, 2026, 08:05");
  });
});
