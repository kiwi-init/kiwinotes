// O Kiwi-cat do Rive na intro (spec #3133, T3154). Com o `kiwi-cat.riv` nesta pasta, a janela `intro` toca ele no lugar
// do gato em SVG; sem o arquivo, nada muda. A troca é pôr o `.riv` aqui, e só com o ok do harry na animação (#3133).
//
// - O runtime é o `@rive-app/canvas-single`: o WASM vem dentro do JS do pack. A VIEWS_CSP deixa compilar WebAssembly
//   (`'wasm-unsafe-eval'`), mas o `connect-src` não deixa `fetch`, e o `@rive-app/canvas` baixaria o `.wasm` à parte.
// - O `.riv` também entra no pack (`?inline`) e chega ao runtime como `buffer`, sem `fetch`.
// - O combinado com o arquivo (T3151): o artboard padrão, a state machine `intro` e, no view model padrão, um trigger
//   `done` que dispara quando a abertura acaba. Sem o trigger, a intro segue depois de `RIVE_MAX_S`.
// - O intro.js (gerado pelo docs/brand/intro/gerar.ts) pega isto em `window.kiwiRiveCat`. Se o runtime ou o arquivo
//   falharem, a intro segue com o gato em SVG.

/** O tempo máximo do gato do Rive, igual ao do gato em SVG (a abertura dele leva ~8,4 s, #2251). */
export const RIVE_MAX_S = 8.4;
/** Quanto a intro espera o runtime carregar, na hora do gato, antes de ficar com o SVG. */
export const RIVE_LOAD_WAIT_MS = 1500;

export interface RiveCat {
  /** Mostra e toca o gato; `onEnd` vem uma vez, no fim. Devolve false se o Rive não carregou a tempo (fica o SVG). */
  start(onEnd: () => void): Promise<boolean>;
}

declare global {
  interface Window {
    kiwiRiveCat?: RiveCat;
  }
  /** Se o `kiwi-cat.riv` está nesta pasta no build (o `define` do vite.config.ts). */
  const __KIWI_RIVE_CAT__: boolean;
}

/** Os bytes de um `data:` em base64 (o `?inline` do Vite), sem `fetch`. */
export function dataUrlBytes(url: string): ArrayBuffer {
  const comma = url.indexOf(",");
  if (!url.startsWith("data:") || comma < 0 || !url.slice(0, comma).endsWith(";base64")) throw new Error("rive: o .riv não veio em base64");
  const bin = atob(url.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

// O `typeof` deixa importar isto fora do Vite (no `bun test`), onde a constante não existe.
const hasRiv = typeof __KIWI_RIVE_CAT__ !== "undefined" && __KIWI_RIVE_CAT__;
const riv = hasRiv
  ? import.meta.glob<string>("./kiwi-cat.riv", { query: "?inline", import: "default", eager: true })["./kiwi-cat.riv"]
  : undefined;

if (hasRiv && riv) {
  const canvas = document.createElement("canvas");
  canvas.id = "rive-cat";
  canvas.width = canvas.height = 1024;
  canvas.style.cssText = "position:absolute;left:0;top:0;width:1024px;height:1024px;opacity:0;pointer-events:none";
  document.getElementById("fit")?.append(canvas);

  // Carrega já, parado: o WASM e o arquivo ficam prontos durante o prisma (os primeiros 3,7 s).
  const loaded = import("@rive-app/canvas-single").then(
    ({ Rive, Layout, Fit, Alignment }) =>
      new Promise<import("@rive-app/canvas-single").Rive>((resolve, reject) => {
        const r: import("@rive-app/canvas-single").Rive = new Rive({
          canvas,
          buffer: dataUrlBytes(riv),
          autoplay: false,
          autoBind: true,
          layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
          onLoad: () => resolve(r),
          onLoadError: (e) => reject(new Error(`rive: ${String(e.data)}`)),
        });
      }),
  );
  loaded.catch((e) => console.warn(String(e)));

  window.kiwiRiveCat = {
    async start(onEnd) {
      const r = await Promise.race([loaded.catch(() => null), new Promise<null>((ok) => setTimeout(() => ok(null), RIVE_LOAD_WAIT_MS))]);
      if (!r) return false;
      let ended = false;
      const end = () => {
        if (ended) return;
        ended = true;
        clearTimeout(cap);
        onEnd();
      };
      const cap = setTimeout(end, RIVE_MAX_S * 1000);
      r.viewModelInstance?.trigger("done")?.on(end);
      r.resizeDrawingSurfaceToCanvas();
      canvas.style.opacity = "1";
      // A state machine `intro`; num arquivo sem ela (um de exemplo, no teste), a primeira que houver.
      r.play(r.stateMachineNames.includes("intro") ? "intro" : r.stateMachineNames[0]);
      return true;
    },
  };
}
