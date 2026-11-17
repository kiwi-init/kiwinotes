// A página do balão do app para o balao-igual (T15095, spec #14896): o `CatBubble` do hub de verdade, com a casca
// comum (`ui/kiwicat-v2/bubble.css`, T14933) e o `hub.css`, alimentado por um `window.engine` falso que manda um pedido
// do agente (`agent.turn`: started, text, done). O contrato é o da `balao-pacote.tsx`: `?texto=&rabo=&fundo=`, o balão
// com o canto de cima à esquerda em (24, 24) e `window.kiwiReady = true`. Mais:
//   ?abrir=1   clica no [Ver mais] depois da digitação: o balão grande (`.kn-bubble-big`) fica na tela.
// O `CatBubble` só tem o rabo à direita (o resto é do overlay, T14951): com outro `?rabo=`, a página põe
// `window.kiwiSkip` com o motivo e não desenha nada.
import { createRoot } from "react-dom/client";
import bubbleCss from "../../ui/kiwicat-v2/bubble.css" with { type: "text" };
import hubCss from "../../ui/hub/hub.css" with { type: "text" };
import { CatBubble } from "../../ui/hub/CatBubble";
import { TYPE_MS } from "../../ui/hub/bubble-state";

const q = new URLSearchParams(location.search);
const texto = q.get("texto") ?? "";
const fundo = q.get("fundo") === "claro" ? "#f5f5f7" : "#090a0e";
for (const el of [document.documentElement, document.body]) el.style.background = fundo;
const ready = () => requestAnimationFrame(() => requestAnimationFrame(() => Object.assign(window, { kiwiReady: true })));

if ((q.get("rabo") ?? "right") !== "right") {
  Object.assign(window, { kiwiSkip: "o CatBubble do hub só tem o rabo à direita; os outros são do overlay (T14951)" });
  ready();
} else {
  // Só o lugar muda: o hub põe o balão no canto, ao lado do gato; aqui ele vai para (24, 24), como o do pacote.
  const place = ".kn-bubble-slot, .kn-bubble-big { left: 24px; top: 24px; right: auto; bottom: auto; }";
  for (const css of [bubbleCss, hubCss, place]) {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }

  // O engine falso: só os eventos que o CatBubble ouve. Nenhuma capacidade.
  const listeners = new Map<string, Set<(p: unknown) => void>>();
  const emit = (name: string, payload: unknown) => listeners.get(name)?.forEach((fn) => fn(payload));
  window.engine = {
    invoke: () => Promise.reject(new Error("balao-app: sem engine")),
    has: () => false,
    ready: () => {},
    reportError: () => {},
    on: (name, fn) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(fn);
      return () => listeners.get(name)?.delete(fn);
    },
  };

  const root = document.getElementById("cat")!;
  createRoot(root).render(<CatBubble reduced={false} />);
  // O pedido chega depois de o CatBubble montar e assinar os eventos.
  setTimeout(() => {
    const id = "balao-igual";
    emit("agent.turn", { id, type: "started" });
    emit("agent.turn", { id, type: "text", text: texto });
    emit("agent.turn", { id, type: "done", stopReason: "end_turn", text: texto });
  }, 50);
  if (q.get("abrir") === "1") {
    setTimeout(() => (document.querySelector(".kn-bubble-more") as HTMLButtonElement | null)?.click(), 50 + TYPE_MS * [...texto].length + 300);
  }
  ready();
}
