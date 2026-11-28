// T16754 (harry #16753, #16772, #16778, #16786): o balão do KiwiCat aponta para o gato em todas as posições. O rabo sai
// da quina do balão mais perto do gato, e a ponta encosta no corpo dele. Nunca abre janela:
//
// - o hub de verdade, no headless com o agente falso: no canto (as Notas) e no meio da Início, com a janela pequena
//   (640 × 480), a de sempre (1000 × 740) e grande (1440 × 900), o balão de pedido (o campo de falar) e o da resposta;
// - a página do overlay de verdade (dist/catoverlay), com o que o helper manda: as 6 posições de Ajustes (spec #12949)
//   em 0,6×, 1× e 1,6×, o balão da resposta e o mesmo balão com a pergunta da conversa contínua (spec #13380).
//
// Em cada caso: a quina do rabo é a do lado do gato, a ponta fica a até 2 px da quina do corpo dele (`CAT_BODY`), o
// balão fica dentro da janela, e o script diz a distância da ponta ao centro do gato. No hub, confere também que o
// `CAT_BODY` bate com o gato desenhado. Sai a prancha `prancha.webp` com cada posição.
//
//   bun scripts/bubble-tail-check.ts [pasta]
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Page } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";
import { fakeRegistry } from "../src/agent/fake/registry";
import { CAT_BODY, type TailSide } from "../ui/kiwicat-v2/bubbleTail";
import { overlayPlacement } from "../ui/catoverlay/placement";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T16754-rabo"));
mkdirSync(out, { recursive: true });

// ---- A medida: a ponta do rabo, a quina do corpo e o lado. ----
type Rect = { x: number; y: number; w: number; h: number };
type Measure = { side: TailSide; tail: Rect; shell: Rect; cat: Rect; vw: number; vh: number };
/** A ponta do traço no SVG de 34 × 24 é (28,5; 19,5); virado, o SVG espelha em volta do meio. */
function tipOf(side: TailSide, t: Rect) {
  return { x: t.x + (side.endsWith("right") ? 28.5 : 34 - 28.5), y: t.y + (side.startsWith("bottom") ? 19.5 : 24 - 19.5) };
}
const bodyOf = (c: Rect) => ({ x0: c.x + c.w * CAT_BODY.x0, x1: c.x + c.w * CAT_BODY.x1, y0: c.y + c.h * CAT_BODY.y0, y1: c.y + c.h * CAT_BODY.y1 });
const results: { what: string; side: TailSide; gap: number; center: number }[] = [];
function checkTip(m: Measure, what: string) {
  const tip = tipOf(m.side, m.tail);
  const b = bodyOf(m.cat);
  // A quina do balão do lado do gato: o balão à esquerda do corpo tem o rabo à direita; em cima dele, embaixo.
  const shellMid = { x: m.shell.x + m.shell.w / 2, y: m.shell.y + m.shell.h / 2 };
  const want: TailSide = `${shellMid.y < (b.y0 + b.y1) / 2 ? "bottom" : "top"}-${shellMid.x < (b.x0 + b.x1) / 2 ? "right" : "left"}`;
  assert.equal(m.side, want, `${what}: o rabo na quina do lado do gato`);
  // A ponta na quina do corpo que dá para o balão: a orelha (em cima) ou o pé (embaixo).
  const corner = { x: m.side.endsWith("right") ? b.x0 : b.x1, y: m.side.startsWith("bottom") ? b.y0 : b.y1 };
  const gap = Math.hypot(tip.x - corner.x, tip.y - corner.y);
  assert.ok(gap <= 2, `${what}: a ponta longe do corpo, ${gap.toFixed(1)} px (ponta ${tip.x.toFixed(1)},${tip.y.toFixed(1)}; corpo ${JSON.stringify(b)})`);
  const center = Math.hypot(tip.x - (b.x0 + b.x1) / 2, tip.y - (b.y0 + b.y1) / 2);
  // A casca e o rabo dentro da janela.
  const inside = (r: Rect) => r.x >= -0.5 && r.y >= -0.5 && r.x + r.w <= m.vw + 0.5 && r.y + r.h <= m.vh + 0.5;
  assert.ok(inside(m.shell) && inside(m.tail), `${what}: o balão sai da janela ${JSON.stringify({ shell: m.shell, tail: m.tail, vw: m.vw, vh: m.vh })}`);
  results.push({ what, side: m.side, gap, center });
}
const measureIn = (p: Page, shellSel: string, catSel: string) =>
  p.evaluate(([shellSel, catSel]) => {
    const r = (e: Element) => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
    const shell = document.querySelector(shellSel)!;
    const tail = shell.querySelector(".kn-bubble-tail")!;
    return { side: tail.getAttribute("data-side"), tail: r(tail), shell: r(shell), cat: r(document.querySelector(catSel)!), vw: innerWidth, vh: innerHeight };
  }, [shellSel, catSel] as const) as Promise<Measure>;

// ---- Os prints da prancha. ----
const shots: { file: string; caption: string; w: number; h: number; desk?: boolean }[] = [];
/** Um recorte em volta do gato e do balão, com folga. */
async function clipShot(p: Page, m: Measure, file: string, caption: string) {
  const pad = 20;
  const x0 = Math.max(0, Math.min(m.shell.x, m.cat.x) - pad), y0 = Math.max(0, Math.min(m.shell.y, m.cat.y) - pad);
  const x1 = Math.min(m.vw, Math.max(m.shell.x + m.shell.w, m.cat.x + m.cat.w) + pad), y1 = Math.min(m.vh, Math.max(m.shell.y + m.shell.h, m.cat.y + m.cat.h) + pad);
  await p.screenshot({ path: join(out, file), clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } });
  shots.push({ file, caption, w: x1 - x0, h: y1 - y0 });
}

// ---- O hub, com o headless e o agente falso. ----
const data = mkdtempSync(join(tmpdir(), "kiwi-rabo-"));
const registry = fakeRegistry([
  { name: "@agentclientprotocol/claude-agent-acp", version: "0.106.0", files: { "dist/index.js": "" } },
  { name: "zod", version: "4.6.7", files: { "index.js": "" } },
]);
const packages = join(data, "packages.json");
writeFileSync(packages, JSON.stringify(registry.pinned));
async function cli(args: string[]) {
  const p = Bun.spawn([process.execPath, join(app, "scripts/cli.ts"), ...args, "--data", data], {
    cwd: app, stdout: "pipe", stderr: "pipe", env: { ...process.env, KIWI_FAKE_AGENT: "1", KIWI_ADAPTER_REGISTRY: registry.url, KIWI_ADAPTER_PACKAGES: packages },
  });
  const text = await new Response(p.stdout).text();
  const err = await new Response(p.stderr).text();
  assert.equal(await p.exited, 0, text + err);
  return text;
}
const ctx: UiContext = {
  data,
  send: async (msg) => { const r = await request(data, msg); assert.ok(r); return r; },
  subscribe: async (topics, onMsg) => {
    const c = await connect(data, (line) => { if (!("id" in line)) onMsg(line); });
    assert.ok(c);
    c.write({ id: 0, cmd: "subscribe", topics, follow: true, backlog: false });
    return () => c.close();
  },
};
async function invoke(cap: string, args: unknown = {}) {
  const r = await ctx.send({ cmd: "invoke", cap, args });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.value as any;
}
const settle = (p: Page) =>
  p.evaluate(() => Promise.all([...document.querySelectorAll(".kn-bubble-slot")].flatMap((s) => s.getAnimations({ subtree: true }).map((a) => a.finished))));

/** O gato desenhado bate com o `CAT_BODY`: o recorte do quadro, e a caixa do que não é o fundo (o canto do recorte). */
async function drawnBody(p: Page) {
  const cat = (await p.locator(".kn-kiwicat").boundingBox())!;
  const png = await p.screenshot({ clip: cat });
  const box = await p.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const bg = [d[0]!, d[1]!, d[2]!];
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      if (Math.max(Math.abs(d[i]! - bg[0]), Math.abs(d[i + 1]! - bg[1]), Math.abs(d[i + 2]! - bg[2])) > 80) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    }
    return { x0: x0 / c.width, x1: (x1 + 1) / c.width, y0: y0 / c.height, y1: (y1 + 1) / c.height };
  }, `data:image/png;base64,${png.toString("base64")}`);
  for (const k of ["x0", "x1", "y0", "y1"] as const) {
    // 4 % do quadro: 4 px no hub (a respiração do gato e a borda suave).
    assert.ok(Math.abs(box[k] - CAT_BODY[k]) <= 0.04, `o CAT_BODY não bate com o gato desenhado: ${k} ${box[k].toFixed(3)} × ${CAT_BODY[k]} (${JSON.stringify(box)})`);
  }
  return box;
}

const browser = await webkit.launch({ headless: true });
const checks: string[] = [];
let server: ReturnType<typeof Bun.serve> | undefined;
try {
  await cli(["start", "--no-helper"]);
  await invoke("notes.create", { folder: "Pessoal", title: "Ideias", content: "# Ideias\n\nUma lista de livros para as férias.\n" });
  await invoke("agent.enable", { consent: true });
  await invoke("agent.download");
  await invoke("agent.configure", { onboarding: { state: "done" } });
  await invoke("settings.set", { kiwicat: { overlay: false, show: true } });
  for (let n = 0; (await invoke("agent.status")).adapter.phase !== "ready"; n++) { assert.ok(n < 200); await Bun.sleep(100); }

  const sizes = [
    { name: "pequena", width: 640, height: 480 },
    { name: "média", width: 1000, height: 740 },
    { name: "grande", width: 1440, height: 900 },
  ];
  for (const size of sizes) {
    const w = await openWindow(browser, ctx, { window: "hub", scale: 2, theme: "light", width: size.width, height: size.height, motion: false, browser: "webkit", query: {} });
    const p = w.page;
    try {
      await p.waitForSelector('.kn-kiwicat[data-ready="true"]');
      if (size.name === "média") {
        await p.locator('[role="tab"][data-section="notes"]').click();
        await p.waitForFunction(() => !document.querySelector<HTMLElement>(".kn-hub")?.dataset.catAt);
        const b = await drawnBody(p);
        checks.push(`o CAT_BODY bate com o gato desenhado no hub (x ${b.x0.toFixed(2)}–${b.x1.toFixed(2)}, y ${b.y0.toFixed(2)}–${b.y1.toFixed(2)})`);
      }
      for (const where of ["home", "notes"] as const) {
        const lugar = where === "home" ? "Início" : "canto";
        await p.locator(`[role="tab"][data-section="${where}"]`).click();
        if (where === "home") await p.waitForFunction(() => document.querySelector<HTMLElement>(".kn-hub")?.dataset.catAt === "home");
        else await p.waitForFunction(() => !document.querySelector<HTMLElement>(".kn-hub")?.dataset.catAt);
        // O pedido: o campo de falar.
        await p.locator(".kn-kiwicat-hit").click();
        await p.waitForSelector(".kn-cat-ask");
        await settle(p);
        let m = await measureIn(p, ".kn-cat-ask", ".kn-kiwicat");
        let what = `hub ${size.name} (${size.width}×${size.height}), ${lugar}, pedido`;
        checkTip(m, what);
        await clipShot(p, m, `hub-${size.width}-${where}-pedido.png`, `Hub ${size.width}×${size.height}, ${lugar}: o pedido`);
        await p.keyboard.press("Escape");
        await p.waitForSelector(".kn-cat-ask", { state: "detached" });
        // A resposta.
        await invoke("agent.ask", { text: "oi" });
        await p.waitForSelector(".kn-bubble-slot:not([data-phase='exit']) .kn-bubble");
        await p.waitForFunction(() => document.querySelector<HTMLElement>('.kn-kiwicat')?.dataset.state !== "agindo");
        // O texto termina de "digitar" antes do print.
        for (let last = "", n = 0; ; n++) {
          const now = await p.locator(".kn-bubble-slot:not([data-phase='exit']) .kn-bubble").innerText();
          if (now === last && now.length > 0) break;
          assert.ok(n < 60, "a resposta não parou de digitar");
          last = now;
          await Bun.sleep(150);
        }
        await settle(p);
        m = await measureIn(p, ".kn-bubble-slot:not([data-phase='exit']) .kn-bubble", ".kn-kiwicat");
        what = `hub ${size.name} (${size.width}×${size.height}), ${lugar}, resposta`;
        checkTip(m, what);
        await clipShot(p, m, `hub-${size.width}-${where}-resposta.png`, `Hub ${size.width}×${size.height}, ${lugar}: a resposta`);
        // O clique no balão não fecha mais; quem fecha é o × (spec #32534, Cena 3).
        await p.locator(".kn-bubble-slot:not([data-phase='exit']) .kn-bubble-close").click();
        await p.waitForSelector(".kn-bubble-slot .kn-bubble", { state: "detached" });
      }
      assert.deepEqual(w.report.problems, [], "problemas na página");
    } finally {
      await w.close();
    }
  }
  checks.push("hub: o pedido e a resposta, no canto e na Início, nas janelas de 640×480, 1000×740 e 1440×900");

  // ---- O overlay: a página de verdade, como o helper a abre. ----
  const page = join(app, "dist", "catoverlay");
  const build = spawnSync("bun", ["x", "vite", "build"], { cwd: app, stdio: "ignore", env: { ...process.env, KIWI_UI_WINDOW: "catoverlay" } });
  assert.ok(build.status === 0 && existsSync(join(page, "index.html")), "o build da página catoverlay");
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(r) {
      const file = Bun.file(join(page, new URL(r.url).pathname.replace(/^\/$/, "/index.html")));
      return (await file.exists()) ? new Response(file) : new Response("", { status: 404 });
    },
  });
  const positions = [
    ["centro", "center", "acima"],
    ["embaixo no centro", "center", "acima"],
    ["embaixo à direita", "right", "acima"],
    ["embaixo à esquerda", "left", "acima"],
    ["em cima à direita", "right", "abaixo"],
    ["em cima à esquerda", "left", "abaixo"],
  ] as const;
  for (const [name, lado, balao] of positions.filter((_, i) => i !== 1)) {
    for (const escala of ["0.60", "1.00", "1.60"]) {
      const q = `escala=${escala}&lado=${lado}&balao=${balao}`;
      const place = overlayPlacement(new URLSearchParams(q));
      const sala = 112;
      const c = await browser.newContext({ viewport: { width: place.winW, height: place.catH + sala }, deviceScaleFactor: 2 });
      await c.addInitScript(() => { (window as any).webkit = { messageHandlers: { kiwiCat: { postMessage: () => {} } } }; });
      const p = await c.newPage();
      await p.goto(`http://127.0.0.1:${server.port}/index.html?backend=none&${q}`);
      await p.waitForFunction(() => (window as any).kiwiCatReady === true, undefined, { timeout: 20_000 });
      for (const [kind, ask] of [["resposta", false], ["pergunta", true]] as const) {
        await p.evaluate(([ask]) => (window as any).kiwiOverlay.set({ estado: "pronto", visible: true, bubbleHover: true, sala: 112, bubble: { text: "Pronto: mudei o prazo para abril.", error: false, ask } }), [ask] as const);
        await Bun.sleep(220); // a transição de 140 ms do balão
        const m = await measureIn(p, "#bubble", "#cat");
        const what = `overlay ${name} ${escala}×, ${kind}`;
        checkTip(m, what);
        if (escala === "1.00" || kind === "resposta") {
          if (escala === "1.00") {
            await p.screenshot({ path: join(out, `overlay-${lado}-${balao}-${kind}.png`), omitBackground: true });
            shots.push({ file: `overlay-${lado}-${balao}-${kind}.png`, caption: `Overlay ${name}, 1×: ${kind === "resposta" ? "a resposta" : "com a pergunta"}`, w: place.winW, h: place.catH + sala, desk: true });
          }
        }
      }
      await c.close();
    }
  }
  checks.push("overlay: a resposta e a pergunta, nas posições de Ajustes (o centro e os 4 cantos; embaixo no centro é a mesma página do centro) em 0,6×, 1× e 1,6×");

  // ---- A prancha. ----
  const sheet = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 1600, height: 900 } });
  const img = (f: string) => `data:image/png;base64,${readFileSync(join(out, f)).toString("base64")}`;
  const figure = (x: (typeof shots)[number]) =>
    `<figure style="margin:0"><figcaption style="margin-bottom:6px">${x.caption}</figcaption>` +
    `<div style="border-radius:10px;padding:${x.desk ? 12 : 0}px;background:${x.desk ? "linear-gradient(160deg,#9fb4c9,#c9b9a6)" : "none"};box-shadow:0 1px 4px #0003;overflow:hidden;width:max-content">` +
    `<img src="${img(x.file)}" style="display:block;width:${Math.min(x.w, 340)}px"></div></figure>`;
  await sheet.setContent(
    `<body style="margin:0;padding:24px;background:#eceae4;font:600 15px -apple-system,sans-serif;color:#222">` +
      `<h1 style="margin:0 0 6px;font-size:24px">O rabo do balão na quina mais perto do gato (T16754)</h1>` +
      `<p style="margin:0 0 18px;font-weight:500">A ponta encosta no corpo do gato em cada posição: o hub (o canto e a Início, em três tamanhos de janela) e o overlay (as posições de Ajustes).</p>` +
      `<h2 style="margin:4px 0 10px;font-size:18px">O hub</h2><div style="display:grid;grid-template-columns:repeat(4,max-content);gap:20px;align-items:start">${shots.filter((x) => !x.desk).map(figure).join("")}</div>` +
      `<h2 style="margin:24px 0 10px;font-size:18px">O overlay (1×)</h2><div style="display:grid;grid-template-columns:repeat(4,max-content);gap:20px;align-items:start">${shots.filter((x) => x.desk).map(figure).join("")}</div></body>`,
  );
  await sheet.screenshot({ path: join(out, "prancha.png"), fullPage: true });
  await sheet.close();
  const webp = spawnSync("cwebp", ["-quiet", "-q", "82", join(out, "prancha.png"), "-o", join(out, "prancha.webp")]);
  if (webp.status !== 0) console.log("sem o cwebp: a prancha ficou em PNG");

  for (const r of results) console.log(`${r.what}: ${r.side}, a ponta a ${r.gap.toFixed(1)} px da quina do corpo e ${r.center.toFixed(0)} px do centro do gato`);
  for (const c of checks) console.log(`ok  ${c}`);
  console.log(`${results.length} casos; a prancha em ${join(out, "prancha.webp")}`);
} finally {
  server?.stop(true);
  await browser.close();
  await cli(["stop"]).catch(() => {});
  registry.stop(); // o registro falso é um Bun.serve: aberto, o processo não sai
}
