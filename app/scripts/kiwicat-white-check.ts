// T11696 (spec #9573, o harry no #11675): o gato recortado no fundo branco com a mesma forma do preto. Captura o gato
// em RGBA (WebKit headless, WebGPU) e compõe no preto, no branco e na cor, no mesmo instante e semente.
//
//   bun scripts/kiwicat-white-check.ts <saída> [--root <app de outra worktree, para o "antes">] [--backing a,b,c]
//   [--video]
// Pegue `kiwi lock bench` antes.
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { webkit } from "playwright-core";

const argv = process.argv.slice(2);
const flag = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const out = resolve(argv[0] ?? "/tmp/kiwi-T11696"); mkdirSync(out, { recursive: true });
const root = resolve(flag("--root") ?? resolve(import.meta.dir, ".."));
const backings = (flag("--backing") ?? ".5").split(",").map(Number);
const W = 640, H = 800, SEED = 17;
const AT: Record<string, number> = { repouso: 2, acordou: 0.53, agindo: 1.2, erro: 0.85, thinking: 1.6, pronto: 0.6 };
// O fundo, a tinta dos símbolos e a superfície da névoa (fora do preto, "light": #12150).
const BACKS = [["preto", "#000000", "dark", "dark"], ["branco", "#ffffff", "light", "light"], ["cor", "#367a8e", "dark", "light"]] as const;
const { serveFogDemo } = await import(join(root, "scripts/kiwicat-demo.ts"));
const server = await serveFogDemo("cat-demo.ts");
const browser = await webkit.launch({ headless: true });

async function cat(state: string, backing: number, ink: string, surface: string) {
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await context.route("**/*", (r) => (new URL(r.request().url()).origin === server.url ? r.continue() : r.abort()));
  const page = await context.newPage();
  await page.goto(`${server.url}/?state=repouso&cutout=1&outline=1&backing=${backing}&edgeBand=.08&color=claude&seed=${SEED}&width=${W}&height=${H}&symbolTheme=${ink}&surface=${surface}`);
  await page.waitForFunction(() => (window as any).kiwiCatReady);
  await page.evaluate((state) => {
    document.documentElement.style.background = "transparent"; document.body.style.background = "transparent";
    (window as any).kiwiCat.update({ estado: state, voz: null });
  }, state);
  const shot = async (t: number, bg: string) => {
    const used = await page.evaluate(({ t, bg }) => {
      document.documentElement.style.background = bg; document.body.style.background = bg;
      const a = (window as any).kiwiCat; a.capture(t); return a.fogStats.backend;
    }, { t, bg });
    assert.equal(used, "webgpu");
    return page.screenshot();
  };
  return { shot, close: () => context.close() };
}

const report: Record<string, unknown> = { root, backings, seed: SEED };
try {
  const cells: string[] = [];
  for (const state of ["agindo", "acordou", "erro", "repouso"]) {
    for (const backing of backings) {
      for (const [name, color, ink, surface] of BACKS) {
        const c = await cat(state, backing, ink, surface);
        const raw = await c.shot(AT[state]!, color);
        await c.close();
        writeFileSync(join(out, `${state}-${name}${backings.length > 1 ? `-${backing}` : ""}.png`), raw);
        const png = raw.toString("base64");
        cells.push(`<figure><img src="data:image/png;base64,${png}"><figcaption>${state} · ${name}${backings.length > 1 ? ` · base ${backing}` : ""}</figcaption></figure>`);
      }
    }
  }
  const cols = BACKS.length * backings.length;
  const sheet = await browser.newPage({ viewport: { width: 40 + cols * 168, height: 400 }, deviceScaleFactor: 1 });
  await sheet.setContent(`<style>body{margin:0;padding:20px;background:#ececee;font:12px -apple-system,sans-serif;color:#222}
    main{display:grid;grid-template-columns:repeat(${cols},160px);gap:10px 8px}figure{margin:0}img{width:160px;height:200px;display:block;border-radius:6px}</style>
    <main>${cells.join("")}</main>`);
  await sheet.screenshot({ path: join(out, "folha.png"), fullPage: true });
  await sheet.close();

  if (argv.includes("--video")) {
    // O branco ao lado do preto (e a cor), 4 s de cada estado a 30 quadros por segundo.
    const fps = 30, seconds = 4;
    for (const state of ["agindo", "acordou", "erro"]) {
      const dir = join(out, "frames", state); rmSync(dir, { recursive: true, force: true });
      for (const [name, color, ink, surface] of BACKS) {
        mkdirSync(join(dir, name), { recursive: true });
        const c = await cat(state, backings[0]!, ink, surface);
        for (let i = 0; i < seconds * fps; i++) writeFileSync(join(dir, name, `${String(i).padStart(4, "0")}.png`), await c.shot(i / fps, color));
        await c.close();
      }
      const ins = BACKS.flatMap(([name]) => ["-framerate", String(fps), "-i", join(dir, name, "%04d.png")]);
      const ff = Bun.spawnSync(["ffmpeg", "-y", "-loglevel", "error", ...ins, "-filter_complex", "[1][0][2]hstack=inputs=3[out]", "-map", "[out]",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart", join(out, `${state}.mp4`)]);
      assert.equal(ff.exitCode, 0, String(ff.stderr));
    }
  }
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ ok: true, ...report }));
} finally {
  await browser.close();
  server.close();
}
