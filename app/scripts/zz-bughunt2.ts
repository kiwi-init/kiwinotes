// Rascunho do T34758 (não vai a commit): explora o Calendário com dados inventados.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Page } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2]!);
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-bughunt-"));
async function cli(args: string[]) {
  const p = Bun.spawn([process.execPath, join(app, "scripts/cli.ts"), ...args, "--data", data], { cwd: app, stdout: "pipe", stderr: "pipe", env: { ...process.env, KIWI_FAKE_AGENT: "1" } });
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
  return r as any;
}
const day = (n = 0) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const pane = '.kn-hub-pane[data-section="calendar"]';
const log: string[] = [];
const note = (s: string) => { log.push(s); console.log(s); };

const browser = await webkit.launch({ headless: true });
try {
  await cli(["start", "--no-helper"]);
  const lines = [
    `- [ ] Revisar o orçamento do Projeto X com a equipe inteira e mais um título bem longo para ver o corte @ ${day(0)} 10:00-11:00`,
    `- Café com a Ana @ ${day(0)} 10:00-10:30 #reuniao`,
    `- Conversa com o Bruno @ ${day(0)} 10:15-10:45 #reuniao`,
    `- Alinhamento rápido @ ${day(0)} 10:30-11:30 #reuniao`,
    `- Quinta reunião @ ${day(0)} 10:00-12:00 #reuniao`,
    `- [ ] Ligar para o fornecedor @ ${day(0)} 23:00-01:00 #lembrete`,
    `- Plantão @ ${day(1)} 22:00-23:59 #foco`,
    `- [ ] Pagar a conta @ ${day(0)} #lembrete`,
    `- [ ] Entregar o relatório @ ${day(0)}`,
    `- [ ] Outra de dia todo @ ${day(0)}`,
    `- [ ] Mais uma de dia todo @ ${day(0)}`,
    `- Bloco de escrita @ ${day(-7)} 08:00-09:00 #foco 🔁 semana`,
    `- [ ] Regar as plantas @ ${day(-3)} 07:00 #lembrete 🔁 dia`,
    `- [ ] Sem fim às 23:45 @ ${day(1)} 23:45`,
  ];
  await invoke("notes.create", { folder: "Projeto X", title: "Pendências", content: `# Pendências\n\n${lines.join("\n")}\n- [ ] Escolher o fornecedor\n` });
  // Muitos itens num dia do mês.
  const many = Array.from({ length: 12 }, (_, i) => `- [ ] Tarefa ${i + 1} @ ${day(2)} ${String(8 + (i % 10)).padStart(2, "0")}:00`);
  await invoke("notes.create", { folder: "Casa", title: "Muitas", content: `# Muitas\n\n${many.join("\n")}\n` });
  await invoke("settings.set", { kiwicat: { overlay: false, show: true } });

  await invoke("settings.set", { language: "pt" });
  const w = await openWindow(browser, ctx, { window: "hub", scale: 1, theme: "dark", width: 1400, height: 860, motion: false, browser: "webkit", query: { section: "calendar" } });
  const p = w.page;
  try {
    await p.waitForSelector(`${pane} .kn-cal-item`);
    await p.locator(`${pane} .kn-cal-new`).click();
    await p.waitForSelector(`${pane} .kn-cal-newform`);
    const vals = await p.evaluate(() => [...document.querySelectorAll('.kn-cal-newform input')].map((i) => ({ n: (i as HTMLInputElement).name, v: (i as HTMLInputElement).value, dis: (i as HTMLInputElement).disabled, color: getComputedStyle(i).color, op: getComputedStyle(i).opacity })));
    note("campos: " + JSON.stringify(vals));
    await p.locator(`${pane} .kn-cal-newform input[name="title"]`).fill("Teste do campo vazio");
    await p.screenshot({ path: join(out, "novo-vazio.png"), clip: { x: 700, y: 60, width: 700, height: 460 } });
    await p.keyboard.press("Enter");
    await p.waitForSelector(`${pane} .kn-cal-newform`, { state: "detached" });
    const r = await invoke("calendar.items", { from: day(0), to: day(1) });
    const it = r.value.items.find((i: any) => i.title === "Teste do campo vazio");
    note("criado: " + JSON.stringify({ start: it?.start, allDay: it?.allDay }));
  } finally { await w.close(); }
} finally {
  await browser.close();
  await cli(["stop"]).catch(() => {});
}
console.log("FIM", log.length, "notas");
