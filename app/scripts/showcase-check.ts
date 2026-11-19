// A tela do que o Kiwi faz (T20838, spec #20828): com o `firstRun` pending, depois do Vamos lá da boas-vindas (T20795); os 4 exemplos passam
// sozinhos, os pontos pulam entre eles, e o Continuar e o Pular seguem para o passo das permissões (T20796). Com
// Reduzir movimento, o exemplo fica parado no resultado. No hub de verdade, com o AppEngine headless, num WebKit
// headless: grava o vídeo e tira os prints. Nada chama o agente nem aparece na tela de ninguém.
//
//   bun scripts/showcase-check.ts [pasta]
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";
import { EXAMPLES, exampleMs } from "../ui/hub/onboarding/showcaseText.ts";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T20838-showcase"));
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-showcase-"));
writeFileSync(join(data, "settings.json"), JSON.stringify({ version: 1, firstRun: "pending" }));
const FAKE = { permissions: { inputMonitoring: "undetermined", accessibility: "undetermined" }, model: { state: "loading", phase: "downloading", fraction: 0.2 } };

async function cli(args: string[]) {
  const p = Bun.spawn([process.execPath, join(app, "scripts/cli.ts"), ...args, "--data", data], {
    cwd: app, stdout: "pipe", stderr: "pipe", env: { ...process.env, KIWI_FAKE_SETUP: JSON.stringify(FAKE) },
  });
  const text = await new Response(p.stdout).text();
  assert.equal(await p.exited, 0, text + (await new Response(p.stderr).text()));
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
const IDS = ["organizar", "documento", "reuniao", "achar"];
const base = { window: "hub", scale: 2, width: 900, height: 820, browser: "webkit", query: {} } as const;
/** A boas-vindas do Kiwi Cat vem antes: o Vamos lá leva a esta tela. */
const pastWelcome = (p: import("playwright-core").Page) => p.getByRole("button", { name: "Vamos lá", exact: true }).click({ timeout: 15000 });

const browser = await webkit.launch({ headless: true });
try {
  await cli(["start", "--no-helper"]);

  // 1. Com movimento: os 4 exemplos passam sozinhos, um print de cada no resultado, e o vídeo da volta inteira.
  const video = join(out, "video");
  const h = await openWindow(browser, ctx, { ...base, theme: "dark", motion: true, video });
  const p = h.page;
  await pastWelcome(p);
  await p.waitForSelector(".kn-show", { timeout: 15000 });
  for (const [i, id] of IDS.entries()) {
    await p.waitForSelector(`.kn-show-stage[data-example="${id}"][data-phase="resultado"]`, { timeout: 15000 });
    await Bun.sleep(700);
    await p.screenshot({ path: join(out, `${i + 1}-${id}.png`) });
  }
  // Depois do último, volta ao primeiro, sozinho.
  await p.waitForSelector('.kn-show-stage[data-example="organizar"]', { timeout: 15000 });
  // O ponto leva direto ao exemplo, e o Continuar segue para o passo das permissões.
  await p.locator(".kn-show-dots button").nth(3).click();
  await p.waitForSelector('.kn-show-stage[data-example="achar"]', { timeout: 2000 });
  assert.equal(await p.locator('.kn-show-dots button[aria-current="step"]').getAttribute("aria-label"), "Exemplo 4 de 4: Achar e lembrar");
  await Bun.sleep(1500);
  await p.getByRole("button", { name: "Continuar" }).click();
  await p.waitForSelector(".kn-setup", { timeout: 5000 });
  await p.waitForSelector(".kn-show", { state: "detached", timeout: 2000 });
  await Bun.sleep(800);
  const v = p.video();
  await h.close();
  renameSync(await v!.path(), join(out, "o-que-o-kiwi-faz.webm"));

  // 2. Reduzir movimento: parado no resultado, nada anda sozinho; o ponto troca o exemplo; o Pular segue para o passo.
  const r = await openWindow(browser, ctx, { ...base, theme: "light", motion: false });
  const q = r.page;
  await pastWelcome(q);
  await q.waitForSelector('.kn-show[data-motion="reduced"] .kn-show-stage[data-example="organizar"][data-phase="resultado"]', { timeout: 15000 });
  // Mais que o exemplo mais longo: com o relógio andando, o exemplo já teria trocado (revisão da T20838).
  await Bun.sleep(Math.max(...EXAMPLES.map(exampleMs)) + 1000);
  assert.equal(await q.locator(".kn-show-stage").getAttribute("data-example"), "organizar", "com Reduzir movimento, o exemplo não troca sozinho");
  await q.locator(".kn-show-dots button").nth(1).click();
  await q.waitForSelector('.kn-show-stage[data-example="documento"][data-phase="resultado"]', { timeout: 2000 });
  await Bun.sleep(500);
  await q.screenshot({ path: join(out, "parado-documento.png") });
  await q.getByRole("button", { name: "Pular" }).click();
  await q.waitForSelector(".kn-setup", { timeout: 5000 });
  await r.close();
  console.log(`ok: ${out}`);
} finally {
  await browser.close();
  await cli(["stop"]).catch(() => {});
}
