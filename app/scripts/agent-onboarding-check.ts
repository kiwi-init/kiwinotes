// O onboarding do agente (spec #11955): ligar o agente pela primeira vez abre os passos por cima do hub, o passo 1
// confere o Claude Code, baixa a ponte e manda um oi (agente falso), os passos andam com Continuar e Pular até o
// cartão final, fechar no meio termina com o que já foi escolhido, e "Refazer o onboarding" em Ajustes abre de novo.
// No hub de verdade, com o AppEngine headless, o agente falso e o helper falso, num WebKit headless. Nada na tela de
// ninguém.
//
//   bun scripts/agent-onboarding-check.ts [pasta]
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Page } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";
import { fakeRegistry } from "../src/agent/fake/registry";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T11955-onboarding"));
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-onboarding-"));
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
const onboarding = async () => (await invoke("agent.status")).onboarding as { state: string; step: number };
const stepIs = (p: Page, n: number) => p.waitForFunction((n) => document.querySelector(".kn-onb-progress")?.textContent === `Passo ${n} de 9`, n, { timeout: 15000 });
const shot = async (p: Page, file: string) => {
  await Bun.sleep(400);
  await p.screenshot({ path: join(out, file) });
};

const browser = await webkit.launch({ headless: true });
const report: { checks: string[]; problems: string[] } = { checks: [], problems: [] };
try {
  await cli(["start", "--no-helper"]);
  await invoke("notes.create", { folder: "Kiwi", title: "Kiwi", content: "# Kiwi\n" });
  await invoke("projects.mark", { folder: "Kiwi" });
  await invoke("notes.create", { folder: "Clientes", title: "Acme", content: "# Acme\n" });
  assert.deepEqual(await onboarding(), { state: "pending", step: 1 });

  for (const theme of ["light", "dark"] as const) {
    if (theme === "dark") await invoke("agent.configure", { onboarding: { state: "open", step: 1 } });
    const h = await openWindow(browser, ctx, { window: "hub", scale: 2, theme, width: 900, height: 760, motion: true, browser: "webkit", query: { section: "settings", topic: "agent" }, ...(theme === "light" ? { video: out } : {}) });
    const p = h.page;
    if (theme === "light") {
      // 1. Ligar o agente pela primeira vez abre o onboarding, por cima do hub, sem o gato do canto.
      await Bun.sleep(600);
      assert.equal(await p.locator(".kn-onb").count(), 0, "antes de ligar, nada de onboarding");
      await invoke("agent.enable", { consent: true });
    }
    await p.waitForSelector(".kn-onb", { timeout: 15000 });
    await stepIs(p, 1);
    assert.equal(await p.locator(".kn-kiwicat").count(), 0, "um gato só: o do canto some");
    await p.waitForSelector('.kn-onb-cat[data-ready="true"]', { timeout: 15000 });
    if (theme === "light") {
      // O passo 1 segura até o Claude Code servir e a ponte estar baixada.
      assert.equal(await p.locator(".kn-onb-actions button:has-text('Continuar')").isDisabled(), true);
      // O Pular vale sempre, também no passo 1 (revisão do T11993); o foco está no título do passo.
      assert.equal(await p.locator(".kn-onb-actions button:has-text('Pular')").isDisabled(), false);
      assert.equal(await p.evaluate(() => document.activeElement?.id), "kn-onb-title");
      await shot(p, "1-claude-antes-light.png");
      await p.locator(".kn-onb-check button:has-text('Baixar')").click();
      await p.waitForFunction(() => !document.querySelector(".kn-onb-actions button:last-child")?.hasAttribute("disabled"), undefined, { timeout: 30000 });
      await p.locator(".kn-onb-check button:has-text('Mandar um oi')").click();
      await p.waitForSelector(".kn-onb-answer, .kn-onb-failure", { timeout: 30000 }).catch(async (e) => {
        await p.screenshot({ path: join(out, "debug.png") });
        throw e;
      });
      if (await p.locator(".kn-onb-failure").count()) {
        await p.screenshot({ path: join(out, "debug.png") });
        throw new Error(`o oi falhou: ${await p.locator(".kn-onb-failure").first().textContent()}`);
      }
      await Bun.sleep(1200);
      report.checks.push("first enable opens the onboarding over the hub, with one cat; step 1 checks Claude Code, downloads the adapter and sends a hello (fake agent)");
    }
    await shot(p, `1-claude-${theme}.png`);
    if (theme === "light") {
      // Continuar e Pular andam; o passo fica guardado.
      await p.locator(".kn-onb-actions button:has-text('Continuar')").click();
      await stepIs(p, 2);
      await p.locator(".kn-onb-actions button:has-text('Pular')").click();
      await stepIs(p, 3);
      assert.deepEqual(await onboarding(), { state: "open", step: 3 });
      await p.locator(".kn-onb-actions button:has-text('Voltar')").click();
      await stepIs(p, 2);
      const asked = (await invoke("agent.activity")).requests.length;
      // Passo 2 (T12002): a linha do Control de Ajustes liga o atalho, e a frase pede para segurar o Control.
      // O hub atrás fica inerte (fora do Tab, do clique e do VoiceOver) enquanto o onboarding está aberto.
      assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll<HTMLElement>(".kn-hub-top, .kn-hub-main")].map((el) => el.inert)), [true, true]);
      await p.getByRole("dialog").getByRole("switch", { name: "Falar com o agente pelo Control" }).click();
      await p.waitForSelector(".kn-onb-try kbd", { timeout: 15000 });
      assert.equal((await invoke("agent.status")).controlShortcut, true);
      await shot(p, "2-control-light.png");
      await p.locator(".kn-onb-actions button:has-text('Continuar')").click();
      await stepIs(p, 3);
      // Passo 3: o jeito de falar vira a linha das instruções, e o exemplo muda na hora, sem pedido.
      const before = await p.locator(".kn-onb-tone .kn-onb-answer").textContent();
      await p.getByRole("dialog").getByRole("radio", { name: "Detalhado", exact: true }).click();
      await p.getByRole("dialog").getByRole("radio", { name: "Formal", exact: true }).click();
      await p.waitForFunction((b) => document.querySelector(".kn-onb-tone .kn-onb-answer")?.textContent !== b, before, { timeout: 15000 });
      for (let i = 0; !(await invoke("agent.status")).instructions.includes("tom formal"); i++) { assert.ok(i < 50, "o jeito vai para as instruções"); await Bun.sleep(100); }
      assert.match((await invoke("agent.status")).instructions, /^Jeito de falar: respostas detalhadas, explicando o porquê; tom formal\.$/);
      await shot(p, "3-jeito-light.png");
      await p.locator(".kn-onb-actions button:has-text('Continuar')").click();
      await stepIs(p, 4);
      // Passo 4: o segredo vira o marcador na hora, pelo filtro local.
      assert.match((await invoke("agent.guardPreview", { text: "a senha do servidor é abc123" })).text, /‹segredo 1/);
      await p.waitForSelector(".kn-onb-marker", { timeout: 15000 }).catch(async (e) => {
        await p.screenshot({ path: join(out, "debug.png") });
        console.log(JSON.stringify(h.report.invokeErrors));
        throw e;
      });
      assert.match((await p.locator(".kn-onb-seen").textContent()) ?? "", /^a senha do servidor é ‹segredo 1 · [a-z0-9]{4}›$/);
      await p.locator("#kn-onb-guard-input").fill("o token do CI é ghp_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8, guarde");
      await p.waitForFunction(() => /token do CI é ‹segredo 1/.test(document.querySelector(".kn-onb-seen")?.textContent ?? ""), undefined, { timeout: 15000 });
      await shot(p, "4-guardrail-light.png");
      // Nenhum dos três falou com o agente.
      assert.equal((await invoke("agent.activity")).requests.length, asked, "os passos 2 a 4 não mandam pedido");
      report.checks.push("steps 2-4 (T12002): the Control row turns the shortcut on; the tone becomes the instructions line and the example changes live; the guardrail shows the marker from the local filter; none of them sends a request");
      await p.locator(".kn-onb-actions button:has-text('Continuar')").click();
      await stepIs(p, 5);
      // Passo 5 (T11999): o editor do Modelo de Ajustes, como está.
      await p.waitForSelector(".kn-onb-model .kn-nm-lines", { timeout: 15000 });
      await shot(p, "5-modelo-light.png");
      await p.locator(".kn-onb-actions button:has-text('Continuar')").click();
      await stepIs(p, 6);
      // Passo 6: as pastas de primeiro nível; a que já é projeto vem marcada, e marcar outra a faz projeto.
      await p.waitForSelector(".kn-onb-folder", { timeout: 15000 });
      const names = await p.locator(".kn-onb-folder span").allTextContents();
      assert.deepEqual(names, ["Clientes", "Kiwi"]);
      assert.equal(await p.locator(".kn-onb-folder:has-text('Kiwi') input").isChecked(), true);
      await p.locator(".kn-onb-folder:has-text('Clientes') input").click();
      for (let i = 0; !(await invoke("projects.list")).projects.some((x: { folder: string }) => x.folder === "Clientes"); i++) { assert.ok(i < 50, "Clientes vira projeto"); await Bun.sleep(100); }
      await shot(p, "6-projetos-light.png");
      await p.locator(".kn-onb-actions button:has-text('Continuar')").click();
      await stepIs(p, 7);
      // Passo 7: as amostras de Ajustes, com a do agente marcada; trocar muda o gato grande na hora.
      const swatch = p.getByRole("dialog").getByRole("radio", { name: "A do agente" });
      assert.equal(await swatch.getAttribute("aria-checked"), "true");
      assert.equal(await p.locator(".kn-onb-color .kn-cat-color canvas, .kn-onb-color .kn-cat-preview").count(), 0, "sem o gatinho da linha: um gato só");
      await p.getByRole("dialog").getByRole("radio", { name: "Verde" }).click();
      for (let i = 0; (await invoke("settings.get")).kiwicat.cor !== "verde"; i++) { assert.ok(i < 50, "a cor vai para os ajustes"); await Bun.sleep(100); }
      await shot(p, "7-cor-light.png");
      assert.equal((await invoke("agent.activity")).requests.length, asked, "os passos 2 a 7 não mandam pedido");
      report.checks.push("steps 5-7 (T11999): the Template editor from Settings; the top-level folders with the marked project checked, and checking another marks it; the colour swatches with the agent's colour selected, and picking one changes the setting; none of them sends a request");
      await p.locator(".kn-onb-actions button:has-text('Continuar')").click();
      await stepIs(p, 8);
      // Passo 8 (T12001): só com o clique da pessoa, o agente organiza UMA nota no Modelo; o antes e o depois, e o
      // [Desfazer] volta a nota. É o único pedido do onboarding.
      await invoke("notes.save", { path: "Kiwi/Kiwi.md", content: "# Kiwi\n\nprazo em abril\nfalta o onboarding\n", baseVersion: (await invoke("notes.get", { path: "Kiwi/Kiwi.md" })).version });
      const original = (await invoke("notes.get", { path: "Kiwi/Kiwi.md" })).content;
      await p.waitForSelector(".kn-onb-magic select", { timeout: 15000 });
      assert.equal(await p.locator(".kn-onb-magic select").inputValue(), "Kiwi/Kiwi.md", "a nota principal de um projeto vem escolhida");
      assert.match((await p.locator(".kn-onb-magic .kn-onb-status").first().textContent()) ?? "", /gasta do seu plano/);
      await Bun.sleep(600);
      assert.equal((await invoke("agent.activity")).requests.length, asked, "nada antes do clique");
      await shot(p, "8-magico-antes-light.png");
      await p.locator(".kn-onb-magic button:has-text('Organizar esta nota')").click();
      await p.waitForSelector(".kn-onb-diff .kn-diff", { timeout: 30000 });
      assert.equal((await invoke("agent.activity")).requests.length, asked + 1, "um pedido só, o do passo 8");
      assert.notEqual((await invoke("notes.get", { path: "Kiwi/Kiwi.md" })).content, original);
      await shot(p, "8-magico-light.png");
      await p.locator(".kn-onb-magic button:has-text('Desfazer')").click();
      await p.waitForSelector(".kn-onb-magic:has-text('voltou como estava')", { timeout: 15000 });
      assert.equal((await invoke("notes.get", { path: "Kiwi/Kiwi.md" })).content, original, "o [Desfazer] volta a nota");
      report.checks.push("step 8 (T12001): only after the person's click, the agent organizes one note (the only request of the onboarding); before and after are shown, and [Desfazer] restores the note");
      await p.locator(".kn-onb-actions button:has-text('Continuar')").click();
      await stepIs(p, 9);
      report.checks.push("Continuar, Pular and Voltar move through the 9 steps in order; the step is saved in the agent settings");
    } else {
      await invoke("agent.configure", { onboarding: { step: 9 } });
      await stepIs(p, 9);
    }
    await p.waitForSelector(theme === "light" ? ".kn-onb-card dd:has-text('Clientes'):has-text('Kiwi')" : ".kn-onb-card dd:has-text('Kiwi')", { timeout: 15000 });
    if (theme === "light") assert.equal(await p.locator(".kn-onb-card dd").first().textContent(), "Verde");
    await shot(p, `9-pronto-${theme}.png`);
    await p.locator(".kn-onb-actions button:has-text('Pronto')").click();
    await p.waitForSelector(".kn-onb", { state: "detached", timeout: 15000 });
    assert.equal((await onboarding()).state, "done");
    if (theme === "light") {
      report.checks.push("the final card shows the colour, the tone, the projects and the shortcut; Pronto ends it");
      // 2. "Refazer o onboarding" em Ajustes abre de novo, do passo 1; fechar no meio termina com o que foi escolhido.
      await p.locator("button:has-text('Refazer o onboarding')").click();
      await p.waitForSelector(".kn-onb", { timeout: 15000 });
      await stepIs(p, 1);
      await p.locator(".kn-onb-actions button:has-text('Pular')").click();
      await stepIs(p, 2);
      // O Esc fecha, como o ×.
      await p.keyboard.press("Escape");
      await p.waitForSelector(".kn-onb", { state: "detached", timeout: 15000 });
      assert.deepEqual(await onboarding(), { state: "done", step: 2 });
      // Desligar e ligar de novo não abre outra vez.
      await invoke("agent.disable");
      await invoke("agent.enable");
      await Bun.sleep(800);
      assert.equal(await p.locator(".kn-onb").count(), 0);
      report.checks.push("Refazer o onboarding in Settings opens it again at step 1; closing midway ends it; enabling again does not reopen it");
    }
    report.problems.push(...h.report.problems);
    await h.close();
  }
  assert.deepEqual(report.problems, []);
  console.log(JSON.stringify({ ok: true, ...report }, null, 2));
} finally {
  await browser.close().catch(() => {});
  await cli(["stop"]).catch(() => {});
  registry.stop();
  rmSync(data, { recursive: true, force: true });
}
