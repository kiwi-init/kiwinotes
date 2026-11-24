// T26124 / spec #26101: o nome do hover cresce por cima dos vizinhos, sem empurrar, e suave. Engine headless isolado,
// num tmp; nenhum app abre na tela. Pegue kiwi lock bench. Uso: bun scripts/hover-expand-check.ts [OUT] [--video]
//
// Nas Notas do Hub, os botões que expandem da barra lateral (Nota, Pasta, Recolher, Expandir, no popover da árvore) e
// os da barra de cima (Nova nota, Buscar). Para cada um, um amostrador por quadro (requestAnimationFrame) mede, do
// mouse entrar até 0,5 s depois de ele sair:
// - os vizinhos (os irmãos do botão) e o próprio botão: a caixa não muda em nenhum quadro (nada é empurrado);
// - a parte visível da camada (o recorte do `clip-path`), que cresce a partir do botão, para o lado com espaço, e
//   termina dentro de quem corta (a barra lateral, ou a janela);
// - a espera: nada abre antes de ~120 ms; a abertura anda em vários quadros, sem voltar e sem pulo maior que 30% do
//   caminho; o texto aparece depois de a largura andar um quarto; fechar leva menos tempo que abrir.
// E o "Reduzir movimento" (`prefers-reduced-motion`): a camada já no tamanho todo, só o fade, sem empurrar. E o foco
// do teclado (Tab da busca da árvore): abre igual.
// No CI (`CI=1`), o que é de tempo só vai para o log; empurrar e o lado barram igual.
// Com --video, grava em OUT/video o mouse passando devagar pelos botões da árvore e parando em cada um.
// Sem OUT, os vídeos vão para uma pasta nova do tmp, que fica (a saída diz onde). Sai com 1 se algo falhar.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Browser, type Page } from "playwright-core";

import { request } from "./cli.ts";
import { openWindow, settle, type UiContext } from "./ui-page.ts";

const args = process.argv.slice(2);
const video = args.includes("--video");
const out = resolve(args.find((a) => !a.startsWith("--")) ?? mkdtempSync(join(tmpdir(), "kn-hover-expand-out-")));
const data = mkdtempSync(join(tmpdir(), "kn-hover-expand-"));
mkdirSync(out, { recursive: true });

/** Nenhum quadro de abertura anda mais que isto do caminho todo (um pulo, e não um movimento). */
const MAX_STEP = 0.3;
/**
 * O que depende do relógio de quadros (a espera, os pulos, quantos quadros, fechar mais rápido). No CI (`CI=1`) só vai
 * para o log, como no hub-goo-check: a VM não tem um relógio de quadros confiável. Empurrar e o lado barram sempre.
 */
const TIMING = "[tempo] ";
/** A espera de entrada: nada abre antes disto, e tudo começa antes do segundo número. */
const DELAY_MS = [120, 260] as const;

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
type Sample = {
  t: number;
  /** A parte visível da camada, em px (da esquerda e da direita da janela). */
  left: number;
  right: number;
  opacity: number;
  text: number;
  self: Box;
  neighbors: Box[];
};
type Run = { enter: number; leave: number; samples: Sample[]; grow: string | null; clip: { left: number; right: number } };

/** Liga o amostrador na página: guarda um quadro por requestAnimationFrame, até `stop`. */
const startSampler = (p: Page, selector: string) =>
  p.evaluate((sel) => {
    const button = document.querySelector<HTMLElement>(sel);
    if (!button) throw new Error(`sem ${sel}`);
    const label = button.querySelector<HTMLElement>(":scope > .kn-expand-label")!;
    const box = (e: Element) => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    // Os valores do inset em px: uma margem em % de um bloco da largura da camada dá o mesmo número que o recorte.
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;left:-9999px;top:0;visibility:hidden";
    const inner = document.createElement("div");
    probe.append(inner);
    document.body.append(probe);
    const px = (expr: string, width: number) => {
      probe.style.width = `${width}px`;
      inner.style.marginLeft = expr;
      return parseFloat(getComputedStyle(inner).marginLeft);
    };
    const split = (s: string) => {
      const parts: string[] = [];
      let depth = 0,
        cur = "";
      for (const ch of s) {
        if (ch === "(") depth++;
        if (ch === ")") depth--;
        if (ch === " " && depth === 0) {
          if (cur) parts.push(cur);
          cur = "";
        } else cur += ch;
      }
      if (cur) parts.push(cur);
      return parts;
    };
    const visible = () => {
      const r = label.getBoundingClientRect();
      const m = /^inset\((.*)\)$/.exec(getComputedStyle(label).clipPath);
      if (!m) return { left: r.left, right: r.right };
      const v = split(m[1]!.split(" round ")[0]!);
      const [, right, , left] = [v[0], v[1] ?? v[0], v[2] ?? v[0], v[3] ?? v[1] ?? v[0]];
      return { left: r.left + px(left!, r.width), right: r.right - px(right!, r.width) };
    };
    const neighbors = [...button.parentElement!.children].filter((e) => e !== button && e.getClientRects().length > 0);
    const w = window as unknown as { __kn: { samples: Sample[]; enter: number; leave: number; on: boolean } };
    w.__kn = { samples: [], enter: -1, leave: -1, on: true };
    button.addEventListener("pointerenter", () => (w.__kn.enter = performance.now()), { once: true });
    button.addEventListener("focus", () => (w.__kn.enter = performance.now()), { once: true });
    button.addEventListener("pointerleave", () => (w.__kn.leave = performance.now()), { once: true });
    button.addEventListener("blur", () => (w.__kn.leave = performance.now()), { once: true });
    const tick = () => {
      if (!w.__kn.on) return void probe.remove();
      const v = visible();
      w.__kn.samples.push({
        t: performance.now(),
        ...v,
        opacity: Number(getComputedStyle(label).opacity),
        text: Number(getComputedStyle(label.firstElementChild!).opacity),
        self: box(button),
        neighbors: neighbors.map(box),
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, selector);

const stopSampler = (p: Page, selector: string) =>
  p.evaluate((sel) => {
    const w = window as unknown as { __kn: { samples: Sample[]; enter: number; leave: number; on: boolean } };
    w.__kn.on = false;
    const button = document.querySelector<HTMLElement>(sel)!;
    let clip = { left: 0, right: document.documentElement.clientWidth };
    for (let at = button.parentElement; at && at !== document.body; at = at.parentElement) {
      if (getComputedStyle(at).overflowX !== "visible") {
        const r = at.getBoundingClientRect();
        clip = { left: r.left, right: r.right };
        break;
      }
    }
    return { enter: w.__kn.enter, leave: w.__kn.leave, samples: w.__kn.samples, grow: button.dataset.grow ?? null, clip };
  }, selector) as Promise<Run>;

const same = (a: Box, b: Box) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5;

/** Mouse longe, o amostrador, o hover, 0,9 s parado, o mouse sai, 0,5 s fechando. */
async function hoverRun(p: Page, selector: string): Promise<Run> {
  await p.mouse.move(500, 600);
  await p.waitForTimeout(500);
  await startSampler(p, selector);
  await p.waitForTimeout(50);
  await p.hover(selector);
  await p.waitForTimeout(900);
  await p.mouse.move(500, 600);
  await p.waitForTimeout(500);
  return stopSampler(p, selector);
}

/** O que a medida diz de um hover com movimento; uma lista vazia é o certo. */
export function motionProblems(name: string, run: Run): string[] {
  const bad: string[] = [];
  const s = run.samples;
  if (run.enter < 0 || run.leave < 0) return [`${name}: o mouse não entrou ou não saiu (${run.enter}, ${run.leave})`];
  const first = s[0]!;
  for (const f of s) {
    if (!same(f.self, first.self)) bad.push(`${name}: o botão mudou de caixa em ${Math.round(f.t - run.enter)} ms (${JSON.stringify(first.self)} → ${JSON.stringify(f.self)})`);
    f.neighbors.forEach((n, i) => {
      if (!same(n, first.neighbors[i]!)) bad.push(`${name}: o vizinho ${i + 1} foi empurrado em ${Math.round(f.t - run.enter)} ms (${JSON.stringify(first.neighbors[i])} → ${JSON.stringify(n)})`);
    });
    if (bad.length) break;
  }
  const width = (f: Sample) => f.right - f.left;
  const closed = width(first);
  const opening = s.filter((f) => f.t >= run.enter && f.t <= run.leave);
  const open = Math.max(...opening.map(width));
  const travel = open - closed;
  if (travel < 20) return [...bad, `${name}: a camada não abriu (de ${closed.toFixed(1)} para ${open.toFixed(1)} px)`];
  // Cresce a partir do botão: o lado preso fica no lugar.
  const anchored = run.grow === "left" ? (f: Sample) => f.right : (f: Sample) => f.left;
  const pinned = opening.filter((f) => f.opacity > 0).map(anchored);
  if (pinned.length && Math.max(...pinned) - Math.min(...pinned) > 7)
    bad.push(`${name}: a camada não cresce do botão (o lado ${run.grow === "left" ? "direito" : "esquerdo"} andou de ${Math.min(...pinned).toFixed(1)} a ${Math.max(...pinned).toFixed(1)})`);
  const full = opening.find((f) => width(f) >= open - 0.5)!;
  if (full.left < run.clip.left - 7 || full.right > run.clip.right + 7)
    bad.push(`${name}: aberta, a camada sai de quem corta (${full.left.toFixed(0)}–${full.right.toFixed(0)}, cabe em ${run.clip.left.toFixed(0)}–${run.clip.right.toFixed(0)}), lado ${run.grow}`);
  const moving = opening.findIndex((f) => width(f) > closed + 1);
  const startMs = opening[moving]!.t - run.enter;
  if (startMs < DELAY_MS[0] || startMs > DELAY_MS[1]) bad.push(`${TIMING}${name}: abriu ${Math.round(startMs)} ms depois de o mouse entrar (a espera é de ${DELAY_MS[0]}–${DELAY_MS[1]} ms)`);
  const steps = opening.slice(Math.max(0, moving - 1)).map(width);
  let frames = 0;
  for (let i = 1; i < steps.length; i++) {
    const d = steps[i]! - steps[i - 1]!;
    if (d < -0.5) bad.push(`${name}: a abertura voltou ${(-d).toFixed(1)} px num quadro`);
    if (d > MAX_STEP * travel) bad.push(`${TIMING}${name}: a abertura pulou ${((d / travel) * 100).toFixed(0)}% do caminho num quadro`);
    if (d > 0.5) frames++;
  }
  if (frames < 8) bad.push(`${TIMING}${name}: a abertura andou em só ${frames} quadros`);
  const openMs = full.t - opening[moving]!.t;
  const textAt = opening.find((f) => f.text > 0.05);
  if (!textAt) bad.push(`${name}: o texto não apareceu`);
  else if (width(textAt) < closed + travel / 4) bad.push(`${name}: o texto apareceu antes de a largura andar um quarto (${(((width(textAt) - closed) / travel) * 100).toFixed(0)}%)`);
  const closing = s.filter((f) => f.t > run.leave);
  const shut = closing.find((f) => f.opacity === 0 && width(f) <= closed + 0.5);
  if (!shut) bad.push(`${name}: não fechou em 0,5 s`);
  else if (shut.t - run.leave >= openMs) bad.push(`${TIMING}${name}: fechar (${Math.round(shut.t - run.leave)} ms) não foi mais rápido que abrir (${Math.round(openMs)} ms)`);
  return bad;
}

/** Reduzir movimento: o recorte não anda (já no tamanho todo quando aparece), só o fade, e nada é empurrado. */
function reducedProblems(name: string, run: Run): string[] {
  const bad: string[] = [];
  const s = run.samples;
  const first = s[0]!;
  for (const f of s)
    f.neighbors.forEach((n, i) => {
      if (!same(n, first.neighbors[i]!) && !bad.length) bad.push(`${name} (reduzir): o vizinho ${i + 1} foi empurrado`);
    });
  const shown = s.filter((f) => f.opacity > 0.01);
  const widths = shown.map((f) => f.right - f.left);
  if (!shown.length) return [...bad, `${name} (reduzir): a camada não apareceu`];
  if (Math.max(...widths) - Math.min(...widths) > 0.5) bad.push(`${name} (reduzir): o recorte andou (${Math.min(...widths).toFixed(1)}–${Math.max(...widths).toFixed(1)} px)`);
  if (!shown.some((f) => f.opacity > 0.05 && f.opacity < 0.95)) bad.push(`${name} (reduzir): sem fade (apareceu de uma vez)`);
  return bad;
}

/** Os da árvore, pelo atributo (o aria-label diz a pasta escolhida). */
const TREE = ["data-new='note'", "data-new='folder'", "data-all='collapse'", "data-all='expand'"];
const TOP = ["aria-label='Nova nota'", "aria-label='Buscar'"];
const sel = (attr: string) => `.kn-expand[${attr}]`;

async function openTree(p: Page) {
  await p.click(".kn-crumb-bt");
  await p.waitForSelector(".kn-side-top .kn-expand", { state: "visible" });
  await p.waitForTimeout(500);
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

if (import.meta.main) {
  const up = spawnSync(process.execPath, [cli, "start", "--data", data, "--no-helper"], { encoding: "utf8" });
  if (up.status !== 0) {
    cleanup();
    throw new Error(`o headless não subiu em ${data}:\n${up.stdout}${up.stderr}`);
  }
  for (const note of [{ folder: "Projeto X", title: "Ideias", content: "# Ideias\n\nUma nota de exemplo.\n" }, { folder: "Projeto X/Rascunhos", title: "Lista", content: "# Lista\n" }]) {
    const r = spawnSync(process.execPath, [cli, "invoke", "notes.create", JSON.stringify(note), "--data", data], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`notes.create: ${r.stdout}${r.stderr}`);
  }
  const browser: Browser = await webkit.launch();
  const problems: string[] = [];
  try {
    const base = { window: "hub" as const, width: 1000, height: 640, browser: "webkit" as const, query: { section: "notes" }, scale: 1 as const, theme: "light" as const };
    // 1. Com movimento: cada botão, medido quadro a quadro.
    const w = await openWindow(browser, ctx, { ...base, motion: true });
    try {
      await settle(w.page);
      for (const label of TOP) {
        const run = await hoverRun(w.page, sel(label));
        const bad = motionProblems(label, run);
        problems.push(...bad);
        console.log(`${bad.length ? "FALHOU" : "ok    "} ${label} (${run.grow}, ${run.samples.length} quadros)${bad.map((b) => `\n  ${b}`).join("")}`);
      }
      await openTree(w.page);
      for (const label of TREE) {
        const run = await hoverRun(w.page, sel(label));
        const bad = motionProblems(label, run);
        problems.push(...bad);
        console.log(`${bad.length ? "FALHOU" : "ok    "} ${label} (${run.grow}, ${run.samples.length} quadros)${bad.map((b) => `\n  ${b}`).join("")}`);
      }
      // 2. O foco do teclado: da busca da árvore, o ⌥Tab vai ao primeiro botão (no WebKit, como no Safari, o Tab sozinho
      //    pula botões), que abre igual.
      await w.page.mouse.move(500, 600);
      await w.page.focus(".kn-side-search");
      await startSampler(w.page, sel(TREE[0]!));
      await w.page.waitForTimeout(50);
      await w.page.keyboard.press("Alt+Tab");
      await w.page.waitForTimeout(900);
      assert.ok(await w.page.evaluate((s) => document.activeElement === document.querySelector(s), sel(TREE[0]!)), "o ⌥Tab da busca não foi ao botão + Nota");
      await w.page.keyboard.press("Alt+Shift+Tab");
      await w.page.waitForTimeout(500);
      const kb = await stopSampler(w.page, sel(TREE[0]!));
      const bad = motionProblems(`${TREE[0]} (teclado)`, kb);
      problems.push(...bad);
      console.log(`${bad.length ? "FALHOU" : "ok    "} ${TREE[0]} pelo teclado${bad.map((b) => `\n  ${b}`).join("")}`);
      assert.deepEqual(w.report.problems, [], "erros na página");
    } finally {
      await w.close();
    }
    // 3. Reduzir movimento.
    const r = await openWindow(browser, ctx, { ...base, motion: false });
    try {
      await settle(r.page);
      await openTree(r.page);
      for (const label of [TREE[2]!, TOP[0]!]) {
        const run = await hoverRun(r.page, sel(label));
        const bad = reducedProblems(label, run);
        problems.push(...bad);
        console.log(`${bad.length ? "FALHOU" : "ok    "} ${label} com reduzir movimento${bad.map((b) => `\n  ${b}`).join("")}`);
      }
    } finally {
      await r.close();
    }
    // 4. O vídeo, para olhar: o mouse anda devagar pela barra da árvore e para em cada botão.
    if (video) {
      const v = await openWindow(browser, ctx, { ...base, scale: 2, motion: true, video: join(out, "video") });
      try {
        await settle(v.page);
        await openTree(v.page);
        await v.page.waitForTimeout(400);
        const boxes = await Promise.all(TREE.map(async (l) => (await v.page.locator(sel(l)).boundingBox())!));
        const y = boxes[0]!.y + boxes[0]!.height / 2;
        await v.page.mouse.move(boxes[0]!.x - 60, y);
        // De passagem, sem parar: nada abre.
        await v.page.mouse.move(boxes.at(-1)!.x + boxes.at(-1)!.width + 4, y, { steps: 12 });
        await v.page.waitForTimeout(500);
        for (const b of boxes) {
          await v.page.mouse.move(b.x + b.width / 2, y, { steps: 6 });
          await v.page.waitForTimeout(900);
        }
        await v.page.mouse.move(500, 600, { steps: 6 });
        await v.page.waitForTimeout(600);
      } finally {
        await v.close();
      }
      console.log(`vídeo em ${join(out, "video")}`);
    }
  } finally {
    await browser.close();
    cleanup();
  }
  const blocking = process.env.CI ? problems.filter((p) => !p.startsWith(TIMING)) : problems;
  if (blocking.length < problems.length) console.log(`CI: ${problems.length - blocking.length} problema(s) de tempo só no log`);
  console.log(blocking.length ? `${blocking.length} problema(s)` : "tudo ok");
  process.exit(blocking.length ? 1 : 0);
}
