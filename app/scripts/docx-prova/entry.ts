// A página da prova (T21151): carrega o motor do docx só aqui, abre o documento e mede. Empacotada pelo prova.ts.
import "@docx-editor.dev/core/styles/editor.css";

declare global {
  interface Window {
    __prova: { done: boolean; ok?: boolean; reason?: string; importMs?: number; mountMs?: number; pages?: number; firstPageMs?: number };
  }
}
window.__prova = { done: false };

const t0 = performance.now();
const bytes = new Uint8Array(await (await fetch("/doc.docx")).arrayBuffer());
const { mountPaginatedSurface } = await import("@docx-editor.dev/core/editor");
const t1 = performance.now();
const host = document.getElementById("doc")!;
const r = mountPaginatedSurface(host, bytes, { editingMode: "edit" });
const t2 = performance.now();
window.__prova.importMs = Math.round(t1 - t0);
window.__prova.mountMs = Math.round(t2 - t1);
window.__prova.ok = r.ok;
if (!r.ok) window.__prova.reason = `${r.reason} ${r.detail ?? ""}`;
// A primeira página pintada: espera um quadro com algo dentro.
const frame = () => new Promise((done) => requestAnimationFrame(done));
await frame();
await frame();
if (r.ok) window.__prova.pages = r.surface.layout().pages.length;
window.__prova.firstPageMs = Math.round(performance.now() - t0);
window.__prova.done = true;
