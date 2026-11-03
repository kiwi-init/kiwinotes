// Dirige o "Enviar para nota…" do Histórico (T1320) num navegador headless, sem janela na tela de ninguém. Serve o
// build de verdade (dist/history, de `bun run ui:build`) com a CSP das views (`VIEWS_CSP`, T1378) e um
// `window.engine` de mentira, e confere que nada esbarra na CSP.
//
//   bun scripts/history-ui-check.ts [pasta-para-screenshots]
//
// Usa o WebKit do cache do Playwright (o mais perto do WKWebView do app), ou o Chromium com KIWI_UI_BROWSER=chromium.

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { chromium, webkit } from "playwright-core";

import { VIEWS_CSP } from "../src/bun/window-security.ts";

const appDir = resolve(import.meta.dir, "..");
const dist = join(appDir, "dist/history");
if (!existsSync(join(dist, "index.html"))) throw new Error("sem dist/history: rode `bun run ui:build` antes");
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

/** O engine de mentira: ditados e notas na memória, e cada `history.toNote` anotado (com 150 ms de demora). */
function fakeEngine(withToNote: boolean) {
  const now = Date.now();
  const iso = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString();
  const entries = [
    { id: `${iso(2)}-0001`, at: iso(2), raw: "comprar café e açúcar", text: "Comprar café e açúcar.", app: { name: "Slack" } },
    { id: `${iso(9)}-0002`, at: iso(9), raw: "começar pela tomografia", text: "Começar pela tomografia.", app: { name: "Mail" } },
  ];
  const meta = (path: string, minAgo: number) => {
    const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    return { path, title: path.slice(path.lastIndexOf("/") + 1, -3), folder, mtime: iso(minAgo), size: 10, version: "v1", tags: [] };
  };
  const notes = [meta("Projetos/Migração PACS Central.md", 30), meta("Ideias.md", 5), meta("Diário/2026-11-03.md", 60)];
  const calls: unknown[] = [];
  const caps: Record<string, (a: any) => unknown> = {
    "history.search": () => ({ entries }),
    "history.delete": () => true,
    "notes.list": () => ({ folders: ["Diário", "Projetos"], notes }),
    "notes.search": (a) => notes.filter((n) => n.title.toLowerCase().includes(String(a.query).toLowerCase())).map((n) => ({ path: n.path, title: n.title, snippet: "", score: 1 })),
    "history.toNote": async (a) => {
      calls.push(a);
      await new Promise((r) => setTimeout(r, 150));
      const e = entries.find((x) => x.id === a.id)!;
      if (a.path) return { note: notes.find((n) => n.path === a.path), created: false, already: false };
      const title = e.text.replace(/[.!?]+$/, "");
      return { note: meta(`Caixa de entrada/${title}.md`, 0), created: true, already: false };
    },
  };
  (window as any).__calls = calls;
  (window as any).engine = {
    invoke: async (cap: string, args: unknown) => {
      if (!caps[cap] || (cap === "history.toNote" && !withToNote)) throw new Error(`no ${cap}`);
      return caps[cap]!(args);
    },
    has: (cap: string) => cap in caps && (cap !== "history.toNote" || withToNote),
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

async function open(withToNote: boolean) {
  const page = await browser.newPage({ viewport: { width: 760, height: 600 } });
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(String(e)));
  page.on("console", (m) => /Content Security Policy|Refused to/i.test(m.text()) && problems.push(m.text()));
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation", (e) => console.error(`Refused to load: CSP ${e.violatedDirective} ${e.blockedURI}`)));
  await page.addInitScript(fakeEngine, withToNote);
  await page.goto(`http://127.0.0.1:${server.port}/index.html`);
  await page.waitForSelector(".kn-entry");
  return { page, problems };
}

const { page, problems } = await open(true);
const entry = (i: number) => page.locator(".kn-entry").nth(i);

await step("o Histórico sobe com a CSP das views, sem violação nem erro", async () => {
  if ((await page.locator(".kn-entry").count()) !== 2) throw new Error("os 2 ditados não apareceram");
  if (problems.length) throw new Error(problems.join(" | "));
});

await step("“Enviar para nota…” abre o seletor: nota nova em cima, depois as recentes", async () => {
  await entry(0).hover();
  await entry(0).getByRole("button", { name: "Enviar para nota…" }).click();
  await page.waitForSelector(".kn-tonote");
  const items = await page.$$eval(".kn-tonote-item > span", (els) => els.map((e) => e.textContent));
  const want = ["＋ Nota nova", "Ideias", "Migração PACS Central", "2026-11-03"];
  if (JSON.stringify(items) !== JSON.stringify(want)) throw new Error(JSON.stringify(items));
});

if (shots) await page.screenshot({ path: `${shots}/historico-enviar.png` });

await step("nota nova: um clique duplo manda uma vez só, e o aviso diz onde ficou", async () => {
  await page.locator(".kn-tonote-item[data-kind=new]").dblclick();
  await page.waitForSelector(".kn-entry-sent");
  const calls = await page.evaluate(() => (window as any).__calls);
  if (calls.length !== 1 || calls[0].path) throw new Error(JSON.stringify(calls));
  const said = await entry(0).locator(".kn-entry-sent").textContent();
  if (said !== "Virou a nota “Comprar café e açúcar”, em Caixa de entrada") throw new Error(String(said));
  if (await page.$(".kn-tonote")) throw new Error("o seletor não fechou");
});

await step("nota que existe: a busca acha, e o trecho vai para o fim dela", async () => {
  await entry(1).hover();
  await entry(1).getByRole("button", { name: "Enviar para nota…" }).click();
  await page.fill(".kn-tonote .kn-search", "pacs");
  await page.waitForTimeout(300);
  const items = await page.$$eval(".kn-tonote-item > span", (els) => els.map((e) => e.textContent));
  if (JSON.stringify(items) !== JSON.stringify(["＋ Nota nova", "Migração PACS Central"])) throw new Error(JSON.stringify(items));
  await page.locator(".kn-tonote-item", { hasText: "Migração PACS Central" }).click();
  await entry(1).locator(".kn-entry-sent").waitFor();
  const calls = await page.evaluate(() => (window as any).__calls);
  if (calls.at(-1).path !== "Projetos/Migração PACS Central.md") throw new Error(JSON.stringify(calls));
  if ((await entry(1).locator(".kn-entry-sent").textContent()) !== "Foi para o fim de “Migração PACS Central”") throw new Error("aviso");
});

if (shots) await page.screenshot({ path: `${shots}/historico-enviado.png` });

await step("Esc fecha o seletor sem mandar nada", async () => {
  const before = (await page.evaluate(() => (window as any).__calls)).length;
  await entry(0).hover();
  await entry(0).getByRole("button", { name: "Enviar para nota…" }).click();
  await page.waitForSelector(".kn-tonote");
  await page.keyboard.press("Escape");
  await page.waitForSelector(".kn-tonote", { state: "detached" });
  if ((await page.evaluate(() => (window as any).__calls)).length !== before) throw new Error("mandou");
});

await step("sem erro nem violação de CSP no caminho todo", async () => {
  if (problems.length) throw new Error(problems.join(" | "));
});

await step("engine sem history.toNote (UI nova num app velho): o botão não aparece", async () => {
  const old = await open(false);
  await old.page.locator(".kn-entry").first().hover();
  if (await old.page.getByRole("button", { name: "Enviar para nota…" }).count()) throw new Error("o botão apareceu");
  await old.page.close();
});

await browser.close();
server.stop();
console.log(failed ? `\n${failed} passo(s) falharam` : "\ntudo certo");
process.exit(failed ? 1 : 0);
