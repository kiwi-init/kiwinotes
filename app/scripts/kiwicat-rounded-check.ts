// T11565 (spec #9573): a queda arredondada da luz do gato recortado, provada no WebKit headless (WebGPU) com o desenho
// de hoje (os símbolos novos, o gato preto e a névoa laranja do Claude Code).
//
// 1. Por camada, nos 8 estados, no mesmo instante e semente: a queda arredondada contra a faixa reta de antes, em
//    RGBA (premultiplicado). A luz nunca sobe (no máximo 1 em 255, o arredondamento do PNG); dentro da elipse
//    (r < 0,82) nada muda; o modo com fundo segue idêntico; os símbolos (a camada vetorial) são os mesmos.
// 2. A folha: `agindo`, `acordou` e `erro`, antes e agora, no branco, no preto e na cor.
// 3. Os vídeos de `agindo`, `acordou` e `erro` nos três fundos, quadro a quadro (o relógio controlado, sem medir CPU).
//
// Pegue `kiwi lock bench` antes. Uso: bun scripts/kiwicat-rounded-check.ts <saída>
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { webkit, type Browser } from "playwright-core";
import { serveFogDemo } from "./kiwicat-demo";

const out = resolve(process.argv[2] ?? "/tmp/kiwi-T11565");
mkdirSync(out, { recursive: true });
const W = 640, H = 800, SEED = 17;
const STATES = ["repouso", "dormindo", "acordou", "ouvindo", "thinking", "agindo", "pronto", "erro"] as const;
/** O instante de cada estado (s): a luz já entrou e o gesto está no meio. */
const AT: Record<string, number> = { repouso: 2, dormindo: 2, acordou: 0.53, ouvindo: 1.2, thinking: 1.6, agindo: 1.2, pronto: 0.6, erro: 0.85 };
/** Os fundos, e a tinta dos símbolos de cada um (como no app: escura no tema claro, branca no escuro, #428). */
const BACKGROUNDS = [["branco", "#ffffff", "light"], ["preto", "#000000", "dark"], ["cor", "#367a8e", "dark"]] as const;
const server = await serveFogDemo("cat-demo.ts");
const browser: Browser = await webkit.launch({ headless: true });

/** Uma página do demo com o gato no estado, sem fundo; `capture(t)` desenha o instante. */
async function cat(shape: "rounded" | "band", state: string, cutout = true, ink: "dark" | "light" = "dark", backend: "webgpu" | "webgl2" = "webgpu") {
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await context.route("**/*", (r) => (new URL(r.request().url()).origin === server.url ? r.continue() : r.abort()));
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${server.url}/?state=repouso&cutout=${cutout ? 1 : 0}&outline=1&backing=.5&edgeBand=.08&edgeShape=${shape}&color=claude&seed=${SEED}&width=${W}&height=${H}&symbolTheme=${ink}${backend === "webgl2" ? "&backend=webgl2" : ""}`);
  await page.waitForFunction(() => (window as any).kiwiCatReady);
  await page.evaluate((state) => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    (window as any).kiwiCat.update({ estado: state, voz: state === "ouvindo" ? 0.8 : null });
  }, state);
  const shot = async (t: number) => {
    const used = await page.evaluate((t) => { const a = (window as any).kiwiCat; a.capture(t); return a.fogStats.backend; }, t);
    assert.equal(used, backend);
    return page.screenshot({ omitBackground: true });
  };
  const symbols = () => page.evaluate(() => document.querySelector(".kn-cat-symbols")?.innerHTML ?? "");
  return { page, shot, symbols, errors, close: () => context.close() };
}

/** Compara dois PNGs RGBA no navegador: o quanto a luz subiu, e o quanto mudou dentro da elipse. */
async function compare(a: Buffer, b: Buffer) {
  const page = await browser.newPage();
  const r = await page.evaluate(async ([a, b]) => {
    const read = async (src: string) => {
      const img = new Image(); img.src = `data:image/png;base64,${src}`; await img.decode();
      const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
      const g = c.getContext("2d", { colorSpace: "srgb" })!; g.drawImage(img, 0, 0);
      return g.getImageData(0, 0, c.width, c.height, { colorSpace: "srgb" }).data;
    };
    const [before, now] = [await read(a), await read(b)];
    const w = 640, h = 800;
    let up = 0, inside = 0, down = 0, changed = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const qx = ((x + 0.5) / w - 0.5) * 2, qy = ((y + 0.5) / h - 0.5) * 2, r = Math.hypot(qx, qy);
      for (let c = 0; c < 4; c++) {
        // Premultiplicado: a luz que sai, independente de como o PNG separa a cor da opacidade.
        const p0 = c < 3 ? (before[i + c]! * before[i + 3]!) / 255 : before[i + 3]!;
        const p1 = c < 3 ? (now[i + c]! * now[i + 3]!) / 255 : now[i + 3]!;
        up = Math.max(up, p1 - p0); down = Math.max(down, p0 - p1);
        if (r < 0.82) inside = Math.max(inside, Math.abs(p1 - p0));
        if (Math.abs(p1 - p0) > 1) changed++;
      }
    }
    return { up, inside, down, changed };
  }, [a.toString("base64"), b.toString("base64")] as const);
  await page.close();
  return r;
}

const report: { checks: string[]; layers: Record<string, unknown>; videos: string[] } = { checks: [], layers: {}, videos: [] };
try {
  // 1. Por camada, nos 8 estados.
  for (const state of STATES) {
    const before = await cat("band", state), now = await cat("rounded", state);
    const [a, b] = [await before.shot(AT[state]!), await now.shot(AT[state]!)];
    const diff = await compare(a, b);
    assert.ok(diff.up <= 1, `${state}: the light went up by ${diff.up}/255`);
    assert.ok(diff.inside <= 1, `${state}: changed inside the ellipse by ${diff.inside}/255`);
    assert.equal(await now.symbols(), await before.symbols(), `${state}: the symbols layer changed`);
    assert.deepEqual([...before.errors, ...now.errors], []);
    await before.close(); await now.close();
    const opaqueBefore = await cat("band", state, false), opaqueNow = await cat("rounded", state, false);
    const opaque = await compare(await opaqueBefore.shot(AT[state]!), await opaqueNow.shot(AT[state]!));
    assert.equal(Math.max(opaque.up, opaque.down), 0, `${state}: the opaque mode changed`);
    await opaqueBefore.close(); await opaqueNow.close();
    report.layers[state] = { at: AT[state], maxUp: diff.up, maxInsideChange: diff.inside, maxDarker: Math.round(diff.down), channelsChanged: diff.changed, opaqueMaxChange: 0 };
    console.error(state, JSON.stringify(report.layers[state]));
  }
  // O mesmo no WebGL2 (o caminho sem WebGPU), nos estados de luz forte.
  for (const state of ["agindo", "acordou", "erro"]) {
    const before = await cat("band", state, true, "dark", "webgl2"), now = await cat("rounded", state, true, "dark", "webgl2");
    const diff = await compare(await before.shot(AT[state]!), await now.shot(AT[state]!));
    assert.ok(diff.up <= 1 && diff.inside <= 1 && diff.down > 10, `${state} webgl2: ${JSON.stringify(diff)}`);
    report.layers[`${state}-webgl2`] = { maxUp: diff.up, maxInsideChange: diff.inside, maxDarker: Math.round(diff.down) };
    await before.close(); await now.close();
  }
  report.checks.push("8 states: the light never goes up (≤1/255), nothing changes inside the ellipse (≤1/255), the symbols layer and the opaque mode are identical; the same in WebGL2 for agindo, acordou and erro");

  // 2. A folha: antes (a faixa reta) e agora (a elipse), nos três fundos.
  const cells: string[] = [];
  for (const shape of ["band", "rounded"] as const) {
    for (const state of ["agindo", "acordou", "erro"]) {
      for (const [name, color, symbols] of BACKGROUNDS) {
        const c = await cat(shape, state, true, symbols);
        const png = (await c.shot(AT[state]!)).toString("base64");
        cells.push(`<figure><div style="background:${color}"><img src="data:image/png;base64,${png}"></div><figcaption>${shape === "band" ? "antes" : "agora"} · ${state} · ${name}</figcaption></figure>`);
        await c.close();
      }
    }
  }
  const sheet = await browser.newPage({ viewport: { width: 1780, height: 600 }, deviceScaleFactor: 1 });
  await sheet.setContent(`<style>body{margin:0;padding:20px;background:#ececee;font:13px -apple-system,sans-serif;color:#222}
    h1{font-size:17px;margin:0 0 4px}p{margin:0 0 14px;color:#555}main{display:grid;grid-template-columns:repeat(9,184px);gap:10px 8px}
    figure{margin:0}div{width:184px;height:230px;border-radius:6px;overflow:hidden}img{width:184px;height:230px;display:block}
    figcaption{margin-top:3px}</style>
    <h1>A queda da luz: a faixa reta de antes (em cima) e a elipse de agora (embaixo)</h1>
    <p>Spec #9573 · o gato preto, os símbolos de hoje e a névoa laranja do Claude Code · o mesmo instante e semente ${SEED} · WebKit headless (WebGPU)</p>
    <main>${cells.join("")}</main>`);
  await sheet.screenshot({ path: join(out, "folha.png"), fullPage: true });
  await sheet.close();
  report.checks.push("the sheet: agindo, acordou and erro, before and now, on white, black and colour");

  // 3. Os vídeos: 4 s de cada estado, a 30 quadros por segundo, nos três fundos lado a lado.
  const fps = 30, seconds = 4;
  for (const state of ["agindo", "acordou", "erro"]) {
    const dir = join(out, "frames", state);
    rmSync(dir, { recursive: true, force: true });
    for (const symbols of ["dark", "light"] as const) {
      mkdirSync(join(dir, symbols), { recursive: true });
      const c = await cat("rounded", state, true, symbols);
      for (let i = 0; i < seconds * fps; i++) writeFileSync(join(dir, symbols, `${String(i).padStart(4, "0")}.png`), await c.shot(i / fps));
      await c.close();
    }
    const video = join(out, `${state}.mp4`);
    const inputs = BACKGROUNDS.flatMap(([, color]) => ["-f", "lavfi", "-i", `color=c=${color.replace("#", "0x")}:s=${W}x${H}:r=${fps}`]);
    // Entradas 3 e 4: os quadros com os símbolos brancos e com os escuros; o branco leva os escuros.
    const filter = "[3]split=2[d1][d2];" + `[0][4]overlay=shortest=1[v0];[1][d1]overlay=shortest=1[v1];[2][d2]overlay=shortest=1[v2]` + ";[v0][v1][v2]hstack=inputs=3[out]";
    const ff = Bun.spawnSync(["ffmpeg", "-y", "-loglevel", "error", ...inputs, "-framerate", String(fps), "-i", join(dir, "dark", "%04d.png"), "-framerate", String(fps), "-i", join(dir, "light", "%04d.png"),
      "-filter_complex", filter, "-map", "[out]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-movflags", "+faststart", video]);
    assert.equal(ff.exitCode, 0, String(ff.stderr));
    report.videos.push(video);
  }
  report.checks.push("the videos: agindo, acordou and erro, 4 s at 30 fps each, on white, black and colour side by side");
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ ok: true, ...report }, null, 1));
} finally {
  await browser.close();
  server.close();
}
