// A boas-vindas da primeira abertura (T20795, spec #20780): o Kiwi Cat grande com o balão que se escreve, e os dois
// caminhos (lead #20854). No hub de verdade, com o AppEngine headless, o agente de mentira (`KIWI_FAKE_AGENT`) e o passo
// das permissões de mentira (`KIWI_FAKE_SETUP`), num WebKit headless. Nada pede ao macOS e nada aparece na tela de ninguém.
//
// - **Primeira abertura, Vamos lá:** o balão se escreve; Vamos lá → as permissões; o app fecha no meio e a boas-vindas
//   volta; de novo Vamos lá → Continuar → o consentimento (ADR 0011) → Ligar → o onboarding do agente no passo 1.
// - **A próxima abertura:** sem boas-vindas; o onboarding do agente segue aberto.
// - **Agora não:** as permissões → o Hub, sem consentimento e com o agente desligado; a próxima abertura vai direto ao Hub.
// - **Atualização:** um `settings.json` de antes (sem `firstRun`) abre direto no Hub.
//
//   bun scripts/welcome-check.ts [pasta]
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type Browser, type Page, webkit } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";
import { WELCOME_TEXT } from "../ui/hub/onboarding/welcomeText.ts";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T20795-welcome"));
mkdirSync(out, { recursive: true });
const FAKE = { permissions: { inputMonitoring: "undetermined", accessibility: "denied" }, model: { state: "loading", phase: "downloading", fraction: 0.42 } };

/** Uma instalação: a pasta de dados com o `settings.json` dado, o engine headless e o `invoke`. */
function install(settings: object) {
  const data = mkdtempSync(join(tmpdir(), "kiwi-welcome-"));
  writeFileSync(join(data, "settings.json"), JSON.stringify({ version: 1, ...settings }));
  const cli = async (args: string[]) => {
    const p = Bun.spawn([process.execPath, join(app, "scripts/cli.ts"), ...args, "--data", data], {
      cwd: app, stdout: "pipe", stderr: "pipe", env: { ...process.env, KIWI_FAKE_SETUP: JSON.stringify(FAKE), KIWI_FAKE_AGENT: "1" },
    });
    const text = await new Response(p.stdout).text();
    assert.equal(await p.exited, 0, text + (await new Response(p.stderr).text()));
  };
  const ctx: UiContext = {
    data,
    send: async (msg) => { const r = await request(data, msg); assert.ok(r); return r; },
    subscribe: async (topics, onMsg) => {
      const c = await connect(data, (line) => { if (!("id" in line)) onMsg(line); });
      assert.ok(c);
      c.write({ id: 0, cmd: "subscribe", topics, follow: true, backlog: false });
      return () => c.close();
    },
  };
  const invoke = async (cap: string, args: unknown = {}) => {
    const r = await ctx.send({ cmd: "invoke", cap, args });
    assert.equal(r.ok, true, JSON.stringify(r));
    return r.value as any;
  };
  const hub = (browser: Browser, theme: "dark" | "light" = "dark", motion = false) =>
    openWindow(browser, ctx, { window: "hub", scale: 2, theme, width: 900, height: 760, motion, browser: "webkit", query: {} });
  return { cli, invoke, hub };
}

const shot = async (p: Page, file: string) => {
  await Bun.sleep(400);
  await p.screenshot({ path: join(out, file) });
};
const button = (p: Page, name: string) => p.getByRole("button", { name, exact: true });
/** O hub abriu e ficou um tempo sem boas-vindas. */
async function noWelcome(p: Page) {
  await p.waitForSelector(".kn-hub-main", { timeout: 15000 });
  await Bun.sleep(1500);
  assert.equal(await p.locator(".kn-welcome").count(), 0, "a boas-vindas não devia aparecer");
  assert.equal(await p.locator(".kn-setup").count(), 0, "o passo das permissões não devia aparecer");
}

const browser = await webkit.launch({ headless: true });
const engines: Array<() => Promise<void>> = [];
try {
  // Primeira abertura, Vamos lá.
  const a = install({ firstRun: "pending" });
  engines.push(() => a.cli(["stop"]));
  await a.cli(["start", "--no-helper"]);
  {
    const h = await a.hub(browser, "dark", true);
    const p = h.page;
    await p.waitForSelector(".kn-welcome-bubble", { timeout: 15000 });
    // O balão se escreve aos poucos, e o texto inteiro está lá para o leitor de tela.
    await Bun.sleep(1600);
    const partial = (await p.locator(".kn-welcome-text > span").first().textContent()) ?? "";
    assert.ok(partial.length > 10 && partial.length < 120, `no meio, um pedaço: ${partial.length}`);
    // O leitor de tela ouve o texto inteiro desde o começo, e uma vez só (o pedaço que se escreve fica de fora).
    const tree = await p.locator(".kn-welcome").ariaSnapshot();
    assert.ok(tree.includes(WELCOME_TEXT), `o balão no leitor de tela:\n${tree}`);
    assert.equal(tree.split("Olá, tudo bem?").length - 1, 1, `o texto uma vez só:\n${tree}`);
    await p.screenshot({ path: join(out, "boas-vindas-escrevendo.png") });
    await p.waitForSelector('.kn-welcome-bubble[data-typed="true"]', { timeout: 15000 });
    assert.equal(await p.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent), "Vamos lá");
    await shot(p, "boas-vindas-dark.png");
    await button(p, "Vamos lá").click();
    await p.waitForSelector(".kn-setup", { timeout: 15000 });
    // O app fecha antes do Continuar.
    await h.close();
  }
  assert.equal((await a.invoke("settings.get")).firstRun, "pending");
  {
    const h = await a.hub(browser, "light");
    const p = h.page;
    await p.waitForSelector(".kn-welcome-bubble", { timeout: 15000 });
    await shot(p, "boas-vindas-light.png");
    await button(p, "Vamos lá").click();
    await p.waitForSelector(".kn-setup", { timeout: 15000 });
    await p.locator(".kn-onb-actions button").click();
    // O Continuar grava o done, e o consentimento vem por cima, mesmo com o `firstRun` já `done`.
    await p.waitForSelector(".kn-welcome-consent .kn-agent-consent", { timeout: 15000 });
    assert.equal((await a.invoke("settings.get")).firstRun, "done");
    assert.equal((await a.invoke("agent.status")).enabled, false);
    await shot(p, "consentimento-light.png");
    await p.getByRole("button", { name: /^Ligar o / }).click();
    await p.waitForSelector(".kn-welcome-consent", { state: "detached", timeout: 15000 });
    await p.waitForFunction(() => document.querySelector(".kn-onb-progress")?.textContent === "Passo 1 de 10", undefined, { timeout: 15000 });
    const s = await a.invoke("agent.status");
    assert.equal(s.enabled, true);
    assert.deepEqual(s.onboarding, { state: "open", step: 1 });
    await shot(p, "onboarding-agente-light.png");
    await h.close();
  }
  // A próxima abertura: sem boas-vindas; o onboarding do agente continua de onde parou.
  {
    const h = await a.hub(browser);
    await noWelcome(h.page);
    await h.page.waitForFunction(() => document.querySelector(".kn-onb-progress")?.textContent === "Passo 1 de 10", undefined, { timeout: 15000 });
    await h.close();
  }

  // Primeira abertura, Agora não.
  const b = install({ firstRun: "pending" });
  engines.push(() => b.cli(["stop"]));
  await b.cli(["start", "--no-helper"]);
  {
    const h = await b.hub(browser);
    const p = h.page;
    await button(p, "Agora não").click({ timeout: 15000 });
    await p.waitForSelector(".kn-setup", { timeout: 15000 });
    await p.locator(".kn-onb-actions button").click();
    await p.waitForSelector(".kn-setup", { state: "detached", timeout: 15000 });
    await Bun.sleep(800);
    assert.equal(await p.locator(".kn-welcome, .kn-welcome-consent, .kn-onb").count(), 0, "depois do Agora não, só o Hub");
    const s = await b.invoke("agent.status");
    assert.equal(s.enabled, false);
    assert.equal(s.consented, false);
    assert.equal((await b.invoke("settings.get")).firstRun, "done");
    await shot(p, "agora-nao-hub.png");
    await h.close();
  }
  {
    const h = await b.hub(browser);
    await noWelcome(h.page);
    await h.close();
  }

  // Atualização: as settings de quem já usava, sem o `firstRun`.
  const c = install({ consented: false });
  engines.push(() => c.cli(["stop"]));
  await c.cli(["start", "--no-helper"]);
  {
    const h = await c.hub(browser);
    await noWelcome(h.page);
    await h.close();
  }
  console.log(`ok: ${out}`);
} finally {
  await browser.close();
  for (const stop of engines) await stop().catch(() => {});
}
