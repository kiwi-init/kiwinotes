// A página do gato do app para o peso (T14773; desde o T14885, o gato novo do app, spec #14813; os modos desde o
// T14977): o módulo do app, contra o pacote (`novo.tsx`).
// - `host=overlay` (padrão): as opções do catoverlay/main.ts (`activeFPS` 30). `host=hub`: as do hub (`ui/hub/KiwiCat.tsx`, `activeFPS` 30 desde o #15132).
// - `escondido=1`: `visibility(true)`, como o overlay entre pedidos e o hub sem foco. `parado=1`: o reduzir movimento.
import "./instrumento";
import { createKiwiCat } from "../../ui/kiwicat/cat";
const q = new URLSearchParams(location.search);
const size = Number(q.get("size") ?? 240);
const overlay = (q.get("host") ?? "overlay") === "overlay";
const cat = await createKiwiCat(document.getElementById("cat")!, {
  mode: "runtime", backend: "webgl2", background: "dark", width: size, height: size,
  activeFPS: 30,
  inputs: { estado: (q.get("state") ?? "repouso") as any, cor: "padrao", voz: null, parado: q.get("parado") === "1" },
});
cat.visibility(q.get("escondido") === "1");
Object.assign(window, { kiwiReady: true });
