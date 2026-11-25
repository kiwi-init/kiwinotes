// O Hub em inglês (T28191, spec #28171): a boas-vindas, o que o Kiwi faz, as permissões, o onboarding do agente, o
// Início e o Sobre, com o app em English. No hub de verdade, com o AppEngine headless, o agente de mentira
// (`KIWI_FAKE_AGENT`) e as permissões de mentira (`KIWI_FAKE_SETUP`), num WebKit headless: nada aparece na tela de
// ninguém. A escolha da língua vai ligada só aqui (`KIWI_LANGUAGE_CHOICE=1`), enquanto o app a esconde (T29319). Em
// cada tela, nenhuma frase em português do catálogo do Hub (`hub.pt.ts`) pode aparecer, e o print fica na pasta.
//
//   bun scripts/hub-english-check.ts [pasta]
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type Page, webkit } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";
import { enCommon } from "../src/shared/i18n/common.en.ts";
import { ptCommon } from "../src/shared/i18n/common.pt.ts";
import { enHub } from "../src/shared/i18n/hub.en.ts";
import { ptHub } from "../src/shared/i18n/hub.pt.ts";
import type { Entry } from "../src/shared/i18n/index.ts";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T28191-english"));
mkdirSync(out, { recursive: true });
const FAKE = { permissions: { inputMonitoring: "undetermined", accessibility: "denied" }, model: { state: "loading", phase: "downloading", fraction: 0.42 } };
const EN = { ...enCommon, ...enHub } as Record<string, Entry>;
const en = (key: keyof typeof enHub | keyof typeof enCommon) => EN[key] as string;

/**
 * Os pedaços em português que não podem aparecer: de cada frase do catálogo que muda em inglês, o maior trecho entre
 * os `{params}`, com pelo menos 12 letras (os curtos, como "Ok" ou "Kiwi", são iguais nas duas línguas ou comuns demais).
 */
const PT_PIECES = (() => {
  const forms = (e: Entry) => (typeof e === "string" ? [e] : Object.values(e));
  const pieces = new Set<string>();
  for (const [key, pt] of Object.entries({ ...ptCommon, ...ptHub }) as [string, Entry][]) {
    const enForms = forms(EN[key]!);
    for (const f of forms(pt)) {
      if (enForms.includes(f)) continue;
      const longest = f.split(/\{\w+\}/).map((s) => s.trim()).sort((a, b) => b.length - a.length)[0] ?? "";
      if (longest.length >= 12) pieces.add(longest);
    }
  }
  return [...pieces];
})();

const data = mkdtempSync(join(tmpdir(), "kiwi-english-"));
writeFileSync(join(data, "settings.json"), JSON.stringify({ version: 1, firstRun: "pending", language: "en" }));
const env = { ...process.env, KIWI_FAKE_SETUP: JSON.stringify(FAKE), KIWI_FAKE_AGENT: "1", KIWI_SYSTEM_LANG: "en-US", KIWI_LANGUAGE_CHOICE: "1" };
const cli = async (args: string[]) => {
  const p = Bun.spawn([process.execPath, join(app, "scripts/cli.ts"), ...args, "--data", data], { cwd: app, stdout: "pipe", stderr: "pipe", env });
  const text = await new Response(p.stdout).text();
  assert.equal(await p.exited, 0, text + (await new Response(p.stderr).text()));
};
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
const invoke = async (cap: string, args: unknown = {}) => {
  const r = await ctx.send({ cmd: "invoke", cap, args });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.value as any;
};

const problems: string[] = [];
const shots: string[] = [];
/** A tela inteira em inglês: nenhum pedaço do catálogo em português; e o print. */
async function check(p: Page, name: string) {
  await Bun.sleep(500);
  const text = await p.evaluate(() => document.body.innerText);
  for (const piece of PT_PIECES) if (text.includes(piece)) problems.push(`${name}: "${piece}"`);
  const file = join(out, `${name}.png`);
  await p.screenshot({ path: file });
  shots.push(file);
}
const button = (p: Page, name: string | RegExp) => p.getByRole("button", { name, exact: typeof name === "string" });

const browser = await webkit.launch({ headless: true });
await cli(["start", "--no-helper"]);
let page: Page | null = null;
try {
  assert.equal((await invoke("app.locale")).locale, "en", "o app devia estar em English");
  const h = await openWindow(browser, ctx, { window: "hub", scale: 2, theme: "dark", width: 900, height: 760, motion: false, browser: "webkit", query: {} });
  const p = h.page;
  page = p;

  // A boas-vindas: o balão em inglês, inteiro.
  await p.waitForSelector('.kn-welcome-bubble[data-typed="true"]', { timeout: 20000 });
  assert.ok((await p.locator(".kn-welcome-bubble").innerText()).includes(en("welcome.text").slice(0, 20)), "o balão da boas-vindas em inglês");
  await check(p, "1-boas-vindas");

  // O que o Kiwi faz: parado (Movimento reduzido), cada exemplo no resultado.
  await button(p, en("welcome.yes")).click();
  await p.waitForSelector(".kn-show", { timeout: 15000 });
  assert.equal(await p.locator("#kn-show-title").innerText(), "What Kiwi does for you");
  await check(p, "2-o-que-o-kiwi-faz");
  await p.locator(".kn-show-dots button").nth(2).click();
  await check(p, "3-o-que-o-kiwi-faz-reuniao");

  // As permissões.
  await button(p, en("common.skip")).click();
  await p.waitForSelector(".kn-setup", { timeout: 15000 });
  await check(p, "4-permissoes");
  await p.locator(".kn-onb-actions button").click();

  // O consentimento (de Ajustes, fora desta parte) e o onboarding do agente, passo 1.
  await p.waitForSelector(".kn-welcome-consent .kn-agent-consent", { timeout: 15000 });
  // O consentimento é de Ajustes (Agent.tsx), que vai ao inglês noutra parte: o botão ainda em português.
  await p.locator(".kn-welcome-consent").getByRole("button", { name: /^(Ligar o |Turn on )/ }).click();
  await p.waitForSelector(".kn-welcome-consent", { state: "detached", timeout: 15000 });
  await p.waitForFunction(() => document.querySelector(".kn-onb-progress")?.textContent === "Step 1 of 10", undefined, { timeout: 15000 });
  await check(p, "5-onboarding-passo-1");

  // Os passos com mais texto: o jeito de falar, o guardrail, os projetos e o cartão final.
  for (const [step, name] of [[3, "6-onboarding-jeito"], [4, "7-onboarding-guardrail"], [6, "8-onboarding-projetos"], [10, "9-onboarding-fim"]] as const) {
    await invoke("agent.configure", { onboarding: { state: "open", step } });
    await p.waitForFunction((n) => document.querySelector(".kn-onb-progress")?.textContent === `Step ${n} of 10`, step, { timeout: 15000 });
    await check(p, name);
  }
  // A linha do jeito de falar vai às instruções em inglês.
  await invoke("agent.configure", { onboarding: { state: "open", step: 3 } });
  await p.waitForFunction(() => document.querySelector(".kn-onb-progress")?.textContent === "Step 3 of 10", undefined, { timeout: 15000 });
  await p.getByRole("radio", { name: "Detailed" }).click();
  await Bun.sleep(400);
  assert.match((await invoke("agent.status")).instructions, /^How to talk: detailed answers that explain why; casual tone, like a colleague\./);

  // O Início e o Sobre.
  await invoke("agent.configure", { onboarding: { state: "done" } });
  await p.waitForSelector(".kn-onb", { state: "detached", timeout: 15000 });
  await p.getByRole("tab", { name: en("hub.tab.home") }).click().catch(() => {});
  await check(p, "10-inicio");
  // O Sobre é um assunto dos Ajustes (spec #11966).
  await p.locator(".kn-tab", { hasText: en("hub.tab.settings") }).click();
  await p.locator(".kn-prefs-item[data-topic=about]").click();
  await p.waitForSelector(".kn-about", { timeout: 15000 });
  await check(p, "11-sobre");
  await h.close();
} catch (e) {
  // O print de onde parou, para ver o porquê.
  await page?.screenshot({ path: join(out, "falhou.png") }).catch(() => {});
  throw e;
} finally {
  await browser.close();
  await cli(["stop"]).catch(() => {});
}

console.log(JSON.stringify({ out, shots: shots.length, pieces: PT_PIECES.length, problems }, null, 2));
if (problems.length) process.exit(1);
