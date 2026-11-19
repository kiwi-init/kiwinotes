// A página do `docx-kiwi.test.ts`: abre o docx pelo `mountDocx` (como o `DocxViewer`, editável), toca as operações do
// gato e devolve o docx da tela (base64), para o teste conferir com o que o agente gravou.
import { mountDocx } from "../../ui/notes/files/docxEngine.ts";

declare global {
  interface Window {
    __play: { played: boolean; saved: string; edits: number; carets: (string | null)[] } | { error: string };
  }
}

try {
  const bytes = new Uint8Array(await (await fetch("/doc.docx")).arrayBuffer());
  const { ops, reduced } = await (await fetch("/ops.json")).json();
  let edits = 0;
  const carets: (string | null)[] = [];
  const r = mountDocx(document.getElementById("doc")!, bytes, { zoom: 1, editable: true, onEdit: () => edits++, onCaret: (id) => carets.push(id), onLink: () => {} });
  if (!r.ok) throw new Error(r.reason);
  const played = await r.handle.play(ops, { face: "", reduced });
  const saved = r.handle.save();
  let bin = "";
  for (const b of saved) bin += String.fromCharCode(b);
  window.__play = { played, saved: btoa(bin), edits, carets };
} catch (e) {
  window.__play = { error: (e as Error).stack ?? String(e) };
}
