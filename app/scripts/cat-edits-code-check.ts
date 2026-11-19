// T21237 (spec #21158): o print do balão do gato depois de editar um .py. O hub de verdade, no headless com o agente
// falso (`/tool notes_edit`), sem janela na tela e sem o agente de verdade. Tudo inventado (spec #17952).
//
//   bun scripts/cat-edits-code-check.ts [pasta]
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Page } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";
import { fakeRegistry } from "../src/agent/fake/registry";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T21237"));
mkdirSync(out, { recursive: true });

const PY = "# o estoque da loja\ndef total(itens):\n    return sum(i.qtd for i in itens)\n\nPRECO_CAFE = 12\n";
const PEDIDO = [
  "Subi o preço do café em `Loja/estoque.py`.",
  `/tool notes_edit ${JSON.stringify({ path: "Loja/estoque.py", old: "PRECO_CAFE = 12", text: "PRECO_CAFE = 14" })}`,
].join("\n");

const data = mkdtempSync(join(tmpdir(), "kiwi-T21237-"));
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
  const err = await new Response(p.stderr).text();
  assert.equal(await p.exited, 0, text + err);
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

const BUBBLE = ".kn-bubble-slot:not([data-phase='exit']) .kn-bubble";

const browser = await webkit.launch({ headless: true });
const checks: string[] = [];
try {
  const pasta = join(data, "vault", "Loja");
  mkdirSync(pasta, { recursive: true });
  writeFileSync(join(pasta, "estoque.py"), PY);
  await cli(["start", "--no-helper"]);
  await invoke("agent.enable", { consent: true });
  await invoke("agent.download");
  await invoke("agent.configure", { onboarding: { state: "done" } });
  await invoke("settings.set", { kiwicat: { overlay: false, show: true } });
  for (let n = 0; (await invoke("agent.status")).adapter.phase !== "ready"; n++) { assert.ok(n < 200); await Bun.sleep(100); }

  const w = await openWindow(browser, ctx, { window: "hub", scale: 2, theme: "light", width: 1000, height: 740, motion: false, browser: "webkit", query: {} });
  const p: Page = w.page;
  try {
    await p.waitForSelector(".kn-hub");
    await invoke("agent.ask", { text: PEDIDO });
    await p.waitForSelector(BUBBLE);
    for (let n = 0; readFileSync(join(pasta, "estoque.py"), "utf8") === PY; n++) { assert.ok(n < 100, "o gato não gravou o .py"); await Bun.sleep(100); }
    assert.equal(readFileSync(join(pasta, "estoque.py"), "utf8"), PY.replace("12", "14"));
    checks.push("o agente falso trocou PRECO_CAFE = 12 por 14 no .py, e o resto ficou igual");
    for (let n = 0; ; n++) {
      const txt = await p.locator(BUBBLE).innerText();
      if (/estoque\.py/.test(txt) && !(await p.locator(`${BUBBLE} .kn-bubble-typed`).count() && /\u2026$/.test(txt))) break;
      assert.ok(n < 80, "o balão não terminou");
      await Bun.sleep(150);
    }
    await Bun.sleep(1500);
    await p.screenshot({ path: join(out, "gato-editou-py.png") });
    checks.push("o balão diz o que mudou no .py, com o link para o arquivo");
    await p.locator(`${BUBBLE} .kn-md-file[data-path="Loja/estoque.py"]`).click();
    await p.waitForFunction(() => document.querySelector(".kn-file-title")?.textContent?.trim() === "estoque.py");
    await p.waitForSelector(".kn-file .cm-content");
    const shown = await p.locator(".kn-file .cm-content").innerText();
    assert.ok(shown.includes("PRECO_CAFE = 14"), `o editor mostra: ${shown}`);
    await Bun.sleep(400);
    await p.screenshot({ path: join(out, "py-nas-notas.png") });
    checks.push("o link abre o .py nas Notas, já com PRECO_CAFE = 14");
    assert.deepEqual(w.report.problems, [], "problemas na página");
  } finally {
    await w.close();
  }
  for (const f of ["gato-editou-py", "py-nas-notas"]) spawnSync("cwebp", ["-quiet", "-q", "85", join(out, `${f}.png`), "-o", join(out, `${f}.webp`)]);
  for (const c of checks) console.log(`ok  ${c}`);
  console.log(`o print em ${out}`);
} finally {
  await browser.close();
  await cli(["stop"]).catch(() => {});
  registry.stop();
}
