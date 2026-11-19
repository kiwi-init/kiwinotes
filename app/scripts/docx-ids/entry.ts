// A página do `docx-ids.test.ts`: monta o docx na superfície do motor e devolve, pelo `docxIds.ts`, o paraId de cada
// parágrafo na ordem e a volta pelo `nodeIdOf`.
import { mountPaginatedSurface } from "@docx-editor.dev/core/editor";

import { paraIds } from "../../ui/notes/files/docxIds.ts";

declare global {
  interface Window {
    __ids: { ok: boolean; paraIds: (string | null)[]; back: boolean } | { error: string };
  }
}

try {
  const bytes = new Uint8Array(await (await fetch("/doc.docx")).arrayBuffer());
  const r = mountPaginatedSurface(document.getElementById("doc")!, bytes, { editingMode: "view" });
  if (!r.ok) throw new Error(r.reason);
  const ids = paraIds(r.surface);
  if (!ids) throw new Error("a superfície não tem a tradução dos ids");
  // Os nós dos parágrafos do corpo, na ordem de leitura.
  const nodes = ids.order();
  const out = nodes.map((n) => ids.paraIdOf(n));
  window.__ids = { ok: true, paraIds: out, back: nodes.every((n, i) => out[i] !== null && ids.nodeIdOf(out[i]!) === n) };
} catch (e) {
  window.__ids = { error: (e as Error).message };
}

