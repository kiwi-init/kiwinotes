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
import { openWindow, type OpenedPage, type UiContext } from "./ui-page";
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
const env = { ...process.env, KIWI_FAKE_AGENT: "1", KIWI_ADAPTER_REGISTRY: registry.url, KIWI_ADAPTER_PACKAGES: packages, KIWI_FAKE_AGENT_TOOL_DELAY_MS: "1500", KIWI_FAKE_AGENT_THINK_MS: "1500" };
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
// O que o check abre e o `finally` fecha, também quando uma asserção falha no meio (T15582). A janela tem um servidor
// local (`serve` no `openWindow`), e só o `close()` dela o para: sem ele, o processo ficava vivo depois do ok.
let w: OpenedPage | undefined;
let offEvents: (() => void) | undefined;
let watch: ReturnType<typeof setInterval> | undefined;
let shooting: Promise<void> | undefined;
let stopShooting = false;
try {
  await cli(["start"]);
  offEvents = await ctx.subscribe(["events"], (l: any) => events.push({ type: l.type ?? l.event, payload: l }));
  w = await openWindow(browser, ctx, { window: "hub", scale: 2, theme: "dark", width: 1000, height: 740, motion: true, browser: "webkit", query: { section: "notes" } });
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

  // 2. A fala vira o pedido: o gato ouve, as ondas somem ao soltar, e o texto entendido vai ao agente. Com "Mostrar o que
  // eu falei" desligado (o padrão, spec #26055), não vai ao balão: o 1º balão é a resposta.
  assert.equal((await invoke("agent.status")).showSpokenText, false);
  /** Os textos do balão do gato, na ordem, sem repetir o seguido. */
  // O balão que sai (`data-phase="exit"`) ainda fica no DOM por 180 ms: não conta.
  const bubbleNow = () => p.evaluate(() => document.querySelector('.kn-bubble-slot:not([data-phase="exit"]) .kn-bubble')?.textContent?.trim() ?? "");
  /** `stale`: o balão do pedido de antes, que ainda pode estar na tela, não conta. */
  const bubbleTexts = (into: string[], stale = "") => setInterval(() => void bubbleNow().then((t) => { if (t && t !== stale && into.at(-1) !== t) into.push(t); }, () => {}), 30);
  const heardOff: string[] = [];
  const watchOff = bubbleTexts(heardOff);
  const said = say("pedido", "Resuma a nota de ontem.");
  const before = events.length;
  let frame = 0;
  shooting = (async () => {
    for (const end = Date.now() + 9000; !stopShooting && Date.now() < end; await Bun.sleep(80)) {
      await p.screenshot({ path: join(out, "frames", `f${String(frame++).padStart(4, "0")}.png`), clip: { x: 520, y: 430, width: 480, height: 310 } });
    }
  })();
  const states: string[] = [];
  watch = setInterval(() => void p.locator(".kn-kiwicat").getAttribute("data-state").then((s) => { if (s && states.at(-1) !== s) states.push(s); }, () => {}), 30);
  assert.equal((await ctx.send({ cmd: "agentTalk", wav: said })).ok, true);
  await waitFor("the request", () => events.slice(before).some((e) => e.type === "agent.voice" && e.payload?.payload?.phase === "asked"));
  const voice = events.slice(before).filter((e) => e.type === "agent.voice").map((e) => e.payload.payload);
  const asked = voice.find((v) => v.phase === "asked");
  assert.equal(asked.text, undefined, "a fala não vai ao balão com o ajuste desligado");
  // O agente pensa 1,5 s (KIWI_FAKE_AGENT_THINK_MS): o gato em "pensando", sem balão nenhum.
  await Bun.sleep(500);
  assert.equal(await bubbleNow(), "", "nenhum balão enquanto o agente pensa");
  await p.screenshot({ path: join(out, "1-sem-a-fala-pensando.png"), clip: { x: 520, y: 430, width: 480, height: 310 } });
  const phases = voice.map((v) => v.phase).filter((v, i, a) => a[i - 1] !== v);
  assert.deepEqual(phases.slice(0, 3), ["listening", "processing", "asked"], JSON.stringify(phases));
  // As ondas seguem a voz (o nível muda durante a fala) e somem no instante em que a escuta encerra.
  const levels = voice.filter((v) => v.phase === "listening").map((v) => v.voz);
  assert.ok(levels.length > 10 && Math.max(...levels) > 0.3 && new Set(levels).size > 5, JSON.stringify(levels.slice(0, 20)));
  assert.ok(voice.findIndex((v) => v.phase === "processing") > voice.findLastIndex((v) => v.phase === "listening"), "no wave after the listening ended");
  await p.waitForSelector(".kn-bubble", { timeout: 5000 });
  await p.screenshot({ path: join(out, "2-sem-a-fala-resposta.png"), clip: { x: 520, y: 430, width: 480, height: 310 } });
  report.checks.push(`the speech becomes the request: listening (${levels.length} levels, the waves follow the voice) → processing (waves off at once) → asked, without the text`);
  await waitFor("the agent's turn", async () => (await invoke("agent.activity", {})).requests.some((r: any) => /ontem/i.test(r.request)));
  clearInterval(watchOff);
  // O texto ouvido entra no balão entre aspas curvas (`BubbleFeed.heard`): desligado, nenhum balão é ele.
  assert.ok(heardOff.length > 0 && !heardOff.some((t) => t.startsWith("“")), JSON.stringify(heardOff));
  report.checks.push(`"Mostrar o que eu falei" off (the default): the first bubble is the answer, never the speech (${JSON.stringify(heardOff[0])})`);
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

  // 3b. Ligado em Ajustes › Agente, sem reiniciar: a próxima fala aparece no balão antes da resposta.
  await waitFor("the agent free", async () => !(await invoke("agent.status")).busy, 20_000);
  assert.equal((await invoke("agent.configure", { showSpokenText: true })).showSpokenText, true);
  const heardOn: string[] = [];
  const watchOn = bubbleTexts(heardOn, await bubbleNow());
  const onStart = events.length;
  // O agente falso pensa 1,5 s antes da 1ª palavra (KIWI_FAKE_AGENT_THINK_MS), como o de verdade: sem a pausa, a
  // resposta toma o lugar da fala no balão (o BubbleFeed) antes de ela aparecer.
  assert.equal((await ctx.send({ cmd: "agentTalk", wav: say("com-a-fala", "Abra o projeto X.") })).ok, true);
  await waitFor("the request with the text", () => events.slice(onStart).some((e) => e.type === "agent.voice" && e.payload?.payload?.phase === "asked"));
  const askedOn = events.slice(onStart).find((e) => e.type === "agent.voice" && e.payload?.payload?.phase === "asked")!.payload.payload;
  assert.match(askedOn.text, /projeto/i);
  await waitFor("the speech in the bubble", () => heardOn.some((t) => t.startsWith("“")), 5000).catch((e: Error) => {
    throw new Error(`${e.message}: ${JSON.stringify({ heardOn, asked: askedOn })}`);
  });
  // A entrada do balão (Web Animations, 60 + 250 ms) termina; o agente ainda pensa.
  await Bun.sleep(500);
  await p.screenshot({ path: join(out, "3-com-a-fala.png"), clip: { x: 520, y: 430, width: 480, height: 310 }, animations: "disabled" });
  const atShot = await bubbleNow();
  assert.ok(atShot.startsWith("“"), `a fala ainda no balão depois do print: ${JSON.stringify({ atShot, heardOn })}`);
  await waitFor("the answer after the speech", () => heardOn.some((t) => !t.startsWith("“")), 20_000);
  clearInterval(watchOn);
  assert.ok(heardOn[0]!.startsWith("“"), JSON.stringify(heardOn));
  report.checks.push(`"Mostrar o que eu falei" on, without a restart: the speech shows first (${JSON.stringify(heardOn[0])}), then the answer`);
  await invoke("agent.configure", { showSpokenText: false });

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
  console.log(JSON.stringify({ ok: true, ...report, frames: frame }));
} finally {
  clearInterval(watch);
  stopShooting = true;
  await shooting?.catch(() => {});
  offEvents?.();
  await w?.close();
  await browser.close();
  await cli(["stop"]).catch(() => {});
  registry.stop?.();
  rmSync(data, { recursive: true, force: true });
  rmSync(wavs, { recursive: true, force: true });
}
