// T32466 / spec #32446: a velocidade da gota da barra, quadro a quadro, no build real com o engine headless isolado.
// Nenhum app abre na tela. Pegue kiwi lock bench. Uso: bun scripts/goo-speed-check.ts [--json OUT.json]
//
// Para cada janela (1000 e 1600 px) e cada sentido (a ida, Ajustes → Notas, e a volta, Notas → Ajustes): para as
// animações da gota no clique e anda o relógio de 1/60 s em 1/60 s. Em cada quadro, mede a frente de cada lado (a
// borda da gota no sentido em que ela anda). Daí saem:
// - a menor velocidade entre a largada e a chegada (px por quadro): a gota não para no meio;
// - o maior salto de velocidade entre dois quadros seguidos (px por quadro, por quadro): sem tranco;
// - o pico de velocidade (px por quadro): o tempo acompanha a distância.
// Sem regra ainda: hoje imprime os números, a régua da caixa 2 do spec, medida na main.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Browser, type Page } from "playwright-core";

import { request } from "./cli.ts";
import { openWindow, settle, type UiContext } from "./ui-page.ts";

const jsonAt = process.argv.indexOf("--json");
const jsonOut = jsonAt > 0 ? resolve(process.argv[jsonAt + 1]!) : null;
const data = mkdtempSync(join(tmpdir(), "kn-goo-speed-"));
const FRAME_MS = 1000 / 60;
const WIDTHS = [1000, 1600] as const;
/**
 * A régua da main antes da mola (e613641a, medida por este roteiro no T32466): o maior salto de velocidade entre dois
 * quadros, o pior dos dois lados, em px por quadro. A caixa 2 do spec #32446 pede ficar abaixo disto.
 */
export const MAIN_MAX_JUMP = { 1000: { ida: 6.65, volta: 21.75 }, 1600: { ida: 19.03, volta: 28.32 } } as const;
/** A frente andou: mais que isto da largada, ou ainda falta mais que isto para a chegada. */
const MOVED_PX = 0.5;

const ctx: UiContext = {
  data,
  send: async (msg) => {
    const r = await request(data, msg);
    if (!r) throw new Error(`o headless em ${data} parou no meio do roteiro`);
    return r;
  },
  subscribe: async () => () => {},
};

type Side = "start" | "end";
const SIDES: Side[] = ["start", "end"];
type Box = { x: number; w: number };

/** Clica na aba e para tudo o que é da gota na barra (o relógio de cada lado e os botões); devolve a duração. */
const clickAndPause = (p: Page, section: string) => p.evaluate(async (s) => {
  // A reserva de 900 ms (GOO_FALLBACK_MS) andaria a fase com a animação parada; segura só ela enquanto se mede.
  const w = window as unknown as { __gooTimeout?: typeof setTimeout; setTimeout: typeof setTimeout };
  w.__gooTimeout ??= window.setTimeout;
  const orig = w.__gooTimeout;
  w.setTimeout = ((fn: () => void, ms?: number, ...a: unknown[]) =>
    (ms ?? 0) >= 900 ? orig(() => {}, 0) : orig(fn, ms, ...a)) as typeof setTimeout;
  document.querySelector<HTMLElement>(`.kn-tab[data-section="${s}"]`)!.click();
  const bar = document.querySelector(".kn-hub-top")!;
  const target = (a: Animation) => (a.effect as KeyframeEffect | null)?.target;
  const name = (a: Animation) => (a as CSSAnimation).animationName ?? "";
  const isClock = (a: Animation) => (target(a) as Element | null)?.matches?.(".kn-goo-clock, .kn-goo-drop") ?? false;
  const mine = () => document.getAnimations().filter((a) => {
    const t = target(a);
    // Os botões da ida: a animação CSS `kn-goo-buttons-in` na main, ou uma WAAPI com esse `id` na mola (#32526).
    return t instanceof Element && bar.contains(t) && (isClock(a) || name(a).startsWith("kn-goo") || a.id.startsWith("kn-goo"));
  });
  const deadline = performance.now() + 2000;
  let list = mine();
  while (list.filter(isClock).length < 2) {
    if (performance.now() > deadline) throw new Error(`as gotas não começaram: ${list.map(name)}`);
    await new Promise((r) => requestAnimationFrame(r));
    list = mine();
  }
  for (const a of list) a.pause();
  (window as unknown as { __goo: Animation[] }).__goo = list;
  return Math.max(...list.filter(isClock).map((a) => Number(a.effect!.getComputedTiming().duration)));
}, section);

/** Põe as animações paradas em `ms` (no máximo um pouco antes do fim de cada uma) e espera o desenho. */
const seekMs = (p: Page, ms: number) => p.evaluate(async (t) => {
  for (const a of (window as unknown as { __goo: Animation[] }).__goo) {
    const d = Number(a.effect!.getComputedTiming().duration);
    a.currentTime = Math.min(t, d * 0.999);
  }
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}, ms);

const release = (p: Page) => p.evaluate(() => {
  const w = window as unknown as { __gooTimeout?: typeof setTimeout; __goo: Animation[]; setTimeout: typeof setTimeout };
  if (w.__gooTimeout) w.setTimeout = w.__gooTimeout;
  for (const a of w.__goo) a.play();
});

/**
 * O retângulo horizontal da cabeça de cada lado (`.kn-goo-path[data-part="head"]`), na barra. Só a cabeça: a soma das
 * partes pega a barriga presa à pílula quando a gota volta e encosta nela, e a frente "pula" para a borda da pílula.
 */
const dropBoxes = (p: Page) => p.evaluate(() => {
  const bar = document.querySelector(".kn-hub-top")!.getBoundingClientRect();
  const box = (s: string) => {
    const r = document.querySelector(`.kn-goo-path[data-side="${s}"][data-part="head"]`)?.getBoundingClientRect();
    if (!r || r.width <= 0 || r.height <= 0) return null;
    return { x: r.left - bar.x, w: r.width };
  };
  return { start: box("start"), end: box("end") };
});

const waitPhase = (p: Page, phase: string) => p.waitForFunction((ph) => {
  const goo = document.querySelector<HTMLElement>(".kn-goo");
  return goo?.dataset.start === ph && goo.dataset.end === ph;
}, phase, { timeout: 5000 });

const ready = async (p: Page) => {
  await settle(p);
  await p.evaluate(() => Promise.all(document.getAnimations()
    .filter((a) => Number.isFinite(Number(a.effect?.getComputedTiming().endTime)))
    .map((a) => a.finished)));
};

export interface SpeedReport {
  ms: number;
  frames: number;
  /** A menor velocidade da frente entre a largada e a chegada, em px por quadro. */
  minMid: number;
  /** O maior salto de velocidade entre dois quadros seguidos. */
  maxJump: number;
  peak: number;
  /** A distância que a frente andou. */
  travel: number;
}

/** As medidas de um lado a partir das frentes, quadro a quadro. */
export function speedOf(fronts: number[], ms: number): SpeedReport {
  const first = fronts[0]!;
  const last = fronts.at(-1)!;
  const dir = Math.sign(last - first) || 1;
  const v = fronts.slice(1).map((f, i) => (f - fronts[i]!) * dir);
  // Como no T32464 (#32544): da largada (o 1º quadro em que a frente anda 1 px; antes é a mola entrando) até a
  // chegada (o 1º quadro em que a frente alcança o lugar final; o que vem depois é o assentar do passar do ponto). Na
  // volta, o último quadro é o último antes de a cabeça sumir.
  const go = v.findIndex((x) => x >= 1);
  const reach = fronts.findIndex((f) => (f - last) * dir >= -MOVED_PX);
  const mid = go >= 0 && reach > go ? v.slice(go, reach) : v;
  const jumps = v.slice(1).map((x, i) => Math.abs(x - v[i]!));
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    ms: Math.round(ms), frames: fronts.length,
    minMid: r(Math.min(...mid)), maxJump: r(Math.max(0, ...jumps)), peak: r(Math.max(...v)), travel: r(Math.abs(last - first)),
  };
}

/** Uma ida ou uma volta: as frentes de cada lado, quadro a quadro, e as medidas. */
async function measure(p: Page, section: string, final: string) {
  const ms = await clickAndPause(p, section);
  const boxes: Record<Side, Box | null>[] = [];
  for (let t = 0; t <= ms; t += FRAME_MS) {
    await seekMs(p, t);
    boxes.push(await dropBoxes(p));
  }
  await seekMs(p, ms);
  boxes.push(await dropBoxes(p));
  await release(p);
  await waitPhase(p, final);
  const out = {} as Record<Side, SpeedReport & { fronts: number[] }>;
  for (const side of SIDES) {
    const list = boxes.map((b) => b[side]).filter((b): b is Box => b !== null);
    assert.ok(list.length > 2, `a gota do lado ${side} não apareceu`);
    // A frente é a borda no sentido em que a gota anda, pelo centro do primeiro e do último quadro.
    const c0 = list[0]!.x + list[0]!.w / 2;
    const c1 = list.at(-1)!.x + list.at(-1)!.w / 2;
    const fronts = list.map((b) => (c1 >= c0 ? b.x + b.w : b.x));
    out[side] = { ...speedOf(fronts, ms), fronts: fronts.map((f) => Math.round(f * 10) / 10) };
  }
  return out;
}

if (import.meta.main) {
  const cli = join(import.meta.dir, "cli.ts");
  const cleanup = () => {
    spawnSync(process.execPath, [cli, "stop", "--data", data], { encoding: "utf8" });
    rmSync(data, { recursive: true, force: true });
  };
  const up = spawnSync(process.execPath, [cli, "start", "--data", data, "--no-helper"], { encoding: "utf8" });
  if (up.status !== 0) {
    cleanup();
    throw new Error(`o headless não subiu em ${data}:\n${up.stdout}${up.stderr}`);
  }
  const browser: Browser = await webkit.launch();
  const all: Record<string, unknown> = {};
  try {
    for (const width of WIDTHS) {
      const w = await openWindow(browser, ctx, { window: "hub", width, height: 640, scale: 1, theme: "light", motion: true, browser: "webkit", query: { section: "settings" } });
      try {
        await ready(w.page);
        const ida = await measure(w.page, "notes", "shown");
        await ready(w.page);
        const volta = await measure(w.page, "settings", "hidden");
        all[width] = { ida, volta };
        for (const [dir, r] of [["ida", ida], ["volta", volta]] as const) {
          for (const side of SIDES) {
            const { fronts: _, ...m } = r[side];
            console.log(`${width}px ${dir} ${side}: ${JSON.stringify(m)}`);
          }
        }
        assert.deepEqual(w.report.problems, [], "erros na página");
      } finally {
        await w.close();
      }
    }
    if (jsonOut) writeFileSync(jsonOut, JSON.stringify(all, null, 2));
  } finally {
    await browser.close();
    cleanup();
  }
}
