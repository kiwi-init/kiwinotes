// A página da ida e volta (T21152, spec #21080): abre o docx no motor, deixa o roteiro editar pela tela e grava com
// `save()`. Empacotada pelo gravar.ts.
import "@docx-editor.dev/core/styles/editor.css";

import type { PaginatedSurface } from "@docx-editor.dev/core/editor";

declare global {
  interface Window {
    __gravar: { done: boolean; ok?: boolean; reason?: string; pages?: number };
    __surface?: PaginatedSurface;
    __save?: () => { b64: string; ms: number; pages: number };
  }
}
window.__gravar = { done: false };

const bytes = new Uint8Array(await (await fetch("/doc.docx")).arrayBuffer());
const { mountPaginatedSurface } = await import("@docx-editor.dev/core/editor");
const r = mountPaginatedSurface(document.getElementById("doc")!, bytes, { editingMode: "edit" });
window.__gravar.ok = r.ok;
if (!r.ok) window.__gravar.reason = `${r.reason} ${r.detail ?? ""}`;
else {
  const s = r.surface;
  window.__surface = s;
  window.__gravar.pages = s.layout().pages.length;
  window.__save = () => {
    const t = performance.now();
    s.flushPendingInput();
    const out = s.save();
    const ms = Math.round(performance.now() - t);
    let bin = "";
    for (let i = 0; i < out.length; i += 0x8000) bin += String.fromCharCode(...out.subarray(i, i + 0x8000));
    return { b64: btoa(bin), ms, pages: s.layout().pages.length };
  };
}
window.__gravar.done = true;
