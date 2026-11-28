// T4535 / spec #4521: geometria e cor das abas no build real, com engine headless isolado. A janela estreita (#496,
// T34348): os botões das Notas fora das abas, a 640 e a 480 px, e o Ditado a 480 px em pt e en (#34567).
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
const settled = (p: Page) => p.evaluate(async () => {
  const finite = (a: Animation) => {
    const end = a.effect?.getComputedTiming().endTime;
    return typeof end === "number" && Number.isFinite(end);
  };
  const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
  const deadline = performance.now() + 5000;
  await document.fonts.ready;
  for (;;) {
    await frame();
    await frame();
    const running = document.getAnimations().filter((a) => finite(a) && a.playState !== "finished");
    if (!running.length) return;
    if (performance.now() > deadline) throw new Error(`a janela não parou de animar: ${running.length} animações`);
    await Promise.all(running.map((a) => a.finished.catch(() => {
      // Uma animação cancelada (a seleção mudou no meio) também acabou; a volta do laço olha as que sobraram.
    })));
  }
});
/** A barra numa janela estreita (#496): as abas, os botões de cada lado e a aba escolhida dentro da faixa. */
const narrowBar = (p: Page) => p.evaluate(() => {
  const box = (e: Element) => {
    const b = e.getBoundingClientRect();
    return { left: b.left, right: b.right };
  };
  const tabs = document.querySelector(".kn-tabs")!;
  const track = document.querySelector<HTMLElement>(".kn-tabs-track")!;
  const selected = track.querySelector<HTMLElement>('[aria-selected="true"]')!;
  const t = box(track);
  const s = box(selected);
  // A escolhida, inteira, longe do esmaecido de uma borda que esconde abas (24 px, ou o `--tabs-fade` da faixa curta).
  const clip = track.dataset.clip;
  const fade = parseFloat(track.style.getPropertyValue("--tabs-fade")) || 24;
  const fadeStart = clip?.includes("start") ? fade : 0;
  const fadeEnd = clip?.includes("end") ? fade : 0;
  return {
    tabs: box(tabs),
    start: Array.from(document.querySelectorAll(".kn-hub-start > *")).map(box),
    end: Array.from(document.querySelectorAll(".kn-hub-end > *")).map(box),
    selected: selected.dataset.section, clip, scrollLeft: track.scrollLeft,
    shown: s.left >= t.left + fadeStart - 0.5 && s.right <= t.right - fadeEnd + 0.5,
    ghosts: document.querySelectorAll(".kn-goo-ghost").length,
  };
});
/**
 * O Ditado a 480 px (#34567): os botões da direita são os mais largos, e a faixa fica com ~100 px. Escolhido sem a
 * rolagem do Playwright, com a faixa rolada até o fim (como pela roda) e até o começo, ele fica inteiro fora do
 * esmaecido. Volta para as Notas no fim.
 */
async function narrowDictation(p: Page, label: string) {
  await p.setViewportSize({ width: 480, height: 480 });
  for (const to of ["end", "start"] as const) {
    await p.locator('.kn-tab[data-section=notes]').evaluate((el: HTMLElement) => el.click());
    await settled(p);
    await p.locator(".kn-tabs-track").evaluate((t: HTMLElement, end) => (t.scrollLeft = end ? t.scrollWidth : 0), to === "end");
    await p.locator('.kn-tab[data-section=dictation]').evaluate((el: HTMLElement) => el.click());
    await p.mouse.move(240, 300);
    await settled(p);
    const bar = await narrowBar(p);
    assert.equal(bar.selected, "dictation", JSON.stringify(bar));
    for (const b of [...bar.start, ...bar.end]) {
      assert.ok(b.right <= bar.tabs.left + 0.5 || b.left >= bar.tabs.right - 0.5, `${label}: no Ditado a 480 px, um botão por cima das abas: ${JSON.stringify(bar)}`);
    }
    assert.ok(bar.shown, `${label}: o Ditado a 480 px (faixa rolada até o ${to === "end" ? "fim" : "começo"}) inteiro fora do esmaecido: ${JSON.stringify(bar)}`);
    assert.equal(bar.ghosts, 0);
    matchesSelection(await snapshot(p));
    await p.screenshot({ path: resolve(out, `ditado-480-${label.replace(/ /g, "-")}-${to}.png`), clip: { x: 0, y: 0, width: 480, height: 60 } });
  }
  await p.locator('.kn-tab[data-section=notes]').evaluate((el: HTMLElement) => el.click());
  await settled(p);
}
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
/**
 * Derruba o nosso headless e apaga o que o roteiro criou no tmp, também quando ele falha (spec #10077): a pasta de
 * dados e a dos prints. Os prints ficam quando a pessoa deu a pasta deles, ou com KIWI_KEEP_OUT=1.
 */
const keepOut = !!outArg || process.env.KIWI_KEEP_OUT === "1";
const cleanup = () => {
  if (running) spawnSync(process.execPath, [cli, "stop", "--data", data], { encoding: "utf8", timeout: 15_000 });
  running = false;
  if (!dataArg && ownHeadless) rmSync(data, { recursive: true, force: true });
  if (!keepOut) rmSync(out, { recursive: true, force: true });
};
for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]] as const) {
  process.on(signal, () => {
    cleanup();
    process.exit(code);
  });
}
if (ownHeadless) {
  // Antes de subir: um `start` que estoura o tempo pode ter deixado o engine de pé, e o `cleanup` derruba mesmo assim.
  running = true;
  const up = spawnSync(process.execPath, [cli, "start", "--data", data, "--no-helper"], { encoding: "utf8" });
  if (up.status !== 0) {
    cleanup();
    throw new Error(`o headless não subiu em ${data}:\n${up.stdout}${up.stderr}`);
  }
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
      await settled(p);
      const start = await snapshot(p);
      matchesSelection(start);
      // A última aba é Configurações desde que o Sobre virou um assunto dela (spec #11966).
      const rest = await style(p, "settings");
      await p.locator('.kn-tab[data-section=settings]').hover();
      await settled(p);
      const hovered = await snapshot(p);
      const hoverStyle = await style(p, "settings");
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
      for (const section of ["dictation", "meetings", "settings"]) {
        await p.locator(`.kn-tab[data-section=${section}]`).hover();
        await p.waitForTimeout(90);
        if (!before) matchesSelection(await snapshot(p));
      }
      await p.mouse.move(970, 140);
      await settled(p);
      if (!before) matchesSelection(await snapshot(p));
      // Um clique com animação: o destino e a curva são os tokens do Channels instalado.
      await p.locator('.kn-tab[data-section=settings]').click();
      await p.mouse.move(970, 140);
      await settled(p);
      if (!before) {
        const clicked = await snapshot(p);
        assert.equal(clicked.selected, "settings");
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
      await settled(p);
      if (!before) {
        const keyed = await snapshot(p);
        assert.equal(keyed.selected, "calendar");
        matchesSelection(keyed);
        assert.equal(await p.locator('.kn-tab[data-section=calendar]').evaluate((el) => document.activeElement === el), true);
        assert.equal(await p.locator('.kn-tab[data-section=calendar]').evaluate((el) => el.matches(":focus-visible")), true);
      }
      // Preferência do sistema e depois dos Ajustes: ambos desligam a animação.
      for (const mode of ["system", "settings"] as const) {
        if (mode === "system") await p.emulateMedia({ reducedMotion: "reduce" });
        else {
          await p.emulateMedia({ reducedMotion: "no-preference" });
          await p.evaluate(() => document.documentElement.dataset.motion = "reduced");
        }
        await p.locator('.kn-tab[data-section=notes]').click();
        await p.locator('.kn-tab[data-section=settings]').click();
        if (!before) {
          matchesSelection(await snapshot(p));
          assert.equal(await p.locator('.kn-tabs-pill').evaluate((el) => getComputedStyle(el).transitionDuration), "0s");
        }
      }
      // Resize da faixa reposiciona a seleção sem animação de hover residual.
      await p.setViewportSize({ width: 860, height: 640 });
      await settled(p);
      if (!before) matchesSelection(await snapshot(p));
      // A janela estreita (#496, T34348): os botões das Notas nunca ficam por cima das abas. A reprodução da issue
      // (Notas › Ajustes › Notas › Calendário › Notas › Ditado › Notas, sem esperar, e parado nas Notas) a 640 px, e
      // a 480 px. As abas que não cabem rolam dentro da pílula, e a escolhida fica inteira à vista, fora do esmaecido.
      await p.evaluate(() => delete document.documentElement.dataset.motion);
      await p.emulateMedia({ reducedMotion: "no-preference" });
      for (const width of [640, 480]) {
        await p.setViewportSize({ width, height: 480 });
        for (const section of ["notes", "settings", "notes", "calendar", "notes", "dictation", "notes"]) {
          await p.locator(`.kn-tab[data-section=${section}]`).click();
        }
        await p.mouse.move(width / 2, 300);
        await settled(p);
        const bar = await narrowBar(p);
        if (!before) {
          assert.equal(bar.selected, "notes", JSON.stringify(bar));
          assert.ok(bar.start.length > 0 && bar.end.length > 0, `os botões das Notas na barra: ${JSON.stringify(bar)}`);
          for (const b of [...bar.start, ...bar.end]) {
            assert.ok(b.right <= bar.tabs.left + 0.5 || b.left >= bar.tabs.right - 0.5, `a ${width} px, um botão das Notas por cima das abas: ${JSON.stringify(bar)}`);
          }
          assert.ok(bar.tabs.left >= 0 && bar.tabs.right <= width + 0.5, `as abas dentro da janela: ${JSON.stringify(bar)}`);
          assert.ok(bar.clip !== undefined, `a ${width} px as abas não cabem e a faixa rola: ${JSON.stringify(bar)}`);
          assert.ok(bar.shown, `a aba escolhida inteira à vista, fora do esmaecido: ${JSON.stringify(bar)}`);
          assert.equal(bar.ghosts, 0);
          matchesSelection(await snapshot(p));
        }
        await p.screenshot({ path: resolve(out, `abas-${width}-${theme}.png`), clip: { x: 0, y: 0, width, height: 60 } });
        // A última aba, escondida no fim, escolhida sem rolar a página até ela (como o "Abrir Ajustes" de outra seção):
        // a faixa a traz para dentro. O `click()` do Playwright rolaria sozinho e esconderia a falta (mutação M2).
        await p.locator('.kn-tab[data-section=settings]').evaluate((el: HTMLElement) => el.click());
        await p.mouse.move(width / 2, 300);
        await settled(p);
        const last = await narrowBar(p);
        if (!before) {
          assert.equal(last.selected, "settings");
          assert.ok(last.shown, `a ${width} px, Configurações à vista depois do clique: ${JSON.stringify(last)}`);
          matchesSelection(await snapshot(p));
        }
      }
      if (!before) await narrowDictation(p, `pt ${theme}`);
      // De volta à janela larga: cabe tudo, a faixa não rola nem esmaece.
      await p.setViewportSize({ width: 1000, height: 640 });
      await settled(p);
      if (!before) {
        const wide = await narrowBar(p);
        assert.equal(wide.clip, undefined, JSON.stringify(wide));
        assert.equal(wide.scrollLeft, 0);
        matchesSelection(await snapshot(p));
      }
      assert.deepEqual(w.report.problems, []);
      assert.deepEqual(w.report.blocked, []);
      assert.deepEqual(w.report.invokeErrors, []);
      console.log(`ok ${theme}: hover, varredura, clique, teclado, redução (sistema/ajuste), resize, janela estreita (640 e 480 px, e o Ditado a 480)`);
    } finally {
      await w.close();
      await video.saveAs(resolve(out, `abas-${theme}.webm`));
    }
  }
  // O Ditado a 480 px também em inglês (#34567): os rótulos têm outra largura. Um headless só dele, em `en`, num tmp
  // próprio, derrubado e apagado no fim, passe ou falhe.
  if (!before) {
    const enData = mkdtempSync(join(tmpdir(), "kn-hub-tabs-en-"));
    writeFileSync(join(enData, "settings.json"), JSON.stringify({ version: 1, firstRun: "done", language: "en" }));
    const enEnv = { ...process.env, KIWI_FAKE_AGENT: "1", KIWI_SYSTEM_LANG: "en-US", KIWI_LANGUAGE_CHOICE: "1" };
    try {
      const up = spawnSync(process.execPath, [cli, "start", "--data", enData, "--no-helper"], { encoding: "utf8", env: enEnv });
      if (up.status !== 0) throw new Error(`o headless em inglês não subiu:\n${up.stdout}${up.stderr}`);
      const enCtx: UiContext = { ...ctx, data: enData, send: async (msg) => {
        const r = await request(enData, msg);
        if (!r) throw new Error(`o headless em ${enData} parou no meio do roteiro`);
        return r;
      } };
      const w = await openWindow(browser, enCtx, { window: "hub", scale: 1, theme: "light", width: 1000, height: 640, browser: "webkit", motion: true, query: { section: "notes" } });
      try {
        const p = w.page;
        await p.waitForSelector(".kn-hub-end > *", { timeout: 8000 });
        assert.equal(await p.locator('.kn-tab[data-section=dictation]').innerText(), "Dictation");
        await narrowDictation(p, "en");
        assert.deepEqual(w.report.problems, []);
        console.log("ok en: o Ditado a 480 px");
      } finally {
        await w.close();
      }
    } finally {
      spawnSync(process.execPath, [cli, "stop", "--data", enData], { encoding: "utf8", timeout: 15_000 });
      rmSync(enData, { recursive: true, force: true });
    }
  }
} finally {
  writeFileSync(resolve(out, "metrics.json"), JSON.stringify(metrics, null, 2));
  await browser.close();
  cleanup();
}
console.log(keepOut ? `prints e vídeos em ${out}` : "prints e vídeos apagados (para guardar: KIWI_KEEP_OUT=1, ou a pasta como 2º argumento)");
