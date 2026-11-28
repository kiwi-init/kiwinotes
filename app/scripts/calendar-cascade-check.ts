// #466 (spec #33093, bug 5): na cascata da Semana, a hora do item de baixo fica à vista quando o de cima começa logo
// depois. Duas reuniões inventadas, 14:00–15:00 e 14:30–16:00 no mesmo dia, na Semana do hub de verdade (WebKit
// headless, 1300×800), no claro e no escuro: a caixa de cima desce até abaixo da hora da de baixo, que fica inteira. Um par que
// começa bem depois (2 h) continua na cascata estreita. Nunca abre janela, nem liga o mic, nem o agente.
// Da raiz do app: `bun scripts/calendar-cascade-check.ts [pasta]`. Pegue `kiwi lock bench`.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit } from "playwright-core";
import { request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-466-cascata"));
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-cascade-"));

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
/** Hoje mais `n` dias às `hh:mm`, como `AAAA-MM-DDTHH:MM` local: a Semana abre na de hoje. */
const at = (n: number, hm: string) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${hm}`;
};
const pane = '.kn-hub-pane[data-section="calendar"]';
const box = (title: string) => `${pane} .kn-cal-block:has(b:text-is("${title}"))`;

const browser = await webkit.launch({ headless: true });
const checks: string[] = [];
try {
  await cli(["start", "--no-helper"]);
  // O par da issue (começa 30 min depois) e um par que começa 2 h depois, no mesmo dia.
  await invoke("calendar.create", { kind: "meeting", title: "Reunião com a Ana", start: at(0, "14:00"), end: at(0, "15:00") });
  await invoke("calendar.create", { kind: "meeting", title: "Sobreposta A", start: at(0, "14:30"), end: at(0, "16:00") });
  await invoke("calendar.create", { kind: "meeting", title: "Plano longo", start: at(0, "08:00"), end: at(0, "11:00") });
  await invoke("calendar.create", { kind: "meeting", title: "Café tarde", start: at(0, "10:00"), end: at(0, "11:00") });
  await invoke("settings.set", { language: "pt", kiwicat: { overlay: false, show: true } });

  for (const theme of ["dark", "light"] as const) {
    const w = await openWindow(browser, ctx, { window: "hub", scale: 2, theme, width: 1300, height: 800, motion: false, browser: "webkit", query: { section: "calendar" } });
    const p = w.page;
    try {
      await p.waitForSelector(`${pane}:not([hidden]) .kn-cal[data-view="week"]`);
      await p.waitForSelector(box("Sobreposta A"));
      await p.locator(box("Reunião com a Ana")).evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
      /** Quanto da hora do de baixo fica à vista, à esquerda da caixa de cima, e quanto ela precisa. */
      const time = async (below: string, above: string) => {
        const up = (await p.locator(box(above)).boundingBox())!;
        return p.locator(box(below)).evaluate((low, upBox) => {
          const span = low.querySelector("span")!;
          const s = span.getBoundingClientRect();
          // A largura do texto, não a da linha (o span é um bloco): o Range mede só as letras.
          const range = document.createRange();
          range.selectNodeContents(span);
          const need = Math.ceil(range.getBoundingClientRect().width);
          // A caixa de cima só cobre a hora se desce até a linha dela.
          const covers = upBox.y < s.bottom;
          const col = low.parentElement!.getBoundingClientRect().width;
          return { text: span.textContent, need, room: Math.floor(covers ? upBox.x - s.left : s.width), clipped: span.scrollWidth > span.clientWidth, col: Math.round(col) };
        }, up);
      };
      const near = await time("Reunião com a Ana", "Sobreposta A");
      const [low, up] = await Promise.all([p.locator(box("Plano longo")).boundingBox(), p.locator(box("Café tarde")).boundingBox()]);
      // O print antes das conferências: a rodada sem a correção também deixa o "antes".
      const col = (await p.locator(`${pane} .kn-cal-col[data-today]`).boundingBox())!;
      const top = (await p.locator(box("Reunião com a Ana")).boundingBox())!;
      await p.screenshot({ path: join(out, `${theme}.png`), clip: { x: col.x - 60, y: top.y - 40, width: col.width + 120, height: 200 } });
      console.error(`${theme}: ${JSON.stringify(near)}`);
      assert.ok(!near.clipped, `${theme}: a hora "${near.text}" cortada na caixa de baixo`);
      assert.ok(near.room >= near.need, `${theme}: a caixa de cima cobre a hora "${near.text}" (${near.room} px de ${near.need}, coluna de ${near.col})`);
      // O par que começa 2 h depois continua na cascata estreita: a de cima com quase a coluna toda.
      assert.ok(low && up && up.x - low.x <= 17, `${theme}: o par distante saiu da cascata estreita (${up!.x - low!.x} px)`);
      checks.push(`${theme}: "${near.text}" à vista (${Math.round(near.room)} px para ${near.need}); o par distante na cascata estreita (${Math.round(up!.x - low!.x)} px)`);
    } finally {
      await w.close();
    }
  }
  console.log(JSON.stringify({ ok: true, checks }, null, 1));
} finally {
  await browser.close().catch(() => {});
  await cli(["stop"]).catch(() => {});
  rmSync(data, { recursive: true, force: true });
}
