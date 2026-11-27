// T18648 / spec #17725: a gota das Notas no build real, com engine headless isolado. Nenhum app abre na tela.
// Pegue kiwi lock bench. Uso: bun scripts/hub-goo-check.ts [OUT]
//
// Para cada tema (claro e escuro):
// 1. Quadro a quadro: a ida (Ajustes → Notas) e a volta (Notas → Ajustes), com as animações da barra paradas em
//    tempos fixos, um print da barra por quadro (em OUT/<tema>/ida e OUT/<tema>/volta).
// 2. Em tempo real, gravando um vídeo (OUT/<tema>/video): três idas e voltas com o clique de verdade. O maior intervalo
//    entre quadros, do clique até 1 s depois, fica abaixo dos 100 ms do slowFrames (spec #12918), e o slowFrames do
//    app (`diagnostics.slowFrame`) não acusa nada. Uma rodada lenta se repete uma vez (a máquina é dividida). No CI
//    (`CI=1`), o tempo só vai para o log: a VM não tem um relógio de quadros confiável; o resto barra igual.
// 3. A seção lenta (#231, spec #32446): 50 ms presos no clique, como a seção nova montando, e um quadro de 80 ms no
//    meio do caminho. A gota espera a seção pintar (`data-waiting`, sem relógio) e larga do começo: o 1º desenho fica a
//    até um quadro do 0, a barriga inteira. Depois, o relógio anda com o tempo real, sem congelar e sem pular.
// 4. A troca no meio (spec #32446): com a gota parada a 40% da ida, o clique na volta (e o inverso). O caminho novo sai
//    do estado daquele instante: a cabeça não anda mais que um quadro normal entre o último quadro do relógio velho e
//    o 0 do novo. No vídeo do item 2, a troca no meio também roda em tempo real.
// E "reduzir movimento", o do Mac (`prefers-reduced-motion`) e o do Kiwi (`data-motion="reduced"`): sem gota, os
// botões só fazem o fade (OUT/reduzir-mac, OUT/reduzir-kiwi).
//
// Confere: as fases (entering → shown, leaving → hidden), a duração (a da mola, até o teto do plano), a gota no lugar dos botões no fim da
// ida, e o texto e os ícones fora da camada e por cima da gota em todos os quadros.
//
// A forma e o rastro, nos pixels (T18950, harry #18945), sem depender de como a gota é desenhada: em cada quadro sai
// também um print só da camada `.kn-goo`, preta no branco, e um laboratório (uma página em branco) conta os pixels.
// - Forma: coluna a coluna, na faixa entre a pílula e a borda da janela de cada lado, a altura da gota
//   (`goo-profile.ts`). A ida tem que passar por um quadro com pescoço (ligação < 30% da altura da gota) e por um com a
//   gota solta; no fim da volta, nada fora da pílula. Um deslizar de pílula não passa.
// - Rastro: fora da gota (com folga para a borda e a sombra) e dos botões, a faixa tem que ser igual à barra parada
//   em Ajustes, em cada quadro e depois de cada volta em tempo real.
// - A tira (OUT/<tema>/<ida|volta>/lado-*/): o recorte de cada lado por quadro, que o `goo-strip.ts` junta para
//   comparar com a referência.
// Sem um headless de pé, sobe o seu (`cli start --no-helper`) e o derruba no fim, passe ou falhe. Sem OUT, os prints
// vão para uma pasta nova do tmp, que fica (a saída diz onde).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Browser, type Page } from "playwright-core";

import { SLOW_FRAME_MS, WATCH_MS } from "../ui/src/slowFrames.ts";
import { request } from "./cli.ts";
import { GOO_PLAN_MAX_MS } from "../ui/hub/goo-spring.ts";
import { dripProblem, dropShape, type DropShape } from "./goo-profile.ts";
import { openWindow, settle, type UiContext } from "./ui-page.ts";

const [outArg] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const out = resolve(outArg ?? mkdtempSync(join(tmpdir(), "kn-hub-goo-out-")));
const data = mkdtempSync(join(tmpdir(), "kn-hub-goo-"));
mkdirSync(out, { recursive: true });

/** Os tempos de cada quadro, em fração da animação: 12, como os quadros da referência do harry. */
const FRAMES = Array.from({ length: 12 }, (_, i) => i / 11);
/** Um pixel do rastro: um canal com mais que isto de diferença da barra parada. */
const TRAIL_DIFF = 32;
/**
 * O piso da borda (#19034), com a medida do `analyze`; os botões das Notas não servem de régua no escuro (~4).
 * - A pílula parada na main antes da Gota 2 (b3f76782), com a janela já de pé: 57 e 27,8, igual em duas rodadas
 *   (T19175). A pílula não fica abaixo de 90% disto.
 * - A gota, em cada quadro, não fica abaixo de `DROP_RING` (o mesmo número da rodada 1: 80% da pílula medida então,
 *   39 e 21). Na main, a gota do claro dava 33 e a do escuro ~14: a mancha sem borda do #18974, que não passa.
 */
const PILL_RING = { light: 57, dark: 27.8 };
const PILL_MIN = 0.9;
const DROP_RING = { light: 31.2, dark: 16.8 };
/** No 1º quadro depois do clique da volta (9%), os botões ainda com esta fração do conteúdo de antes (#18974). */
const BUTTONS_EARLY = 0.3;
/** Na troca no meio em tempo real (o vídeo), o clique na outra aba sai este tempo depois do primeiro. */
const SWITCH_REAL_MS = 150;
/** Idas e voltas em tempo real, por tema. */
const ROUNDS = 3;

const ctx: UiContext = {
  data,
  send: async (msg) => {
    const r = await request(data, msg);
    if (!r) throw new Error(`o headless em ${data} parou no meio do roteiro`);
    return r;
  },
  subscribe: async () => () => {},
};

type Box = { x: number; y: number; w: number; h: number };
type Side = "start" | "end";
type Frame = {
  t: number; start: Box | null; end: Box | null; shape: Record<Side, DropShape>; cols: Record<Side, number[]>;
  trail: { count: number; at: number[][] }; ring: { start: number | null; end: number | null; pill: number | null; buttons: number | null };
};
const SIDES: Side[] = ["start", "end"];

/** As fases dos dois lados e dos slots. */
const phases = (p: Page) => p.evaluate(() => {
  const goo = document.querySelector<HTMLElement>(".kn-goo")!;
  const slot = (s: string) => document.querySelector<HTMLElement>(`.kn-hub-${s}`)!;
  return {
    start: goo.dataset.start, end: goo.dataset.end,
    slotStart: slot("start").dataset.goo, slotEnd: slot("end").dataset.goo,
    buttons: { start: slot("start").childElementCount, end: slot("end").childElementCount },
  };
});

/** Espera uma fase nos dois lados (a ida termina em `shown`, a volta em `hidden`). */
const waitPhase = (p: Page, phase: string) => p.waitForFunction((ph) => {
  const goo = document.querySelector<HTMLElement>(".kn-goo");
  return goo?.dataset.start === ph && goo.dataset.end === ph;
}, phase, { timeout: 3000 });

/** O texto e os ícones nítidos: nenhum deles dentro da camada ou embaixo de um `filter`, e por cima da gota no quadro. */
const crisp = (p: Page) => p.evaluate(() => {
  const problems: string[] = [];
  // A camada tem `pointer-events: none`, e o `elementFromPoint` passa reto por ela: durante o teste, ela vira
  // "clicável" para o teste a ver (sem isso, a gota por cima do texto passava; revisão do T18648).
  const see = document.createElement("style");
  see.textContent = ".kn-goo, .kn-goo * { pointer-events: auto !important; }";
  document.head.append(see);
  const els = [
    ...document.querySelectorAll<HTMLElement>(".kn-tab"),
    ...document.querySelectorAll<HTMLElement>(".kn-hub-slot button"),
  ];
  for (const el of els) {
    const name = el.getAttribute("aria-label") || el.textContent?.trim() || el.className;
    if (el.closest(".kn-goo")) problems.push(`${name}: dentro da camada da gota`);
    for (let a: HTMLElement | null = el; a; a = a.parentElement) {
      const f = getComputedStyle(a).filter;
      if (f && f !== "none") problems.push(`${name}: embaixo de filter ${f} (${a.className})`);
    }
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    if (hit && !el.contains(hit) && !hit.contains(el)) problems.push(`${name}: coberto por ${hit.className}`);
  }
  see.remove();
  // A gota é desenhada (T18948): caminhos SVG, sem filtro e sem texto dentro. A cópia dos botões na volta (T18949)
  // mora na camada de propósito, nítida, fora do desenho.
  const draw = document.querySelector<SVGElement>(".kn-goo-draw");
  if (!draw) problems.push("sem .kn-goo-draw");
  else {
    if (getComputedStyle(draw).filter !== "none") problems.push(`a gota passa por um filter: ${getComputedStyle(draw).filter}`);
    if (draw.textContent?.trim()) problems.push("texto dentro da gota");
  }
  return { checked: els.length, problems };
});

/** Para as animações da barra logo depois do clique na aba; devolve o nome e a duração de cada uma. */
const clickAndPause = (p: Page, section: string) => p.evaluate(async (s) => {
  // A reserva de 900 ms (GOO_FALLBACK_MS) andaria a fase com a animação parada; segura só ela enquanto os quadros saem.
  const w = window as unknown as { __gooTimeout?: typeof setTimeout; setTimeout: typeof setTimeout };
  w.__gooTimeout ??= window.setTimeout;
  const orig = w.__gooTimeout;
  w.setTimeout = ((fn: () => void, ms?: number, ...a: unknown[]) =>
    (ms ?? 0) >= 900 ? orig(() => {}, 0) : orig(fn, ms, ...a)) as typeof setTimeout;
  document.querySelector<HTMLElement>(`.kn-tab[data-section="${s}"]`)!.click();
  const bar = document.querySelector(".kn-hub-top")!;
  // A gota anda por um relógio WAAPI (`.kn-goo-clock[data-side]`, T18948) ou por @keyframes `kn-goo-in|out-*`; os
  // botões, pela animação `kn-goo-buttons-in` (a CSS, ou uma WAAPI com esse `id` na mola, #32526). Tudo o que for da
  // gota na barra para junto. A cabeça (`.kn-goo-run`) segue o relógio sozinha.
  const target = (a: Animation) => (a.effect as KeyframeEffect | null)?.target;
  const name = (a: Animation) => (a as CSSAnimation).animationName ?? "";
  const side = (a: Animation) => {
    const t = target(a) as HTMLElement;
    if (t.matches(".kn-goo-clock")) return t.dataset.side ?? "?";
    return /^kn-goo-(in|out)-(start|end)$/.exec(name(a))?.[2] ?? null;
  };
  const mine = () => document.getAnimations().filter((a) => {
    const t = target(a);
    return t instanceof Element && bar.contains(t) && (t.matches(".kn-goo-clock") || name(a).startsWith("kn-goo") || a.id.startsWith("kn-goo"));
  });
  const deadline = performance.now() + 2000;
  let list = mine();
  while (list.filter(side).length < 2) {
    if (performance.now() > deadline) throw new Error(`as gotas não começaram: ${list.map(name)}`);
    await new Promise((r) => requestAnimationFrame(r));
    list = mine();
  }
  for (const a of list) a.pause();
  (window as unknown as { __goo: Animation[] }).__goo = list;
  return list.map((a) => ({ name: name(a) || "relógio", side: side(a), ms: Number(a.effect!.getComputedTiming().duration) }));
}, section);

/** Põe as animações paradas na fração `f`. */
const seek = (p: Page, f: number) => p.evaluate(async (frac) => {
  for (const a of (window as unknown as { __goo: Animation[] }).__goo) {
    const ms = Number(a.effect!.getComputedTiming().duration);
    // Um pouco antes do fim, para a animação não acabar (e o `animationend` não andar a fase). Com "reduzir
    // movimento", o base.css corta as animações para 0,01 ms: o "um pouco" é proporcional.
    a.currentTime = Math.min(frac * ms, ms * 0.999);
  }
  // Dois quadros: o caminho da gota é reescrito num rAF a partir do relógio (T18948).
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}, f);

/** O retângulo da gota de cada lado (a soma das partes `.kn-goo-path` desenhadas, ou a `.kn-goo-drop`), na barra. */
const dropBoxes = (p: Page) => p.evaluate(() => {
  const bar = document.querySelector(".kn-hub-top")!.getBoundingClientRect();
  const box = (s: string) => {
    const parts = Array.from(document.querySelectorAll(`.kn-goo-path[data-side="${s}"]`))
      .map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
    if (parts.length === 0) {
      const drop = document.querySelector(`.kn-goo-drop[data-side="${s}"]`);
      if (drop) parts.push(drop.getBoundingClientRect());
    }
    if (parts.length === 0) return null;
    const x = Math.min(...parts.map((r) => r.left)), y = Math.min(...parts.map((r) => r.top));
    const w = Math.max(...parts.map((r) => r.right)) - x, h = Math.max(...parts.map((r) => r.bottom)) - y;
    return { x: x - bar.x, y: y - bar.y, w, h };
  };
  return { start: box("start"), end: box("end") };
});

/** Solta as animações e a reserva de 900 ms. */
const release = (p: Page) => p.evaluate(() => {
  const w = window as unknown as { __gooTimeout?: typeof setTimeout; __goo: Animation[]; setTimeout: typeof setTimeout };
  if (w.__gooTimeout) w.setTimeout = w.__gooTimeout;
  for (const a of w.__goo) a.play();
});

/** O retângulo dos botões de um lado, na barra. */
const slotBox = (p: Page, side: "start" | "end") => p.evaluate((s) => {
  const bar = document.querySelector(".kn-hub-top")!.getBoundingClientRect();
  const kids = Array.from(document.querySelector(`.kn-hub-${s}`)!.children).map((c) => c.getBoundingClientRect());
  const l = Math.min(...kids.map((r) => r.left)), t = Math.min(...kids.map((r) => r.top));
  const r = Math.max(...kids.map((k) => k.right)), b = Math.max(...kids.map((k) => k.bottom));
  return { x: l - bar.x, y: t - bar.y, w: r - l, h: b - t };
}, side);

/**
 * O `settle` e mais a entrada da janela: o `window-in` do Hub (480 ms de escala e o fade) ainda corre quando ele volta,
 * e um print no meio dela pega a pílula um pouco menor e mais clara, num ponto diferente a cada rodada (T19175: a
 * borda clara dava 55 numa e 37 noutra). Espera todas as animações finitas acabarem.
 */
const ready = async (p: Page) => {
  await settle(p);
  await p.evaluate(() => Promise.all(document.getAnimations()
    .filter((a) => Number.isFinite(Number(a.effect?.getComputedTiming().endTime)))
    .map((a) => a.finished)));
};

/** Os pixels de tela por px CSS da página (a escala dos prints). */
const dpr = async (p: Page) => (await p.evaluate(() => devicePixelRatio)) || 1;

const near = (a: Box, b: Box, tol = 1.5) =>
  Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol && Math.abs(a.w - b.w) <= tol && Math.abs(a.h - b.h) <= tol;

/** O print da barra (com 8 px abaixo, para a sombra); com `file`, também salvo. */
const shot = async (p: Page, file?: string) => {
  const bar = await p.locator(".kn-hub-top").boundingBox();
  assert.ok(bar, "a barra do Hub não está na tela");
  return p.screenshot({ path: file, clip: { x: 0, y: bar.y, width: p.viewportSize()!.width, height: bar.height + 8 } });
};

/** O mesmo recorte, só com a camada da gota: tudo o mais escondido, e a gota preta (com a borda e a sombra) no branco. */
const maskShot = async (p: Page) => {
  await p.evaluate(() => {
    const st = document.createElement("style");
    st.id = "kn-goo-mask";
    // Só o que está fora da camada some: dentro dela, o que a gota esconde (o relógio, uma parte fora de uso) fica escondido.
    st.textContent = `body *:not(.kn-goo):not(.kn-goo *) { visibility: hidden !important; }
      .kn-goo { visibility: visible !important; }
      .kn-goo { filter: brightness(0) !important; }
      html, body { background: #fff !important; }`;
    document.head.append(st);
  });
  try {
    return await shot(p);
  } finally {
    await p.evaluate(() => document.getElementById("kn-goo-mask")?.remove());
  }
};

/** Onde olhar, no recorte (px CSS): as faixas dos dois lados da pílula e os botões, que não são rastro. */
const geometry = (p: Page) => p.evaluate(() => {
  const bar = document.querySelector(".kn-hub-top")!.getBoundingClientRect();
  const rel = (r: DOMRect) => ({ x: r.x, y: r.y - bar.y, w: r.width, h: r.height });
  const tabs = rel(document.querySelector(".kn-tabs")!.getBoundingClientRect());
  const buttons = Array.from(document.querySelectorAll(".kn-hub-slot > *")).map((c) => rel(c.getBoundingClientRect()));
  return { tabs, buttons, width: innerWidth };
});
type Geometry = Awaited<ReturnType<typeof geometry>>;

/**
 * O laboratório: numa página em branco (sem a CSP do app), lê os prints num canvas e devolve, por lado, a altura da gota
 * em cada coluna (a partir da pílula), os pixels de rastro e o recorte do lado para a tira.
 */
async function analyze(lab: Page, scale: number, geo: Geometry, rest: Buffer, cur: Buffer, mask: Buffer | null, content: Box[] = []) {
  return lab.evaluate(async ({ scale, geo, rest, cur, mask, diff, content }) => {
    const load = async (b64: string) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(img, 0, 0);
      return { w: img.width, h: img.height, d: g.getImageData(0, 0, img.width, img.height).data, c };
    };
    const R = await load(rest);
    const C = await load(cur);
    const M = mask ? await load(mask) : null;
    const W = C.w, H = C.h;
    const lum = (d: Uint8ClampedArray, i: number) => d[i]! * 0.3 + d[i + 1]! * 0.59 + d[i + 2]! * 0.11;
    const px = (v: number) => Math.round(v * scale);
    const left = px(geo.tabs.x), right = Math.min(W, px(geo.tabs.x + geo.tabs.w));

    // A forma: pixels da camada com mais da metade de tinta.
    const profile = (x0: number, x1: number) => {
      const cols: number[] = [];
      for (let x = x0; x < x1; x++) {
        let n = 0;
        if (M) for (let y = 0; y < H; y++) if (lum(M.d, (y * W + x) * 4) < 128) n++;
        cols.push(n);
      }
      return cols;
    };
    // A borda da própria pílula (a base da gota) passa 1 px do `.kn-tabs`: as faixas começam 2 px depois dela.
    const edge = px(2);
    const start = profile(0, Math.max(0, left - edge)).reverse();
    const end = profile(Math.min(W, right + edge), W);

    // O rastro: a faixa difere da barra parada fora da gota (com 3 px de folga) e dos botões (com 12 px, a sombra).
    const covered = new Uint8Array(W * H);
    if (M) {
      const r = px(3);
      const ink = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) ink[i] = lum(M.d, i * 4) < 250 ? 1 : 0;
      const tmp = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let on = 0;
        for (let k = Math.max(0, x - r); k <= Math.min(W - 1, x + r) && !on; k++) on = ink[y * W + k]!;
        tmp[y * W + x] = on;
      }
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let on = 0;
        for (let k = Math.max(0, y - r); k <= Math.min(H - 1, y + r) && !on; k++) on = tmp[k * W + x]!;
        covered[y * W + x] = on;
      }
    }
    const pad = 12;
    const inButton = (x: number, y: number) => geo.buttons.some((b) =>
      x >= px(b.x - pad) && x < px(b.x + b.w + pad) && y >= px(b.y - pad) && y < px(b.y + b.h + pad));
    let count = 0;
    const at: number[][] = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (x >= left - edge && x < right + edge) continue;
      const i = y * W + x;
      if (covered[i] || inButton(x, y)) continue;
      const o = i * 4;
      const d = Math.max(Math.abs(C.d[o]! - R.d[o]!), Math.abs(C.d[o + 1]! - R.d[o + 1]!), Math.abs(C.d[o + 2]! - R.d[o + 2]!));
      if (d > diff) {
        count++;
        if (at.length < 5) at.push([Math.round(x / scale), Math.round(y / scale)]);
      }
    }

    // A tira: cada lado, com 60 px da pílula.
    const crop = (x0: number, x1: number) => {
      const c = document.createElement("canvas");
      c.width = x1 - x0;
      c.height = H;
      c.getContext("2d")!.drawImage(C.c, x0, 0, x1 - x0, H, 0, 0, x1 - x0, H);
      return c.toDataURL("image/png").split(",")[1]!;
    };
    // A borda (T18950, #18974, #19034): a mesma medida na gota, na pílula e nos botões. Linha a linha no meio da forma,
    // o maior contraste contra o fundo numa janela de 2 px para cada lado da beira de fora, menos o contraste do recheio
    // (5 px para dentro): o quanto a borda se destaca do fundo além do próprio recheio. Sem borda dá ~0, mesmo no OLED
    // Black, onde o `--float` já difere do `#000`. Fica a mediana das linhas.
    const median = (v: number[]) => (v.length ? v.sort((a, b) => a - b)[Math.floor(v.length / 2)]! : null);
    const band = px(2);
    const L = (img: typeof C, x: number, y: number) => lum(img.d, (y * W + Math.max(0, Math.min(W - 1, x))) * 4);
    const contrast = (img: typeof C, bg: (x: number, y: number) => number, x0: number, y: number, inward: number) => {
      let best = 0;
      for (let x = Math.max(0, x0 - band); x <= Math.min(W - 1, x0 + band); x++) best = Math.max(best, Math.abs(L(img, x, y) - bg(x, y)));
      const xf = x0 + inward * px(5);
      return best - Math.abs(L(img, xf, y) - bg(xf, y));
    };
    /** A borda da esquerda de uma caixa (px CSS na barra) em `img`, contra o fundo 6 px fora dela. */
    const boxRing = (img: typeof C, b: { x: number; y: number; w: number; h: number }) => {
      const x0 = px(b.x), y0 = px(b.y), y1 = px(b.y + b.h);
      const rows: number[] = [];
      for (let y = y0 + Math.floor((y1 - y0) / 4); y < y1 - Math.floor((y1 - y0) / 4); y++) {
        if (y < 0 || y >= H) continue;
        const bg = L(img, x0 - px(6), y);
        rows.push(contrast(img, () => bg, x0, y, 1));
      }
      return median(rows);
    };
    const ring = (side: "start" | "end") => {
      if (!M) return null;
      const outer: [number, number][] = [];
      for (let y = 0; y < H; y++) {
        let x0 = -1;
        if (side === "end") { for (let x = W - 1; x >= right + edge; x--) if (lum(M.d, (y * W + x) * 4) < 128) { x0 = x; break; } }
        else for (let x = 0; x < left - edge; x++) if (lum(M.d, (y * W + x) * 4) < 128) { x0 = x; break; }
        // Debaixo de um botão a beira não aparece (ele cobre a gota): a linha não conta.
        const under = geo.buttons.some((b) => x0 >= px(b.x - 2) && x0 < px(b.x + b.w + 2) && y >= px(b.y - 2) && y < px(b.y + b.h + 2));
        if (x0 >= 0 && !under) outer.push([y, x0]);
      }
      if (outer.length < px(6)) return null;
      const mid = outer.slice(Math.floor(outer.length / 4), Math.ceil(outer.length * 3 / 4));
      return median(mid.map(([y, x0]) => contrast(C, (x, yy) => L(R, x, yy), x0, y, side === "end" ? -1 : 1)));
    };
    const buttonRings = geo.buttons.map((b) => boxRing(C, b)).filter((v): v is number => v !== null);
    // O conteúdo dos botões: pixels bem diferentes da barra parada, dentro das caixas (6 px para dentro, sem a borda).
    let ink = 0;
    for (const b of content) {
      for (let y = px(b.y + 6); y < px(b.y + b.h - 6); y++) for (let x = px(b.x + 6); x < px(b.x + b.w - 6); x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const d = Math.abs(lum(C.d, (y * W + x) * 4) - lum(R.d, (y * W + x) * 4));
        if (d > 40) ink += d;
      }
    }
    return {
      start, end, trail: { count, at }, ring: { start: ring("start"), end: ring("end"), pill: boxRing(R, geo.tabs), buttons: median(buttonRings) }, ink,
      crops: { start: crop(0, Math.min(W, left + px(60))), end: crop(Math.max(0, right - px(60)), W) },
    };
  }, {
    scale, geo, diff: TRAIL_DIFF, content,
    rest: rest.toString("base64"), cur: cur.toString("base64"), mask: mask ? mask.toString("base64") : null,
  });
}

/** Uma ida ou uma volta, quadro a quadro; `rest` é o print da barra parada em Ajustes, na mesma escala. */
async function frames(p: Page, lab: Page, rest: Buffer, dir: string, section: string, kind: "in" | "out") {
  for (const sub of ["lado-inicio", "lado-fim", "mascara"]) mkdirSync(join(dir, sub), { recursive: true });
  const scale = await dpr(p);
  // Na volta, o conteúdo dos botões antes do clique, para ver se eles somem de cara.
  const before = kind === "out" ? await geometry(p) : null;
  const shownInk = before ? (await analyze(lab, scale, before, rest, await shot(p), null, before.buttons)).ink : 0;
  const anims = await clickAndPause(p, section);
  const drops = anims.filter((a) => a.side);
  assert.deepEqual(drops.map((a) => a.side).sort(), ["end", "start"], JSON.stringify(anims));
  for (const a of drops) assert.ok(a.ms > 0 && a.ms <= GOO_PLAN_MAX_MS, `${a.name} (${a.side}) tem ${a.ms} ms, fora de 0–${GOO_PLAN_MAX_MS}`);
  const want = kind === "in" ? "entering" : "leaving";
  const ph = await phases(p);
  assert.equal(ph.start, want, JSON.stringify(ph));
  assert.equal(ph.end, want, JSON.stringify(ph));
  const list: Frame[] = [];
  const problems: string[] = [];
  const trail: string[] = [];
  const inks: { t: number; ink: number }[] = [];
  for (const [i, f] of FRAMES.entries()) {
    const label = `${String(i).padStart(2, "0")}-${String(Math.round(f * 100)).padStart(3, "0")}`;
    await seek(p, f);
    const c = await crisp(p);
    problems.push(...c.problems.map((m) => `${Math.round(f * 100)}%: ${m}`));
    const cur = await shot(p, join(dir, `${label}.png`));
    const mask = await maskShot(p);
    writeFileSync(join(dir, "mascara", `${label}.png`), mask);
    const a = await analyze(lab, scale, await geometry(p), rest, cur, mask, before?.buttons);
    if (before) inks.push({ t: f, ink: a.ink });
    writeFileSync(join(dir, "lado-inicio", `${label}.png`), Buffer.from(a.crops.start, "base64"));
    writeFileSync(join(dir, "lado-fim", `${label}.png`), Buffer.from(a.crops.end, "base64"));
    if (a.trail.count > 0) trail.push(`${Math.round(f * 100)}%: ${a.trail.count} px fora da gota, em ${JSON.stringify(a.trail.at)}`);
    const boxes = await dropBoxes(p);
    list.push({ t: f, ...boxes, shape: { start: dropShape(a.start), end: dropShape(a.end) }, cols: { start: a.start, end: a.end }, trail: a.trail, ring: a.ring });
  }
  // A soltura da mola é curta (o pescoço dura poucos quadros, spec #32446) e os 12 quadros podem pular por cima dela:
  // na ida, entre o último quadro presa e o 1º solta de cada lado, a forma também se lê a cada quadro de 60 Hz. Só para
  // a forma (o `dripProblem`); a tira continua com os 12.
  const extra: { t: number; shape: Record<Side, DropShape> }[] = [];
  if (kind === "in") {
    const ms = Math.max(...drops.map((a) => a.ms));
    const between = new Set<number>();
    for (const side of SIDES) {
      const i = list.findIndex((f, k) => f.shape[side].kind === "attached" && list[k + 1]?.shape[side].kind === "detached");
      if (i < 0) continue;
      for (let t = list[i]!.t * ms + FRAME_MS; t < list[i + 1]!.t * ms; t += FRAME_MS) between.add(t / ms);
    }
    for (const f of [...between].sort((a, b) => a - b)) {
      await seek(p, f);
      const a = await analyze(lab, scale, await geometry(p), rest, await shot(p), await maskShot(p), before?.buttons);
      extra.push({ t: f, shape: { start: dropShape(a.start), end: dropShape(a.end) } });
    }
  }
  assert.deepEqual(problems, [], `texto ou ícone fora do lugar durante a ${kind === "in" ? "ida" : "volta"}`);
  if (before) {
    const early = inks.find((i) => i.t > 0 && i.t < 0.25)!;
    assert.ok(early.ink >= BUTTONS_EARLY * shownInk,
      `os botões somem de cara na volta: em ${Math.round(early.t * 100)}% sobra ${(early.ink / Math.max(1, shownInk) * 100).toFixed(0)}% do conteúdo (mínimo ${BUTTONS_EARLY * 100}%): ${JSON.stringify({ shownInk, inks })}`);
  }
  assert.deepEqual(trail, [], `rastro durante a ${kind === "in" ? "ida" : "volta"} (a faixa diferente da barra parada, fora da gota)`);
  await release(p);
  await waitPhase(p, kind === "in" ? "shown" : "hidden");
  return { anims, frames: list, extra, shownInk, inks };
}

/** O maior intervalo entre quadros do clique até WATCH_MS depois, com o clique de verdade do Playwright. */
async function realtime(p: Page, section: string) {
  await p.evaluate(() => {
    const w = window as unknown as { __gaps: number[]; __gapStop: boolean };
    w.__gaps = [];
    w.__gapStop = false;
    let last = performance.now();
    const tick = (t: number) => {
      w.__gaps.push(t - last);
      last = t;
      if (!w.__gapStop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await p.locator(`.kn-tab[data-section="${section}"]`).click();
  await p.waitForTimeout(WATCH_MS);
  return p.evaluate(() => {
    const w = window as unknown as { __gaps: number[]; __gapStop: boolean };
    w.__gapStop = true;
    return Math.max(...w.__gaps);
  });
}

/** Folga do passo do relógio contra o tempo real entre dois desenhos: o arredondamento entre o relógio e o tick. */
const STEP_SLACK_MS = 8;
/** Um quadro normal, a 60 Hz (o rAF do WKWebView, #23816). */
const FRAME_MS = 1000 / 60;
/** O quadro preso de propósito no meio do caminho. */
const SLOW_BLOCK_MS = 80;
/** O trabalho preso de propósito no clique, como a seção nova montando (22 a 88 ms, #23816). */
const CLICK_BLOCK_MS = 50;
/** O desenho em que o quadro preso cai: o 3º com o relógio andando, já na barriga. */
const SLOW_AT_DRAW = 3;

type Draw = { at: number; t: number; ms: number; phase: string; waiting: boolean };

/**
 * A troca com `CLICK_BLOCK_MS` presos no clique e um quadro de `SLOW_BLOCK_MS` no `SLOW_AT_DRAW`º desenho. Devolve, a
 * cada desenho da cabeça do lado end (um MutationObserver no `d` dela, que roda logo depois do quadro da gota), o tempo
 * do quadro e o `currentTime` do relógio (−1 sem relógio), e se o lado esperava a seção no clique.
 */
async function slowSection(p: Page, section: string) {
  await p.evaluate(([block, clickBlock, at]) => {
    const w = window as unknown as { __slow: { draws: Draw[]; waitingAtClick: boolean | null }; __slowStop: () => void };
    const goo = document.querySelector<HTMLElement>(".kn-goo")!;
    const head = document.querySelector('.kn-goo-path[data-side="end"][data-part="head"]')!;
    const drop = document.querySelector<HTMLElement>('.kn-goo-clock[data-side="end"]')!;
    const clock = () => drop.getAnimations()[0];
    w.__slow = { draws: [], waitingAtClick: null };
    let moving = 0;
    const draws = new MutationObserver(() => {
      const c = clock();
      const timing = c?.effect?.getComputedTiming();
      w.__slow.draws.push({
        at: Number(document.timeline.currentTime ?? performance.now()),
        t: c ? Number(c.currentTime ?? 0) : -1, ms: Number(timing?.duration ?? 0),
        phase: goo.dataset.end ?? "", waiting: drop.dataset.waiting !== undefined,
      });
      if (c && ++moving === at) {
        const until = performance.now() + block;
        while (performance.now() < until);
      }
    });
    draws.observe(head, { attributes: true, attributeFilter: ["d"] });
    let armed = true;
    const start = new MutationObserver(() => {
      if (!armed || (goo.dataset.end !== "entering" && goo.dataset.end !== "leaving")) return;
      armed = false;
      // No clique: o lado já está na fase nova, esperando a seção pintar, sem relógio.
      w.__slow.waitingAtClick = drop.dataset.waiting !== undefined && drop.getAnimations().length === 0;
      const until = performance.now() + clickBlock;
      while (performance.now() < until);
    });
    start.observe(goo, { attributes: true, attributeFilter: ["data-end"] });
    w.__slowStop = () => (draws.disconnect(), start.disconnect());
  }, [SLOW_BLOCK_MS, CLICK_BLOCK_MS, SLOW_AT_DRAW] as const);
  await p.locator(`.kn-tab[data-section="${section}"]`).click();
  await waitPhase(p, section === "notes" ? "shown" : "hidden");
  return p.evaluate(() => {
    const w = window as unknown as { __slow: { draws: Draw[]; waitingAtClick: boolean | null }; __slowStop: () => void };
    w.__slowStop();
    return w.__slow;
  });
}

/**
 * O que a seção lenta mostrou: onde a gota largou (o relógio no 1º desenho), o maior intervalo entre dois desenhos e
 * o par em que o relógio mais se afastou do tempo real (à frente: pulou; atrás: congelou). O último par, no fim do
 * relógio, não conta como congelado: ali o relógio para no fim.
 */
function slowReport(draws: Draw[]) {
  const moving = draws.filter((d) => (d.phase === "entering" || d.phase === "leaving") && d.t >= 0);
  let gap = 0;
  let worst: { stepMs: number; gapMs: number; off: number } | null = null;
  for (let i = 1; i < moving.length; i++) {
    const a = moving[i - 1]!;
    const b = moving[i]!;
    if (b.ms !== a.ms || b.t < a.t) continue;
    const gapMs = b.at - a.at;
    gap = Math.max(gap, gapMs);
    const stepMs = b.t - a.t;
    const ended = b.t >= b.ms - 0.5;
    const off = ended ? Math.max(0, stepMs - gapMs) : Math.abs(stepMs - gapMs);
    if (!worst || off > worst.off) worst = { stepMs, gapMs, off };
  }
  return { first: moving[0]?.t ?? null, gap, worst, waited: draws.some((d) => d.waiting) };
}

type Head = { x: number; w: number } | null;
/** A cabeça de cada lado (`[data-part="head"]`), na barra: o lugar da gota, sem a barriga presa à pílula. */
const heads = (p: Page) => p.evaluate(() => {
  const bar = document.querySelector(".kn-hub-top")!.getBoundingClientRect();
  const box = (s: string) => {
    const r = document.querySelector(`.kn-goo-path[data-side="${s}"][data-part="head"]`)?.getBoundingClientRect();
    return r && r.width > 0 && r.height > 0 ? { x: r.left - bar.x, w: r.width } : null;
  };
  return { start: box("start"), end: box("end") };
});
/** O quanto a cabeça andou de um quadro a outro: a borda que mais andou. */
const moved = (a: Head, b: Head) => (a && b ? Math.max(Math.abs(a.x - b.x), Math.abs(a.x + a.w - b.x - b.w)) : Infinity);
/** A folga da troca no meio, em px: o arredondamento do lugar da cabeça. */
const SWITCH_SLACK_PX = 1.5;
/** Onde a troca no meio acontece, em fração do caminho. */
const SWITCH_AT = 0.4;

/**
 * A troca no meio: clica em `first`, para a gota em `SWITCH_AT` do caminho e clica em `second` com ela parada. Para o
 * relógio novo no 0 e compara a cabeça com a do quadro em que o velho parou; a régua é o passo normal da cabeça ali (do
 * quadro anterior até ele).
 */
async function midSwitch(p: Page, first: string, second: string) {
  const anims = await clickAndPause(p, first);
  const ms = Math.max(...anims.filter((a) => a.side).map((a) => a.ms));
  const at = SWITCH_AT * ms;
  await seek(p, (at - FRAME_MS) / ms);
  const prev = await heads(p);
  await seek(p, at / ms);
  const before = await heads(p);
  await p.evaluate(async (s) => {
    const w = window as unknown as { __goo: Animation[] };
    const old = new Set(w.__goo);
    const bar = document.querySelector(".kn-hub-top")!;
    const target = (a: Animation) => (a.effect as KeyframeEffect | null)?.target;
    const fresh = () => document.getAnimations().filter((a) => {
      const t = target(a);
      return !old.has(a) && t instanceof Element && bar.contains(t) && (t.matches(".kn-goo-clock") || a.id.startsWith("kn-goo") || ((a as CSSAnimation).animationName ?? "").startsWith("kn-goo"));
    });
    document.querySelector<HTMLElement>(`.kn-tab[data-section="${s}"]`)!.click();
    const deadline = performance.now() + 2000;
    let list = fresh();
    while (list.filter((a) => (target(a) as Element).matches(".kn-goo-clock")).length < 2) {
      if (performance.now() > deadline) throw new Error("a troca no meio não deu relógio novo");
      await new Promise((r) => requestAnimationFrame(r));
      list = fresh();
    }
    for (const a of list) {
      a.pause();
      a.currentTime = 0;
    }
    w.__goo = list;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, second);
  const after = await heads(p);
  await release(p);
  await waitPhase(p, second === "notes" ? "shown" : "hidden");
  const r = (n: number) => Math.round(n * 10) / 10;
  return Object.fromEntries(SIDES.map((side) => [side, { step: r(moved(prev[side], before[side])), jump: r(moved(before[side], after[side])), before: before[side], after: after[side] }]));
}

async function reduced(p: Page, dir: string) {
  mkdirSync(dir, { recursive: true });
  // As animações se leem no mesmo instante em que os botões entram (T25952): com "reduzir movimento", o base.css corta
  // o fade para 0,01 ms, e numa VM lenta ele já acabou (e saiu do `getAnimations()`) quando um `evaluate` seguinte
  // chega. O observador roda no microtask da inserção, antes de qualquer quadro; o `getAnimations()` cria as animações
  // do CSS, e elas param ali, no começo.
  type Seen = { goo: string; drops: string[]; buttons: string[]; fadeMs: number[] };
  await p.evaluate(() => {
    const w = window as unknown as { __goo: Animation[]; __reduced?: Seen };
    delete w.__reduced;
    const start = document.querySelector(".kn-hub-start")!;
    const obs = new MutationObserver(() => {
      if (w.__reduced || start.childElementCount === 0) return;
      const all = document.getAnimations();
      const buttons = all.filter((a) => {
        const t = (a.effect as KeyframeEffect | null)?.target;
        return t instanceof Element && !!t.parentElement?.classList.contains("kn-hub-slot");
      });
      for (const a of buttons) a.pause();
      w.__goo = buttons;
      w.__reduced = {
        goo: getComputedStyle(document.querySelector(".kn-goo")!).display,
        drops: all.map((a) => (a as CSSAnimation).animationName ?? "").filter((n) => n.startsWith("kn-goo")),
        buttons: buttons.map((a) => (a as CSSAnimation).animationName),
        fadeMs: buttons.map((a) => Number(a.effect!.getComputedTiming().duration)),
      };
      obs.disconnect();
    });
    obs.observe(start, { childList: true });
  });
  await p.locator('.kn-tab[data-section="notes"]').click();
  await p.waitForFunction(() => !!(window as unknown as { __reduced?: Seen }).__reduced, null, { timeout: 3000 });
  const seen = await p.evaluate(() => (window as unknown as { __reduced: Seen }).__reduced);
  assert.equal(seen.goo, "none", "a gota aparece com reduzir movimento");
  assert.deepEqual(seen.drops, [], `animação da gota com reduzir movimento: ${seen.drops}`);
  assert.ok(seen.buttons.length > 0 && seen.buttons.every((n) => n === "fade"), `os botões não fazem só o fade: ${seen.buttons}`);
  const fade: { t: number; opacity: string[] }[] = [];
  for (const [i, f] of [0, 0.5, 1].entries()) {
    await seek(p, f);
    fade.push({ t: f, opacity: await p.evaluate(() => Array.from(document.querySelectorAll(".kn-hub-slot > *")).map((k) => getComputedStyle(k).opacity)) });
    await shot(p, join(dir, `${i}-fade-${Math.round(f * 100)}.png`));
  }
  assert.ok(fade.at(-1)!.opacity.every((o) => Number(o) > 0.9), `no fim do fade os botões não aparecem: ${JSON.stringify(fade)}`);
  await release(p);
  await waitPhase(p, "shown");
  await shot(p, join(dir, "3-notas.png"));
  await p.locator('.kn-tab[data-section="settings"]').click();
  await waitPhase(p, "hidden");
  await shot(p, join(dir, "4-ajustes.png"));
  const ms = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--fast").trim());
  return { ...seen, fade, fast: ms };
}

const cli = resolve(import.meta.dir, "cli.ts");
let running = true;
const cleanup = () => {
  if (running) spawnSync(process.execPath, [cli, "stop", "--data", data], { encoding: "utf8", timeout: 15_000 });
  running = false;
  rmSync(data, { recursive: true, force: true });
};
for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]] as const) {
  process.on(signal, () => {
    cleanup();
    process.exit(code);
  });
}
// O agente falso (#32693, #32697): nenhum roteiro roda o Claude Code ou o agy deste Mac, nem para conferir a versão.
const up = spawnSync(process.execPath, [cli, "start", "--data", data, "--no-helper"], { encoding: "utf8", env: { ...process.env, KIWI_FAKE_AGENT: "1" } });
if (up.status !== 0) {
  cleanup();
  throw new Error(`o headless não subiu em ${data}:\n${up.stdout}${up.stderr}`);
}
const browser: Browser = await webkit.launch();
const lab = await browser.newPage();
const metrics: Record<string, unknown> = {};
try {
  const base = { window: "hub" as const, width: 1000, height: 640, browser: "webkit" as const, query: { section: "settings" } };
  for (const theme of ["light", "dark"] as const) {
    // 1. Quadro a quadro.
    const w = await openWindow(browser, ctx, { ...base, scale: 2, theme, motion: true });
    try {
      await ready(w.page);
      const first = await phases(w.page);
      assert.deepEqual([first.start, first.end], ["hidden", "hidden"], `Ajustes abriu com botões na barra: ${JSON.stringify(first)}`);
      const rest = await shot(w.page, join(out, theme, "parada.png"));
      const ida = await frames(w.page, lab, rest, join(out, theme, "ida"), "notes", "in");
      for (const side of SIDES) {
        const shapes = [...ida.frames, ...ida.extra].sort((a, b) => a.t - b.t).map((f) => f.shape[side]);
        const why = dripProblem(shapes);
        assert.equal(why, null, `a ida do lado ${side} não pinga como gota: ${why} (${JSON.stringify(shapes)})`);
      }
      const shown = await phases(w.page);
      assert.deepEqual([shown.slotStart, shown.slotEnd], ["shown", "shown"], JSON.stringify(shown));
      assert.ok(shown.buttons.start > 0 && shown.buttons.end > 0, `as Notas não puseram botões dos dois lados: ${JSON.stringify(shown)}`);
      const shownGeo = await geometry(w.page);
      const buttonsRing = (await analyze(lab, await dpr(w.page), shownGeo, rest, await shot(w.page, join(out, theme, "notas.png")), null)).ring.buttons;
      const last = ida.frames.at(-1)!;
      for (const side of SIDES) {
        const b = await slotBox(w.page, side);
        const d = last[side];
        assert.ok(d && near(d, b, 2), `a gota da ${side} não assenta nos botões: gota ${JSON.stringify(d)}, botões ${JSON.stringify(b)}`);
      }
      const volta = await frames(w.page, lab, rest, join(out, theme, "volta"), "settings", "out");
      const back = volta.frames.at(-1)!;
      const pillRing = ida.frames[0]!.ring.pill;
      const weak = [...ida.frames.map((f) => ["ida", f] as const), ...volta.frames.map((f) => ["volta", f] as const)].flatMap(([dir, f]) =>
        SIDES.flatMap((side) => {
          const r = f.ring[side];
          return r !== null && r < DROP_RING[theme] ? [`${dir} ${Math.round(f.t * 100)}% ${side}: ${r.toFixed(0)}`] : [];
        }));
      metrics[`${theme}.borda`] = { buttons: buttonsRing, pill: pillRing, drop: weak };
      console.log(`borda ${theme}: botões ${buttonsRing}, pílula ${pillRing}, gota ${JSON.stringify(ida.frames.concat(volta.frames).map((f) => [f.ring.start, f.ring.end]))}`);
      assert.ok(pillRing !== null && pillRing >= PILL_MIN * PILL_RING[theme],
        `a borda da pílula parada (${theme}) ficou em ${pillRing?.toFixed(0)}, abaixo da main (${PILL_RING[theme]}, mínimo ${PILL_MIN * 100}%)`);
      assert.deepEqual(weak, [], `a borda da gota some no fundo (${theme}: mínimo ${DROP_RING[theme]})`);
      for (const side of SIDES) {
        assert.equal(back.shape[side].kind, "none", `no fim da volta sobra gota fora da pílula do lado ${side}: ${JSON.stringify(back.shape[side])}, colunas ${back.cols[side].slice(0, 40)}`);
      }
      assert.deepEqual(w.report.problems, [], "erros na página");
      metrics[`${theme}.quadros`] = { ida, volta };
    } finally {
      await w.close();
    }

    // 2. Tempo real, com vídeo.
    const v = await openWindow(browser, ctx, { ...base, scale: 1, theme, motion: true, video: join(out, theme, "video") });
    try {
      await ready(v.page);
      const restV = await shot(v.page);
      const trails: string[] = [];
      let rounds = 0;
      // A máquina é dividida: com outro agente rodando, um quadro passou de 100 ms uma vez em três rodadas (load 24).
      // Uma rodada lenta é repetida uma vez; a gota só reprova se a repetição também for lenta.
      const reports = () => v.report.invokes["diagnostics.slowFrame"] ?? 0;
      const round = async () => {
        const before = reports();
        const ida = await realtime(v.page, "notes");
        await waitPhase(v.page, "shown");
        const volta = await realtime(v.page, "settings");
        await waitPhase(v.page, "hidden");
        // Depois da volta em tempo real, a barra é a de antes: nenhum resto de pintura do caminho da gota.
        const after = await shot(v.page, join(out, theme, `depois-da-volta-${++rounds}.png`));
        const a = await analyze(lab, await dpr(v.page), await geometry(v.page), restV, after, null);
        if (a.trail.count > 0) trails.push(`${a.trail.count} px em ${JSON.stringify(a.trail.at)}`);
        return { ida, volta, slowFrameReports: reports() - before };
      };
      const slow = (r: Awaited<ReturnType<typeof round>>) => r.ida >= SLOW_FRAME_MS || r.volta >= SLOW_FRAME_MS || r.slowFrameReports > 0;
      const gaps: Awaited<ReturnType<typeof round>>[] = [];
      const retried: Awaited<ReturnType<typeof round>>[] = [];
      for (let i = 0; i < ROUNDS; i++) {
        let r = await round();
        if (slow(r)) {
          retried.push(r);
          r = await round();
        }
        gaps.push(r);
      }
      // A troca no meio em tempo real, para o vídeo: a ida trocada pela volta e a volta pela ida, depois a barra
      // parada sem rastro.
      const tab = (s: string) => v.page.locator(`.kn-tab[data-section="${s}"]`).click();
      await tab("notes");
      await v.page.waitForTimeout(SWITCH_REAL_MS);
      await tab("settings");
      await waitPhase(v.page, "hidden");
      await tab("notes");
      await waitPhase(v.page, "shown");
      await v.page.waitForTimeout(300);
      await tab("settings");
      await v.page.waitForTimeout(SWITCH_REAL_MS);
      await tab("notes");
      await waitPhase(v.page, "shown");
      await tab("settings");
      await waitPhase(v.page, "hidden");
      const afterSwitch = await analyze(lab, await dpr(v.page), await geometry(v.page), restV, await shot(v.page, join(out, theme, "depois-da-troca.png")), null);
      if (afterSwitch.trail.count > 0) trails.push(`troca no meio: ${afterSwitch.trail.count} px em ${JSON.stringify(afterSwitch.trail.at)}`);
      const worst = Math.max(...gaps.flatMap((g) => [g.ida, g.volta]));
      metrics[`${theme}.tempoReal`] = { gaps, worst, retried };
      const why = worst >= SLOW_FRAME_MS
        ? `um quadro de ${worst.toFixed(1)} ms durante a gota (meta ${SLOW_FRAME_MS} ms): ${JSON.stringify({ gaps, retried })}`
        : gaps.some((g) => g.slowFrameReports > 0) ? `o slowFrames do app acusou um quadro travado: ${JSON.stringify(gaps)}` : null;
      // No CI, a VM do GitHub não dá um relógio de quadros confiável: o tempo sai no log, e quem barra é a máquina local.
      if (why && process.env.CI) console.log(`aviso (CI, não barra): ${why}`);
      else assert.equal(why, null, why ?? "");
      assert.deepEqual(trails, [], "rastro na barra depois da volta em tempo real");
      assert.deepEqual(v.report.problems, [], "erros na página");
    } finally {
      await v.close();
    }
  }

  // 3. A seção lenta: a gota espera a seção pintar e larga do começo; depois, anda com o tempo real.
  // 4. A troca no meio: sem teleporte.
  const sl = await openWindow(browser, ctx, { ...base, scale: 1, theme: "light", motion: true });
  try {
    await ready(sl.page);
    const res: Record<string, ReturnType<typeof slowReport> & { waitingAtClick: boolean | null }> = {};
    for (const [dir, section] of [["ida", "notes"], ["volta", "settings"]] as const) {
      const got = await slowSection(sl.page, section);
      res[dir] = { ...slowReport(got.draws), waitingAtClick: got.waitingAtClick };
      await sl.page.waitForTimeout(200);
    }
    metrics["secao-lenta"] = res;
    console.log(`seção lenta: ${JSON.stringify(res)}`);
    for (const [dir, r] of Object.entries(res)) {
      assert.equal(r.waitingAtClick, true, `na ${dir}, o lado não esperava a seção no clique (data-waiting, sem relógio)`);
      assert.ok(r.first !== null && r.first <= FRAME_MS + STEP_SLACK_MS,
        `a ${dir} não largou do começo: o 1º desenho já estava em ${r.first?.toFixed(1)} ms do relógio (máximo ${(FRAME_MS + STEP_SLACK_MS).toFixed(0)}), a barriga perdeu quadros`);
      assert.ok(r.gap >= SLOW_BLOCK_MS * 0.9, `a ${dir} não pegou o quadro preso de ${SLOW_BLOCK_MS} ms (maior intervalo ${r.gap.toFixed(0)} ms)`);
      assert.ok(r.worst, `a ${dir} não teve dois desenhos com o relógio para medir`);
      assert.ok(r.worst.off <= STEP_SLACK_MS,
        `o relógio da ${dir} se afastou do tempo real: andou ${r.worst.stepMs.toFixed(1)} ms num desenho de ${r.worst.gapMs.toFixed(1)} ms (folga ${STEP_SLACK_MS})`);
    }

    const sw: Record<string, Awaited<ReturnType<typeof midSwitch>>> = {};
    sw["ida→volta"] = await midSwitch(sl.page, "notes", "settings");
    await ready(sl.page);
    await sl.page.locator('.kn-tab[data-section="notes"]').click();
    await waitPhase(sl.page, "shown");
    await ready(sl.page);
    sw["volta→ida"] = await midSwitch(sl.page, "settings", "notes");
    metrics["troca-no-meio"] = sw;
    console.log(`troca no meio: ${JSON.stringify(Object.fromEntries(Object.entries(sw).map(([k, v]) => [k, Object.fromEntries(SIDES.map((s) => [s, { step: v[s]!.step, jump: v[s]!.jump }]))])))}`);
    for (const [dir, r] of Object.entries(sw)) {
      for (const side of SIDES) {
        const { step, jump } = r[side]!;
        assert.ok(Number.isFinite(jump) && jump <= step + SWITCH_SLACK_PX,
          `a troca no meio (${dir}, lado ${side}) teleportou: a cabeça andou ${jump} px entre o último quadro do caminho velho e o 0 do novo (um quadro normal ali: ${step} px, folga ${SWITCH_SLACK_PX})`);
      }
    }
    assert.deepEqual(sl.report.problems, [], "erros na página");
  } finally {
    await sl.close();
  }

  // 4. Reduzir movimento: o do Mac e o do Kiwi.
  const mac = await openWindow(browser, ctx, { ...base, scale: 2, theme: "light", motion: false });
  try {
    await ready(mac.page);
    metrics["reduzir-mac"] = await reduced(mac.page, join(out, "reduzir-mac"));
  } finally {
    await mac.close();
  }
  const kiwi = await openWindow(browser, ctx, { ...base, scale: 2, theme: "light", motion: true });
  try {
    await ready(kiwi.page);
    await kiwi.page.evaluate(() => {
      document.documentElement.dataset.motion = "reduced";
    });
    metrics["reduzir-kiwi"] = await reduced(kiwi.page, join(out, "reduzir-kiwi"));
  } finally {
    await kiwi.close();
  }
  writeFileSync(join(out, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
  for (const theme of ["light", "dark"]) {
    const t = metrics[`${theme}.tempoReal`] as { worst: number };
    console.log(`ok ${theme}: ida e volta quadro a quadro, com pescoço, gota solta e sem rastro; pior quadro em tempo real ${t.worst.toFixed(1)} ms (meta ${SLOW_FRAME_MS})`);
  }
  console.log(`ok seção lenta: a gota espera a seção pintar, larga do começo e anda com o tempo real no quadro preso de ${SLOW_BLOCK_MS} ms`);
  console.log("ok troca no meio: na ida e na volta, a cabeça não anda mais que um quadro normal");
  console.log("ok reduzir movimento (Mac e Kiwi): sem gota; os botões entram com o fade, que o base.css corta para 0,01 ms");
  console.log(`quadros, vídeos e metrics.json em ${out}`);
} finally {
  await browser.close();
  cleanup();
}
