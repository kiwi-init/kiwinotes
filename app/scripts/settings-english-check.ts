// Os Ajustes em inglês (T30636, spec #28171, caixa 6): cada assunto dos Ajustes, com o app em English, no hub de verdade
// com o AppEngine headless e o agente de mentira, num WebKit headless: nada aparece na tela de ninguém. Em cada assunto,
// nenhuma frase em português dos catálogos nem palavra só do português (scripts/english-check-lib.ts), e o print fica
// na pasta. Os Ajustes do agente ligado têm o cenário "ingles" do agent-ui-check; aqui, o agente desligado.
//
//   bun scripts/settings-english-check.ts [pasta]
import assert from "node:assert/strict";
import type { Page } from "playwright-core";
import { startEnglish } from "./english-check-lib";

// O português que já tem dono: some daqui no PR que o traduz.
const KNOWN: [string, string][] = [];
const s = await startEnglish({ name: "T30636-settings-english", known: KNOWN });
// O motivo do atualizador desligado só aparece no headless e nos testes (`UPDATES_OFF`), nunca no app.
const check = (p: Page, name: string) => s.check(p, name, { skip: [/\(sem o atualizador no headless e nos testes\)\.?/] });

let page: Page | null = null;
try {
  assert.equal((await s.invoke("app.locale")).locale, "en", "o app devia estar em English");
  const { page: p } = await s.open("hub", { section: "settings" });
  page = p;
  await p.waitForSelector(".kn-prefs-item[data-topic=appearance]", { timeout: 20000 });
  // Os assuntos que a lista mostra: o Geral só entra quando a escolha da língua liga na UI (T30629).
  const topics = await p.locator(".kn-prefs-item[data-topic]").evaluateAll((els) => els.map((e) => e.getAttribute("data-topic")!));
  assert.ok(topics.length >= 8, `os assuntos dos Ajustes: ${topics.join(", ")}`);
  for (const [i, topic] of topics.entries()) {
    await p.locator(`.kn-prefs-item[data-topic=${topic}]`).click();
    await p.waitForSelector(`.kn-prefs-topic[data-topic=${topic}]`, { timeout: 15000 });
    await check(p, `${i + 1}-${topic}`);
  }
} catch (e) {
  await s.fail(e, page);
}
await s.finish();
