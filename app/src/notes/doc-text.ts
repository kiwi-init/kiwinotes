// O texto de dentro de um pdf, um docx e um xlsx, para a busca das Notas e o ⌘K (T22218, issue #156, régua item 4).
//
// - Tudo local: o pdf pelo PDF.js que o app já usa, o docx pelo `word/document.xml` e o xlsx pelas células e pelo
//   `sharedStrings.xml`, lidos direto do zip, sem o mammoth nem o SheetJS (mais leves para 200 arquivos de uma vez).
// - Cada pedaço sabe onde está: a página do pdf, o parágrafo do docx (contado de 1, todos os do corpo, como o motor do
//   visualizador) ou a célula do xlsx (a aba e o `A1`). O índice guarda um pedaço por linha, e a linha achada diz onde o arquivo abre.
// - Um teto de caracteres (`maxChars`): passou, o resto fica de fora, e `truncated` diz isso.

import { decodeEntities, pdfjs, pdfPageLines, zipExtract } from "../agent/tools/files.ts";
import { ZIP_LIMITS, zipEntries, type ZipEntry } from "../../ui/notes/files/zipSize.ts";
import { type DocPlace, MAX_VIEW_TEXT_BYTES } from "../shared/file-view.ts";

/** Onde um pedaço do texto está no arquivo. */
export type { DocPlace };

export interface DocSegment {
  at: DocPlace;
  /** O texto do pedaço, numa linha só (as quebras viram espaço). */
  text: string;
}

export interface DocText {
  segments: DocSegment[];
  /** Passou do teto, e o fim ficou de fora. */
  truncated: boolean;
}

/** Os tipos com texto de dentro que não é texto puro. */
export const DOC_TEXT_TYPES = ["pdf", "docx", "xlsx"] as const;
export const isDocText = (p: string): boolean => /\.(pdf|docx|xlsx)$/i.test(p);

/** O arquivo que não dá para ler (quebrado, com senha, grande demais aberto). */
export class DocTextError extends Error {}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** Junta os pedaços até o teto de caracteres. */
class Collector {
  readonly segments: DocSegment[] = [];
  truncated = false;
  private chars = 0;
  constructor(private readonly max: number) {}
  /** `false` quando o teto chegou: quem lê pode parar. */
  add(at: DocPlace, raw: string): boolean {
    if (this.truncated) return false;
    const text = oneLine(raw);
    if (!text) return true;
    if (this.chars + text.length > this.max) {
      this.truncated = true;
      return false;
    }
    this.chars += text.length + 1;
    this.segments.push({ at, text });
    return true;
  }
}

/** O texto de dentro do arquivo, pelo tipo da extensão. Lança `DocTextError` num arquivo que não abre. */
export async function docText(path: string, bytes: Uint8Array, maxChars = MAX_VIEW_TEXT_BYTES): Promise<DocText> {
  const out = new Collector(maxChars);
  const ext = /\.([a-z]+)$/i.exec(path)?.[1]?.toLowerCase();
  if (ext === "pdf") await pdfText(bytes, out);
  else if (ext === "docx") docxText(bytes, out);
  else if (ext === "xlsx") xlsxText(bytes, out);
  else throw new DocTextError(`não é pdf, docx nem xlsx: ${ext ?? "sem extensão"}`);
  return { segments: out.segments, truncated: out.truncated };
}

/** O texto dos pedaços, um por linha: o que o índice guarda. A linha N (de 1) é o pedaço N − 1. */
export const docLines = (d: DocText): string => d.segments.map((s) => s.text).join("\n");

// ── pdf ──────────────────────────────────────────────────────────────────────────────────────────────────────────

async function pdfText(bytes: Uint8Array, out: Collector): Promise<void> {
  const lib = await pdfjs();
  const task = lib.getDocument({ data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  try {
    const doc = await task.promise.catch((e: { name?: string }) => {
      throw new DocTextError(e?.name === "PasswordException" ? "o pdf tem senha" : "não é um pdf que abre");
    });
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const lines = pdfPageLines((await page.getTextContent()).items as never);
      page.cleanup();
      if (!out.add({ page: i }, lines.join(" "))) break;
    }
  } finally {
    await task.destroy().catch(() => {});
  }
}

// ── zip (docx e xlsx) ────────────────────────────────────────────────────────────────────────────────────────────

class Package {
  private readonly entries: Map<string, ZipEntry>;
  constructor(
    private readonly bytes: Uint8Array,
    kind: string,
  ) {
    const list = zipEntries(bytes);
    if (!list) throw new DocTextError(`não é um ${kind} que abre`);
    if (list.length > ZIP_LIMITS.entries) throw new DocTextError(`o ${kind} tem arquivos demais dentro`);
    this.entries = new Map(list.map((e) => [e.name.replace(/^\/+/, ""), e]));
  }
  /** O XML de dentro, ou `null` se não existe. Passou do teto do XML aberto: erro (o zip bomba). */
  xml(name: string): string | null {
    const e = this.entries.get(name);
    if (!e) return null;
    try {
      return new TextDecoder().decode(zipExtract(this.bytes, e, ZIP_LIMITS.xml));
    } catch (err) {
      throw new DocTextError(err instanceof Error ? err.message : String(err));
    }
  }
}

/** O alvo de cada `Id` de um `.rels`, resolvido a partir da pasta da parte. */
function rels(xml: string | null, base: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!xml) return map;
  for (const m of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = attr(m[1]!, "Id");
    const target = attr(m[1]!, "Target");
    if (!id || !target) continue;
    map.set(id, target.startsWith("/") ? target.slice(1) : normalize(`${base}/${target}`));
  }
  return map;
}

function normalize(p: string): string {
  const out: string[] = [];
  for (const part of p.split("/")) {
    if (part === "..") out.pop();
    else if (part && part !== ".") out.push(part);
  }
  return out.join("/");
}

/** Um atributo de uma tag (`r:id`, `name`), já sem as entidades. */
const attrRe = new Map<string, RegExp>();
function attr(attrs: string, name: string): string | undefined {
  let re = attrRe.get(name);
  if (!re) attrRe.set(name, (re = new RegExp(`(?:^|\\s)${name.replace(":", "\\:")}\\s*=\\s*("([^"]*)"|'([^']*)')`)));
  const m = re.exec(attrs);
  if (!m) return undefined;
  const v = m[2] ?? m[3] ?? "";
  return v.includes("&") ? decodeEntities(v) : v;
}

// ── docx ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Os parágrafos do `word/document.xml`, na ordem: o texto dos `<w:t>` (o inserido de uma alteração controlada entra; o
 * excluído, `<w:delText>`, e o código de campo, `<w:instrText>`, não), o tab e a quebra como espaço.
 *
 * O número conta como o motor do visualizador (T22847): todo parágrafo do corpo, o da célula e o do controle de
 * conteúdo também, mesmo o vazio, o só de espaços, o de equação ou o que só segura uma caixa de texto (a lista
 * `paragraphIds` do motor). Só entra no índice o que tem texto. O parágrafo de dentro de outro (a caixa de texto) não
 * conta: o texto dele fica no número do parágrafo que segura a caixa, logo depois do texto deste. A equação (`<m:t>`)
 * fica de fora do texto.
 */
function docxText(bytes: Uint8Array, out: Collector): void {
  const pkg = new Package(bytes, "docx");
  const raw = pkg.xml("word/document.xml");
  if (raw === null) throw new DocTextError("não é um docx que abre");
  // O `mc:Fallback` repete o texto do `mc:Choice` (a caixa de texto do Word novo e a do antigo): fica só um.
  const doc = raw.replace(/<mc:Fallback\b[\s\S]*?<\/mc:Fallback>/g, "");
  // Cada parágrafo aberto guarda o texto dele e os de dentro (a caixa de texto), que saem com o número dele.
  const stack: { text: string; inner: string[] }[] = [];
  let n = 0;
  const tag = /<(\/?)(w:p|w:t|w:tab|w:br|w:cr)\b([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(doc))) {
    const [, close, name, , self] = m;
    if (name === "w:p") {
      if (self) {
        if (!stack.length) n++;
        continue;
      }
      if (!close) {
        stack.push({ text: "", inner: [] });
        continue;
      }
      const p = stack.pop();
      if (!p) continue;
      const texts = [p.text, ...p.inner];
      if (stack.length) stack[stack.length - 1]!.inner.push(...texts);
      else {
        n++;
        for (const text of texts) if (oneLine(text) && !out.add({ paragraph: n }, text)) return;
      }
    } else if (!stack.length || close) {
      continue;
    } else if (name === "w:t") {
      if (self) continue;
      const end = doc.indexOf(`</${name}>`, tag.lastIndex);
      if (end < 0) break;
      stack[stack.length - 1]!.text += decodeEntities(doc.slice(tag.lastIndex, end));
      tag.lastIndex = end + name.length + 3;
    } else {
      stack[stack.length - 1]!.text += " ";
    }
  }
}

// ── xlsx ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A coluna do Excel pelo número (de 0): 0 → A, 25 → Z, 26 → AA. */
export function columnName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** O número (de 0) da coluna de uma referência `AB12`. */
function columnOf(ref: string): number {
  let n = 0;
  for (const ch of /^[A-Z]+/i.exec(ref)?.[0]?.toUpperCase() ?? "") n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** O texto de um `<si>` ou de um `<is>`: os `<t>` juntos, menos a leitura fonética (`<rPh>`). */
const richText = (xml: string) =>
  [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeEntities(t[1]!)).join("");

/**
 * As células de cada aba visível (como o visualizador, que não mostra a aba escondida), na ordem das abas e das
 * linhas: o texto (do `sharedStrings` ou em linha), o número e o resultado guardado da fórmula, como estão no arquivo.
 */
function xlsxText(bytes: Uint8Array, out: Collector): void {
  const pkg = new Package(bytes, "xlsx");
  const book = pkg.xml("xl/workbook.xml");
  if (book === null) throw new DocTextError("não é uma planilha xlsx que abre");
  const targets = rels(pkg.xml("xl/_rels/workbook.xml.rels"), "xl");
  const strings = [...(pkg.xml("xl/sharedStrings.xml") ?? "").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)].map((m) => (m[1] ? richText(m[1]) : ""));
  for (const s of book.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    const a = s[1]!;
    const state = attr(a, "state");
    if (state === "hidden" || state === "veryHidden") continue;
    const name = attr(a, "name") ?? "";
    const target = targets.get(attr(a, "r:id") ?? "");
    const xml = target ? pkg.xml(target) : null;
    if (xml === null) continue;
    let rowNo = 0;
    for (const r of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      rowNo = Number(attr(r[1]!, "r")) || rowNo + 1;
      let col = -1;
      for (const c of (r[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(c[1]!, "r");
        col = ref ? columnOf(ref) : col + 1;
        const body = c[2];
        if (!body) continue;
        const type = attr(c[1]!, "t");
        let value: string;
        if (type === "inlineStr") value = richText(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? "");
        else {
          const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
          if (v === undefined) continue;
          if (type === "s") value = strings[Number(v)] ?? "";
          else if (type === "b") value = v === "1" ? "VERDADEIRO" : "FALSO";
          else value = v.includes("&") ? decodeEntities(v) : v;
        }
        if (!out.add({ sheet: name, cell: `${columnName(col)}${rowNo}` }, value)) return;
      }
    }
  }
}
