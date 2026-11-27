// O andamento e o [Parar] (spec #32534, Cena 2, T33177): enquanto o agente trabalha, o balão do Kiwi diz o passo de
// agora ("Pensando", "Procurando nas suas notas", "Lendo uma nota", "Escrevendo a resposta"), com o [Parar], e em cima,
// pequeno e apagado, o que a pessoa falou. Nunca o nome nem o texto de uma nota. O [Parar] (e o × durante o pedido)
// cancela o pedido, no Hub e fora dele.
//
// O AppEngine headless de verdade com o agente falso (uma pergunta com "?": ele procura e lê pelas ferramentas do Kiwi,
// com `KIWI_FAKE_AGENT_TOOL_DELAY_MS` para cada passo ficar na tela) e a voz de mentira (`agentAsk`, sem mic):
//
// - o overlay: a página de verdade (dist/catoverlay) num WebKit headless, com os comandos que o app manda ao helper;
// - o Hub: o de verdade, no WebKit headless, com o mouse do Playwright no Kiwi (o balão no mouse, parte 1).
//
// Nada nativo na tela, nenhum agente de verdade, nenhum microfone. Tudo inventado. Sai a prancha `prancha.webp`.
//
//   bun scripts/bubble-progress-check.ts [pasta]
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, peekKiwi, type UiContext } from "./ui-page";
import { fakeRegistry } from "../src/agent/fake/registry";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T33177-andamento"));
mkdirSync(out, { recursive: true });

const PERGUNTA = "Como ficou a lista da feira?";
const OUVIU = `“${PERGUNTA}”`;
/** O que é da nota e nunca pode aparecer no andamento: o caminho, o nome e o texto. */
const DA_NOTA = /Casa|Feira\.md|banana|café/i;
const STEP_MS = 900;

const checks: string[] = [];
const shots: { file: string; caption: string; wide?: boolean }[] = [];
const browser = await webkit.launch({ headless: true });

const data = mkdtempSync(join(tmpdir(), "kiwi-andamento-"));
const registry = fakeRegistry([
  { name: "@agentclientprotocol/claude-agent-acp", version: "0.106.0", files: { "dist/index.js": "" } },
  { name: "zod", version: "4.6.7", files: { "index.js": "" } },
]);
const packages = join(data, "packages.json");
writeFileSync(packages, JSON.stringify(registry.pinned));
const env = {
  ...process.env, KIWI_FAKE_AGENT: "1", KIWI_FAKE_SPEECH: "1", KIWI_FAKE_AGENT_TOOL_DELAY_MS: String(STEP_MS),
  KIWI_ADAPTER_REGISTRY: registry.url, KIWI_ADAPTER_PACKAGES: packages,
};
async function cli(args: string[]) {
  const p = Bun.spawn([process.execPath, join(app, "scripts/cli.ts"), ...args, "--data", data], { cwd: app, stdout: "pipe", stderr: "pipe", env });
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
async function voiceAsk(text: string) {
  const r = await ctx.send({ cmd: "agentAsk", text });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.value as { id: string };
}

/** Os eventos do app: os comandos do overlay e os do agente. */
type Cmd = { type: string; estado?: string; text?: string | null; progress?: boolean; heard?: string; error?: boolean };
const log: { at: number; cmd?: Cmd; turn?: { type: string; id: string; stopReason?: string } }[] = [];
const t0 = performance.now();
const now = () => Math.round(performance.now() - t0);
async function waitFor(what: string, ok: () => boolean, ms = 30_000) {
  const end = Date.now() + ms;
  while (!ok()) {
    assert.ok(Date.now() < end, `${what}: ${JSON.stringify(log.slice(-12))}`);
    await Bun.sleep(20);
  }
}
const doneOf = (id: string) => log.find((l) => l.turn?.id === id && l.turn.type === "done")?.turn;

// ---------------------------------------------------------------------------------------------------------------- overlay
const page = join(app, "dist", "catoverlay");
const build = spawnSync("bun", ["x", "vite", "build"], { cwd: app, stdio: "ignore", env: { ...process.env, KIWI_UI_WINDOW: "catoverlay" } });
assert.ok(build.status === 0 && existsSync(join(page, "index.html")), "o build da página catoverlay");
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(r) {
    const file = Bun.file(join(page, new URL(r.url).pathname.replace(/^\/$/, "/index.html")));
    return (await file.exists()) ? new Response(file) : new Response("", { status: 404 });
  },
});

async function overlay() {
  const bctx = await browser.newContext({ viewport: { width: 420, height: 400 }, deviceScaleFactor: 2, colorScheme: "light", reducedMotion: "reduce" });
  const p = await bctx.newPage();
  const problems: string[] = [];
  p.on("pageerror", (e) => problems.push(String(e)));
  await p.goto(`http://127.0.0.1:${server.port}/index.html?escala=1.00&lado=right&balao=acima`);
  await p.addStyleTag({ content: "html{background:linear-gradient(135deg,#dfe6ee,#efe6f3)}" });
  await p.waitForFunction(() => (window as any).kiwiOverlayStats?.ready === true);
  // O que a página mostra a cada 40 ms: o texto, a linha de cima e se o [Parar] está à vista.
  await p.evaluate(() => {
    const w = window as any;
    w.amostras = [];
    const el = (id: string) => document.getElementById(id)!;
    setInterval(() => w.amostras.push({
      on: el("bubble").dataset.on === "true",
      text: el("bubble-text").textContent,
      heard: getComputedStyle(el("bubble-heard")).display !== "none" ? el("bubble-heard").textContent : null,
      stop: getComputedStyle(el("bubble-stop")).display !== "none",
    }), 40);
  });
  // O helper falso: aplica os comandos do app à página, como o CatOverlay.swift faz. O mouse no Kiwi (o `catHover`).
  const apply = async (c: Cmd) => {
    if (c.type === "catOverlay.show" || c.type === "catOverlay.state") await p.evaluate((e) => (window as any).kiwiOverlay.set({ estado: e, visible: true, catHover: true }), c.estado);
    else if (c.type === "catOverlay.hide") await p.evaluate(() => (window as any).kiwiOverlay.set({ visible: false, bubble: null }));
    else if (c.type === "catOverlay.bubble") await p.evaluate((b) => (window as any).kiwiOverlay.set({ bubble: b.text ? b : null }), c as any);
  };
  const queue: Cmd[] = [];
  const sub = await connect(data, (line: any) => {
    if ("id" in line || !line.event) return;
    if (line.event === "catOverlay.command") { log.push({ at: now(), cmd: line.payload }); queue.push(line.payload); }
    else if (line.event === "agent.turn") log.push({ at: now(), turn: line.payload });
  });
  assert.ok(sub);
  sub.write({ id: 0, cmd: "subscribe", topics: ["events"], follow: true, backlog: false });
  let pumping = true;
  const pump = (async () => {
    while (pumping) {
      const c = queue.shift();
      if (c) await apply(c); else await Bun.sleep(5);
    }
  })();
  const onPage = (t: string) => p.waitForFunction((s) => document.getElementById("bubble-text")!.textContent === s, t, { timeout: 30_000 });
  try {
    await invoke("settings.set", { kiwicat: { overlay: true, show: true } });
    await waitFor("o load", () => log.some((l) => l.cmd?.type === "catOverlay.load"));

    // 1. Um pedido por voz: o andamento troca a cada passo, com o que a pessoa falou em cima e o [Parar].
    const from = log.length;
    const { id } = await voiceAsk(PERGUNTA);
    await onPage("Procurando nas suas notas");
    await Bun.sleep(250);
    await p.screenshot({ path: join(out, "overlay-procurando.png") });
    shots.push({ file: "overlay-procurando.png", caption: "Overlay: procurando nas notas, com o que a pessoa falou em cima e o Parar" });
    await onPage("Lendo uma nota");
    await Bun.sleep(250);
    await p.screenshot({ path: join(out, "overlay-lendo.png") });
    shots.push({ file: "overlay-lendo.png", caption: "Overlay: lendo uma nota (a conta, nunca o nome)" });
    await waitFor("o done", () => !!doneOf(id));
    await waitFor("a resposta no balão", () => log.slice(from).some((l) => l.cmd?.type === "catOverlay.bubble" && !!l.cmd.text && !l.cmd.progress));
    await Bun.sleep(400);
    await p.screenshot({ path: join(out, "overlay-resposta.png") });
    shots.push({ file: "overlay-resposta.png", caption: "Overlay: a resposta toma o lugar; sem o Parar e sem a linha de cima" });

    const progress = log.slice(from).filter((l) => l.cmd?.type === "catOverlay.bubble" && l.cmd.progress).map((l) => l.cmd!);
    const steps = progress.map((c) => c.text);
    assert.ok(steps[0] === "Pensando" && steps.includes("Procurando nas suas notas") && steps.includes("Lendo uma nota"), JSON.stringify(steps));
    assert.ok(progress.every((c) => c.heard === OUVIU && c.error === false), JSON.stringify(progress));
    assert.ok(progress.every((c) => !DA_NOTA.test(c.text ?? "")), `o nome da nota no andamento: ${JSON.stringify(steps)}`);
    const amostras: { on: boolean; text: string; heard: string | null; stop: boolean }[] = await p.evaluate(() => (window as any).amostras);
    const andando = amostras.filter((a) => a.on && steps.includes(a.text));
    assert.ok(andando.length >= 10 && andando.every((a) => a.stop && a.heard === OUVIU), JSON.stringify(andando.slice(0, 5)));
    assert.ok(amostras.every((a) => !a.on || a.heard === null || a.heard === OUVIU));
    assert.ok(andando.every((a) => !DA_NOTA.test(a.text)), "o nome da nota na página durante o andamento");
    const fim = amostras.at(-1)!;
    assert.ok(fim.on && !fim.stop && fim.heard === null && !steps.includes(fim.text), JSON.stringify(fim));
    checks.push(`overlay: a voice request shows the steps ${JSON.stringify([...new Set(steps)])}, each with "${OUVIU}" on top and Stop, never the note's name; the answer takes the place, without Stop or the top line`);

    // 2. O [Parar] (o × durante o pedido): o pedido cancela, e o gato sai pela saída de cancelamento.
    const from2 = log.length;
    const second = await voiceAsk(PERGUNTA);
    await onPage("Procurando nas suas notas");
    await p.locator("#bubble-stop").waitFor({ state: "visible" });
    const r = await ctx.send({ cmd: "overlayClose" });
    assert.equal(r.ok, true, JSON.stringify(r));
    await waitFor("o done cancelado", () => !!doneOf(second.id));
    assert.equal(doneOf(second.id)!.stopReason, "cancelled");
    await waitFor("o gato sai", () => log.slice(from2).some((l) => l.cmd?.type === "catOverlay.hide"));
    const after = log.slice(log.findIndex((l) => l.turn?.id === second.id && l.turn.type === "done"));
    assert.ok(!after.some((l) => l.cmd?.type === "catOverlay.bubble" && l.cmd.text), "um balão depois do cancelamento");
    checks.push("overlay: Stop during the request cancels it (done cancelled), and the cat leaves without another bubble");

    pumping = false;
    await pump;
    sub.close();
    assert.deepEqual(problems, [], "overlay: erros na página");
  } finally {
    await bctx.close();
    await invoke("settings.set", { kiwicat: { overlay: false, show: true } }).catch(() => {});
  }
}

// -------------------------------------------------------------------------------------------------------------------- hub
const BUBBLE = ".kn-bubble-slot:not([data-phase='exit']) .kn-bubble";
async function hub(theme: "light" | "dark") {
  const tema = theme === "light" ? "claro" : "escuro";
  const w = await openWindow(browser, ctx, { window: "hub", scale: 2, theme, width: 1000, height: 700, motion: false, browser: "webkit", query: {} });
  const p = w.page;
  try {
    await p.waitForSelector('.kn-kiwicat[data-ready="true"]');
    await p.locator('[role="tab"][data-section="notes"]').click();
    await p.waitForFunction(() => !document.querySelector<HTMLElement>(".kn-hub")?.dataset.catAt);
    await peekKiwi(p);
    const textIs = (t: string) => p.waitForFunction(({ sel, t }) => document.querySelector(`${sel} .kn-bubble-typed`)?.textContent === t, { sel: BUBBLE, t }, { timeout: 30_000 });

    // 1. O andamento, com a fala em cima e o [Parar].
    const { id } = await voiceAsk(PERGUNTA);
    await textIs("Lendo uma nota");
    await Bun.sleep(300);
    assert.equal(await p.locator(`${BUBBLE} .kn-bubble-heard`).textContent(), OUVIU);
    assert.ok(await p.locator(`${BUBBLE} .kn-bubble-stop`).isVisible(), "hub: o Parar");
    const shown = (await p.locator(BUBBLE).textContent()) ?? "";
    assert.ok(!DA_NOTA.test(shown.replace(OUVIU, "")), `hub: o nome da nota no andamento: ${shown}`);
    const file = `hub-lendo-${theme}.png`;
    await p.screenshot({ path: join(out, file) });
    shots.push({ file, caption: `Hub (${tema}): lendo uma nota, com o que a pessoa falou em cima e o Parar`, wide: true });
    await waitFor("o done", () => !!doneOf(id));
    await p.waitForFunction((sel) => !document.querySelector(`${sel} .kn-bubble-stop`) && !!document.querySelector(`${sel} .kn-bubble-typed`)?.textContent?.startsWith("Pela nota"), BUBBLE, { timeout: 10_000 });
    assert.equal(await p.locator(`${BUBBLE} .kn-bubble-heard`).count(), 0, "hub: a linha de cima depois da resposta");

    // 2. O [Parar]: cancela o pedido, e o balão do andamento sai.
    const second = await voiceAsk(PERGUNTA);
    await textIs("Procurando nas suas notas");
    await p.locator(`${BUBBLE} .kn-bubble-stop`).click();
    await waitFor("o done cancelado", () => !!doneOf(second.id));
    assert.equal(doneOf(second.id)!.stopReason, "cancelled");
    await p.waitForSelector(BUBBLE, { state: "detached", timeout: 5_000 });
    assert.ok((w.report.invokes["agent.cancel"] ?? 0) >= 1, JSON.stringify(w.report.invokes));
    checks.push(`hub (${theme}): the step with "${OUVIU}" on top and Stop, never the note's name; the answer takes the place; Stop calls agent.cancel and the bubble leaves`);
    assert.deepEqual(w.report.problems, [], "hub: problemas na página");
  } finally {
    await w.close();
  }
}

try {
  await cli(["start", "--no-helper"]);
  // O registro dos eventos do agente, para o Hub também.
  const sub = await connect(data, (line: any) => {
    if (!("id" in line) && line.event === "agent.turn" && line.payload.type === "done") log.push({ at: now(), turn: line.payload });
  });
  assert.ok(sub);
  sub.write({ id: 0, cmd: "subscribe", topics: ["events"], follow: true, backlog: false });
  await invoke("agent.enable", { consent: true });
  await invoke("agent.download");
  await invoke("agent.configure", { onboarding: { state: "done" } });
  for (let n = 0; (await invoke("agent.status")).adapter.phase !== "ready"; n++) { assert.ok(n < 200); await Bun.sleep(100); }
  // "Mostrar o que eu falei" vem ligado para quem nunca mexeu (T33177).
  assert.equal((await invoke("agent.status")).showSpokenText, true, "o padrão do Mostrar o que eu falei");
  await invoke("notes.create", { folder: "Casa", title: "Feira", content: "# Feira\n\nBanana, pão e café para a semana da Ana.\n" });
  await overlay();
  for (const theme of ["light", "dark"] as const) await hub(theme);
  sub.close();

  // A prancha.
  const sheet = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 1500, height: 900 } });
  const img = (f: string) => `data:image/png;base64,${readFileSync(join(out, f)).toString("base64")}`;
  const fig = (x: (typeof shots)[number]) =>
    `<figure style="margin:0"><figcaption style="margin-bottom:6px;max-width:${x.wide ? 700 : 340}px">${x.caption}</figcaption><img src="${img(x.file)}" style="display:block;max-width:${x.wide ? 700 : 340}px;border-radius:8px;box-shadow:0 1px 4px #0003"></figure>`;
  const group = (wide: boolean) => `<div style="display:flex;flex-wrap:wrap;gap:20px;margin-bottom:24px">${shots.filter((s) => !!s.wide === wide).map(fig).join("")}</div>`;
  await sheet.setContent(
    `<body style="margin:0;padding:24px;background:#eceae4;font:600 15px -apple-system,sans-serif;color:#222">` +
      `<h1 style="margin:0 0 6px;font-size:24px">O andamento e o Parar (T33177, spec #32534, Cena 2)</h1>` +
      `<p style="margin:0 0 18px;font-weight:500">Enquanto o Kiwi trabalha: o passo de agora, o Parar, e em cima o que a pessoa falou. Nunca o nome de uma nota.</p>` +
      group(false) + group(true) + `</body>`,
  );
  await sheet.screenshot({ path: join(out, "prancha.png"), fullPage: true });
  await sheet.close();
  const webp = spawnSync("cwebp", ["-quiet", "-q", "80", join(out, "prancha.png"), "-o", join(out, "prancha.webp")]);
  if (webp.status !== 0) console.log("sem o cwebp: a prancha ficou em PNG");
  writeFileSync(join(out, "log.json"), JSON.stringify(log, null, 2));
  for (const c of checks) console.log(`ok  ${c}`);
  console.log(`a prancha em ${join(out, "prancha.webp")}`);
} finally {
  await browser.close();
  server.stop(true);
  await cli(["stop"]).catch(() => {});
  registry.stop();
  rmSync(data, { recursive: true, force: true });
}
