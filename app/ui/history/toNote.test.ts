import { describe, expect, test } from "bun:test";

import type { NoteMeta } from "../notes/types.ts";
import { sentText, targetItems } from "./toNote.ts";

const note = (path: string, mtime: string): NoteMeta => {
  const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  return { path, title: path.slice(path.lastIndexOf("/") + 1, -3), folder, mtime, size: 1, version: "v", tags: [] };
};

const notes = [note("Projetos/PACS.md", "2026-11-03T10:00:00Z"), note("Ideias.md", "2026-11-03T12:00:00Z"), note("Diário/Hoje.md", "2026-11-01T00:00:00Z")];

describe("Enviar para nota… (T1320)", () => {
  test("sem busca: nota nova em cima, depois as mais recentes", () => {
    expect(targetItems(notes, "", []).map((i) => (i.kind === "new" ? "nova" : i.path))).toEqual(["nova", "Ideias.md", "Projetos/PACS.md", "Diário/Hoje.md"]);
  });

  test("com busca: título e depois o texto; nunca o 'Criar' do ⌘K, que aqui é a nota nova", () => {
    const items = targetItems(notes, "pacs", [{ path: "Diário/Hoje.md", title: "Hoje", snippet: "…o PACS caiu…", score: 1 }]);
    expect(items.map((i) => (i.kind === "new" ? "nova" : i.path))).toEqual(["nova", "Projetos/PACS.md", "Diário/Hoje.md"]);
    expect(targetItems(notes, "nada disso", []).map((i) => i.kind)).toEqual(["new"]);
  });

  test("o que a tela diz depois", () => {
    const n = note("Caixa de entrada/Comprar café.md", "x");
    expect(sentText({ note: n, created: true, already: false })).toBe("Virou a nota “Comprar café”, em Caixa de entrada");
    expect(sentText({ note: note("Ideias.md", "x"), created: false, already: false })).toBe("Foi para o fim de “Ideias”");
    expect(sentText({ note: n, created: false, already: true })).toBe("Já estava em “Comprar café”");
  });
});
