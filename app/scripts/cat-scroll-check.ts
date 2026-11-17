// A barra de rolagem não passa pelo gato da janela (spec #13381, T13699). No hub de verdade, com o AppEngine headless e
// o agente falso, num WebKit headless: nada na tela de ninguém, e nenhum Claude Code de verdade.
//
// Em cada tela que rola (as Configurações em cada assunto, as Reuniões com 40 reuniões, as Notas com uma nota longa),
// com o gato no canto: rola cada
// área até o fim e confere que
//   1. o polegar da barra não passa pelo gato e pela névoa (a caixa do `.kn-kiwicat`) nem a menos de 16 px do lado
//      dele, e termina 8 px antes, e
//   2. o último item da área está visível e fora do gato.
// Tira os prints no claro e no escuro, rolados até o fim, com a barra na tela.
//
//   bun scripts/cat-scroll-check.ts [pasta-dos-prints]
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Page } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";
import { fakeRegistry } from "../src/agent/fake/registry";
import { SCROLLBAR_AVOID_GAP as GAP, SCROLLBAR_AVOID_SIDE as SIDE } from "../ui/src/scrollbar";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T13699-rolagem"));
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-cat-scroll-"));
const registry = fakeRegistry([
  { name: "@agentclientprotocol/claude-agent-acp", version: "0.106.0", files: { "dist/index.js": "" } },
  { name: "zod", version: "4.6.7", files: { "index.js": "" } },
]);
const packages = join(data, "packages.json");
writeFileSync(packages, JSON.stringify(registry.pinned));
// 40 reuniões, para a lista de Reuniões rolar, e uma nota longa, para as Notas (escrita por último: a mais recente
// abre sozinha).
mkdirSync(join(data, "vault", "Reuniões"), { recursive: true });
for (let i = 1; i <= 40; i++) {
  const day = `2026-10-${String((i % 28) + 1).padStart(2, "0")}`;
  writeFileSync(join(data, "vault", "Reuniões", `Reunião ${i}.md`), `---\ntype: meeting\nstart: ${day}T10:00:00.000Z\nend: ${day}T10:30:00.000Z\nduration: 1800\n---\n# Reunião ${i}\n\nPauta.\n`);
}
writeFileSync(join(data, "vault", "Longa.md"), `# Longa\n\n${Array.from({ length: 120 }, (_, i) => `Linha ${i + 1} da nota longa, para a área rolar até o fim.`).join("\n\n")}\n\nÚltima linha da nota.\n`);

async function cli(args: string[]) {
  const p = Bun.spawn([process.execPath, join(app, "scripts/cli.ts"), ...args, "--data", data], {
    cwd: app,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, KIWI_FAKE_AGENT: "1", KIWI_ADAPTER_REGISTRY: registry.url, KIWI_ADAPTER_PACKAGES: packages },
  });
  const text = await new Response(p.stdout).text();
  assert.equal(await p.exited, 0, text + (await new Response(p.stderr).text()));
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

type Rect = { left: number; top: number; right: number; bottom: number };
type Area = { name: string; thumb: Rect | null; last: Rect | null; cat: Rect; areaBottom: number };

/**
 * Rola até o fim cada área que rola na seção visível e devolve, de cada uma, o polegar na tela, o último item e o
 * gato. O scroll é de verdade (`scrollTop` e o evento), como a roda faria.
 */
async function scrollAll(p: Page): Promise<Area[]> {
  return p.evaluate(async () => {
    const box = (el: Element): Rect => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    };
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const shown = (el: Element) => (el as HTMLElement).offsetParent !== null || getComputedStyle(el).position === "fixed";
    const areas = [...document.querySelectorAll<HTMLElement>("body *")].filter((el) => {
      const cs = getComputedStyle(el);
      return shown(el) && /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 4 && el.clientHeight > 120;
    });
    const res: Area[] = [];
    for (const el of areas) {
      // Até o fim de verdade: o editor das notas desenha as linhas conforme rola, e a altura cresce no caminho.
      for (let i = 0; i < 40; i++) {
        const before = el.scrollTop;
        el.scrollTop = el.scrollHeight;
        await frame();
        await new Promise((r) => setTimeout(r, 40));
        if (Math.abs(el.scrollTop - before) < 1 && el.scrollTop + el.clientHeight >= el.scrollHeight - 1) break;
      }
      el.dispatchEvent(new Event("scroll"));
      await frame();
      // O polegar desta área: o da camada que está aceso, na altura dela.
      const r = el.getBoundingClientRect();
      const thumb = [...document.querySelectorAll(".kn-scrollbar-y.on")].map(box).find((t) => t.left >= r.left - 1 && t.right <= r.right + 1) ?? null;
      // O último item: o último descendente com tamanho, de baixo para cima.
      let last: Element | null = null;
      for (const c of [...el.querySelectorAll("*")].reverse()) {
        const b = c.getBoundingClientRect();
        if (b.width > 0 && b.height > 0 && getComputedStyle(c).visibility !== "hidden" && !c.closest(".kn-kiwicat")) { last = c; break; }
      }
      const name = `${el.className || el.tagName}`.split(" ")[0]!;
      res.push({ name, thumb, last: last ? box(last) : null, cat: box(document.querySelector(".kn-kiwicat")!), areaBottom: r.bottom });
    }
    return res;
  });
}

const overlaps = (a: Rect, b: Rect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const fails: string[] = [];
function check(where: string, areas: Area[]) {
  assert.ok(areas.length > 0, `${where}: nenhuma área rolou`);
  for (const a of areas) {
    // O gato com a folga: nem por baixo, nem colada ao lado (SIDE), e terminando antes (GAP).
    const cat = { left: a.cat.left - SIDE, top: a.cat.top - GAP, right: a.cat.right + SIDE, bottom: a.cat.bottom + GAP };
    const thumbOk = !a.thumb || !overlaps(a.thumb, cat);
    const lastOk = !!a.last && !overlaps(a.last, a.cat) && a.last.bottom <= a.areaBottom + 1;
    console.log(`${thumbOk && lastOk ? "ok  " : "FALHOU"} ${where} · ${a.name}: polegar ${a.thumb ? `até ${a.thumb.bottom.toFixed(0)} (gato em ${a.cat.top.toFixed(0)})` : "fora"}; último item ${lastOk ? "visível e fora do gato" : "coberto ou fora"}`);
    if (!thumbOk || !lastOk) fails.push(`${where} · ${a.name}`);
  }
}

const browser = await webkit.launch({ headless: true });
try {
  await cli(["start", "--no-helper"]);
  await invoke("agent.enable", { consent: true });
  await invoke("agent.download");
  await invoke("agent.configure", { onboarding: { state: "done" } });
  // O gato fica no canto do hub (o do overlay só entra com o hub atrás; o headless nunca está na frente).
  await invoke("settings.set", { kiwicat: { overlay: false } });
  for (let n = 0; (await invoke("agent.status")).adapter.phase !== "ready"; n++) { assert.ok(n < 200); await Bun.sleep(100); }

  for (const theme of ["light", "dark"] as const) {
    // As Configurações, em cada assunto que rola.
    const w = await openWindow(browser, ctx, { window: "hub", scale: 2, theme, width: 1000, height: 700, motion: false, browser: "webkit", query: { section: "settings" } }, 30000);
    const p = w.page;
    await p.waitForSelector('.kn-kiwicat[data-ready="true"]', { timeout: 30000 });
    const topics = await p.$$eval(".kn-prefs-item", (els) => els.map((e) => (e as HTMLElement).dataset.topic ?? "").filter(Boolean));
    for (const topic of topics) {
      await p.click(`.kn-prefs-item[data-topic="${topic}"]`);
      await p.waitForTimeout(150);
      const areas = await scrollAll(p);
      if (!areas.length) continue;
      check(`Configurações › ${topic} (${theme})`, areas);
      if (topic === "agent") await p.screenshot({ path: join(out, `configuracoes-agente-${theme}.png`) });
    }
    if (w.report.problems.length) console.log("problemas:", w.report.problems.slice(0, 3));
    await w.close();

    // As Reuniões, com a lista longa.
    const m = await openWindow(browser, ctx, { window: "hub", scale: 2, theme, width: 1000, height: 700, motion: false, browser: "webkit", query: { section: "meetings" } }, 30000);
    await m.page.waitForSelector('.kn-kiwicat[data-ready="true"]', { timeout: 30000 });
    await m.page.waitForFunction(() => document.body.innerText.includes("Reunião 40"), null, { timeout: 15000 }).catch(() => {});
    const meetings = await scrollAll(m.page);
    if (meetings.length) {
      check(`Reuniões (${theme})`, meetings);
      await m.page.screenshot({ path: join(out, `reunioes-${theme}.png`) });
    } else console.log(`Reuniões (${theme}): nada rolou`);
    await m.close();

    // As Notas, com a nota longa aberta.
    const n = await openWindow(browser, ctx, { window: "hub", scale: 2, theme, width: 1000, height: 700, motion: false, browser: "webkit", query: { section: "notes" } }, 30000);
    await n.page.waitForSelector('.kn-kiwicat[data-ready="true"]', { timeout: 30000 });
    // A única nota do cofre abre sozinha (a mais recente).
    await n.page.waitForFunction(() => (document.querySelector(".kn-title") as HTMLInputElement | null)?.value === "Longa", null, { timeout: 15000 }).catch(() => {});
    const notes = await scrollAll(n.page);
    if (notes.length) {
      check(`Notas (${theme})`, notes);
      await n.page.screenshot({ path: join(out, `notas-${theme}.png`) });
    } else console.log(`Notas (${theme}): nada rolou (a nota longa não abriu)`);
    await n.close();
  }
} finally {
  await browser.close().catch(() => {});
  await cli(["stop"]).catch(() => {});
  registry.stop();
  rmSync(data, { recursive: true, force: true });
}
console.log(`prints em ${out}`);
if (fails.length) {
  console.log(`FALHOU: ${fails.join("; ")}`);
  process.exit(1);
}
console.log("ok: nenhuma barra passa pelo gato, e o último item de cada tela aparece");
