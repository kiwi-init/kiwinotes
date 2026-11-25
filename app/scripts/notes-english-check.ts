// As Notas em inglês (T30632, spec #28171, caixa 6): a árvore, o editor, o menu de uma nota, as Versões com o diff e o
// Restaurar, e a busca com e sem resultado, com o app em English. No hub de verdade, com o AppEngine headless num tmp,
// num WebKit headless (`english-check-lib.ts`): nada aparece na tela de ninguém. As notas são inventadas e em inglês,
// então qualquer português na tela é do app.
//
//   bun scripts/notes-english-check.ts [pasta]
import assert from "node:assert/strict";
import type { Page } from "playwright-core";
import { startEnglish } from "./english-check-lib";
import { enNotes } from "../src/shared/i18n/notes.en.ts";

const s = await startEnglish({ name: "notes-english" });
let page: Page | null = null;
try {
  assert.equal((await s.invoke("app.locale")).locale, "en", "o app devia estar em English");
  await s.invoke("notes.create", { folder: "Projects", title: "Garden plan", content: "# Garden plan\n\nPlant tomatoes in May.\nWater twice a week." });
  await s.invoke("notes.create", { folder: "Projects", title: "Reading list", content: "- A book about rivers\n- A book about bread" });
  await s.invoke("notes.create", { title: "Ideas", content: "A shelf for the plants." });

  const { page: p } = await s.open("hub", { section: "notes" });
  page = p;
  await p.waitForSelector(".kn-crumb-bt", { timeout: 20000 });

  // A árvore, com as pastas e as notas.
  await p.locator(".kn-crumb-bt").click();
  await p.waitForSelector(".kn-tree-pop[data-open]", { timeout: 10000 });
  await s.check(p, "1-arvore");

  // O editor, com a nota aberta.
  await p.locator(".kn-tree-pop[data-open] .kn-side-item:not([data-tree])", { hasText: "Garden plan" }).click();
  await p.waitForSelector(".cm-content:has-text('Plant tomatoes')", { timeout: 10000 });
  await s.check(p, "2-editor");

  // Uma linha nova, para as Versões terem duas.
  await p.locator(".cm-content").click();
  await p.keyboard.press("Meta+ArrowDown");
  await p.keyboard.type("\nBuy a new hose.");
  await Bun.sleep(1500);

  // O menu da nota (o clique com Control), inteiro.
  await p.locator(".kn-crumb-bt").click();
  await p.waitForSelector(".kn-tree-pop[data-open]", { timeout: 10000 });
  await p.locator(".kn-tree-pop[data-open] .kn-side-item:not([data-tree])", { hasText: "Garden plan" }).click({ modifiers: ["Control"] });
  await p.waitForSelector(".kn-menu-item", { timeout: 10000 });
  await s.check(p, "3-menu-da-nota");

  // As Versões: a lista, o diff e o que o Restaurar faz.
  await p.locator(".kn-menu-item", { hasText: /^Versions/ }).click();
  await p.waitForSelector(".kn-versions-it >> nth=1", { timeout: 10000 });
  await p.locator(".kn-versions-it").nth(1).click();
  await p.waitForSelector(".kn-diff-del", { timeout: 10000 });
  assert.match(await p.locator(".kn-versions-stats").innerText(), /removes 1 line/, "o resumo do Restaurar em inglês");
  await s.check(p, "4-versoes");
  // Fecha pelo fundo, fora do diálogo.
  await p.mouse.click(8, 700);
  await p.waitForSelector(".kn-versions", { state: "detached", timeout: 10000 });

  // A busca: com resultado e sem.
  await p.keyboard.press("Meta+k");
  await p.waitForSelector(".kn-palette .kn-palette-q", { timeout: 10000 });
  assert.equal(await p.locator(".kn-palette").getAttribute("aria-label"), enNotes["notes.palette.label"]);
  await p.keyboard.type("tomatoes");
  await p.waitForSelector(".kn-palette-it", { timeout: 10000 });
  await s.check(p, "5-busca");
  await p.locator(".kn-palette-q").fill("zebra crossing");
  await Bun.sleep(800);
  await s.check(p, "6-busca-sem-nada");
  await p.keyboard.press("Escape");
} catch (e) {
  await s.fail(e, page);
}
await s.finish();
