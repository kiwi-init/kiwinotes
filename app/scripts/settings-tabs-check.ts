// As abas internas dos Ajustes (spec #31754, T31770): cada assunto com a barra de abas, só a aba aberta à vista, o
// `?topic=…&tab=…`, a última aba por assunto (o localStorage), ← e → nas abas e ↑/↓ ainda na lista. No hub de verdade,
// com o AppEngine headless, num WebKit headless. Nada na tela de ninguém.
//
//   bun scripts/settings-tabs-check.ts [pasta]
//
// Sai na pasta: um print de cada assunto com mais de uma aba (`abas-<assunto>.png`).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Page } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";
import { translate } from "../src/shared/i18n/index.ts";
import { lastTabKey, SHOWN_TOPICS, TOPIC_TABS, type SettingsTopic } from "../ui/settings/topics";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T31770-tabs"));
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-tabs-"));
async function cli(args: string[]) {
  const p = Bun.spawn([process.execPath, join(app, "scripts/cli.ts"), ...args, "--data", data], { cwd: app, stdout: "pipe", stderr: "pipe" });
  const text = await new Response(p.stdout).text();
  assert.equal(await p.exited, 0, text + (await new Response(p.stderr).text()));
}
const ctx: UiContext = {
  data,
  send: async (msg) => {
    const r = await request(data, msg);
    assert.ok(r);
    return r;
  },
  subscribe: async (topics, onMsg) => {
    const c = await connect(data, (line) => {
      if (!("id" in line)) onMsg(line);
    });
    assert.ok(c);
    c.write({ id: 0, cmd: "subscribe", topics, follow: true, backlog: false });
    return () => c.close();
  },
};

const panel = (t: SettingsTopic) => `.kn-prefs-topic[data-topic=${t}]`;
/** As abas do assunto à vista: o id da selecionada e os ids dos painéis à vista (só um). */
async function state(p: Page, t: SettingsTopic) {
  return p.evaluate((sel) => {
    const root = document.querySelector(sel)!;
    const selected = [...root.querySelectorAll<HTMLElement>(".kn-prefs-tab[aria-selected=true]")].map((e) => e.dataset.tab);
    const visible = [...root.querySelectorAll<HTMLElement>(".kn-prefs-tabpanel")].filter((e) => !e.hidden).map((e) => e.dataset.tab);
    const focused = (document.activeElement as HTMLElement | null)?.dataset.tab ?? null;
    return { selected, visible, focused };
  }, panel(t));
}
async function expectTab(p: Page, t: SettingsTopic, id: string) {
  await p.waitForSelector(`${panel(t)}:not([hidden]) .kn-prefs-tab[data-tab=${id}][aria-selected=true]`, { timeout: 15000 });
  const s = await state(p, t);
  assert.deepEqual(s.selected, [id], `${t}: só a aba ${id} selecionada`);
  assert.deepEqual(s.visible, [id], `${t}: só o painel da aba ${id} à vista`);
}

const checks: string[] = [];
const problems: string[] = [];
await cli(["start", "--no-helper"]);
const browser = await webkit.launch({ headless: true });
try {
  // 1. Cada assunto tem a barra, com os nomes do catálogo, e abre na primeira aba (sem nada guardado).
  {
    const w = await openWindow(browser, ctx, { window: "hub", scale: 2, theme: "light", width: 1100, height: 720, motion: false, browser: "webkit", query: { section: "settings", topic: "appearance" } });
    const p = w.page;
    await p.evaluate(() => localStorage.clear());
    for (const t of SHOWN_TOPICS) {
      await p.locator(`.kn-prefs-item[data-topic=${t}]`).click();
      await p.waitForSelector(`${panel(t)}:not([hidden])`, { timeout: 15000 });
      const names = await p.locator(`${panel(t)} .kn-prefs-tab`).allTextContents();
      assert.deepEqual(names, TOPIC_TABS[t].map((x) => translate("pt", x.label)), `${t}: os nomes das abas`);
      assert.equal(await p.locator(`${panel(t)} [role=tablist]`).count(), 1, `${t}: uma barra de abas`);
      await expectTab(p, t, TOPIC_TABS[t][0]!.id);
      if (TOPIC_TABS[t].length > 1) {
        await p.locator(`${panel(t)} .kn-prefs-tab[data-tab=${TOPIC_TABS[t][1]!.id}]`).click();
        await expectTab(p, t, TOPIC_TABS[t][1]!.id);
        await Bun.sleep(150);
        await p.screenshot({ path: join(out, `abas-${t}.png`) });
      }
    }
    checks.push(`every shown topic (${SHOWN_TOPICS.length}) has one tab bar with the catalog names, opens on its first tab, and a click shows only that tab's panel`);

    // 2. A última aba fica por assunto no localStorage.
    assert.equal(await p.evaluate((k) => localStorage.getItem(k), lastTabKey("dictation")), "transcription");
    assert.equal(await p.evaluate((k) => localStorage.getItem(k), lastTabKey("notes")), "shortcuts");
    await p.locator(".kn-prefs-item[data-topic=dictation]").click();
    await expectTab(p, "dictation", "transcription");
    checks.push("the last tab is kept per topic (localStorage kn-settings-tab:<topic>) and coming back to a topic shows it");

    // 3. ← e → nas abas: andam, abrem e param nas pontas; ↑ e ↓ ainda andam pela lista.
    await p.locator(`${panel("dictation")} .kn-prefs-tab[data-tab=transcription]`).focus();
    await p.keyboard.press("ArrowRight");
    await expectTab(p, "dictation", "dictionary");
    assert.equal((await state(p, "dictation")).focused, "dictionary", "o foco vai junto");
    await p.keyboard.press("ArrowRight");
    await p.keyboard.press("ArrowRight");
    await expectTab(p, "dictation", "snippets");
    for (let i = 0; i < 5; i++) await p.keyboard.press("ArrowLeft");
    await expectTab(p, "dictation", "shortcuts");
    await p.keyboard.press("ArrowDown");
    await expectTab(p, "dictation", "shortcuts");
    await p.locator(".kn-prefs-item[data-topic=dictation]").focus();
    await p.keyboard.press("ArrowDown");
    assert.equal(await p.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.topic), "notes", "↓ na lista anda pelos assuntos");
    checks.push("← and → move between tabs (and open them, focus follows), stopping at both ends; ↓ on the tabs does nothing, ↑/↓ on the list still move topics");
    problems.push(...w.report.problems);
    await w.close();
  }

  // 4. O link `?topic=…&tab=…` abre direto na aba; um `tab` que não é do assunto cai na última aberta.
  {
    const w = await openWindow(browser, ctx, { window: "hub", scale: 1, theme: "dark", width: 1100, height: 720, motion: false, browser: "webkit", query: { section: "settings", topic: "meetings", tab: "yours" } });
    const p = w.page;
    await expectTab(p, "meetings", "yours");
    await p.evaluate((k) => localStorage.setItem(k, "sidebar"), lastTabKey("notes"));
    problems.push(...w.report.problems);
    await w.close();
    const w2 = await openWindow(browser, ctx, { window: "hub", scale: 1, theme: "dark", width: 1100, height: 720, motion: false, browser: "webkit", query: { section: "settings", topic: "notes", tab: "yours" } });
    await expectTab(w2.page, "notes", "sidebar");
    problems.push(...w2.report.problems);
    await w2.close();
    checks.push("?topic=meetings&tab=yours opens that tab; a tab id from another topic falls back to the last one opened there");
  }
} finally {
  await browser.close();
  await cli(["stop"]).catch(() => {});
  rmSync(data, { recursive: true, force: true });
}

assert.deepEqual(problems, [], "a página não teve erros");
for (const c of checks) console.log(`ok: ${c}`);
console.log(`prints em ${out}`);
