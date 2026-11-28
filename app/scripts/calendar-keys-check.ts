// T34762 (spec #34706, régua 1.1–1.5 e 1.10): o teclado do Calendário no hub de verdade, com o headless e notas
// inventadas, em pt e en, no claro e no escuro. Nunca abre janela, nem liga o mic, nem o agente.
// - J e K, → e ←: o período seguinte e o anterior; T volta a hoje.
// - D, W, M e A trocam a vista; G abre o "ir para uma data", e o Enter vai ao dia.
// - C abre o "+ Novo", e a letra digitada no título é texto, não atalho.
// - ? abre a lista dos atalhos, com o foco nela; o Esc fecha e devolve o foco.
// - As setas na escolha da vista ficam com ela, e com outra aba à vista as teclas não mexem no Calendário.
// Os prints da folha do ? e do "ir para uma data", em cada língua e tema.
// Da raiz do app: `bun scripts/calendar-keys-check.ts [pasta]`. Pegue `kiwi lock bench`.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type Page, webkit } from "playwright-core";
import { request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T34762-teclado"));
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-calendar-keys-"));

async function cli(args: string[]) {
  const p = Bun.spawn([process.execPath, join(app, "scripts/cli.ts"), ...args, "--data", data], { cwd: app, stdout: "pipe", stderr: "pipe" });
  const text = await new Response(p.stdout).text();
  const err = await new Response(p.stderr).text();
  assert.equal(await p.exited, 0, text + err);
  return text;
}
const ctx: UiContext = {
  data,
  send: async (msg) => { const r = await request(data, msg); assert.ok(r); return r; },
  subscribe: async () => () => {},
};
async function invoke(cap: string, args: unknown = {}) {
  const r = await ctx.send({ cmd: "invoke", cap, args });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.value as any;
}

/** A data de hoje mais `n` dias, como `AAAA-MM-DD`, no fuso do Mac. */
const day = (n = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
/** Um dia longe de hoje, para o "ir para uma data": o dia 10 do mês, daqui a 4 meses. */
const far = (() => {
  const d = new Date();
  d.setMonth(d.getMonth() + 4, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-10`;
})();

const pane = '.kn-hub-pane[data-section="calendar"]';
const tab = (p: Page, s: string) => p.locator(`[role="tab"][data-section="${s}"]`);
const title = (p: Page) => p.locator(`${pane} .kn-cal-title`).innerText();
const calView = (p: Page) => p.locator(`${pane} .kn-cal`).getAttribute("data-view");
/** Tira o foco de qualquer campo: a tecla cai no corpo da página, como depois de um clique no vazio. */
const blur = (p: Page) => p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
/** O título fica igual a `want` (ou diferente de `not`) depois da tecla: espera o React desenhar, sem `sleep`. */
async function titleIs(p: Page, want: { is?: string; not?: string }, what: string) {
  await p
    .waitForFunction(([s, w]) => { const t = document.querySelector(s)?.textContent ?? ""; return w.is !== undefined ? t === w.is : t !== w.not; }, [`${pane} .kn-cal-title`, want] as const, { timeout: 3000 })
    .catch(async () => assert.fail(`${what}: o título ficou "${await title(p)}"`));
}

const browser = await webkit.launch({ headless: true });
const checks: string[] = [];
try {
  await cli(["start", "--no-helper"]);
  await invoke("notes.create", { folder: "Projeto X", title: "Pendências", content: `# Pendências\n\n- [ ] Revisar o orçamento @ ${day(0)} 10:00\n- [ ] Mandar a proposta à Ana @ ${day(1)} 15:00\n` });
  await invoke("settings.set", { kiwicat: { overlay: false, show: true } });

  for (const lang of ["pt", "en"] as const) {
    await invoke("settings.set", { language: lang });
    for (const theme of ["light", "dark"] as const) {
      const tag = `${lang}/${theme}`;
      const shots = join(out, lang);
      mkdirSync(shots, { recursive: true });
      const w = await openWindow(browser, ctx, { window: "hub", scale: 2, theme, width: 1300, height: 800, motion: false, browser: "webkit", query: { section: "calendar" } });
      const p = w.page;
      try {
        await p.waitForSelector(`${pane}:not([hidden]) .kn-cal[data-view="week"]`);
        await p.waitForSelector(`${pane} .kn-cal-item:has-text("Revisar o orçamento")`);
        await blur(p);
        const start = await title(p);

        // 1. J e K, → e ←, e o T.
        await p.keyboard.press("j");
        await titleIs(p, { not: start }, "J");
        const next = await title(p);
        assert.notEqual(next, start, `${tag}: o J não andou`);
        await p.keyboard.press("k");
        await titleIs(p, { is: start }, "K");
        await p.keyboard.press("ArrowRight");
        await titleIs(p, { is: next }, "→");
        await p.keyboard.press("ArrowLeft");
        await titleIs(p, { is: start }, "←");
        await p.keyboard.press("ArrowLeft");
        await titleIs(p, { not: start }, "← de novo");
        await p.keyboard.press("t");
        await titleIs(p, { is: start }, "T");
        checks.push(`${tag}: J, K, → e ← andam o período, e o T volta a hoje`);

        // 2. D, M, A e W trocam a vista, e o botão da vista marcada segue.
        for (const [k, v] of [["d", "day"], ["m", "month"], ["a", "agenda"], ["w", "week"]] as const) {
          await p.keyboard.press(k);
          await p.waitForSelector(`${pane} .kn-cal[data-view="${v}"]`, { timeout: 3000 });
          assert.equal(await p.locator(`${pane} .kn-cal-views [data-view="${v}"]`).getAttribute("aria-checked"), "true", `${tag}: o botão ${v}`);
          assert.equal(await p.locator(`${pane} .kn-cal-views [data-view="${v}"]`).getAttribute("aria-keyshortcuts"), k.toUpperCase());
        }
        checks.push(`${tag}: D, M, A e W trocam a vista, e cada botão diz a tecla no aria-keyshortcuts`);

        // 3. G: o "ir para uma data" leva o foco ao campo, e o Enter vai ao dia.
        await p.keyboard.press("g");
        const goto = p.locator(`${pane} .kn-cal-goto`);
        await goto.waitFor();
        assert.equal(await p.evaluate(() => (document.activeElement as HTMLInputElement | null)?.name), "goto", `${tag}: o foco no campo da data`);
        await p.locator(`${pane} .kn-cal-goto input`).fill(far);
        await goto.screenshot({ path: join(shots, `ir-para-${theme}.png`) });
        await p.keyboard.press("Enter");
        await goto.waitFor({ state: "detached" });
        await p.waitForSelector(`${pane} .kn-cal-col[data-day="${far}"]`, { timeout: 3000 });
        // O Esc fecha o G sem andar.
        await blur(p);
        await p.keyboard.press("g");
        await goto.waitFor();
        await p.keyboard.press("Escape");
        await goto.waitFor({ state: "detached" });
        await p.waitForSelector(`${pane} .kn-cal-col[data-day="${far}"]`);
        await p.keyboard.press("t");
        await titleIs(p, { is: start }, "T depois do G");
        checks.push(`${tag}: G abre o "ir para uma data" com o foco no campo; o Enter vai a ${far}, e o Esc fecha sem andar`);

        // 4. C abre o "+ Novo"; no título, as letras são texto.
        await p.keyboard.press("c");
        const form = p.locator(`${pane} .kn-cal-newform`);
        await form.waitFor();
        await p.locator(`${pane} .kn-cal-newform input[name="title"]`).focus();
        await p.keyboard.type("Comprar tinta");
        assert.equal(await p.locator(`${pane} .kn-cal-newform input[name="title"]`).inputValue(), "Comprar tinta");
        assert.equal(await calView(p), "week", `${tag}: o "m" e o "a" do título trocaram a vista`);
        assert.equal(await title(p), start, `${tag}: o "t" do título andou o período`);
        await p.keyboard.press("Escape");
        await form.waitFor({ state: "detached" });
        checks.push(`${tag}: C abre o "+ Novo", e "Comprar tinta" no título fica no título (nem vista, nem período)`);

        // 5. ?: a lista dos atalhos, com o foco nela; o Esc fecha e devolve o foco.
        const before = p.locator(`${pane} .kn-cal-tool > .kn-cal-btn:not(.kn-cal-new)`);
        await before.focus();
        await p.keyboard.press("?");
        const help = p.locator(`${pane} .kn-cal-keys`);
        await help.waitFor();
        assert.ok(await help.evaluate((el) => el === document.activeElement), `${tag}: o foco na lista`);
        assert.ok((await help.locator("kbd").count()) >= 12, `${tag}: as teclas na lista`);
        const head = await help.locator("h3").innerText();
        assert.equal(head, lang === "pt" ? "Atalhos do teclado" : "Keyboard shortcuts");
        // Com a lista aberta, as teclas não mexem na vista.
        await p.keyboard.press("m");
        assert.equal(await calView(p), "week", `${tag}: o M com a lista aberta`);
        await help.screenshot({ path: join(shots, `atalhos-${theme}.png`) });
        await p.screenshot({ path: join(shots, `atalhos-tela-${theme}.png`) });
        await p.keyboard.press("Escape");
        await help.waitFor({ state: "detached" });
        assert.ok(await before.evaluate((el) => el === document.activeElement), `${tag}: o foco volta ao Hoje`);
        // O clique fora também fecha.
        await p.keyboard.press("?");
        await help.waitFor();
        await p.locator(`${pane} .kn-cal-title`).click();
        await help.waitFor({ state: "detached" });
        checks.push(`${tag}: ? abre a lista dos atalhos com o foco nela; o Esc e o clique fora fecham, e o foco volta`);

        // 6. As setas na escolha da vista ficam com ela; com outra aba à vista, nada muda no Calendário.
        await p.locator(`${pane} .kn-cal-views [data-view="week"]`).focus();
        await p.keyboard.press("ArrowRight");
        assert.equal(await title(p), start, `${tag}: a seta nas vistas andou o período`);
        await tab(p, "notes").click();
        await p.waitForSelector(`${pane}[hidden]`, { state: "attached" });
        await blur(p);
        for (const k of ["m", "j", "c", "?"]) await p.keyboard.press(k);
        await tab(p, "calendar").click();
        await p.waitForSelector(`${pane}:not([hidden])`);
        assert.equal(await calView(p), "week", `${tag}: o M nas Notas trocou a vista`);
        assert.equal(await title(p), start, `${tag}: o J nas Notas andou o período`);
        assert.equal(await p.locator(`${pane} .kn-cal-newform, ${pane} .kn-cal-keys`).count(), 0, `${tag}: o C ou o ? nas Notas abriu uma folha`);
        checks.push(`${tag}: as setas na escolha da vista ficam com ela, e nas Notas as teclas não mexem no Calendário`);

        assert.deepEqual(w.report.problems, [], "problemas na página");
      } finally {
        await w.close();
      }
    }
  }
  await invoke("settings.set", { language: "pt" });
  for (const c of checks) console.log(`ok  ${c}`);
  console.log(`prints em ${out}`);
} finally {
  await browser.close();
  await cli(["stop"]).catch(() => {});
  rmSync(data, { recursive: true, force: true });
}
