// O "olho" do agente no diretor (T3065): os frames do SVG em instantes escolhidos, numa prancha só (um PNG). Serve para
// o agente ver o efeito de uma mudança, ou o frame de cada nota do harry com o ponto marcado, sem vaivém de texto.
//
//   bun docs/brand/diretor/quadros.ts --t 2,2.5,3 [--svg ARQ.svg] [--notas] [--largura 300] --out prancha.png
//
// --notas: um frame por nota do direcao.json, no instante dela, com um anel no ponto e o texto embaixo.
// Usa o WebKit do Playwright do app/ (rode `bun install` em app/ antes). Pegue `kiwi lock bench --wait 30m` antes:
// os filtros do SVG pesam no render.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Direcao } from "./animacao.ts";

const raiz = path.resolve(import.meta.dir, "../../..");
const arg = (nome: string) => {
  const i = process.argv.indexOf(nome);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const svgRel = arg("--svg") ?? "docs/brand/kiwi-cat-familia/kiwi-cat-1-aura-intro.svg";
const svg = readFileSync(path.resolve(raiz, svgRel), "utf8");
const out = arg("--out");
const largura = Number(arg("--largura") ?? 300);
if (!out) {
  console.error("quadros: falta --out prancha.png");
  process.exit(2);
}

type Quadro = { t: number; legenda: string; ponto?: { x: number; y: number } };
const quadros: Quadro[] = [];
for (const t of (arg("--t") ?? "").split(",").filter(Boolean)) quadros.push({ t: Number(t), legenda: `${t} s` });
if (process.argv.includes("--notas")) {
  const dAbs = path.join(path.dirname(path.resolve(raiz, svgRel)), "direcao.json");
  const d = existsSync(dAbs) ? (JSON.parse(readFileSync(dAbs, "utf8")) as Direcao) : null;
  for (const n of d?.notas ?? []) quadros.push({ t: n.t, legenda: `${n.t} s · ${n.alvo || "—"}: ${n.texto}`, ponto: { x: n.x, y: n.y } });
}
if (!quadros.length) {
  console.error("quadros: diga os instantes (--t 1,2.5) ou use --notas");
  process.exit(2);
}

// O "reduzir movimento" do SVG desliga tudo; aqui ele sai, como no diretor.
const semReduzir = svg.replace(/@media\s*\(prefers-reduced-motion[^{]*\{[\s\S]*?\}\s*\}/, "");
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const { webkit } = await import(path.join(raiz, "app/node_modules/playwright-core/index.mjs"));
const browser = await webkit.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: largura / 1024 > 0.5 ? 1 : 0.5 });
  await page.route(/^https?:/, (r: { abort(): void }) => r.abort());
  const imgs: string[] = [];
  for (const q of quadros) {
    await page.setContent(`<!doctype html><style>html,body{margin:0;background:#07061a}svg{display:block;width:1024px;height:1024px}</style>${semReduzir}`);
    await page.evaluate((t: number) => {
      for (const a of document.getAnimations()) {
        a.pause();
        a.currentTime = t * 1000;
      }
    }, q.t);
    if (q.ponto) {
      await page.evaluate(({ x, y }: { x: number; y: number }) => {
        const s = document.querySelector("svg")!;
        const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        Object.entries({ cx: x, cy: y, r: 34, fill: "none", stroke: "#ff3b6b", "stroke-width": 8 }).forEach(([k, v]) => c.setAttribute(k, String(v)));
        s.appendChild(c);
      }, q.ponto);
    }
    await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
    imgs.push((await page.screenshot({ type: "png" })).toString("base64"));
  }
  const colunas = Math.min(4, imgs.length);
  const html = `<!doctype html><style>
    body{margin:0;background:#0b0a1f;color:#e9ecff;font:13px -apple-system,system-ui,sans-serif;padding:12px}
    .g{display:grid;grid-template-columns:repeat(${colunas},${largura}px);gap:12px}
    img{width:${largura}px;height:${largura}px;display:block;border-radius:8px}
    p{margin:6px 2px 0;line-height:1.35;width:${largura}px}
  </style><div class="g">${imgs.map((b, i) => `<figure style="margin:0"><img src="data:image/png;base64,${b}"><p>${esc(quadros[i]!.legenda)}</p></figure>`).join("")}</div>`;
  const prancha = await browser.newPage({ viewport: { width: colunas * (largura + 12) + 12, height: 200 } });
  await prancha.setContent(html);
  await prancha.screenshot({ path: path.resolve(out), fullPage: true });
  console.log(`${quadros.length} quadro(s) em ${out}`);
} finally {
  await browser.close();
}
