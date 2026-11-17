// T4363, spec #4357: WebKit headless + vault inventado do Vite, sem app, mic ou clipboard do Mac.
// A árvore abre no hover do botão do caminho e a borda esquerda não abre nada.
// Pegue `kiwi lock bench` antes. Uso: bun scripts/tree-hover-ui-check.ts /tmp/tree-hover
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { webkit, type Page } from "playwright-core";

const output = resolve(process.argv[2] ?? "/tmp/kiwi-tree-hover");
mkdirSync(output, { recursive: true });
const app = resolve(import.meta.dir, "..");
const port = 5196;
const url = `http://127.0.0.1:${port}/notes/index.html`;
const vite = Bun.spawn(["bun", "x", "vite", "--host", "127.0.0.1", "--port", `${port}`, "--strictPort"], { cwd: app, stdout: "ignore", stderr: "inherit" });
const browser = await webkit.launch({ headless: true });
const checks: string[] = [];
const errors: string[] = [];
const open = (page: Page) => page.locator(".kn-tree-pop[data-open]").count();
const away = (page: Page) => page.mouse.move(1050, 650);
const edge = (page: Page) => page.mouse.move(6, 300);
const closed = (page: Page) => page.waitForFunction(() => !document.querySelector(".kn-tree-pop[data-open]"));
// O Esc primeiro sai do renomear/busca; o segundo fecha a árvore.
async function escClose(page: Page) {
  for (let i = 0; i < 3 && await open(page); i++) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(120);
  }
}

async function load(page: Page, startUrl = url) {
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const target = new URL(route.request().url());
    return ["127.0.0.1", "localhost", ""].includes(target.hostname) ? route.continue() : route.abort();
  });
  await page.goto(startUrl);
  await page.waitForSelector(".kn-title");
  await page.waitForTimeout(500);
}

async function check(name: string, run: () => Promise<void>) {
  await run();
  checks.push(name);
  console.log(`ok ${name}`);
}

try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(url)).ok) break; } catch {}
    if (i > 100) throw new Error("Vite não subiu");
    await Bun.sleep(100);
  }
  const context = await browser.newContext({ viewport: { width: 1180, height: 760 }, reducedMotion: "no-preference" });
  const page = await context.newPage();
  await load(page);

  await check("hover do caminho abre a árvore logo abaixo, sem roubar foco nem mudar o editor", async () => {
    assert.equal(await open(page), 0);
    await page.locator(".cm-content").click();
    const before = await page.locator(".kn-page").boundingBox();
    await page.locator(".kn-crumb-bt").hover();
    await page.waitForSelector(".kn-tree-pop[data-open]");
    await page.waitForTimeout(260);
    assert.equal(await page.locator(".cm-content").evaluate((el) => document.activeElement === el), true);
    assert.deepEqual(await page.locator(".kn-page").boundingBox(), before);
    const button = await page.locator(".kn-crumb-bt").boundingBox();
    const panel = await page.locator(".kn-tree-pop").boundingBox();
    assert.ok(button && panel && panel.y >= button.y + button.height, "a árvore abre abaixo do botão");
    assert.ok(Math.abs(panel.x - button.x) <= 2, "a árvore alinha com o botão");
    const edgeBox = await page.locator(".kn-notes").boundingBox();
    assert.ok(edgeBox && panel.x >= edgeBox.x + 11, "a árvore não encosta na borda esquerda");
    await page.screenshot({ path: `${output}/aberta.png` });
  });
  await check("a borda esquerda da janela não abre nada", async () => {
    await away(page);
    await closed(page);
    const rail = await page.locator(".kn-side-edge").count();
    assert.equal(rail, 0);
    await edge(page);
    await page.waitForTimeout(500);
    assert.equal(await open(page), 0);
  });
  await check("saída tem atraso e reentrada no botão ou na árvore cancela o fechamento", async () => {
    await page.locator(".kn-crumb-bt").hover();
    await page.waitForSelector(".kn-tree-pop[data-open]");
    await away(page);
    await page.waitForTimeout(30);
    assert.equal(await open(page), 1);
    await page.locator(".kn-crumb-bt").hover();
    await page.waitForTimeout(130);
    assert.equal(await open(page), 1);
    const box = await page.locator(".kn-tree-pop").boundingBox();
    assert.ok(box);
    await away(page);
    await page.mouse.move(box.x + box.width / 2, box.y + 40);
    await page.waitForTimeout(200);
    assert.equal(await open(page), 1);
    await away(page);
    await closed(page);
    assert.equal(await page.locator(".kn-tree-pop").evaluate((el) => el.hasAttribute("inert")), true);
  });
  await check("teclado abre pelo caminho, e o Esc do fechamento não reabre", async () => {
    // Modalidade de teclado: o foco programático no botão conta como :focus-visible.
    await page.keyboard.press("Tab");
    await page.locator(".kn-crumb-bt").evaluate((el) => (el as HTMLElement).focus());
    await page.waitForSelector(".kn-tree-pop[data-open]");
    assert.equal(await page.locator(".kn-side-search").evaluate((el) => document.activeElement === el), true);
    await away(page);
    await page.waitForTimeout(350);
    assert.equal(await open(page), 1);
    await page.locator(".kn-side-search").fill("Caixa");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".kn-side-search").inputValue(), "");
    assert.equal(await open(page), 1);
    await page.keyboard.press("Escape");
    assert.equal(await open(page), 0);
    assert.equal(await page.locator(".kn-crumb-bt").evaluate((el) => document.activeElement === el), true);
    await page.waitForTimeout(150);
    assert.equal(await open(page), 0);
    await page.keyboard.press("Enter");
    assert.equal(await open(page), 1);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(50);
    assert.equal(await open(page), 0);
  });
  await check("clique no caminho abre e fecha, preserva a busca e as ações não são botões aninhados", async () => {
    await away(page);
    await closed(page);
    await page.locator(".kn-crumb-bt").hover();
    await page.waitForSelector(".kn-tree-pop[data-open]");
    // O primeiro clique confirma o hover e não fecha na cara; o segundo fecha, e o terceiro abre.
    await page.locator(".kn-crumb-bt").click();
    assert.equal(await open(page), 1);
    assert.equal(await page.locator(".kn-side-search").evaluate((el) => document.activeElement === el), true);
    await page.locator(".kn-crumb-bt").click();
    await closed(page);
    await page.locator(".kn-crumb-bt").click();
    await page.waitForSelector(".kn-tree-pop[data-open]");
    assert.equal(await page.locator(".kn-side-search").evaluate((el) => document.activeElement === el), true);
    assert.equal(await page.locator("button button").count(), 0);
    const row = page.locator('.kn-side-row:has(> .kn-side-item[data-kind="note"])').first();
    await row.hover();
    await page.waitForTimeout(260);
    assert.equal(await row.locator(".kn-side-tools").evaluate((el) => getComputedStyle(el).opacity), "1");
    assert.equal(await row.locator("time").count(), 1);
    const title = await page.locator(".kn-title").inputValue();
    const pin = row.locator('.kn-side-action[aria-pressed]');
    const pressed = await pin.getAttribute("aria-pressed");
    await pin.click({ modifiers: ["Control"] });
    await page.waitForSelector(".kn-menu");
    assert.equal(await pin.getAttribute("aria-pressed"), pressed);
    assert.equal(await page.locator(".kn-title").inputValue(), title);
    await page.keyboard.press("Escape");
    await row.locator('.kn-side-action[aria-pressed]').click();
    assert.equal(await page.locator(".kn-title").inputValue(), title);
  });
  await check("menu e renomear seguram aberta ao sair com o mouse", async () => {
    const row = page.locator('.kn-side-row:has(> .kn-side-item[data-kind="folder"])').first();
    await row.hover();
    await page.waitForTimeout(300);
    await row.locator('[aria-haspopup="menu"]').click();
    await away(page);
    await page.waitForTimeout(350);
    assert.equal(await open(page), 1);
    await page.locator('.kn-menu-item:has-text("Renomear")').click();
    await page.waitForSelector(".kn-side-rename");
    await away(page);
    await page.waitForTimeout(350);
    assert.equal(await open(page), 1);
    assert.equal(await page.locator(".kn-side-rename").evaluate((el) => document.activeElement === el), true);
    await escClose(page);
    await away(page);
    await closed(page);
  });
  await check("ações escondem no repouso e reaparecem com foco sem abrir a nota", async () => {
    await page.locator(".kn-crumb-bt").hover();
    await page.waitForSelector(".kn-tree-pop[data-open]");
    await page.locator(".kn-side-search").focus();
    await away(page);
    await page.waitForTimeout(350);
    assert.equal(await open(page), 1);
    const row = page.locator('.kn-side-row:has(> .kn-side-item[data-kind="note"])').first();
    assert.equal(await row.locator(".kn-side-tools").evaluate((el) => getComputedStyle(el).opacity), "0");
    const before = await page.locator(".kn-title").inputValue();
    await row.locator(".kn-side-action").first().focus();
    await page.waitForTimeout(260);
    assert.equal(await row.locator(".kn-side-tools").evaluate((el) => getComputedStyle(el).opacity), "1");
    assert.equal(await page.locator(".kn-title").inputValue(), before);
    await page.screenshot({ path: `${output}/linha-foco.png` });
    // A cópia de Fixadas pode sumir ao desafixar: não perder o foco no body.
    if (await row.locator('.kn-side-action[aria-pressed="true"]').count()) {
      await page.keyboard.press("Space");
      await page.waitForTimeout(100);
      assert.equal(await page.locator(".kn-side").evaluate((el) => el.contains(document.activeElement)), true);
    }
    await page.keyboard.press("Escape");
    await away(page);
    await closed(page);
  });
  await check("arraste mantém aberta até dragend, mesmo fora da árvore", async () => {
    await page.locator(".kn-crumb-bt").hover();
    await page.waitForSelector(".kn-tree-pop[data-open]");
    await page.locator('.kn-side-item[data-kind="note"]').first().evaluate((el) => {
      (document.activeElement as HTMLElement | null)?.blur();
      el.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: new DataTransfer() }));
    });
    await away(page);
    await page.waitForTimeout(350);
    assert.equal(await open(page), 1);
    await page.locator('.kn-side-item[data-kind="note"]').first().dispatchEvent("dragend");
    await closed(page);
  });
  await check("reduzir movimento do sistema e da Aparência é instantâneo", async () => {
    for (const mode of ["system", "app"]) {
      await page.emulateMedia({ reducedMotion: mode === "system" ? "reduce" : "no-preference" });
      await page.evaluate((m) => { document.documentElement.dataset.motion = m === "app" ? "reduced" : "full"; }, mode);
      await page.locator(".kn-crumb-bt").hover();
      await page.waitForSelector(".kn-tree-pop[data-open]");
      const duration = await page.locator(".kn-tree-pop").evaluate((el) => getComputedStyle(el).transitionDuration);
      assert.equal(duration, "0s");
      await away(page);
      await closed(page);
    }
  });
  await check("no hub abre abaixo do botão na barra, preserva a barra e fecha ao trocar de aba", async () => {
    const hub = await context.newPage();
    await load(hub, `http://127.0.0.1:${port}/hub/index.html`);
    const bar = await hub.locator(".kn-hub-top").boundingBox();
    const editor = await hub.locator(".kn-page").boundingBox();
    const crumb = hub.locator(".kn-hub-start .kn-crumb-bt");
    const button = await crumb.boundingBox();
    await crumb.hover();
    await hub.waitForSelector(".kn-tree-pop[data-open]");
    await hub.waitForTimeout(260);
    const panel = await hub.locator(".kn-tree-pop").boundingBox();
    assert.ok(bar && panel && panel.y >= bar.y + bar.height);
    assert.ok(button && panel && panel.y >= button.y + button.height);
    assert.deepEqual(await hub.locator(".kn-page").boundingBox(), editor);
    // A borda não segura nem abre: sair do botão para ela fecha como qualquer saída.
    await edge(hub);
    await hub.waitForTimeout(400);
    assert.equal(await open(hub), 0);
    await edge(hub);
    await hub.waitForTimeout(300);
    assert.equal(await open(hub), 0);
    // Reuniões não exige capacidades do engine real neste fixture de Vite.
    await hub.locator('.kn-tab[data-section="meetings"]').click();
    assert.equal(await open(hub), 0);
    await hub.locator('.kn-tab[data-section="notes"]').click();
    assert.equal(await open(hub), 0);
    await hub.close();
  });
  await check("menu fora do painel: apagar mantém a árvore para abrir a Lixeira", async () => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.evaluate(() => { document.documentElement.dataset.motion = "full"; });
    await page.locator(".kn-crumb-bt").hover();
    await page.waitForSelector(".kn-tree-pop[data-open]");
    const note = page.locator('.kn-side-item[data-kind="note"]').filter({ hasText: "Site novo" }).first();
    const bounds = await note.boundingBox();
    assert.ok(bounds);
    await note.click({ modifiers: ["Control"], position: { x: bounds.width - 6, y: 12 } });
    const remove = page.locator('.kn-menu-item:has-text("Apagar")');
    const item = await remove.boundingBox();
    const panel = await page.locator(".kn-tree-pop").boundingBox();
    assert.ok(item && panel && item.x + item.width / 2 > panel.x + panel.width);
    await remove.click();
    await page.waitForTimeout(240);
    assert.equal(await open(page), 1);
    await page.locator('.kn-side-item:has-text("Lixeira")').click();
    await page.waitForSelector(".kn-trash");
  });
  assert.deepEqual(errors, []);
  await context.close();

  // Uma demonstração curta, separada do roteiro de testes, para revisão humana.
  const demo = await browser.newContext({ viewport: { width: 1180, height: 760 }, reducedMotion: "no-preference", recordVideo: { dir: output, size: { width: 1180, height: 760 } } });
  const demoPage = await demo.newPage();
  await load(demoPage);
  // Cursor desenhado só na gravação: o headless não captura o cursor do SO.
  await demoPage.evaluate(() => {
    const cursor = document.createElement("div");
    cursor.style.cssText = "position:fixed;left:-20px;top:-20px;width:12px;height:12px;border:2px solid white;border-radius:50%;background:#1a56db;box-shadow:0 1px 4px #0006;pointer-events:none;z-index:9999";
    document.body.append(cursor);
    document.addEventListener("mousemove", (event) => { cursor.style.left = `${event.clientX - 6}px`; cursor.style.top = `${event.clientY - 6}px`; });
  });
  await away(demoPage);
  await demoPage.waitForTimeout(350);
  await edge(demoPage);
  await demoPage.waitForTimeout(700);
  await demoPage.locator(".kn-crumb-bt").hover();
  await demoPage.waitForTimeout(600);
  await demoPage.locator('.kn-side-row:has(> .kn-side-item[data-kind="note"])').first().hover();
  await demoPage.waitForTimeout(650);
  await away(demoPage);
  await demoPage.waitForTimeout(450);
  await demoPage.locator(".cm-content").click();
  await away(demoPage);
  await demoPage.waitForTimeout(450);
  await demoPage.locator(".kn-crumb-bt").hover();
  await demoPage.waitForTimeout(500);
  await away(demoPage);
  await demoPage.waitForTimeout(350);
  await demoPage.keyboard.press("Tab");
  await demoPage.locator(".kn-crumb-bt").evaluate((el) => (el as HTMLElement).focus());
  await demoPage.waitForTimeout(600);
  await demoPage.keyboard.press("Escape");
  await demoPage.waitForTimeout(400);
  const video = demoPage.video();
  await demo.close();
  const videoPath = video ? await video.path() : null;
  writeFileSync(`${output}/report.json`, JSON.stringify({ checks, errors, video: videoPath }, null, 2));
  console.log(`Gravação: ${videoPath}`);
} finally {
  await browser.close();
  vite.kill();
}
