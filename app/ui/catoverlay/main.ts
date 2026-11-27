// A página do gato no overlay (spec #9810): roda dentro da janela do helper (`native/.../CatOverlay.swift`), que a
// carrega dos arquivos do app, sem rede. O helper fala com ela por `window.kiwiOverlay.set(...)`.
//
// - Nasce pausada (`visibility(true)`): entre os pedidos, nada desenha.
// - `set({estado, visible: true})` volta a desenhar e muda o estado; `set({visible: false})` pausa antes de a janela
//   sumir. O desenho, os estados e a cor são os do gato do app (o mesmo módulo, recortado).
// - `window.kiwiOverlayStats` diz quanto levou do último `show` ao primeiro quadro apresentado (o `requestAnimationFrame`
//   depois do desenho), e qual caminho o gato usou (WebGL2, ou o desenho sem ele).
// - O gato entra condensando da névoa (420 ms) e sai nela (280 ms), a `materializacao-nevoa` do pacote (spec #14813);
//   o desenho para depois da saída.

import "../src/styles/tokens.css";
import "../kiwicat-v2/bubble.css";
import "../kiwicat-v2/bubble-md.css";
import { DEFAULT_CAT_COLOR, catPalette, isCatColorChoice } from "../../src/shared/kiwicat-colors";
import { createKiwiCat } from "../kiwicat/cat";
import { openPlacement, openShellWidth, overlayPlacement } from "./placement";
import { tailSvg } from "../kiwicat-v2/bubbleTail";
import type { BubbleLink } from "../../src/shared/ui-contract";
import { plainMarkdown, renderMarkdown } from "../src/bubbleMarkdown";
import { bubblePlain, summaryOf } from "../hub/bubble-state";
import { BubblePeek } from "../hub/bubble-peek";
import { EXIT_MS, exitStyle, HIDDEN_STYLE, shownStyle, type CatTransitionStyle } from "./transition";
import type { FogState } from "../kiwicat/visual";
import { ptCatOverlay } from "../../src/shared/i18n/catoverlay.pt";
import { enCatOverlay } from "../../src/shared/i18n/catoverlay.en";

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
  /** `links` (spec #17683): as notas e os arquivos que o main achou na resposta, que viram link no balão aberto. */
  /** `summary` (spec #27881, T28010): de onde sai o resumo do fechado (a fala do `cat_speak` ou a resposta final). */
  bubble: { text: string; error: boolean; links: BubbleLink[]; summary?: string } | null;
  /** O texto não cabe nas três linhas: o "Ver mais" aparece (spec #13378). */
  bubbleMore: boolean;
  /** O balão aberto no "Ver mais". */
  bubbleOpen: boolean;
  /** O espaço do balão na janela, em pontos (o helper manda: `set({sala})`). */
  sala: number;
  /** A casca do balão aberto, de 280 a 480 (o helper manda: `set({largura})`, spec #17673). */
  largura: number;
  /** A pergunta "Precisa de mais alguma coisa?" no balão (spec #13380). */
  bubbleAsk: boolean;
  /** O mouse sobre o gato: o × da cabeça aparece (o helper manda: `set({catHover})`). */
  catHover: boolean;
  /** O mouse sobre o balão (o helper manda: `set({bubbleHover})`, spec #32534). */
  bubbleHover: boolean;
  /** O balão à vista (spec #32534): com o mouse no gato ou no balão, ou o "Ver mais" aberto, e 250 ms depois. */
  peek: boolean;
  /** Um balão que a pessoa ainda não viu: a marca no gato, na cor de destaque. */
  unseen: boolean;
  /** A voz do gato (T26829): o nível que chegou por último, ou `null` sem voz. */
  fala: number | null;
  /** A língua dos textos da página (T29351): a do helper, na URL (`lang=`) e depois por `set({lang})`. */
  lang: Lang;
}

/**
 * Os textos da página (T29351, spec #28171): só o catálogo do overlay, não o do app inteiro. A língua é a do app, que o
 * helper recebe no `app.locale` e passa aqui; uma que não é `en` fica em português, como a página era antes.
 */
type Lang = "pt" | "en";
const TEXTS = { pt: ptCatOverlay, en: enCatOverlay } as const;
const langOf = (v: unknown): Lang => (v === "en" ? "en" : "pt");
const t = (key: keyof typeof ptCatOverlay) => TEXTS[stats.lang][key];

const stats: OverlayStats = {
  ready: false, backend: null, firstFrameMs: null, shows: 0, visible: false, estado: "repouso", cor: "", bubble: null,
  bubbleMore: false, bubbleOpen: false, sala: 112, largura: 280, bubbleAsk: false, catHover: false, bubbleHover: false, peek: false, unseen: false, fala: null,
  lang: langOf(new URLSearchParams(location.search).get("lang")),
};
const bubbleEl = document.getElementById("bubble")!;
const bubbleText = document.getElementById("bubble-text")!;
const moreButton = document.getElementById("bubble-more") as HTMLButtonElement;
const bubbleSr = document.getElementById("bubble-sr")!;
const catClose = document.getElementById("cat-close") as HTMLButtonElement;
const bubbleAskEl = document.getElementById("bubble-ask")!;
const bubbleClose = document.getElementById("bubble-close")!;

/** Os textos fixos na língua de agora: o "Ver mais"/"Ver menos", a pergunta, os dois × e o `lang` do documento. */
function paintTexts() {
  document.documentElement.lang = stats.lang === "en" ? "en" : "pt-BR";
  moreButton.textContent = t(stats.bubbleOpen ? "catOverlay.less" : "catOverlay.more");
  bubbleAskEl.textContent = t("catOverlay.ask");
  bubbleClose.setAttribute("aria-label", t("catOverlay.closeBubble"));
  catClose.setAttribute("aria-label", t("catOverlay.closeCat"));
}
paintTexts();
type KiwiCatMessage = { bubble?: unknown; open?: boolean; close?: unknown; touch?: true; closed?: true; link?: string; openPath?: string };
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
  // Escondido (spec #32534), o balão não pega o clique: o lugar dele vai como nenhum, e o clique passa ao app de trás.
  const on = stats.bubble !== null && stats.peek;
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
/** Um link do markdown (spec #17679) não tem `href` e não abre sozinho: só o clique da pessoa manda o endereço ao helper. */
bubbleText.addEventListener("click", (e) => {
  const a = (e.target as Element | null)?.closest?.(".kn-md-link") as HTMLElement | null;
  // Uma nota ou um arquivo da pasta (spec #17683): o caminho vai ao helper, que pede ao app para abrir.
  if (a?.dataset.path) {
    e.preventDefault();
    post({ openPath: a.dataset.path });
    return;
  }
  if (!a?.dataset.href) return;
  e.preventDefault();
  post({ link: a.dataset.href });
});
/** O × do balão e o da cabeça: o gato sai na hora. */
for (const x of [bubbleClose, catClose]) {
  x.addEventListener("click", (e) => {
    e.stopPropagation();
    post({ closed: true });
  });
}
new ResizeObserver(report).observe(bubbleEl);
// A entrada desliza 4 px: no fim dela, o lugar de verdade (o clique conta só em cima do balão).
bubbleEl.addEventListener("transitionend", report);

/** A marca no gato (spec #32534): um balão que ainda não apareceu para a pessoa. */
function setUnseen(on: boolean) {
  stats.unseen = on;
  document.body.dataset.unseen = String(on);
}

/** O balão no mouse (spec #32534): a regra é a do Hub (`BubblePeek`). Aparecer com um balão conta como visto. */
const peek = new BubblePeek((shown) => {
  stats.peek = shown;
  bubbleEl.dataset.peek = String(shown);
  if (shown && stats.bubble) setUnseen(false);
  report();
});

const fits = () => bubbleText.scrollHeight <= bubbleText.clientHeight + 1;

/** O balão aberto (spec #17679): o markdown montado em elementos, nunca HTML. */
function showFull(text: string, links: readonly BubbleLink[]) {
  bubbleText.replaceChildren(renderMarkdown(text, undefined, links));
  bubbleText.classList.add("kn-md");
}

/**
 * O resumo do balão fechado (spec #27881, o mesmo do Hub): a fala do `cat_speak` ou, sem ela, as frases do começo da
 * resposta que cabem nas três linhas, sem o título (#28009). Devolve se o aberto tem mais que o resumo (o "Ver mais").
 */
function fitSummary(b: { text: string; summary?: string }): boolean {
  bubbleText.classList.remove("kn-md");
  const full = bubblePlain(b.text);
  const shown = summaryOf(bubblePlain(b.summary ?? b.text), (s) => {
    bubbleText.textContent = s;
    return fits();
  });
  bubbleText.textContent = shown;
  return words(shown) !== words(full);
}
const words = (s: string) => s.split(/\s+/).filter(Boolean).join(" ");

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
  // O "Ver mais" aberto fica até o ×, o Esc ou um clique fora (spec #32534).
  peek.pin(open);
  bubbleEl.dataset.open = String(open);
  moreButton.textContent = t(open ? "catOverlay.less" : "catOverlay.more");
  moreButton.setAttribute("aria-expanded", String(open));
  if (stats.bubble) {
    if (open) showFull(stats.bubble.text, stats.bubble.links);
    else fitSummary(stats.bubble);
  }
  bubbleText.scrollTop = 0;
  fades();
  report();
}

/** O texto passa das três linhas: só aí o "Ver mais" aparece. */
function measureMore() {
  stats.bubbleMore = stats.bubble !== null && fitSummary(stats.bubble);
  bubbleEl.dataset.more = String(stats.bubbleMore);
  if (stats.bubbleOpen && stats.bubble) showFull(stats.bubble.text, stats.bubble.links);
}

moreButton.addEventListener("click", (e) => {
  e.stopPropagation();
  setOpen(!stats.bubbleOpen);
});

/** A pergunta antes de sair (spec #13380): entra e sai sem mexer na resposta, aberta ou não. */
function setAsk(on: boolean) {
  stats.bubbleAsk = on;
  bubbleEl.dataset.ask = String(on);
  bubbleSr.textContent = stats.bubble ? `${plainMarkdown(stats.bubble.text)}${on ? ` ${t("catOverlay.ask")}` : ""}` : "";
}

/**
 * O balão (spec #12938): só texto (`textContent`) ou o markdown montado em elementos (spec #17679), nunca HTML. Uma resposta nova chega fechada; a mesma resposta com ou
 * sem a pergunta (spec #13380) só muda a pergunta, e o balão fica como a pessoa deixou.
 */
function setBubble(b: { text?: unknown; error?: unknown; ask?: unknown; links?: unknown; summary?: unknown } | null) {
  const text = b && typeof b.text === "string" ? b.text : "";
  const summary = b && typeof b.summary === "string" && b.summary.trim() ? b.summary : undefined;
  const links = linksOf(b?.links);
  const ask = b?.ask === true;
  if (!text) {
    stats.bubble = null;
    bubbleEl.dataset.on = "false";
    setUnseen(false);
    setOpen(false);
    measureMore();
    setAsk(false);
    return;
  }
  if (stats.bubble && stats.bubble.text === text && stats.bubble.summary === summary && stats.bubble.error === (b?.error === true)) {
    // Os links podem chegar depois do texto (com a pergunta): o aberto se monta de novo, no mesmo lugar.
    if (JSON.stringify(links) !== JSON.stringify(stats.bubble.links)) {
      stats.bubble.links = links;
      if (stats.bubbleOpen) {
        const top = bubbleText.scrollTop;
        showFull(text, links);
        bubbleText.scrollTop = top;
      }
    }
    setAsk(ask);
    report();
    return;
  }
  // A mesma resposta que cresceu (T33053, Cena 1): o balão nasceu com a fala e o `done` trouxe o texto inteiro, com a
  // fala de resumo. O de cima não muda, e a marca fica como estava: não é um balão novo.
  const grew = !!stats.bubble && !stats.bubble.error && b?.error !== true && (stats.bubble.summary ?? stats.bubble.text) === (summary ?? text);
  stats.bubble = { text, error: b?.error === true, links, ...(summary ? { summary } : {}) };
  setAsk(ask);
  bubbleEl.dataset.error = String(stats.bubble.error);
  bubbleEl.dataset.on = "true";
  // Uma resposta nova com o mouse longe espera ser vista: a marca no gato (spec #32534).
  if (!grew) {
    setUnseen(!stats.peek);
    setOpen(false);
  }
  measureMore();
  report();
}
/** Os links que vieram do helper, conferidos na forma: o que não for um `BubbleLink` some. */
function linksOf(raw: unknown): BubbleLink[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (l): l is BubbleLink =>
      !!l && typeof l === "object" && typeof l.text === "string" && typeof l.path === "string" && l.path !== "" &&
      Number.isInteger(l.from) && Number.isInteger(l.to) && (l.kind === "note" || l.kind === "file"),
  );
}
const root = document.getElementById("root")!;
// Só a prova do helper (`kiwi-helper --cat-probe --backend …`) pede um caminho: o app usa o automático.
const query = new URLSearchParams(location.search);
const asked = query.get("backend");
/**
 * A paleta (spec #14963), pelo id, que o helper passa ao carregar (`cor=kiwi-neon`) e muda depois com `set({cor})`. Um id
 * que não é uma das 5 desenha a `prisma-original`.
 */
let colour = isCatColorChoice(query.get("cor")) ? query.get("cor")! : DEFAULT_CAT_COLOR;
/** A borda e a sombra do balão (`bubble.css`) na cor de destaque da paleta. */
const paintAccent = () => document.documentElement.style.setProperty("--kn-cat-accent", catPalette(colour).accentColor);
paintAccent();
stats.cor = colour;
// A posição e o tamanho (spec #12949): a janela do helper já vem no tamanho; a página põe o gato e o balão no lugar.
const place = overlayPlacement(query);
const css = document.documentElement.style;
css.setProperty("--win-w", `${place.winW}px`);
css.setProperty("--win-h", `${place.winH}px`);
css.setProperty("--cat-w", `${place.catW}px`);
css.setProperty("--cat-h", `${place.catH}px`);
css.setProperty("--cat-x", `${place.catX}px`);
for (const [k, v] of Object.entries(place.bubble)) css.setProperty(`--bub-${k}`, `${v}px`);
document.body.dataset.lado = place.lado;
document.body.dataset.balao = place.balao;
// O rabo do balão (T14933, spec #14896): o do pacote, na quina do balão mais perto do gato (T16754).
bubbleEl.insertAdjacentHTML("beforeend", tailSvg(place.tail));
const cat = await createKiwiCat(root, {
  mode: "runtime",
  backend: asked === "webgl2" || asked === "none" ? asked : "auto",
  width: place.catW,
  height: place.catH,
  // O overlay fica por cima de tudo enquanto o agente trabalha: 30 quadros por segundo (spec #14813). O desenho é o
  // mesmo do hub.
  activeFPS: 30,
  // O painel do overlay nunca tem o foco: parado, ele segue desenhando enquanto aparece (e some quando o agente acaba).
  pauseUnfocused: false,
  // A tinta dos emotes vem do fundo de verdade (spec #14963): o overlay é escuro mesmo com o Mac no tema claro, então ela
  // é sempre a clara. O tema do sistema não entra.
  background: "dark",
  inputs: { estado: "repouso", cor: colour, voz: null, parado: false },
});
cat.visibility(true);
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
let exitTimer = 0;
function setTransition(style: CatTransitionStyle) {
  Object.assign(root.style, style);
}
setTransition(HIDDEN_STYLE);
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
    estado?: string; visible?: boolean; voz?: number | null; fala?: number | null; cor?: string; sala?: number; largura?: number; catHover?: boolean;
    lang?: string; bubbleHover?: boolean;
    bubble?: { text?: unknown; error?: unknown; ask?: unknown; links?: unknown; summary?: unknown } | null;
  }) {
    // A língua do app (T29351): o helper manda a de agora ao carregar e a cada troca. Muda os textos, não o balão.
    if (input.lang !== undefined && langOf(input.lang) !== stats.lang) {
      stats.lang = langOf(input.lang);
      paintTexts();
      setAsk(stats.bubbleAsk);
    }
    // O mouse sobre o gato (spec #13380): o × da cabeça aparece, e o helper passa a deixar o clique nele.
    if (typeof input.catHover === "boolean" && input.catHover !== stats.catHover) {
      stats.catHover = input.catHover;
      document.body.dataset.catHover = String(input.catHover);
      peek.hover("kiwi", input.catHover);
      requestAnimationFrame(report);
    }
    // O mouse sobre o balão (spec #32534): ele fica à vista enquanto a pessoa lê.
    if (typeof input.bubbleHover === "boolean" && input.bubbleHover !== stats.bubbleHover) {
      stats.bubbleHover = input.bubbleHover;
      peek.hover("balao", input.bubbleHover);
    }
    // O espaço do balão na janela (spec #13378), que o helper calcula para a tela de agora: a janela cresce para o lado
    // do balão, e o gato fica onde estava.
    if (typeof input.sala === "number" && Number.isFinite(input.sala) && input.sala >= 112 && input.sala <= 2000 && input.sala !== stats.sala) {
      stats.sala = Math.round(input.sala);
      css.setProperty("--sala", `${stats.sala}px`);
      css.setProperty("--win-h", `${place.catH + stats.sala}px`);
    }
    // A largura do balão aberto (spec #17673): a janela já tem o espaço a mais do lado do balão; o gato anda o mesmo
    // tanto na página para ficar onde estava na tela.
    if (input.largura !== undefined && openShellWidth(input.largura) !== stats.largura) {
      stats.largura = openShellWidth(input.largura);
      const open = openPlacement(place, stats.largura);
      css.setProperty("--largura", `${stats.largura}px`);
      css.setProperty("--win-w", `${open.winW}px`);
      css.setProperty("--cat-x", `${open.catX}px`);
    }
    // O balão da resposta (spec #12938): `null` tira.
    if (input.bubble !== undefined) setBubble(input.bubble);
    // A paleta (spec #14963): troca no próximo quadro, sem reiniciar o gato.
    if (isCatColorChoice(input.cor) && input.cor !== colour) {
      colour = stats.cor = input.cor;
      paintAccent();
      cat.update({ cor: colour });
    }
    // A fala pelo Control (spec #9876): o nível do mic, que o helper manda direto; null tira as ondas.
    if (input.voz !== undefined) cat.update({ voz: input.voz });
    // A voz do gato (T26829): o `falando`, com a boca no nível do que tocou; null volta ao estado de antes.
    if (input.fala !== undefined) {
      stats.fala = typeof input.fala === "number" && Number.isFinite(input.fala) ? input.fala : null;
      cat.update({ fala: stats.fala });
    }
    if (input.estado && STATES.includes(input.estado) && input.estado !== stats.estado) {
      stats.estado = input.estado;
      cat.update({ estado: input.estado as FogState });
    }
    if (input.visible === true && !stats.visible) {
      const start = performance.now();
      stats.visible = true;
      stats.shows++;
      if (exitTimer) { clearTimeout(exitTimer); exitTimer = 0; }
      cat.visibility(false);
      // A entrada parte da névoa: o estilo de antes, um quadro, e a passagem.
      setTransition(HIDDEN_STYLE);
      void root.offsetWidth;
      setTransition(shownStyle(reducedMotion.matches));
      measureFirstFrame(start);
    } else if (input.visible === false && stats.visible) {
      stats.visible = false;
      // O mouse não segue para a próxima entrada: o helper zera o dele ao esconder a janela.
      stats.catHover = stats.bubbleHover = false;
      document.body.dataset.catHover = "false";
      peek.hover("kiwi", false);
      peek.hover("balao", false);
      // A voz que ainda tocava não segue para a próxima entrada (T26829): o helper não passa o `null` à página escondida.
      stats.fala = null;
      cat.update({ fala: null });
      const reduced = reducedMotion.matches;
      setTransition(exitStyle(reduced));
      // O desenho para quando a saída acaba.
      if (exitTimer) clearTimeout(exitTimer);
      if (reduced) cat.visibility(true);
      else exitTimer = window.setTimeout(() => { exitTimer = 0; if (!stats.visible) cat.visibility(true); }, EXIT_MS);
    }
  },
  /** O clique fora com o "Ver mais" aberto (spec #32534): o helper o vê pelo botão do mouse; o balão volta ao resumo. */
  collapse() {
    if (stats.bubbleOpen) setOpen(false);
  },
  /** O Esc com o mouse no gato ou no balão (spec #32534, #32777): fecha o "Ver mais"; fechado, o balão, como o × dele. */
  escape() {
    if (stats.bubbleOpen) setOpen(false);
    else if (stats.bubble && stats.peek) post({ closed: true });
  },
  async dispose() {
    stats.visible = false;
    await cat.dispose();
  },
};

Object.assign(window, { kiwiOverlay: api, kiwiOverlayStats: stats, kiwiCatReady: true });
