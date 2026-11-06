// Dirige os atalhos nas Configurações (T1499, T5349) num navegador headless, sem janela na tela de ninguém. Serve o
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

/**
 * O engine de mentira: as Configurações na memória e cada `settings.set` anotado. `mode`: "old" não tem `settings.*`;
 * "failing" recusa o set. O `shortcuts.record` espera o teste pôr `window.__record` ({shortcut} ou {error}).
 */
function fakeEngine(mode: "ok" | "old" | "failing") {
  const shortcuts = { dictation: "fn", cancel: "escape", pasteLast: "control+option+v", notes: "control+option+n", palette: "command+k", newNote: "command+n", dailyNote: "shift+command+d", meeting: "control+option+r", meetingPause: "control+option+m" };
  let settings: Record<string, unknown> = { shortcuts, notesShortcut: shortcuts.notes };
  const calls: unknown[] = [];
  const listeners: ((s: unknown) => void)[] = [];
  const caps: Record<string, (args: any) => unknown> = {
    "dictionary.get": () => [],
    "snippets.get": () => [],
    "settings.get": () => ({ ...settings }),
    "settings.set": (args) => {
      calls.push(args);
      if (mode === "failing") throw new Error("E_IO");
      settings = { ...settings, ...args, shortcuts: { ...(settings.shortcuts as object), ...args.shortcuts } };
      for (const fn of listeners) fn({ ...settings });
      return { ...settings };
    },
    "shortcuts.record": async (args: { bareKey?: boolean }) => {
      (window as any).__recordArgs = [...((window as any).__recordArgs ?? []), args];
      (window as any).__recording = true;
      while (!(window as any).__record) await new Promise((r) => setTimeout(r, 20));
      const r = (window as any).__record;
      (window as any).__record = undefined;
      (window as any).__recording = false;
      if (r.error) throw Object.assign(new Error(r.error), { code: r.error });
      return { shortcut: r.shortcut };
    },
    "shortcuts.cancelRecord": () => {
      (window as any).__record = { error: "E_CANCELLED" };
      return {};
    },
  };
  const available = (cap: string) => cap in caps && !(mode === "old" && (cap.startsWith("settings.") || cap.startsWith("shortcuts.")));
  (window as any).__calls = calls;
  (window as any).engine = {
    invoke: async (cap: string, args: unknown) => {
      if (!available(cap)) throw new Error(`no ${cap}`);
      return caps[cap]!(args);
    },
    has: available,
    ready: () => {},
    reportError: () => {},
    on: (name: string, fn: (s: unknown) => void) => {
      if (name === "settings.changed") listeners.push(fn);
      return () => {};
    },
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

async function open(mode: "ok" | "old" | "failing", colorScheme: "light" | "dark" = "light") {
  // Sem animação: os prints saem com as seções já no lugar.
  const page = await browser.newPage({ viewport: { width: 760, height: 900 }, colorScheme, reducedMotion: "reduce" });
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(String(e)));
  page.on("console", (m) => /Content Security Policy|Refused to/i.test(m.text()) && problems.push(m.text()));
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation", (e) => console.error(`Refused to load: CSP ${e.violatedDirective} ${e.blockedURI}`)));
  await page.addInitScript(fakeEngine, mode);
  await page.goto(`http://127.0.0.1:${server.port}/index.html`);
  await page.waitForSelector(".kn-segmented");
  return { page, problems };
}

type Page = import("playwright-core").Page;
/** Um print só com as três seções de atalhos, da primeira à última (a página inteira, recortada). */
async function shotShortcuts(page: Page, file: string) {
  if (!shots) return;
  // A janela rola por dentro: uma tela alta mostra tudo de uma vez, e o recorte pega só os atalhos.
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: size.width, height: 4000 });
  const box = await page.evaluate(() => {
    const all = [...document.querySelectorAll(".kn-section")].filter((s) => s.querySelector(".kn-section-title")?.textContent?.startsWith("Atalhos"));
    const top = all[0]!.getBoundingClientRect(), bottom = all.at(-1)!.getBoundingClientRect();
    return { x: Math.max(0, top.left - 8), y: Math.max(0, top.top - 8), width: top.width + 16, height: bottom.bottom - top.top + 16 };
  });
  await page.screenshot({ path: join(shots, file), clip: box });
  await page.setViewportSize(size);
}

/** A linha de um atalho, pelo rótulo. */
const row = (page: Page, label: string) => page.locator(".kn-row", { has: page.locator(".kn-row-label", { hasText: new RegExp(`^${label}$`) }) });
const key = (page: Page, label: string) => row(page, label).locator(".kn-shortcut-key");
const calls = (page: Page) => page.evaluate(() => JSON.stringify((window as any).__calls));
/** Clica na tecla, espera o "Aperte o atalho…" e responde como o helper. */
async function record(page: Page, label: string, answer: { shortcut: string } | { error: string }, shot?: string) {
  await key(page, label).click();
  await row(page, label).getByText("Aperte o atalho…").waitFor();
  if (shot && shots) await row(page, label).screenshot({ path: join(shots, shot) });
  await page.evaluate((a) => ((window as any).__record = a), answer);
  await page.waitForFunction(() => !(window as any).__recording);
}
async function expectKey(page: Page, label: string, text: string) {
  await page.waitForFunction(([l, t]) => [...document.querySelectorAll(".kn-row")].some((r) => r.querySelector(".kn-row-label")?.textContent === l && r.querySelector(".kn-shortcut-key")?.textContent === t), [label, text]);
}

const { page, problems } = await open("ok");

await step("as Configurações sobem com a CSP das views, com todos os atalhos e os padrões (T5349)", async () => {
  await key(page, "Ditar").waitFor();
  const sections = (await page.locator(".kn-section-title").allTextContents()).filter((t) => t.startsWith("Atalhos"));
  if (sections.join(",") !== "Atalhos · Ditado,Atalhos · Notas,Atalhos · Reuniões") throw new Error(sections.join(","));
  const shown: Record<string, string> = {};
  for (const label of ["Ditar", "Cancelar a gravação", "Colar o último ditado", "Abrir as Notas", "Paleta de comandos", "Nova nota", "Nota do dia", "Gravar e parar a reunião", "Pausar meu mic"]) {
    shown[label] = (await key(page, label).textContent()) ?? "";
  }
  const want = { Ditar: "Fn 🌐", "Cancelar a gravação": "Esc", "Colar o último ditado": "⌃⌥V", "Abrir as Notas": "⌃⌥N", "Paleta de comandos": "⌘K", "Nova nota": "⌘N", "Nota do dia": "⇧⌘D", "Gravar e parar a reunião": "⌃⌥R", "Pausar meu mic": "⌃⌥M" };
  if (JSON.stringify(shown) !== JSON.stringify(want)) throw new Error(JSON.stringify(shown));
  // O seletor de mentira de antes (Fn / ⌥ direito, que nunca era salvo) saiu.
  if (await page.getByRole("radiogroup", { name: "Tecla do atalho" }).count()) throw new Error("o seletor antigo ainda está lá");
  await shotShortcuts(page, "01-atalhos-claro.png");
});

await step("gravar o ditado no ⌥ direito: salva, mostra, e aparece o Padrão (o bug do Fn fixo)", async () => {
  await record(page, "Ditar", { shortcut: "rightOption" }, "02-gravando.png");
  await expectKey(page, "Ditar", "⌥ direito");
  if ((await calls(page)) !== '[{"shortcuts":{"dictation":"rightOption"}}]') throw new Error(await calls(page));
  await row(page, "Ditar").getByRole("button", { name: "Padrão" }).waitFor();
});

await step("um atalho de outra ação: avisa, e Usar aqui troca e desliga o outro", async () => {
  await record(page, "Abrir as Notas", { shortcut: "control+option+r" });
  await row(page, "Abrir as Notas").getByText("⌃⌥R já é de “Gravar e parar a reunião”. Usar aqui desliga lá.").waitFor();
  if (shots) await row(page, "Abrir as Notas").screenshot({ path: join(shots, "03-conflito.png") });
  await row(page, "Abrir as Notas").getByRole("button", { name: "Usar aqui" }).click();
  await expectKey(page, "Abrir as Notas", "⌃⌥R");
  await expectKey(page, "Gravar e parar a reunião", "Desligado");
  const got = JSON.parse(await calls(page)).at(-1);
  if (JSON.stringify(got) !== '{"shortcuts":{"notes":"control+option+r","meeting":null}}') throw new Error(JSON.stringify(got));
});

await step("uma sequência e um toque duplo aparecem como se lê", async () => {
  await record(page, "Gravar e parar a reunião", { shortcut: "control+k r r" });
  await expectKey(page, "Gravar e parar a reunião", "⌃K, R, R");
  await record(page, "Pausar meu mic", { shortcut: "double:rightCommand" });
  await expectKey(page, "Pausar meu mic", "⌘ direito duas vezes");
});

await step("Padrão volta ao padrão; Desligar desliga", async () => {
  await row(page, "Ditar").getByRole("button", { name: "Padrão" }).click();
  await expectKey(page, "Ditar", "Fn 🌐");
  await row(page, "Nova nota").getByRole("button", { name: "Desligar" }).click();
  await expectKey(page, "Nova nota", "Desligado");
});

await step("um atalho do app que não é uma combinação (o Fn na paleta) não grava, e diz por quê", async () => {
  const before = await calls(page);
  await record(page, "Paleta de comandos", { shortcut: "fn" });
  await row(page, "Paleta de comandos").getByText("só uma combinação, como ⌘K").waitFor();
  if ((await calls(page)) !== before) throw new Error("gravou");
});

await step("Esc (cancelado) volta sem mudar nada; não é um atalho e sem permissão dizem o que fazer", async () => {
  const before = await calls(page);
  await record(page, "Nota do dia", { error: "E_CANCELLED" });
  await expectKey(page, "Nota do dia", "⇧⌘D");
  await record(page, "Nota do dia", { error: "E_BAD_ARGS" });
  await row(page, "Nota do dia").getByText("Isso não é um atalho").waitFor();
  await record(page, "Nota do dia", { error: "E_NO_HELPER" });
  await row(page, "Nota do dia").getByText("falta a permissão de Monitoramento de Entrada").waitFor();
  if ((await calls(page)) !== before) throw new Error("gravou");
});

await step("o botão Cancelar para a gravação", async () => {
  await key(page, "Ditar").click();
  await row(page, "Ditar").getByRole("button", { name: "Cancelar" }).click();
  await page.waitForFunction(() => !(window as any).__recording);
  await expectKey(page, "Ditar", "Fn 🌐");
});

await step("L5 (T5458): o cancelar grava uma tecla sozinha (⌫), pedindo bareKey ao helper", async () => {
  await record(page, "Cancelar a gravação", { shortcut: "delete" });
  await expectKey(page, "Cancelar a gravação", "⌫");
  const args = await page.evaluate(() => JSON.stringify((window as any).__recordArgs.at(-1)));
  if (args !== '{"bareKey":true}') throw new Error(args);
  const got = JSON.parse(await calls(page)).at(-1);
  if (JSON.stringify(got) !== '{"shortcuts":{"cancel":"delete"}}') throw new Error(JSON.stringify(got));
  if (shots) await row(page, "Cancelar a gravação").screenshot({ path: join(shots, "06-cancelar.png") });
  // Os outros não pedem bareKey.
  await record(page, "Ditar", { error: "E_CANCELLED" });
  const other = await page.evaluate(() => JSON.stringify((window as any).__recordArgs.at(-1)));
  if (other !== "{}") throw new Error(other);
  await row(page, "Cancelar a gravação").getByRole("button", { name: "Padrão" }).click();
  await expectKey(page, "Cancelar a gravação", "Esc");
});

await step("sem erro nem violação de CSP no caminho todo", async () => {
  if (problems.length) throw new Error(problems.join(" | "));
});

await step("escuro: o mesmo, com os tokens do tema", async () => {
  const dark = await open("ok", "dark");
  await key(dark.page, "Ditar").waitFor();
  await dark.page.waitForTimeout(800);
  await shotShortcuts(dark.page, "04-atalhos-escuro.png");
  await record(dark.page, "Abrir as Notas", { shortcut: "control+option+m" });
  await row(dark.page, "Abrir as Notas").getByText("já é de “Pausar meu mic”").waitFor();
  if (shots) await row(dark.page, "Abrir as Notas").screenshot({ path: join(shots, "05-conflito-escuro.png") });
  if (dark.problems.length) throw new Error(dark.problems.join(" | "));
  await dark.page.close();
});

await step("o engine recusa: o atalho fica como estava e avisa", async () => {
  const bad = await open("failing");
  await record(bad.page, "Abrir as Notas", { shortcut: "f5" });
  await bad.page.getByText("Não deu para salvar o atalho").waitFor({ timeout: 3000 });
  await expectKey(bad.page, "Abrir as Notas", "⌃⌥N");
  await bad.page.close();
});

await step("engine sem settings.* (UI nova num app velho): os atalhos não aparecem", async () => {
  const old = await open("old");
  await old.page.waitForTimeout(300);
  if (await old.page.locator(".kn-shortcut").count()) throw new Error("os atalhos apareceram");
  if (old.problems.length) throw new Error(old.problems.join(" | "));
  await old.page.close();
});

await browser.close();
server.stop();
console.log(failed ? `\n${failed} passo(s) falharam` : "\ntudo certo");
process.exit(failed ? 1 : 0);
