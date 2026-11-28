// T18311 (spec #17673): no "Ver mais", o balão do gato no Hub alarga para o lado (até 480 px, como o do overlay) e só
// depois desce; fechado, fica como era. O hub de verdade, no headless com o agente falso (`/diga`), num WebKit headless:
// nada abre na tela, nada liga o agente de verdade.
//
// Em cada janela (640 × 480, 1000 × 740 e 1440 × 900) e nos dois lugares do gato (o canto das Notas e o meio da Início):
// - com o texto longo, o aberto fica em min(480, o espaço do lado) (±1 px): 480 no canto, o espaço do lado na Início, e o
//   mesmo do fechado onde nem os 320 cabem. Os 420 de antes (a `main`) falham aqui;
// - com uma resposta curta (uma linha e uma lista de itens curtos), o aberto alarga só o que o texto pede: entre 320 e
//   480, sem encostar em nenhum dos dois (um 480 fixo falha aqui, e um 320 também);
// - o aberto tem menos linhas que o mesmo texto teria na largura do fechado, fica dentro da janela (12 px de folga) e não
//   cobre o corpo do gato;
// - o Esc (o "Ver menos") volta ao balão pequeno, na largura de antes.
// Sai a prancha `prancha.webp`, com o fechado e o aberto lado a lado. Tudo inventado (AGENTS.md).
//
//   bun scripts/bubble-wide-check.ts [pasta]
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Page } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, peekKiwi, type UiContext } from "./ui-page";
import { fakeRegistry } from "../src/agent/fake/registry";
import { CAT_BODY } from "../ui/kiwicat-v2/bubbleTail";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T18311-largo"));
mkdirSync(out, { recursive: true });

const LONGA = [
  "## A mudança da Ana",
  "",
  "Juntei o que a **Ana** anotou sobre a mudança para o apartamento novo, no fim do mês. O caminhão está marcado para o sábado de manhã, e a chave fica com o porteiro a partir de sexta.",
  "",
  "- [x] as caixas da cozinha, embaladas e com o nome do cômodo",
  "- [ ] a internet nova, que precisa de uma visita do técnico na semana",
  "- [ ] o conserto da porta do armário antes da entrega",
  "",
  "Os móveis grandes vão primeiro, e as plantas ficam para o domingo, no carro. Se chover, a Ana prefere adiar as plantas e levar só os livros.",
].join("\n");

const CURTA = ["A lista da feira de sábado, que a Ana mandou ontem pelo grupo:", "", "- pão", "- leite", "- ovos", "- café", "- arroz", "- feijão", "- uva"].join("\n");

const data = mkdtempSync(join(tmpdir(), "kiwi-largo-"));
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
const settle = (p: Page) => p.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
type Box = { x: number; y: number; width: number; height: number };
const box = async (p: Page, sel: string) => (await p.locator(sel).first().boundingBox()) as Box;

/** O espaço do lado em que o balão abre: o `--kn-bub-room` resolvido, numa sonda irmã do balão (a mesma base do %). */
const room = (p: Page) =>
  p.evaluate(() => {
    const big = document.querySelector<HTMLElement>(".kn-bubble-big")!;
    const probe = document.createElement("div");
    probe.style.cssText = "position:absolute;visibility:hidden;width:var(--kn-bub-room)";
    big.parentElement!.appendChild(probe);
    const w = probe.getBoundingClientRect().width;
    probe.remove();
    return w;
  });

/** As linhas do texto do balão aberto, e quantas o mesmo texto teria na largura do fechado (a mesma caixa, mais estreita). */
const lines = (p: Page, narrow: number) =>
  p.evaluate((narrow) => {
    const big = document.querySelector<HTMLElement>(".kn-bubble-big")!;
    const text = big.querySelector<HTMLElement>(".kn-bubble-big-text")!;
    const lh = parseFloat(getComputedStyle(big).lineHeight);
    const now = Math.round(text.scrollHeight / lh);
    const was = big.style.width;
    big.style.width = `${narrow}px`;
    const then = Math.round(text.scrollHeight / lh);
    big.style.width = was;
    return { now, then };
  }, narrow);

const browser = await webkit.launch({ headless: true });
const shots: { file: string; caption: string; w: number }[] = [];
const checks: string[] = [];
try {
  await cli(["start", "--no-helper"]);
  await invoke("agent.enable", { consent: true });
  await invoke("agent.download");
  await invoke("agent.configure", { onboarding: { state: "done" } });
  await invoke("settings.set", { kiwicat: { overlay: false, show: true } });
  for (let n = 0; (await invoke("agent.status")).adapter.phase !== "ready"; n++) { assert.ok(n < 200); await Bun.sleep(100); }

  const sizes = [
    { width: 640, height: 480 },
    { width: 1000, height: 740 },
    { width: 1440, height: 900 },
  ];
  const cases = [
    ...sizes.flatMap((size) => (["notes", "home"] as const).map((where) => ({ size, where, curta: false }))),
    { size: sizes[2], where: "notes" as const, curta: true },
    { size: sizes[2], where: "home" as const, curta: true },
  ];
  for (const { size, where, curta } of cases) {
    const texto = curta ? CURTA : LONGA;
      // Uma janela por caso: o balão pequeno só sai com o clique.
      const w = await openWindow(browser, ctx, { window: "hub", scale: 2, theme: "light", ...size, motion: false, browser: "webkit", query: {} });
      const p = w.page;
      try {
        await p.waitForSelector('.kn-kiwicat[data-ready="true"]');
        const lugar = where === "home" ? "Início" : "canto";
        await p.locator(`[role="tab"][data-section="${where}"]`).click();
        if (where === "home") await p.waitForFunction(() => document.querySelector<HTMLElement>(".kn-hub")?.dataset.catAt === "home");
        else await p.waitForFunction(() => !document.querySelector<HTMLElement>(".kn-hub")?.dataset.catAt);
        await p.keyboard.press("Escape"); // o clique na aba da Início abre o menu dela
        await peekKiwi(p); // o clique na aba tirou o mouse do Kiwi, e o balão só aparece com ele (spec #32534)
        await invoke("agent.ask", { text: `/diga ${texto}` });
        await p.waitForSelector(`${BUBBLE} .kn-bubble-more`, { timeout: 30_000 });
        await p.waitForTimeout(600); // o resumo entra inteiro (spec #27881)
        await settle(p);
        const small = await box(p, BUBBLE);
        const tag = `${size.width}-${where}${curta ? "-curta" : ""}`;
        await p.screenshot({ path: join(out, `${tag}-fechado.png`) });
        await p.locator(`${BUBBLE} .kn-bubble-more`).click();
        await p.waitForSelector(".kn-bubble-big");
        await settle(p);
        const big = await box(p, ".kn-bubble-big");
        const cat = await box(p, ".kn-kiwicat");
        const what = `${size.width}×${size.height}, ${lugar}${curta ? ", resposta curta" : ""}`;
        // A largura certa. Texto longo: min(480, o espaço do lado). Curta: só o que o texto pede, entre o fechado e 480.
        const side = await room(p);
        // O resumo (spec #27881) pode dar um fechado mais estreito que o mínimo do aberto: compara com o que for maior.
        const narrow = Math.max(small.width, Math.min(320, side));
        const wider = big.width > narrow + 1;
        if (curta) {
          // A linha mais longa pede mais que os 320 do fechado e menos que 480: nem o mínimo, nem o máximo.
          assert.ok(big.width > 330 && big.width < 470, `${what}: a curta abriu com ${big.width} px, devia seguir o texto (entre 320 e 480)`);
        } else {
          const want = Math.min(480, side);
          assert.ok(Math.abs(big.width - want) <= 1, `${what}: o aberto tem ${big.width} px, devia ter min(480, ${side}) = ${want}`);
        }
        assert.ok(big.x >= 11.5 && big.x + big.width <= size.width - 11.5, `${what}: o aberto sai da janela (${big.x}–${big.x + big.width})`);
        assert.ok(big.y >= 0 && big.y + big.height <= size.height, `${what}: o aberto sai da janela na altura`);
        // Sem cobrir o corpo do gato.
        const body = { x0: cat.x + cat.width * CAT_BODY.x0, x1: cat.x + cat.width * CAT_BODY.x1, y0: cat.y + cat.height * CAT_BODY.y0, y1: cat.y + cat.height * CAT_BODY.y1 };
        const over = big.x < body.x1 && big.x + big.width > body.x0 && big.y < body.y1 && big.y + big.height > body.y0;
        assert.ok(!over, `${what}: o aberto cobre o gato`);
        // Menos linhas que na largura do fechado.
        const l = await lines(p, narrow);
        if (wider && !curta) assert.ok(l.now < l.then, `${what}: ${l.now} linhas aberto, ${l.then} na largura do fechado`);
        await p.screenshot({ path: join(out, `${tag}-aberto.png`) });
        checks.push(`${what}: fechado ${Math.round(small.width)} px → aberto ${Math.round(big.width)} px (o lado tem ${Math.round(side)}), ${l.then} → ${l.now} linhas${wider || curta ? "" : " (o lado não tem mais espaço)"}`);
        shots.push({ file: `${tag}-fechado.png`, caption: `${what}: fechado`, w: size.width }, { file: `${tag}-aberto.png`, caption: `${what}: aberto (Ver mais)`, w: size.width });
        // Ver menos: volta ao pequeno, na largura de antes.
        await p.keyboard.press("Escape");
        await p.waitForSelector(".kn-bubble-big", { state: "detached" });
        await p.waitForSelector(BUBBLE);
        await settle(p);
        const back = await box(p, BUBBLE);
        assert.ok(Math.abs(back.width - small.width) <= 1, `${what}: o fechado voltou com ${back.width}, era ${small.width}`);
        assert.deepEqual(w.report.problems, [], "problemas na página");
      } finally {
        await w.close();
      }
    }

  // A prancha: o fechado e o aberto lado a lado, por janela e lugar.
  const sheet = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 1500, height: 900 } });
  const img = (f: string) => `data:image/png;base64,${readFileSync(join(out, f)).toString("base64")}`;
  const fig = (x: (typeof shots)[number]) =>
    `<figure style="margin:0"><figcaption style="margin-bottom:6px">${x.caption}</figcaption><img src="${img(x.file)}" style="display:block;width:680px;border-radius:8px;box-shadow:0 1px 4px #0003"></figure>`;
  await sheet.setContent(
    `<body style="margin:0;padding:24px;background:#eceae4;font:600 15px -apple-system,sans-serif;color:#222">` +
      `<h1 style="margin:0 0 6px;font-size:24px">O balão do Hub alarga no Ver mais (T18311, spec #17673)</h1>` +
      `<p style="margin:0 0 18px;font-weight:500">Aberto, até 480 px de largura, dentro da janela e sem cobrir o gato; fechado, como antes.</p>` +
      `<div style="display:grid;grid-template-columns:repeat(2,max-content);gap:20px">${shots.map(fig).join("")}</div></body>`,
  );
  await sheet.screenshot({ path: join(out, "prancha.png"), fullPage: true });
  await sheet.close();
  const webp = spawnSync("cwebp", ["-quiet", "-q", "80", join(out, "prancha.png"), "-o", join(out, "prancha.webp")]);
  if (webp.status !== 0) console.log("sem o cwebp: a prancha ficou em PNG");
  for (const c of checks) console.log(`ok  ${c}`);
  console.log(`a prancha em ${join(out, "prancha.webp")}`);
} finally {
  await browser.close();
  await cli(["stop"]).catch(() => {});
  registry.stop();
}
