// As páginas do docx no motor, uma a uma, para comparar com o PDF que o Word exporta (T21151, spec #21080): o print e o
// texto de cada página, no WebKit headless. Nada aparece na tela.
//   bun scripts/docx-prova/paginas.ts <arquivo.docx> <pasta de saída>
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { webkit } from "playwright-core";

const [docPath, shots, modo = ""] = process.argv.slice(2) as [string, string, string?];
if (!docPath || !shots) throw new Error("uso: paginas.ts <arquivo.docx> <pasta de saída>");
const which = "entry-paginas";
const theme = "light";
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
const page = await browser.newPage({ viewport: { width: 1000, height: 1300 }, deviceScaleFactor: 2 });
await page.route("**/*", (route) => {
  const u = route.request().url();
  return u.startsWith(origin) || u.startsWith("data:") || u.startsWith("blob:") ? route.continue() : route.abort();
});
await page.goto(modo ? `${origin}/?${modo}` : origin);
await page.waitForFunction(() => window.__paginas, null, { timeout: 60_000 });
await page.waitForTimeout(1000);
const total = await page.evaluate(() => window.__paginas!.total);
const paginas: { page: number; text: string }[] = [];
for (let i = 0; i < total; i++) {
  const text = await page.evaluate((n) => window.__paginas!.mostrar(n), i);
  await page.locator("[data-kn-alvo]").screenshot({ path: path.join(shots, `p${i + 1}.png`) });
  paginas.push({ page: i + 1, text });
}
writeFileSync(path.join(shots, "pages.json"), JSON.stringify(paginas));
console.log(total);
await browser.close();
await browserServer.close();
server.stop();
rmSync(dist, { recursive: true, force: true });
