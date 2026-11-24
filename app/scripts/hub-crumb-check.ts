// T26097 (harry #26087): nas Notas do hub, o caminho que encolhe não deixa rastro. A gota da barra (`Goo.tsx`) fica
// desenhada atrás dos botões das Notas, no tamanho deles; ao trocar de uma pasta de caminho longo para uma de caminho
// curto, ela tem que encolher junto, senão o fundo dela sobra à direita, na largura de antes.
// Pegue kiwi lock bench. Uso: bun scripts/hub-crumb-check.ts [OUT]
//
// Para cada tema:
// - Encolher (o print do harry): com uma nota de `Projeto X/Rascunhos/Longo` aberta, as Notas entram (Ajustes → Notas,
//   a gota nasce no tamanho longo); o ⌘K troca para uma nota de `Ideias`. A faixa à direita do caminho, da borda nova
//   até a antiga (antes das abas), com e sem a camada da gota (`.kn-goo`): sem rastro, as duas são iguais.
// - Crescer: a gota nasce no tamanho curto e o caminho cresce. A linha de cima, por dentro do botão, tem um tom só:
//   a gota velha, mais curta, aparecia como um degrau no meio do botão.
// Os prints ficam em OUT.
// Sem um headless de pé, sobe o seu (`cli start --no-helper`) e o derruba no fim, passe ou falhe.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Browser, type Page } from "playwright-core";

import { request } from "./cli.ts";
import { openWindow, settle, type UiContext } from "./ui-page.ts";

const [outArg] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const out = resolve(outArg ?? mkdtempSync(join(tmpdir(), "kn-hub-crumb-out-")));
const data = mkdtempSync(join(tmpdir(), "kn-hub-crumb-"));
mkdirSync(out, { recursive: true });

/** Um pixel do rastro: um canal com mais que isto de diferença entre a faixa com a gota e sem ela. */
const TRAIL_DIFF = 24;
const LONG = "Projeto X/Rascunhos/Longo";
const SHORT = "Ideias";

const ctx: UiContext = {
  data,
  send: async (msg) => {
    const r = await request(data, msg);
    if (!r) throw new Error(`o headless em ${data} parou no meio do roteiro`);
    return r;
  },
  subscribe: async () => () => {},
};
const invoke = async (cap: string, args: unknown) => {
  const r = await ctx.send({ cmd: "invoke", cap, args });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.value;
};

type Box = { x: number; y: number; w: number; h: number };
type Crumb = Box & { tabs: number };

/** Todas as animações finitas no fim (a entrada do hub, a gota). */
const ready = async (p: Page) => {
  await settle(p);
  await p.evaluate(() => Promise.all(document.getAnimations()
    .filter((a) => Number.isFinite(Number(a.effect?.getComputedTiming().endTime)))
    .map((a) => a.finished)));
  await settle(p);
};
const crumb = (p: Page) => p.evaluate(() => {
  const b = document.querySelector<HTMLElement>(".kn-crumb-bt")!.getBoundingClientRect();
  return { x: b.x, y: b.y, w: b.width, h: b.height, tabs: document.querySelector<HTMLElement>(".kn-tabs")!.getBoundingClientRect().x };
});
/** As Notas entram de novo (Ajustes → Notas): a gota nasce no tamanho do caminho de agora. */
const reenter = async (p: Page) => {
  await p.locator('.kn-tab[data-section="settings"]').click();
  await p.waitForFunction(() => document.querySelector<HTMLElement>(".kn-goo")?.dataset.start === "hidden", null, { timeout: 5000 });
  await p.locator('.kn-tab[data-section="notes"]').click();
  await p.waitForFunction(() => document.querySelector<HTMLElement>(".kn-goo")?.dataset.start === "shown", null, { timeout: 5000 });
  await ready(p);
};
/** Abre a nota pelo ⌘K e espera o caminho mostrar a pasta dela. */
const open = async (p: Page, title: string, folder: string) => {
  await p.keyboard.press("Meta+k");
  await p.keyboard.type(title);
  await p.waitForTimeout(150);
  await p.keyboard.press("Enter");
  const label = folder.replace(/\//g, " / ");
  await p.waitForFunction((l) => document.querySelector(".kn-crumb-label")?.textContent === l, label, { timeout: 5000 });
  await ready(p);
};

/** Quantos pixels da faixa mudam sem a gota: o rastro dela fora do botão. */
async function trail(p: Page, lab: Page, strip: Box, file: string): Promise<number> {
  const clip = { x: Math.round(strip.x), y: Math.round(strip.y), width: Math.max(1, Math.round(strip.w)), height: Math.round(strip.h) };
  const withGoo = await p.screenshot({ clip });
  await p.evaluate(() => (document.querySelector<HTMLElement>(".kn-goo")!.style.visibility = "hidden"));
  const without = await p.screenshot({ clip });
  await p.evaluate(() => (document.querySelector<HTMLElement>(".kn-goo")!.style.visibility = ""));
  writeFileSync(file, withGoo);
  return lab.evaluate(async ({ a, b, limit }) => {
    const load = async (src: string) => {
      const img = new Image();
      img.src = `data:image/png;base64,${src}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d")!;
      g.drawImage(img, 0, 0);
      return g.getImageData(0, 0, c.width, c.height).data;
    };
    const [x, y] = await Promise.all([load(a), load(b)]);
    let n = 0;
    for (let i = 0; i < x.length; i += 4) {
      if (Math.abs(x[i]! - y[i]!) > limit || Math.abs(x[i + 1]! - y[i + 1]!) > limit || Math.abs(x[i + 2]! - y[i + 2]!) > limit) n++;
    }
    return n;
  }, { a: withGoo.toString("base64"), b: without.toString("base64"), limit: TRAIL_DIFF });
}

/** O maior degrau na linha de cima do botão (3 px abaixo da borda, sem o texto e sem os cantos): um tom só, perto de 0. */
async function seam(p: Page, lab: Page, c: Box, file: string): Promise<number> {
  const clip = { x: Math.round(c.x + 14), y: Math.round(c.y + 3), width: Math.round(c.w - 28), height: 1 };
  const png = await p.screenshot({ clip });
  writeFileSync(file, png);
  return lab.evaluate(async (src) => {
    const img = new Image();
    img.src = `data:image/png;base64,${src}`;
    await img.decode();
    const cv = document.createElement("canvas");
    cv.width = img.width;
    cv.height = img.height;
    const g = cv.getContext("2d")!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, cv.width, cv.height).data;
    let lo = 255;
    let hi = 0;
    for (let i = 0; i < d.length; i += 4) {
      const v = (d[i]! + d[i + 1]! + d[i + 2]!) / 3;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    return Math.round(hi - lo);
  }, png.toString("base64"));
}
/** O degrau que passa: o anti-aliasing da linha, longe do degrau da gota velha (~10 no escuro). */
const SEAM_MAX = 4;

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
const browser: Browser = await webkit.launch();
const lab = await browser.newPage();
const report: { theme: string; long: Crumb; short: Crumb; shrink: number; grow: number }[] = [];
let failed = false;
try {
  await invoke("notes.create", { folder: LONG, title: "Plano", content: "# Plano\n\nUm rascunho.\n" });
  await invoke("notes.create", { folder: SHORT, title: "Lista", content: "# Lista\n\nUma ideia.\n" });
  for (const theme of ["dark", "light"] as const) {
    const w = await openWindow(browser, ctx, { window: "hub", width: 1000, height: 640, browser: "webkit", scale: 2, theme, motion: true, query: { section: "notes" } });
    try {
      const p = w.page;
      await p.waitForSelector(".kn-crumb-bt", { timeout: 8000 });
      await ready(p);
      // Encolher: a gota nasce longa.
      await open(p, "Plano", LONG);
      await reenter(p);
      const long = await crumb(p);
      await p.screenshot({ path: join(out, `${theme}-1-longo.png`), clip: { x: 0, y: 0, width: 520, height: 56 } });
      await open(p, "Lista", SHORT);
      const short = await crumb(p);
      assert.ok(long.w - short.w > 60, `o caminho não encolheu: ${JSON.stringify({ long, short })}`);
      await p.screenshot({ path: join(out, `${theme}-2-curto.png`), clip: { x: 0, y: 0, width: 520, height: 56 } });
      // Da borda nova (+3 px: o anel e a sombra do próprio botão ficam nos dois prints) até a antiga, antes das abas
      // (a gota tem uma base embaixo delas também).
      const from = short.x + short.w + 3;
      const strip = { x: from, y: long.y - 2, w: Math.min(long.x + long.w + 6, long.tabs - 4) - from, h: long.h + 4 };
      const shrink = await trail(p, lab, strip, join(out, `${theme}-faixa-curto.png`));
      // Crescer: a gota nasce curta, e o caminho cresce.
      await reenter(p);
      await open(p, "Plano", LONG);
      const grown = await crumb(p);
      await p.screenshot({ path: join(out, `${theme}-3-cresceu.png`), clip: { x: 0, y: 0, width: 520, height: 56 } });
      const grow = await seam(p, lab, grown, join(out, `${theme}-linha-cresceu.png`));
      report.push({ theme, long, short, shrink, grow });
      if (shrink > 0 || grow > SEAM_MAX) failed = true;
    } finally {
      await w.close();
    }
  }
} finally {
  await browser.close().catch(() => {});
  cleanup();
}
console.log(JSON.stringify({ ok: !failed, out, report }, null, 2));
assert.ok(!failed, `a gota não acompanhou o caminho: shrink (pixels do rastro) > 0 ou grow (degrau) > ${SEAM_MAX}`);
