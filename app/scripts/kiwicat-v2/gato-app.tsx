// A página do gato do app para o gato-igual (T14899, T14885, spec #14813): o `createKiwiCat` do app, no contrato da
// `novo.tsx` (`?state=&emote=&size=`, `#cat`, `window.kiwiReady`). O estado e o emote do pacote vão direto
// (`look`), sem a tabela 1.1, que tem os testes dela; o resto é o caminho do app. Como o pacote na `novo.tsx`: sem voz
// simulada (voz 0), fundo escuro, e o sorteio da piscada pelo `Math.random` que o script semeia.
import "./instrumento";
// O React DOM sorteia a chave interna dele (`__reactFiber$…`) pelo `Math.random` ao carregar. A `novo.tsx` o carrega, e
// isso anda a sequência semeada antes da 1ª piscada: carregado aqui também, as duas páginas sorteiam a mesma piscada.
import "react-dom/client";
import { createKiwiCat } from "../../ui/kiwicat/cat";
import type { KiwiEmote, KiwiState } from "../../ui/kiwicat-v2/cat-config";
const q = new URLSearchParams(location.search);
const size = Number(q.get("size") ?? 240);
await createKiwiCat(document.getElementById("cat")!, {
  mode: "runtime", backend: "webgl2", background: "dark", width: size, height: size, activeFPS: 60, quietFPS: 60,
  random: Math.random, sleepSeconds: () => 1e9,
  look: { estado: (q.get("state") ?? "repouso") as KiwiState, emote: (q.get("emote") ?? "auto") as KiwiEmote },
  // A paleta (T15035, spec #14963): o id pelo `cor`, como os Ajustes; sem `?palette=`, a padrão.
  inputs: { estado: "repouso", cor: q.get("palette") ?? "padrao", voz: 0, parado: false },
});
requestAnimationFrame(() => Object.assign(window, { kiwiReady: true }));
