// O resumo de um docx, parte por parte, para comparar dois (T21152, spec #21080): o texto de cada parágrafo, os estilos,
// as tabelas, as imagens, o cabeçalho e o rodapé. Saiu do gravar.ts no T23627, para o teste da escrita do gato usar também.
import { createHash } from "node:crypto";
import path from "node:path";

import JSZip from "jszip";

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

export async function summarize(bytes: Uint8Array) {
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
export type Summary = Awaited<ReturnType<typeof summarize>>;

/** O que mudou de `a` para `b`: as chaves diferentes e, nos parágrafos, os que sumiram, entraram ou mudaram. */
export function diff(a: Summary, b: Summary) {
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
