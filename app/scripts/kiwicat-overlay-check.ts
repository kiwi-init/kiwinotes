// O gato no overlay (spec #9810, T10830): o AppEngine headless de verdade, o agente falso e o helper falso (sem o
// helper, o headless manda os `catOverlay.*` como o evento `catOverlay.command`), com a página do overlay de verdade
// num WebKit headless. Não há hub, então é o caso "o Kiwi não está na frente". Nunca abre janela nativa nem chama o
// macOS. Prints, a folha e o vídeo na pasta do argumento.
//
//   bun scripts/kiwicat-overlay-check.ts [pasta]
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit } from "playwright-core";
import { connect, request } from "./cli";
import { fakeRegistry } from "../src/agent/fake/registry";
import { OVERLAY_TIMES } from "../src/bun/cat-overlay";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T10830-overlay"));
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-cat-overlay-"));
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
async function invoke(cap: string, args: unknown = {}) {
  const r = await request(data, { cmd: "invoke", cap, args });
  assert.ok(r && r.ok === true, JSON.stringify(r));
  return r.value as any;
}

// A página do overlay, construída como no app.
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

type Cmd = { type: string; estado?: string; fadeMs?: number };
const log: { at: number; cmd?: Cmd; where?: boolean; turn?: string }[] = [];
const t0 = performance.now();
const now = () => Math.round(performance.now() - t0);
const browser = await webkit.launch({ headless: true });
const report: { scope: string; checks: string[]; timings: Record<string, number> } = {
  scope: "WebKit headless overlay page, headless AppEngine, fake ACP agent and fake helper; no native window",
  checks: [],
  timings: {},
};
const commands = () => log.filter((l) => l.cmd).map((l) => l.cmd!);
async function waitFor(what: string, ok: () => boolean, ms = 20_000) {
  const end = Date.now() + ms;
  while (!ok()) {
    assert.ok(Date.now() < end, `${what}: ${JSON.stringify(log.slice(-8))}`);
    await Bun.sleep(20);
  }
}
const at = (pred: (c: Cmd) => boolean, from = 0) => log.findIndex((l, i) => i >= from && !!l.cmd && pred(l.cmd));

try {
  await cli(["start", "--no-helper"]);
  const videos = join(out, "video-tmp");
  const ctx = await browser.newContext({ viewport: { width: 420, height: 320 }, deviceScaleFactor: 2, recordVideo: { dir: videos, size: { width: 420, height: 320 } } });
  const p = await ctx.newPage();
  const problems: string[] = [];
  p.on("pageerror", (e) => problems.push(String(e)));
  await p.goto(`http://127.0.0.1:${server.port}/index.html`);
  // Atrás do gato, um "outro app" (só no vídeo): a página do overlay em si é transparente.
  await p.addStyleTag({ content: "html{background:linear-gradient(135deg,#25324a,#3d2d4f)} #root{margin:40px auto 0}" });
  await p.waitForFunction(() => (window as any).kiwiOverlayStats?.ready === true);

  // O helper falso: aplica os comandos do app à página, como o CatOverlay.swift faz.
  const apply = async (c: Cmd) => {
    if (c.type === "catOverlay.show") await p.evaluate((e) => (window as any).kiwiOverlay.set({ estado: e, visible: true }), c.estado);
    else if (c.type === "catOverlay.state") await p.evaluate((e) => (window as any).kiwiOverlay.set({ estado: e, visible: true }), c.estado);
    else if (c.type === "catOverlay.hide") await p.evaluate(() => (window as any).kiwiOverlay.set({ visible: false }));
  };
  const queue: Cmd[] = [];
  const sub = await connect(data, (line: any) => {
    if ("id" in line || !line.event) return;
    if (line.event === "catOverlay.command") { log.push({ at: now(), cmd: line.payload }); queue.push(line.payload); }
    else if (line.event === "kiwicat.where") log.push({ at: now(), where: line.payload.overlay });
    else if (line.event === "agent.turn") log.push({ at: now(), turn: line.payload.type === "status" ? `status:${line.payload.status}` : line.payload.type });
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

  await invoke("agent.enable", { consent: true });
  await invoke("agent.download");
  for (let n = 0; (await invoke("agent.status")).adapter.phase !== "ready"; n++) { assert.ok(n < 200); await Bun.sleep(100); }
  // Agente ligado e o interruptor do overlay ligado (o padrão): o helper carrega a página.
  await waitFor("o load", () => at((c) => c.type === "catOverlay.load") >= 0);
  report.checks.push("with the agent and the overlay switch on, the app tells the helper to load the page");

  // 1. Um pedido com ferramenta: entra no acordou em 180 ms, passa pelo agindo, e o pronto sai depois de 1100 ms em 160 ms.
  let from = log.length;
  await invoke("agent.ask", { text: "/antes-da-ferramenta" });
  await waitFor("o show", () => at((c) => c.type === "catOverlay.show", from) >= 0);
  const show = log[at((c) => c.type === "catOverlay.show", from)]!;
  assert.deepEqual(show.cmd, { type: "catOverlay.show", estado: "acordou", fadeMs: OVERLAY_TIMES.enter });
  assert.ok(log.slice(from).some((l) => l.where === true), "kiwicat.where {overlay: true}: o hub esconderia o gato do canto");
  await p.waitForFunction(() => (window as any).kiwiOverlayStats.visible === true && (window as any).kiwiOverlayStats.firstFrameMs !== null);
  report.timings.firstFrameMs = await p.evaluate(() => (window as any).kiwiOverlayStats.firstFrameMs);
  await p.screenshot({ path: join(out, "1-acordou.png") });
  await waitFor("o agindo", () => at((c) => c.estado === "agindo", from) >= 0);
  await Bun.sleep(150);
  await p.screenshot({ path: join(out, "2-agindo.png") });
  await waitFor("o pronto", () => at((c) => c.type === "catOverlay.state" && c.estado === "pronto", from) >= 0);
  await Bun.sleep(300);
  await p.screenshot({ path: join(out, "3-pronto.png") });
  await waitFor("a saída do pronto", () => at((c) => c.type === "catOverlay.hide", from) >= 0);
  const pronto = log[at((c) => c.estado === "pronto", from)]!;
  const hide = log[at((c) => c.type === "catOverlay.hide", from)]!;
  assert.equal(hide.cmd!.fadeMs, OVERLAY_TIMES.prontoExit);
  report.timings.prontoStayMs = hide.at - pronto.at;
  assert.ok(hide.at - pronto.at >= OVERLAY_TIMES.pronto - 20, `o pronto ficou ${hide.at - pronto.at} ms`);
  const states = commands().slice(commands().indexOf(show.cmd!)).filter((c) => c.estado).map((c) => c.estado);
  assert.deepEqual([...new Set(states)].filter((s) => ["acordou", "agindo", "pronto"].includes(s!)), ["acordou", "agindo", "pronto"]);
  await p.waitForFunction(() => (window as any).kiwiOverlayStats.visible === false);
  report.checks.push(`a request: enters on acordou in ${OVERLAY_TIMES.enter} ms, goes through agindo, pronto stays ${report.timings.prontoStayMs} ms and leaves in ${OVERLAY_TIMES.prontoExit} ms; the page pauses`);

  // 2. Um pedido novo durante a saída volta sem piscar: nenhum hide entre o pronto e o show seguinte.
  from = log.length;
  await invoke("agent.ask", { text: "/antes-da-ferramenta" });
  await waitFor("o pronto 2", () => at((c) => c.estado === "pronto", from) >= 0);
  const p2 = at((c) => c.estado === "pronto", from);
  await Bun.sleep(400);
  await invoke("agent.ask", { text: "/antes-da-ferramenta" });
  await waitFor("o show 3", () => at((c) => c.type === "catOverlay.show", p2) >= 0);
  assert.equal(at((c) => c.type === "catOverlay.hide", p2), -1, "nenhum hide entre o pronto e o pedido novo");
  await waitFor("o fim 3", () => at((c) => c.type === "catOverlay.hide", p2) >= 0, 30_000);
  report.checks.push("a new request during the exit comes back without a hide in between (no blink)");

  // 3. O erro fica 2200 ms e sai em 180 ms.
  from = log.length;
  await invoke("agent.ask", { text: "/limite" }).catch(() => {});
  await waitFor("o erro", () => at((c) => c.estado === "erro", from) >= 0);
  await Bun.sleep(300);
  await p.screenshot({ path: join(out, "4-erro.png") });
  await waitFor("a saída do erro", () => at((c) => c.type === "catOverlay.hide", from) >= 0);
  const erro = log[at((c) => c.estado === "erro", from)]!;
  const erroHide = log[at((c) => c.type === "catOverlay.hide", from)]!;
  assert.equal(erroHide.cmd!.fadeMs, OVERLAY_TIMES.erroExit);
  report.timings.erroStayMs = erroHide.at - erro.at;
  assert.ok(erroHide.at - erro.at >= OVERLAY_TIMES.erro - 20, `o erro ficou ${erroHide.at - erro.at} ms`);
  report.checks.push(`an error stays ${report.timings.erroStayMs} ms and leaves in ${OVERLAY_TIMES.erroExit} ms`);

  // 4. O cancelamento sai em 120 ms, sem pronto.
  from = log.length;
  await invoke("agent.ask", { text: `/conta ${"palavra ".repeat(80)}` });
  await waitFor("o show do cancelado", () => at((c) => c.type === "catOverlay.show", from) >= 0);
  await Bun.sleep(600);
  await invoke("agent.cancel");
  await waitFor("a saída do cancelado", () => at((c) => c.type === "catOverlay.hide", from) >= 0);
  assert.equal(log[at((c) => c.type === "catOverlay.hide", from)]!.cmd!.fadeMs, OVERLAY_TIMES.cancelExit);
  assert.equal(at((c) => c.estado === "pronto", from), -1, "o cancelado não passa pelo pronto");
  report.checks.push(`a cancel leaves in ${OVERLAY_TIMES.cancelExit} ms, without pronto`);

  // 5. O interruptor desligado: solta a página, e um pedido não mostra nada; ligado de novo, carrega.
  await Bun.sleep(300);
  from = log.length;
  await invoke("settings.set", { kiwicat: { overlay: false } });
  await waitFor("o unload", () => at((c) => c.type === "catOverlay.unload", from) >= 0);
  const off = log.length;
  await invoke("agent.ask", { text: "/antes-da-ferramenta" });
  await Bun.sleep(4000);
  assert.deepEqual(log.slice(off).filter((l) => l.cmd || l.where !== undefined), [], "com o interruptor desligado, nada");
  await invoke("settings.set", { kiwicat: { overlay: true } });
  await waitFor("o load de novo", () => at((c) => c.type === "catOverlay.load", off) >= 0);
  report.checks.push("the switch off unloads the page and a request shows nothing; on again, it loads");

  pumping = false;
  await pump;
  sub.close();
  await ctx.close();
  assert.deepEqual(problems, []);
  const v = readdirSync(videos).find((f) => f.endsWith(".webm"));
  if (v) renameSync(join(videos, v), join(out, "overlay.webm"));
  rmSync(videos, { recursive: true, force: true });
  writeFileSync(join(out, "log.json"), JSON.stringify(log, null, 2));
  console.log(JSON.stringify({ ok: true, ...report }, null, 2));
} finally {
  await browser.close().catch(() => {});
  server.stop(true);
  await cli(["stop"]).catch(() => {});
  registry.stop();
  rmSync(data, { recursive: true, force: true });
}
