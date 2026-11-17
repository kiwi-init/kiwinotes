// A página do balão do pacote para o balao-igual (T14952, spec #14896): o `KiwiSpeechBubble` do pacote, sem mudança,
// com a cor de destaque padrão dele. O contrato de toda página de balão (esta e a do app):
//   ?texto=  o texto do balão     ?rabo=left|right (o app também up|down)     ?fundo=escuro|claro (a cor da página)
// O balão fica com o canto de cima à esquerda em (24, 24) da página; no fim, `window.kiwiReady = true`.
import { createRoot } from "react-dom/client";
import { KiwiSpeechBubble } from "../../../docs/design/kiwicat-v2/agente/ByteKiwiCat";
const q = new URLSearchParams(location.search);
const fundo = q.get("fundo") === "claro" ? "#f5f5f7" : "#090a0e";
for (const el of [document.documentElement, document.body]) el.style.background = fundo;
const root = document.getElementById("cat")!;
Object.assign(root.style, { position: "absolute", left: "24px", top: "24px" });
createRoot(root).render(<KiwiSpeechBubble text={q.get("texto") ?? ""} tailSide={q.get("rabo") === "left" ? "left" : "right"} />);
requestAnimationFrame(() => requestAnimationFrame(() => Object.assign(window, { kiwiReady: true })));
