// As páginas do docx no motor, uma a uma (T21151, spec #21080): para comparar com o PDF que o Word exporta. Monta pelo
// `docxEngine.ts` do app; o paginas.ts pede cada página, e ela rola até a página, marca o elemento dela e devolve o texto.
import { mountDocx } from "../../ui/notes/files/docxEngine.ts";

declare global {
  interface Window {
    __paginas: { total: number; mostrar(i: number): Promise<string> } | undefined;
  }
}

const bytes = new Uint8Array(await (await fetch("/doc.docx")).arrayBuffer());
const r = mountDocx(document.getElementById("doc")!, bytes, { zoom: 1, onLink: () => {} });
if (!r.ok) throw new Error(r.reason);
const docx = r.handle;
const frame = () => new Promise((done) => requestAnimationFrame(done));
await frame();
await frame();

window.__paginas = {
  total: docx.pages(),
  async mostrar(i: number) {
    docx.revealPage(i);
    for (let k = 0; k < 4; k++) await frame();
    await document.fonts.ready;
    document.querySelector("[data-kn-alvo]")?.removeAttribute("data-kn-alvo");
    // A página à vista: a de topo mais perto do alto da área que rola.
    const top = document.getElementById("scroll")!.getBoundingClientRect().top;
    const el = [...document.querySelectorAll<HTMLElement>(".docx-page")]
      .sort((a, b) => Math.abs(a.getBoundingClientRect().top - top) - Math.abs(b.getBoundingClientRect().top - top))[0]!;
    el.setAttribute("data-kn-alvo", "");
    return el.innerText;
  },
};
