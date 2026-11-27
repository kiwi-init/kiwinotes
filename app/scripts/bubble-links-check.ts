// T18128 (spec #17683): a nota e o arquivo que a resposta do agente cita viram link nos dois balões do gato, e o clique
// abre. Nunca abre janela, nunca liga o agente de verdade:
//
// - o hub de verdade, no headless com o agente falso (`/diga`): o balão pequeno com a nota e o pdf como link; o clique
//   no pdf leva às Notas, no visualizador; uma resposta longa, o "Ver mais" com o balão grande, e o clique na nota a
//   abre no editor;
// - a página do overlay de verdade (dist/catoverlay), com o que o helper manda (`bubble.links`): o balão aberto com os
//   links, e o clique manda `{openPath}` ao helper; um `kiwi-file:` que a resposta escreveu sozinha fica texto.
//
// Tudo inventado: a nota "Plano", na pasta "Viagem", e o pdf "Anexos/bilhete.pdf".
//
//   bun scripts/bubble-links-check.ts [pasta]
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Page } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";
import { fakeRegistry } from "../src/agent/fake/registry";
import { overlayPlacement } from "../ui/catoverlay/placement";
import type { BubbleLink } from "../src/shared/ui-contract";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T18128-links"));
mkdirSync(out, { recursive: true });

const CURTA = "Criei [[Plano]] e guardei `Anexos/bilhete.pdf`.";
const LONGA = [
  "## A viagem",
  "",
  "Criei [[Plano]] na pasta Viagem, com o roteiro dos três dias e os horários da **Ana**.",
  "",
  "- [x] o bilhete, em `Anexos/bilhete.pdf`",
  "- [ ] a lista do que levar",
  "- [ ] os lugares para comer perto do hotel",
  "",
  "A previsão do tempo de cada dia está no fim da nota.",
].join("\n");

/** Um pdf de verdade, de uma página, para o visualizador abrir: "Bilhete de exemplo". */
function tinyPdf(): string {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = "BT /F1 28 Tf 40 100 Td (Bilhete de exemplo) Tj ET";
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let pdf = "%PDF-1.4\n";
  const at: number[] = [];
  objs.forEach((o, i) => { at.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${at.map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1").toString("base64");
}

const data = mkdtempSync(join(tmpdir(), "kiwi-links-"));
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
/** Pede ao agente falso e espera o balão pequeno parar de digitar. */
async function ask(p: Page, text: string) {
  await invoke("agent.ask", { text: `/diga ${text}` });
  await p.waitForSelector(BUBBLE);
  await p.waitForFunction(() => document.querySelector<HTMLElement>(".kn-kiwicat")?.dataset.state !== "agindo");
  for (let last = "", n = 0; ; n++) {
    const now = await p.locator(`${BUBBLE} .kn-bubble-typed`).innerText();
    if (now === last && now.length > 0) break;
    assert.ok(n < 80, "a resposta não parou de digitar");
    last = now;
    await Bun.sleep(150);
  }
}
const files = (p: Page, sel: string) => p.locator(`${sel} .kn-md-file`).evaluateAll((els) => els.map((e) => [e.textContent, (e as HTMLElement).dataset.path, e.hasAttribute("href")]));

const browser = await webkit.launch({ headless: true });
const checks: string[] = [];
let server: ReturnType<typeof Bun.serve> | undefined;
try {
  await cli(["start", "--no-helper"]);
  await invoke("notes.create", { folder: "Viagem", title: "Plano", content: "# Plano\n\nO roteiro dos três dias.\n" });
  await invoke("attachments.save", { name: "bilhete.pdf", data: tinyPdf() });
  await invoke("agent.enable", { consent: true });
  await invoke("agent.download");
  await invoke("agent.configure", { onboarding: { state: "done" } });
  await invoke("settings.set", { kiwicat: { overlay: false, show: true } });
  for (let n = 0; (await invoke("agent.status")).adapter.phase !== "ready"; n++) { assert.ok(n < 200); await Bun.sleep(100); }

  const w = await openWindow(browser, ctx, { window: "hub", scale: 2, theme: "light", width: 1000, height: 740, motion: false, browser: "webkit", query: {} });
  const p = w.page;
  try {
    await p.waitForSelector(".kn-hub");
    // ---- O balão pequeno: a nota e o pdf como link; o clique no pdf leva ao visualizador. ----
    await ask(p, CURTA);
    assert.deepEqual(await files(p, BUBBLE), [["Plano", "Viagem/Plano.md", false], ["Anexos/bilhete.pdf", "Anexos/bilhete.pdf", false]]);
    await p.screenshot({ path: join(out, "01-balao-pequeno.png") });
    await p.locator(`${BUBBLE} .kn-md-file[data-path="Anexos/bilhete.pdf"]`).click();
    await p.waitForSelector(".kn-file");
    assert.equal((await p.locator(".kn-file-title").innerText()).trim(), "bilhete.pdf");
    await p.waitForSelector(".kn-file-pdf-canvas");
    await Bun.sleep(300); // a página termina de desenhar
    await p.screenshot({ path: join(out, "02-pdf-no-visualizador.png") });
    checks.push("balão pequeno: a nota e o pdf viram link (data-path, sem href); o clique no pdf abre o visualizador nas Notas");

    // ---- O balão grande: o "Ver mais", os links no markdown, e o clique na nota abre o editor. ----
    await ask(p, LONGA);
    for (let n = 0; !(await p.locator(`${BUBBLE} .kn-bubble-more`).count()); n++) {
      assert.ok(n < 80, "o Ver mais não apareceu");
      await Bun.sleep(150);
    }
    await p.locator(`${BUBBLE} .kn-bubble-more`).click();
    await p.waitForSelector(".kn-bubble-big .kn-md-file");
    assert.deepEqual(await files(p, ".kn-bubble-big"), [["Plano", "Viagem/Plano.md", false], ["Anexos/bilhete.pdf", "Anexos/bilhete.pdf", false]]);
    await p.screenshot({ path: join(out, "03-balao-grande.png") });
    await p.locator('.kn-bubble-big .kn-md-file[data-path="Viagem/Plano.md"]').click();
    await p.waitForSelector(".kn-note-editor");
    assert.equal(await p.locator(".kn-file").count(), 0);
    await p.screenshot({ path: join(out, "04-nota-no-editor.png") });
    checks.push("balão grande: o markdown com a nota e o pdf como link; o clique na nota a abre no editor");
    assert.deepEqual(w.report.problems, [], "problemas na página");
  } finally {
    await w.close();
  }

  // ---- O overlay: a página de verdade, com os links que o helper manda. ----
  const page = join(app, "dist", "catoverlay");
  const build = spawnSync("bun", ["x", "vite", "build"], { cwd: app, stdio: "ignore", env: { ...process.env, KIWI_UI_WINDOW: "catoverlay" } });
  assert.ok(build.status === 0 && existsSync(join(page, "index.html")), "o build da página catoverlay");
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(r) {
      const file = Bun.file(join(page, new URL(r.url).pathname.replace(/^\/$/, "/index.html")));
      return (await file.exists()) ? new Response(file) : new Response("", { status: 404 });
    },
  });
  const texto = `${LONGA}\n\nVeja também [isto](kiwi-file:Viagem/Plano.md).`;
  const at = (t: string, path: string, kind: BubbleLink["kind"]): BubbleLink => {
    const from = texto.indexOf(t);
    return { text: t, from, to: from + t.length, path, kind };
  };
  const links = [at("[[Plano]]", "Viagem/Plano.md", "note"), at("`Anexos/bilhete.pdf`", "Anexos/bilhete.pdf", "file")];
  const q = "escala=1.00&lado=right&balao=acima";
  const place = overlayPlacement(new URLSearchParams(q));
  const sala = 300;
  const c = await browser.newContext({ viewport: { width: place.winW, height: place.catH + sala }, deviceScaleFactor: 2 });
  await c.addInitScript(() => {
    const posts: unknown[] = ((window as any).__posts = []);
    (window as any).webkit = { messageHandlers: { kiwiCat: { postMessage: (m: unknown) => posts.push(m) } } };
  });
  const o = await c.newPage();
  await o.goto(`http://127.0.0.1:${server.port}/index.html?backend=none&${q}`);
  await o.waitForFunction(() => (window as any).kiwiCatReady === true, undefined, { timeout: 20_000 });
  await o.evaluate(([text, links, sala]) => (window as any).kiwiOverlay.set({ estado: "pronto", visible: true, bubbleHover: true, sala, bubble: { text, error: false, links } }), [texto, links, sala] as const);
  await Bun.sleep(220);
  await o.locator("#bubble-more").click();
  await o.waitForSelector("#bubble-text .kn-md-file");
  assert.deepEqual(await files(o, "#bubble-text"), [["Plano", "Viagem/Plano.md", false], ["Anexos/bilhete.pdf", "Anexos/bilhete.pdf", false]]);
  assert.ok((await o.locator("#bubble-text").innerText()).includes("Veja também isto."), "o kiwi-file: escrito pela resposta fica texto");
  await Bun.sleep(220);
  await o.screenshot({ path: join(out, "05-overlay-aberto.png"), omitBackground: true });
  await o.locator('#bubble-text .kn-md-file[data-path="Anexos/bilhete.pdf"]').click();
  await o.locator('#bubble-text .kn-md-file[data-path="Viagem/Plano.md"]').click();
  const posts = (await o.evaluate(() => (window as any).__posts)) as Record<string, unknown>[];
  assert.deepEqual(posts.filter((m) => "openPath" in m), [{ openPath: "Anexos/bilhete.pdf" }, { openPath: "Viagem/Plano.md" }]);
  assert.equal(posts.filter((m) => "link" in m).length, 0);
  await c.close();
  checks.push("overlay: o balão aberto com a nota e o pdf como link; o clique manda {openPath} ao helper; o kiwi-file: escrito pela resposta fica texto");

  for (const f of ["01-balao-pequeno", "02-pdf-no-visualizador", "03-balao-grande", "04-nota-no-editor", "05-overlay-aberto"]) {
    spawnSync("cwebp", ["-quiet", "-q", "85", join(out, `${f}.png`), "-o", join(out, `${f}.webp`)]);
  }
  for (const c of checks) console.log(`ok  ${c}`);
  console.log(`os prints em ${out}`);
} finally {
  server?.stop(true);
  await browser.close();
  await cli(["stop"]).catch(() => {});
  registry.stop();
}
