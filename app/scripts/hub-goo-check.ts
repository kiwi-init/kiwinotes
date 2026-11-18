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
// E "reduzir movimento", o do Mac (`prefers-reduced-motion`) e o do Kiwi (`data-motion="reduced"`): sem gota, os
// botões só fazem o fade (OUT/reduzir-mac, OUT/reduzir-kiwi).
//
// Confere: as fases (entering → shown, leaving → hidden), a duração (350–500 ms), a gota longe da pílula no meio da
// ida e no lugar dos botões no fim, e o texto e os ícones fora de filtro e por cima da gota em todos os quadros.
// Sem um headless de pé, sobe o seu (`cli start --no-helper`) e o derruba no fim, passe ou falhe. Sem OUT, os prints
// vão para uma pasta nova do tmp, que fica (a saída diz onde).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Page } from "playwright-core";

import { SLOW_FRAME_MS, WATCH_MS } from "../ui/src/slowFrames.ts";
import { request } from "./cli.ts";
import { openWindow, settle, type UiContext } from "./ui-page.ts";

const [outArg] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const out = resolve(outArg ?? mkdtempSync(join(tmpdir(), "kn-hub-goo-out-")));
const data = mkdtempSync(join(tmpdir(), "kn-hub-goo-"));
mkdirSync(out, { recursive: true });

/** Os tempos de cada quadro, em fração da animação: os do goo-shape.ts (barriga até 20%, pescoço até 46%, a beira volta
 *  reta até 68%, a gota corre até o fim) e os do meio deles. */
const FRAMES = [0, 0.07, 0.14, 0.2, 0.28, 0.36, 0.43, 0.5, 0.58, 0.68, 0.8, 0.9, 1];
const MIN_MS = 350;
const MAX_MS = 500;
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
type Frame = { t: number; start: Box; end: Box; tabs: Box };

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
  // A gota é desenhada (T18948): caminhos SVG, sem filtro e sem texto dentro.
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
  const mine = () => document.getAnimations().filter((a) => {
    const t = (a.effect as KeyframeEffect | null)?.target;
    return t instanceof Element && bar.contains(t) && (a as CSSAnimation).animationName?.startsWith("kn-goo");
  });
  const deadline = performance.now() + 2000;
  let list = mine();
  while (list.filter((a) => (a as CSSAnimation).animationName.includes("-in-") || (a as CSSAnimation).animationName.includes("-out-")).length < 2) {
    if (performance.now() > deadline) throw new Error(`as gotas não começaram: ${list.map((a) => (a as CSSAnimation).animationName)}`);
    await new Promise((r) => requestAnimationFrame(r));
    list = mine();
  }
  for (const a of list) a.pause();
  (window as unknown as { __goo: Animation[] }).__goo = list;
  return list.map((a) => ({ name: (a as CSSAnimation).animationName, ms: Number(a.effect!.getComputedTiming().duration) }));
}, section);

/** Põe as animações paradas na fração `f` e mede a gota (a parte que vira os botões) e a pílula. */
const seek = (p: Page, f: number) => p.evaluate(async (frac) => {
  for (const a of (window as unknown as { __goo: Animation[] }).__goo) {
    const ms = Number(a.effect!.getComputedTiming().duration);
    // Um pouco antes do fim, para a animação não acabar (e o `animationend` não andar a fase). Com "reduzir
    // movimento", o base.css corta as animações para 0,01 ms: o "um pouco" é proporcional.
    a.currentTime = Math.min(frac * ms, ms * 0.999);
  }
  // A gota se desenha no próximo quadro.
  for (let i = 0; i < 2; i++) await new Promise((r) => requestAnimationFrame(r));
  const bar = document.querySelector(".kn-hub-top")!.getBoundingClientRect();
  const box = (el: Element): { x: number; y: number; w: number; h: number } => {
    const r = el.getBoundingClientRect();
    return { x: r.x - bar.x, y: r.y - bar.y, w: r.width, h: r.height };
  };
  const head = (s: string) => document.querySelector(`.kn-goo-path[data-side="${s}"][data-part="head"]`)!;
  return { t: frac, start: box(head("start")), end: box(head("end")), tabs: box(document.querySelector(".kn-tabs")!) };
}, f);

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

const near = (a: Box, b: Box, tol = 1.5) =>
  Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol && Math.abs(a.w - b.w) <= tol && Math.abs(a.h - b.h) <= tol;

const shot = async (p: Page, file: string) => {
  const bar = await p.locator(".kn-hub-top").boundingBox();
  assert.ok(bar, "a barra do Hub não está na tela");
  await p.screenshot({ path: file, clip: { x: 0, y: bar.y, width: p.viewportSize()!.width, height: bar.height + 8 } });
};

/** Uma ida ou uma volta, quadro a quadro. */
async function frames(p: Page, dir: string, section: string, kind: "in" | "out") {
  mkdirSync(dir, { recursive: true });
  const anims = await clickAndPause(p, section);
  const drops = anims.filter((a) => a.name.startsWith(`kn-goo-${kind}-`));
  assert.deepEqual(drops.map((a) => a.name).sort(), [`kn-goo-${kind}-end`, `kn-goo-${kind}-start`], JSON.stringify(anims));
  for (const a of drops) assert.ok(a.ms >= MIN_MS && a.ms <= MAX_MS, `${a.name} tem ${a.ms} ms, fora de ${MIN_MS}–${MAX_MS}`);
  const want = kind === "in" ? "entering" : "leaving";
  const ph = await phases(p);
  assert.equal(ph.start, want, JSON.stringify(ph));
  assert.equal(ph.end, want, JSON.stringify(ph));
  const list: Frame[] = [];
  const problems: string[] = [];
  for (const [i, f] of FRAMES.entries()) {
    const fr = await seek(p, f);
    list.push(fr);
    const c = await crisp(p);
    problems.push(...c.problems.map((m) => `${Math.round(f * 100)}%: ${m}`));
    await shot(p, join(dir, `${String(i).padStart(2, "0")}-${String(Math.round(f * 100)).padStart(3, "0")}.png`));
  }
  assert.deepEqual(problems, [], `texto ou ícone fora do lugar durante a ${kind === "in" ? "ida" : "volta"}`);
  await release(p);
  await waitPhase(p, kind === "in" ? "shown" : "hidden");
  return { anims, frames: list };
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

/** "Reduzir movimento": sem gota, os botões só fazem o fade; três quadros dele. */
async function reduced(p: Page, dir: string) {
  mkdirSync(dir, { recursive: true });
  await p.locator('.kn-tab[data-section="notes"]').click();
  await p.waitForFunction(() => document.querySelector(".kn-hub-start")!.childElementCount > 0, null, { timeout: 3000 });
  const seen = await p.evaluate(() => {
    const goo = getComputedStyle(document.querySelector(".kn-goo")!).display;
    const anims = document.getAnimations().map((a) => (a as CSSAnimation).animationName ?? "");
    const buttons = document.getAnimations().filter((a) => {
      const t = (a.effect as KeyframeEffect | null)?.target;
      return t instanceof Element && !!t.parentElement?.classList.contains("kn-hub-slot");
    });
    for (const a of buttons) a.pause();
    (window as unknown as { __goo: Animation[] }).__goo = buttons;
    return {
      goo, drops: anims.filter((n) => n.startsWith("kn-goo")), buttons: buttons.map((a) => (a as CSSAnimation).animationName),
      fadeMs: buttons.map((a) => Number(a.effect!.getComputedTiming().duration)),
    };
  });
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
const up = spawnSync(process.execPath, [cli, "start", "--data", data, "--no-helper"], { encoding: "utf8" });
if (up.status !== 0) {
  cleanup();
  throw new Error(`o headless não subiu em ${data}:\n${up.stdout}${up.stderr}`);
}
const browser = await webkit.launch();
const metrics: Record<string, unknown> = {};
try {
  const base = { window: "hub" as const, width: 1000, height: 640, browser: "webkit" as const, query: { section: "settings" } };
  for (const theme of ["light", "dark"] as const) {
    // 1. Quadro a quadro.
    const w = await openWindow(browser, ctx, { ...base, scale: 2, theme, motion: true });
    try {
      await settle(w.page);
      const first = await phases(w.page);
      assert.deepEqual([first.start, first.end], ["hidden", "hidden"], `Ajustes abriu com botões na barra: ${JSON.stringify(first)}`);
      const ida = await frames(w.page, join(out, theme, "ida"), "notes", "in");
      const mid = ida.frames.find((f) => f.t === 0.5)!;
      // No meio da ida, a gota já se soltou da pílula (goo-shape.ts: o pescoço parte em 46%).
      assert.ok(mid.start.w > 0 && mid.start.x + mid.start.w < mid.tabs.x - 4, `no meio da ida a gota da esquerda ainda está presa à pílula: ${JSON.stringify(mid)}`);
      assert.ok(mid.end.w > 0 && mid.end.x > mid.tabs.x + mid.tabs.w + 4, `no meio da ida a gota da direita ainda está presa à pílula: ${JSON.stringify(mid)}`);
      const shown = await phases(w.page);
      assert.deepEqual([shown.slotStart, shown.slotEnd], ["shown", "shown"], JSON.stringify(shown));
      assert.ok(shown.buttons.start > 0 && shown.buttons.end > 0, `as Notas não puseram botões dos dois lados: ${JSON.stringify(shown)}`);
      const last = ida.frames.at(-1)!;
      for (const side of ["start", "end"] as const) {
        const b = await slotBox(w.page, side);
        assert.ok(near(last[side], b), `a gota da ${side} não assenta nos botões: gota ${JSON.stringify(last[side])}, botões ${JSON.stringify(b)}`);
      }
      const volta = await frames(w.page, join(out, theme, "volta"), "settings", "out");
      const back = volta.frames.at(-1)!;
      assert.ok(back.start.x >= back.tabs.x - 1 && back.end.x + back.end.w <= back.tabs.x + back.tabs.w + 1,
        `no fim da volta a gota não está dentro da pílula: ${JSON.stringify(back)}`);
      assert.deepEqual(w.report.problems, [], "erros na página");
      metrics[`${theme}.quadros`] = { ida, volta };
    } finally {
      await w.close();
    }

    // 2. Tempo real, com vídeo.
    const v = await openWindow(browser, ctx, { ...base, scale: 1, theme, motion: true, video: join(out, theme, "video") });
    try {
      await settle(v.page);
      // A máquina é dividida: com outro agente rodando, um quadro passou de 100 ms uma vez em três rodadas (load 24).
      // Uma rodada lenta é repetida uma vez; a gota só reprova se a repetição também for lenta.
      const reports = () => v.report.invokes["diagnostics.slowFrame"] ?? 0;
      const round = async () => {
        const before = reports();
        const ida = await realtime(v.page, "notes");
        await waitPhase(v.page, "shown");
        const volta = await realtime(v.page, "settings");
        await waitPhase(v.page, "hidden");
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
      const worst = Math.max(...gaps.flatMap((g) => [g.ida, g.volta]));
      metrics[`${theme}.tempoReal`] = { gaps, worst, retried };
      const why = worst >= SLOW_FRAME_MS
        ? `um quadro de ${worst.toFixed(1)} ms durante a gota (meta ${SLOW_FRAME_MS} ms): ${JSON.stringify({ gaps, retried })}`
        : gaps.some((g) => g.slowFrameReports > 0) ? `o slowFrames do app acusou um quadro travado: ${JSON.stringify(gaps)}` : null;
      // No CI, a VM do GitHub não dá um relógio de quadros confiável: o tempo sai no log, e quem barra é a máquina local.
      if (why && process.env.CI) console.log(`aviso (CI, não barra): ${why}`);
      else assert.equal(why, null, why ?? "");
      assert.deepEqual(v.report.problems, [], "erros na página");
    } finally {
      await v.close();
    }
  }

  // 3. Reduzir movimento: o do Mac e o do Kiwi.
  const mac = await openWindow(browser, ctx, { ...base, scale: 2, theme: "light", motion: false });
  try {
    await settle(mac.page);
    metrics["reduzir-mac"] = await reduced(mac.page, join(out, "reduzir-mac"));
  } finally {
    await mac.close();
  }
  const kiwi = await openWindow(browser, ctx, { ...base, scale: 2, theme: "light", motion: true });
  try {
    await settle(kiwi.page);
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
    console.log(`ok ${theme}: ida e volta quadro a quadro; pior quadro em tempo real ${t.worst.toFixed(1)} ms (meta ${SLOW_FRAME_MS})`);
  }
  console.log("ok reduzir movimento (Mac e Kiwi): sem gota; os botões entram com o fade, que o base.css corta para 0,01 ms");
  console.log(`quadros, vídeos e metrics.json em ${out}`);
} finally {
  await browser.close();
  cleanup();
}
