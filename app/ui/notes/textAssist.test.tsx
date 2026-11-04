import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ListPicker } from "./FolderPicker.tsx";
import { Palette } from "./Palette.tsx";
import type { NotesApi } from "./types.ts";

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
