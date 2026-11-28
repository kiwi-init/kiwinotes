import { afterEach, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Vault } from "../notes/vault.ts";
import { tempDir } from "../../test/tmp.ts";
import { calendarService } from "./calendar.ts";
import { moveItem } from "../../ui/calendar/model.ts";

const dirs: string[] = []; const vaults: Vault[] = [];
afterEach(() => { for (const v of vaults.splice(0)) v.close(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
async function open(files: Record<string, string>) {
  const d = tempDir("kn-probe-"); dirs.push(d);
  const root = path.join(d, "Notas"); mkdirSync(root, { recursive: true });
  for (const [rel, c] of Object.entries(files)) { mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); writeFileSync(path.join(root, rel), c); }
  const v = new Vault({ root, debounceMs: 20, trash: async (a) => rmSync(a, { recursive: true }) }); vaults.push(v); await v.open();
  const cal = calendarService(async () => ({ notes: v, meetings: v, liveSession: null, locale: "pt" }), () => "2026-11-01");
  return { cal, read: (r: string) => readFileSync(path.join(root, r), "utf8") };
}
const code = async (p: Promise<unknown>) => { try { return await p; } catch (e) { return (e as { code?: string }).code ?? String(e); } };

test("P6 adiar uma vez de repetição diária", async () => {
  const { cal, read } = await open({ "x.md": "# x\n" });
  await cal.create({ kind: "reminder", title: "Tomar água", start: "2026-11-02T09:00", repeat: "daily" });
  const { items } = await cal.items({ from: "2026-11-16", to: "2026-11-17" });
  const occ = items[0]!;
  const m = moveItem(occ, 0, 1)!;
  await cal.update({ id: occ.id, ...m });
  const after = await cal.items({ from: "2026-11-16", to: "2026-11-17" });
  console.log("P6 line", JSON.stringify(read("Calendário.md")), "still on 16th:", after.items.map((i) => i.start));
});
test("P7 tipo reunião -> lembrete sem caixa", async () => {
  const { cal, read } = await open({ "x.md": "# x\n" });
  const m = await cal.create({ kind: "meeting", title: "Café", start: "2026-11-27T10:00" });
  const r = await code(cal.update({ id: m.id, kind: "reminder" }));
  console.log("P7", typeof r === "string" ? r : JSON.stringify({ k: r.kind, done: r.done, n: r.notify }), JSON.stringify(read("Calendário.md")));
  // Feito no lembrete sem caixa?
  const items = (await cal.items({ from: "2026-11-27", to: "2026-11-28" })).items;
  const r2 = await code(cal.update({ id: items[0]!.id, done: true }));
  console.log("P7 done", typeof r2 === "string" ? r2 : JSON.stringify({ k: r2.kind, done: r2.done }), JSON.stringify(read("Calendário.md")));
});
test("P8 tipo pendência -> reunião (mantém a caixa)", async () => {
  const { cal, read } = await open({ "x.md": "# x\n" });
  const m = await cal.create({ kind: "task", title: "Enviar", start: "2026-11-27T10:00" });
  const r = await code(cal.update({ id: m.id, kind: "meeting" }));
  console.log("P8", typeof r === "string" ? r : JSON.stringify({ k: r.kind, done: r.done }), JSON.stringify(read("Calendário.md")));
});
test("P9 nota com agenda: mover para hora", async () => {
  const { cal, read } = await open({ "x.md": "# x\n" });
  const m = await cal.create({ kind: "note", title: "Pauta do projeto", start: "2026-11-27" });
  const r = await code(cal.update({ id: m.id, start: "2026-11-27T10:00" }));
  console.log("P9", typeof r === "string" ? r : JSON.stringify({ s: r.start, a: r.allDay }));
});
test("P10 título novo numa repetição com ⏭", async () => {
  const { cal, read } = await open({ "Calendário.md": "# C\n\n- [ ] Regar @ 2026-11-02 #lembrete 🔁 dia ⏭ 2026-11-04 [[Plantas]] #casa\n" });
  const { items } = await cal.items({ from: "2026-11-02", to: "2026-11-03" });
  const r = await code(cal.update({ id: items[0]!.id, title: "Regar as plantas" }));
  console.log("P10", JSON.stringify(read("Calendário.md")));
});
