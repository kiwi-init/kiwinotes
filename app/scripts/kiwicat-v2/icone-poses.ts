// As 5 propostas do ícone do app com o gato novo (T15389, spec #15360, parte 1). O gato sai do renderizador comum (a
// `gato-app.tsx`: o `createKiwiCat` do app) num quadro parado no WebKit headless, com o relógio parado e a mesma
// semente do `gato-igual.ts`. Nada é gerado nem redesenhado: são estados, emotes, paletas e enquadramentos que o gato já
// tem. Cada pose entra na grade do Channels pelo `iconSvg` do `app-icon.ts` (o mesmo caminho do iconset) e sai em 1024,
// 128 e 32 px, numa prancha.
//
// Da raiz do app: `bun scripts/kiwicat-v2/icone-poses.ts [--out PASTA] [--todas] [--fonte ARQUIVO.png] [--medir ARQUIVO.png]`.
//   --todas  em vez das 5, um quadro de cada estado e emote, para escolher as poses.
import { webkit, type Browser } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { GRID, iconSvg } from "../app-icon";
import { serve } from "./servir";

const SEED = 14899;
/** O gato em CSS px; com dpr 2, o PNG tem 2× isso. */
const SIZE_PADRAO = 512;
const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const out = resolve(opt("--out") ?? "/tmp/kiwicat-v2-icone-poses");
mkdirSync(out, { recursive: true });

/** `rosto`: o recorte (a fração do quadro, de cima e centrado na horizontal); sem ele, o quadro inteiro. */
type Pose = { name: string; titulo: string; conceito?: string; state: string; emote: string; seconds: number; palette?: string; rosto?: { top: number; size: number; left?: number }; compor?: (cat: string) => string };
// O gato ocupa só o meio do quadro do renderizador: o recorte o aproxima, senão a 32 px ele vira um borrão. `CORPO`
// guarda o gato inteiro e o emote do canto; o rosto corta o emote e fecha na cabeça.
const CORPO = { top: 0.08, size: 0.8 };
const ROSTO = { top: 0.29, size: 0.46 };
// Os conceitos (harry #15524, #15529): composições que dizem o que o app é. O gato sai do renderizador, sem emote nem
// sinal (o `<svg>` dos sinais some pelo CSS; o rosto é o canvas e fica), na paleta padrão (#15526), com o fundo
// transparente. O resto são formas vetoriais simples nas cores do pacote (`cat-config.ts`). As coordenadas são as do
// ícone de 1024, e a base da grade (100..924) recorta tudo.
const PRISMA = ["#22D3EE", "#6366F1", "#EC4899"];
const PAPEL = "#E9EBF3", LINHA = "#A3A8BC";
const prisma = (id: string, x1 = 0, y1 = 0, x2 = 1, y2 = 1) =>
  `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${PRISMA.map((c, i) => `<stop offset="${i / 2}" stop-color="${c}"/>`).join("")}</linearGradient>`;
const img = (cat: string, x: number, y: number, w: number, extra = "") => `<image x="${x}" y="${y}" width="${w}" height="${w}" href="${cat}" ${extra}/>`;
/** Uma página: o retângulo claro, a dobra no canto e as linhas do texto. */
const pagina = (x: number, y: number, w: number, h: number, linhas: number, rot = 0) => {
  const d = w * 0.18, pad = w * 0.14, gap = (h - pad * 2) / (linhas + 0.5);
  const ls = Array.from({ length: linhas }, (_, i) => {
    const ly = y + pad + gap * (i + 0.8), lw = (w - pad * 2) * (i === linhas - 1 ? 0.55 : 1);
    return `<rect x="${x + pad}" y="${ly}" width="${lw}" height="${Math.max(10, h * 0.035)}" rx="${h * 0.02}" fill="${LINHA}"/>`;
  }).join("");
  return `<g transform="rotate(${rot} ${x + w / 2} ${y + h / 2})"><path d="M${x + 24} ${y}H${x + w - d}L${x + w} ${y + d}V${y + h - 24}Q${x + w} ${y + h} ${x + w - 24} ${y + h}H${x + 24}Q${x} ${y + h} ${x} ${y + h - 24}V${y + 24}Q${x} ${y} ${x + 24} ${y}Z" fill="${PAPEL}"/>` +
    `<path d="M${x + w - d} ${y}V${y + d}H${x + w}Z" fill="#C9CDDB"/>${ls}</g>`;
};
export const POSES: Pose[] = [
  {
    name: "1-espiando", titulo: "Espiando a nota", conceito: "O Notes: o gato espia por cima da página, os olhos acima da borda.",
    state: "repouso", emote: "auto", seconds: 2.5, rosto: ROSTO,
    compor: (cat) => img(cat, 252, 200, 520) + pagina(190, 500, 644, 560, 4),
  },
  {
    name: "2-balao", titulo: "Dentro do balão", conceito: "A voz e o ditado: o gato fala de dentro de um balão.",
    state: "repouso", emote: "auto", seconds: 2.5, rosto: { top: 0.2, size: 0.62 },
    compor: (cat) => {
      const balao = "M300 190H724Q854 190 854 320V600Q854 730 724 730H400L250 860L290 730H300Q170 730 170 600V320Q170 190 300 190Z";
      return `<defs>${prisma("bp")}<clipPath id="bc"><path d="${balao}"/></clipPath></defs>` +
        `<path d="${balao}" fill="#0b0c12"/><g clip-path="url(#bc)">${img(cat, 232, 170, 560)}</g>` +
        `<path d="${balao}" fill="none" stroke="url(#bp)" stroke-width="26" stroke-linejoin="round"/>`;
    },
  },
  {
    name: "3-marca", titulo: "A marca recortada", conceito: "Só as orelhas e os olhos, perto e cortados pela base: quase um símbolo.",
    state: "repouso", emote: "auto", seconds: 2.5, rosto: { top: 0.27, size: 0.4 },
    compor: (cat) => img(cat, 100, 100, 824),
  },
  {
    name: "4-nevoa", titulo: "A névoa da página", conceito: "A nota vira o gato: a névoa sobe da página e ganha rosto.",
    state: "repouso", emote: "auto", seconds: 2.5, rosto: CORPO,
    compor: (cat) => `<defs>${prisma("np", 0, 1, 1, 0)}<filter id="nb" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="16"/></filter></defs>` +
      pagina(170, 560, 330, 380, 3, -8) +
      `<path d="M330 560C330 470 400 450 470 430S560 380 590 330" fill="none" stroke="url(#np)" stroke-width="70" stroke-linecap="round" opacity="0.75" filter="url(#nb)"/>` +
      img(cat, 400, 110, 500),
  },
  {
    name: "5-dormindo", titulo: "Dormindo na nota", conceito: "O gato encolhido em cima da nota, de olhos fechados.",
    state: "dormindo", emote: "auto", seconds: 2.5, rosto: CORPO,
    compor: (cat) => pagina(170, 650, 684, 300, 2) + img(cat, 172, 110, 680),
  },
  {
    name: "6-minimo", titulo: "Minimalista", conceito: "O mínimo que ainda é o gato: a silhueta no prisma do pacote, os olhos, e muito respiro.",
    state: "repouso", emote: "auto", seconds: 2.5,
    compor: () => `<defs>${prisma("mp", 0, 0, 1, 1)}</defs><g transform="translate(512 540) scale(0.62) translate(-512 -540)">` +
      `<path d="M300 470L270 230L440 370Q512 350 584 370L754 230L724 470Q790 540 770 640Q740 790 512 800Q284 790 254 640Q234 540 300 470Z" fill="url(#mp)"/>` +
      `<ellipse cx="430" cy="570" rx="42" ry="48" fill="#fff"/><ellipse cx="594" cy="570" rx="42" ry="48" fill="#fff"/></g>`,
  },
];
// --todas: o repouso de segundo em segundo (para achar a névoa) e o feliz nas paletas, para escolher.
const TODAS: Pose[] = [
  ...[1, 2, 3, 4, 5, 7, 8].map((t) => ({ name: `repouso-${t}s`, titulo: `repouso ${t} s`, state: "repouso", emote: "auto", seconds: t, rosto: CORPO })),
  ...["kiwi-neon", "ambar-solar"].map((palette) => ({ name: `feliz-${palette}`, titulo: `feliz ${palette}`, state: "repouso", emote: "feliz", seconds: 2.5, palette, rosto: CORPO })),
];
const poses = args.includes("--todas") ? TODAS : POSES;

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

/** O gato parado no quadro da pose, no fundo preto da base do ícone. */
async function cat(browser: Browser, origin: string, p: Pose, SIZE = SIZE_PADRAO): Promise<Buffer> {
  const context = await browser.newContext({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 2, reducedMotion: "no-preference" });
  try {
    await context.route("**/*", (r) => (new URL(r.request().url()).origin === origin ? r.continue() : r.abort()));
    await context.addInitScript(seededRandom, SEED);
    const page = await context.newPage();
    const problems: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
    page.on("pageerror", (e) => problems.push(String(e)));
    await page.clock.install({ time: 0 });
    await page.clock.pauseAt(1000);
    await page.goto(`${origin}/?state=${p.state}&emote=${p.emote}&size=${SIZE}${p.palette ? `&palette=${p.palette}` : ""}`, { waitUntil: "load" });
    await page.clock.runFor(Math.round(p.seconds * 1000));
    if (!(await page.evaluate(() => (window as any).kiwiReady))) problems.push("sem window.kiwiReady");
    await page.addStyleTag({ content: `html,body{background:${p.compor ? "transparent" : "#000"}!important} #cat svg{visibility:hidden!important}` });
    const clip = p.rosto
      ? { x: SIZE * (p.rosto.left ?? (1 - p.rosto.size) / 2), y: SIZE * p.rosto.top, width: SIZE * p.rosto.size, height: SIZE * p.rosto.size }
      : undefined;
    const png = await page.screenshot({ ...(clip ? { clip } : {}), omitBackground: !!p.compor });
    if (problems.length) throw new Error(`${p.name}: ${problems.join("; ")}`);
    return png;
  } finally {
    await context.close();
  }
}

/** A composição na grade do Channels: a base preta arredondada recorta tudo. */
function composto(p: Pose, cat: Buffer): string {
  const href = `data:image/png;base64,${cat.toString("base64")}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID.canvas} ${GRID.canvas}" width="${GRID.canvas}" height="${GRID.canvas}">` +
    `<defs><clipPath id="base"><rect x="${GRID.inset}" y="${GRID.inset}" width="${GRID.base}" height="${GRID.base}" rx="${GRID.radius}"/></clipPath></defs>` +
    `<g clip-path="url(#base)"><rect x="${GRID.inset}" y="${GRID.inset}" width="${GRID.base}" height="${GRID.base}" fill="#000"/>${p.compor!(href)}</g></svg>`;
}

const SIZES = [1024, 128, 32] as const;
const app = await serve(resolve(import.meta.dir, "gato-app.tsx"));
const browser = await webkit.launch({ headless: true });
/**
 * O centro do rosto num PNG: o meio dos dois olhos, os pixels quase brancos (> 235 nos 3 canais) da metade de cima
 * do rosto, separados em esquerdo e direito pelo vão entre eles. A boca, também branca, fica fora pelo `yMax`.
 */
async function rosto(png: Buffer, yMax = 0.62): Promise<{ x: number; y: number; w: number; olhos: [number, number] }> {
  const page = await browser.newPage();
  try {
    return await page.evaluate(async ([b64, ymax]) => {
      const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
      const x = c.getContext("2d", { willReadFrequently: true })!; x.drawImage(bmp, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data;
      const xs: number[] = [], ys: number[] = [];
      for (let py = 0; py < c.height * ymax; py++) for (let px = 0; px < c.width; px++) {
        const i = (py * c.width + px) * 4;
        if (d[i]! > 235 && d[i + 1]! > 235 && d[i + 2]! > 235) { xs.push(px); ys.push(py); }
      }
      if (!xs.length) throw new Error("sem olhos no quadro");
      // Os olhos se separam pelo vão entre eles (o maior buraco nos x), não pela mediana: os dois olhos não têm o
      // mesmo número de pixels, e a mediana cairia dentro de um deles (o @quick-heron, T15389 rodada 2).
      const sorted = [...xs].sort((a, b) => a - b);
      let mid = sorted[0]!, gap = -1;
      for (let i = 1; i < sorted.length; i++) if (sorted[i]! - sorted[i - 1]! > gap) { gap = sorted[i]! - sorted[i - 1]!; mid = sorted[i]!; }
      const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
      const l = xs.filter((v) => v < mid), r = xs.filter((v) => v >= mid);
      const el = mean(l), er = mean(r);
      return { x: (el + er) / 2, y: mean(ys), w: c.width, olhos: [el, er] as [number, number] };
    }, [png.toString("base64"), yMax] as const);
  } finally {
    await page.close();
  }
}

// --medir ARQUIVO.png: o desvio do rosto do centro, em px do arquivo (T15551, harry #15650).
const medir = opt("--medir");
if (medir) {
  const { readFileSync } = await import("node:fs");
  const r = await rosto(readFileSync(resolve(medir)));
  console.log(`${medir}: olhos em x=${r.olhos.map((v) => v.toFixed(1)).join(" e ")}, meio ${r.x.toFixed(1)}, centro ${r.w / 2}, desvio ${(r.x - r.w / 2).toFixed(1)} px`);
  await browser.close(); app.close(); process.exit(0);
}

// --fonte: a marca recortada (o 3, a escolha do harry, #15549) em 1024 px, no fundo preto, para o `app-icon.ts`
// (T15551). O gato sai num quadro maior (1280 CSS px, dpr 2) para o recorte de 40 % já ter 1024 px. O recorte fica
// centrado no rosto, o meio dos olhos (harry #15650), não no quadro: o gato do renderizador fica um pouco à direita.
const fonte = opt("--fonte");
if (fonte) {
  try {
    const p = POSES.find((x) => x.name === "3-marca")!;
    const BIG = 1280;
    const inteiro = await cat(browser, app.url, { ...p, compor: undefined, rosto: undefined }, BIG);
    const r = await rosto(inteiro, 0.55);
    const size = BIG * p.rosto!.size, cx = r.x / 2; // o PNG tem dpr 2: as coordenadas CSS são a metade
    const clip = { top: p.rosto!.top, size: p.rosto!.size, left: (cx - size / 2) / BIG };
    const png = await cat(browser, app.url, { ...p, compor: undefined, rosto: clip }, BIG);
    writeFileSync(resolve(fonte), png);
    console.log(`fonte: ${resolve(fonte)} (o rosto em x=${cx.toFixed(1)} de ${BIG} CSS px; o recorte começa em ${(clip.left * BIG).toFixed(1)})`);
  } finally {
    await browser.close();
    app.close();
  }
  process.exit(0);
}
try {
  const icons: Record<string, Record<number, string>> = {};
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await page.route(/^https?:/, (r) => r.abort());
  for (const p of poses) {
    const svg = p.compor ? composto(p, await cat(browser, app.url, p)) : iconSvg(await cat(browser, app.url, p));
    icons[p.name] = {};
    for (const px of SIZES) {
      await page.setViewportSize({ width: px, height: px });
      await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${px}px;height:${px}px}</style>${svg}`);
      const png = await page.screenshot({ omitBackground: true, type: "png" });
      icons[p.name]![px] = png.toString("base64");
      writeFileSync(resolve(out, `${p.name}-${px}.png`), png);
    }
    console.log(`${p.name.padEnd(20)} ${p.titulo}`);
  }
  // A prancha: uma linha por pose, o 1024 mostrado a 256 e o 128 e o 32 a 1:1, no fundo do Dock claro e no escuro.
  const cell = (b64: string, px: number, show = px) => `<img width="${show}" height="${show}" src="data:image/png;base64,${b64}">`;
  const row = (p: Pose) => `<div class="row"><h2>${p.titulo}${p.conceito ? `<small>${p.conceito}</small>` : ""}</h2>
    <figure>${cell(icons[p.name]![1024]!, 1024, 256)}<figcaption>1024</figcaption></figure>
    <figure>${cell(icons[p.name]![128]!, 128)}<figcaption>128</figcaption></figure>
    <figure>${cell(icons[p.name]![32]!, 32)}<figcaption>32</figcaption></figure>
    <figure class="dark">${cell(icons[p.name]![128]!, 128)}${cell(icons[p.name]![32]!, 32)}<figcaption>no escuro</figcaption></figure></div>`;
  const html = `<!doctype html><style>
    body{margin:0;padding:24px;font:14px -apple-system,system-ui;color:#222;background:#ececec;width:fit-content}
    .row{display:flex;align-items:flex-end;gap:28px;margin-bottom:20px}
    h2{width:180px;font-size:14px;margin:0 0 90px} h2 small{display:block;font-weight:400;color:#555;margin-top:6px;line-height:1.35}
    figure{margin:0;text-align:center;display:flex;flex-direction:column;align-items:center;gap:6px}
    figure.dark{background:#1e1e1e;padding:14px;border-radius:12px;flex-direction:row;align-items:flex-end;gap:18px}
    figure.dark figcaption{color:#aaa}
    figcaption{color:#666;font-size:12px}
  </style>${poses.map(row).join("")}`;
  await page.setViewportSize({ width: 900, height: 400 });
  await page.setContent(html);
  const file = resolve(out, args.includes("--todas") ? "todas.png" : "prancha.png");
  writeFileSync(file, await page.screenshot({ fullPage: true, type: "png" }));
  console.log(`prancha: ${file} (a grade do Channels: base ${GRID.base} em ${GRID.canvas})`);
} finally {
  await browser.close();
  app.close();
}
