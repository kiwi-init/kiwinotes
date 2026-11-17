// T15875 (harry #15873, lead #16013): o menu da aba Início no hub de verdade, com o headless e o agente falso. Nunca
// abre janela, nem liga o mic.
// - A seta da aba abre Início · Pendências · Semana, com os ícones e quantas pendências estão abertas.
// - Trocar pelo menu (clique e teclado) muda o nome e o ícone da aba e o miolo: as Pendências (as caixas abertas das
//   notas e os próximos passos da ata, com o filtro) e a Semana (os números e os 7 dias).
// - O gato fica no meio só na vista Início; na Pendências e na Semana, no canto. Em nenhuma troca há dois gatos.
// - O "Abrir" de uma pendência leva a nota às Notas, e a aba Início volta na mesma vista.
// Da raiz do app: `bun scripts/home-views-check.ts [pasta]` (os prints, claro e escuro). Pegue `kiwi lock bench`.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Page } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";
import { fakeRegistry } from "../src/agent/fake/registry";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T15875-views"));
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-home-views-"));
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
const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) <= 1, `${what}: ${a} ≠ ${b}`);
/** Um gato só: o `.kn-kiwicat` do canto, e nenhum outro gato vivo nem dormindo na página. */
async function oneCat(p: Page, what: string) {
  const cats = await p.evaluate(() => ({
    corner: document.querySelectorAll(".kn-kiwicat").length,
    canvases: [...document.querySelectorAll("canvas")].filter((c) => !c.closest(".kn-kiwicat")).length,
    sleeping: [...document.querySelectorAll(".kn-home-asleep")].filter((e) => (e as HTMLElement).offsetParent).length,
  }));
  assert.deepEqual(cats, { corner: 1, canvases: 0, sleeping: 0 }, `${what}: ${JSON.stringify(cats)}`);
}
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
/**
 * Um gato o tempo todo, não só no fim: um observador conta os gatos a cada quadro desde `start` até `stop`, e o
 * máximo tem de ser 1 (a troca de vista não pode montar o do meio antes de o do canto sair).
 */
const watchCats = (p: Page) => p.evaluate(() => {
  const w = window as unknown as { __cats?: { max: number; run: boolean } };
  w.__cats = { max: 0, run: true };
  const tick = () => {
    if (!w.__cats!.run) return;
    const n = document.querySelectorAll(".kn-kiwicat").length +
      [...document.querySelectorAll("canvas")].filter((c) => !c.closest(".kn-kiwicat")).length +
      [...document.querySelectorAll(".kn-home-asleep")].filter((e) => (e as HTMLElement).offsetParent).length;
    w.__cats!.max = Math.max(w.__cats!.max, n);
    requestAnimationFrame(tick);
  };
  tick();
});
const maxCats = (p: Page) => p.evaluate(() => {
  const w = window as unknown as { __cats: { max: number; run: boolean } };
  w.__cats.run = false;
  return w.__cats.max;
});

const tab = (p: Page, s: string) => p.locator(`[role="tab"][data-section="${s}"]`);
const homePane = '.kn-hub-pane[data-section="home"]';
async function pick(p: Page, view: "inicio" | "pendencias" | "semana") {
  await p.locator(".kn-home-v-chevron").click();
  await p.waitForSelector(".kn-home-v-menu");
  await p.locator(`.kn-home-v-menu [data-view="${view}"]`).click();
  await p.waitForSelector(".kn-home-v-menu", { state: "detached" });
  await p.waitForFunction((v) => document.querySelector<HTMLElement>('[role="tab"][data-section="home"]')?.dataset.view === v, view);
}
const tabLabel = (p: Page) => p.locator('[role="tab"][data-section="home"] .kn-home-v-tab-label').innerText();

const days = (n: number, h = 10) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(h, 0, 0, 0);
  return d.toISOString();
};

const browser = await webkit.launch({ headless: true });
const checks: string[] = [];
try {
  await cli(["start", "--no-helper"]);
  // Notas inventadas: duas com caixas abertas, uma sem nada, uma reunião de anteontem e a ata dela.
  await invoke("notes.create", { folder: "Projeto X", title: "Plano do lançamento", content: "# Plano do lançamento\n\n- [ ] Fechar a lista de tarefas com a Ana\n- [x] Mandar o rascunho ao Bruno\n- [ ] Revisar a página de preços\n" });
  await invoke("notes.create", { folder: "Casa", title: "Mudança", content: "# Mudança\n\n- [ ] Comprar fita e caixas\n- [ ] Levar a geladeira no sábado\n" });
  await invoke("notes.create", { folder: "Pessoal", title: "Ideias", content: "# Ideias\n\nUma lista de livros para as férias.\n" });
  await invoke("notes.create", { folder: "Reuniões", title: "Conversa com a Carla", content: `---\ntype: meeting\ndate: "${days(2).slice(0, 10)}"\nstart: "${days(2, 14)}"\nduration: 1500\nparticipants: [Carla, Ana]\n---\n\nanotações\n` });
  await invoke("notes.create", { folder: "Reuniões", title: "Ata da conversa com a Carla", content: `---\nreuniao: "[[Reuniões/Conversa com a Carla|Conversa com a Carla]]"\n---\n\n## Resumo\n\n- O lançamento fica para o dia 3.\n\n## Próximos passos\n\n- Carla revisa o texto da página\n- [ ] Ana marca a próxima conversa\n` });

  await invoke("agent.enable", { consent: true });
  await invoke("agent.download");
  await invoke("agent.configure", { onboarding: { state: "done" } });
  await invoke("settings.set", { kiwicat: { overlay: false, show: true } });
  for (let n = 0; (await invoke("agent.status")).adapter.phase !== "ready"; n++) { assert.ok(n < 200); await Bun.sleep(100); }

  const pending = await invoke("home.pending");
  assert.deepEqual(pending.total, { meeting: 2, note: 4 }, JSON.stringify(pending));
  const week = await invoke("home.week");
  assert.equal(week.days.length, 7);
  assert.equal(week.totals.meetings, 1);
  checks.push("os dados: 6 pendências (2 da ata, 4 das notas) e a reunião de anteontem na semana");

  for (const theme of ["light", "dark"] as const) {
    const w = await openWindow(browser, ctx, { window: "hub", scale: 2, theme, width: 1000, height: 740, motion: false, browser: "webkit", query: {} });
    const p = w.page;
    try {
      await p.waitForSelector('.kn-kiwicat[data-ready="true"]');
      await p.waitForSelector(`${homePane}:not([hidden]) .kn-home-hero`);
      await catAtHome(p, `${theme} Início`);
      assert.equal(await tabLabel(p), "Início");
      await watchCats(p);

      // 1. A seta abre o menu: os três itens, com ícone, o marcado e o número de pendências.
      await p.locator(".kn-home-v-chevron").click();
      await p.waitForSelector(".kn-home-v-menu");
      const items = await p.locator(".kn-home-v-menu [role=menuitemradio]").evaluateAll((els) =>
        els.map((e) => ({ v: (e as HTMLElement).dataset.view, checked: e.getAttribute("aria-checked"), icon: !!e.querySelector("svg"), text: (e as HTMLElement).innerText.replace(/\s+/g, " ").trim() })));
      assert.deepEqual(items.map((i) => [i.v, i.checked, i.icon]), [["inicio", "true", true], ["pendencias", "false", true], ["semana", "false", true]]);
      await p.waitForFunction(() => document.querySelector(".kn-home-v-count")?.textContent === "6");
      // O menu fica por cima de tudo, até do gato do meio, que fica logo abaixo dele: a ponta de cada item é do menu.
      const covered = await p.evaluate(() => [...document.querySelectorAll(".kn-home-v-menu [role=menuitemradio]")].filter((e) => {
        const r = e.getBoundingClientRect();
        const hit = document.elementFromPoint(r.right - 4, r.bottom - 4);
        return !hit?.closest(".kn-home-v-menu");
      }).length);
      assert.equal(covered, 0, `${theme}: algo cobre o menu`);
      // A janela muda de tamanho com o menu aberto: ele segue a aba.
      await p.setViewportSize({ width: 1200, height: 740 });
      await p.waitForFunction(() => {
        const t = document.querySelector('[role="tab"][data-section="home"]')!.getBoundingClientRect();
        const m = document.querySelector(".kn-home-v-menu")!.getBoundingClientRect();
        return Math.abs(t.left - m.left) <= 1;
      });
      await p.setViewportSize({ width: 1000, height: 740 });
      await p.screenshot({ path: join(out, `menu-${theme}.png`) });
      await p.keyboard.press("Escape");
      await p.waitForSelector(".kn-home-v-menu", { state: "detached" });
      checks.push(`${theme}: a seta abre Início · Pendências (6) · Semana, com os ícones, por cima do gato e seguindo a aba; o Esc fecha`);

      // 2. Pendências pelo clique: a aba muda de nome, o gato vai ao canto, e o filtro separa a ata das notas.
      await pick(p, "pendencias");
      assert.equal(await tabLabel(p), "Pendências");
      await p.waitForSelector(`${homePane} [data-view="pendencias"] .kn-home-v-group`);
      await catInCorner(p, `${theme} Pendências`);
      await oneCat(p, `${theme} Pendências`);
      assert.equal(await p.locator(`${homePane} .kn-home-hero`).count(), 0);
      const groups = await p.locator(".kn-home-v-group").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.origin));
      assert.deepEqual([...groups].sort(), ["meeting", "note", "note"]);
      await p.screenshot({ path: join(out, `pendencias-${theme}.png`) });
      await p.locator('.kn-segmented button:has-text("Reuniões")').click();
      await p.waitForFunction(() => document.querySelectorAll(".kn-home-v-group").length === 1);
      assert.match(await p.locator(".kn-home-v-group").innerText(), /Carla revisa o texto da página[\s\S]*Ana marca a próxima conversa/);
      await p.locator('.kn-segmented button:has-text("Todas")').click();
      checks.push(`${theme}: Pendências pelo menu, a aba diz "Pendências", o gato no canto, e o filtro Reuniões mostra só a ata`);

      // 3. O "Abrir" leva a nota às Notas; a aba Início volta na Pendências.
      await p.locator('.kn-home-v-group[data-path="Casa/Mudança.md"] .kn-home-v-link').first().click();
      await p.waitForSelector('.kn-hub-pane[data-section="notes"]:not([hidden])');
      await p.waitForFunction(() => (document.querySelector('.kn-hub-pane[data-section="notes"]') as HTMLElement | null)?.innerText.includes("Levar a geladeira no sábado"));
      await oneCat(p, `${theme} Notas`);
      await tab(p, "home").click();
      await p.waitForSelector(`${homePane}:not([hidden]) [data-view="pendencias"]`);
      await p.waitForSelector(".kn-home-v-menu", { state: "detached" });
      checks.push(`${theme}: o "Abrir" leva a nota às Notas, e a aba Início volta na Pendências, sem abrir o menu`);

      // 4. Semana pelo teclado: ↓ na aba abre o menu, ↓ anda, Enter escolhe.
      await tab(p, "home").focus();
      await p.keyboard.press("ArrowDown");
      await p.waitForSelector(".kn-home-v-menu");
      assert.equal(await p.evaluate(() => (document.activeElement as HTMLElement)?.dataset.view), "pendencias");
      await p.keyboard.press("ArrowDown");
      await p.keyboard.press("Enter");
      await p.waitForSelector(".kn-home-v-menu", { state: "detached" });
      await p.waitForSelector(`${homePane} [data-view="semana"] .kn-home-v-timeline`);
      assert.equal(await tabLabel(p), "Semana");
      assert.equal(await p.locator(".kn-home-v-timeline > li").count(), 7);
      assert.equal(await p.locator('.kn-home-v-chip[data-kind="meeting"]').count(), 1);
      await catInCorner(p, `${theme} Semana`);
      await oneCat(p, `${theme} Semana`);
      await p.screenshot({ path: join(out, `semana-${theme}.png`) });
      checks.push(`${theme}: Semana pelo teclado, com os 7 dias e a reunião, e o gato no canto`);

      // 5. De volta ao Início: o gato volta ao meio. Em nenhum quadro das trocas houve dois gatos.
      await pick(p, "inicio");
      assert.equal(await tabLabel(p), "Início");
      await catAtHome(p, `${theme} Início de novo`);
      await oneCat(p, `${theme} Início de novo`);
      assert.equal(await maxCats(p), 1, `${theme}: dois gatos em algum quadro das trocas`);
      checks.push(`${theme}: Semana → Início, o gato volta ao meio; nunca dois gatos em quadro nenhum`);
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
  // O registro falso é um servidor: sem o stop, o processo não sai depois dos checks.
  registry.stop();
}
