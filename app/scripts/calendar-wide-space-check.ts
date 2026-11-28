// T34741 (spec #34706, pontos 1 e 8): o painel largo do Calendário no hub de verdade, com o headless, o agente falso
// (`/diga`) e notas inventadas. Nunca abre janela, nem liga o mic, nem o agente de verdade.
// - Sem espaço morto: com o painel largo aberto, a grade vai até o painel, com a folga de sempre (14 px) e nenhuma
//   faixa vazia, em 4 larguras e nas 4 vistas (Dia, Semana, Mês, Agenda). O painel do Kiwi (`.kn-cal-side`) estica
//   embaixo do painel largo, em vez de guardar o lugar dele ao lado.
// - O Kiwi por cima: com o painel largo aberto e o balão do Kiwi à vista, cada ponto onde o Kiwi ou o balão cruzam o
//   painel mostra o Kiwi (ou o balão), nunca o painel.
// Prints em pt e en. Da raiz do app: `bun scripts/calendar-wide-space-check.ts [pasta]`. Pegue `kiwi lock bench`.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Page } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, peekKiwi, type UiContext } from "./ui-page";
import { fakeRegistry } from "../src/agent/fake/registry";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T34741-calendario"));
mkdirSync(out, { recursive: true });

const WIDTHS = [900, 1100, 1300, 1600];
const VIEWS = ["day", "week", "month", "agenda"] as const;
/** A folga entre a grade e o que fica à direita dela (o `gap` do `.kn-cal-body`). */
const GAP = 14;
const pane = '.kn-hub-pane[data-section="calendar"]';
const item = (title: string) => `${pane} .kn-cal-item:has-text("${title}")`;

/** Os dados de uma língua: o headless, o agente falso pronto e as notas inventadas. */
async function start(lang: "pt" | "en") {
  const data = mkdtempSync(join(tmpdir(), `kiwi-cal-wide-${lang}-`));
  writeFileSync(join(data, "settings.json"), JSON.stringify({ version: 1, firstRun: "done", language: lang }));
  const registry = fakeRegistry([
    { name: "@agentclientprotocol/claude-agent-acp", version: "0.106.0", files: { "dist/index.js": "" } },
    { name: "zod", version: "4.6.7", files: { "index.js": "" } },
  ]);
  const packages = join(data, "packages.json");
  writeFileSync(packages, JSON.stringify(registry.pinned));
  const env = {
    ...process.env, KIWI_FAKE_AGENT: "1", KIWI_ADAPTER_REGISTRY: registry.url, KIWI_ADAPTER_PACKAGES: packages,
    KIWI_SYSTEM_LANG: lang === "en" ? "en-US" : "pt-BR", KIWI_LANGUAGE_CHOICE: "1",
  };
  const cli = async (args: string[]) => {
    const p = Bun.spawn([process.execPath, join(app, "scripts/cli.ts"), ...args, "--data", data], { cwd: app, stdout: "pipe", stderr: "pipe", env });
    const text = await new Response(p.stdout).text();
    const err = await new Response(p.stderr).text();
    assert.equal(await p.exited, 0, text + err);
  };
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
  const invoke = async (cap: string, args: unknown = {}) => {
    const r = await ctx.send({ cmd: "invoke", cap, args });
    assert.equal(r.ok, true, JSON.stringify(r));
    return r.value as any;
  };
  const stop = async () => {
    await cli(["stop"]).catch(() => {});
    rmSync(data, { recursive: true, force: true });
  };
  try {
    await cli(["start", "--no-helper"]);
    await invoke("agent.enable", { consent: true });
    await invoke("agent.download");
    await invoke("agent.configure", { onboarding: { state: "done" } });
    await invoke("settings.set", { kiwicat: { overlay: false, show: true } });
    for (let n = 0; (await invoke("agent.status")).adapter.phase !== "ready"; n++) { assert.ok(n < 200); await Bun.sleep(100); }
    const d = new Date();
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const at14 = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 14).toISOString();
    await invoke("notes.create", { folder: "Projeto X", title: "Pendências", content: `# Pendências\n\n- [ ] Revisar o orçamento @ ${day} 10:00\n- [ ] Escolher o fornecedor\n` });
    await invoke("notes.create", { folder: "Reuniões", title: "Revisão do Projeto X", content: `---\ntype: meeting\ndate: "${day}"\nstart: "${at14}"\nduration: 1800\nparticipants: [Ana, Bruno]\n---\n\nPauta: o orçamento e a data da entrega.\n` });
  } catch (e) {
    await stop();
    throw e;
  }
  return { ctx, invoke, stop };
}

/** O painel largo aberto no item da reunião, parado (o `data-state` sai de `opening` no fim da animação). */
async function openWide(p: Page) {
  const tile = p.locator(item("Revisão do Projeto X")).first();
  await tile.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
  await tile.hover({ position: { x: 8, y: 8 } });
  await p.waitForSelector(`${pane} .kn-cal-card .kn-cal-expand`);
  await p.locator(`${pane} .kn-cal-card .kn-cal-expand`).click();
  await p.waitForSelector(`${pane} .kn-cal-wide[data-state="open"]`);
  // A grade e o painel do Kiwi terminam de mudar junto com o painel largo.
  await p.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
}
async function closeWide(p: Page) {
  await p.locator(`${pane} .kn-cal-collapse`).click();
  await p.waitForSelector(`${pane} .kn-cal-wide`, { state: "detached" });
}

/** A grade, o painel largo e a faixa entre eles. `dead`: o que sobra além da folga de 14 px (tem que ser 0). */
const space = (p: Page) => p.evaluate((sel) => {
  const box = (s: string) => {
    const e = document.querySelector(`${sel} ${s}`);
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return { left: Math.round(b.left * 10) / 10, right: Math.round(b.right * 10) / 10, width: Math.round(b.width * 10) / 10 };
  };
  const main = box(".kn-cal-main")!;
  const wide = box(".kn-cal-wide")!;
  const body = box(".kn-cal-body")!;
  return { main, wide, body, side: box(".kn-cal-side"), between: Math.round((wide.left - main.right) * 10) / 10 };
}, pane);

/**
 * Onde o Kiwi e o balão cruzam o painel largo, quem está por cima em cada ponto (uma grade de 6 × 6 em cada cruzamento).
 * O Kiwi e o balão deixam o clique passar (`pointer-events: none`); só para a medida, eles o pegam de volta.
 */
const onTop = (p: Page) => p.evaluate((sel) => {
  const style = document.createElement("style");
  style.textContent = ".kn-kiwicat, .kn-kiwicat *, .kn-bubble-slot, .kn-bubble-slot * { pointer-events: auto !important; }";
  document.head.append(style);
  try {
    const wide = document.querySelector(`${sel} .kn-cal-wide`)!.getBoundingClientRect();
    const res: { who: string; crossed: number; hidden: { x: number; y: number; top: string }[] } [] = [];
    for (const [who, s] of [["kiwi", ".kn-kiwicat"], ["balão", ".kn-bubble-slot:not([data-phase='exit'])"]] as const) {
      const el = document.querySelector(s);
      const r = el?.getBoundingClientRect();
      const x0 = Math.max(wide.left, r?.left ?? 0) + 2, x1 = Math.min(wide.right, r?.right ?? 0) - 2;
      const y0 = Math.max(wide.top, r?.top ?? 0) + 2, y1 = Math.min(wide.bottom, r?.bottom ?? 0) - 2;
      const hidden: { x: number; y: number; top: string }[] = [];
      let crossed = 0;
      if (el && x1 > x0 && y1 > y0) {
        for (let i = 0; i <= 5; i++) for (let j = 0; j <= 5; j++) {
          const x = x0 + ((x1 - x0) * i) / 5, y = y0 + ((y1 - y0) * j) / 5;
          // Só os pontos do Kiwi (ou do balão) de fato: o desenho dele, não o vazio da caixa.
          const mine = document.elementsFromPoint(x, y).some((e) => el.contains(e) && e !== el);
          if (!mine) continue;
          crossed++;
          const top = document.elementFromPoint(x, y);
          if (!top || !el.contains(top)) hidden.push({ x: Math.round(x), y: Math.round(y), top: top ? `${top.tagName.toLowerCase()}.${[...top.classList].join(".")}` : "nada" });
        }
      }
      res.push({ who, crossed, hidden });
    }
    return res;
  } finally {
    style.remove();
  }
}, pane);

const browser = await webkit.launch({ headless: true });
const checks: string[] = [];
const report: unknown[] = [];
let crossedAny = 0;
try {
  for (const lang of ["pt", "en"] as const) {
    const s = await start(lang);
    try {
      for (const width of WIDTHS) {
        const w = await openWindow(browser, s.ctx, { window: "hub", scale: 2, theme: "light", width, height: 800, motion: false, browser: "webkit", query: { section: "calendar" } });
        const p = w.page;
        try {
          await p.waitForSelector(`${pane}:not([hidden]) .kn-cal`);
          await p.waitForSelector('.kn-kiwicat[data-ready="true"]');
          for (const v of VIEWS) {
            await p.locator(`${pane} .kn-cal-views [data-view="${v}"]`).click();
            await p.waitForSelector(`${pane} .kn-cal[data-view="${v}"]`);
            await p.waitForSelector(item("Revisão do Projeto X"));
            await openWide(p);
            const sp = await space(p);
            report.push({ lang, width, view: v, ...sp });
            // 1. Sem espaço morto: a grade vai até a folga de 14 px antes do painel, nem mais nem menos.
            assert.ok(Math.abs(sp.between - GAP) <= 1, `${lang} ${width} px, ${v}: entre a grade e o painel largo, ${sp.between} px (a folga é ${GAP}): ${JSON.stringify(sp)}`);
            if (lang === "pt" && width === 1300) await p.screenshot({ path: join(out, `largo-${v}-${lang}.png`) });
            await closeWide(p);
          }
          checks.push(`${lang} ${width} px: nas 4 vistas, a grade vai até o painel largo, sem faixa vazia`);
          // 8. O Kiwi por cima: o balão à vista (o mouse no Kiwi), com o painel largo aberto na Semana.
          await p.locator(`${pane} .kn-cal-views [data-view="week"]`).click();
          await openWide(p);
          await s.invoke("agent.ask", { text: `/diga A Ana confirmou a reunião das 14h com o Bruno, e a pauta é o orçamento do Projeto X e a data da entrega.` });
          await peekKiwi(p);
          await p.waitForSelector(".kn-bubble-slot:not([data-phase='exit']) .kn-bubble", { timeout: 30_000 });
          await p.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
          const top = await onTop(p);
          report.push({ lang, width, onTop: top });
          for (const t of top) {
            crossedAny += t.crossed;
            assert.deepEqual(t.hidden, [], `${lang} ${width} px: o painel largo cobre o ${t.who} em ${t.hidden.length} de ${t.crossed} pontos: ${JSON.stringify(t.hidden.slice(0, 3))}`);
          }
          await p.screenshot({ path: join(out, `kiwi-${width}-${lang}.png`) });
          checks.push(`${lang} ${width} px: o Kiwi e o balão por cima do painel largo (${top.map((t) => `${t.who} ${t.crossed} pontos`).join(", ")})`);
          await p.mouse.move(10, 400);
        } finally {
          await w.close();
        }
      }
    } finally {
      await s.stop();
    }
  }
  // O teste não vale se o balão nunca cruza o painel.
  assert.ok(crossedAny > 0, "o balão e o Kiwi nunca cruzaram o painel largo: a medida do ponto 8 não testou nada");
} finally {
  writeFileSync(join(out, "medidas.json"), JSON.stringify(report, null, 2));
  await browser.close();
}
for (const c of checks) console.log(`ok ${c}`);
console.log(`prints e medidas em ${out}`);
