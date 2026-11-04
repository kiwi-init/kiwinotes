import { describe, expect, test } from "bun:test";

import { htmlDocument, markdownToHtml, stripFrontmatter, themeStyle } from "./export.ts";

const embed = (t: string) => (t === "foto.png" || t === "Anexos/foto.png" ? "data:image/png;base64,AAAA" : null);
const html = (s: string) => markdownToHtml(s, { embed });

describe("Markdown → HTML (T2684)", () => {
  test("títulos, ênfase, listas, tarefas, citação, código e tabela", () => {
    const out = html(
      "# Plano\n\nUm **forte**, um *leve*, ~~riscado~~ e `x < y`.\n\n- um\n- dois\n\n1. a\n2. b\n\n- [x] feito\n- [ ] falta\n\n> citação\n\n```ts\nconst a = 1 < 2;\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n---\n",
    );
    expect(out).toContain("<h1>Plano</h1>");
    expect(out).toContain("<strong>forte</strong>");
    expect(out).toContain("<em>leve</em>");
    expect(out).toContain("<del>riscado</del>");
    expect(out).toContain("<code>x &lt; y</code>");
    expect(out).toContain("<ul>\n<li>um</li>\n<li>dois</li>\n</ul>");
    expect(out).toContain("<ol>");
    expect(out).toContain('<span class="kn-box" data-done>☑</span> feito');
    expect(out).toContain('<span class="kn-box">☐</span> falta');
    expect(out).toContain("<blockquote>\n<p>citação</p>\n</blockquote>");
    expect(out).toContain('<pre><code class="language-ts">const a = 1 &lt; 2;</code></pre>');
    expect(out).toContain("<thead><tr><th>A</th><th>B</th></tr></thead>");
    expect(out).toContain("<tr><td>1</td><td>2</td></tr>");
    expect(out).toContain("<hr>");
  });

  test("o que é do Obsidian: [[link]], apelido, ![[anexo]], #tag e %%comentário%%", () => {
    const out = html("Ver [[Pasta/Ana|a Ana]] e [[Plano]]. ![[foto.png]] ![[sumiu.png]] #projeto/kiwi %%segredo%% fim");
    expect(out).toContain('<span class="kn-wikilink">a Ana</span>');
    expect(out).toContain('<span class="kn-wikilink">Plano</span>');
    expect(out).toContain('<img src="data:image/png;base64,AAAA" alt="foto.png">');
    expect(out).toContain('<span class="kn-missing">sumiu.png</span>');
    expect(out).toContain('<span class="kn-tag">#projeto/kiwi</span>');
    expect(out).not.toContain("segredo");
  });

  test("nada vira HTML cru, e link só abre http, https e mailto", () => {
    const out = html('<script>alert(1)</script>\n\n[x](javascript:alert(1)) [y](https://kiwiinit.com) <img src=x onerror=1> ![a](Anexos/foto.png)');
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("<img src=x");
    expect(out).not.toContain("javascript:");
    expect(out).toContain('<a href="https://kiwiinit.com">y</a>');
    expect(out).toContain('<img src="data:image/png;base64,AAAA" alt="a">');
  });

  test("o documento: o título escapado, o frontmatter fora, e o tema só com variáveis que não fecham o <style>", () => {
    expect(stripFrontmatter("---\ntags: [a]\n---\ntexto")).toBe("texto");
    const doc = htmlDocument("A <b>", "<p>x</p>", { "--bg": "#000", "--ink": "red; } body { x", "nao": "1", "--x": "</style>" });
    expect(doc).toContain("<title>A &lt;b&gt;</title>");
    expect(doc).toContain(":root { --bg: #000; }");
    expect(themeStyle({ "--a": "url(x)" })).toBe(":root { --a: url(x); }");
  });
});

// ---------------------------------------------------------------- os arquivos

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach } from "bun:test";

import { ExportError, NoteExporter } from "./export.ts";
import { Vault } from "./vault.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "kn-export-"));
  dirs.push(d);
  return d;
};
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

async function setup() {
  const root = path.join(tmp(), "V");
  mkdirSync(path.join(root, "Anexos"), { recursive: true });
  writeFileSync(path.join(root, "Anexos", "foto.png"), PNG);
  writeFileSync(path.join(root, "Plano.md"), "---\ntags: [a]\n---\n# Agora\n\nVer ![[foto.png]] e ![quadro](Anexos/foto.png) e ![[sumiu.png]] e [[Ana]].\n");
  const v = new Vault({ root, trash: async () => {} });
  await v.open();
  return { v, out: tmp() };
}

describe("exportar para arquivo (T2684)", () => {
  test("Markdown: o texto como está, e os anexos copiados para <Título> anexos/, com o link trocado", async () => {
    const { v, out } = await setup();
    const ex = new NoteExporter({ vault: v });
    const { file } = await ex.export("Plano.md", "md", out);
    expect(file).toBe(path.join(out, "Plano.md"));
    const text = readFileSync(file, "utf8");
    expect(text.startsWith("---\ntags: [a]\n---\n")).toBe(true);
    expect(text).toContain("![foto.png](Plano%20anexos/foto.png)");
    expect(text).toContain("![quadro](Plano%20anexos/foto.png)");
    expect(text).toContain("![[sumiu.png]]");
    expect(text).toContain("[[Ana]]");
    expect(readFileSync(path.join(out, "Plano anexos", "foto.png")).equals(PNG)).toBe(true);
    // De novo: "Plano 2.md", com a pasta de anexos dele.
    const again = await ex.export("Plano.md", "md", out);
    expect(again.file).toBe(path.join(out, "Plano 2.md"));
    expect(readFileSync(again.file, "utf8")).toContain("(Plano%202%20anexos/foto.png)");
  });

  test("HTML: um arquivo só, com o tema e a imagem embutida; sem o frontmatter", async () => {
    const { v, out } = await setup();
    const { file } = await new NoteExporter({ vault: v }).export("Plano.md", "html", out, { "--bg": "#101010" });
    const html = readFileSync(file, "utf8");
    expect(file.endsWith("Plano.html")).toBe(true);
    expect(html).toContain("<h1>Plano</h1>");
    expect(html).toContain('src="data:image/png;base64,');
    expect(html).toContain(":root { --bg: #101010; }");
    expect(html).not.toContain("tags: [a]");
  });

  test("PDF: o HTML vai ao helper, e sem helper dá E_NO_PDF", async () => {
    const { v, out } = await setup();
    let got = "";
    const ex = new NoteExporter({
      vault: v,
      pdf: async (htmlFile, pdfFile) => {
        got = readFileSync(htmlFile, "utf8");
        writeFileSync(pdfFile, "%PDF-1.4 de mentira");
      },
    });
    const { file } = await ex.export("Plano.md", "pdf", out);
    expect(file.endsWith("Plano.pdf")).toBe(true);
    expect(got).toContain("<h1>Plano</h1>");
    expect(existsSync(file)).toBe(true);
    await expect(new NoteExporter({ vault: v }).export("Plano.md", "pdf", out)).rejects.toBeInstanceOf(ExportError);
  });

  test("argumentos: formato, pasta relativa ou que não existe, nota que não existe", async () => {
    const { v, out } = await setup();
    const ex = new NoteExporter({ vault: v });
    await expect(ex.export("Plano.md", "docx", out)).rejects.toThrow("format");
    await expect(ex.export("Plano.md", "md", "relativa")).rejects.toThrow("absolute");
    await expect(ex.export("Plano.md", "md", path.join(out, "nao"))).rejects.toThrow("no folder");
    await expect(ex.export("Sumiu.md", "md", out)).rejects.toThrow();
  });
});

import { uiCapabilities } from "../bun/ui-capabilities.ts";
import { directInvoke } from "../bun/ui-engine.ts";
import { DEFAULT_SETTINGS } from "../store/settings.ts";

describe("notes.export pelo caminho da UI (T2684)", () => {
  const caps = (v: Vault, chooser?: () => Promise<string | null>) =>
    uiCapabilities({
      dictionary: { load: async () => [], save: async (t) => t },
      snippets: { load: async () => [], save: async (s) => s },
      history: { search: async () => ({ entries: [] }), delete: async () => true, get: async () => null },
      dictationNotes: { toNew: async () => { throw new Error("not used"); }, append: async () => { throw new Error("not used"); } },
      settings: { load: async () => DEFAULT_SETTINGS, save: async () => DEFAULT_SETTINGS },
      clipboardWrite: () => {},
      notes: v,
      ...(chooser ? { exporter: new NoteExporter({ vault: v }), chooseExportFolder: chooser } : {}),
    });

  test("a pasta escolhida recebe o arquivo; cancelar dá E_CANCELED; nota que não existe não abre o seletor", async () => {
    const { v, out } = await setup();
    let asked = 0;
    let answer: string | null = out;
    const c = caps(v, async () => (asked++, answer));
    expect(await directInvoke(c, "notes.export", { path: "Plano.md", format: "html" })).toMatchObject({ ok: true, value: { file: path.join(out, "Plano.html") } });
    answer = null;
    expect(await directInvoke(c, "notes.export", { path: "Plano.md", format: "md" })).toMatchObject({ ok: false, code: "E_CANCELED" });
    const before = asked;
    expect(await directInvoke(c, "notes.export", { path: "Sumiu.md", format: "md" })).toMatchObject({ ok: false, code: "E_NOT_FOUND" });
    expect(asked).toBe(before);
    expect(await directInvoke(c, "notes.export", { path: "Plano.md", format: "pdf" })).toMatchObject({ ok: false });
  });

  test("sem exportador no host: E_NO_EXPORT", async () => {
    const { v } = await setup();
    expect(await directInvoke(caps(v), "notes.export", { path: "Plano.md", format: "md" })).toMatchObject({ ok: false, code: "E_NO_EXPORT" });
  });
});
