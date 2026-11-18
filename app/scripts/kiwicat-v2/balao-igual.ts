// "Igual ao pacote" do balão (T14952 e T15095, spec #14896): o `CatBubble` do hub e o `KiwiSpeechBubble` do pacote, no
// mesmo WebKit headless, com o mesmo texto: o curto (rabo à direita e à esquerda), o grande (3 linhas, o máximo do
// balão pequeno) e o fundo claro (o balão fica escuro também no tema claro, #14908). Mede quantos pixels diferem mais que 8/255 em algum canal, com o limite de 1 % por
// quadro, como o `intro-igual.ts` (T14851) e o `gato-igual.ts` (T14899).
//
// Da raiz do app: `bun scripts/kiwicat-v2/balao-igual.ts [--app ENTRADA|pacote] [--out PASTA]`. Sai 1 se algum quadro
// passa de 1 % na casca. A % é sobre a área do balão (a caixa dos pixels que fogem do fundo nos dois prints), não
// sobre a página.
//   --app  a página do balão do app (padrão: `scripts/kiwicat-v2/balao-app.tsx`, o `CatBubble` com um engine falso),
//          com o contrato da `balao-pacote.tsx`: lê `?texto=&rabo=&fundo=`, põe o balão em (24, 24) e
//          `window.kiwiReady = true`. Um quadro que a página não tem (`window.kiwiSkip`, por exemplo o rabo à
//          esquerda, que é do overlay) sai com o motivo e sem número.
//          `--app pacote` compara o pacote com ele mesmo: mede o ruído da captura.
//
// Duas medidas por quadro:
//   casca  o texto some dos dois lados (`color: transparent` em tudo): sobram o fundo, a borda, a sombra, o raio e o
//          rabo. É a medida do spec, e é ela que decide o exit.
//   texto  o balão como aparece. Só informa: a fonte e o "Ver mais" do app podem mudar a conta sem mudar a casca.
// O overlay (T15095, #15179): o `#bubble` da página do overlay de verdade (`dist/catoverlay`, o build do Vite, como o
// `kiwicat-bubble-check.ts`), com o gato na imagem parada (`backend=none`) e o balão pelo `kiwiOverlay.set`, como o
// helper manda. Lá a largura é 280 (a janela tem 300; aberto, até 480, spec #17673: `overlay-aberto-largo`), o rabo aponta para o meio do gato (para baixo, ou para cima com
// o balão embaixo) e a linha das ações (o ×) fica sempre embaixo do texto: o balão é outro por desenho, então os
// números do overlay só informam e não decidem o exit. A comparação recorta os dois balões pela caixa da casca (com o
// rabo e a sombra) e encosta os dois no canto de cima à esquerda. `--sem-overlay` pula essa parte.
//
// Só do app, sem número (o pacote não tem): o rabo para cima e para baixo, o balão com o [Ver mais] (um texto maior
// que 3 linhas) e o balão grande que ele abre (`.kn-bubble-big`). Saem os prints, para o harry ver na rc.
//
// O balão do app digita (18 ms por letra) e entra com uma mola: o relógio do Playwright fica parado e anda em quadros
// de 16 ms até a digitação acabar e mais 1,5 s, antes do tempo de leitura fechar o balão. As animações de CSS e da Web
// Animations, que andam no relógio de verdade, são levadas ao fim antes do print.
import { webkit, type Browser } from "playwright-core";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { serve } from "./servir";
import { OPEN_SHELL_W, SHELL_W } from "../../ui/catoverlay/placement";

const LIMIT = 0.01;
const THRESHOLD = 8;
const VIEWPORT = { width: 400, height: 400 };
const TYPE_MS = 18;
const runMs = (texto: string) => TYPE_MS * [...texto].length + 1500;

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const out = resolve(opt("--out") ?? "/tmp/kiwicat-v2-balao-igual");
const appEntry = opt("--app") ?? "scripts/kiwicat-v2/balao-app.tsx";
mkdirSync(out, { recursive: true });

// Textos inventados (AGENTS.md): o curto é uma linha; o grande enche as 3 linhas do balão pequeno; o longo passa
// delas (o [Ver mais]).
const CURTO = "Achei 3 notas sobre o Projeto X.";
const GRANDE = "Li as notas da Ana sobre o Projeto X: a reunião de terça ficou para quinta e o orçamento passou. Quer um resumo?";
const LONGO = "Li as notas da Ana sobre o Projeto X: a reunião de terça ficou para quinta, o orçamento passou e faltam " +
  "dois itens da lista. Quer que eu junte tudo numa nota nova, com os prazos de cada um?";
type Frame = { name: string; texto: string; rabo: string; fundo: string; soApp?: boolean; abrir?: boolean };
const frames: Frame[] = [
  { name: "curto-direita", texto: CURTO, rabo: "right", fundo: "escuro" },
  { name: "curto-esquerda", texto: CURTO, rabo: "left", fundo: "escuro" },
  { name: "grande", texto: GRANDE, rabo: "right", fundo: "escuro" },
  { name: "fundo-claro", texto: CURTO, rabo: "right", fundo: "claro" },
  { name: "rabo-cima", texto: CURTO, rabo: "up", fundo: "escuro", soApp: true },
  { name: "rabo-baixo", texto: CURTO, rabo: "down", fundo: "escuro", soApp: true },
  { name: "ver-mais", texto: LONGO, rabo: "right", fundo: "escuro", soApp: true },
  { name: "balao-grande", texto: LONGO, rabo: "right", fundo: "escuro", soApp: true, abrir: true },
];
// O controle: a casca do pacote com o rabo à direita contra ela mesma com o rabo à esquerda, uma mudança pequena.
// Tem que passar de 1 %, senão a medida não vê nada.
const CONTROLE = { name: "controle", a: { ...frames[0]! }, b: { ...frames[1]! } };

const HIDE_TEXT = "*, *::before, *::after { color: transparent !important; caret-color: transparent !important; text-shadow: none !important; }";

async function shot(browser: Browser, origin: string, f: Frame, casca: boolean): Promise<Buffer | string> {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, reducedMotion: "no-preference" });
  try {
    await context.route("**/*", (r) => (new URL(r.request().url()).origin === origin ? r.continue() : r.abort()));
    const page = await context.newPage();
    const problems: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
    page.on("pageerror", (e) => problems.push(String(e)));
    await page.clock.install({ time: 0 });
    await page.clock.pauseAt(1000);
    const q = new URLSearchParams({ texto: f.texto, rabo: f.rabo, fundo: f.fundo, ...(f.abrir ? { abrir: "1" } : {}) });
    await page.goto(`${origin}/?${q}`, { waitUntil: "load" });
    await page.clock.runFor(runMs(f.texto));
    if (!(await page.evaluate(() => (window as any).kiwiReady))) problems.push("sem window.kiwiReady");
    const skip = await page.evaluate(() => (window as any).kiwiSkip as string | undefined);
    if (skip) return skip;
    // A entrada (CSS) e a mola (Web Animations) andam no relógio de verdade: vão ao fim, as infinitas ficam.
    await page.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish(); } catch {} }));
    // A folha de estilo entra pelo Playwright, fora da CSP da página.
    if (casca) await page.addStyleTag({ content: HIDE_TEXT });
    const png = await page.screenshot();
    if (problems.length) throw new Error(`${origin} ${f.name}: ${problems.join("; ")}`);
    return png;
  } finally {
    await context.close();
  }
}

/** A % de pixels acima do limite e os dois lado a lado (o app à esquerda, o pacote à direita), num canvas. */
async function compare(cmp: Awaited<ReturnType<Browser["newPage"]>>, a: Buffer, b: Buffer | null) {
  return cmp.evaluate(async ([a64, b64, th]) => {
    const load = async (s: string) => createImageBitmap(await (await fetch(`data:image/png;base64,${s}`)).blob());
    const ia = await load(a64);
    const ib = b64 ? await load(b64) : null;
    // Dois recortes de tamanhos diferentes (o overlay): o menor fica no canto de cima à esquerda, sobre o fundo dele.
    const w = Math.max(ia.width, ib?.width ?? 0), h = Math.max(ia.height, ib?.height ?? 0);
    let over = 0, maxDiff = 0, area = w * h;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const x = c.getContext("2d", { willReadFrequently: true })!;
    const onBg = (img: ImageBitmap) => {
      x.clearRect(0, 0, w, h); x.drawImage(img, 0, 0);
      const [r, g, bl] = x.getImageData(0, 0, 1, 1).data;
      x.fillStyle = `rgb(${r},${g},${bl})`; x.fillRect(0, 0, w, h); x.drawImage(img, 0, 0);
      return x.getImageData(0, 0, w, h).data;
    };
    const da = onBg(ia);
    if (ib) {
      const db = onBg(ib);
      // A área do balão: a caixa que junta os pixels que fogem do fundo (o pixel do canto) num lado ou no outro.
      // A conta é sobre ela, não sobre a página inteira, que é quase toda fundo e diluiria a diferença.
      const away = (d: Uint8ClampedArray, i: number) => Math.max(Math.abs(d[i] - d[0]), Math.abs(d[i + 1] - d[1]), Math.abs(d[i + 2] - d[2])) > th;
      let x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (let i = 0; i < da.length; i += 4) {
        if (!away(da, i) && !away(db, i)) continue;
        const px = (i / 4) % w, py = Math.floor(i / 4 / w);
        x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py);
      }
      for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
        const i = (py * w + px) * 4;
        const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]), Math.abs(da[i + 3] - db[i + 3]));
        if (d > maxDiff) maxDiff = d;
        if (d > th) over++;
      }
      area = x1 < 0 ? 1 : (x1 - x0 + 1) * (y1 - y0 + 1);
    }
    const s = document.createElement("canvas");
    s.width = ib ? w * 2 + 16 : w; s.height = h;
    const sx = s.getContext("2d")!;
    sx.fillStyle = "#ffffff"; sx.fillRect(0, 0, s.width, s.height);
    sx.putImageData(new ImageData(da, w, h), 0, 0);
    if (ib) { sx.putImageData(new ImageData(onBg(ib), w, h), w + 16, 0); sx.fillStyle = "#d4d4d8"; sx.fillRect(w + 7, 0, 2, h); }
    return { over, total: area, maxDiff, side: s.toDataURL("image/png").split(",")[1]! };
  }, [a.toString("base64"), b ? b.toString("base64") : "", THRESHOLD] as const);
}

/** A caixa da casca com o rabo (24 px para fora) e a sombra (4 px embaixo), em CSS px. */
async function shellClip(page: import("playwright-core").Page, sel: string, tailUp: boolean) {
  const r = await page.evaluate((s) => { const b = document.querySelector(s)!.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; }, sel);
  return tailUp ? { x: r.x, y: r.y - 24, width: r.w, height: r.h + 28 } : { x: r.x, y: r.y, width: r.w, height: r.h + 28 };
}

/** O pacote recortado pela casca, para comparar com o overlay. */
async function shotPacoteCrop(browser: Browser, origin: string, f: Frame, casca: boolean): Promise<Buffer> {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  try {
    const page = await context.newPage();
    const q = new URLSearchParams({ texto: f.texto, rabo: f.rabo, fundo: f.fundo });
    await page.goto(`${origin}/?${q}`, { waitUntil: "load" });
    await page.waitForFunction(() => (window as any).kiwiReady === true);
    if (casca) await page.addStyleTag({ content: HIDE_TEXT });
    return await page.screenshot({ clip: await shellClip(page, "#cat > div > div", false) });
  } finally {
    await context.close();
  }
}

/** `largura` (spec #17673): a casca aberta que o helper manda; a janela ganha o espaço a mais do lado do balão. */
type OverlayFrame = { name: string; texto: string; balao: "acima" | "abaixo"; pacote: Frame | null; abrir?: boolean; largura?: number };
/** O `#bubble` do overlay de verdade, recortado pela casca. */
async function shotOverlay(browser: Browser, port: number, f: OverlayFrame, casca: boolean): Promise<Buffer> {
  const sala = 360;
  const largura = f.largura ?? SHELL_W;
  const width = 300 + largura - SHELL_W;
  const context = await browser.newContext({ viewport: { width, height: 240 + sala }, deviceScaleFactor: 2, colorScheme: "dark" });
  try {
    // O `kiwiCat` do helper: a página manda o retângulo do balão; aqui ninguém precisa dele.
    await context.addInitScript(() => { (window as any).webkit = { messageHandlers: { kiwiCat: { postMessage: () => {} } } }; });
    const page = await context.newPage();
    const problems: string[] = [];
    page.on("pageerror", (e) => problems.push(String(e)));
    await page.goto(`http://127.0.0.1:${port}/index.html?backend=none&escala=1.00&lado=right&balao=${f.balao}`);
    await page.waitForFunction(() => (window as any).kiwiCatReady === true, undefined, { timeout: 20_000 });
    // O fundo da página do pacote (o overlay é transparente) e o gato fora: só o balão entra no recorte.
    await page.addStyleTag({ content: "html, body { background: #090a0e !important; } #cat { visibility: hidden; }" });
    await page.evaluate(([t, l]) => (window as any).kiwiOverlay.set({ estado: "pronto", visible: true, sala: 360, largura: l, bubble: { text: t, error: false } }), [f.texto, largura] as const);
    if (f.abrir) await page.click("#bubble-more");
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await Bun.sleep(300); // a transição de 140 ms do balão
    await page.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish(); } catch {} }));
    if (casca) await page.addStyleTag({ content: HIDE_TEXT });
    const png = await page.screenshot({ clip: await shellClip(page, "#bubble", f.balao === "abaixo") });
    if (problems.length) throw new Error(`overlay ${f.name}: ${problems.join("; ")}`);
    return png;
  } finally {
    await context.close();
  }
}

if (appEntry !== "pacote" && !existsSync(resolve(import.meta.dir, "../..", appEntry))) {
  console.error(`sem ${appEntry}: a página do balão do app (T14933) ainda não existe. Para medir só o ruído: --app pacote`);
  process.exit(2);
}
const pacote = await serve("balao-pacote.tsx");
const app = appEntry === "pacote" ? pacote : await serve(resolve(import.meta.dir, "../..", appEntry));

// O overlay: o build do Vite da página de verdade, servido como arquivos (como o kiwicat-bubble-check.ts).
let overlay: ReturnType<typeof Bun.serve> | null = null;
if (!args.includes("--sem-overlay") && appEntry !== "pacote") {
  const appDir = resolve(import.meta.dir, "../..");
  const dist = join(appDir, "dist", "catoverlay");
  const build = spawnSync("bun", ["x", "vite", "build"], { cwd: appDir, stdio: "ignore", env: { ...process.env, KIWI_UI_WINDOW: "catoverlay" } });
  if (build.status !== 0 || !existsSync(join(dist, "index.html"))) { console.error("o build da página catoverlay falhou"); process.exit(2); }
  overlay = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(r) {
      const file = Bun.file(join(dist, new URL(r.url).pathname.replace(/^\/$/, "/index.html")));
      return (await file.exists()) ? new Response(file) : new Response("", { status: 404 });
    },
  });
}

const browser = await webkit.launch({ headless: true });
type Row = { frame: string; rabo: string; fundo: string; casca: number | null; texto: number | null; maxDiff: number | null; skip?: string; info?: boolean };
const rows: Row[] = [];
const pct = (r: { over: number; total: number }) => r.over / r.total;
const fmt = (v: number | null) => (v === null ? "      —" : `${(v * 100).toFixed(3).padStart(7)} %`);
let controle = 0;
try {
  const cmp = await browser.newPage();
  for (const f of frames) {
    // O pacote só tem rabo de lado: o rabo de cima e o de baixo saem só do app.
    if (f.soApp && appEntry === "pacote") continue;
    const pacoteFrame = f.soApp ? null : f;
    const appShell = await shot(browser, app.url, f, true);
    if (typeof appShell === "string") {
      rows.push({ frame: f.name, rabo: f.rabo, fundo: f.fundo, casca: null, texto: null, maxDiff: null, skip: appShell });
      console.log(`${f.name.padEnd(16)} casca       —   texto       —   (fora: ${appShell})`);
      continue;
    }
    const png = async (origin: string, casca: boolean) => (await shot(browser, origin, f, casca)) as Buffer;
    const shell = await compare(cmp, appShell, pacoteFrame ? await png(pacote.url, true) : null);
    const full = await compare(cmp, await png(app.url, false), pacoteFrame ? await png(pacote.url, false) : null);
    writeFileSync(resolve(out, `${f.name}.png`), Buffer.from(full.side, "base64"));
    writeFileSync(resolve(out, `${f.name}-casca.png`), Buffer.from(shell.side, "base64"));
    const row: Row = { frame: f.name, rabo: f.rabo, fundo: f.fundo, casca: pacoteFrame ? pct(shell) : null, texto: pacoteFrame ? pct(full) : null, maxDiff: pacoteFrame ? shell.maxDiff : null };
    rows.push(row);
    console.log(`${f.name.padEnd(16)} casca ${fmt(row.casca)}   texto ${fmt(row.texto)}   acima de ${THRESHOLD}/255${pacoteFrame ? ` (máx da casca ${shell.maxDiff})` : " (só o app: o pacote não tem esse quadro)"}`);
  }
  if (overlay) {
    const ovFrames: OverlayFrame[] = [
      { name: "overlay-curto", texto: CURTO, balao: "acima", pacote: frames[0]! },
      { name: "overlay-grande", texto: GRANDE, balao: "acima", pacote: frames[2]! },
      { name: "overlay-abaixo", texto: CURTO, balao: "abaixo", pacote: null },
      { name: "overlay-ver-mais", texto: LONGO, balao: "acima", pacote: null },
      { name: "overlay-aberto", texto: LONGO, balao: "acima", pacote: null, abrir: true },
      { name: "overlay-aberto-largo", texto: LONGO, balao: "acima", pacote: null, abrir: true, largura: OPEN_SHELL_W },
    ];
    for (const f of ovFrames) {
      const pk = f.pacote;
      const shell = await compare(cmp, await shotOverlay(browser, overlay.port!, f, true), pk ? await shotPacoteCrop(browser, pacote.url, pk, true) : null);
      const full = await compare(cmp, await shotOverlay(browser, overlay.port!, f, false), pk ? await shotPacoteCrop(browser, pacote.url, pk, false) : null);
      writeFileSync(resolve(out, `${f.name}.png`), Buffer.from(full.side, "base64"));
      writeFileSync(resolve(out, `${f.name}-casca.png`), Buffer.from(shell.side, "base64"));
      const row: Row = { frame: f.name, rabo: f.balao === "abaixo" ? "up" : "down", fundo: "escuro", casca: pk ? pct(shell) : null, texto: pk ? pct(full) : null, maxDiff: pk ? shell.maxDiff : null, info: true };
      rows.push(row);
      console.log(`${f.name.padEnd(16)} casca ${fmt(row.casca)}   texto ${fmt(row.texto)}   ${pk ? "(só informa: o overlay é outro por desenho)" : "(só o overlay: print)"}`);
    }
  }
  const c = await compare(cmp, (await shot(browser, pacote.url, CONTROLE.a, true)) as Buffer, (await shot(browser, pacote.url, CONTROLE.b, true)) as Buffer);
  controle = pct(c);
  writeFileSync(resolve(out, "controle.png"), Buffer.from(c.side, "base64"));
  console.log(`${"controle".padEnd(16)} casca ${fmt(controle)}   (a casca do pacote: rabo à direita × à esquerda)`);
} finally {
  await browser.close();
  pacote.close();
  if (app !== pacote) app.close();
  overlay?.stop(true);
}
writeFileSync(resolve(out, "igual.json"), JSON.stringify({ app: appEntry, limit: LIMIT, threshold: THRESHOLD, viewport: { ...VIEWPORT, dpr: 2 }, typeMs: TYPE_MS, controle, frames: rows }, null, 2));
const bad = rows.filter((r) => !r.info && r.casca !== null && r.casca > LIMIT);
if (controle <= LIMIT) { console.log("o controle não passou de 1 %: a medida está cega"); process.exit(1); }
console.log(bad.length ? `a casca passou de 1 %: ${bad.map((r) => r.frame).join(", ")}` : "a casca fica abaixo de 1 % em todos os quadros");
process.exit(bad.length ? 1 : 0);
