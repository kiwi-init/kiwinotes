// A casca das Notas em inglês (T29244, spec #28171): a árvore, as propriedades, os diálogos pequenos e os textos que
// saem de funções (editada hoje, "em Projetos", o tempo da Lixeira, a contagem do ⌘F, as datas das propriedades).
// Os visualizadores (T29245): a grade da planilha, a barra do docx, o cartão do arquivo, a pasta grande e a linha de
// fatos da nota.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";

import { translate } from "../../src/shared/i18n/index.ts";
import { fileSize } from "../../src/shared/file-view.ts";
import { checkOp, SheetOpError } from "../../src/shared/sheet/ops.ts";
import { why, whyText } from "../../src/shared/sheet/why.ts";
import { partText, readZip, writeZip } from "../../src/shared/sheet/zip.ts";
import { setAppLocale } from "../src/i18n.ts";
import { DocxFormatBar } from "./files/DocxFormatBar.tsx";
import { CHANGED_OUTSIDE, SAVE_FAILED } from "./files/docxSaver.ts";
import { modified, typeLabel } from "./files/fileCard.ts";
import { openDoc } from "./files/sheet-doc.ts";
import { readOnlyText, refusedText } from "./files/sheet-session.ts";
import { TableGrid } from "./files/TableGrid.tsx";
import { findCount } from "./find.ts";
import { FindBar } from "./FindBar.tsx";
import { formatDate } from "./frontmatter-properties.ts";
import { MeetingSpeakerDialog } from "./MeetingSpeakerDialog.tsx";
import { NoteFacts } from "./NoteFacts.tsx";
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

describe("os visualizadores das Notas em inglês (T29245)", () => {
  const today = new Date();
  const mtime = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 1).toISOString();

  test("a linha de fatos da nota aberta: editada hoje e as palavras, na língua da tela", () => {
    english();
    const facts = renderToStaticMarkup(<NoteFacts note={{ mtime }} words={1234} />);
    expect(facts).toBe("<span>edited today</span><span>1,234 words</span>");
    setAppLocale({ setting: "auto", locale: "pt", system: "pt" });
    expect(renderToStaticMarkup(<NoteFacts note={{ mtime }} words={1} />)).toContain("editada hoje");
  });

  test("a grade da planilha: o rodapé, a barra da célula e as dicas", () => {
    english();
    const grid = renderToStaticMarkup(<TableGrid header={["Fruta", "Preço"]} rows={[["Caju", "3"], ["Manga", "5"]]} columns={2} foot="read as UTF-16" />);
    expect(grid).toContain("2 rows, 2 columns, read as UTF-16");
    expect(grid).toContain("Click a cell to see all of its contents");
    expect(grid).toContain('aria-label="Selected cell"');
    expect(grid).not.toContain("linhas");
    expect(grid).not.toContain("Clique numa célula");
  });

  test("a barra de formatação do docx traduz os títulos e o nome do botão", () => {
    english();
    const state = { bold: true, italic: false, underline: false, strike: false, heading: 0, bullet: false, ordered: false, alignment: null };
    const bar = renderToStaticMarkup(<DocxFormatBar spot={{ top: 0, left: 0, state }} onFormat={() => {}} />);
    expect(bar).toContain('aria-label="Formatting"');
    expect(bar).toContain('title="Bold (⌘B)"');
    expect(bar).toContain('aria-label="Bold"');
    expect(bar).not.toContain("Negrito");
  });

  test("o cartão do arquivo, o tamanho e os avisos do docx seguem a língua; o português continua o padrão", () => {
    expect(typeLabel("Projeto X/backup.zip", "en")).toBe("ZIP file");
    expect(typeLabel("Makefile", "en")).toBe("File with no extension");
    expect(typeLabel("Projeto X/backup.zip")).toBe("Arquivo ZIP");
    expect(modified("2026-03-04T15:06:00", "en")).toMatch(/^Mar 4, 2026.*3:06\sPM$/);
    expect(fileSize(1_258_291, "en")).toBe("1.2 MB");
    expect(fileSize(1_258_291)).toBe("1,2 MB");
    expect(fileSize(1024, "en")).toBe("1 KB");
    expect(translate("en", CHANGED_OUTSIDE)).toBe("The file changed outside Kiwi: the new version is open, and your last edit wasn't saved.");
    expect(translate("pt", SAVE_FAILED)).toBe("Não deu para gravar este documento agora. O Kiwi tenta de novo na próxima edição.");
  });

  test("o motivo da planilha (revisão #30550): a tela traduz, e o agente segue com a frase em português", () => {
    // Uma aba protegida: a planilha abre só para leitura, e o motivo vem do motor como chave, com o nome da aba.
    const original = new Uint8Array(readFileSync(join(import.meta.dir, "../../test/fixtures/sheet/estoque.xlsx")));
    const sheet1 = partText(original, readZip(original).find((p) => p.name === "xl/worksheets/sheet1.xml")!);
    const locked = sheet1.replace("<autoFilter", '<sheetProtection sheet="1"/><autoFilter');
    const bytes = writeZip(original, readZip(original), new Map([["xl/worksheets/sheet1.xml", new TextEncoder().encode(locked)]]));
    const doc = openDoc(bytes, "Projeto X/estoque.xlsx");
    english();
    expect(readOnlyText(doc)).toBe("tab Estoque is protected");
    expect(translate("en", "files.sheet.readOnly", { why: readOnlyText(doc)! })).toBe("Read only: tab Estoque is protected");
    expect(doc.readOnly && whyText("pt", doc.readOnly)).toBe("a aba Estoque está protegida");
    // Uma edição recusada: a tela em inglês; o `message`, que vai ao agente, igual ao de antes.
    let refused: unknown;
    try {
      checkOp({ op: "renameSheet", sheet: "Estoque", name: "a/b" }, ["Estoque"]);
    } catch (e) {
      refused = e;
    }
    expect(refused).toBeInstanceOf(SheetOpError);
    expect(refusedText(refused)).toBe("Couldn't do that: a tab name can't have \\ / ? * [ ] :.");
    expect(whyText("en", (refused as SheetOpError).why)).toBe("a tab name can't have \\ / ? * [ ] :");
    expect((refused as SheetOpError).message).toBe("o nome da aba não pode ter \\ / ? * [ ] :");
    // O motivo com outro motivo dentro ("apagar linhas"): as duas partes na mesma língua.
    const comments = why("files.sheet.why.comments", { what: { key: "files.sheet.why.what.deleteRows" } });
    expect(whyText("en", comments)).toBe("can't delete rows: the tab has comments");
    expect(new SheetOpError(comments).message).toBe("não dá para apagar linhas: a aba tem comentários");
  });
});
