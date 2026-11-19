// A medida dos quadros da gota (spec #17725) na troca de aba, no WebKit headless e no build real: para cada ida
// (Ajustes → Notas) e volta (Notas → Ajustes), o intervalo entre quadros (rAF) e o que corre em cada um. Pegue o
// `kiwi lock bench`. Nenhum app abre na tela.
//
//   bun scripts/goo-quadros-medida.ts [--rounds 5] [--scale 2] [--json OUT.json]
//   bun scripts/goo-quadros-medida.ts --preso 200 --video DIR
//
// Com `--preso MS`, uma ida só, gravada em vídeo (DIR), com a thread principal presa MS ms de propósito no meio da
// corrida (o relógio em 50%): o que anda no compositor segue no vídeo, o que é desenhado no rAF para. O
// `goo-video-trilha.ts` tira do vídeo o lugar da gota quadro a quadro.
//
// Por quadro, durante a animação (do clique até a fase assentar):
// - o intervalo até o quadro anterior;
// - o JS dos callbacks de rAF (a gota desenha num rAF), e, dentro dele, o `getBBox` (pede layout do SVG), o
//   `getComputedStyle` e os `setAttribute("d")`;
// - o resto do quadro (intervalo − JS): estilo, layout, pintura e composição, que o WebKit não separa por JS.
// No fim, por direção: quantos quadros, quantos passam de 16,7 ms (60 fps) e de 8,3 ms (120 fps), a mediana e o pior.
// O WebKit headless não tem a tela de 120 Hz: o rAF dele anda a 60 Hz. A coluna de 8,3 ms mostra quanto de cada
// quadro sobra para a de 120 Hz, não a taxa dela.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { webkit, type Page } from "playwright-core";

import { request } from "./cli.ts";
import { openWindow, settle, type UiContext } from "./ui-page.ts";

const { values } = parseArgs({
  options: {
    rounds: { type: "string", default: "5" }, scale: { type: "string", default: "2" }, json: { type: "string" },
    preso: { type: "string" }, video: { type: "string" },
  },
});
const ROUNDS = Number(values.rounds);
const SCALE = Number(values.scale) === 1 ? 1 : 2;

const data = mkdtempSync(join(tmpdir(), "kn-goo-medida-"));
const cli = resolve(import.meta.dir, "cli.ts");
let running = false;
const cleanup = () => {
  if (running) spawnSync(process.execPath, [cli, "stop", "--data", data], { encoding: "utf8", timeout: 15_000 });
  running = false;
  rmSync(data, { recursive: true, force: true });
};
for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]] as const) process.on(signal, () => (cleanup(), process.exit(code)));

const ctx: UiContext = {
  data,
  send: async (msg) => {
    const r = await request(data, msg);
    if (!r) throw new Error(`o headless em ${data} parou no meio`);
    return r;
  },
  subscribe: async () => () => {},
};

type Frame = { gap: number; js: number; bbox: number; style: number; attr: number; at: number; p: number | null };

/** Liga os relógios: um laço de rAF que anota cada quadro, e o tempo dos callbacks de rAF e das chamadas caras. */
const arm = (p: Page) => p.evaluate(() => {
  const w = window as any;
  if (!w.__gooArmed) {
    w.__gooArmed = true;
    const acc = { js: 0, bbox: 0, style: 0, attr: 0 };
    w.__gooAcc = acc;
    const raf = window.requestAnimationFrame.bind(window);
    w.__gooRaf = raf;
    window.requestAnimationFrame = (cb: FrameRequestCallback) => raf((t) => {
      const s = performance.now();
      try { cb(t); } finally { acc.js += performance.now() - s; }
    });
    const timed = <T extends object>(obj: T, key: keyof T, slot: "bbox" | "style" | "attr", when?: (args: unknown[]) => boolean) => {
      const orig = obj[key] as unknown as (...a: unknown[]) => unknown;
      (obj as any)[key] = function (this: unknown, ...args: unknown[]) {
        if (when && !when(args)) return orig.apply(this, args);
        const s = performance.now();
        try { return orig.apply(this, args); } finally { acc[slot] += performance.now() - s; }
      };
    };
    timed(SVGGraphicsElement.prototype, "getBBox", "bbox");
    timed(window, "getComputedStyle", "style");
    timed(Element.prototype, "setAttribute", "attr", (a) => a[0] === "d");
    // O clique (captura, antes do React) e o fim do despacho dele: o trabalho síncrono do clique (montar a seção).
    document.addEventListener("click", () => {
      w.__gooClick = performance.now();
      queueMicrotask(() => setTimeout(() => (w.__gooClickDone = performance.now()), 0));
    }, true);
  }
  w.__gooClick = 0;
  w.__gooClickDone = 0;
  w.__gooFrames = [] as Frame[];
  w.__gooStop = false;
  const acc = w.__gooAcc;
  for (const k of Object.keys(acc)) acc[k] = 0;
  let last = performance.now();
  // O laço usa o rAF de verdade: o tempo dele não entra no JS medido.
  const raf = w.__gooRaf as typeof requestAnimationFrame;
  const tick = (t: number) => {
    // O quadro anterior acabou: o que se acumulou desde então é dele.
    // O progresso do relógio da gota neste quadro (o lado que anda), o que a pessoa vê avançar.
    const clocks = Array.from(document.querySelectorAll<HTMLElement>(".kn-goo-drop"));
    const run = clocks.map((c) => c.getAnimations()[0]?.effect?.getComputedTiming().progress).find((x) => x != null);
    w.__gooFrames.push({ gap: t - last, js: acc.js, bbox: acc.bbox, style: acc.style, attr: acc.attr, at: t, p: run == null ? null : Number(run) });
    for (const k of Object.keys(acc)) acc[k] = 0;
    last = t;
    if (!w.__gooStop) raf(tick);
  };
  raf(tick);
});

const settled = (p: Page, phase: string) => p.waitForFunction((ph) => {
  const goo = document.querySelector<HTMLElement>(".kn-goo");
  return goo?.dataset.start === ph && goo.dataset.end === ph;
}, phase, { timeout: 5000 });

const rounds: { dir: string; click: number; clickDone: number; frames: Frame[] }[] = [];

async function transition(p: Page, section: string, phase: string): Promise<Frame[]> {
  await arm(p);
  await p.locator(`.kn-tab[data-section="${section}"]`).click();
  await settled(p, phase);
  // Mais um quadro: o último da animação também conta.
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const r = await p.evaluate(() => {
    const w = window as any;
    w.__gooStop = true;
    // O primeiro registro é o intervalo até o laço começar, antes do clique: fora.
    return { frames: (w.__gooFrames as Frame[]).slice(1), click: w.__gooClick as number, clickDone: w.__gooClickDone as number };
  });
  rounds.push({ dir: phase === "shown" ? "ida" : "volta", ...r });
  return r.frames;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
};
const r1 = (n: number) => Math.round(n * 10) / 10;

function summary(frames: Frame[]) {
  const gaps = frames.map((f) => f.gap);
  const js = frames.map((f) => f.js);
  const rest = frames.map((f) => Math.max(0, f.gap - f.js));
  return {
    quadros: frames.length,
    acima60: gaps.filter((g) => g > 1000 / 60 + 1).length,
    acima120: gaps.filter((g) => g > 1000 / 120 + 0.5).length,
    intervaloMediana: r1(median(gaps)),
    intervaloPior: r1(Math.max(...gaps)),
    jsMediana: r1(median(js)),
    jsPior: r1(Math.max(...js)),
    getBBox: r1(frames.reduce((a, f) => a + f.bbox, 0) / frames.length),
    getComputedStyle: r1(frames.reduce((a, f) => a + f.style, 0) / frames.length),
    setAttrD: r1(frames.reduce((a, f) => a + f.attr, 0) / frames.length),
    restoMediana: r1(median(rest)),
    restoPior: r1(Math.max(...rest)),
  };
}

const up = spawnSync(process.execPath, [cli, "start", "--data", data, "--no-helper"], { encoding: "utf8" });
if (up.status !== 0) {
  cleanup();
  throw new Error(`o headless não subiu:\n${up.stdout}${up.stderr}`);
}
running = true;
const browser = await webkit.launch();
let code = 0;
try {
  const w = await openWindow(browser, ctx, {
    window: "hub", width: 1000, height: 640, browser: "webkit", scale: values.preso ? 1 : SCALE, theme: "light", motion: true,
    query: { section: "settings" }, ...(values.video ? { video: values.video } : {}),
  });
  try {
    if (values.preso) {
      await settle(w.page);
      await w.page.waitForTimeout(500);
      // Prende a thread no 1º quadro com o relógio da ida em 50% (no meio da corrida).
      await w.page.evaluate((ms) => {
        const tick = () => {
          const a = document.querySelector('.kn-goo-drop[data-side="end"]')?.getAnimations()[0];
          const p = Number(a?.effect?.getComputedTiming().progress ?? 0);
          if (p >= 0.5) {
            (window as any).__preso = { p, at: performance.now() };
            const until = performance.now() + ms;
            while (performance.now() < until);
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }, Number(values.preso));
      await w.page.locator('.kn-tab[data-section="notes"]').click();
      await settled(w.page, "shown");
      await w.page.waitForTimeout(500);
      console.log(`preso: ${JSON.stringify(await w.page.evaluate(() => (window as any).__preso))}`);
      const r = await w.page.evaluate(() => {
        const box = (q: string) => {
          const b = document.querySelector(q)!.getBoundingClientRect();
          return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
        };
        return { tabs: box(".kn-tabs"), bar: box(".kn-hub-top") };
      });
      console.log(`caixas: ${JSON.stringify(r)}`);
      if (w.report.problems.length) (console.log(`erros na página: ${w.report.problems.join(" | ")}`), (code = 1));
      await w.close();
      throw "fim";
    }
    await settle(w.page);
    // Em repouso, o mesmo laço: o piso da máquina agora, sem gota.
    await arm(w.page);
    await w.page.waitForTimeout(600);
    const idle = await w.page.evaluate(() => ((window as any).__gooStop = true, ((window as any).__gooFrames as Frame[]).slice(1)));
    const ida: Frame[] = [];
    const volta: Frame[] = [];
    for (let i = 0; i < ROUNDS; i++) {
      ida.push(...(await transition(w.page, "notes", "shown")));
      await w.page.waitForTimeout(300);
      volta.push(...(await transition(w.page, "settings", "hidden")));
      await w.page.waitForTimeout(300);
    }
    const result = { escala: SCALE, rodadas: ROUNDS, repouso: summary(idle), ida: summary(ida), volta: summary(volta) };
    const rows = (["repouso", "ida", "volta"] as const).map((k) => {
      const s = result[k];
      return `| ${k} | ${s.quadros} | ${s.acima60} | ${s.acima120} | ${s.intervaloMediana} / ${s.intervaloPior} | ${s.jsMediana} / ${s.jsPior} | ${s.getBBox} | ${s.getComputedStyle} | ${s.setAttrD} | ${s.restoMediana} / ${s.restoPior} |`;
    });
    console.log([
      `escala ${SCALE}, ${ROUNDS} idas e voltas (ms)`,
      "| | quadros | > 16,7 ms | > 8,3 ms | intervalo mediana / pior | JS mediana / pior | getBBox (média) | getComputedStyle (média) | setAttribute d (média) | resto mediana / pior |",
      "|---|---|---|---|---|---|---|---|---|---|",
      ...rows,
    ].join("\n"));
    if (values.json) writeFileSync(values.json, JSON.stringify({ ...result, quadros: { ida, volta }, rodadasQuadro: rounds }, null, 1));
    if (w.report.problems.length) (console.log(`erros na página: ${w.report.problems.join(" | ")}`), (code = 1));
  } finally {
    await w.close();
  }
} catch (e) {
  if (e !== "fim") {
    console.error(e);
    code = 1;
  }
} finally {
  await browser.close();
  cleanup();
}
process.exit(code);
