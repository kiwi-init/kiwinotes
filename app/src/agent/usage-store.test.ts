// O gasto guardado (spec #11084, T11114): as somas de 5 horas e da semana, os mais caros, os 8 dias, o aviso uma vez
// por janela e a hora de volta, com o relógio na mão.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { FIVE_HOURS_MS, USAGE_KEEP_MS, UsageStore } from "./usage-store.ts";

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});
function make(start = 1_800_000_000_000) {
  const dir = mkdtempSync(path.join(tmpdir(), "kn-usage-"));
  roots.push(dir);
  const clock = { now: start };
  return { dir, clock, store: new UsageStore(dir, () => clock.now) };
}
const u = (input: number, output = 0, cacheRead = 0) => ({ input, output, cacheRead, cacheWrite: 0 });
const H = 3_600_000;

describe("o gasto guardado", () => {
  test("as 5 horas, a semana, o cache e os mais caros; nada em dinheiro; o arquivo é 0600", () => {
    const { dir, clock, store } = make();
    store.record("p1", "Resuma a reunião de ontem", u(1000, 200, 5000));
    clock.now += 6 * H;
    store.record("p2", "Qual é o prazo do Kiwi?", u(300, 50));
    clock.now += H;
    store.record("p3", "x".repeat(300), u(9000, 1000));
    const s = store.summary();
    expect(s.fiveHours).toEqual({ requests: 2, tokens: 350 + 10000, cacheRead: 0 });
    expect(s.week).toEqual({ requests: 3, tokens: 6200 + 350 + 10000, cacheRead: 5000 });
    expect(s.top.map((t) => t.request)).toEqual(["p3", "p1", "p2"]);
    expect(s.top[0]!.question.length).toBeLessThanOrEqual(120);
    const file = path.join(dir, "usage.json");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, "utf8")).not.toMatch(/cost|usd|\$/i);
  });

  test("depois de 8 dias o gasto some; e o apagar leva tudo", () => {
    const { clock, store } = make();
    store.record("velho", "um pedido antigo", u(100));
    clock.now += USAGE_KEEP_MS + 1;
    store.record("novo", "um pedido novo", u(10));
    expect(store.summary().top.map((t) => t.request)).toEqual(["novo"]);
    store.clear();
    expect(store.summary()).toMatchObject({ week: { requests: 0 }, top: [], limit: null, out: null });
  });

  test("o aviso do agente (allowed_warning) aparece uma vez por janela", () => {
    const { clock, store } = make();
    const resetsAt = clock.now + 2 * H;
    expect(store.noteLimit({ status: "allowed_warning", window: "five_hour", percent: 82, resetsAt })).toBe(true);
    expect(store.noteLimit({ status: "allowed_warning", window: "five_hour", percent: 90, resetsAt })).toBe(false);
    expect(store.summary().limit).toMatchObject({ status: "allowed_warning", percent: 90, at: clock.now });
    // Na janela seguinte, de novo.
    clock.now = resetsAt + 1;
    expect(store.noteLimit({ status: "allowed_warning", percent: 81, resetsAt: clock.now + FIVE_HOURS_MS })).toBe(true);
  });

  test("o limite acabado: com a hora de volta que o agente informou, até ela passar; sem a hora, até um pedido passar", () => {
    const { clock, store } = make();
    const resetsAt = clock.now + 3 * H;
    store.noteLimit({ status: "rejected", resetsAt });
    expect(store.summary().out).toEqual({ at: clock.now, resetsAt });
    // O erro do pedido sem hora na mensagem mantém a hora que o rate_limit_event já tinha dado.
    store.noteOut(null);
    expect(store.summary().out!.resetsAt).toBe(resetsAt);
    clock.now = resetsAt;
    expect(store.summary().out).toBeNull();
    // Sem hora nenhuma: diz só que acabou, até um pedido passar.
    const b = make();
    b.store.noteOut(null);
    expect(b.store.summary().out).toEqual({ at: b.clock.now });
    b.store.record("p", "voltou", u(1));
    expect(b.store.summary().out).toBeNull();
  });

  test("um arquivo estragado vai para o lado, e o medidor começa de novo", () => {
    const { dir, store } = make();
    writeFileSync(path.join(dir, "usage.json"), "{nada");
    expect(store.summary().week.requests).toBe(0);
    store.record("p", "ok", u(1));
    expect(store.summary().week.requests).toBe(1);
  });
});
