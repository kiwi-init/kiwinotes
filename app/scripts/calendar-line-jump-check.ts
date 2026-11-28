// O link do cartão do Calendário abre a nota na linha e a marca uma vez só (T32155, revisão #32349).
// Abrir outra nota depois, voltar à primeira ou recarregar a nota do disco não marca a linha de novo;
// um pedido novo marca. Roda no WebKit headless, com dados num tmp: `bun scripts/calendar-line-jump-check.ts`.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Page } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";

const app = resolve(import.meta.dir, "..");
const data = mkdtempSync(join(tmpdir(), "kiwi-cal-line-"));
async function cli(args: string[]) {
  const p = Bun.spawn([process.execPath, join(app, "scripts/cli.ts"), ...args, "--data", data], { cwd: app, stdout: "pipe", stderr: "pipe" });
  const t = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text());
  assert.equal(await p.exited, 0, t);
}
const ctx: UiContext = {
  data,
  send: async (m) => { const r = await request(data, m); assert.ok(r); return r; },
  subscribe: async (topics, on) => {
    const c = await connect(data, (l) => { if (!("id" in l)) on(l); });
    assert.ok(c);
    c.write({ id: 0, cmd: "subscribe", topics, follow: true, backlog: false });
    return () => c.close();
  },
};
const invoke = async <T = any>(cap: string, args: unknown = {}): Promise<T> => {
  const r = await ctx.send({ cmd: "invoke", cap, args });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.value as T;
};

const day = "2026-11-25";
const A = "# Pendências\n\n- [ ] Revisar o orçamento @ 2026-11-25 10:00-11:00 #reuniao\n- [ ] Regar as mudas @ 2026-11-26\n";
const B = "# Mudança\n\n- [ ] Ligar para a Ana\n- [ ] Comprar fita e caixas\n- [ ] Separar os livros\n";

/** Nenhuma linha marcada durante `ms` (a marca dura 1,6 s; um pulo indevido aparece logo). */
async function noFlash(p: Page, ms: number, why: string) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const got = await p.evaluate(() => document.querySelector("[data-flash-line]")?.textContent ?? null);
    assert.equal(got, null, `${why}: marcou "${got}"`);
    await p.waitForTimeout(50);
  }
}
async function fromCard(p: Page) {
  await p.locator('.kn-tab[data-section="calendar"]').click();
  await p.locator('.kn-cal-views [data-view="week"]').click();
  // No canto: o item curto lado a lado é estreito.
  await p.locator('.kn-cal-item[data-kind="meeting"]').first().hover({ position: { x: 8, y: 8 } });
  await p.waitForSelector(".kn-cal-card");
  await p.locator(".kn-cal-card [data-note-link]").first().click({ force: true });
  const h = await p.waitForSelector("[data-flash-line]", { timeout: 5000 });
  assert.equal(await h.getAttribute("data-flash-line"), "3");
  assert.match((await h.textContent()) ?? "", /Revisar o orçamento/);
  await p.waitForSelector("[data-flash-line]", { state: "detached", timeout: 5000 });
}
async function openFromTree(p: Page, title: string, text: string) {
  await p.locator(".kn-crumb-bt").click();
  await p.waitForSelector(".kn-tree-pop[data-open]", { timeout: 10000 });
  await p.locator(".kn-tree-pop[data-open] .kn-side-item:not([data-tree])", { hasText: title }).click();
  await p.waitForSelector(`.cm-content:has-text('${text}')`, { timeout: 10000 });
}

const browser = await webkit.launch({ headless: true });
try {
  await cli(["start", "--no-helper"]);
  const a = await invoke<{ path: string }>("notes.create", { folder: "Projeto X", title: "Pendências", content: A });
  await invoke("notes.create", { folder: "Projeto X", title: "Mudança", content: B });
  const w = await openWindow(browser, ctx, { window: "hub", scale: 1, theme: "light", motion: true, width: 1200, height: 800, browser: "webkit", query: { day } });
  const p = w.page;
  try {
    await fromCard(p);
    console.log("ok  o link do cartão marca a linha 3 de Pendências");

    await openFromTree(p, "Mudança", "Comprar fita e caixas");
    await noFlash(p, 1200, "abrir Mudança sem linha pedida");
    console.log("ok  abrir outra nota pela árvore não marca nada");

    await openFromTree(p, "Pendências", "Revisar o orçamento");
    await noFlash(p, 1200, "voltar a Pendências");
    console.log("ok  voltar à primeira nota não marca de novo");

    const got = await invoke<{ version: string }>("notes.get", { path: a.path });
    await invoke("notes.save", { path: a.path, content: A + "- [ ] Nova linha de fora\n", baseVersion: got.version });
    await p.waitForSelector(".cm-content:has-text('Nova linha de fora')", { timeout: 10000 });
    await noFlash(p, 1200, "recarregar Pendências do disco");
    console.log("ok  recarregar a nota do disco não marca de novo");

    await fromCard(p);
    console.log("ok  um pedido novo marca outra vez");

    assert.deepEqual(w.report.problems, []);
  } finally {
    await w.close();
  }
} finally {
  await browser.close();
  await cli(["stop"]).catch(() => {});
}
