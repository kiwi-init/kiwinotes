// O "Não ouvi" (T33054, spec #32534, Cena 4), de ponta a ponta e sem mic: o helper headless de verdade toca um WAV do
// `say` como uma fala ao agente (`agentTalk`), o STT roda no Mac e o hub de verdade, no WebKit headless, mostra o Kiwi.
// Duas falas que não dizem nada: uma curta demais ("é", menos de 0,5 s) e um silêncio (a transcrição vazia). Nas duas, o
// pedido não sai, o Kiwi fica confuso e o balão diz "Não ouvi. Segure o <atalho> e fale." com o mouse no Kiwi, e tudo
// some em 2,2 s. O atalho vem dos Ajustes: a 2ª fala é com outro atalho escolhido. Em pt e en (o 2º argumento).
//
// Nada nativo na tela, nenhum mic, nenhum agente de verdade. Pegue `kiwi lock bench` antes (o STT).
//
//   bun scripts/not-heard-check.ts [pasta] [pt|en]
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, peekKiwi, type OpenedPage, type UiContext } from "./ui-page";
import { fakeRegistry } from "../src/agent/fake/registry";
import { NOT_HEARD_MS } from "../ui/hub/bubble-state";

const app = resolve(import.meta.dir, "..");
const lang = process.argv[3] === "en" ? "en" : "pt";
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T33054-nao-ouvi")); mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-not-heard-"));
const wavs = mkdtempSync(join(tmpdir(), "kiwi-not-heard-wav-"));
writeFileSync(join(data, "settings.json"), JSON.stringify({ version: 1, firstRun: "done", language: lang }));
const registry = fakeRegistry([
  { name: "@agentclientprotocol/claude-agent-acp", version: "0.106.0", files: { "dist/index.js": "" } },
  { name: "zod", version: "4.6.7", files: { "index.js": "" } },
]);
const packages = join(data, "packages.json"); writeFileSync(packages, JSON.stringify(registry.pinned));
const env = { ...process.env, KIWI_FAKE_AGENT: "1", KIWI_ADAPTER_REGISTRY: registry.url, KIWI_ADAPTER_PACKAGES: packages, KIWI_SYSTEM_LANG: lang === "en" ? "en-US" : "pt-BR", KIWI_LANGUAGE_CHOICE: "1" };
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
  // A mesma voz nas duas línguas: o que conta é a duração (o "eh" da Samantha passa de 0,5 s e vira pedido).
  const r = Bun.spawnSync(["say", "-v", "Luciana", "-o", file, "--data-format=LEI16@16000", text]);
  assert.equal(r.exitCode, 0, String(r.stderr));
  return file;
}
const waitFor = async (what: string, test: () => boolean | Promise<boolean>, ms = 30_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(50)) if (await test()) return;
  throw new Error(`timed out: ${what}`);
};

const LINE = {
  pt: (key: string) => `Não ouvi. Segure o ${key} e fale.`,
  en: (key: string) => `I didn't catch that. Hold ${key} and speak.`,
}[lang];
const report: any = { lang, scope: "headless helper (real STT on synthetic `say` audio) + fake ACP agent + WebKit headless hub; no mic, no key, nothing on screen", checks: [] };
const browser = await webkit.launch({ headless: true });
let w: OpenedPage | undefined;
let offEvents: (() => void) | undefined;
try {
  await cli(["start"]);
  offEvents = await ctx.subscribe(["events"], (l: any) => events.push({ type: l.type ?? l.event, payload: l }));
  w = await openWindow(browser, ctx, { window: "hub", scale: 2, theme: "dark", width: 1000, height: 740, motion: true, browser: "webkit", query: { section: "notes" } });
  const p = w.page;
  assert.equal((await invoke("app.locale")).locale, lang);
  await invoke("agent.enable", { consent: true }); await invoke("agent.download");
  await invoke("agent.configure", { onboarding: { state: "done" }, controlShortcut: true });
  for (let n = 0; (await invoke("agent.status")).adapter.phase !== "ready"; n++) { assert.ok(n < 200); await Bun.sleep(100); }
  await p.waitForSelector('.kn-kiwicat[data-ready="true"]');
  // O hub está na frente: o gato que ouve é o do canto.
  assert.equal((await ctx.send({ cmd: "hubView", view: true })).ok, true);

  // O que a região viva do balão anuncia ao leitor de tela: só quando o texto dela muda de verdade. Um texto igual que
  // fica parado não é anunciado de novo, então o 2º aviso igual só conta se a região passou por outro texto (o "").
  await p.waitForSelector(".kn-visually-hidden[aria-live]", { state: "attached" });
  await p.evaluate(() => {
    const said: string[] = ((window as any).__announced = []);
    const region = document.querySelector(".kn-visually-hidden[aria-live]")!;
    let last = region.textContent?.trim() ?? "";
    new MutationObserver(() => {
      const t = region.textContent?.trim() ?? "";
      if (t === last) return;
      last = t;
      if (t) said.push(t);
    }).observe(region, { subtree: true, childList: true, characterData: true });
  });
  const announced = () => p.evaluate(() => (window as any).__announced as string[]);
  const bubbleNow = () => p.evaluate(() => document.querySelector('.kn-bubble-slot:not([data-phase="exit"]) .kn-bubble')?.textContent?.trim() ?? "");
  const catState = () => p.locator(".kn-kiwicat").getAttribute("data-state");
  /** O balão à vista (T32766: só com o mouse no Kiwi) e a marca do não visto, do `.kn-hub`. */
  const hub = () => p.evaluate(() => { const d = document.querySelector<HTMLElement>(".kn-hub")!.dataset; return { peek: d.bubblePeek, unseen: d.bubbleUnseen }; });

  /** Uma fala que não diz nada: o idle com o `notHeard`, o Kiwi confuso, o balão no mouse, e tudo some em 2,2 s. */
  async function nothing(name: string, wav: string, shortcut: string, key: string) {
    const count = (await invoke("agent.activity", {})).requests.length;
    const start = events.length;
    const heardBefore = (await announced()).length;
    // O mouse longe do Kiwi: o balão só aparece com ele em cima (T32766).
    await p.mouse.move(40, 40);
    assert.equal((await ctx.send({ cmd: "agentTalk", wav })).ok, true);
    await waitFor(`${name}: the idle`, () => events.slice(start).some((e) => e.type === "agent.voice" && e.payload?.payload?.phase === "idle"));
    const at = Date.now();
    const idle = events.slice(start).find((e) => e.type === "agent.voice" && e.payload?.payload?.phase === "idle")!.payload.payload;
    assert.deepEqual(idle, { phase: "idle", cancelled: true, notHeard: { shortcut } }, `${name}: ${JSON.stringify(idle)}`);
    await waitFor(`${name}: the confused Kiwi`, async () => (await catState()) === "erro", 1000);
    // Sem o mouse, o balão fica escondido, e a marca diz que há o que ver.
    await waitFor(`${name}: the text in the bubble`, async () => (await bubbleNow()).includes(LINE(key)), 1000);
    await waitFor(`${name}: the unseen mark`, async () => (await hub()).unseen === "true", 1000);
    assert.notEqual((await hub()).peek, "true", `${name}: o balão sem o mouse`);
    // O leitor de tela ouve com o balão escondido, e de novo num segundo "Não ouvi" igual.
    await waitFor(`${name}: the screen reader`, async () => (await announced()).slice(heardBefore).includes(LINE(key)), 1000);
    await peekKiwi(p);
    await waitFor(`${name}: the bubble on the mouse`, async () => (await hub()).peek === "true", 1000);
    // O print depois da entrada do balão (o fade), ainda bem dentro dos 2,2 s.
    await p.waitForFunction(() => document.querySelector('.kn-bubble-slot:not([data-phase="exit"])')?.getAnimations({ subtree: true }).every((a) => a.playState !== "running") ?? false, null, { timeout: 1000 }).catch(() => {});
    await p.screenshot({ path: join(out, `${lang}-${name}.png`), clip: { x: 560, y: 470, width: 440, height: 270 } });
    // O mouse segue no Kiwi: o aviso sai no tempo dele, e o Kiwi volta ao repouso.
    await waitFor(`${name}: the bubble leaves`, async () => !(await bubbleNow()).includes(LINE(key)), NOT_HEARD_MS + 1500);
    const gone = Date.now() - at;
    assert.ok(gone >= NOT_HEARD_MS - 400, `${name}: o balão saiu cedo (${gone} ms)`);
    await waitFor(`${name}: the Kiwi at rest`, async () => (await catState()) !== "erro", 1500);
    assert.equal((await invoke("agent.activity", {})).requests.length, count, `${name}: nada vai ao agente`);
    report.checks.push(`${name}: no request; confused Kiwi; "${LINE(key)}" hidden with the unseen mark and read by the live region, shown with the mouse on the Kiwi; gone after ${gone} ms (shortcut ${shortcut})`);
  }

  await nothing("curta", say("curta", "é"), "control", "Control");
  // Outro atalho nos Ajustes: o texto acompanha.
  await invoke("settings.set", { shortcuts: { agent: "option+space" } });
  await nothing("silencio", say("silencio", "[[slnc 1500]]"), "option+space", lang === "en" ? "⌥ Space" : "⌥ Espaço");
  // O mesmo aviso de novo: a região viva o lê outra vez.
  await nothing("de-novo", say("de-novo", "é"), "option+space", lang === "en" ? "⌥ Space" : "⌥ Espaço");
  console.log(JSON.stringify({ ok: true, ...report }));
} finally {
  offEvents?.();
  await w?.close().catch(() => {});
  await browser.close().catch(() => {});
  await cli(["stop"]).catch(() => {});
  // O servidor do registro falso segura o processo: sem o stop, o roteiro não sai depois do ok.
  registry.stop?.();
  rmSync(data, { recursive: true, force: true });
  rmSync(wavs, { recursive: true, force: true });
}
