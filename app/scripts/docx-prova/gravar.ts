// A ida e volta do docx no motor (T21152, spec #21080): abre no WebKit headless, grava sem mexer, edita pela tela
// (clique e teclado, como a pessoa) e grava, reabre o gravado e grava de novo. Compara cada docx com o original, parte
// por parte: o texto de cada parágrafo, os estilos, as tabelas, as imagens, o cabeçalho e o rodapé. Nada aparece na tela.
//   bun scripts/docx-prova/gravar.ts <arquivo.docx> <pasta de saída> [texto onde clicar]
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { webkit } from "playwright-core";

import { diff, summarize } from "./resumo.ts";

const [docPath, outDir, clickText = "abaixo do mínimo"] = process.argv.slice(2) as [string, string, string?];
if (!docPath || !outDir) throw new Error("uso: gravar.ts <arquivo.docx> <pasta de saída>");
mkdirSync(outDir, { recursive: true });

const dist = mkdtempSync(path.join(tmpdir(), "kn-docx-gravar-"));
const built = await Bun.build({ entrypoints: [path.join(import.meta.dir, "entry-gravar.ts")], outdir: dist, target: "browser", splitting: true, minify: true });
if (!built.success) throw new Error(built.logs.join("\n"));
const css = built.outputs.filter((o) => o.path.endsWith(".css")).map((o) => `<link rel="stylesheet" href="/${path.relative(dist, o.path)}">`).join("");
const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#e9ecef}#scroll{height:100%;overflow:auto}</style>${css}<div id="scroll" class="docx-editor docx-editor__scroll-container"><div id="doc" class="docx-paginated-surface"></div></div><script type="module" src="/entry-gravar.js"></script>`;

let current: Uint8Array = readFileSync(docPath);
const server = Bun.serve({
  port: 0,
  fetch(req) {
    const p = new URL(req.url).pathname;
    if (p === "/") return new Response(html, { headers: { "content-type": "text/html" } });
    if (p === "/doc.docx") return new Response(new Blob([current as Uint8Array<ArrayBuffer>]));
    return new Response(Bun.file(path.join(dist, p)));
  },
});
const origin = `http://localhost:${server.port}`;

const browserServer = await webkit.launchServer();
const browser = await webkit.connect(browserServer.wsEndpoint());
const outside: string[] = [];
const errors: string[] = [];

/** Abre `bytes` no motor, roda `edit` (se houver) e devolve o que o `save()` grava. */
async function roundTrip(bytes: Uint8Array, edit?: (page: import("playwright-core").Page) => Promise<void>) {
  current = bytes;
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.route("**/*", (route) => {
    const u = route.request().url();
    if (u.startsWith(origin) || u.startsWith("data:") || u.startsWith("blob:")) return route.continue();
    outside.push(u);
    return route.abort();
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  await page.waitForFunction(() => window.__gravar?.done, null, { timeout: 60_000 });
  const g = await page.evaluate(() => window.__gravar);
  if (!g.ok) throw new Error(`não abriu: ${g.reason}`);
  if (edit) await edit(page);
  const s = await page.evaluate(() => window.__save!());
  await page.close();
  return { bytes: new Uint8Array(Buffer.from(s.b64, "base64")), ms: s.ms, pagesOpen: g.pages!, pagesSaved: s.pages };
}

// --- a edição, pela tela: clique no fim do resumo do 1º mês, escreve, Enter e mais uma frase ---
const ADDED = " A Ana conferiu a contagem de novo.";
const NEW_PARA = "Linha nova escrita no Kiwi.";
async function edit(page: import("playwright-core").Page) {
  const target = page.locator(".docx-page").first().getByText(clickText).first();
  const box = await target.boundingBox();
  if (!box) throw new Error("sem o parágrafo para clicar");
  await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
  await page.keyboard.press("End");
  await page.keyboard.type(ADDED, { delay: 5 });
  await page.keyboard.press("Enter");
  await page.keyboard.type(NEW_PARA, { delay: 5 });
  await page.waitForTimeout(300);
}

const original = new Uint8Array(readFileSync(docPath));
const base = await summarize(original);
const t = Date.now();
const plain = await roundTrip(original);
const edited = await roundTrip(original, edit);
const again = await roundTrip(edited.bytes);
const wall = Date.now() - t;
const name = path.basename(docPath, ".docx");
writeFileSync(path.join(outDir, `${name}-sem-edicao.docx`), plain.bytes);
writeFileSync(path.join(outDir, `${name}-editado.docx`), edited.bytes);
writeFileSync(path.join(outDir, `${name}-reaberto.docx`), again.bytes);

const sPlain = await summarize(plain.bytes);
const sEdited = await summarize(edited.bytes);
const sAgain = await summarize(again.bytes);
const joined = sEdited.paragrafos.join("\n");
console.log(JSON.stringify({
  doc: path.basename(docPath), kb: { original: Math.round(original.length / 1024), semEdicao: Math.round(plain.bytes.length / 1024), editado: Math.round(edited.bytes.length / 1024) },
  paginas: { original: plain.pagesOpen, semEdicao: plain.pagesSaved, editado: edited.pagesSaved, reaberto: again.pagesOpen },
  msDoSave: { semEdicao: plain.ms, editado: edited.ms, reaberto: again.ms }, msTotal: wall,
  edicaoEntrou: { frase: joined.includes(ADDED.trim()), paragrafoNovo: sEdited.paragrafos.includes(NEW_PARA) },
  semEdicaoXOriginal: diff(base, sPlain),
  editadoXOriginal: diff(base, sEdited),
  reabertoXEditado: diff(sEdited, sAgain),
  pedidosDeFora: outside, erros: errors,
}, null, 2));

await browser.close();
await browserServer.close();
server.stop();
rmSync(dist, { recursive: true, force: true });
