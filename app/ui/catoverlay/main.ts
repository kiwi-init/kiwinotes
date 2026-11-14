// A página do gato no overlay (spec #9810): roda dentro da janela do helper (`native/.../CatOverlay.swift`), que a
// carrega dos arquivos do app, sem rede. O helper fala com ela por `window.kiwiOverlay.set(...)`.
//
// - Nasce pausada (`visibility(true)`): entre os pedidos, nada desenha.
// - `set({estado, visible: true})` volta a desenhar e muda o estado; `set({visible: false})` pausa antes de a janela
//   sumir. O desenho, os estados e a cor são os do gato do app (o mesmo módulo, recortado).
// - `window.kiwiOverlayStats` diz quanto levou do último `show` ao primeiro quadro apresentado (o `requestAnimationFrame`
//   depois do desenho), e qual caminho o gato usou (WebGPU, WebGL2 ou a imagem parada).

import "../src/styles/tokens.css";
import { createKiwiCat } from "../kiwicat/cat";
import { overlayPlacement } from "./placement";
import type { FogState } from "../kiwicat/state";

const STATES: readonly string[] = ["repouso", "acordou", "ouvindo", "thinking", "agindo", "pronto", "erro"];

interface OverlayStats {
  ready: boolean;
  backend: string | null;
  /** Do `set({visible: true})` ao primeiro quadro apresentado, em ms (o último). */
  firstFrameMs: number | null;
  shows: number;
  visible: boolean;
  estado: string;
  cor: string;
  /** O balão na tela agora (spec #12938), ou null. */
  bubble: { text: string; error: boolean } | null;
}

const stats: OverlayStats = { ready: false, backend: null, firstFrameMs: null, shows: 0, visible: false, estado: "repouso", cor: "", bubble: null };
const bubbleEl = document.getElementById("bubble")!;
const bubbleText = document.getElementById("bubble-text")!;

/** O balão (spec #12938): só texto (`textContent`), nunca HTML. */
function setBubble(b: { text?: unknown; error?: unknown } | null) {
  const text = b && typeof b.text === "string" ? b.text : "";
  if (!text) {
    stats.bubble = null;
    bubbleEl.dataset.on = "false";
    return;
  }
  stats.bubble = { text, error: b?.error === true };
  bubbleText.textContent = text;
  bubbleEl.dataset.error = String(stats.bubble.error);
  bubbleEl.dataset.on = "true";
}
const dark = matchMedia("(prefers-color-scheme: dark)");
const root = document.getElementById("root")!;
// Só a prova do helper (`kiwi-helper --cat-probe --backend …`) pede um caminho: o app usa o automático.
const query = new URLSearchParams(location.search);
const asked = query.get("backend");
/** A cor da névoa (spec #9349), que o helper passa ao carregar (`cor=rrggbb`) e muda depois com `set({cor})`. */
const HEX = /^#[0-9a-f]{6}$/i;
const startColour = `#${query.get("cor") ?? ""}`;
let colour = HEX.test(startColour) ? startColour.toLowerCase() : "claude";
stats.cor = colour;
// A posição e o tamanho (spec #12949): a janela do helper já vem no tamanho; a página põe o gato e o balão no lugar.
const place = overlayPlacement(query);
const css = document.documentElement.style;
css.setProperty("--win-w", `${place.winW}px`);
css.setProperty("--win-h", `${place.winH}px`);
css.setProperty("--cat-w", `${place.catW}px`);
css.setProperty("--cat-h", `${place.catH}px`);
document.body.dataset.lado = place.lado;
document.body.dataset.balao = place.balao;
const cat = await createKiwiCat(root, {
  mode: "runtime",
  backend: asked === "webgl2" || asked === "none" ? asked : "auto",
  width: place.catW,
  height: place.catH,
  cutout: true,
  // O overlay fica por cima de tudo enquanto o agente trabalha: metade dos quadros e a névoa em meia resolução
  // (o spec #9810 mede a CPU; o lead aprovou o ritmo e a resolução em #11135). O desenho é o mesmo do hub.
  activeFPS: 30,
  densityScale: 0.5,
  background: dark.matches ? "dark" : "light",
  inputs: { estado: "repouso", cor: colour, voz: null, parado: false },
});
cat.visibility(true);
dark.addEventListener("change", () => cat.setBackground(dark.matches ? "dark" : "light"));
stats.ready = true;
stats.backend = (cat.fogStats as { backend?: string }).backend ?? null;

/** O primeiro quadro depois do show: dois `requestAnimationFrame` (o desenho e a apresentação). */
function measureFirstFrame(start: number) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    stats.firstFrameMs = Math.round((performance.now() - start) * 10) / 10;
  }));
}

const api = {
  set(input: { estado?: string; visible?: boolean; voz?: number | null; cor?: string; bubble?: { text?: unknown; error?: unknown } | null }) {
    // O balão da resposta (spec #12938): `null` tira.
    if (input.bubble !== undefined) setBubble(input.bubble);
    // A cor da névoa (spec #9349): troca com a passagem de 400 ms do módulo, sem reiniciar o gato.
    if (typeof input.cor === "string" && HEX.test(input.cor) && input.cor.toLowerCase() !== colour) {
      colour = stats.cor = input.cor.toLowerCase();
      cat.update({ cor: colour });
    }
    // A fala pelo Control (spec #9876): o nível do mic, que o helper manda direto; null tira as ondas.
    if (input.voz !== undefined) cat.update({ voz: input.voz });
    if (input.estado && STATES.includes(input.estado) && input.estado !== stats.estado) {
      stats.estado = input.estado;
      cat.update({ estado: input.estado as FogState });
    }
    if (input.visible === true && !stats.visible) {
      const start = performance.now();
      stats.visible = true;
      stats.shows++;
      cat.visibility(false);
      measureFirstFrame(start);
    } else if (input.visible === false && stats.visible) {
      stats.visible = false;
      cat.visibility(true);
    }
  },
  async dispose() {
    stats.visible = false;
    await cat.dispose();
  },
};

Object.assign(window, { kiwiOverlay: api, kiwiOverlayStats: stats, kiwiCatReady: true });
