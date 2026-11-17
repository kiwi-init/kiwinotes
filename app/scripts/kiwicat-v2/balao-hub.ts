// O print do balão no hub com o gato (T15095, spec #14896, pedido na revisão da T14933): o hub de verdade, o AppEngine
// headless e o agente falso (`/conta`, o texto palavra por palavra), num WebKit headless; nada nativo, nada na tela. Sai
// o canto do gato com o balão da resposta, o curto e o grande (3 linhas), no tema escuro e no claro (o balão fica
// escuro nos dois, #14908). Só prints: o número é o do `balao-igual.ts`.
//
// Da raiz do app: `bun scripts/kiwicat-v2/balao-hub.ts [--out PASTA]`.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit } from "playwright-core";
import { connect, request } from "../cli";
import { openWindow, type UiContext } from "../ui-page";
import { fakeRegistry } from "../../src/agent/fake/registry";

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const app = resolve(import.meta.dir, "../..");
const out = resolve(opt("--out") ?? join(tmpdir(), "kiwicat-v2-balao-hub"));
mkdirSync(out, { recursive: true });

// Os mesmos textos inventados do balao-igual.ts.
const CURTO = "Achei 3 notas sobre o Projeto X.";
const GRANDE = "Li as notas da Ana sobre o Projeto X: a reunião de terça ficou para quinta e o orçamento passou. Quer um resumo?";

const data = mkdtempSync(join(tmpdir(), "kiwi-balao-hub-"));
const registry = fakeRegistry([
  { name: "@agentclientprotocol/claude-agent-acp", version: "0.106.0", files: { "dist/index.js": "" } },
  { name: "zod", version: "4.6.7", files: { "index.js": "" } },
]);
const packages = join(data, "packages.json");
writeFileSync(packages, JSON.stringify(registry.pinned));
async function cli(argv: string[]) {
  const p = Bun.spawn([process.execPath, join(app, "scripts/cli.ts"), ...argv, "--data", data], {
    cwd: app, stdout: "pipe", stderr: "pipe", env: { ...process.env, KIWI_FAKE_AGENT: "1", KIWI_ADAPTER_REGISTRY: registry.url, KIWI_ADAPTER_PACKAGES: packages },
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
async function invoke(cap: string, a: unknown = {}) {
  const r = await ctx.send({ cmd: "invoke", cap, args: a });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.value as any;
}

const browser = await webkit.launch({ headless: true });
const shots: string[] = [];
try {
  await cli(["start", "--no-helper"]);
  await invoke("agent.enable", { consent: true });
  await invoke("agent.download");
  await invoke("agent.configure", { onboarding: { state: "done" } });
  // O gato fica no canto do hub: o do overlay entra quando o hub não está na frente, e o headless nunca está.
  await invoke("settings.set", { kiwicat: { overlay: false } });
  for (let n = 0; (await invoke("agent.status")).adapter.phase !== "ready"; n++) { assert.ok(n < 200); await Bun.sleep(100); }
  for (const theme of ["dark", "light"] as const) {
    const w = await openWindow(browser, ctx, { window: "hub", scale: 2, theme, width: 1000, height: 740, motion: true, browser: "webkit", query: { section: "notes" } });
    const p = w.page;
    await p.waitForSelector('.kn-kiwicat[data-ready="true"]');
    for (const [name, text] of [["curto", CURTO], ["grande", GRANDE]] as const) {
      await invoke("agent.ask", { text: `/conta ${text}` });
      // O balão com o texto inteiro digitado, e a entrada (a mola) no fim.
      await p.waitForFunction((t) => [...document.querySelectorAll(".kn-bubble-typed")].some((e) => e.textContent === t), text, { timeout: 30000 });
      for (let n = 0; (await invoke("agent.status")).busy; n++) { assert.ok(n < 300); await Bun.sleep(100); }
      await p.waitForTimeout(400);
      const cat = (await p.locator(".kn-kiwicat").boundingBox())!;
      const bub = (await p.locator(".kn-bubble-shell.kn-bubble").last().boundingBox())!;
      const x = Math.max(0, Math.min(cat.x, bub.x) - 16), y = Math.max(0, Math.min(cat.y, bub.y) - 16);
      const clip = { x, y, width: Math.min(1000, Math.max(cat.x + cat.width, bub.x + bub.width) + 16) - x, height: Math.min(740, Math.max(cat.y + cat.height, bub.y + bub.height + 28) + 16) - y };
      const file = `hub-${name}-${theme === "dark" ? "escuro" : "claro"}.png`;
      await p.screenshot({ path: join(out, file), clip });
      shots.push(file);
      console.log(`${file}  balão ${Math.round(bub.width)} × ${Math.round(bub.height)}`);
      // Fecha o balão (o clique nele) antes do próximo pedido.
      await p.locator(".kn-bubble-shell.kn-bubble").last().click();
      await p.waitForTimeout(400);
    }
    await w.close();
  }
} finally {
  // A limpeza tem prazo: na 1ª rodada ela travou depois dos prints (o `timeout` de fora matou o script).
  const prazo = <T>(p: Promise<T>) => Promise.race([p, Bun.sleep(10000)]);
  await prazo(browser.close()).catch(() => {});
  await prazo(cli(["stop"])).catch(() => {});
  rmSync(data, { recursive: true, force: true });
}
console.log(`${shots.length} prints em ${out}`);
process.exit(shots.length === 4 ? 0 : 1);
