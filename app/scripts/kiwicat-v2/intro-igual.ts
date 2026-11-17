// "Igual ao pacote" (T14851, spec #14766): a intro do app e a do build do pacote, no mesmo WebKit headless, no mesmo
// `?t=` das 5 fases do gato e do modo reduzido. Mede quantos pixels diferem mais que 8/255 (o limite: 1 % por quadro) e salva
// os dois lado a lado (o app à esquerda, o pacote à direita).
//
// Da raiz do app: `bun scripts/kiwicat-v2/intro-igual.ts [pasta]`. Sai 1 se algum quadro passa de 1 %.
import { webkit, type Browser } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildStandaloneIntroHtml } from "../../../docs/design/kiwicat-v2/intro/src/exportStandaloneHtml.ts";
import { VIEWS_CSP } from "../../src/bun/window-security.ts";
import { WINDOW_SPECS } from "../../src/shared/window-specs.ts";
import { INTRO_PHASES } from "../../ui/kiwicat-v2/timeline.ts";
import { ensureBuild } from "../ui-page.ts";

const out = resolve(process.argv[2] ?? "/tmp/kiwicat-v2-igual");
mkdirSync(out, { recursive: true });
const LIMIT = 0.01;
const THRESHOLD = 8;

// O meio de cada fase até a saída do gato; no reduzido, o gato. O fim (a fase "janela") não é mais o do pacote: a
// moldura cresce até o hub em vez da janela de mentira (T16769, spec #16759), e quem confere é o
// `scripts/intro-hub-check.ts`.
const frames: { name: string; t: number; reduced: boolean; pacoteT?: number }[] = [
  ...INTRO_PHASES.filter((f) => f.id !== "janela").map((f, i) => ({ name: `${i + 1}-${f.id}`, t: Math.round(((f.start + f.end) / 2) * 100) / 100, reduced: false })),
  { name: "reduzido-gato", t: 0.5, reduced: true },
];
// O controle: o app em t=2 contra o pacote em t=2,1. Tem que passar de 1 %, senão a medida não vê nada.
const CONTROLE = { name: "controle", t: 2, reduced: false, pacoteT: 2.1 };

const dist = ensureBuild("intro");
const pacote = buildStandaloneIntroHtml("app", true);
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    // O pacote tem script inline: sem a CSP (é a referência, como veio).
    if (path === "/pacote/") return new Response(pacote, { headers: { "Content-Type": "text/html" } });
    const rel = path.replace(/^\/app\/?/, "") || "index.html";
    const file = Bun.file(resolve(dist, rel));
    if (!path.startsWith("/app/") || !(await file.exists())) return new Response("not found", { status: 404 });
    return new Response(file, { headers: { "Content-Security-Policy": VIEWS_CSP } });
  },
});
const origin = `http://127.0.0.1:${server.port}`;
const { width, height } = WINDOW_SPECS.intro;

async function shot(browser: Browser, url: string, reduced: boolean): Promise<Buffer> {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2, reducedMotion: reduced ? "reduce" : "no-preference" });
  const problems: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
  page.on("pageerror", (e) => problems.push(String(e)));
  await page.route("**/*", (r) => (r.request().url().startsWith(origin) ? r.continue() : r.abort()));
  await page.goto(url);
  await page.waitForTimeout(700);
  const png = await page.screenshot();
  await page.close();
  if (problems.length) throw new Error(`${url}: ${problems.join("; ")}`);
  return png;
}

const browser = await webkit.launch({ headless: true });
const rows: { frame: string; t: number; reduced: boolean; over: number; pct: number; maxDiff: number }[] = [];
try {
  const cmp = await browser.newPage();
  for (const f of [...frames, CONTROLE]) {
    const a = await shot(browser, `${origin}/app/?t=${f.t}`, f.reduced);
    const b = await shot(browser, `${origin}/pacote/?t=${f.pacoteT ?? f.t}`, f.reduced);
    // A comparação e o lado a lado num canvas, na mesma página.
    const r = await cmp.evaluate(async ([a64, b64, th]) => {
      const load = async (s: string) => createImageBitmap(await (await fetch(`data:image/png;base64,${s}`)).blob());
      const [ia, ib] = await Promise.all([load(a64), load(b64)]);
      const w = ia.width, h = ia.height;
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const x = c.getContext("2d", { willReadFrequently: true })!;
      x.drawImage(ia, 0, 0); const da = x.getImageData(0, 0, w, h).data;
      x.clearRect(0, 0, w, h); x.drawImage(ib, 0, 0); const db = x.getImageData(0, 0, w, h).data;
      let over = 0, maxDiff = 0;
      for (let i = 0; i < da.length; i += 4) {
        const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]), Math.abs(da[i + 3] - db[i + 3]));
        if (d > maxDiff) maxDiff = d;
        if (d > th) over++;
      }
      const s = document.createElement("canvas");
      s.width = w * 2 + 16; s.height = h;
      const sx = s.getContext("2d")!;
      sx.fillStyle = "#ffffff"; sx.fillRect(0, 0, s.width, s.height);
      sx.drawImage(ia, 0, 0); sx.drawImage(ib, w + 16, 0);
      sx.fillStyle = "#d4d4d8"; sx.fillRect(w + 7, 0, 2, h);
      return { over, total: w * h, maxDiff, side: s.toDataURL("image/png").split(",")[1] };
    }, [a.toString("base64"), b.toString("base64"), THRESHOLD] as const);
    const pct = r.over / r.total;
    rows.push({ frame: f.name, t: f.t, reduced: f.reduced, over: r.over, pct, maxDiff: r.maxDiff });
    writeFileSync(resolve(out, `${f.name}-t${f.t}.png`), Buffer.from(r.side, "base64"));
    console.log(`${f.name.padEnd(18)} t=${String(f.t).padEnd(5)} ${(pct * 100).toFixed(3).padStart(7)} % acima de ${THRESHOLD}/255 (máx ${r.maxDiff})`);
  }
} finally {
  await browser.close();
  server.stop(true);
}
writeFileSync(resolve(out, "igual.json"), JSON.stringify({ limit: LIMIT, threshold: THRESHOLD, viewport: { width, height, dpr: 2 }, frames: rows }, null, 2));
const control = rows.find((r) => r.frame === CONTROLE.name)!;
const bad = rows.filter((r) => r.frame !== CONTROLE.name && r.pct > LIMIT);
if (control.pct <= LIMIT) { console.log("o controle não passou de 1 %: a medida está cega"); process.exit(1); }
console.log(bad.length ? `passou de 1 %: ${bad.map((r) => r.frame).join(", ")}` : "todos os quadros abaixo de 1 %");
process.exit(bad.length ? 1 : 0);
