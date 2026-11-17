// A página do balão do pacote para o balao-igual (T14952, spec #14896): o `KiwiSpeechBubble` do pacote, sem mudança,
// com a cor de destaque padrão dele. O contrato de toda página de balão (esta e a do app):
//   ?texto=  o texto do balão     ?rabo=left|right (o app também up|down)     ?fundo=escuro|claro (a cor da página)
// O balão fica com o canto de cima à esquerda em (24, 24) da página; no fim, `window.kiwiReady = true`.
// Uma mudança sobre o pacote (T17343): o rabo sai da quina da casca, não 24 px para dentro dela. É a decisão do harry
// (#16786, T16754) que o app segue (`.kn-bubble-tail[data-side="bottom-right"] { right: 0 }` em `bubble.css`); o
// desenho do rabo, a casca e as cores continuam os do pacote. `?rabo-pacote=1` volta o rabo para onde o pacote o põe.
import { createRoot } from "react-dom/client";
import { KiwiSpeechBubble } from "../../../docs/design/kiwicat-v2/agente/ByteKiwiCat";
const q = new URLSearchParams(location.search);
const fundo = q.get("fundo") === "claro" ? "#f5f5f7" : "#090a0e";
for (const el of [document.documentElement, document.body]) el.style.background = fundo;
const root = document.getElementById("cat")!;
Object.assign(root.style, { position: "absolute", left: "24px", top: "24px" });
createRoot(root).render(<KiwiSpeechBubble text={q.get("texto") ?? ""} tailSide={q.get("rabo") === "left" ? "left" : "right"} />);
if (q.get("rabo-pacote") !== "1") {
  const style = document.createElement("style");
  style.textContent = "#cat svg[viewBox='0 0 34 24'] { right: 0 !important; } #cat svg[viewBox='0 0 34 24'][style*='scaleX'] { right: auto !important; left: 0 !important; }";
  document.head.appendChild(style);
}
requestAnimationFrame(() => requestAnimationFrame(() => Object.assign(window, { kiwiReady: true })));
