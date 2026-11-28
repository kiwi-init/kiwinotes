import { afterEach, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Vault } from "../notes/vault.ts";
import { tempDir } from "../../test/tmp.ts";
import { calendarService } from "./calendar.ts";

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

test("P1 reunião criada vira pendência", async () => {
  const { cal, read } = await open({ "x.md": "# x\n" });
  const m = await cal.create({ kind: "meeting", title: "Café com a Ana", start: "2026-11-27T10:00", end: "2026-11-27T11:00" });
  console.log("P1 create", m.id, JSON.stringify(read("Calendário.md")));
  const r = await code(cal.update({ id: m.id, kind: "task" }));
  console.log("P1 kind->task:", typeof r === "string" ? r : r.kind, JSON.stringify(read("Calendário.md")));
});
test("P2 dia todo para 10:00", async () => {
  const { cal, read } = await open({ "x.md": "# x\n" });
  const m = await cal.create({ kind: "reminder", title: "Pagar a conta", start: "2026-11-27" });
  const r = await code(cal.update({ id: m.id, start: "2026-11-27T10:00" }));
  console.log("P2", typeof r === "string" ? r : JSON.stringify({ s: r.start, a: r.allDay }), JSON.stringify(read("Calendário.md")));
  const r2 = await code(cal.update({ id: m.id, start: "2026-11-27T10:00", end: "2026-11-27T11:00" }));
  console.log("P2b", typeof r2 === "string" ? r2 : JSON.stringify({ s: r2.start, e: r2.end, a: r2.allDay }));
});
test("P3 adiar uma vez da repetição semanal", async () => {
  const { cal, read } = await open({ "x.md": "# x\n" });
  const m = await cal.create({ kind: "focus", title: "Bloco de escrita", start: "2026-11-02T08:00", end: "2026-11-02T09:00", repeat: "weekly" });
  const { items } = await cal.items({ from: "2026-11-16", to: "2026-11-23" });
  const occ = items.find((i) => i.title === "Bloco de escrita")!;
  console.log("P3 occ", occ.id, occ.start);
  const r = await code(cal.update({ id: occ.id, start: "2026-11-17T08:00", end: "2026-11-17T09:00" }));
  console.log("P3 after", JSON.stringify(read("Calendário.md")));
});
test("P4 lembrete de dia todo vira com hora por allDay false", async () => {
  const { cal, read } = await open({ "x.md": "# x\n" });
  const m = await cal.create({ kind: "reminder", title: "Ligar", start: "2026-11-27" });
  const r = await code(cal.update({ id: m.id, allDay: false }));
  console.log("P4", typeof r === "string" ? r : JSON.stringify(r), JSON.stringify(read("Calendário.md")));
});
test("P5 mesmo pedido duas vezes", async () => {
  const { cal, read } = await open({ "x.md": "# x\n" });
  await cal.create({ kind: "reminder", title: "Ligar", start: "2026-11-27T10:00" });
  await cal.create({ kind: "reminder", title: "Ligar", start: "2026-11-27T10:00" });
  const { items } = await cal.items({ from: "2026-11-27", to: "2026-11-28" });
  console.log("P5 ids", items.map((i) => i.id));
  const r = await code(cal.update({ id: items[1]!.id, done: true }));
  console.log("P5 done second", typeof r === "string" ? r : r.id, JSON.stringify(read("Calendário.md")));
});
