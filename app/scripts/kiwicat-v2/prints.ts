// Os prints da análise (T14773, spec #14755), no WebKit headless, sem o app: os frames da intro nova (`?t=`, o
// protótipo do pacote) e o gato novo nos 5 estados (o ByteKiwiCat do pacote, sem mudança).
// Da raiz do app: `bun scripts/kiwicat-v2/prints.ts [pasta]`. Saem PNGs; a conversão para WebP é à parte.
import { webkit } from "playwright-core";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { serve } from "./servir";

const out = resolve(process.argv[2] ?? "/tmp/kiwicat-v2-prints");
mkdirSync(out, { recursive: true });
const intro = resolve(import.meta.dir, "../../../docs/design/kiwicat-v2/intro/build/intro-prototipo-navegador.html");
// Um instante de cada fase (KIWICAT_KIWI_NOTES_ARCHITECTURE.md, seção 4), e o fim.
const frames = [
  ["1-condensa", 0.9], ["2-orelhas", 1.6], ["2-olhos", 2.2], ["3-aurora", 2.9],
  ["4-feliz", 3.55], ["5-some", 4.1], ["6-janela", 4.7], ["6-app", 5.3],
] as const;
const states = ["repouso", "ouvindo", "pensando", "respondendo", "dormindo"] as const;

const browser = await webkit.launch({ headless: true });
const cats = await serve("novo.tsx");
try {
  const page = await browser.newPage({ viewport: { width: 720, height: 460 }, deviceScaleFactor: 2, reducedMotion: "no-preference" });
  await page.route("**/*", (r) => (r.request().url().startsWith("file:") ? r.continue() : r.abort()));
  for (const [name, t] of frames) {
    await page.goto(`file://${intro}?t=${t}`);
    await page.waitForTimeout(600);
    await page.screenshot({ path: resolve(out, `intro-${name}-t${t}.png`) });
  }
  const reduced = await browser.newPage({ viewport: { width: 720, height: 460 }, deviceScaleFactor: 2, reducedMotion: "reduce" });
  await reduced.route("**/*", (r) => (r.request().url().startsWith("file:") ? r.continue() : r.abort()));
  for (const t of [0.5, 1.2]) {
    await reduced.goto(`file://${intro}?t=${t}`);
    await reduced.waitForTimeout(600);
    await reduced.screenshot({ path: resolve(out, `intro-reduzido-t${t}.png`) });
  }
  const cat = await browser.newPage({ viewport: { width: 240, height: 240 }, deviceScaleFactor: 2 });
  await cat.route("**/*", (r) => (new URL(r.request().url()).origin === cats.url ? r.continue() : r.abort()));
  for (const s of states) {
    await cat.goto(`${cats.url}/?state=${s}&size=240`);
    await cat.waitForFunction(() => (window as any).kiwiReady);
    await cat.waitForTimeout(2500);
    await cat.screenshot({ path: resolve(out, `gato-${s}.png`) });
  }
} finally {
  cats.close();
  await browser.close();
}
console.log("prints em", out);
