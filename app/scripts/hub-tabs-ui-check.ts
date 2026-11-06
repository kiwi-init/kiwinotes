// T4535 / spec #4521: geometria e cor das abas no build real, com engine headless isolado.
// Pegue kiwi lock bench. Uso: bun scripts/hub-tabs-ui-check.ts [DATA] [OUT] [--before]
// --before mede a regressão antiga sem exigir o contrato novo. Nenhum app abre na tela.
// Sem um headless de pé em DATA, o script sobe o seu (`cli start --no-helper`) e o derruba no fim (issue 224). Sem DATA
// e OUT, os dois ficam em pastas novas do tmp. Roda no CI (ci.yml).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Browser, type Page } from "playwright-core";
import { request } from "./cli.ts";
import { openWindow, type UiContext } from "./ui-page.ts";

const [dataArg, outArg] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const data = resolve(dataArg ?? mkdtempSync(join(tmpdir(), "kn-hub-tabs-")));
const out = resolve(outArg ?? mkdtempSync(join(tmpdir(), "kn-hub-tabs-out-")));
const before = process.argv.includes("--before");
mkdirSync(out, { recursive: true });

// O headless de outra pessoa (ou de outro roteiro) fica como está; o nosso cai no fim, passe ou falhe.
const ownHeadless = !(await request(data, { cmd: "status" }, 2000));
const ctx: UiContext = {
  data,
  send: async (msg) => {
    const r = await request(data, msg);
    if (!r) throw new Error(`o headless em ${data} parou no meio do roteiro`);
    return r;
  },
  // O roteiro só muda a aba local, sem gravar notas ou configurações que exijam eventos externos.
  subscribe: async () => () => {},
};
const browser = await webkit.launch();
const metrics: unknown[] = [];
const snapshot = (p: Page) => p.evaluate(() => {
  const pill = document.querySelector<HTMLElement>(".kn-tabs-pill")!;
  const group = document.querySelector<HTMLElement>(".kn-tabs")!;
  const selected = group.querySelector<HTMLElement>('[aria-selected="true"]')!;
  const box = pill.getBoundingClientRect();
  const target = selected.getBoundingClientRect();
  return { x: box.x, w: box.width, targetX: target.x, targetW: target.width,
    selected: selected.dataset.section, opacity: getComputedStyle(pill).opacity };
});
const matchesSelection = (s: Awaited<ReturnType<typeof snapshot>>) => {
  assert.ok(Math.abs(s.x - s.targetX) < 0.6 && Math.abs(s.w - s.targetW) < 0.6, JSON.stringify(s));
  assert.equal(s.opacity, "1");
};
const style = (p: Page, section: string) => p.locator(`.kn-tab[data-section=${section}]`).evaluate((el) => {
  const s = getComputedStyle(el);
  const b = el.getBoundingClientRect();
  return { color: s.color, transform: s.transform, textShadow: s.textShadow,
    background: s.backgroundColor, duration: s.transitionDuration, timing: s.transitionTimingFunction,
    width: b.width, weight: s.fontWeight };
});

// Sobe por último, logo antes do try: um erro antes dele não deixa um headless órfão. O `cli start` deixa o engine
// solto: o Ctrl-C e o timeout do passo do CI (SIGINT, SIGTERM) não passam pelo `finally`, então também derrubam ele.
const cli = resolve(import.meta.dir, "cli.ts");
let running = false;
/** Derruba o nosso headless e apaga a pasta de dados que o roteiro criou no tmp (a de OUT fica: são os prints). */
const cleanup = () => {
  if (running) spawnSync(process.execPath, [cli, "stop", "--data", data], { encoding: "utf8", timeout: 15_000 });
  running = false;
  if (!dataArg && ownHeadless) rmSync(data, { recursive: true, force: true });
};
for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]] as const) {
  process.on(signal, () => {
    cleanup();
    process.exit(code);
  });
}
if (ownHeadless) {
  const up = spawnSync(process.execPath, [cli, "start", "--data", data, "--no-helper"], { encoding: "utf8" });
  running = up.status === 0;
  if (!running) throw new Error(`o headless não subiu em ${data}:\n${up.stdout}${up.stderr}`);
}
try {
  for (const theme of ["light", "dark"] as const) {
    const videoDir = resolve(out, theme);
    const recording = new Proxy(browser, {
      get(target, prop) {
        if (prop === "newContext") return (opts: any) => target.newContext({ ...opts, recordVideo: { dir: videoDir, size: { width: 1000, height: 640 } } });
        const value = Reflect.get(target, prop);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as Browser;
    const w = await openWindow(recording, ctx, {
      window: "hub", scale: 1, theme, width: 1000, height: 640,
      browser: "webkit", motion: true, query: { section: "notes" },
    });
    const p = w.page;
    // Marcadores só na gravação headless, para tornar o hover visível no vídeo.
    await p.evaluate(() => {
      const label = document.createElement("div");
      label.textContent = "Kiwi Notes · hover só no texto; clique troca a seleção";
      label.style.cssText = "position:fixed;top:68px;left:0;width:100%;text-align:center;font:12px system-ui;color:var(--ink-2);pointer-events:none;z-index:9999";
      document.body.append(label);
      const cursor = document.createElement("div");
      cursor.style.cssText = "position:fixed;width:10px;height:10px;border:2px solid #72a0ff;border-radius:50%;pointer-events:none;z-index:9999";
      document.body.append(cursor);
      document.addEventListener("mousemove", (e) => {
        cursor.style.left = `${e.clientX + 10}px`;
        cursor.style.top = `${e.clientY + 8}px`;
      });
    });
    const video = p.video()!;
    try {
      await p.mouse.move(970, 140);
      await p.waitForTimeout(700);
      const start = await snapshot(p);
      matchesSelection(start);
      const rest = await style(p, "about");
      await p.locator('.kn-tab[data-section=about]').hover();
      await p.waitForTimeout(650);
      const hovered = await snapshot(p);
      const hoverStyle = await style(p, "about");
      metrics.push({ theme, start, hovered, rest, hoverStyle });
      if (!before) {
        matchesSelection(hovered);
        assert.equal(hovered.selected, "notes");
        assert.equal(hovered.x, start.x);
        assert.equal(hovered.w, start.w);
        assert.notEqual(hoverStyle.color, rest.color);
        assert.equal(hoverStyle.transform, "none");
        assert.equal(hoverStyle.textShadow, "none");
        assert.equal(hoverStyle.background, rest.background);
        assert.equal(hoverStyle.width, rest.width);
        assert.equal(hoverStyle.weight, rest.weight);
        assert.equal(hoverStyle.duration, "0.16s");
        assert.equal(hoverStyle.timing, "ease");
      }
      // Hover rápido por toda a faixa: nunca muda a seleção nem sua geometria.
      for (const section of ["settings", "dictation", "meetings", "about"]) {
        await p.locator(`.kn-tab[data-section=${section}]`).hover();
        await p.waitForTimeout(90);
        if (!before) matchesSelection(await snapshot(p));
      }
      await p.mouse.move(970, 140);
      await p.waitForTimeout(650);
      if (!before) matchesSelection(await snapshot(p));
      // Um clique com animação: o destino e a curva são os tokens do Channels instalado.
      await p.locator('.kn-tab[data-section=about]').click();
      await p.mouse.move(970, 140);
      await p.waitForTimeout(650);
      if (!before) {
        const clicked = await snapshot(p);
        assert.equal(clicked.selected, "about");
        matchesSelection(clicked);
        const transition = await p.locator('.kn-tabs-pill').evaluate((el) => {
          const s = getComputedStyle(el);
          return { duration: s.transitionDuration, property: s.transitionProperty };
        });
        assert.equal(transition.duration, "0.48s, 0.48s");
        assert.equal(transition.property, "transform, width");
      }
      await p.screenshot({ path: resolve(out, `abas-${theme}.png`) });
      // Mouse em outra aba não pode vencer o teclado; foco visível continua presente.
      await p.locator('.kn-tab[data-section=notes]').hover();
      await p.keyboard.press("ArrowLeft");
      await p.waitForTimeout(650);
      if (!before) {
        const keyed = await snapshot(p);
        assert.equal(keyed.selected, "settings");
        matchesSelection(keyed);
        assert.equal(await p.locator('.kn-tab[data-section=settings]').evaluate((el) => document.activeElement === el), true);
        assert.equal(await p.locator('.kn-tab[data-section=settings]').evaluate((el) => el.matches(":focus-visible")), true);
      }
      // Preferência do sistema e depois dos Ajustes: ambos desligam a animação.
      for (const mode of ["system", "settings"] as const) {
        if (mode === "system") await p.emulateMedia({ reducedMotion: "reduce" });
        else {
          await p.emulateMedia({ reducedMotion: "no-preference" });
          await p.evaluate(() => document.documentElement.dataset.motion = "reduced");
        }
        await p.locator('.kn-tab[data-section=notes]').click();
        await p.locator('.kn-tab[data-section=about]').click();
        if (!before) {
          matchesSelection(await snapshot(p));
          assert.equal(await p.locator('.kn-tabs-pill').evaluate((el) => getComputedStyle(el).transitionDuration), "0s");
        }
      }
      // Resize da faixa reposiciona a seleção sem animação de hover residual.
      await p.setViewportSize({ width: 860, height: 640 });
      await p.waitForTimeout(100);
      if (!before) matchesSelection(await snapshot(p));
      assert.deepEqual(w.report.problems, []);
      assert.deepEqual(w.report.blocked, []);
      assert.deepEqual(w.report.invokeErrors, []);
      console.log(`ok ${theme}: hover, varredura, clique, teclado, redução (sistema/ajuste), resize`);
    } finally {
      await w.close();
      await video.saveAs(resolve(out, `abas-${theme}.webm`));
    }
  }
} finally {
  writeFileSync(resolve(out, "metrics.json"), JSON.stringify(metrics, null, 2));
  await browser.close();
  cleanup();
}
console.log(`prints e vídeos em ${out}`);
