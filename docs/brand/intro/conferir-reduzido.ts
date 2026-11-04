// Confere o "Reduzir movimento" da intro nos dois caminhos (T3898, #4276): o do macOS (prefers-reduced-motion) e o da
// Aparência do app (a cópia em localStorage `kn-appearance`, T2503), sem o do macOS. Nos dois, o ícone pronto tem que
// estar visível (.face e .side com opacidade 1, o palco em .reduced) e a intro tem que terminar sozinha (body.done).
//
//   bun docs/brand/intro/conferir-reduzido.ts      (usa o Playwright do app/; sai com 1 se algum caso falhar)

import { existsSync } from "node:fs";
import path from "node:path";

const here = import.meta.dirname;
const APP = [path.join(here, "../../../app"), path.join(here, "../../../../../kiwinotes/app")].find((d) => existsSync(path.join(d, "node_modules/playwright-core/index.mjs")));
if (!APP) throw new Error("conferir-reduzido: playwright-core não encontrado; rode `bun install` em app/");
const { webkit } = await import(path.join(APP, "node_modules/playwright-core/index.mjs"));
const html = `file://${path.join(here, "intro.html")}`;
const browser = await webkit.launch();
let ok = true;
const casos: [string, { reducedMotion?: "reduce" }, string][] = [
  ["o macOS reduz", { reducedMotion: "reduce" }, ""],
  ["a Aparência do app reduz (o macOS não)", {}, 'localStorage.setItem("kn-appearance", JSON.stringify({ motion: "reduced" }))'],
];
try {
  for (const [nome, opts, antes] of casos) {
    const ctx = await browser.newContext({ viewport: { width: 512, height: 512 }, ...opts });
    const page = await ctx.newPage();
    await page.route(/^https?:/, (r: { abort(): void }) => r.abort());
    if (antes) { await page.goto(html); await page.evaluate(antes); }
    await page.goto(html);
    await page.waitForTimeout(600);
    const r: { stage: string; face: string; side: string } = await page.evaluate(`JSON.stringify({ stage: document.getElementById("stage").className, face: getComputedStyle(document.querySelector(".ly.face")).opacity, side: getComputedStyle(document.querySelector(".ly.side")).opacity })`).then(JSON.parse);
    let done = true;
    try { await page.waitForSelector("body.done", { timeout: 5000 }); } catch { done = false; }
    const passou = r.stage.includes("reduced") && r.face === "1" && r.side === "1" && done;
    if (!passou) ok = false;
    console.log(`conferir-reduzido: ${nome}: palco "${r.stage}", face ${r.face}, lateral ${r.side}, termina ${done ? "sim" : "não"}${passou ? "" : "  ← falhou"}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
if (!ok) process.exit(1);
