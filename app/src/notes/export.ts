// Exportar uma nota (T2684, spec #2457 ponto 3, item 8 do top 10 do T2512): em Markdown (com os anexos ao lado), em
// HTML (um arquivo só, com o tema de agora e os anexos embutidos) e em PDF (o mesmo HTML impresso pelo WebKit do helper,
// `kiwi-helper --export-pdf`, fora da tela). Tudo local: nada sai do Mac.
//
// O HTML sai do Markdown pelo parser do CodeMirror (`@lezer/markdown`, com o GFM), o mesmo que o editor usa, e não por
// uma lib de fora. O que é do Obsidian (`[[link]]`, `![[anexo]]`, `#tag`, `%%comentário%%`) é tratado aqui. Nada do
// texto vira HTML cru: as tags HTML da nota saem como texto, e os links só abrem http, https e mailto.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import type { SyntaxNode } from "@lezer/common";
import { GFM, parser as baseParser } from "@lezer/markdown";

import { ATTACHMENT_TYPES, extOf, listAttachments, MAX_ATTACHMENT_BYTES, resolveAttachment } from "./attachments.ts";
import { inside, VaultError } from "./paths.ts";

const md = baseParser.configure(GFM);

/** O frontmatter do topo (`---` … `---`). */
export function stripFrontmatter(content: string): string {
  const m = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(content);
  return m ? content.slice(m[0].length) : content;
}

/** Os `%%comentários%%` do Obsidian somem do que é exportado (eles não aparecem na nota lida). */
export function stripComments(text: string): string {
  return text.replace(/%%[\s\S]*?%%/g, "");
}

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Só os endereços que podem abrir fora: o resto do link vira texto. */
function safeHref(url: string): string | null {
  const u = url.trim().replace(/^<|>$/g, "");
  return /^(https?:|mailto:)/i.test(u) ? u : null;
}

export interface HtmlOptions {
  /** O `data:` URL de um anexo (`![[foto.png]]`, ou `![](Anexos/foto.png)`), ou null se não existe. */
  embed(target: string): string | null;
}

const WIKI = /(!?)\[\[([^[\]|#\n]+)(#[^[\]|\n]*)?(\|[^[\]\n]*)?\]\]/g;
const TAG = /(^|[\s(])#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu;

/**
 * O parser do CommonMark lê `[[x]]` como colchete e link, então os `[[links]]` e os `![[anexos]]` viram marcadores
 * (`\uE000n\uE001`, da área de uso privado) antes de analisar, e voltam ao desenhar: como HTML no texto, e como o
 * original dentro de código.
 */
const HOLE = /\uE000(\d+)\uE001/g;

function wikiHtml(raw: string, o: HtmlOptions): string {
  const m = new RegExp(WIKI.source).exec(raw)!;
  const [, bang, target, , alias] = m;
  const shown = alias ? alias.slice(1).trim() : target!.trim();
  if (!bang) return `<span class="kn-wikilink">${escapeHtml(shown)}</span>`;
  const src = o.embed(target!.trim());
  return src ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(shown)}">` : `<span class="kn-missing">${escapeHtml(shown)}</span>`;
}

const tags = (escaped: string) => escaped.replace(TAG, (_m, pre: string, t: string) => `${pre}<span class="kn-tag">#${t}</span>`);

/** O Markdown da nota (sem o frontmatter) em HTML, só o corpo. */
export function markdownToHtml(markdown: string, o: HtmlOptions): string {
  const wikis: string[] = [];
  const doc = stripComments(markdown).replace(WIKI, (m) => `\uE000${wikis.push(m) - 1}\uE001`);
  const tree = md.parse(doc);
  /** O texto da nota como foi escrito (para código e para o `alt` das imagens). */
  const text = (from: number, to: number) => doc.slice(from, to).replace(HOLE, (_m, i: string) => wikis[Number(i)] ?? "");
  /** O texto solto entre os nós: escapado, com os `[[links]]`, os `![[anexos]]` e as `#tags` do Obsidian. */
  const inlineText = (raw: string) => {
    let out = "";
    let last = 0;
    for (const m of raw.matchAll(HOLE)) {
      out += tags(escapeHtml(raw.slice(last, m.index)));
      out += wikiHtml(wikis[Number(m[1])] ?? "", o);
      last = m.index! + m[0].length;
    }
    return out + tags(escapeHtml(raw.slice(last)));
  };
  const gap = (from: number, to: number) => doc.slice(from, to);

  /** Os filhos de um nó, com o texto entre eles; `skip` são as marcas (`**`, `#`, `>`…). */
  const children = (node: SyntaxNode, skip: (n: SyntaxNode) => boolean = isMark, from = node.from, to = node.to): string => {
    let out = "";
    let pos = from;
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.to <= from || c.from >= to) continue;
      if (c.from > pos) out += inlineText(gap(pos, c.from));
      out += skip(c) ? "" : render(c);
      pos = Math.max(pos, c.to);
    }
    if (pos < to) out += inlineText(gap(pos, to));
    return out;
  };

  const render = (n: SyntaxNode): string => {
    const name = n.name;
    const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(name);
    if (heading) return `<h${heading[1]}>${children(n).trim()}</h${heading[1]}>\n`;
    switch (name) {
      case "Document":
        return blocks(n);
      case "Paragraph":
        return `<p>${children(n).trim()}</p>\n`;
      case "Blockquote":
        return `<blockquote>\n${blocks(n)}</blockquote>\n`;
      case "BulletList":
        return `<ul>\n${blocks(n)}</ul>\n`;
      case "OrderedList":
        return `<ol>\n${blocks(n)}</ol>\n`;
      case "ListItem": {
        const task = n.getChild("Task") ?? n.getChild("Paragraph")?.getChild("Task");
        // Um item de um parágrafo só (a lista "apertada"): sem o <p> em volta.
        const inner = blocks(n).trim();
        const single = /^<p>([\s\S]*)<\/p>$/.exec(inner);
        return `<li${task ? ' class="kn-task"' : ""}>${single && !single[1]!.includes("<p>") ? single[1] : inner}</li>\n`;
      }
      case "Task": {
        const marker = n.getChild("TaskMarker");
        const done = marker ? /x/i.test(text(marker.from, marker.to)) : false;
        // Um caractere, e não um <input>: o checkbox nativo sai escuro no PDF e muda de cara em cada leitor.
        return `<span class="kn-box"${done ? " data-done" : ""}>${done ? "☑" : "☐"}</span> ${children(n, (c) => c.name === "TaskMarker" || isMark(c)).trim()}`;
      }
      case "FencedCode":
      case "CodeBlock": {
        const code = n.getChild("CodeText");
        const body = code ? text(code.from, code.to) : text(n.from, n.to).replace(/^ {4}/gm, "");
        const info = n.getChild("CodeInfo");
        const lang = info ? ` class="language-${escapeHtml(text(info.from, info.to).trim())}"` : "";
        return `<pre><code${lang}>${escapeHtml(body)}</code></pre>\n`;
      }
      case "HorizontalRule":
        return "<hr>\n";
      case "Table":
        return `<table>\n${blocks(n)}</table>\n`;
      case "TableHeader":
        return `<thead><tr>${cells(n, "th")}</tr></thead>\n`;
      case "TableRow":
        return `<tr>${cells(n, "td")}</tr>\n`;
      case "Emphasis":
        return `<em>${children(n)}</em>`;
      case "StrongEmphasis":
        return `<strong>${children(n)}</strong>`;
      case "Strikethrough":
        return `<del>${children(n)}</del>`;
      case "InlineCode": {
        const marks = n.getChildren("CodeMark");
        const from = marks[0]?.to ?? n.from;
        const to = marks.at(-1) && marks.length > 1 ? marks.at(-1)!.from : n.to;
        return `<code>${escapeHtml(text(from, to))}</code>`;
      }
      case "Link":
      case "Image": {
        const url = n.getChild("URL");
        const marks = n.getChildren("LinkMark");
        const labelFrom = marks[0]?.to ?? n.from;
        const labelTo = marks[1]?.from ?? n.to;
        const label = children(n, (c) => c.name === "URL" || c.name === "LinkTitle" || isMark(c), labelFrom, labelTo);
        const href = url ? text(url.from, url.to) : "";
        if (name === "Image") {
          const src = o.embed(decodeURIComponent(href)) ?? (safeHref(href) ? href : null);
          return src ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(text(labelFrom, labelTo))}">` : `<span class="kn-missing">${label}</span>`;
        }
        const safe = safeHref(href);
        return safe ? `<a href="${escapeHtml(safe)}">${label}</a>` : label;
      }
      case "Autolink":
      case "URL": {
        const u = name === "URL" ? text(n.from, n.to) : text(n.from + 1, n.to - 1);
        const safe = safeHref(u) ?? (/^www\./i.test(u) ? `https://${u}` : null);
        return safe ? `<a href="${escapeHtml(safe)}">${escapeHtml(u)}</a>` : escapeHtml(u);
      }
      case "HardBreak":
        return "<br>\n";
      case "Escape":
        return escapeHtml(text(n.from + 1, n.to));
      case "Entity":
        return text(n.from, n.to);
      default:
        // HTML da nota, comentário HTML e o que não conhecemos: texto, nunca HTML cru.
        return escapeHtml(text(n.from, n.to));
    }
  };

  /** Um bloco: os filhos, sem o texto entre eles (as quebras de linha e as marcas de lista e de citação). */
  const blocks = (n: SyntaxNode): string => {
    let out = "";
    for (let c = n.firstChild; c; c = c.nextSibling) if (!isMark(c)) out += render(c);
    return out;
  };

  const cells = (row: SyntaxNode, tag: "th" | "td"): string =>
    row.getChildren("TableCell").map((c) => `<${tag}>${children(c).trim()}</${tag}>`).join("");

  return render(tree.topNode);
}

const MARKS = new Set(["EmphasisMark", "CodeMark", "HeaderMark", "QuoteMark", "ListMark", "LinkMark", "TableDelimiter", "StrikethroughMark", "CodeInfo", "LinkLabel", "LinkTitle"]);
const isMark = (n: SyntaxNode) => MARKS.has(n.name);

/** As variáveis de tema que a janela manda (`--bg`, `--ink`…): só nome e valor que não fecham o `<style>`. */
export function themeStyle(vars: unknown): string {
  if (!vars || typeof vars !== "object") return "";
  const out: string[] = [];
  for (const [k, v] of Object.entries(vars as Record<string, unknown>).slice(0, 120)) {
    if (/^--[a-z0-9-]{1,40}$/.test(k) && typeof v === "string" && v.length <= 300 && !/[<>{};]|\/\*/.test(v)) out.push(`${k}: ${v};`);
  }
  return out.length ? `:root { ${out.join(" ")} }` : "";
}

/** O documento HTML inteiro: o título, o corpo e o CSS de leitura, com as cores do tema de agora. */
export function htmlDocument(title: string, bodyHtml: string, vars?: unknown): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Kiwi Notes">
<title>${escapeHtml(title)}</title>
<style>
:root { --bg: #ffffff; --ink: #18181b; --ink-2: #56565e; --ink-3: #6c6c74; --line: rgb(0 0 0 / 0.08); --accent: #1a56db; --accent-text: #1a56db; --wash: rgb(0 0 0 / 0.04); }
${themeStyle(vars)}
html { background: var(--bg); color: var(--ink); color-scheme: light dark; }
body { margin: 0; font: 15px/1.65 -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
article { max-width: 720px; margin: 0 auto; padding: 48px 40px 64px; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.6em 0 0.5em; }
article > h1:first-child { font-size: 28px; margin-top: 0; }
p, ul, ol, blockquote, pre, table { margin: 0 0 1em; }
a, .kn-wikilink { color: var(--accent-text); text-decoration: none; }
.kn-tag { color: var(--accent-text); }
.kn-missing { color: var(--ink-3); }
blockquote { margin-left: 0; padding-left: 14px; border-left: 3px solid var(--line); color: var(--ink-2); }
code, pre { font: 13px/1.5 ui-monospace, "SF Mono", Menlo, monospace; }
code { background: var(--wash); padding: 1px 4px; border-radius: 4px; }
pre { background: var(--wash); padding: 12px 14px; border-radius: 8px; overflow-x: auto; }
pre code { background: none; padding: 0; }
li.kn-task { list-style: none; margin-left: -1.2em; }
.kn-box { color: var(--ink-3); }
.kn-box[data-done] { color: var(--accent-text); }
li.kn-task:has(.kn-box[data-done]) { color: var(--ink-3); text-decoration: line-through; }
img { max-width: 100%; border-radius: 6px; }
table { border-collapse: collapse; }
th, td { border-bottom: 1px solid var(--line); padding: 6px 10px; text-align: left; }
hr { border: 0; border-top: 1px solid var(--line); margin: 2em 0; }
@media print { article { padding: 0; } a { color: inherit; } }
</style>
</head>
<body>
<article>
<h1>${escapeHtml(title)}</h1>
${bodyHtml}</article>
</body>
</html>
`;
}

// ---------------------------------------------------------------- os arquivos

/** Um erro do exportar que não é do vault: sem PDF neste host, ou o PDF não saiu. */
export class ExportError extends Error {
  constructor(
    readonly code: "E_NO_PDF" | "E_FAILED",
    message: string,
  ) {
    super(message);
  }
}

export const EXPORT_FORMATS = ["md", "html", "pdf"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export interface ExportDeps {
  /** O vault: a raiz (para os anexos) e a nota. */
  vault: { root: string; get(path: unknown): Promise<{ path: string; title: string; content: string }> };
  /** O PDF: o helper imprime o HTML (`kiwi-helper --export-pdf <in.html> <out.pdf>`). Sem ele, o PDF dá E_NO_PDF. */
  pdf?(htmlFile: string, pdfFile: string): Promise<void>;
}

/** Um nome livre na pasta: "Título.md", e "Título 2.md" se já existe. */
async function freeFile(dir: string, base: string, ext: string): Promise<string> {
  for (let n = 1; n < 1000; n++) {
    const file = nodePath.join(dir, `${n === 1 ? base : `${base} ${n}`}.${ext}`);
    if (!(await stat(file).catch(() => null))) return file;
  }
  throw new VaultError("E_EXISTS", `too many files called ${base}`);
}

/** O nome do arquivo a partir do título: sem barra nem dois-pontos (que o Finder não deixa). */
const fileBase = (title: string) => title.replace(/[/\\:]/g, "-").trim() || "Nota";

const EMBED = /!\[\[([^[\]|#\n]+)(#[^[\]|\n]*)?(\|[^[\]\n]*)?\]\]|!\[([^\]\n]*)\]\(([^)\s]+)\)/g;

export class NoteExporter {
  constructor(private deps: ExportDeps) {}

  /** O helper que imprime o PDF (o app liga quando o helper existe; o headless também, como no OCR). */
  setPdf(pdf: ExportDeps["pdf"]): void {
    this.deps.pdf = pdf;
  }

  /** Exporta a nota `notePath` na pasta `dir` (absoluta, que já existe). Devolve o arquivo criado. */
  async export(notePath: unknown, format: unknown, dir: unknown, theme?: unknown): Promise<{ file: string }> {
    if (!(EXPORT_FORMATS as readonly unknown[]).includes(format)) throw new VaultError("E_BAD_ARGS", "format must be md, html or pdf");
    if (typeof dir !== "string" || !nodePath.isAbsolute(dir)) throw new VaultError("E_BAD_ARGS", "the folder must be an absolute path");
    if (!(await stat(dir).catch(() => null))?.isDirectory()) throw new VaultError("E_NOT_FOUND", `no folder ${dir}`);
    const note = await this.deps.vault.get(notePath);
    const base = fileBase(note.title);
    const files = await listAttachments(this.deps.vault.root);

    if (format === "md") return { file: await this.markdown(note.content, base, dir, files) };

    const html = htmlDocument(note.title, markdownToHtml(stripFrontmatter(note.content), { embed: (t) => this.dataUrl(t, files) }), theme);
    if (format === "html") {
      const file = await freeFile(dir, base, "html");
      await writeFile(file, html, { flag: "wx" });
      return { file };
    }
    if (!this.deps.pdf) throw new ExportError("E_NO_PDF", "this host can't print a PDF");
    const file = await freeFile(dir, base, "pdf");
    const tmp = await mkdtemp(nodePath.join(tmpdir(), "kn-export-"));
    try {
      const htmlFile = nodePath.join(tmp, "nota.html");
      await writeFile(htmlFile, html, { mode: 0o600 });
      await this.deps.pdf(htmlFile, file);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
    if (!(await stat(file).catch(() => null))) throw new ExportError("E_FAILED", "the PDF wasn't written");
    return { file };
  }

  /**
   * O Markdown como está na nota (com o frontmatter), e os anexos que ela mostra copiados para `<Título> anexos/` ao
   * lado, com os `![[…]]` trocados por `![…](<Título> anexos/…)`, que abre em qualquer leitor de Markdown.
   */
  private async markdown(content: string, base: string, dir: string, files: readonly string[]): Promise<string> {
    const file = await freeFile(dir, base, "md");
    const folderName = `${nodePath.basename(file, ".md")} anexos`;
    const copied = new Map<string, string>();
    const used = new Set<string>();
    const target = (vaultRel: string): string => {
      const known = copied.get(vaultRel);
      if (known) return known;
      let name = nodePath.basename(vaultRel);
      for (let n = 2; used.has(name.toLowerCase()); n++) name = `${nodePath.basename(vaultRel, nodePath.extname(vaultRel))} ${n}${nodePath.extname(vaultRel)}`;
      used.add(name.toLowerCase());
      copied.set(vaultRel, name);
      return name;
    };
    const out = content.replace(EMBED, (raw, wiki?: string, _h?: string, alias?: string, mdAlt?: string, mdUrl?: string) => {
      const ref = wiki ?? (mdUrl && !/^[a-z]+:/i.test(mdUrl) ? safeDecode(mdUrl) : null);
      const found = ref ? resolveAttachment(ref, files) : null;
      if (!found) return raw;
      const name = target(found);
      const alt = wiki ? (alias ? alias.slice(1).trim() : nodePath.basename(found)) : (mdAlt ?? "");
      return `![${alt}](${encodeURI(`${folderName}/${name}`)})`;
    });
    if (copied.size) {
      await mkdir(nodePath.join(dir, folderName), { recursive: true });
      for (const [rel, name] of copied) await copyFile(inside(this.deps.vault.root, rel), nodePath.join(dir, folderName, name));
    }
    await writeFile(file, out, { flag: "wx" });
    return file;
  }

  /** O anexo como `data:` URL, para o HTML e o PDF saírem num arquivo só. Grande demais ou de fora: null. */
  private dataUrl(target: string, files: readonly string[]): string | null {
    const found = resolveAttachment(safeDecode(target), files);
    if (!found) return null;
    const mime = ATTACHMENT_TYPES[extOf(found)];
    if (!mime || !mime.startsWith("image/")) return null;
    try {
      const abs = inside(this.deps.vault.root, found);
      const bytes = readFileSync(abs);
      if (bytes.length > MAX_ATTACHMENT_BYTES) return null;
      return `data:${mime};base64,${bytes.toString("base64")}`;
    } catch {
      return null;
    }
  }
}

/** O PDF pelo helper: `kiwi-helper --export-pdf <in.html> <out.pdf>`, que imprime fora da tela e sai (até 60 s). */
export function helperPdf(helper: string): NonNullable<ExportDeps["pdf"]> {
  return (htmlFile, pdfFile) =>
    new Promise((resolve, reject) => {
      const p = spawn(helper, ["--export-pdf", htmlFile, pdfFile], { stdio: ["ignore", "ignore", "pipe"] });
      let err = "";
      const timer = setTimeout(() => p.kill("SIGKILL"), 60_000);
      p.stderr.on("data", (d: Buffer) => (err += d.toString("utf8")));
      p.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      p.on("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new ExportError("E_FAILED", `kiwi-helper --export-pdf exited with ${code}: ${err.trim().slice(0, 300)}`));
      });
    });
}

const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

