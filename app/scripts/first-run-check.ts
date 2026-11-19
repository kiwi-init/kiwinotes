// O passo da primeira abertura (T20796, spec #20780): com o `firstRun` pending, o hub mostra as duas permissões, cada
// uma com o botão dela, e o modelo de voz baixando; o botão marca a permissão (helper de mentira), e o Continuar grava
// `done` e tira o passo. No hub de verdade, com o AppEngine headless e o `KIWI_FAKE_SETUP`, num WebKit headless.
// Nada pede ao macOS e nada aparece na tela de ninguém.
//
//   bun scripts/first-run-check.ts [pasta]
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T20796-first-run"));
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-first-run-"));
// Uma instalação nova: o app grava isto na abertura (o headless não, para os outros roteiros seguirem como antes).
writeFileSync(join(data, "settings.json"), JSON.stringify({ version: 1, firstRun: "pending" }));
const FAKE = { permissions: { inputMonitoring: "undetermined", accessibility: "denied" }, model: { state: "loading", phase: "downloading", fraction: 0.42 } };

async function cli(args: string[]) {
  const p = Bun.spawn([process.execPath, join(app, "scripts/cli.ts"), ...args, "--data", data], {
    cwd: app, stdout: "pipe", stderr: "pipe", env: { ...process.env, KIWI_FAKE_SETUP: JSON.stringify(FAKE) },
  });
  const text = await new Response(p.stdout).text();
  assert.equal(await p.exited, 0, text + (await new Response(p.stderr).text()));
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

const browser = await webkit.launch({ headless: true });
try {
  await cli(["start", "--no-helper"]);
  assert.equal((await invoke("setup.status")).firstRun, "pending");
  for (const theme of ["dark", "light"] as const) {
    const h = await openWindow(browser, ctx, { window: "hub", scale: 2, theme, width: 900, height: 760, motion: false, browser: "webkit", query: {} });
    const p = h.page;
    // Antes, a boas-vindas do Kiwi Cat (T20795): o Agora não vai direto a este passo.
    await p.locator(".kn-welcome-actions button", { hasText: "Agora não" }).click({ timeout: 15000 });
    await p.waitForSelector(".kn-setup", { timeout: 15000 });
    await p.waitForFunction(() => document.querySelector(".kn-setup-line")?.textContent?.startsWith("Baixando: 42%"), undefined, { timeout: 15000 });
    assert.equal(await p.locator('.kn-setup-row[data-permission="inputMonitoring"] button').textContent(), "Permitir");
    assert.equal(await p.locator('.kn-setup-row[data-permission="accessibility"] button').textContent(), "Abrir os Ajustes");
    assert.equal(await p.locator(".kn-onb-actions button").textContent(), "Continuar sem permitir");
    await Bun.sleep(300);
    await p.screenshot({ path: join(out, `primeira-abertura-${theme}.png`) });
    if (theme === "light") {
      // O botão da Acessibilidade: o helper de mentira marca como dada, e a linha vira "Permitido".
      await p.locator('.kn-setup-row[data-permission="accessibility"] button').click();
      await p.waitForSelector('.kn-setup-row[data-permission="accessibility"] .kn-setup-ok', { timeout: 5000 });
      await p.screenshot({ path: join(out, "primeira-abertura-uma-dada.png") });
      // O Continuar grava o done, e o passo sai do hub.
      await p.locator(".kn-onb-actions button").click();
      await p.waitForSelector(".kn-setup", { state: "detached", timeout: 5000 });
      assert.equal((await invoke("setup.status")).firstRun, "done");
      assert.equal((await invoke("settings.get")).firstRun, "done");
    }
    await h.close();
  }
  console.log(`ok: ${out}`);
} finally {
  await browser.close();
  await cli(["stop"]).catch(() => {});
}
