// Escrever num .txt grande (spec #13382, T13590): o eco de cada tecla, quantas vezes o arquivo é gravado e se o aviso
// de gravação pisca. As Notas de verdade, com o AppEngine headless e um .txt de 1 MB num tmp, num WebKit headless.
// Nada na tela de ninguém.
//
//   bun scripts/txt-typing-check.ts [pasta]
//
// Sai na pasta: `medidas.json` e os prints `txt-claro.png` e `txt-escuro.png` (a quebra de linha na largura da nota).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T13590-txt"));
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-txt-typing-"));
const vault = join(data, "vault");
mkdirSync(vault, { recursive: true });

/** As metas do spec #13382. */
const ECHO_GOAL_MS = 16;
const KEYS = 40;

// Um .txt de 1 MB: linhas longas (passam da largura da nota) e curtas, como anotações de verdade.
const line = (i: number) =>
  i % 5 === 0
    ? `Reunião ${i}: o prazo do legado ficou para março, e a migração dos estudos antigos começa depois do teste com a equipe do PACS, que pediu a lista das pendências e o plano de volta.`
    : `- item ${i} da lista de pendências`;
let big = "";
for (let i = 0; big.length < 1024 * 1024; i++) big += `${line(i)}\n`;
writeFileSync(join(vault, "Grande.txt"), big);
writeFileSync(join(vault, "Curto.txt"), `${line(0)}\n${line(1)}\n${line(5)}\n`);
writeFileSync(join(vault, "Pequeno.txt"), big.slice(0, 4096));

async function cli(args: string[]) {
  const p = Bun.spawn([process.execPath, join(app, "scripts/cli.ts"), ...args, "--data", data], { cwd: app, stdout: "pipe", stderr: "pipe" });
  const text = await new Response(p.stdout).text();
  assert.equal(await p.exited, 0, text + (await new Response(p.stderr).text()));
  return text;
}
const ctx: UiContext = {
  data,
  send: async (msg) => { const r = await request(data, msg); assert.ok(r); return r; },
  subscribe: async (topics, onMsg) => {
    const c = await connect(data, (l) => { if (!("id" in l)) onMsg(l); });
    assert.ok(c);
    c.write({ id: 0, cmd: "subscribe", topics, follow: true, backlog: false });
    return () => c.close();
  },
};

/** O eco num arquivo, sem contar as gravações: só o tempo de cada tecla. */
async function typing(note: string) {
  const w = await openWindow(browser, ctx, { window: "notes", scale: 2, theme: "light", width: 900, height: 640, motion: true, browser: "webkit", query: { note } });
  const ta = w.page.locator(".kn-file-text-area");
  await ta.waitFor({ timeout: 20000 });
  await w.page.evaluate(() => {
    const ta = document.querySelector<HTMLElement>(".kn-file-text-area")!;
    const w = window as unknown as { echo: number[] };
    w.echo = [];
    let t0 = 0;
    ta.addEventListener("keydown", () => (t0 = performance.now()), true);
    ta.addEventListener("input", () => requestAnimationFrame(() => w.echo.push(performance.now() - t0)));
    ta.focus();
  });
  await w.page.keyboard.press("Meta+ArrowDown");
  await w.page.keyboard.type("y".repeat(KEYS), { delay: 40 });
  await Bun.sleep(1200);
  const echo = await w.page.evaluate(() => [...(window as unknown as { echo: number[] }).echo]);
  await w.close();
  return { mediana: Math.round(pct(echo, 0.5) * 10) / 10, p95: Math.round(pct(echo, 0.95) * 10) / 10 };
}
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))]!;
const browser = await webkit.launch({ headless: true });
const result: Record<string, unknown> = {};
let ok = true;
try {
  await cli(["start", "--no-helper"]);
  // O mesmo eco num .txt pequeno: o piso do WebKit headless, sem o tamanho do arquivo.
  result.echoCurto = await typing("Pequeno.txt");
  const w = await openWindow(browser, ctx, { window: "notes", scale: 2, theme: "light", width: 900, height: 640, motion: true, browser: "webkit", query: { note: "Grande.txt" } });
  const p = w.page;
  const area = p.locator(".kn-file-text-area");
  await area.waitFor({ timeout: 20000 });

  // O eco: da tecla (keydown) ao quadro seguinte depois do `input`. E as trocas do aviso de gravação.
  await p.evaluate(() => {
    const ta = document.querySelector<HTMLElement>(".kn-file-text-area")!;
    const w = window as unknown as { echo: number[]; flips: string[] };
    w.echo = [];
    w.flips = [];
    let t0 = 0;
    ta.addEventListener("keydown", () => (t0 = performance.now()), true);
    ta.addEventListener("input", () => requestAnimationFrame(() => w.echo.push(performance.now() - t0)));
    // O aviso de gravação: qualquer coisa que apareça ou mude na área do texto fora do editor (o cursor e as linhas do
    // CodeMirror não contam).
    const box = document.querySelector(".kn-file-text")!;
    const editor = document.querySelector(".kn-file-text-editor")!;
    new MutationObserver((list) => {
      // Um nó que o CodeMirror já trocou (a letra digitada) sai da página antes de o observador rodar: não é aviso.
      for (const m of list) if (m.target.isConnected && !editor.contains(m.target)) w.flips.push(`${m.type} ${(m.target as Element).className ?? ""} ${[...m.addedNodes].map((n) => (n as Element).className ?? n.nodeName).join(",")}: ${((m.target as Element).textContent ?? "").slice(0, 40)}`);
    }).observe(box, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden"] });
    ta.focus();
  });
  await p.keyboard.press("Meta+ArrowDown");
  const saves0 = w.report.invokes["files.save"] ?? 0;
  await p.keyboard.type("x".repeat(KEYS), { delay: 40 });
  await Bun.sleep(1500); // a pausa: o arquivo é gravado depois dela
  const m = await p.evaluate(() => {
    const w = window as unknown as { echo: number[]; flips: string[] };
    return { echo: [...w.echo], flips: [...w.flips] };
  });
  const saves = (w.report.invokes["files.save"] ?? 0) - saves0;
  const disk = readFileSync(join(vault, "Grande.txt"), "utf8");
  result.echo = { teclas: m.echo.length, mediana: Math.round(pct(m.echo, 0.5) * 10) / 10, p95: Math.round(pct(m.echo, 0.95) * 10) / 10, pior: Math.round(Math.max(...m.echo) * 10) / 10, meta: ECHO_GOAL_MS };
  result.gravacoes = saves;
  result.avisoTrocas = m.flips.length;
  if (m.flips.length) result.avisoTextos = m.flips.slice(0, 5);
  result.gravouTudo = disk.endsWith(`${"x".repeat(KEYS)}`) || disk.trimEnd().endsWith("x".repeat(KEYS));
  // A meta (spec #13382): até 16 ms. O eco medido inclui a espera do quadro seguinte (até ~16,7 ms a 60 Hz), então o .txt
  // de 1 MB tem de ecoar como um de 4 KB: a mediana até 16 ms, e o p95 até 4 ms acima do p95 do pequeno.
  const small = result.echoCurto as { mediana: number; p95: number };
  if (pct(m.echo, 0.5) > ECHO_GOAL_MS || pct(m.echo, 0.95) > small.p95 + 4) ok = false;
  if (saves > 2) ok = false;
  if (m.flips.length > 0) ok = false;
  if (!result.gravouTudo) ok = false;
  await w.close();

  // A quebra de linha na largura da nota (print), no claro e no escuro.
  for (const theme of ["light", "dark"] as const) {
    const s = await openWindow(browser, ctx, { window: "notes", scale: 2, theme, width: 900, height: 420, motion: false, browser: "webkit", query: { note: "Curto.txt" } });
    await s.page.locator(".kn-file-text-area").waitFor({ timeout: 20000 });
    const wraps = await s.page.locator(".kn-file-text .cm-scroller").evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
    result[`quebra-${theme}`] = wraps;
    if (!wraps) ok = false;
    await Bun.sleep(200);
    await s.page.screenshot({ path: join(out, `txt-${theme === "light" ? "claro" : "escuro"}.png`) });
    await s.close();
  }
} finally {
  await browser.close();
  await cli(["stop"]).catch(() => {});
  rmSync(data, { recursive: true, force: true });
}
result.ok = ok;
writeFileSync(join(out, "medidas.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
process.exit(ok ? 0 : 1);
