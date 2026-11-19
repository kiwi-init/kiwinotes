// A página do `docx-gravar.test.ts`: abre o docx pelo `mountDocx`, como o `DocxViewer` (editável), e deixa o teste
// editar pelo teclado e gravar pelo `save()` do Kiwi.
import { mountDocx } from "../../ui/notes/files/docxEngine.ts";

declare global {
  interface Window {
    __kiwiDocx: { ready: boolean; error?: string; pages?: number; text?: string[]; edits?: number };
    __kiwiSave?: () => string;
    __kiwiText?: () => string[];
  }
}

window.__kiwiDocx = { ready: false };
try {
  const bytes = new Uint8Array(await (await fetch("/doc.docx")).arrayBuffer());
  let edits = 0;
  const r = mountDocx(document.getElementById("doc")!, bytes, { zoom: 1, editable: true, onEdit: () => edits++, onLink: () => {} });
  if (!r.ok) throw new Error(r.reason);
  const h = r.handle;
  const text = () => {
    // O texto da tela, um parágrafo por id, na ordem das páginas.
    const by = new Map<string, string>();
    for (const p of h.pieces()) by.set(p.paragraphId, (by.get(p.paragraphId) ?? "") + p.text);
    return [...by.values()];
  };
  window.__kiwiSave = () => {
    const out = h.save();
    window.__kiwiDocx.edits = edits;
    let bin = "";
    for (let i = 0; i < out.length; i += 0x8000) bin += String.fromCharCode(...out.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  window.__kiwiText = text;
  Object.assign(window.__kiwiDocx, { ready: true, pages: h.pages(), text: text() });
} catch (e) {
  window.__kiwiDocx = { ready: true, error: (e as Error).stack ?? String(e) };
}
