// T15839 (spec #15728, lead #15867): a Início no hub de verdade, com o headless e o agente falso. Nunca abre janela.
// - Agente desligado: a Início é a seção de abertura, com o gato dormindo; o clique abre o menu, e o item leva a
//   Ajustes › Agente.
// - Agente ligado: um gato só. Na Início ele fica no lugar dele no meio da tela; nas Notas, volta ao canto; de novo na
//   Início, volta ao meio. Em nenhum quadro há dois gatos.
// - O campo de falar abre ao lado do gato, no meio, sem cobrir a busca, com a dica do atalho de voz.
// - A busca da Início abre a busca das Notas (o clique e o ⌘K).
// Da raiz do app: `bun scripts/home-hub-check.ts [pasta]` (os prints, claro e escuro).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Page } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";
import { fakeRegistry } from "../src/agent/fake/registry";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T15839-home"));
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-home-hub-"));
const registry = fakeRegistry([
  { name: "@agentclientprotocol/claude-agent-acp", version: "0.106.0", files: { "dist/index.js": "" } },
  { name: "zod", version: "4.6.7", files: { "index.js": "" } },
]);
const packages = join(data, "packages.json");
writeFileSync(packages, JSON.stringify(registry.pinned));
async function cli(args: string[]) {
  const p = Bun.spawn([process.execPath, join(app, "scripts/cli.ts"), ...args, "--data", data], {
    cwd: app, stdout: "pipe", stderr: "pipe", env: { ...process.env, KIWI_FAKE_AGENT: "1", KIWI_ADAPTER_REGISTRY: registry.url, KIWI_ADAPTER_PACKAGES: packages },
  });
  const text = await new Response(p.stdout).text();
  const err = await new Response(p.stderr).text();
  assert.equal(await p.exited, 0, text + err);
  return text;
}
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
async function invoke(cap: string, args: unknown = {}) {
  const r = await ctx.send({ cmd: "invoke", cap, args });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.value as any;
}

type Box = { x: number; y: number; width: number; height: number };
const box = async (p: Page, sel: string): Promise<Box> => {
  const b = await p.locator(sel).first().boundingBox();
  assert.ok(b, `sem caixa: ${sel}`);
  return b;
};
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) <= 1, `${what}: ${a} ≠ ${b}`);
/** Um gato só: o `.kn-kiwicat` do canto, e nenhum outro gato vivo na página (um canvas de gato fora dele). */
async function oneCat(p: Page, what: string) {
  const cats = await p.evaluate(() => ({
    corner: document.querySelectorAll(".kn-kiwicat").length,
    canvases: // Só os que estão na tela: a prévia da cor em Ajustes (`.kn-cat-preview`) fica montada, escondida com a seção.
    [...document.querySelectorAll("canvas")].filter((c) => !c.closest(".kn-kiwicat") && (c as HTMLElement).offsetParent).map((c) => {
      const chain: string[] = [];
      for (let e: Element | null = c; e && chain.length < 6; e = e.parentElement) chain.push(`${e.tagName.toLowerCase()}${e.className && typeof e.className === "string" ? "." + e.className.split(" ").join(".") : ""}${(e as HTMLElement).id ? "#" + (e as HTMLElement).id : ""}`);
      return `${c.width}x${c.height} ${(c as HTMLElement).offsetParent ? "visível" : "escondido"} ${chain.join(" < ")}`;
    }),
    sleeping: [...document.querySelectorAll(".kn-home-asleep")].filter((e) => (e as HTMLElement).offsetParent).length,
  }));
  assert.deepEqual(cats, { corner: 1, canvases: [], sleeping: 0 }, `${what}: ${JSON.stringify(cats)}`);
}
/** O gato está no lugar dele na Início (a caixa do `.kn-kiwicat` em cima do `.kn-home-cat`). */
async function catAtHome(p: Page, what: string) {
  await p.waitForFunction(() => document.querySelector<HTMLElement>(".kn-hub")?.dataset.catAt === "home");
  const [cat, slot] = [await box(p, ".kn-kiwicat"), await box(p, '.kn-hub-pane[data-section="home"] .kn-home-cat')];
  near(cat.x, slot.x, `${what}: x do gato`);
  near(cat.y, slot.y, `${what}: y do gato`);
}
async function catInCorner(p: Page, what: string) {
  await p.waitForFunction(() => !document.querySelector<HTMLElement>(".kn-hub")?.dataset.catAt);
  const [cat, hub] = [await box(p, ".kn-kiwicat"), await box(p, ".kn-hub")];
  near(cat.x + cat.width, hub.x + hub.width - 12, `${what}: direita do gato`);
  near(cat.y + cat.height, hub.y + hub.height - 12, `${what}: base do gato`);
}
const tab = (p: Page, s: string) => p.locator(`[role="tab"][data-section="${s}"]`);

const browser = await webkit.launch({ headless: true });
const checks: string[] = [];
try {
  await cli(["start", "--no-helper"]);
  // O dia, com notas inventadas: a que continua, uma de hoje e uma reunião com ata.
  await invoke("notes.create", { folder: "Projeto X", title: "Plano do lançamento", content: "# Plano do lançamento\n\nFechar a lista de tarefas com a Ana e mandar o rascunho ao Bruno até sexta.\n" });
  await invoke("notes.create", { folder: "Reuniões", title: "Conversa com a Carla", content: `---\ntype: meeting\nstart: "${new Date(Date.now() - 3 * 3600e3).toISOString()}"\nduration: 1500\npeople: [Carla, Ana]\n---\n\nanotações\n` });
  await invoke("notes.create", { folder: "Reuniões", title: "Ata da conversa com a Carla", content: `---\nreuniao: "[[Reuniões/Conversa com a Carla|Conversa com a Carla]]"\n---\n\n## Resumo\n\n- A Carla revisa o texto da página.\n- O lançamento fica para o dia 3.\n` });
  await invoke("notes.create", { folder: "Pessoal", title: "Ideias", content: "# Ideias\n\nUma lista de livros para as férias.\n" });

  for (const theme of ["light", "dark"] as const) {
    if (theme === "dark") {
      await invoke("agent.disable").catch(() => {});
    }
    const w = await openWindow(browser, ctx, { window: "hub", scale: 2, theme, width: 1000, height: 740, motion: false, browser: "webkit", query: {} });
    const p = w.page;
    try {
      // 1. Agente desligado: abre na Início, com o gato dormindo.
      await p.waitForSelector('.kn-hub-pane[data-section="home"]:not([hidden]) .kn-home-asleep');
      await p.waitForSelector(".kn-home-continue");
      assert.equal(await p.locator(".kn-kiwicat").count(), 0);
      await p.screenshot({ path: join(out, `desligado-${theme}.png`) });
      await p.locator(".kn-home-asleep-hit").click();
      await p.waitForSelector(".kn-home-menu");
      await p.screenshot({ path: join(out, `desligado-menu-${theme}.png`) });
      await p.locator(".kn-home-menu-item").click();
      await p.waitForSelector('.kn-hub-pane[data-section="settings"]:not([hidden])');
      checks.push(`${theme}: agente desligado, a Início abre com o gato dormindo, e o menu leva aos Ajustes`);

      // 2. Agente ligado: o gato do canto vem para a Início.
      await invoke("agent.enable", { consent: true });
      await invoke("agent.download");
      await invoke("agent.configure", { onboarding: { state: "done" } });
      await invoke("settings.set", { kiwicat: { overlay: false, show: true } });
      for (let n = 0; (await invoke("agent.status")).adapter.phase !== "ready"; n++) { assert.ok(n < 200); await Bun.sleep(100); }
      await p.waitForSelector('.kn-kiwicat[data-ready="true"]');
      await tab(p, "home").click();
      await catAtHome(p, `${theme} Início`);
      await oneCat(p, `${theme} Início`);
      await p.screenshot({ path: join(out, `inicio-${theme}.png`) });
      // Início → Notas → Início: o gato vai ao canto e volta; nunca dois.
      await tab(p, "notes").click();
      await catInCorner(p, `${theme} Notas`);
      await oneCat(p, `${theme} Notas`);
      await p.screenshot({ path: join(out, `notas-${theme}.png`) });
      await tab(p, "home").click();
      await catAtHome(p, `${theme} Início de novo`);
      await oneCat(p, `${theme} Início de novo`);
      checks.push(`${theme}: Início → Notas → Início, o gato no meio, no canto e no meio, sempre um só`);

      // 3. O campo de falar sai do gato, no meio, sem cobrir a busca, com a dica do atalho de voz.
      await p.locator(".kn-kiwicat-hit").click();
      await p.waitForSelector(".kn-cat-ask");
      const ask = await box(p, ".kn-cat-ask");
      const search = await box(p, ".kn-home-search");
      const cat = await box(p, ".kn-kiwicat");
      assert.ok(!overlaps(ask, search), `o campo cobre a busca: ${JSON.stringify({ ask, search })}`);
      assert.ok(ask.x + ask.width <= cat.x + cat.width && ask.y + ask.height > cat.y, `o campo não sai do gato: ${JSON.stringify({ ask, cat })}`);
      assert.match(await p.locator(".kn-cat-ask-hint").innerText(), /^Ou segure .+ para falar\.$/);
      // O print depois da entrada do balão (a passagem do BubblePresence), não no meio dela.
      await p.evaluate(() => Promise.all(document.querySelector(".kn-bubble-slot")?.getAnimations({ subtree: true }).map((a) => a.finished) ?? []));
      await p.screenshot({ path: join(out, `inicio-falar-${theme}.png`) });
      await p.keyboard.press("Escape");
      await p.waitForSelector(".kn-cat-ask", { state: "detached" });
      checks.push(`${theme}: o campo de falar abre ao lado do gato, sem cobrir a busca, com a dica da voz`);

      // 4. A busca: o clique e o ⌘K levam à busca das Notas.
      await p.locator(".kn-home-search").click();
      await p.waitForSelector(".kn-palette .kn-palette-q");
      await p.keyboard.press("Escape");
      await tab(p, "home").click();
      await catAtHome(p, `${theme} Início antes do ⌘K`);
      await p.keyboard.press("Meta+k");
      await p.waitForSelector(".kn-palette .kn-palette-q");
      await catInCorner(p, `${theme} busca`);
      await oneCat(p, `${theme} busca`);
      checks.push(`${theme}: a busca da Início (clique e ⌘K) abre a das Notas, e o gato volta ao canto`);
      // 5. Os cliques do dia abrem a nota certa nas Notas: o "Continuar" e o "Abrir a ata".
      for (const [sel, title] of [[".kn-home-continue", ["Pessoal", "Uma lista de livros"]], [".kn-home-link", ["Reuniões", "A Carla revisa o texto"]]] as const) {
        await p.keyboard.press("Escape");
        await tab(p, "home").click();
        await p.locator(sel).click();
        // A nota aberta: a pasta e uma linha do texto dela.
        await p.waitForFunction(([folder, line]) => {
          const pane = document.querySelector('.kn-hub-pane[data-section="notes"]:not([hidden])');
          // A pasta é o primeiro texto da seção (o caminho em cima da nota), e a linha está no texto dela.
          return !!pane?.textContent?.startsWith(folder) && pane.textContent.includes(line);
        }, title, { timeout: 8000 }).catch(async (e) => {
          const seen = await p.evaluate(() => {
            const pane = document.querySelector('.kn-hub-pane[data-section="notes"]:not([hidden])');
            return { crumb: pane?.querySelector(".kn-crumb-label")?.textContent ?? null, text: pane?.textContent?.slice(0, 300) ?? null, section: document.querySelector(".kn-hub-pane:not([hidden])")?.getAttribute("data-section") };
          });
          await p.screenshot({ path: join(out, `falhou-abrir-${theme}.png`) });
          throw new Error(`${sel} não abriu ${title.join(" · ")}: ${JSON.stringify(seen)} (${e})`);
        });
      }
      checks.push(`${theme}: o "Continuar" e o "Abrir a ata" abrem a nota nas Notas`);
      assert.deepEqual(w.report.problems, [], "problemas na página");
    } finally {
      await w.close();
    }
  }
  for (const c of checks) console.log(`ok  ${c}`);
  console.log(`prints em ${out}`);
} finally {
  await browser.close();
  await cli(["stop"]).catch(() => {});
  registry.stop(); // o registro falso é um Bun.serve: aberto, o processo não sai
}
