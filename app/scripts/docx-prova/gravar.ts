// A ida e volta do docx no motor (T21152, spec #21080): abre no WebKit headless, grava sem mexer, edita pela tela
// (clique e teclado, como a pessoa) e grava, reabre o gravado e grava de novo. Compara cada docx com o original, parte
// por parte: o texto de cada parágrafo, os estilos, as tabelas, as imagens, o cabeçalho e o rodapé. Nada aparece na tela.
//   bun scripts/docx-prova/gravar.ts <arquivo.docx> <pasta de saída> [texto onde clicar]
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import JSZip from "jszip";
import { webkit } from "playwright-core";

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

// --- o resumo de um docx, para comparar ---
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex").slice(0, 12);
const xmlText = (p: string) => p.replace(/<w:tab\/>/g, "\t").replace(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g, "\u0000$1\u0000").split("\u0000").filter((_, i) => i % 2 === 1).join("");
const paragraphs = (xml: string) => (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []).map(xmlText);
/** Quantas vezes cada valor aparece: `{ Helvetica: 412, Georgia: 22 }`. */
const values = (xml: string, re: RegExp) => {
  const t: Record<string, number> = {};
  for (const m of xml.matchAll(re)) t[m[1]!] = (t[m[1]!] ?? 0) + 1;
  return Object.fromEntries(Object.entries(t).sort());
};
const count = (xml: string, re: RegExp) => (xml.match(re) ?? []).length;
const fields = (xml: string) => [...xml.matchAll(/(?:w:instr="|<w:instrText[^>]*>)\s*([A-Z]+)/g)].map((m) => m[1]!).sort();

async function summarize(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files).filter((n) => !zip.files[n]!.dir).sort();
  const xml = async (n: string) => (await zip.file(n)?.async("string")) ?? "";
  const doc = await xml("word/document.xml");
  const hf = names.filter((n) => /^word\/(header|footer)\d*\.xml$/.test(n));
  const media: Record<string, string> = {};
  for (const n of names.filter((n) => n.startsWith("word/media/"))) media[path.basename(n)] = sha(await zip.file(n)!.async("uint8array"));
  const hfText: string[] = [];
  const hfFields: string[] = [];
  for (const n of hf) {
    const x = await xml(n);
    hfText.push(...paragraphs(x).filter(Boolean));
    hfFields.push(...fields(x));
  }
  const rels = await xml("word/_rels/document.xml.rels");
  const comments = await xml("word/comments.xml");
  const notes = await xml("word/footnotes.xml");
  return {
    partes: names,
    links: count(doc, /<w:hyperlink[ >]/g),
    destinosDosLinks: values(rels, /Target="([^"]+)"[^>]*TargetMode="External"/g),
    tiposDeRelacao: values(rels, /Type="[^"]*\/([^"/]+)"/g),
    paragrafos: paragraphs(doc),
    tabelas: count(doc, /<w:tbl>/g),
    linhas: count(doc, /<w:tr[ >]/g),
    celulas: count(doc, /<w:tc>/g),
    sombreamento: values(doc, /<w:shd [^>]*w:fill="([^"]+)"/g),
    imagens: count(doc, /<w:drawing>/g),
    tamanhoDasImagens: values(doc, /<wp:extent cx="(\d+" cy="\d+)"/g),
    midia: media,
    negrito: count(doc, /<w:b\/>|<w:b w:val="(?:1|true|on)"\/>/g),
    italico: count(doc, /<w:i\/>|<w:i w:val="(?:1|true|on)"\/>/g),
    cores: values(doc, /<w:color w:val="([0-9A-Fa-f]{6}|auto)"/g),
    fontes: values(doc, /<w:rFonts [^>]*w:ascii="([^"]+)"/g),
    estilos: values(doc, /<w:pStyle w:val="([^"]+)"/g),
    listas: count(doc, /<w:numPr>/g),
    alinhamento: values(doc, /<w:jc w:val="([^"]+)"/g),
    quebraDePagina: count(doc, /<w:pageBreakBefore\/>|<w:pageBreakBefore w:val="(?:1|true|on)"\/>/g),
    // A ordem dos atributos não importa: o motor grava em ordem alfabética.
    margens: [...doc.matchAll(/<w:pgMar ([^/]+)\/>/g)].map((m) => m[1]!.trim().split(/\s+/).sort().join(" ")),
    cabecalhoERodape: hfText,
    comentarios: paragraphs(comments).filter(Boolean),
    autoresDosComentarios: values(comments, /<w:comment [^>]*w:author="([^"]+)"/g),
    marcasDeComentario: [count(doc, /<w:commentRangeStart /g), count(doc, /<w:commentRangeEnd /g), count(doc, /<w:commentReference /g)],
    insercoes: values(doc, /<w:ins [^>]*w:author="([^"]+)"/g),
    remocoes: values(doc, /<w:del [^>]*w:author="([^"]+)"/g),
    textoRemovido: [...doc.matchAll(/<w:delText[^>]*>([^<]*)<\/w:delText>/g)].map((m) => m[1]!),
    notasDeRodape: paragraphs(notes).filter(Boolean),
    chamadasDeNota: count(doc, /<w:footnoteReference /g),
    camposNoCabecalhoERodape: hfFields,
  };
}
type Summary = Awaited<ReturnType<typeof summarize>>;

/** O que mudou de `a` para `b`: as chaves diferentes e, nos parágrafos, os que sumiram, entraram ou mudaram. */
function diff(a: Summary, b: Summary) {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(a) as (keyof Summary)[]) {
    if (k === "paragrafos") continue;
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out[k] = { antes: a[k], depois: b[k] };
  }
  const pa = a.paragrafos, pb = b.paragrafos;
  const changed: { i: number; antes?: string; depois?: string }[] = [];
  let i = 0, j = 0;
  while (i < pa.length || j < pb.length) {
    if (pa[i] === pb[j]) { i++; j++; continue; }
    if (pb[j + 1] !== undefined && pa[i] === pb[j + 1]) { changed.push({ i: j, depois: pb[j] }); j++; continue; }
    if (pa[i + 1] !== undefined && pa[i + 1] === pb[j]) { changed.push({ i, antes: pa[i] }); i++; continue; }
    changed.push({ i, antes: pa[i], depois: pb[j] }); i++; j++;
  }
  if (changed.length) out.paragrafos = { total: [pa.length, pb.length], mudaram: changed.slice(0, 10) };
  return out;
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
