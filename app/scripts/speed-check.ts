// O app não trava (spec #12918, T12943): mede, num cofre grande de teste, as três ações que o harry sentiu lentas na rc18
// e falha se alguma passar da meta. No hub de verdade, com o AppEngine headless e o agente falso, num WebKit headless:
// nada na tela de ninguém, e nenhum Claude Code de verdade.
//
// 1. a troca de Ditado para Configurações (a primeira vez, que monta, e as outras): meta 100 ms;
// 2. o clique numa pasta no passo "Os projetos" do onboarding, até a caixa aparecer marcada: meta 100 ms;
// 3. o dropdown da pasta das Rotinas, do clique ao quadro seguinte: meta 150 ms.
// Em todas, nenhum quadro travado acima de 100 ms. O tempo é medido dentro da página (do clique ao primeiro quadro com
// o resultado), e o quadro mais longo, por um laço de requestAnimationFrame. A meta vale para a mediana das amostras
// (a do tempo e a do pior quadro de cada uma): a máquina é dividida com outros agentes, e uma amostra solta de um
// WebKit frio não é o app. O pior de todos sai no relatório.
//
//   bun scripts/speed-check.ts [--folders N] [--notes N] [--junk N] [--load N] [--runs N] [--no-limits]
//
// `--no-limits` só mede (os números de antes). Sai com exit 1 se alguma meta não bateu.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Page } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";
import { fakeRegistry } from "../src/agent/fake/registry";

const arg = (name: string, def: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : def;
};
const FOLDERS = arg("folders", 2000);
const NOTES = arg("notes", 10000);
const RUNS = arg("runs", 5);
/** Arquivos que não são nota dentro do cofre (um `node_modules` e um `.git` de projeto), como uma pasta pessoal de verdade. */
const JUNK = arg("junk", 0);
/**
 * `--load N`: mede de novo o dropdown e a caixa do onboarding enquanto outro processo escreve N entradas no cofre (um
 * terço num `node_modules`, um terço num `.git`, um terço em `src/`), como um projeto de código clonado ou copiado para
 * dentro dele: o watcher e o índice do Bun trabalham no mesmo processo que responde à tela.
 */
const LOAD = arg("load", 0);
const LIMITS = !process.argv.includes("--no-limits");
/** As metas do spec #12918, em ms. */
export const GOALS = { tab: 100, folder: 100, dropdown: 150, frame: 100 } as const;

const app = resolve(import.meta.dir, "..");
const data = mkdtempSync(join(tmpdir(), "kiwi-speed-"));
const registry = fakeRegistry([
  { name: "@agentclientprotocol/claude-agent-acp", version: "0.106.0", files: { "dist/index.js": "" } },
  { name: "zod", version: "4.6.7", files: { "index.js": "" } },
]);
const packages = join(data, "packages.json");
writeFileSync(packages, JSON.stringify(registry.pinned));

/**
 * O cofre grande: `FOLDERS` pastas (um décimo no primeiro nível, o resto um nível abaixo) e `NOTES` notas curtas
 * espalhadas nelas, como o Mac de alguém que usa o Kiwi há tempo. Escrito antes de o headless subir, que indexa tudo.
 */
function bigVault(root: string) {
  const top = Math.max(1, Math.round(FOLDERS / 10));
  const dirs: string[] = [];
  for (let i = 0; i < top; i++) dirs.push(`Projeto ${String(i).padStart(4, "0")}`);
  for (let i = 0; dirs.length < FOLDERS; i++) dirs.push(`${dirs[i % top]}/Sub ${Math.floor(i / top)}`);
  for (const d of dirs) mkdirSync(join(root, d), { recursive: true });
  for (let i = 0; i < NOTES; i++) {
    const d = dirs[(i * 7) % dirs.length]!;
    writeFileSync(join(root, d, `Nota ${i}.md`), `# Nota ${i}\n\nUma linha de texto da nota ${i}, com [[Nota ${(i + 1) % NOTES}]].\n`);
  }
  // Um projeto de código dentro do cofre: um terço no `node_modules`, um terço no `.git` (que o cofre pula) e um terço
  // em `src/` e `assets/` (que ele lista como arquivos).
  for (let i = 0; i < JUNK; i++) {
    const rel = [`Código/app/node_modules/pkg-${Math.floor(i / 40)}/lib/m${i}.js`, `Código/app/.git/objects/${(i % 256).toString(16).padStart(2, "0")}/o${i}`, `Código/app/${i % 6 ? "src" : "assets"}/m${Math.floor(i / 50)}/f${i}.${i % 6 ? "ts" : "png"}`][i % 3]!;
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), "x");
  }
}

/** O processo que enche o cofre no `--load`: escreve as entradas o mais rápido que dá, fora do processo do app. */
const WRITER = `
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const [root, n] = [process.argv[process.argv.length - 2], Number(process.argv[process.argv.length - 1])];
const made = new Set();
for (let i = 0; i < n; i++) {
  const rel = [\`Zona/clone/node_modules/pkg-\${Math.floor(i / 40)}/lib/m\${i}.js\`, \`Zona/clone/.git/objects/\${(i % 256).toString(16).padStart(2, "0")}/o\${i}\`, \`Zona/clone/src/m\${Math.floor(i / 50)}/f\${i}.ts\`][i % 3];
  const abs = join(root, rel);
  const dir = join(abs, "..");
  if (!made.has(dir)) { mkdirSync(dir, { recursive: true }); made.add(dir); }
  writeFileSync(abs, "x");
}
`;

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

/** O laço de quadros: guarda o instante de cada quadro, para achar o maior intervalo durante uma ação. */
async function frameMonitor(p: Page) {
  await p.evaluate(() => {
    const w = window as any;
    w.__frames = [] as number[];
    const tick = (t: number) => {
      w.__frames.push(t);
      if (w.__frames.length > 20000) w.__frames.splice(0, 10000);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

type Sample = { ms: number; frame: number };
/** O que a página faz: um clique num elemento, ou abrir um `<select>` (mousedown e foco). */
type Act = { click: string; index?: number } | { open: string };
/** Quando o resultado está na tela: um painel do hub visível (e, nas Configurações, com o assunto montado), uma caixa marcada, ou o quadro seguinte. */
type Done = { pane: string } | { checked: string; index: number } | { settled: string; index: number } | { frame: true };
/**
 * Uma ação medida na página. O tempo vai do clique ao primeiro quadro com o resultado; `frame` é o maior intervalo
 * entre quadros nesse meio (e mais 300 ms depois, para pegar o que roda logo em seguida). A CSP do hub não deixa
 * avaliar texto, então a ação e o fim vêm como dados.
 */
async function measure(p: Page, act: Act, done: Done): Promise<Sample> {
  return p.evaluate(
    async ([act, done]) => {
      const w = window as any;
      const nth = (sel: string, i = 0) => document.querySelectorAll<HTMLElement>(sel)[i];
      const ready = (): boolean => {
        if ("frame" in done) return true;
        if ("checked" in done) return !!(nth(done.checked, done.index) as HTMLInputElement | undefined)?.checked;
        if ("settled" in done) {
          const box = nth(done.settled, done.index) as HTMLInputElement | undefined;
          return !!box?.checked && !box.disabled;
        }
        const el = document.querySelector<HTMLElement>(`.kn-hub-pane[data-section="${done.pane}"]`);
        if (!el || el.hidden || el.getBoundingClientRect().height === 0) return false;
        return done.pane !== "settings" || !!el.querySelector(".kn-prefs-topic:not([hidden]) .kn-section");
      };
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const t0 = performance.now();
      if ("click" in act) nth(act.click, act.index)!.click();
      else {
        const s = nth(act.open)!;
        s.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        s.focus();
      }
      const t1 = await new Promise<number>((ok, fail) => {
        const check = () => {
          if (ready()) return ok(performance.now());
          if (performance.now() - t0 > 20000) return fail(new Error(`não aconteceu: ${JSON.stringify(done)}`));
          requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      });
      await new Promise((r) => setTimeout(r, 300));
      const frames: number[] = w.__frames.filter((t: number) => t >= t0 - 20);
      let frame = 0;
      for (let i = 1; i < frames.length; i++) frame = Math.max(frame, frames[i]! - frames[i - 1]!);
      return { ms: t1 - t0, frame };
    },
    [act, done] as const,
  );
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const results: { name: string; goal: number; samples: Sample[] }[] = [];
/** `goal` 0: só informa (não tem meta no spec), não falha. */
function record(name: string, goal: number, samples: Sample[]) {
  if (goal > 0) results.push({ name, goal, samples });
  const ms = samples.map((s) => s.ms);
  const fr = samples.map((s) => s.frame);
  console.log(`${name}: mediana ${median(ms).toFixed(0)} ms, pior ${Math.max(...ms).toFixed(0)} ms (${goal > 0 ? `meta ${goal}` : "sem meta"}); quadro mais longo: mediana ${median(fr).toFixed(0)} ms, pior ${Math.max(...fr).toFixed(0)} ms`);
}

const browser = await webkit.launch({ headless: true });
let failed = false;
try {
  bigVault(join(data, "vault"));
  const t0 = performance.now();
  await cli(["start", "--no-helper"]);
  for (let n = 0; (await invoke("notes.list")).notes.length < NOTES; n++) { assert.ok(n < 600, "o cofre não indexou"); await Bun.sleep(100); }
  console.log(`cofre: ${FOLDERS} pastas, ${NOTES} notas, ${JUNK} arquivos que não são nota, pronto em ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  const listed = await ctx.send({ cmd: "invoke", cap: "notes.list", args: {} });
  console.log(`notes.list: ${(JSON.stringify(listed).length / 1e6).toFixed(1)} MB de resposta`);
  await invoke("agent.enable", { consent: true });
  await invoke("agent.configure", { onboarding: { state: "done" } });
  await invoke("agent.download");
  for (let n = 0; (await invoke("agent.status")).adapter.phase !== "ready"; n++) { assert.ok(n < 200); await Bun.sleep(100); }

  // 1. Ditado → Configurações (no assunto Agente, o mais cheio), e de volta.
  {
    const tab = (s: string): Act => ({ click: `.kn-tab[data-section="${s}"]` });
    const shown = (s: string): Done => ({ pane: s });
    const hub = () => openWindow(browser, ctx, { window: "hub", scale: 1, theme: "light", width: 1100, height: 800, motion: true, browser: "webkit", query: { section: "dictation" } }, 30000);
    // A primeira vez monta as Configurações: uma janela nova a cada amostra.
    const first: Sample[] = [];
    for (let i = 0; i < RUNS; i++) {
      const w = await hub();
      await w.page.evaluate(() => localStorage.setItem("kn-settings-topic", "agent"));
      await frameMonitor(w.page);
      await Bun.sleep(500);
      first.push(await measure(w.page, tab("settings"), shown("settings")));
      failed ||= w.report.problems.length > 0;
      await w.close();
    }
    record("1a. Ditado → Configurações, a primeira vez", GOALS.tab, first);
    const w = await hub();
    const p = w.page;
    await p.evaluate(() => localStorage.setItem("kn-settings-topic", "agent"));
    await frameMonitor(p);
    await measure(p, tab("settings"), shown("settings"));
    const again: Sample[] = [];
    for (let i = 0; i < RUNS; i++) {
      await measure(p, tab("dictation"), shown("dictation"));
      again.push(await measure(p, tab("settings"), shown("settings")));
    }
    record("1b. Ditado → Configurações, as outras vezes", GOALS.tab, again);
    const meet: Sample[] = [];
    for (let i = 0; i < RUNS; i++) {
      await measure(p, tab("meetings"), shown("meetings"));
      meet.push(await measure(p, tab("settings"), shown("settings")));
    }
    record("1c. Reuniões → Configurações", GOALS.tab, meet);

    // 3. O dropdown da pasta das Rotinas: do clique ao quadro seguinte.
    const sel = `.kn-routine-card[data-routine=daily] select[aria-label$="a pasta"]`;
    await p.waitForSelector(sel, { timeout: 30000 });
    await p.locator(sel).scrollIntoViewIfNeeded();
    await p.waitForFunction((s) => (document.querySelector(s) as HTMLSelectElement).options.length > 1, sel, { timeout: 30000 });
    console.log(`dropdown da pasta: ${await p.locator(`${sel} option`).count()} opções`);
    const drop: Sample[] = [];
    for (let i = 0; i < RUNS; i++) {
      drop.push(await measure(p, { open: sel }, { frame: true }));
      await p.evaluate((s) => (document.querySelector(s) as HTMLSelectElement).blur(), sel);
    }
    record("3. O dropdown da pasta das Rotinas", GOALS.dropdown, drop);
    failed ||= w.report.problems.length > 0;
    if (w.report.problems.length) console.log("problemas:", w.report.problems);
    await w.close();
  }

  // 2. O passo "Os projetos" do onboarding: marcar e desmarcar uma pasta.
  {
    await invoke("agent.configure", { onboarding: { state: "open", step: 6 } });
    const w = await openWindow(browser, ctx, { window: "hub", scale: 1, theme: "light", width: 1100, height: 800, motion: true, browser: "webkit", query: { section: "dictation" } }, 30000);
    const p = w.page;
    await p.waitForSelector(".kn-onb-folders input[type=checkbox]", { timeout: 60000 });
    console.log(`passo dos projetos: ${await p.locator(".kn-onb-folders input[type=checkbox]").count()} pastas`);
    await frameMonitor(p);
    const box = ".kn-onb-folders input[type=checkbox]";
    const clicks: Sample[] = [];
    for (let i = 0; i < RUNS; i++) {
      clicks.push(await measure(p, { click: box, index: i }, { checked: box, index: i }));
      // Espera o fim (a nota principal nasce e a lista recarrega) antes da próxima.
      await p.waitForFunction((i) => !(document.querySelectorAll(".kn-onb-folders input[type=checkbox]")[i] as HTMLInputElement).disabled, i, { timeout: 30000 });
      await Bun.sleep(500);
    }
    record("2. Marcar uma pasta no onboarding", GOALS.folder, clicks);
    failed ||= w.report.problems.length > 0;
    if (w.report.problems.length) console.log("problemas:", w.report.problems);
    await w.close();
  }

  // 4. Com o cofre enchendo (`--load`): o dropdown, a caixa e o Bun respondendo, enquanto o watcher e o índice trabalham.
  if (LOAD > 0) {
    const writer = Bun.spawn([process.execPath, "-e", WRITER, join(data, "vault"), String(LOAD)], { stdout: "ignore", stderr: "inherit" });
    const pings: number[] = [];
    let pinging = true;
    const pinger = (async () => {
      while (pinging) {
        const t = performance.now();
        await invoke("notes.folders");
        pings.push(performance.now() - t);
        await Bun.sleep(100);
      }
    })();
    await Bun.sleep(1500);
    const tag = `com ${LOAD} entradas chegando no cofre`;
    {
      await invoke("agent.configure", { onboarding: { state: "done" } });
      const w = await openWindow(browser, ctx, { window: "hub", scale: 1, theme: "light", width: 1100, height: 800, motion: true, browser: "webkit", query: { section: "settings", topic: "agent" } }, 60000);
      const p = w.page;
      const sel = `.kn-routine-card[data-routine=daily] select[aria-label$="a pasta"]`;
      await p.waitForSelector(sel, { timeout: 60000 });
      await frameMonitor(p);
      const drop: Sample[] = [];
      for (let i = 0; i < RUNS; i++) {
        drop.push(await measure(p, { open: sel }, { frame: true }));
        await p.evaluate((s) => (document.querySelector(s) as HTMLSelectElement).blur(), sel);
      }
      record(`3L. O dropdown da pasta das Rotinas, ${tag}`, GOALS.dropdown, drop);
      await w.close();
    }
    {
      await invoke("agent.configure", { onboarding: { state: "open", step: 6 } });
      const w = await openWindow(browser, ctx, { window: "hub", scale: 1, theme: "light", width: 1100, height: 800, motion: true, browser: "webkit", query: { section: "dictation" } }, 60000);
      const p = w.page;
      const box = ".kn-onb-folders input[type=checkbox]";
      await p.waitForSelector(box, { timeout: 60000 });
      await frameMonitor(p);
      const clicks: Sample[] = [];
      const confirmed: Sample[] = [];
      // Pastas que a seção 2 não marcou (a "Zona" do clone vai para o fim da lista, que fica na mesma ordem).
      for (let i = RUNS; i < 2 * RUNS; i++) {
        clicks.push(await measure(p, { click: box, index: i }, { checked: box, index: i }));
        confirmed.push(await measure(p, { click: box, index: i + RUNS }, { settled: box, index: i + RUNS }));
      }
      record(`2L. Marcar uma pasta no onboarding, ${tag}`, GOALS.folder, clicks);
      record(`2L'. Marcar e o Kiwi confirmar (a nota principal criada), ${tag}`, 0, confirmed);
      await w.close();
    }
    const during = writer.exitCode === null;
    // O watcher viu a escrita: os arquivos de `src/` do clone já estão no índice.
    const seen = ((await invoke("notes.list")).files as { path: string }[] | undefined)?.filter((f) => f.path.startsWith("Zona/")).length ?? 0;
    pinging = false;
    await pinger;
    writer.kill();
    await writer.exited;
    const sorted = [...pings].sort((a, b) => a - b);
    console.log(
      `o Bun, ${tag}: ${pings.length} chamadas, mediana ${median(pings).toFixed(0)} ms, p95 ${sorted[Math.floor(sorted.length * 0.95)]!.toFixed(0)} ms, pior ${Math.max(...pings).toFixed(0)} ms` +
        (during ? "; a escrita ainda rodava no fim" : "; a escrita ACABOU antes do fim das medidas") +
        `; o índice já tinha ${seen} arquivos do clone`,
    );
  }

  for (const r of results) {
    const ms = median(r.samples.map((s) => s.ms));
    const frame = median(r.samples.map((s) => s.frame));
    if (ms > r.goal || frame > GOALS.frame) {
      console.log(`✗ ${r.name}: mediana ${ms.toFixed(0)} ms (meta ${r.goal}), quadro ${frame.toFixed(0)} ms (meta ${GOALS.frame})`);
      failed = true;
    }
  }
} finally {
  await browser.close().catch(() => {});
  await cli(["stop"]).catch(() => {});
  registry.stop();
  rmSync(data, { recursive: true, force: true });
}
if (failed && LIMITS) process.exit(1);
console.log(LIMITS ? "ok: as três ações bateram as metas" : "medido (sem conferir as metas)");
