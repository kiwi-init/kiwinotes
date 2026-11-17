import { Glob } from "bun";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import { ListPicker } from "../notes/FolderPicker.tsx";
import { Palette } from "../notes/Palette.tsx";
import type { NotesApi } from "../notes/types.ts";

const noop = () => {};

/** Os atributos do `<input>` como saem no HTML (o nome em minúsculas: no HTML, `spellCheck` e `spellcheck` são o mesmo). */
function inputAttrs(html: string): Record<string, string> {
  const tag = html.match(/<input[^>]*>/)?.[0] ?? "";
  return Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1].toLowerCase(), m[2]]));
}

describe("os campos do ⌘K sem a ajuda de texto do macOS (T2925)", () => {
  const off = { spellcheck: "false", autocorrect: "off", autocapitalize: "off", autocomplete: "off", writingsuggestions: "false" };

  test("busca rápida", () => {
    const html = renderToStaticMarkup(<Palette api={{} as NotesApi} notes={[]} onOpen={noop} onCreate={noop} onClose={noop} />);
    expect(inputAttrs(html)).toMatchObject(off);
  });

  test("listas com filtro (Mover para…, modelos, exportar)", () => {
    const html = renderToStaticMarkup(<ListPicker title="Mover para…" items={[]} emptyText="" onPick={noop} onClose={noop} />);
    expect(inputAttrs(html)).toMatchObject(off);
  });
});

describe("toda busca da UI sem a ajuda de texto do macOS (T2925, #2930)", () => {
  const ui = path.join(import.meta.dir, "..");

  /** Cada `<input …>` do JSX com `type="search"`, do `<input` até o `/>` que fecha. */
  function searchInputs(): { file: string; tag: string }[] {
    const out: { file: string; tag: string }[] = [];
    for (const file of new Glob("**/*.tsx").scanSync(ui)) {
      if (file.includes("node_modules") || file.endsWith(".test.tsx")) continue;
      const src = readFileSync(path.join(ui, file), "utf8");
      for (const m of src.matchAll(/<input\b[\s\S]*?\/>/g)) if (m[0].includes('type="search"')) out.push({ file, tag: m[0] });
    }
    return out;
  }

  test("os campos type=search levam o NO_TEXT_ASSIST", () => {
    const inputs = searchInputs();
    expect(inputs.length).toBeGreaterThanOrEqual(4); // árvore, Histórico (2) e Aparência
    expect(inputs.filter((i) => !i.tag.includes("{...NO_TEXT_ASSIST}")).map((i) => i.file)).toEqual([]);
  });
});
