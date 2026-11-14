// T11248 (spec #9876): o atalho Control de ponta a ponta, sem mic e sem tecla. O helper headless de verdade toca um WAV
// do `say` como uma fala ao agente (`agentTalk` → `debug.transcribe {target: "agent"}`), o STT roda no Mac, e o texto
// vai ao agente falso. O hub de verdade no WebKit headless mostra o gato. Nada nativo na tela, nenhum mic, nenhum
// agente de verdade. Pegue `kiwi lock bench` antes (o STT). Uso: bun scripts/agent-control-check.ts <saída>
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";
import { fakeRegistry } from "../src/agent/fake/registry";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? "/tmp/kiwi-T11248"); mkdirSync(join(out, "frames"), { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-agent-control-"));
const wavs = mkdtempSync(join(tmpdir(), "kiwi-agent-control-wav-"));
const registry = fakeRegistry([
  { name: "@agentclientprotocol/claude-agent-acp", version: "0.106.0", files: { "dist/index.js": "" } },
  { name: "zod", version: "4.6.7", files: { "index.js": "" } },
]);
const packages = join(data, "packages.json"); writeFileSync(packages, JSON.stringify(registry.pinned));
const env = { ...process.env, KIWI_FAKE_AGENT: "1", KIWI_ADAPTER_REGISTRY: registry.url, KIWI_ADAPTER_PACKAGES: packages, KIWI_FAKE_AGENT_TOOL_DELAY_MS: "1500" };
async function cli(args: string[]) {
  const p = Bun.spawn([process.execPath, join(app, "scripts/cli.ts"), ...args, "--data", data], { cwd: app, stdout: "pipe", stderr: "pipe", env });
  const text = await new Response(p.stdout).text(); const err = await new Response(p.stderr).text();
  assert.equal(await p.exited, 0, text + err); return text;
}
const events: { type: string; payload?: any }[] = [];
const ctx: UiContext = { data, send: async (msg) => { const r = await request(data, msg); assert.ok(r); return r; },
  subscribe: async (topics, onMsg) => {
    const c = await connect(data, (line) => { if (!("id" in line)) onMsg(line); }); assert.ok(c);
    c.write({ id: 0, cmd: "subscribe", topics, follow: true, backlog: false }); return () => c.close();
  } };
async function invoke(cap: string, args: unknown = {}) { const r = await ctx.send({ cmd: "invoke", cap, args }); assert.equal(r.ok, true, JSON.stringify(r)); return r.value as any; }
/** Um WAV do `say`, 16 kHz mono, como o ditado testa (AGENTS.md: nada de mic). */
function say(name: string, text: string) {
  const file = join(wavs, `${name}.wav`);
  const r = Bun.spawnSync(["say", "-v", "Luciana", "-o", file, "--data-format=LEI16@16000", text]);
  assert.equal(r.exitCode, 0, String(r.stderr));
  return file;
}
const waitFor = async (what: string, test: () => boolean | Promise<boolean>, ms = 30_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(50)) if (await test()) return;
  throw new Error(`timed out: ${what}`);
};

const report: any = { scope: "headless helper (real STT on synthetic `say` audio) + fake ACP agent + WebKit headless hub; no mic, no key, nothing on screen", checks: [] };
const browser = await webkit.launch({ headless: true });
try {
  await cli(["start"]);
  const offEvents = await ctx.subscribe(["events"], (l: any) => events.push({ type: l.type ?? l.event, payload: l }));
  const w = await openWindow(browser, ctx, { window: "hub", scale: 2, theme: "dark", width: 1000, height: 740, motion: true, browser: "webkit", query: { section: "notes" } });
  const p = w.page;
  await invoke("agent.enable", { consent: true }); await invoke("agent.download");
  // O onboarding (spec #11955) abre na primeira vez que o agente liga e cobre o hub: aqui ele já foi feito (T12273).
  await invoke("agent.configure", { onboarding: { state: "done" } });
  for (let n = 0; (await invoke("agent.status")).adapter.phase !== "ready"; n++) { assert.ok(n < 200); await Bun.sleep(100); }
  await p.waitForSelector('.kn-kiwicat[data-ready="true"]');
  // O hub está na frente: o gato que ouve é o do canto (o overlay é para quando o Kiwi não está à vista).
  assert.equal((await ctx.send({ cmd: "hubView", view: true })).ok, true);

  // 1. Ajustes › Agente: desligado por padrão; ligado pelo agent.configure.
  assert.equal((await invoke("agent.status")).controlShortcut, false);
  assert.equal((await invoke("agent.configure", { controlShortcut: true })).controlShortcut, true);
  report.checks.push("the Control switch is off by default and turns on in Settings › Agente");

  // 2. A fala vira o pedido: o gato ouve, as ondas somem ao soltar, o texto entendido vai ao balão e ao agente.
  const said = say("pedido", "Resuma a nota de ontem.");
  const before = events.length;
  let frame = 0;
  const shooting = (async () => {
    for (const end = Date.now() + 9000; Date.now() < end; await Bun.sleep(80)) {
      await p.screenshot({ path: join(out, "frames", `f${String(frame++).padStart(4, "0")}.png`), clip: { x: 520, y: 430, width: 480, height: 310 } });
    }
  })();
  const states: string[] = [];
  const watch = setInterval(() => void p.locator(".kn-kiwicat").getAttribute("data-state").then((s) => { if (s && states.at(-1) !== s) states.push(s); }, () => {}), 30);
  assert.equal((await ctx.send({ cmd: "agentTalk", wav: said })).ok, true);
  await waitFor("the request", () => events.slice(before).some((e) => e.type === "agent.voice" && e.payload?.payload?.phase === "asked"));
  const voice = events.slice(before).filter((e) => e.type === "agent.voice").map((e) => e.payload.payload);
  const asked = voice.find((v) => v.phase === "asked");
  assert.match(asked.text, /resuma a nota de ontem/i);
  const phases = voice.map((v) => v.phase).filter((v, i, a) => a[i - 1] !== v);
  assert.deepEqual(phases.slice(0, 3), ["listening", "processing", "asked"], JSON.stringify(phases));
  // As ondas seguem a voz (o nível muda durante a fala) e somem no instante em que a escuta encerra.
  const levels = voice.filter((v) => v.phase === "listening").map((v) => v.voz);
  assert.ok(levels.length > 10 && Math.max(...levels) > 0.3 && new Set(levels).size > 5, JSON.stringify(levels.slice(0, 20)));
  assert.ok(voice.findIndex((v) => v.phase === "processing") > voice.findLastIndex((v) => v.phase === "listening"), "no wave after the listening ended");
  await p.waitForSelector(".kn-bubble", { timeout: 5000 });
  report.checks.push(`the speech becomes the request: listening (${levels.length} levels, the waves follow the voice) → processing (waves off at once) → asked "${asked.text}"`);
  await waitFor("the agent's turn", async () => (await invoke("agent.activity", {})).requests.some((r: any) => /ontem/i.test(r.request)));
  report.checks.push("the text reaches the fake agent through agent.ask (the guardrail filter's path)");
  await shooting;
  clearInterval(watch);
  report.catStates = states;
  // O `data-state` só muda com o estado do pedido; o desenho do `ouvindo` (as ondas) se vê nos quadros do vídeo.
  assert.ok(states.includes("acordou") && states.includes("thinking"), JSON.stringify(states));
  assert.notEqual(await p.locator(".kn-kiwicat").getAttribute("data-away"), "true", "the corner cat never hid");
  report.checks.push("the corner cat wakes (acordou → ouvindo, in the frames) and stays on screen into the request");

  // 3. Nunca colado, e nada na fila do ditado nem no histórico.
  const talk = events.slice(before);
  assert.ok(!talk.some((e) => /^(dictation\.|history\.added|transcript\.final)/.test(e.type)), JSON.stringify(talk.map((e) => e.type)));
  report.checks.push("nothing goes to the dictation: no dictation.done, no history entry, no paste");

  // 4. Fala curta demais: nada vai ao agente.
  await waitFor("the agent free", async () => !(await invoke("agent.status")).busy, 20_000);
  const count = (await invoke("agent.activity", {})).requests.length;
  const shortStart = events.length;
  assert.equal((await ctx.send({ cmd: "agentTalk", wav: say("curta", "é") })).ok, true);
  await waitFor("the short speech settles", () => events.slice(shortStart).some((e) => e.type === "agent.voice" && e.payload?.payload?.phase === "idle"));
  assert.equal((await invoke("agent.activity", {})).requests.length, count);
  report.checks.push("a speech shorter than half a second sends nothing, and the cat goes back to rest");

  // 5. O áudio não fica: nenhum WAV na pasta de dados.
  const left = (function walk(d: string): string[] { return readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : /\.(wav|aiff|caf)$/i.test(e.name) ? [join(d, e.name)] : []); })(data);
  assert.deepEqual(left, []);
  report.checks.push("no audio is kept in the data folder");
  offEvents();
  console.log(JSON.stringify({ ok: true, ...report, frames: frame }));
} finally {
  await browser.close();
  await cli(["stop"]).catch(() => {});
  registry.stop?.();
  rmSync(data, { recursive: true, force: true });
  rmSync(wavs, { recursive: true, force: true });
}
