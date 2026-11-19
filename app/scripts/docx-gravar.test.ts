// O docx difícil ao gravar (T23352, spec #21080, caixas 4 e 5), no WebKit headless e pelo caminho do app (`mountDocx`
// editável e o `save()` do Kiwi): uma edição de verdade pelo teclado, e cada parte do arquivo com os mesmos elementos de
// antes (a alteração controlada, os campos, a equação, os campos de formulário, os marcadores, a imagem, o cabeçalho e o
// rodapé). O gravado reabre no Kiwi e no mammoth (a segunda biblioteca, já no lock, só lendo), com o texto e a contagem
// iguais. Tudo inventado: o estoque de uma papelaria. Precisa do WebKit do Playwright (`bunx playwright-core install webkit`).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import mammoth from "mammoth";
import { type Browser, type Page, webkit } from "playwright-core";

import { partText, readZip, writeZip } from "../src/shared/sheet/zip.ts";
import { ALVO, contar, dificil, diferencas, ESCRITO, NOVO } from "./docx-gravar/dificil.ts";

const hasWebkit = (() => {
  try {
    return existsSync(webkit.executablePath());
  } catch {
    return false;
  }
})();

/** O texto de cada parágrafo do corpo, pelo XML (o `w:t`, sem o texto excluído). */
function paragrafos(bytes: Uint8Array): string[] {
  const doc = readZip(bytes).find((p) => p.name === "word/document.xml")!;
  return (partText(bytes, doc).match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []).map((p) => [...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(""));
}

/** O que o mammoth lê: o texto puro, e quantos de cada elemento o HTML dele tem. */
async function pelaSegunda(bytes: Uint8Array) {
  const buffer = Buffer.from(bytes);
  const raw = await mammoth.extractRawText({ buffer });
  const html = await mammoth.convertToHtml({ buffer });
  const n = (re: RegExp) => (html.value.match(re) ?? []).length;
  return {
    texto: raw.value.trim(),
    html: { titulos: n(/<h1[ >]/g), paragrafos: n(/<p[ >]/g), tabelas: n(/<table[ >]/g), linhas: n(/<tr[ >]/g), celulas: n(/<td[ >]/g), imagens: n(/<img /g), marcadores: n(/<a id="/g) },
    imagens: [...html.value.matchAll(/<img [^>]*src="([^"]+)"/g)].map((m) => m[1]!),
    avisos: [...raw.messages, ...html.messages].map((m) => m.message).sort(),
  };
}

/** Troca uma parte do docx (ou tira, com `null`), para provar que a contagem pega o que some. */
function mudar(bytes: Uint8Array, name: string, fn: ((xml: string) => string) | null): Uint8Array {
  const parts = readZip(bytes);
  const part = parts.find((p) => p.name === name)!;
  if (!fn) return writeZip(bytes, parts.filter((p) => p !== part), new Map(), new Set([name]));
  return writeZip(bytes, parts, new Map([[name, new TextEncoder().encode(fn(partText(bytes, part)))]]));
}

describe.skipIf(!hasWebkit)("o docx difícil ao gravar", () => {
  let dist = "";
  let browser: Browser;
  let server: ReturnType<typeof Bun.serve>;
  let doc: Uint8Array = new Uint8Array();
  const original = dificil();
  let editado: Uint8Array = new Uint8Array();
  let telaEditada: string[] = [];

  const open = async (bytes: Uint8Array): Promise<Page> => {
    doc = bytes;
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await page.route("**/*", (r) => (r.request().url().startsWith(`http://localhost:${server.port}`) ? r.continue() : r.abort()));
    await page.goto(`http://localhost:${server.port}/`);
    await page.waitForFunction(() => window.__kiwiDocx?.ready, null, { timeout: 30_000 });
    const s = await page.evaluate(() => window.__kiwiDocx);
    if (s.error) throw new Error(s.error);
    return page;
  };
  const save = async (page: Page) => new Uint8Array(Buffer.from(await page.evaluate(() => window.__kiwiSave!()), "base64"));
  const screen = (page: Page) => page.evaluate(() => window.__kiwiText!());

  beforeAll(async () => {
    dist = mkdtempSync(path.join(tmpdir(), "kn-docx-gravar-"));
    const built = await Bun.build({ entrypoints: [path.join(import.meta.dir, "docx-gravar/entry.ts")], outdir: dist, target: "browser" });
    if (!built.success) throw new Error(built.logs.join("\n"));
    const css = built.outputs.filter((o) => o.path.endsWith(".css")).map((o) => `<link rel="stylesheet" href="/${path.basename(o.path)}">`).join("");
    const html = `<!doctype html><meta charset="utf-8">${css}<div class="docx-editor docx-editor__scroll-container" style="height:900px;overflow:auto"><div id="doc" class="docx-paginated-surface"></div></div><script type="module" src="/entry.js"></script>`;
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const p = new URL(req.url).pathname;
        if (p === "/") return new Response(html, { headers: { "content-type": "text/html" } });
        if (p === "/doc.docx") return new Response(new Blob([doc as Uint8Array<ArrayBuffer>]));
        return new Response(Bun.file(path.join(dist, p)));
      },
    });
    browser = await webkit.launch();

    // A edição de verdade, como a pessoa: clica no fim do último parágrafo, escreve, Enter e mais uma linha.
    const page = await open(original);
    try {
      const box = await page.locator(".docx-page").last().getByText(ALVO).last().boundingBox();
      if (!box) throw new Error("sem o parágrafo para clicar");
      await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
      await page.keyboard.press("End");
      await page.keyboard.type(ESCRITO, { delay: 5 });
      await page.keyboard.press("Enter");
      await page.keyboard.type(NOVO, { delay: 5 });
      await page.waitForTimeout(300);
      editado = await save(page);
      telaEditada = await screen(page);
    } finally {
      await page.close();
    }
  }, 90_000);

  afterAll(async () => {
    await browser?.close();
    server?.stop(true);
    if (dist) rmSync(dist, { recursive: true, force: true });
  });

  test("o docx inventado tem um de cada elemento, no corpo, no cabeçalho e no rodapé", () => {
    const c = contar(original);
    expect(Object.keys(c).sort()).toEqual(["word/document.xml", "word/footer1.xml", "word/header1.xml", "word/media/image1.png"]);
    const d = c["word/document.xml"]!;
    for (const k of ["insercoes", "exclusoes", "textoExcluido", "camposSimples", "campos", "equacoes", "camposDeFormulario", "controlesDeConteudo", "marcadores", "fimDeMarcador", "imagens", "tabelas", "cabecalhos", "rodapes"]) {
      expect([k, d[k]]).toEqual([k, expect.any(Number)]);
    }
    expect(d.instrucoes).toEqual(["DATE", "FORMCHECKBOX", "FORMTEXT", "REF"]);
    expect(d.nomesDosMarcadores).toEqual(["corredor", "fim"]);
    expect(c["word/footer1.xml"]!.instrucoes).toEqual(["NUMPAGES", "PAGE"]);
  });

  test("uma edição de verdade, gravada: a edição entra, e cada parte fica com os mesmos elementos", () => {
    const p = paragrafos(editado);
    expect(p).toContain(ALVO + ESCRITO);
    expect(p).toContain(NOVO);
    expect(p).not.toContain(ALVO);
    expect(diferencas(contar(original), contar(editado))).toEqual([]);
  });

  test("o gravado reabre no Kiwi com o mesmo texto da tela, e gravar de novo sem mexer mantém a contagem", async () => {
    const page = await open(editado);
    try {
      const text = await screen(page);
      expect(text).toContain(ALVO + ESCRITO);
      expect(text).toContain(NOVO);
      expect(text).toEqual(telaEditada);
      expect(await page.evaluate(() => window.__kiwiDocx.pages!)).toBeGreaterThan(0);
      const again = await save(page);
      expect(paragrafos(again)).toEqual(paragrafos(editado));
      expect(diferencas(contar(original), contar(again))).toEqual([]);
    } finally {
      await page.close();
    }
  }, 60_000);

  test("o gravado reabre numa segunda biblioteca (o mammoth): o texto com a edição, e a mesma contagem", async () => {
    const a = await pelaSegunda(original);
    const b = await pelaSegunda(editado);
    expect(a.texto).toContain(ALVO);
    expect(b.texto).toBe(a.texto.replace(ALVO, `${ALVO}${ESCRITO}\n\n${NOVO}`));
    expect(b.html).toEqual({ ...a.html, paragrafos: a.html.paragrafos + 1 });
    expect(b.imagens).toEqual(a.imagens);
    expect(b.avisos).toEqual(a.avisos);
  });

  // A prova de que a contagem derruba: um gravador que perdesse um elemento não passaria.
  describe("a contagem pega o que some", () => {
    const D = "word/document.xml";
    test.each([
      ["o rodapé", "word/footer1.xml", null, "word/footer1.xml: some"],
      ["o cabeçalho", "word/header1.xml", null, "word/header1.xml: some"],
      ["a alteração controlada aceita", D, (x: string) => x.replace(/<w:del [\s\S]*?<\/w:del>/, "").replace(/<w:ins [^>]*>([\s\S]*?)<\/w:ins>/, "$1"), `${D} insercoes: 1 → 0`],
      ["um marcador", D, (x: string) => x.replace(/<w:bookmarkStart [^>]*w:name="corredor"\/>/, ""), `${D} marcadores: 2 → 1`],
      ["um campo virando texto", D, (x: string) => x.replace(/<w:fldSimple [^>]*>([\s\S]*?)<\/w:fldSimple>/, "$1"), `${D} camposSimples: 1 → 0`],
      ["o campo de formulário", D, (x: string) => x.replace(/<w:ffData>[\s\S]*?<\/w:ffData>/, ""), `${D} camposDeFormulario: 2 → 1`],
      ["a equação", D, (x: string) => x.replace(/<m:oMathPara>[\s\S]*?<\/m:oMathPara>/, ""), `${D} equacoes: 1 → 0`],
      ["a imagem", D, (x: string) => x.replace(/<w:drawing>[\s\S]*?<\/w:drawing>/, ""), `${D} imagens: 1 → 0`],
    ] as const)("%s", (_, part, fn, expected) => {
      expect(diferencas(contar(editado), contar(mudar(editado, part, fn)))).toContain(expected);
    });

    test("e o mammoth também: a imagem que some muda a contagem dele", async () => {
      const sem = mudar(editado, D, (x) => x.replace(/<w:drawing>[\s\S]*?<\/w:drawing>/, ""));
      expect((await pelaSegunda(sem)).html.imagens).toBe((await pelaSegunda(editado)).html.imagens - 1);
    });
  });
});
