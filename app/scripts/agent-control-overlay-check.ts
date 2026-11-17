// T13034 (spec #12938): a fala pelo Control com o Kiwi fora da frente termina com a resposta no balão do overlay. O
// helper headless de verdade toca um WAV do `say` como uma fala ao agente (`agentTalk`), o STT roda no Mac, e o texto vai
// ao agente falso. Sem hub à vista, o gato é o do overlay: os `catOverlay.*` que o helper recebe saem como evento, e a
// página do overlay de verdade, num WebKit headless, aplica cada um como o CatOverlay.swift. Nada nativo na tela,
// nenhum mic, nenhum agente de verdade. Pegue `kiwi lock bench` antes (o STT).
//
//   bun scripts/agent-control-overlay-check.ts <saída>
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Page } from "playwright-core";
import { connect, request } from "./cli";
import { fakeRegistry } from "../src/agent/fake/registry";
import { readingMs } from "../ui/hub/bubble-state";
import { OVERLAY_TIMES } from "../src/bun/cat-overlay";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T13034"));
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-control-overlay-"));
const wavs = mkdtempSync(join(tmpdir(), "kiwi-control-overlay-wav-"));
const registry = fakeRegistry([
  { name: "@agentclientprotocol/claude-agent-acp", version: "0.106.0", files: { "dist/index.js": "" } },
  { name: "zod", version: "4.6.7", files: { "index.js": "" } },
]);
const packages = join(data, "packages.json");
writeFileSync(packages, JSON.stringify(registry.pinned));
const env = { ...process.env, KIWI_FAKE_AGENT: "1", KIWI_ADAPTER_REGISTRY: registry.url, KIWI_ADAPTER_PACKAGES: packages };
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
/** Um WAV do `say`, 16 kHz mono, como o ditado testa (AGENTS.md: nada de mic). */
function say(name: string, text: string) {
  const file = join(wavs, `${name}.wav`);
  const r = Bun.spawnSync(["say", "-v", "Luciana", "-o", file, "--data-format=LEI16@16000", text]);
  assert.equal(r.exitCode, 0, String(r.stderr));
  return file;
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

type Cmd = { type: string; estado?: string; fadeMs?: number; text?: string | null; error?: boolean };
const log: { at: number; cmd: Cmd }[] = [];
const t0 = performance.now();
const now = () => Math.round(performance.now() - t0);
const waitFor = async (what: string, ok: () => boolean | Promise<boolean>, ms = 60_000) => {
  for (const end = Date.now() + ms; !(await ok()); await Bun.sleep(30)) assert.ok(Date.now() < end, `${what}: ${JSON.stringify(log.slice(-8))}`);
};
const at = (pred: (c: Cmd) => boolean, from = 0) => log.findIndex((l, i) => i >= from && pred(l.cmd));

const report: { scope: string; checks: string[]; talks: unknown[] } = {
  scope: "headless helper (real STT on synthetic `say` audio) + fake ACP agent + the real overlay page in WebKit headless; no hub in view, no mic, no key, nothing on screen",
  checks: [],
  talks: [],
};
const browser = await webkit.launch({ headless: true });
try {
  await cli(["start"]);
  const ctx = await browser.newContext({ viewport: { width: 420, height: 400 }, deviceScaleFactor: 2 });
  const p: Page = await ctx.newPage();
  const problems: string[] = [];
  p.on("pageerror", (e) => problems.push(String(e)));
  await p.goto(`http://127.0.0.1:${server.port}/index.html`);
  // Atrás do gato, um "outro app" (só no print): a página do overlay em si é transparente.
  await p.addStyleTag({ content: "html{background:linear-gradient(135deg,#dfe7f2,#efe4f3) !important} body{margin:24px auto 0} @media (prefers-color-scheme: dark){html{background:linear-gradient(135deg,#25324a,#3d2d4f) !important}}" });
  await p.waitForFunction(() => (window as any).kiwiOverlayStats?.ready === true);
  // O helper de verdade é headless e não mostra nada: a página aplica o que ele recebeu, como o CatOverlay.swift.
  const apply = async (c: Cmd) => {
    if (c.type === "catOverlay.show" || c.type === "catOverlay.state") await p.evaluate((e) => (window as any).kiwiOverlay.set({ estado: e, visible: true }), c.estado);
    else if (c.type === "catOverlay.hide") await p.evaluate(() => (window as any).kiwiOverlay.set({ visible: false, bubble: null }));
    else if (c.type === "catOverlay.bubble") await p.evaluate((b) => (window as any).kiwiOverlay.set({ bubble: b.text ? b : null }), c);
  };
  const queue: Cmd[] = [];
  const sub = await connect(data, (line: any) => {
    if ("id" in line || line.event !== "catOverlay.command") return;
    log.push({ at: now(), cmd: line.payload });
    queue.push(line.payload);
  });
  assert.ok(sub);
  sub.write({ id: 0, cmd: "subscribe", topics: ["events"], follow: true, backlog: false });
  let pumping = true;
  const pump = (async () => {
    while (pumping) {
      const c = queue.shift();
      if (c) await apply(c);
      else await Bun.sleep(5);
    }
  })();

  await invoke("agent.enable", { consent: true });
  await invoke("agent.configure", { onboarding: { state: "done" } });
  await invoke("agent.download");
  for (let n = 0; (await invoke("agent.status")).adapter.phase !== "ready"; n++) { assert.ok(n < 200); await Bun.sleep(100); }
  assert.equal((await invoke("agent.configure", { controlShortcut: true })).controlShortcut, true);
  await waitFor("o load da página", () => at((c) => c.type === "catOverlay.load") >= 0, 20_000);
  // Nenhuma janela do hub está à vista: o gato que ouve é o do overlay.

  async function talk(name: string, spoken: string, shot: string) {
    await waitFor("o agente livre", async () => !(await invoke("agent.status")).busy, 30_000);
    await Bun.sleep(1500);
    const from = log.length;
    assert.equal((await request(data, { cmd: "agentTalk", wav: say(name, spoken) }))?.ok, true);
    await waitFor(`o show (${name})`, () => at((c) => c.type === "catOverlay.show", from) >= 0);
    await waitFor(`o balão (${name})`, () => at((c) => c.type === "catOverlay.bubble" && !!c.text, from) >= 0);
    const b = at((c) => c.type === "catOverlay.bubble" && !!c.text, from);
    assert.equal(at((c) => c.type === "catOverlay.hide", from), -1, "o overlay não sai antes do balão");
    await p.waitForFunction((t) => (window as any).kiwiOverlayStats.bubble?.text === t, log[b]!.cmd.text);
    await Bun.sleep(400);
    // O tema do Mac decide o balão (os tokens do app): um print no claro e outro no escuro.
    await p.emulateMedia({ colorScheme: "light" });
    await Bun.sleep(150);
    await p.screenshot({ path: join(out, shot.replace(".png", "-light.png")) });
    await p.emulateMedia({ colorScheme: "dark" });
    await Bun.sleep(150);
    await p.screenshot({ path: join(out, shot.replace(".png", "-dark.png")) });
    await waitFor(`a saída (${name})`, () => at((c) => c.type === "catOverlay.hide", b) >= 0, 60_000);
    const h = at((c) => c.type === "catOverlay.hide", b);
    const texts = log.slice(from, h).filter((l) => l.cmd.type === "catOverlay.bubble").map((l) => l.cmd.text!);
    const shownMs = log[h]!.at - log[b]!.at;
    const minMs = texts.reduce((sum, t, i) => sum + Math.max(i === 0 ? OVERLAY_TIMES.pronto : 0, readingMs(t)), 0);
    // O relógio do teste vê o evento um pouco depois do app: uma folga de 100 ms para baixo.
    assert.ok(shownMs >= minMs - 100, `o balão ficou ${shownMs} ms, o tempo de leitura é ${minMs} ms`);
    await p.waitForFunction(() => (window as any).kiwiOverlayStats.bubble === null && (window as any).kiwiOverlayStats.visible === false);
    const states = log.slice(from, h).filter((l) => l.cmd.type === "catOverlay.state").map((l) => l.cmd.estado);
    report.talks.push({ spoken, states, bubbles: texts, shownMs, readingMs: minMs, error: log[b]!.cmd.error });
    return { texts, states, error: log[b]!.cmd.error };
  }

  // 1. Uma conversa, sem ação: a resposta vai ao balão.
  const chat = await talk("conversa", "Bom dia, Kiwi. Hoje o dia está bonito.", "1-conversa.png");
  assert.equal(chat.error, false);
  assert.match(chat.texts.join(" "), /Você disse/i);
  report.checks.push(`a conversation through Control ends with the answer in the overlay bubble ("${chat.texts[0]}"), and the overlay leaves only after the reading time`);

  // 2. Uma pergunta: o agente falso procura e lê a 1ª nota achada (as ferramentas), e o balão diz o que ele achou.
  await invoke("notes.create", { folder: "Kiwi", title: "Prazo", content: "# Prazo\n\nO prazo do Kiwi é abril.\n" });
  const asked = await talk("pergunta", "Qual é o prazo do Kiwi?", "2-pergunta.png");
  assert.equal(asked.error, false);
  assert.ok(asked.states.includes("agindo"), JSON.stringify(asked.states));
  report.checks.push(`a question with tools (search and read) ends with what the agent found in the bubble ("${asked.texts[0]}")`);

  assert.deepEqual(problems, []);
  pumping = false;
  await pump;
  sub.close();
  console.log(JSON.stringify({ ok: true, ...report }, null, 2));
} finally {
  await browser.close();
  await cli(["stop"]).catch(() => {});
  server.stop(true);
  registry.stop?.();
  rmSync(data, { recursive: true, force: true });
  rmSync(wavs, { recursive: true, force: true });
}
