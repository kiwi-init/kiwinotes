// T20047: o balão do gato abre nas Notas o arquivo de texto sem visualizador próprio (o `Dockerfile`, um `.vue`), com o
// mesmo critério da árvore (T19313); só o binário segue no app padrão. Nunca abre janela, nunca liga o agente de
// verdade: o hub de verdade, no headless com o agente falso (`/diga`).
//
// - o balão cita `Projeto X/Dockerfile` e `Projeto X/Tela.vue`: os dois viram link;
// - o clique no Dockerfile abre o editor dos textos nas Notas, com o conteúdo; o mesmo com o .vue;
// - um binário sem extensão, pelo `notes.openPath`, diz "app" e nada abre nas Notas.
//
// Tudo inventado (spec #17952).
//
//   bun scripts/bubble-text-file-check.ts [pasta]
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Page } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";
import { fakeRegistry } from "../src/agent/fake/registry";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T20047"));
mkdirSync(out, { recursive: true });

const DOCKERFILE = "FROM exemplo:1\nWORKDIR /app\nCOPY . .\nCMD [\"bun\", \"run\", \"start\"]\n";
const VUE = "<template>\n  <p>Olá, Ana</p>\n</template>\n";
const RESPOSTA = "Achei `Projeto X/Dockerfile` e `Projeto X/Tela.vue`.";

const data = mkdtempSync(join(tmpdir(), "kiwi-T20047-"));
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
async function ask(p: Page, text: string) {
  await invoke("agent.ask", { text: `/diga ${text}` });
  await p.waitForSelector(BUBBLE);
  for (let n = 0; ; n++) {
    const now = await p.locator(`${BUBBLE} .kn-bubble-typed`).innerText();
    if (now.includes("Tela.vue.")) break;
    assert.ok(n < 80, "a resposta não terminou de digitar");
    await Bun.sleep(150);
  }
  await Bun.sleep(300);
}
const files = (p: Page) => p.locator(`${BUBBLE} .kn-md-file`).evaluateAll((els) => els.map((e) => [e.textContent, (e as HTMLElement).dataset.path]));
async function openFromBubble(p: Page, path: string, name: string, shot: string, expected: string) {
  await p.locator(`${BUBBLE} .kn-md-file[data-path="${path}"]`).click();
  await p.waitForFunction((n) => document.querySelector(".kn-file-title")?.textContent?.trim() === n, name);
  await p.waitForSelector(".kn-file .cm-content");
  const shown = await p.locator(".kn-file .cm-content").innerText();
  assert.ok(shown.includes(expected), `o conteúdo de ${name} no editor: ${shown}`);
  assert.equal(await p.locator(".kn-file-notice").count(), 0, `${name} não pode cair no "Abrir no app padrão"`);
  await Bun.sleep(300);
  await p.screenshot({ path: join(out, `${shot}.png`) });
}

const browser = await webkit.launch({ headless: true });
const checks: string[] = [];
try {
  // O `files.create` só cria os tipos do Novo arquivo: estes vão direto à pasta, antes de o app subir.
  const pasta = join(data, "vault", "Projeto X");
  mkdirSync(pasta, { recursive: true });
  writeFileSync(join(pasta, "Dockerfile"), DOCKERFILE);
  writeFileSync(join(pasta, "Tela.vue"), VUE);
  writeFileSync(join(pasta, "dados-sem-tipo"), new Uint8Array([0, 1, 2, 255, 0]));
  await cli(["start", "--no-helper"]);
  await invoke("agent.enable", { consent: true });
  await invoke("agent.download");
  await invoke("agent.configure", { onboarding: { state: "done" } });
  await invoke("settings.set", { kiwicat: { overlay: false, show: true } });
  for (let n = 0; (await invoke("agent.status")).adapter.phase !== "ready"; n++) { assert.ok(n < 200); await Bun.sleep(100); }

  const w = await openWindow(browser, ctx, { window: "hub", scale: 2, theme: "light", width: 1000, height: 740, motion: false, browser: "webkit", query: {} });
  const p = w.page;
  try {
    await p.waitForSelector(".kn-hub");
    await ask(p, RESPOSTA);
    assert.deepEqual(await files(p), [["Projeto X/Dockerfile", "Projeto X/Dockerfile"], ["Projeto X/Tela.vue", "Projeto X/Tela.vue"]]);
    await p.screenshot({ path: join(out, "01-balao-com-os-links.png") });
    checks.push("o balão: o Dockerfile (sem extensão, pelo caminho) e o .vue viram link");

    await openFromBubble(p, "Projeto X/Dockerfile", "Dockerfile", "02-dockerfile-nas-notas", "WORKDIR /app");
    checks.push("o clique no Dockerfile abre o editor dos textos nas Notas, com o conteúdo");
    await ask(p, RESPOSTA);
    await openFromBubble(p, "Projeto X/Tela.vue", "Tela.vue", "03-vue-nas-notas", "Olá, Ana");
    checks.push("o clique no .vue abre o editor dos textos nas Notas");

    assert.deepEqual(await invoke("notes.openPath", { path: "Projeto X/dados-sem-tipo" }), { opened: "app" });
    assert.deepEqual(await invoke("notes.openPath", { path: "Projeto X/Dockerfile" }), { opened: "viewer" });
    checks.push("o binário sem extensão segue no app padrão (opened: app); o Dockerfile diz viewer");
    assert.deepEqual(w.report.problems, [], "problemas na página");
  } finally {
    await w.close();
  }

  for (const f of ["01-balao-com-os-links", "02-dockerfile-nas-notas", "03-vue-nas-notas"]) {
    spawnSync("cwebp", ["-quiet", "-q", "85", join(out, `${f}.png`), "-o", join(out, `${f}.webp`)]);
  }
  for (const c of checks) console.log(`ok  ${c}`);
  console.log(`os prints em ${out}`);
} finally {
  await browser.close();
  await cli(["stop"]).catch(() => {});
  registry.stop();
}
