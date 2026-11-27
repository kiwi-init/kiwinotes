// A voz do gato (T26829): o gato do overlay no `falando`, com a boca pelo nível do que tocou, e a volta ao estado de
// antes quando a voz para. O AppEngine headless de verdade com o agente falso (que chama o `kiwi falar` num pedido por
// voz) e a voz de mentira (`KIWI_FAKE_SPEECH=1`: um tom com sílabas, nada no alto-falante, nada do mic), e a página do
// overlay de verdade num WebKit headless. Nunca abre janela nativa nem chama o macOS. Prints, o vídeo e o log na pasta
// do argumento.
//
//   bun scripts/kiwicat-speech-check.ts [pasta]
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit } from "playwright-core";
import { connect, request } from "./cli";
import { fakeRegistry } from "../src/agent/fake/registry";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T26829-fala"));
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-cat-fala-"));
const registry = fakeRegistry([
  { name: "@agentclientprotocol/claude-agent-acp", version: "0.106.0", files: { "dist/index.js": "" } },
  { name: "zod", version: "4.6.7", files: { "index.js": "" } },
]);
const packages = join(data, "packages.json");
writeFileSync(packages, JSON.stringify(registry.pinned));
const env = { ...process.env, KIWI_FAKE_AGENT: "1", KIWI_FAKE_SPEECH: "1", KIWI_ADAPTER_REGISTRY: registry.url, KIWI_ADAPTER_PACKAGES: packages };
async function cli(args: string[]) {
  const p = Bun.spawn([process.execPath, join(app, "scripts/cli.ts"), ...args, "--data", data], { cwd: app, stdout: "pipe", stderr: "pipe", env });
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

type Cmd = { type: string; estado?: string; nivel?: number | null; text?: string | null };
const log: { at: number; cmd?: Cmd; speech?: number | null; turn?: string }[] = [];
const t0 = performance.now();
const now = () => Math.round(performance.now() - t0);
async function waitFor(what: string, ok: () => boolean, ms = 20_000) {
  const end = Date.now() + ms;
  while (!ok()) {
    assert.ok(Date.now() < end, `${what}: ${JSON.stringify(log.filter((l) => !("speech" in l)).slice(-14))}`);
    await Bun.sleep(20);
  }
}
const browser = await webkit.launch({ headless: true });
const report: { scope: string; checks: string[]; numbers: Record<string, number> } = {
  scope: "WebKit headless overlay page, headless AppEngine, fake ACP agent, fake voice (a tone, no speaker, no mic); no native window",
  checks: [],
  numbers: {},
};

try {
  await cli(["start", "--no-helper"]);
  const videos = join(out, "video-tmp");
  const ctx = await browser.newContext({ viewport: { width: 420, height: 400 }, deviceScaleFactor: 2, recordVideo: { dir: videos, size: { width: 420, height: 400 } } });
  const p = await ctx.newPage();
  const problems: string[] = [];
  p.on("pageerror", (e) => problems.push(String(e)));
  await p.goto(`http://127.0.0.1:${server.port}/index.html`);
  await p.addStyleTag({ content: "html{background:linear-gradient(135deg,#25324a,#3d2d4f)} body{margin:24px auto 0}" });
  await p.waitForFunction(() => (window as any).kiwiOverlayStats?.ready === true);
  // O que a página mostra a cada 40 ms: o nível que chegou, o estado que o gato desenha e se ele está falando.
  await p.evaluate(() => {
    const w = window as any;
    const root = document.getElementById("root")!;
    w.amostras = [];
    const bubble = document.getElementById("bubble")!;
    const text = document.getElementById("bubble-text")!;
    setInterval(() => w.amostras.push({
      t: Math.round(performance.now()), fala: w.kiwiOverlayStats.fala, estado: root.dataset.estado, falando: root.dataset.falando,
      // O balão (T33053, Cena 1): se está na tela, o texto de cima e se tem o "Ver mais".
      balao: bubble.dataset.on === "true" ? text.textContent : null, mais: bubble.dataset.more,
    }), 40);
  });

  // O helper falso: aplica os comandos do app à página, como o CatOverlay.swift faz.
  const apply = async (c: Cmd) => {
    if (c.type === "catOverlay.show" || c.type === "catOverlay.state") await p.evaluate((e) => (window as any).kiwiOverlay.set({ estado: e, visible: true }), c.estado);
    else if (c.type === "catOverlay.hide") await p.evaluate(() => (window as any).kiwiOverlay.set({ visible: false, bubble: null }));
    else if (c.type === "catOverlay.bubble") await p.evaluate((b) => (window as any).kiwiOverlay.set({ bubble: b.text ? b : null }), c as any);
    else if (c.type === "catOverlay.fala") await p.evaluate((n) => (window as any).kiwiOverlay.set({ fala: n }), c.nivel ?? null);
  };
  const queue: Cmd[] = [];
  const sub = await connect(data, (line: any) => {
    if ("id" in line || !line.event) return;
    if (line.event === "catOverlay.command") { log.push({ at: now(), cmd: line.payload }); queue.push(line.payload); }
    else if (line.event === "agent.speech") log.push({ at: now(), speech: line.payload.nivel });
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
  await invoke("agent.configure", { onboarding: { state: "done" } });
  await invoke("agent.configure", { catSpeaks: true });
  await invoke("agent.download");
  for (let n = 0; (await invoke("agent.status")).adapter.phase !== "ready"; n++) { assert.ok(n < 200); await Bun.sleep(100); }
  await waitFor("o load", () => log.some((l) => l.cmd?.type === "catOverlay.load"));

  // Um pedido por voz: o agente falso chama o `kiwi falar` antes da resposta, e a voz de mentira toca a frase.
  const r = await request(data, { cmd: "agentAsk", text: "Como ficou a lista de compras da semana?" });
  assert.ok(r && r.ok === true, JSON.stringify(r));
  await waitFor("a 1ª fala", () => log.some((l) => typeof l.cmd?.nivel === "number" && l.cmd.nivel > 0));
  await Bun.sleep(700);
  await p.screenshot({ path: join(out, "1-falando.png") });
  await waitFor("o fim da voz", () => log.some((l) => l.cmd?.type === "catOverlay.fala" && l.cmd.nivel === null), 30_000);
  await Bun.sleep(900);
  await p.screenshot({ path: join(out, "2-depois.png") });
  await Bun.sleep(600);

  const amostras: { t: number; fala: number | null; estado: string; falando: string; balao: string | null; mais: string }[] = await p.evaluate(() => (window as any).amostras);
  const falando = amostras.filter((a) => a.falando === "true");
  const iFim = amostras.findLastIndex((a) => a.falando === "true");
  const depois = amostras.slice(iFim + 1);
  // Falando, o gato desenha o `respondendo`, e a boca segue um nível que sobe e desce (as sílabas).
  assert.ok(falando.length >= 10, `amostras falando: ${falando.length}`);
  assert.ok(falando.slice(3).every((a) => a.estado === "respondendo"), JSON.stringify(falando.slice(0, 12)));
  const niveis = falando.map((a) => a.fala ?? 0);
  report.numbers.levelMax = Math.max(...niveis);
  report.numbers.levelMin = Math.min(...niveis);
  assert.ok(report.numbers.levelMax > 0.2 && report.numbers.levelMin < report.numbers.levelMax * 0.6, `níveis ${report.numbers.levelMin}–${report.numbers.levelMax}`);
  report.checks.push(`a voice request: the fake agent calls kiwi falar, the fake voice plays, and the overlay cat draws respondendo with the level going ${report.numbers.levelMin.toFixed(2)}–${report.numbers.levelMax.toFixed(2)}`);
  // Parada a voz, o gato volta ao estado que tinha por baixo: o do pedido (o pronto da resposta), não o respondendo.
  assert.ok(depois.length >= 5 && depois.every((a) => a.falando === "false" && a.fala === null), JSON.stringify(depois.slice(0, 5)));
  const estadoDepois = depois[3]!.estado;
  assert.notEqual(estadoDepois, "respondendo");
  report.checks.push(`when the voice stops (null), the cat goes back to the state underneath: ${estadoDepois}`);
  // O balão junto com a voz (T33053, Cena 1): o comando dele sai antes do 1º pedaço de áudio, e a página já o mostra,
  // com o texto da fala, na 1ª amostra falando. O `done` só põe o "Ver mais": o texto de cima é o mesmo até o fim.
  const iBalao = log.findIndex((l) => l.cmd?.type === "catOverlay.bubble" && !!l.cmd.text);
  const iAudio = log.findIndex((l) => typeof l.speech === "number");
  const iDone = log.findIndex((l) => l.turn === "done");
  assert.ok(iBalao >= 0 && iAudio >= 0 && iBalao < iAudio && iBalao < iDone, `o balão antes do 1º áudio e do done: ${iBalao}, ${iAudio}, ${iDone}`);
  const primeira = falando[0]!;
  assert.ok(primeira.balao, `o balão na 1ª amostra falando: ${JSON.stringify(primeira)}`);
  const comBalao = amostras.filter((a) => a.balao);
  assert.ok(comBalao.every((a) => a.balao === primeira.balao), `o texto de cima mudou: ${JSON.stringify([...new Set(comBalao.map((a) => a.balao))])}`);
  const fim = amostras.at(-1)!;
  report.numbers.bubbleBeforeAudioMs = log[iAudio]!.at - log[iBalao]!.at;
  report.checks.push(
    `the bubble is born with the speech (T33053): its command ${report.numbers.bubbleBeforeAudioMs} ms before the 1st audio chunk, on the page at the 1st speaking sample ("${primeira.balao}"); the top text never changes, "See more" at the end: ${fim.mais}`,
  );
  // O app: um nível por pedaço tocado, e o null no fim.
  const speech = log.filter((l) => "speech" in l).map((l) => l.speech);
  assert.equal(speech.at(-1), null);
  report.numbers.levelEvents = speech.length - 1;
  report.numbers.speechMs = log.findLast((l) => "speech" in l)!.at - log.find((l) => "speech" in l)!.at;
  report.checks.push(`the app sent ${report.numbers.levelEvents} levels in ${report.numbers.speechMs} ms (one per 80 ms chunk) and a null at the end`);

  pumping = false;
  await pump;
  sub.close();
  await ctx.close();
  assert.deepEqual(problems, []);
  const v = readdirSync(videos).find((f) => f.endsWith(".webm"));
  if (v) renameSync(join(videos, v), join(out, "fala.webm"));
  rmSync(videos, { recursive: true, force: true });
  writeFileSync(join(out, "log.json"), JSON.stringify({ log, amostras }, null, 2));
  console.log(JSON.stringify({ ok: true, ...report }, null, 2));
} finally {
  await browser.close().catch(() => {});
  server.stop(true);
  await cli(["stop"]).catch(() => {});
  registry.stop();
  rmSync(data, { recursive: true, force: true });
}
