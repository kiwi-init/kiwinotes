// A base de comparação da prova (T21151): o mesmo docx pelo caminho de hoje, o mammoth, sem o motor novo.
window.__prova = { done: false };
const t0 = performance.now();
const bytes = new Uint8Array(await (await fetch("/doc.docx")).arrayBuffer());
const mammoth = (await import("mammoth")).default;
const t1 = performance.now();
const r = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer as ArrayBuffer });
document.getElementById("doc")!.innerHTML = `<div style="max-width:760px;margin:24px auto;background:#fff;padding:48px">${r.value}</div>`;
await new Promise((d) => requestAnimationFrame(d));
window.__prova = { done: true, ok: true, importMs: Math.round(t1 - t0), mountMs: Math.round(performance.now() - t1), firstPageMs: Math.round(performance.now() - t0) };
export {};
