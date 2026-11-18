// T19314: a prévia do .html nas Notas não sai do lugar. No WebKit headless, com a CSP das views (`VIEWS_CSP`) na página,
// o iframe da prévia (o `sandbox` vazio e o `previewDocument`, como o `TextViewer` monta) desenha o HTML e o CSS de
// dentro do arquivo, e nada mais: nenhum script roda, nenhum pedido sai (nem para a rede, nem para os arquivos da
// própria UI), um link clicado não navega e um form não é enviado. O roteiro `arquivo-html.json` cobre a tela; este
// cobre as travas, que lá contariam como problema no relatório (cada recusa vai ao console).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";

import { type Browser, webkit } from "playwright-core";

import { VIEWS_CSP } from "../src/bun/window-security.ts";
import { previewDocument } from "../ui/notes/files/htmlPreview.ts";

const hasWebkit = (() => {
  try {
    return existsSync(webkit.executablePath());
  } catch {
    return false;
  }
})();

/** Um .html inventado que tenta de tudo: script, CSS e imagem de fora, imagem relativa, link e form. */
const PAGE = `<!doctype html>
<html><head>
<style>body{margin:0;background:#fde;font:20px serif} h1{color:rgb(107, 63, 160)} a,button{display:block;height:40px}</style>
<link rel="stylesheet" href="https://exemplo.invalid/tema.css">
<style>@import url("https://exemplo.invalid/outro.css");</style>
</head><body>
<h1>Olá, Ana</h1>
<img src="https://exemplo.invalid/foto.png"><img src="foto.png"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
<a id="link" href="https://exemplo.invalid/">link</a>
<form action="https://exemplo.invalid/"><button id="ir">ir</button></form>
<script>document.body.append("SCRIPT RODOU"); try { parent.document.title = "VAZOU" } catch {} parent.postMessage("script", "*")</script>
</body></html>`;

describe.skipIf(!hasWebkit)("a prévia do .html, isolada (T19314)", () => {
  let browser: Browser;
  let server: ReturnType<typeof Bun.serve>;
  const host = () => `http://127.0.0.1:${server.port}`;

  beforeAll(async () => {
    // A página das Notas de mentira: a CSP das views e um módulo que monta o iframe como o `TextViewer`.
    const mount = `const f = document.createElement("iframe");
f.setAttribute("sandbox", "");
f.srcdoc = ${JSON.stringify(previewDocument(PAGE))};
f.style.cssText = "width:600px;height:400px;border:0";
document.body.append(f);
addEventListener("message", (e) => { document.title = "MSG:" + e.data; });`;
    server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        const path = new URL(req.url).pathname;
        if (path === "/mount.js") return new Response(mount, { headers: { "Content-Type": "text/javascript", "Content-Security-Policy": VIEWS_CSP } });
        if (path === "/") {
          const html = `<!doctype html><title>Notas</title><body style="margin:0"><script type="module" src="/mount.js"></script>`;
          return new Response(html, { headers: { "Content-Type": "text/html", "Content-Security-Policy": VIEWS_CSP } });
        }
        return new Response("not found", { status: 404 });
      },
    });
    browser = await webkit.launch({ headless: true });
  });

  afterAll(async () => {
    await browser?.close();
    server?.stop(true);
  });

  test("desenha o de dentro, e nada sai: nem script, nem pedido, nem link, nem form", async () => {
    const page = await browser.newPage();
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));
    // Rede nenhuma de verdade: o que não é a página de mentira é abortado (e fica na lista, se chegar a ser pedido).
    await page.route("**", (r) => (r.request().url().startsWith(host()) ? r.continue() : r.abort()));
    await page.goto(`${host()}/`);
    const frame = page.frameLocator("iframe");
    await expect(frame.locator("h1").textContent()).resolves.toBe("Olá, Ana");
    // O CSS de dentro do arquivo vale.
    expect(await frame.locator("h1").evaluate((h) => getComputedStyle(h).color)).toBe("rgb(107, 63, 160)");

    // O link e o form, clicados: a prévia segue no `about:srcdoc`.
    await frame.locator("#link").click();
    await frame.locator("#ir").click();
    await page.waitForTimeout(300);
    expect(page.frames().map((f) => f.url())).toEqual([`${host()}/`, "about:srcdoc"]);

    // Nenhum script rodou: nem na prévia, nem na janela das Notas.
    // O `innerText` é o que está desenhado: sem o código do `<script>`, que o `textContent` traria.
    expect(await frame.locator("body").innerText()).not.toContain("SCRIPT RODOU");
    expect(await page.title()).toBe("Notas");
    // Os únicos pedidos são os da página de mentira: nem a rede, nem o `foto.png` relativo (a CSP da prévia barra).
    expect(requests).toEqual([`${host()}/`, `${host()}/mount.js`]);
    await page.close();
  });
});
