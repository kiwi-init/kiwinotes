// A página do gato do app para o kiwicat-renderer-check (T14885, spec #14813): o `createKiwiCat` com as opções da URL
// (`?mode=&state=&parado=&size=`, ou `w=&h=` para uma caixa que não é quadrada), exposto em `window.kiwiCat` para o script mandar estados, esconder e contar quadros;
// `window.kiwiExtra()` cria outro gato, fora da tela.
import { createKiwiCat } from "../../ui/kiwicat/cat";
import type { FogState } from "../../ui/kiwicat/visual";
const q = new URLSearchParams(location.search);
const size = Number(q.get("size") ?? 240);
const cat = await createKiwiCat(document.getElementById("cat")!, {
  mode: (q.get("mode") ?? "runtime") as "runtime" | "capture", backend: "webgl2", background: "dark", width: Number(q.get("w") ?? size), height: Number(q.get("h") ?? size),
  inputs: { estado: (q.get("state") ?? "repouso") as FogState, cor: "padrao", voz: null, parado: q.get("parado") === "1" },
  ...(q.has("rest") ? { restAfter: Number(q.get("rest")) } : {}),
});
/** Um gato a mais, fora da tela, para o caso do criar e descartar (o `dispose` solta o WebGL2). */
const extra = (estado: FogState = "repouso") => {
  const el = document.body.appendChild(document.createElement("div"));
  el.style.cssText = "position:absolute;left:-1000px;top:0";
  return createKiwiCat(el, { mode: "capture", backend: "webgl2", background: "dark", width: 96, height: 96, inputs: { estado, cor: "padrao", voz: null, parado: false } })
    .then((c) => ({ cat: c, el }));
};
Object.assign(window, { kiwiCat: cat, kiwiExtra: extra, kiwiReady: true });
