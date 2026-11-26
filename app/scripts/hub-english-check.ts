// O Hub em inglês (T28191, spec #28171): a boas-vindas, o que o Kiwi faz, as permissões, o onboarding do agente, o
// Início e o Sobre, com o app em English. No hub de verdade, com o AppEngine headless, o agente de mentira
// (`KIWI_FAKE_AGENT`) e as permissões de mentira (`KIWI_FAKE_SETUP`), num WebKit headless: nada aparece na tela de
// ninguém. A escolha da língua vai ligada só aqui (`KIWI_LANGUAGE_CHOICE=1`), enquanto o app a esconde (T29319). Em
// cada tela, nenhuma frase em português dos catálogos nem palavra só do português pode aparecer
// (`english-check-lib.ts`), e o print fica na pasta.
//
//   bun scripts/hub-english-check.ts [pasta]
import assert from "node:assert/strict";
import type { Page } from "playwright-core";
import { startEnglish } from "./english-check-lib";
import { enCommon } from "../src/shared/i18n/common.en.ts";
import { enHub } from "../src/shared/i18n/hub.en.ts";
import type { Entry } from "../src/shared/i18n/index.ts";

const FAKE = { permissions: { inputMonitoring: "undetermined", accessibility: "denied" }, model: { state: "loading", phase: "downloading", fraction: 0.42 } };
const EN = { ...enCommon, ...enHub } as Record<string, Entry>;
const en = (key: keyof typeof enHub | keyof typeof enCommon) => EN[key] as string;

// O português que a T30631 traduz: a linha do agente no passo 1 do onboarding e o nome da cor no cartão final.
const KNOWN: [string, string][] = [
  ["O login é dele", "T30631"],
  ["com a sua conta do Claude", "T30631"],
  ["Nada seu vai junto", "T30631"],
  ["Prisma Original", "T30631"],
];
const s = await startEnglish({ name: "T28191-english", settings: { firstRun: "pending" }, env: { KIWI_FAKE_SETUP: JSON.stringify(FAKE) }, known: KNOWN });
const { invoke } = s;
// O motivo do atualizador desligado só aparece no headless e nos testes (`UPDATES_OFF`), nunca no app.
const check = (p: Page, name: string) => s.check(p, name, { skip: [/\(sem o atualizador no headless e nos testes\)\.?/] });
const button = (p: Page, name: string | RegExp) => p.getByRole("button", { name, exact: typeof name === "string" });

let page: Page | null = null;
try {
  assert.equal((await invoke("app.locale")).locale, "en", "o app devia estar em English");
  const h = await s.open("hub", {}, { width: 900, height: 760 });
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
  await s.fail(e, page);
}
await s.finish();
