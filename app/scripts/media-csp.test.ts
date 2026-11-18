// T19315: o áudio e o vídeo das Notas tocam com a CSP das views (`VIEWS_CSP`), e só de um `blob:`. No WebKit headless,
// a página de mentira monta um <audio> como o `MediaViewer`: os bytes de um .wav viram um `blob:`, e ele toca. O mesmo
// arquivo por `data:` ou por um endereço da rede é recusado. O .wav é gerado aqui (um tom de 1 s): nenhum áudio no repo.

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

/** Um .wav de 1 s, mono, 8 kHz, 16 bits: um tom de 440 Hz. */
function toneWav(): string {
  const rate = 8000;
  const data = new Int16Array(rate).map((_, i) => Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / rate)));
  const head = new DataView(new ArrayBuffer(44));
  const ascii = (at: number, s: string) => [...s].forEach((c, i) => head.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, "RIFF");
  head.setUint32(4, 36 + data.byteLength, true);
  ascii(8, "WAVEfmt ");
  head.setUint32(16, 16, true);
  head.setUint16(20, 1, true);
  head.setUint16(22, 1, true);
  head.setUint32(24, rate, true);
  head.setUint32(28, rate * 2, true);
  head.setUint16(32, 2, true);
  head.setUint16(34, 16, true);
  ascii(36, "data");
  head.setUint32(40, data.byteLength, true);
  return Buffer.concat([Buffer.from(head.buffer), Buffer.from(data.buffer)]).toString("base64");
}

describe.skipIf(!hasWebkit)("o áudio das Notas com a CSP das views (T19315)", () => {
  let browser: Browser;
  let server: ReturnType<typeof Bun.serve>;

  beforeAll(async () => {
    server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => new Response("<!doctype html><title>Notas</title><body></body>", { headers: { "Content-Type": "text/html", "Content-Security-Policy": VIEWS_CSP } }),
    });
    browser = await webkit.launch({ headless: true });
  });

  afterAll(async () => {
    await browser?.close();
    server?.stop(true);
  });

  test("de um blob: toca; por data: ou pela rede, não", async () => {
    const page = await browser.newPage();
    // Rede nenhuma de verdade. Só o http(s): o `blob:` também passaria pelo `route`, e seria abortado.
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));
    await page.route(/^https?:/, (r) => (r.request().url().startsWith(`http://127.0.0.1:${server.port}`) ? r.continue() : r.abort()));
    await page.goto(`http://127.0.0.1:${server.port}/`);
    const play = (b64: string, how: "blob" | "data" | "rede") =>
      page.evaluate(
        ({ b64, how }) => {
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          const el = document.createElement("audio");
          el.src =
            how === "blob" ? URL.createObjectURL(new Blob([bytes], { type: "audio/wav" })) : how === "data" ? `data:audio/wav;base64,${b64}` : "https://exemplo.invalid/fala.wav";
          document.body.append(el);
          return new Promise<string>((done) => {
            el.onloadedmetadata = () => done(`toca ${el.duration.toFixed(1)}`);
            el.onerror = () => done("recusado");
            setTimeout(() => done("nada"), 4000);
          });
        },
        { b64, how },
      );
    const wav = toneWav();
    expect(await play(wav, "blob")).toBe("toca 1.0");
    expect(await play(wav, "data")).toBe("recusado");
    expect(await play(wav, "rede")).toBe("recusado");
    // A CSP recusa antes de pedir: o endereço da rede nem chega a sair.
    expect(requests.filter((u) => u.startsWith("http"))).toEqual([`http://127.0.0.1:${server.port}/`]);
    await page.close();
  });
});
