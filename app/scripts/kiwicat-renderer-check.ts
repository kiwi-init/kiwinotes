// O desenho de verdade do gato, por função (T8487; portado para o gato novo na T14885, spec #14813). WebKit headless,
// nada na tela, sem mic; não é medida de CPU (essa é o `kiwicat-v2/peso.ts`), e o "igual ao pacote" é o `gato-igual.ts`.
//
// Confere:
// 1. o WebGL2 desenha os 8 estados de hoje, sem erro, no modo `capture` (o relógio na mão);
// 2. no reduzir movimento, um quadro parado e um quadro novo por troca de estado, nada no meio;
// 3. parado no repouso, o gato desenha no ritmo de repouso (`QUIET_FPS`), não no do navegador;
// 4. escondido, nenhum quadro;
// 5. um contexto WebGL2 por janela: com o gato da página vivo, 40 gatos criados e descartados (mais que o teto de
//    contextos do WebKit) não passam do teto (o aviso "too many active WebGL contexts" não aparece), o gato da página
//    não perde o contexto, e o último ainda desenha em WebGL2;
// 6. o descanso (spec #24228): parado, fora de foco ou em foco sem mouse nem tecla, nenhum quadro; o mouse o acorda,
//    e uma troca de estado anima `REST_WAKE_S` e descansa de novo.
// Da raiz do app: `bun scripts/kiwicat-renderer-check.ts [pasta]`. Sai 1 se algo falha.
import { webkit, type Browser } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { QUIET_FPS, REST_WAKE_S } from "../ui/kiwicat/cat";
import { STATES } from "../ui/kiwicat/visual";
import { serve } from "./kiwicat-v2/servir";

const out = resolve(process.argv[2] ?? "/tmp/kiwi-renderer-check");
mkdirSync(out, { recursive: true });
const server = await serve("gato-funcoes.ts");
const browser = await webkit.launch({ headless: true });
const report: Record<string, unknown> = { scope: "funções do desenho no WebKit headless; não é medida de CPU" };
const failures: string[] = [];
const check = (ok: boolean, what: string) => { if (!ok) failures.push(what); };

async function open(b: Browser, query: string, reduced = false) {
  const context = await b.newContext({ viewport: { width: 240, height: 240 }, deviceScaleFactor: 2, reducedMotion: reduced ? "reduce" : "no-preference" });
  await context.route("**/*", (r) => (new URL(r.request().url()).origin === server.url ? r.continue() : r.abort()));
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`${server.url}/?${query}`);
  await page.waitForFunction(() => (window as any).kiwiReady, null, { timeout: 30000 });
  return { page, errors, close: () => context.close() };
}
const frames = (p: import("playwright-core").Page) => p.evaluate(() => (window as any).kiwiCat.stats.frames as number);

try {
  // 1. Os 8 estados, no relógio na mão: o WebGL2 desenha, a névoa tem pixels, e o gato diz o estado e o emote.
  const states: unknown[] = [];
  for (const state of STATES) {
    const s = await open(browser, `mode=capture&state=${state}`);
    await s.page.evaluate(() => (window as any).kiwiCat.capture(2.5));
    const r = await s.page.evaluate(() => {
      const cat = (window as any).kiwiCat, root = document.getElementById("cat")!;
      const fog = root.querySelector("canvas")!, x = fog.getContext("2d")!, d = x.getImageData(0, 0, fog.width, fog.height).data;
      let lit = 0; for (let i = 3; i < d.length; i += 4) if (d[i]! > 32) lit++;
      return { backend: cat.fogStats.backend, lit, estado: root.dataset.estado, emote: root.dataset.emote };
    });
    await s.page.screenshot({ path: join(out, `${state}.png`) });
    states.push({ state, ...r, errors: s.errors });
    check(r.backend === "webgl2", `${state}: backend ${r.backend}`);
    check(r.lit > 1000, `${state}: névoa sem pixels (${r.lit})`);
    check(!!r.estado && !!r.emote, `${state}: sem data-estado/data-emote`);
    check(s.errors.length === 0, `${state}: ${s.errors.join("; ")}`);
    await s.close();
  }
  report.states = states;

  // 2. Reduzir movimento: um quadro ao abrir, um por troca de estado, e nada parado.
  {
    const s = await open(browser, "state=repouso", true);
    await s.page.waitForTimeout(800);
    const first = await frames(s.page);
    await s.page.evaluate(() => (window as any).kiwiCat.update({ estado: "thinking" }));
    await s.page.waitForTimeout(800);
    const second = await frames(s.page);
    await s.page.waitForTimeout(1500);
    const still = await frames(s.page);
    report.reduced = { first, second, still, errors: s.errors };
    check(first === 1 && second === 2 && still === 2, `reduzido: quadros ${first}/${second}/${still}, esperado 1/2/2`);
    await s.close();
  }

  // 3 e 4. Repouso no ritmo dele; escondido, nenhum quadro.
  {
    const s = await open(browser, "state=repouso");
    await s.page.waitForTimeout(500);
    const a = await frames(s.page);
    await s.page.waitForTimeout(4000);
    const fps = ((await frames(s.page)) - a) / 4;
    await s.page.evaluate(() => (window as any).kiwiCat.visibility(true));
    const hidden = await frames(s.page);
    await s.page.waitForTimeout(1000);
    const hiddenAfter = await frames(s.page);
    report.quiet = { fps, quietFPS: QUIET_FPS, hiddenFrames: hiddenAfter - hidden, errors: s.errors };
    check(fps >= QUIET_FPS * 0.6 && fps <= QUIET_FPS + 2, `repouso a ${fps} fps, esperado perto de ${QUIET_FPS}`);
    check(hiddenAfter === hidden, `escondido desenhou ${hiddenAfter - hidden} quadros`);
    check(s.errors.length === 0, `repouso: ${s.errors.join("; ")}`);
    await s.close();
  }

  // 5. Criar e descartar: o contexto sai no `dispose`, não no GC.
  {
    const s = await open(browser, "mode=capture&state=repouso");
    const r = await s.page.evaluate(async () => {
      const w = window as any;
      const lit = (root: HTMLElement) => {
        const fog = root.querySelector("canvas")!, d = fog.getContext("2d")!.getImageData(0, 0, fog.width, fog.height).data;
        let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]! > 32) n++;
        return n;
      };
      let lost = 0;
      document.querySelector("#cat canvas")?.addEventListener("webglcontextlost", () => lost++);
      for (let i = 0; i < 40; i++) {
        const { cat, el } = await w.kiwiExtra();
        cat.capture(1);
        await cat.dispose(); el.remove();
      }
      const last = await w.kiwiExtra();
      last.cat.capture(1);
      const page = document.getElementById("cat")!;
      w.kiwiCat.capture(3);
      const out = { lastBackend: last.cat.fogStats.backend, lastLit: lit(last.el), pageBackend: w.kiwiCat.fogStats.backend, pageLit: lit(page), lost };
      await last.cat.dispose();
      return out;
    });
    const tooMany = s.errors.filter((e) => /too many active WebGL contexts/i.test(e)).length;
    report.dispose = { ...r, tooMany, errors: s.errors };
    check(tooMany === 0, `descartes: o WebKit avisou ${tooMany}× que passou do teto de contextos`);
    check(r.lastBackend === "webgl2" && r.lastLit > 100, `depois de 40 descartes, o último gato: ${r.lastBackend}, ${r.lastLit} pixels`);
    check(r.pageBackend === "webgl2" && r.pageLit > 1000, `depois de 40 descartes, o gato da página: ${r.pageBackend}, ${r.pageLit} pixels`);
    check(s.errors.length === 0, `descartes: ${s.errors.join("; ")}`);
    await s.close();
  }

  // 6. O descanso: em foco e sem ninguém mexer (aqui depois de 1 s), e fora de foco; o mouse e o foco o acordam.
  {
    const s = await open(browser, "state=repouso&rest=1");
    await s.page.waitForTimeout(1600);
    const idle = await frames(s.page);
    await s.page.waitForTimeout(1500);
    const idleAfter = await frames(s.page);
    await s.page.mouse.move(50, 50); await s.page.mouse.move(80, 90);
    await s.page.waitForTimeout(500);
    const woke = await frames(s.page);
    await s.page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await s.page.waitForTimeout(300);
    const blurred = await frames(s.page);
    await s.page.waitForTimeout(1500);
    const blurredAfter = await frames(s.page);
    await s.page.evaluate(() => (window as any).kiwiCat.update({ estado: "dormindo" }));
    await s.page.waitForTimeout(REST_WAKE_S * 1000 + 800);
    const slept = await frames(s.page);
    await s.page.waitForTimeout(1000);
    const sleptAfter = await frames(s.page);
    await s.page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await s.page.waitForTimeout(500);
    const focused = await frames(s.page);
    const resting = await s.page.evaluate(() => (window as any).kiwiCat.stats.resting as boolean);
    report.rest = { idle: idleAfter - idle, woke: woke - idleAfter, blurred: blurredAfter - blurred, slept: slept - blurredAfter, sleptRest: sleptAfter - slept, focused: focused - sleptAfter, resting, errors: s.errors };
    check(idleAfter === idle, `em foco e parado, desenhou ${idleAfter - idle} quadros no descanso`);
    check(woke - idleAfter >= 3, `o mouse não acordou o gato (${woke - idleAfter} quadros)`);
    check(blurredAfter === blurred, `fora de foco, desenhou ${blurredAfter - blurred} quadros`);
    const wakeFrames = REST_WAKE_S * QUIET_FPS;
    check(slept - blurredAfter >= wakeFrames * 0.5 && slept - blurredAfter <= wakeFrames * 2, `a troca de estado no descanso desenhou ${slept - blurredAfter} quadros, esperado perto de ${wakeFrames}`);
    check(sleptAfter === slept, `depois da troca, o descanso voltou e desenhou ${sleptAfter - slept} quadros`);
    check(focused - sleptAfter >= 3 && !resting, `o foco não acordou o gato (${focused - sleptAfter} quadros)`);
    check(s.errors.length === 0, `descanso: ${s.errors.join("; ")}`);
    await s.close();
  }
} finally {
  await browser.close();
  server.close();
  report.failures = failures;
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
}
console.log(JSON.stringify({ reduced: report.reduced, quiet: report.quiet, dispose: report.dispose, rest: report.rest, failures }));
process.exit(failures.length ? 1 : 0);
