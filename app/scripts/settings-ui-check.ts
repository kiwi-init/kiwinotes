// Dirige o atalho das notas nas Configurações (T1499) num navegador headless, sem janela na tela de ninguém. Serve o
// build de verdade (dist/settings, de `bun run ui:build`) com a CSP das views (`VIEWS_CSP`) e um `window.engine` de
// mentira, e confere que nada esbarra na CSP.
//
//   bun scripts/settings-ui-check.ts [pasta-para-screenshots]
//
// Usa o WebKit do cache do Playwright (o mais perto do WKWebView do app), ou o Chromium com KIWI_UI_BROWSER=chromium.

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { chromium, webkit } from "playwright-core";

import { VIEWS_CSP } from "../src/bun/window-security.ts";

const appDir = resolve(import.meta.dir, "..");
const dist = join(appDir, "dist/settings");
if (!existsSync(join(dist, "index.html"))) throw new Error("sem dist/settings: rode `bun run ui:build` antes");
const shots = process.argv[2] ? resolve(process.argv[2]) : undefined;

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    const rel = new URL(req.url).pathname.replace(/^\/+/, "") || "index.html";
    const file = Bun.file(join(dist, rel));
    if (!rel.startsWith("..") && (await file.exists())) return new Response(file, { headers: { "Content-Security-Policy": VIEWS_CSP } });
    return new Response("not found", { status: 404 });
  },
});

/** O engine de mentira: as Configurações na memória e cada `settings.set` anotado. `mode`: "old" não tem `settings.*`; "failing" recusa o set. */
function fakeEngine(mode: "ok" | "old" | "failing") {
  let settings: { notesShortcut: string | null } = { notesShortcut: "control+option+n" };
  const calls: unknown[] = [];
  const caps: Record<string, (args: any) => unknown> = {
    "dictionary.get": () => [],
    "snippets.get": () => [],
    "settings.get": () => ({ ...settings }),
    "settings.set": (args) => {
      calls.push(args);
      if (mode === "failing") throw new Error("E_IO");
      settings = { ...settings, ...args };
      return { ...settings };
    },
  };
  const available = (cap: string) => cap in caps && !(mode === "old" && cap.startsWith("settings."));
  (window as any).__calls = calls;
  (window as any).engine = {
    invoke: async (cap: string, args: unknown) => {
      if (!available(cap)) throw new Error(`no ${cap}`);
      return caps[cap]!(args);
    },
    has: available,
    ready: () => {},
    reportError: () => {},
    on: () => () => {},
  };
}

const browserType = process.env.KIWI_UI_BROWSER === "chromium" ? chromium : webkit;
const browser = await browserType.launch({ headless: true });
let failed = 0;
async function step(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    console.log(`ok      ${name}`);
  } catch (e) {
    failed++;
    console.log(`FALHOU  ${name}: ${String(e).split("\n")[0]}`);
  }
}

async function open(mode: "ok" | "old" | "failing") {
  const page = await browser.newPage({ viewport: { width: 760, height: 900 } });
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(String(e)));
  page.on("console", (m) => /Content Security Policy|Refused to/i.test(m.text()) && problems.push(m.text()));
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation", (e) => console.error(`Refused to load: CSP ${e.violatedDirective} ${e.blockedURI}`)));
  await page.addInitScript(fakeEngine, mode);
  await page.goto(`http://127.0.0.1:${server.port}/index.html`);
  await page.waitForSelector(".kn-segmented");
  return { page, problems };
}

const group = (page: import("playwright-core").Page) => page.getByRole("radiogroup", { name: "Atalho das notas" });
const checked = async (page: import("playwright-core").Page) => (await group(page).locator('[aria-checked="true"]').textContent())?.trim();
const calls = (page: import("playwright-core").Page) => page.evaluate(() => (window as any).__calls);

const { page, problems } = await open("ok");

await step("as Configurações sobem com a CSP das views, e o atalho das notas mostra o salvo (⌃⌥N)", async () => {
  await group(page).waitFor();
  if ((await checked(page)) !== "⌃⌥N") throw new Error(`marcado: ${await checked(page)}`);
  const labels = (await group(page).getByRole("radio").allTextContents()).map((s) => s.trim());
  if (labels.join(",") !== "⌃⌥N,⌃⌘N,⌥⌘N,Desligado") throw new Error(labels.join(","));
  if (shots) await page.screenshot({ path: join(shots, "settings-notes-shortcut.png") });
});

await step("escolher ⌥⌘N grava ⌥⌘N; Desligado grava null", async () => {
  await group(page).getByRole("radio", { name: "⌥⌘N" }).click();
  await page.waitForFunction(() => (window as any).__calls.length === 1);
  if ((await checked(page)) !== "⌥⌘N") throw new Error(`marcado: ${await checked(page)}`);
  await group(page).getByRole("radio", { name: "Desligado" }).click();
  await page.waitForFunction(() => (window as any).__calls.length === 2);
  const got = JSON.stringify(await calls(page));
  if (got !== '[{"notesShortcut":"option+command+n"},{"notesShortcut":null}]') throw new Error(got);
  if ((await checked(page)) !== "Desligado") throw new Error(`marcado: ${await checked(page)}`);
});

await step("sem erro nem violação de CSP no caminho todo", async () => {
  if (problems.length) throw new Error(problems.join(" | "));
});

await step("o engine recusa: volta ao que estava e avisa", async () => {
  const bad = await open("failing");
  await group(bad.page).waitFor();
  await group(bad.page).getByRole("radio", { name: "⌃⌘N" }).click();
  await bad.page.getByText("Não deu para salvar o atalho").waitFor({ timeout: 3000 });
  if ((await checked(bad.page)) !== "⌃⌥N") throw new Error(`marcado: ${await checked(bad.page)}`);
  await bad.page.close();
});

await step("engine sem settings.* (UI nova num app velho): a linha não aparece", async () => {
  const old = await open("old");
  await old.page.waitForTimeout(300);
  if (await group(old.page).count()) throw new Error("a linha apareceu");
  if (old.problems.length) throw new Error(old.problems.join(" | "));
  await old.page.close();
});

await browser.close();
server.stop();
console.log(failed ? `\n${failed} passo(s) falharam` : "\ntudo certo");
process.exit(failed ? 1 : 0);
