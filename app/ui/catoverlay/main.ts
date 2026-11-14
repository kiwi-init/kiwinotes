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
  /** O texto não cabe nas três linhas: o "Ver mais" aparece (spec #13378). */
  bubbleMore: boolean;
  /** O balão aberto no "Ver mais". */
  bubbleOpen: boolean;
  /** O espaço do balão na janela, em pontos (o helper manda: `set({sala})`). */
  sala: number;
  /** A pergunta "Precisa de mais alguma coisa?" no balão (spec #13380). */
  bubbleAsk: boolean;
  /** O mouse sobre o gato: o × da cabeça aparece (o helper manda: `set({catHover})`). */
  catHover: boolean;
}

const stats: OverlayStats = {
  ready: false, backend: null, firstFrameMs: null, shows: 0, visible: false, estado: "repouso", cor: "", bubble: null,
  bubbleMore: false, bubbleOpen: false, sala: 112, bubbleAsk: false, catHover: false,
};
const bubbleEl = document.getElementById("bubble")!;
const bubbleText = document.getElementById("bubble-text")!;
const moreButton = document.getElementById("bubble-more") as HTMLButtonElement;
const bubbleSr = document.getElementById("bubble-sr")!;
const catClose = document.getElementById("cat-close") as HTMLButtonElement;
type KiwiCatMessage = { bubble?: unknown; open?: boolean; close?: unknown; touch?: true; closed?: true };
const post = (m: KiwiCatMessage) =>
  (window as { webkit?: { messageHandlers?: { kiwiCat?: { postMessage(m: unknown): void } } } }).webkit?.messageHandlers?.kiwiCat?.postMessage(m);
const rectOf = (el: Element) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? { x: Math.floor(r.left), y: Math.floor(r.top), w: Math.ceil(r.width), h: Math.ceil(r.height) } : null;
};

/**
 * O helper acompanha o balão (spec #13378): onde ele está na página e se está aberto. Com isso, só o balão pega o
 * clique, e o gato espera enquanto a pessoa lê. Fora do helper (a prova no WebKit headless), não há para quem mandar.
 */
function report() {
  const on = stats.bubble !== null;
  // O × da cabeça (spec #13380) também pega o clique, quando aparece.
  post({ bubble: on ? rectOf(bubbleEl) : null, open: on && stats.bubbleOpen, close: stats.catHover ? rectOf(catClose) : null });
}

/** Clicar ou rolar no balão conta como interação (spec #13380): a espera do gato recomeça. No máximo duas por segundo. */
let lastTouch = 0;
function touched() {
  const now = performance.now();
  if (now - lastTouch < 500) return;
  lastTouch = now;
  post({ touch: true });
}
bubbleEl.addEventListener("click", touched);
bubbleText.addEventListener("scroll", touched, { passive: true });
/** O × do balão e o da cabeça: o gato sai na hora. */
for (const x of [document.getElementById("bubble-close")!, catClose]) {
  x.addEventListener("click", (e) => {
    e.stopPropagation();
    post({ closed: true });
  });
}
new ResizeObserver(report).observe(bubbleEl);
// A entrada desliza 4 px: no fim dela, o lugar de verdade (o clique conta só em cima do balão).
bubbleEl.addEventListener("transitionend", report);

const fits = () => bubbleText.scrollHeight <= bubbleText.clientHeight + 1;

/**
 * O resumo do balão fechado (revisão do #526): o começo que cabe nas três linhas, cortado numa palavra. Com "…" no fim,
 * menos quando o corte já termina a frase ("pessoas." fica sem as reticências). Devolve se cortou.
 */
function fitSummary(full: string): boolean {
  bubbleText.textContent = full;
  if (fits()) return false;
  const words = full.split(" ");
  const cut = (n: number) => {
    const s = words.slice(0, n).join(" ").replace(/[\s,;:\u2013\u2014-]+$/, "");
    return /[.!?…]$/.test(s) ? s : `${s}…`;
  };
  let lo = 1;
  let hi = words.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    bubbleText.textContent = cut(mid);
    if (fits()) lo = mid;
    else hi = mid - 1;
  }
  bubbleText.textContent = cut(lo);
  return true;
}

/** O degradê das bordas do texto aberto: só onde há mais para rolar. */
function fades() {
  const t = bubbleText;
  const open = stats.bubbleOpen;
  t.style.setProperty("--fade-top", open && t.scrollTop > 1 ? "16px" : "0px");
  t.style.setProperty("--fade-bottom", open && t.scrollTop + t.clientHeight < t.scrollHeight - 1 ? "16px" : "0px");
}
bubbleText.addEventListener("scroll", fades, { passive: true });

function setOpen(open: boolean) {
  stats.bubbleOpen = open;
  bubbleEl.dataset.open = String(open);
  moreButton.textContent = open ? "Ver menos" : "Ver mais";
  moreButton.setAttribute("aria-expanded", String(open));
  if (stats.bubble) {
    if (open) bubbleText.textContent = stats.bubble.text;
    else fitSummary(stats.bubble.text);
  }
  bubbleText.scrollTop = 0;
  fades();
  report();
}

/** O texto passa das três linhas: só aí o "Ver mais" aparece. */
function measureMore() {
  stats.bubbleMore = stats.bubble !== null && fitSummary(stats.bubble.text);
  bubbleEl.dataset.more = String(stats.bubbleMore);
  if (stats.bubbleOpen && stats.bubble) bubbleText.textContent = stats.bubble.text;
}

moreButton.addEventListener("click", (e) => {
  e.stopPropagation();
  setOpen(!stats.bubbleOpen);
});

/** A pergunta antes de sair (spec #13380): entra e sai sem mexer na resposta, aberta ou não. */
function setAsk(on: boolean) {
  stats.bubbleAsk = on;
  bubbleEl.dataset.ask = String(on);
  bubbleSr.textContent = stats.bubble ? `${stats.bubble.text}${on ? ` Precisa de mais alguma coisa?` : ""}` : "";
}

/**
 * O balão (spec #12938): só texto (`textContent`), nunca HTML. Uma resposta nova chega fechada; a mesma resposta com ou
 * sem a pergunta (spec #13380) só muda a pergunta, e o balão fica como a pessoa deixou.
 */
function setBubble(b: { text?: unknown; error?: unknown; ask?: unknown } | null) {
  const text = b && typeof b.text === "string" ? b.text : "";
  const ask = b?.ask === true;
  if (!text) {
    stats.bubble = null;
    bubbleEl.dataset.on = "false";
    setOpen(false);
    measureMore();
    setAsk(false);
    return;
  }
  if (stats.bubble && stats.bubble.text === text && stats.bubble.error === (b?.error === true)) {
    setAsk(ask);
    report();
    return;
  }
  stats.bubble = { text, error: b?.error === true };
  setAsk(ask);
  bubbleEl.dataset.error = String(stats.bubble.error);
  bubbleEl.dataset.on = "true";
  setOpen(false);
  measureMore();
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
  set(input: {
    estado?: string; visible?: boolean; voz?: number | null; cor?: string; sala?: number; catHover?: boolean;
    bubble?: { text?: unknown; error?: unknown; ask?: unknown } | null;
  }) {
    // O mouse sobre o gato (spec #13380): o × da cabeça aparece, e o helper passa a deixar o clique nele.
    if (typeof input.catHover === "boolean" && input.catHover !== stats.catHover) {
      stats.catHover = input.catHover;
      document.body.dataset.catHover = String(input.catHover);
      requestAnimationFrame(report);
    }
    // O espaço do balão na janela (spec #13378), que o helper calcula para a tela de agora: a janela cresce para o lado
    // do balão, e o gato fica onde estava.
    if (typeof input.sala === "number" && Number.isFinite(input.sala) && input.sala >= 112 && input.sala <= 2000 && input.sala !== stats.sala) {
      stats.sala = Math.round(input.sala);
      css.setProperty("--sala", `${stats.sala}px`);
      css.setProperty("--win-h", `${place.catH + stats.sala}px`);
    }
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
