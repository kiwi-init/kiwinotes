// #495 (spec #34320): na janela estreita, a cabeça dos dias da Semana não se sobrepõe. O hub de verdade (WebKit
// headless), na Semana, em pt e en, a 760×560 (a largura da issue) e a 640×560: em cada cabeça, o número e o nome não
// se cobrem, nenhum dos dois passa da coluna do dia, e o nome aparece inteiro. A 1300 px, o controle: número e nome na
// mesma linha, como antes. Nunca abre janela, nem liga o mic, nem o agente.
// Da raiz do app: `bun scripts/calendar-narrow-check.ts [pasta]`. Pegue `kiwi lock bench`.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit } from "playwright-core";
import { request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-495-semana"));
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-narrow-"));

async function cli(args: string[]) {
  const p = Bun.spawn([process.execPath, join(app, "scripts/cli.ts"), ...args, "--data", data], { cwd: app, stdout: "pipe", stderr: "pipe" });
  const text = await new Response(p.stdout).text();
  const err = await new Response(p.stderr).text();
  assert.equal(await p.exited, 0, text + err);
  return text;
}
const ctx: UiContext = {
  data,
  send: async (msg) => { const r = await request(data, msg); assert.ok(r); return r; },
  subscribe: async () => () => {},
};
async function invoke(cap: string, args: unknown = {}) {
  const r = await ctx.send({ cmd: "invoke", cap, args });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.value as any;
}
const pane = '.kn-hub-pane[data-section="calendar"]';

interface Head { day: string; text: string; n: DOMRect; name: DOMRect; col: { left: number; right: number }; clipped: boolean }

const browser = await webkit.launch({ headless: true });
const checks: string[] = [];
try {
  await cli(["start", "--no-helper"]);
  for (const lang of ["pt", "en"] as const) {
    await invoke("settings.set", { language: lang, kiwicat: { overlay: false, show: true } });
    for (const [width, height] of [[760, 560], [640, 560], [1300, 800]] as const) {
      const w = await openWindow(browser, ctx, { window: "hub", scale: 2, theme: "light", width, height, motion: false, browser: "webkit", query: { section: "calendar" } });
      const p = w.page;
      try {
        await p.waitForSelector(`${pane}:not([hidden]) .kn-cal[data-view="week"] .kn-cal-dayhead`);
        const heads = (await p.locator(`${pane} .kn-cal-dayhead`).evaluateAll((els) =>
          els.map((e) => {
            const r = (x: Element) => x.getBoundingClientRect().toJSON();
            const name = e.querySelector(".kn-cal-dayname") as HTMLElement | null;
            // A coluna do dia é a célula da grade: a cabeça não pode passar dela.
            const cell = e.getBoundingClientRect();
            // O nome pode não ter um elemento próprio (a tela antiga): o Range mede só as letras dele.
            const range = document.createRange();
            if (name) range.selectNodeContents(name);
            else range.setStart(e.lastChild!, 0), range.setEnd(e.lastChild!, e.lastChild!.textContent!.length);
            return {
              day: (e as HTMLElement).dataset.day!,
              text: (e.textContent ?? "").trim(),
              n: r(e.querySelector("b")!),
              name: range.getBoundingClientRect().toJSON(),
              col: { left: cell.left, right: cell.right },
              clipped: !!name && name.scrollWidth > name.clientWidth,
            };
          }),
        )) as Head[];
        const head = (await p.locator(`${pane} .kn-cal-head`).boundingBox())!;
        await p.screenshot({ path: join(out, `${lang}-${width}.png`), clip: { x: head.x, y: head.y, width: head.width, height: head.height + 40 } });
        const where = `${lang} a ${width} px`;
        assert.equal(heads.length, 7, `${where}: a Semana sem 7 cabeças`);
        const cols = heads.map((h) => Math.round(h.col.right - h.col.left));
        console.error(`${where}: colunas de ${cols.join(", ")} px; ${heads.map((h) => h.text).join(" · ")}`);
        const overlap = (a: DOMRect, b: DOMRect) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
        for (const [i, h] of heads.entries()) {
          assert.ok(!overlap(h.n, h.name), `${where}: em "${h.text}", o nome cobre o número`);
          for (const [what, r] of [["o número", h.n], ["o nome", h.name]] as const) {
            assert.ok(r.left >= h.col.left - 0.5 && r.right <= h.col.right + 0.5, `${where}: em "${h.text}", ${what} passa da coluna (${Math.round(r.left)}–${Math.round(r.right)} em ${Math.round(h.col.left)}–${Math.round(h.col.right)})`);
          }
          const next = heads[i + 1];
          if (next) for (const r of [h.n, h.name]) assert.ok(!overlap(r, next.n) && !overlap(r, next.name), `${where}: "${h.text}" encosta em "${next.text}"`);
          assert.ok(!h.clipped, `${where}: o nome de "${h.text}" cortado numa coluna de ${cols[i]} px`);
        }
        const oneLine = heads.every((h) => Math.abs(h.n.bottom - h.name.bottom) < 4);
        // O controle: com largura, a cabeça fica numa linha só, como era antes da correção.
        if (width === 1300) assert.ok(oneLine, `${where}: o nome desceu numa coluna larga`);
        checks.push(`${where}: colunas de ${Math.min(...cols)} px, ${oneLine ? "número e nome na mesma linha" : "o nome embaixo do número"}, sem sobrepor e sem cortar (${heads[0]!.text} … ${heads[6]!.text})`);
      } finally {
        await w.close();
      }
    }
  }
  console.log(JSON.stringify({ ok: true, checks }, null, 1));
} finally {
  await browser.close().catch(() => {});
  await cli(["stop"]).catch(() => {});
  rmSync(data, { recursive: true, force: true });
}
