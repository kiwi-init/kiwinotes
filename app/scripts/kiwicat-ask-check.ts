// T10872 (spec #9878): falar por texto. O hub de verdade, o AppEngine headless e o agente falso; nada nativo, nada na tela.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";
import { fakeRegistry } from "../src/agent/fake/registry";
const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? "/tmp/kiwi-T10872-ask"); mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-cat-ask-"));
const registry = fakeRegistry([
  { name: "@agentclientprotocol/claude-agent-acp", version: "0.106.0", files: { "dist/index.js": "" } },
  { name: "zod", version: "4.6.7", files: { "index.js": "" } },
]);
const packages = join(data, "packages.json"); writeFileSync(packages, JSON.stringify(registry.pinned));
async function cli(args: string[]) {
  const p = Bun.spawn([process.execPath, join(app, "scripts/cli.ts"), ...args, "--data", data], {
    cwd: app, stdout: "pipe", stderr: "pipe", env: { ...process.env, KIWI_FAKE_AGENT: "1", KIWI_ADAPTER_REGISTRY: registry.url, KIWI_ADAPTER_PACKAGES: packages },
  });
  const text = await new Response(p.stdout).text(); const err = await new Response(p.stderr).text();
  assert.equal(await p.exited, 0, text + err); return text;
}
const ctx: UiContext = { data, send: async msg => { const r = await request(data, msg); assert.ok(r); return r; },
  subscribe: async (topics, onMsg) => {
    const c = await connect(data, line => { if (!("id" in line)) onMsg(line); }); assert.ok(c);
    c.write({ id: 0, cmd: "subscribe", topics, follow: true, backlog: false }); return () => c.close();
  } };
async function invoke(cap: string, args: unknown = {}) { const r = await ctx.send({ cmd: "invoke", cap, args }); assert.equal(r.ok, true, JSON.stringify(r)); return r.value as any; }

const GH = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"; // inventado, no formato de verdade
const browser = await webkit.launch({ headless: true });
const report: any = { scope: "WebKit headless hub with fake ACP agent; no native app", checks: [] };
try {
  await cli(["start", "--no-helper"]);
  const w = await openWindow(browser, ctx, { window: "hub", scale: 2, theme: "dark", width: 1000, height: 740, motion: true, browser: "webkit", query: { section: "notes" } });
  const p = w.page;
  await invoke("agent.enable", { consent: true }); await invoke("agent.download");
  // O onboarding (spec #11955) abre na primeira vez que o agente liga e cobre o hub: aqui ele já foi feito (T12273).
  await invoke("agent.configure", { onboarding: { state: "done" } });
  for (let n = 0; (await invoke("agent.status")).adapter.phase !== "ready"; n++) { assert.ok(n < 200); await Bun.sleep(100); }
  await p.waitForSelector('.kn-kiwicat[data-ready="true"]');
  const box = async (sel: string) => (await p.locator(sel).boundingBox())!;
  const shot = (name: string) => p.screenshot({ path: join(out, `${name}.png`), clip: { x: 560, y: 470, width: 440, height: 270 } });
  const field = ".kn-cat-ask-field";
  const requests = async () => ((await invoke("agent.activity", {})) as { requests: { request: string }[] }).requests;

  // 1. Só o corpo: a névoa (o canto de cima do quadro do gato) deixa o clique passar.
  const cat = await box(".kn-kiwicat");
  const under = await p.evaluate(([x, y]) => document.elementFromPoint(x, y)?.className ?? "", [cat.x + 4, cat.y + 4] as const);
  assert.ok(!String(under).includes("kn-kiwicat-hit"), `fog point hits ${under}`);
  await p.mouse.click(cat.x + 4, cat.y + 4);
  assert.equal(await p.locator(".kn-cat-ask").count(), 0);
  report.checks.push("only the body takes the click; the fog lets it through");

  // 2. O clique no corpo abre o campo, já com o foco; o gato acorda e fica atento, sem ondas.
  const body = await box(".kn-kiwicat-hit");
  await p.mouse.click(body.x + body.width / 2, body.y + body.height / 2);
  await p.waitForSelector(".kn-cat-ask");
  assert.ok(await p.evaluate((f) => document.activeElement === document.querySelector(f), field));
  assert.equal(await p.locator(".kn-kiwicat").getAttribute("data-state"), "acordou");
  await p.waitForTimeout(700);
  const waves = await p.evaluate(() => [...document.querySelectorAll('.kn-kiwicat [data-symbol="ouvindo"]')].map((e) => getComputedStyle(e).opacity));
  assert.deepEqual(waves, ["0", "0", "0"]);
  report.checks.push("click on the body opens the field focused; acordou then ouvindo with no waves");

  // 3. Shift+Enter quebra a linha; Esc fecha, o gato volta ao repouso e o rascunho volta no próximo clique.
  await p.keyboard.type("oi gato"); await p.keyboard.press("Shift+Enter"); await p.keyboard.type("segunda linha");
  assert.equal(await p.locator(field).inputValue(), "oi gato\nsegunda linha");
  await shot("1-campo-aberto");
  await p.keyboard.press("Escape");
  await p.waitForSelector(".kn-cat-ask", { state: "detached" });
  assert.equal(await p.locator(".kn-kiwicat").getAttribute("data-state"), "repouso");
  // Aberto pelo mouse, o foco não fica no gato (sem o anel de foco nele) nem preso no campo.
  assert.ok(await p.evaluate(() => !document.activeElement?.classList.contains("kn-kiwicat-hit") && !document.activeElement?.classList.contains("kn-cat-ask-field")));
  await p.mouse.click(body.x + body.width / 2, body.y + body.height / 2);
  await p.waitForSelector(".kn-cat-ask");
  assert.equal(await p.locator(field).inputValue(), "oi gato\nsegunda linha");
  report.checks.push("Shift+Enter breaks the line; Esc closes back to rest; the draft comes back");

  // 4. Enter manda: o pedido vai ao agente, sem repetir a entrada (nunca acordou depois de mandar), e aparece na Atividade.
  await p.evaluate(() => {
    const el = document.querySelector(".kn-kiwicat")!; (window as any).__states = [];
    new MutationObserver(() => (window as any).__states.push(el.getAttribute("data-state"))).observe(el, { attributes: true, attributeFilter: ["data-state"] });
  });
  const before = (await requests()).length;
  await p.locator(field).focus(); await p.keyboard.press("Enter");
  await p.waitForSelector(".kn-cat-ask", { state: "detached" });
  await p.waitForSelector('.kn-kiwicat[data-state="pronto"]');
  const states: string[] = await p.evaluate(() => (window as any).__states);
  assert.ok(!states.includes("acordou"), JSON.stringify(states));
  assert.ok(states.includes("thinking"), JSON.stringify(states));
  const after = await requests();
  assert.equal(after.length, before + 1);
  assert.ok(after[0]!.request.includes("oi gato"));
  report.checks.push("Enter sends to the fake agent, no repeated entry, the request shows in Atividade");

  // 5. O guardrail: um segredo no texto não vai ao agente nem ao registro.
  await p.waitForTimeout(1500);
  await p.mouse.click(body.x + body.width / 2, body.y + body.height / 2); await p.waitForSelector(".kn-cat-ask");
  await p.keyboard.type(`o token é ${GH}`); await p.keyboard.press("Enter");
  await p.waitForSelector('.kn-kiwicat[data-state="pronto"]');
  const held = (await requests())[0]!;
  assert.ok(!held.request.includes(GH) && held.request.includes("‹segredo"), held.request);
  report.checks.push("the text goes through the guardrail filter");

  // 6. Ocupado: o campo abre e fecha sem mudar o gato, não manda, e oferece cancelar o pedido.
  await p.waitForTimeout(1500);
  await invoke("agent.ask", { text: "/lento" }); await p.waitForSelector('.kn-kiwicat[data-state="agindo"]');
  const count = (await requests()).length;
  await p.mouse.click(body.x + body.width / 2, body.y + body.height / 2); await p.waitForSelector(".kn-cat-ask");
  assert.equal(await p.locator(".kn-kiwicat").getAttribute("data-state"), "agindo");
  assert.ok(await p.locator(".kn-cat-ask-send").isDisabled());
  await p.keyboard.type("mais uma coisa"); await p.keyboard.press("Enter");
  assert.equal(await p.locator(".kn-cat-ask").count(), 1);
  assert.equal((await requests()).length, count);
  await shot("2-ocupado");
  await p.locator(".kn-cat-ask-link").click();
  await p.waitForSelector('.kn-kiwicat[data-state="ouvindo"]');
  await p.keyboard.press("Escape"); await p.waitForSelector(".kn-cat-ask", { state: "detached" });
  report.checks.push("busy: opens without changing the cat, doesn't send, offers to cancel; the end goes back to ouvindo");

  // 7. O limite: passou de 500, avisa e não manda (a colagem não é cortada).
  await p.mouse.click(body.x + body.width / 2, body.y + body.height / 2); await p.waitForSelector(".kn-cat-ask");
  await p.locator(field).fill("x".repeat(501));
  assert.equal((await p.locator(field).inputValue()).length, 501);
  assert.ok(await p.locator(".kn-cat-ask-send").isDisabled());
  assert.ok(await p.locator(".kn-cat-ask-note").first().isVisible());
  await shot("3-longo-demais");
  await p.locator(field).fill(""); await p.keyboard.press("Escape");
  report.checks.push("over 500 characters warns and doesn't send");

  // 8. Pelo teclado: o gato é um botão com nome; Enter e Espaço abrem.
  assert.equal(await p.locator(".kn-kiwicat-hit").getAttribute("aria-label"), "Falar com o agente");
  // Chega pelo Tab, não pelo focus(): no WebKit o Tab pula um <button> sem tabIndex (revisão da T10872). Começa sem
  // foco (o começo da página) e anda pelo Tab até o gato.
  await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  let reached = false;
  for (let i = 0; i < 60 && !reached; i++) {
    await p.keyboard.press("Tab");
    reached = await p.evaluate(() => !!document.activeElement?.classList.contains("kn-kiwicat-hit"));
  }
  assert.ok(reached, "Tab reaches the cat");
  await p.keyboard.press("Enter"); await p.waitForSelector(".kn-cat-ask");
  // Dentro do campo, o Tab passa do texto ao "Mandar".
  await p.keyboard.type("oi"); await p.keyboard.press("Tab");
  assert.ok(await p.evaluate(() => !!document.activeElement?.classList.contains("kn-cat-ask-send")), "Tab reaches Mandar");
  await p.locator(".kn-cat-ask-field").fill("");
  await p.keyboard.press("Escape"); await p.waitForSelector(".kn-cat-ask", { state: "detached" });
  // Aberto pelo teclado no gato, o Esc devolve o foco ao gato, para seguir pelo teclado.
  assert.ok(await p.evaluate(() => document.activeElement?.classList.contains("kn-kiwicat-hit")));
  await p.keyboard.press("Space"); await p.waitForSelector(".kn-cat-ask");
  await p.keyboard.press("Escape");
  report.checks.push("keyboard: Tab reaches the named cat button and Mandar; Enter and Space open");

  report.page = w.report; assert.deepEqual(w.report.problems, []);
  await w.close();
} finally {
  await browser.close(); await cli(["stop"]); registry.stop();
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
  rmSync(data, { recursive: true, force: true });
}
console.log(JSON.stringify(report));

