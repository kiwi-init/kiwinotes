// "Igual ao pacote" do gato (T14899, spec #14813): o gato do app e o `ByteKiwiCat.tsx` do pacote, no mesmo WebKit
// headless, no mesmo instante: os 5 estados e os 5 emotes. Mede quantos pixels diferem mais que 8/255 em algum canal
// (o limite: 1 % por quadro) e salva os dois lado a lado (o app à esquerda, o pacote à direita), como o
// `intro-igual.ts` da T14851.
//
// As paletas (T15035, spec #14963): os mesmos quadros em cada uma das 5 paletas do pacote, com `?palette=` nos dois
// lados (no app, pelo `cor`; no pacote, pelo `config`). Cada paleta numa subpasta; o controle roda uma vez, na padrão.
//
// Da raiz do app: `bun scripts/kiwicat-v2/gato-igual.ts [--app ENTRADA] [--out PASTA] [--palette ID]`. Sai 1 se algum
// quadro passa de 1 %.
//   --palette  só uma paleta (o id); sem ele, as 5.
//   --vazio app|pacote  esconde o canvas do gato daquele lado (fica só o emote, como a captura em branco do #15397):
//          a prova da guarda abaixo, que tem de sair com 2.
//
// A guarda da captura vazia (T15403): cada lado tem de cobrir pelo menos `MIN_COVER` do quadro com pixels fora do
// fundo (mais que 8/255 do pixel do canto). Sem isso, um lado em branco dava um falso vermelho, e os dois em branco,
// um falso verde. Um quadro abaixo do mínimo sai no fim com exit 2, com o nome do quadro e o lado.
//   --app  a página do gato do app (padrão: `scripts/kiwicat-v2/gato-app.tsx`). O contrato é o da `novo.tsx`: lê
//          `?state=&emote=&size=`, desenha o gato em `#cat` e põe `window.kiwiReady = true`. Servida pelo `servir.ts`,
//          com a CSP das janelas. `--app pacote` compara o pacote com ele mesmo: mede o ruído da captura.
//
// O mesmo instante dos dois lados: o gato anda num laço de requestAnimationFrame que soma o dt e sorteia a piscada
// (`Math.random`), então um `?t=` não basta. Cada página abre com o relógio do Playwright parado (Date, performance,
// requestAnimationFrame e timers falsos) e o `Math.random` com a mesma semente; o relógio anda em quadros de 16 ms
// até 2,5 s, e só então sai o print.
import { webkit, type Browser } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { KIWI_COLOR_PALETTES } from "../../../docs/design/kiwicat-v2/agente/ByteKiwiCat";
import { serve } from "./servir";

const LIMIT = 0.01;
const THRESHOLD = 8;
const SEED = 14899;
const SIZE = 240;
/** A fração mínima do quadro fora do fundo, em cada lado (T15403). */
const MIN_COVER = Number(process.env.KIWI_MIN_COVER ?? 0.05);

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const out = resolve(opt("--out") ?? "/tmp/kiwicat-v2-gato-igual");
const appEntry = opt("--app") ?? "scripts/kiwicat-v2/gato-app.tsx";
const vazio = opt("--vazio");
if (vazio && vazio !== "app" && vazio !== "pacote") { console.error("--vazio app|pacote"); process.exit(2); }
mkdirSync(out, { recursive: true });

type Frame = { name: string; state: string; emote: string; seconds: number; palette?: string; pacotePalette?: string; pacoteSeconds?: number; pacoteSeed?: number; minPct?: number };
const onlyPalette = opt("--palette");
const palettes = KIWI_COLOR_PALETTES.map((p) => p.id).filter((id) => !onlyPalette || id === onlyPalette);
if (!palettes.length) { console.error(`paleta desconhecida: ${onlyPalette} (${KIWI_COLOR_PALETTES.map((p) => p.id).join(", ")})`); process.exit(2); }
const base: Frame[] = [
  ...["repouso", "ouvindo", "pensando", "respondendo", "dormindo"].map((state) => ({ name: state, state, emote: "auto", seconds: 2.5 })),
  ...["alerta", "confuso", "cansado", "feliz", "limite"].map((emote) => ({ name: `emote-${emote}`, state: "repouso", emote, seconds: 2.5 })),
];
const frames: Frame[] = palettes.flatMap((palette) => base.map((f) => ({ ...f, name: `${palette}/${f.name}`, palette })));
for (const palette of palettes) mkdirSync(resolve(out, palette), { recursive: true });
// O controle: o mesmo gato 0,5 s depois no pacote. Tem que passar de 1 %, senão a medida não vê nada.
// O 2º controle (T14885, pedido do @nimble-heron): só a piscada. A semente só sorteia a piscada; aos 6 s em repouso, o
// pacote com a 14899 está de olho fechado (5,6 a 6,3 s) e com a 7, aberto (medido no próprio pacote, de 0,1 em 0,1 s).
// O resto do quadro é igual. Uma piscada é ~0,7 % do quadro, abaixo do limite de 1 %: este controle passa de 0,2 %
// (7× o ruído da captura, 0,028 %), e mostra que a medida vê a piscada; os quadros de cima ficam bem abaixo disso.
const CONTROLES: Frame[] = [
  { name: "controle", state: "pensando", emote: "auto", seconds: 2.5, pacoteSeconds: 3 },
  { name: "controle-piscada", state: "repouso", emote: "auto", seconds: 6, pacoteSeed: 7, minPct: 0.002 },
  // O 3º controle (T15035): só a paleta. O app na `prisma-original` e o pacote na `kiwi-neon`, no mesmo instante. Tem
  // que passar de 1 %, senão um dos lados ignora o `?palette=` e os quadros de cima comparam a padrão com a padrão.
  { name: "controle-paleta", state: "pensando", emote: "auto", seconds: 2.5, palette: "prisma-original", pacotePalette: "kiwi-neon" },
];

/** O Math.random com semente (mulberry32), antes de qualquer script da página. */
function seededRandom(seed: number) {
  let a = seed >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function shot(browser: Browser, origin: string, f: Frame, seconds: number, seed = SEED, palette = f.palette, empty = false): Promise<Buffer> {
  const context = await browser.newContext({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 2, reducedMotion: "no-preference" });
  try {
    await context.route("**/*", (r) => (new URL(r.request().url()).origin === origin ? r.continue() : r.abort()));
    await context.addInitScript(seededRandom, seed);
    if (empty) await context.addInitScript(() => {
      const style = () => document.head.append(Object.assign(document.createElement("style"), { textContent: "#cat canvas{opacity:0!important}" }));
      if (document.head) style(); else document.addEventListener("DOMContentLoaded", style);
    });
    const page = await context.newPage();
    const problems: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
    page.on("pageerror", (e) => problems.push(String(e)));
    await page.clock.install({ time: 0 });
    await page.clock.pauseAt(1000);
    await page.goto(`${origin}/?state=${f.state}&emote=${f.emote}&size=${SIZE}${palette ? `&palette=${palette}` : ""}`, { waitUntil: "load" });
    await page.clock.runFor(Math.round(seconds * 1000));
    if (!(await page.evaluate(() => (window as any).kiwiReady))) problems.push("sem window.kiwiReady");
    const png = await page.screenshot();
    if (problems.length) throw new Error(`${origin} ${f.name}: ${problems.join("; ")}`);
    return png;
  } finally {
    await context.close();
  }
}

if (appEntry !== "pacote" && !existsSync(resolve(import.meta.dir, "../..", appEntry))) {
  console.error(`sem ${appEntry}: a página do gato do app (T14885) ainda não existe. Para medir só o ruído: --app pacote`);
  process.exit(2);
}
const pacote = await serve("novo.tsx");
const app = appEntry === "pacote" ? pacote : await serve(resolve(import.meta.dir, "../..", appEntry));

const browser = await webkit.launch({ headless: true });
const rows: { frame: string; palette?: string; state: string; emote: string; seconds: number; over: number; pct: number; maxDiff: number; coverApp: number; coverPacote: number }[] = [];
try {
  const cmp = await browser.newPage();
  for (const f of [...frames, ...CONTROLES]) {
    const a = await shot(browser, app.url, f, f.seconds, SEED, f.palette, vazio === "app");
    const b = await shot(browser, pacote.url, f, f.pacoteSeconds ?? f.seconds, f.pacoteSeed ?? SEED, f.pacotePalette ?? f.palette, vazio === "pacote");
    // A comparação e o lado a lado num canvas, na mesma página (como o intro-igual.ts).
    const r = await cmp.evaluate(async ([a64, b64, th]) => {
      const load = async (s: string) => createImageBitmap(await (await fetch(`data:image/png;base64,${s}`)).blob());
      const [ia, ib] = await Promise.all([load(a64), load(b64)]);
      if (ia.width !== ib.width || ia.height !== ib.height) return { over: 1, total: 1, maxDiff: 255, coverA: 0, coverB: 0, side: "" };
      const w = ia.width, h = ia.height;
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const x = c.getContext("2d", { willReadFrequently: true })!;
      x.drawImage(ia, 0, 0); const da = x.getImageData(0, 0, w, h).data;
      x.clearRect(0, 0, w, h); x.drawImage(ib, 0, 0); const db = x.getImageData(0, 0, w, h).data;
      // A cobertura de cada lado: os pixels a mais de `th` do pixel do canto (o fundo).
      const cover = (d: Uint8ClampedArray) => {
        let n = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (Math.max(Math.abs(d[i] - d[0]), Math.abs(d[i + 1] - d[1]), Math.abs(d[i + 2] - d[2])) > th) n++;
        }
        return n / (w * h);
      };
      const coverA = cover(da), coverB = cover(db);
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
      return { over, total: w * h, maxDiff, coverA, coverB, side: s.toDataURL("image/png").split(",")[1] };
    }, [a.toString("base64"), b.toString("base64"), THRESHOLD] as const);
    const pct = r.over / r.total;
    rows.push({ frame: f.name, palette: f.palette, state: f.state, emote: f.emote, seconds: f.seconds, over: r.over, pct, maxDiff: r.maxDiff, coverApp: r.coverA, coverPacote: r.coverB });
    if (r.side) writeFileSync(resolve(out, `${f.name}.png`), Buffer.from(r.side, "base64"));
    console.log(`${f.name.padEnd(34)} ${(pct * 100).toFixed(3).padStart(7)} % acima de ${THRESHOLD}/255 (máx ${r.maxDiff}; cobre ${(r.coverA * 100).toFixed(1)} % / ${(r.coverB * 100).toFixed(1)} %)`);
  }
} finally {
  await browser.close();
  pacote.close();
  if (app !== pacote) app.close();
}
writeFileSync(resolve(out, "igual.json"), JSON.stringify({ app: appEntry, palettes, vazio: vazio ?? null, minCover: MIN_COVER, limit: LIMIT, threshold: THRESHOLD, seed: SEED, viewport: { width: SIZE, height: SIZE, dpr: 2 }, frames: rows }, null, 2));
const empty = rows.flatMap((r) => [
  ...(r.coverApp < MIN_COVER ? [`${r.frame} (app, ${(r.coverApp * 100).toFixed(2)} %)`] : []),
  ...(r.coverPacote < MIN_COVER ? [`${r.frame} (pacote, ${(r.coverPacote * 100).toFixed(2)} %)`] : []),
]);
if (empty.length) {
  console.log(`captura vazia, abaixo de ${MIN_COVER * 100} % do quadro fora do fundo: ${empty.join(", ")}`);
  process.exit(2);
}
const isControl = (name: string) => CONTROLES.some((c) => c.name === name);
const bad = rows.filter((r) => !isControl(r.frame) && r.pct > LIMIT);
const blind = rows.filter((r) => isControl(r.frame) && r.pct <= (CONTROLES.find((c) => c.name === r.frame)!.minPct ?? LIMIT));
if (blind.length) { console.log(`o controle não passou do mínimo dele: a medida está cega (${blind.map((r) => r.frame).join(", ")})`); process.exit(1); }
console.log(bad.length ? `passou de 1 %: ${bad.map((r) => r.frame).join(", ")}` : "todos os quadros abaixo de 1 %");
process.exit(bad.length ? 1 : 0);
