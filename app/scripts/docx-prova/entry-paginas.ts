// As páginas do docx no motor, uma a uma (T21151, spec #21080): para comparar com o PDF que o Word exporta. O paginas.ts
// pede cada página; ela rola até a página, marca o elemento dela e devolve o texto.
import "@docx-editor.dev/core/styles/editor.css";

declare global {
  interface Window {
    __paginas: { total: number; mostrar(i: number): Promise<string> } | undefined;
  }
}

const bytes = new Uint8Array(await (await fetch("/doc.docx")).arrayBuffer());
const { mountPaginatedSurface } = await import("@docx-editor.dev/core/editor");
const { tryCreateCanvasMeasurer } = await import("@docx-editor.dev/core/layout");

// Experimento: a altura da linha como o Word, pelo OS/2 win (winAscent + winDescent) da fonte.
const WIN: Record<string, number> = { helvetica: 1.17529296875, georgia: 1.13623046875 };
const word = new URLSearchParams(location.search).has("win");
let measurer;
if (word) {
  const base = tryCreateCanvasMeasurer({ context: document.createElement("canvas").getContext("2d"), scale: 4 / 3 })!;
  measurer = new Proxy(base, {
    get(t, k) {
      if (k !== "lineMetrics") { const v = Reflect.get(t, k); return typeof v === "function" ? v.bind(t) : v; }
      return (style: { fontFamily: string | null; fontSizePt: number }, text?: string) => {
        const m = t.lineMetrics(style as never, text);
        const em = WIN[(style.fontFamily ?? "").toLowerCase()];
        if (!em) return m;
        const height = Math.max(m.height, style.fontSizePt * em);
        return { height, baseline: m.baseline + (height - m.height) * (m.baseline / m.height) };
      };
    },
  });
}
const r = mountPaginatedSurface(document.getElementById("doc")!, bytes, { editingMode: "view", ...(word ? { measurer, producer: "kiwi-win", scale: 4 / 3 } : {}) });
if (!r.ok) throw new Error(r.reason);
const s = r.surface;
const frame = () => new Promise((done) => requestAnimationFrame(done));
await frame();
await frame();

window.__paginas = {
  total: s.layout().pages.length,
  async mostrar(i: number) {
    s.revealPage(i, { block: "start" } as never);
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
