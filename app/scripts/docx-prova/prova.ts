// A prova na tela do motor do docx (T21151, spec #21080, parte 1): abre um docx no WebKit headless e mede o tempo até a
// primeira página, a memória do WebKit e os pedidos de rede, e tira os prints. Nada aparece na tela.
//   bun scripts/docx-prova/prova.ts <arquivo.docx> <pasta dos prints>
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { webkit } from "playwright-core";

const [docPath, shots, which = "entry", theme = "light"] = process.argv.slice(2) as [string, string, string?, string?];
if (!docPath || !shots) throw new Error("uso: prova.ts <arquivo.docx> <pasta dos prints>");
mkdirSync(shots, { recursive: true });

// O pacote da página, como o Vite faria no app: o motor num pedaço separado, carregado só na hora.
const dist = mkdtempSync(path.join(tmpdir(), "kn-docx-prova-"));
const built = await Bun.build({ entrypoints: [path.join(import.meta.dir, `${which}.ts`)], outdir: dist, target: "browser", splitting: true, minify: true });
if (!built.success) throw new Error(built.logs.join("\n"));
const outputs = built.outputs.map((o) => ({ name: path.relative(dist, o.path), size: o.size }));
const css = outputs.filter((o) => o.name.endsWith(".css")).map((o) => `<link rel="stylesheet" href="/${o.name}">`).join("");
const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:${theme === "dark" ? "#1e1f22" : "#e9ecef"}}#scroll{height:100%;overflow:auto}</style>${css}<div id="scroll" class="docx-editor docx-editor__scroll-container${theme === "dark" ? " dark" : ""}"><div id="doc" class="docx-paginated-surface"></div></div><script type="module" src="/${which}.js"></script>`;
const doc = readFileSync(docPath);

const server = Bun.serve({
  port: 0,
  fetch(req) {
    const p = new URL(req.url).pathname;
    if (p === "/") return new Response(html, { headers: { "content-type": "text/html" } });
    if (p === "/doc.docx") return new Response(doc);
    const f = Bun.file(path.join(dist, p));
    return new Response(f);
  },
});
const origin = `http://localhost:${server.port}`;

/**
 * A memória (RSS, MB) do WebKit desta rodada. Os serviços XPC (WebContent, GPU, Networking) ficam pendurados no
 * launchd, não no Playwright: contam os processos do WebKit do Playwright que não existiam antes de abrir o navegador.
 */
const pwProcs = () =>
  Bun.spawnSync(["ps", "-A", "-o", "pid=,rss=,comm="]).stdout.toString().trim().split("\n")
    .map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
    .filter((m): m is RegExpMatchArray => !!m && m[3]!.includes("ms-playwright/webkit"))
    .map((m) => ({ pid: Number(m[1]), rss: Number(m[2]), name: m[3]!.split("/").pop()! }));
const old = new Set(pwProcs().map((p) => p.pid));
function rss(): { total: number; webContent: number } {
  const mine = pwProcs().filter((p) => !old.has(p.pid));
  const mb = (n: number) => Math.round(n / 1024);
  return { total: mb(mine.reduce((s, p) => s + p.rss, 0)), webContent: mb(mine.filter((p) => p.name.includes("WebContent")).reduce((s, p) => s + p.rss, 0)) };
}

const browserServer = await webkit.launchServer();
const browser = await webkit.connect(browserServer.wsEndpoint());
const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2 });
const outside: string[] = [];
await page.route("**/*", (route) => {
  const u = route.request().url();
  if (u.startsWith(origin) || u.startsWith("data:") || u.startsWith("blob:")) return route.continue();
  outside.push(u);
  return route.abort();
});
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto("about:blank");
const before = rss();
const t0 = Date.now();
await page.goto(origin);
await page.waitForFunction(() => window.__prova?.done, null, { timeout: 60_000 });
const wall = Date.now() - t0;
const prova = await page.evaluate(() => window.__prova);
const dom = await page.evaluate(() => {
  const cs = [...document.querySelectorAll("canvas")];
  return { canvas: cs.length, canvasMB: Math.round(cs.reduce((s, c) => s + c.width * c.height * 4, 0) / 1048576), imgs: document.images.length, nodes: document.getElementsByTagName("*").length, pageEls: document.querySelectorAll(".docx-page").length, pageStyle: (() => { const p = document.querySelector<HTMLElement>(".docx-page")!; const c = getComputedStyle(p); const r = p.getBoundingClientRect(); const q = document.querySelectorAll<HTMLElement>(".docx-page")[1]!.getBoundingClientRect(); return { bg: c.backgroundColor, shadow: c.boxShadow, x: r.x, y: r.y, w: r.width, h: r.height, y2: q.y, parent: p.parentElement!.className }; })(), perPage: [...document.querySelectorAll(".docx-page")].map((p) => p.getElementsByTagName("*").length) };
});
await page.waitForTimeout(1500); // as fontes e as imagens que chegam depois
const after = rss();
await page.screenshot({ path: path.join(shots, `pagina-1-${theme}.png`) });
// Rola até a metade do documento, onde estão o gráfico e a tabela de um mês.
const scrolled = await page.evaluate(() => {
  const el = document.getElementById("scroll")!;
  el.scrollTop = el.scrollHeight * 0.42;
  return el.scrollHeight;
});
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(shots, `meio-${theme}.png`) });
const peak = rss();
await page.waitForTimeout(10_000);
const settled = rss();

console.log(JSON.stringify({
  doc: path.basename(docPath), docKB: Math.round(doc.length / 1024),
  ok: prova.ok, reason: prova.reason, pages: prova.pages,
  ms: { carregarMotor: prova.importMs, montar: prova.mountMs, primeiraPagina: prova.firstPageMs, ateProntoNaPagina: wall },
  memoriaMB: { paginaVazia: before, comODocx: after, aposRolar: peak, dezSegundosDepois: settled, doDocxNaWebContent: after.webContent - before.webContent },
  pacoteKB: outputs.map((o) => `${o.name} ${Math.round(o.size / 1024)}`),
  alturaRolavel: scrolled, dom, pedidosDeFora: outside, erros: errors,
}, null, 2));

await browser.close();
await browserServer.close();
server.stop();
rmSync(dist, { recursive: true, force: true });
