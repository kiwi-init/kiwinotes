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
    expect(store.summary()).toMatchObject({ week: { requests: 0 }, top: [] });
  });

  test("os 8 dias valem no disco: ler o medidor, sem pedido novo, já tira o que passou deles", () => {
    const { dir, clock, store } = make();
    store.record("velho", "um pedido de 9 dias atrás", u(100));
    clock.now += 9 * 86_400_000;
    expect(store.summary().week.requests).toBe(0);
    expect(readFileSync(path.join(dir, "usage.json"), "utf8")).not.toContain("velho");
  });

  test("apagar o gasto leva só os pedidos: o limite acabado, a hora de volta e o aviso da janela ficam", () => {
    const { clock, store } = make();
    const resetsAt = clock.now + 3 * H;
    expect(store.noteLimit({ status: "allowed_warning", window: "five_hour", percent: 85, resetsAt })).toBe(true);
    store.record("p", "um pedido", u(10));
    store.noteLimit({ status: "rejected", resetsAt });
    store.clear();
    const s = store.summary();
    expect(s.week.requests).toBe(0);
    expect(s.top).toEqual([]);
    expect(s.out).toEqual({ at: clock.now, resetsAt });
    expect(s.limit).toMatchObject({ status: "rejected" });
    // O aviso já dado nesta janela não volta.
    expect(store.noteLimit({ status: "allowed_warning", window: "five_hour", percent: 90, resetsAt })).toBe(false);
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

// O peso real de cada tipo de token (ADR 0013, T13702): o limite da assinatura em volta dos pedidos, só o número. Os
// `/usage` saem no máximo um a cada 10 min, então o trecho entre dois deles pode ter mais de um pedido (revisão #13902).
describe("o limite em volta dos pedidos", () => {
  test("um pedido só entre dois /usage: o par é dele", () => {
    const { dir, clock, store } = make();
    store.noteLimitSnapshot({ at: clock.now, fiveHour: 37, week: 12 });
    const a = clock.now;
    clock.now += 4 * 60_000;
    store.record("p1", "Resuma a nota", u(100, 20));
    clock.now += 8 * 60_000;
    store.noteLimitSnapshot({ at: clock.now, fiveHour: 39, week: 12 });
    expect(store.limitSpans()).toEqual([{ before: { at: a, fiveHour: 37, week: 12 }, after: { at: clock.now, fiveHour: 39, week: 12 }, entries: [expect.objectContaining({ request: "p1" })] }]);
    expect(store.limitSpans()[0]!.entries[0]!.limit!.shared).toBe(1);
    // Só os números e a hora: nada do texto do /usage.
    expect(readFileSync(path.join(dir, "usage.json"), "utf8")).not.toMatch(/Resets|limit —|subscription/i);
  });

  test("dois pedidos entre dois /usage: o trecho é dos dois juntos, e cada um diz que dividiu", () => {
    const { clock, store } = make();
    store.noteLimitSnapshot({ at: clock.now, fiveHour: 37 });
    clock.now += 60_000;
    store.record("p1", "um", u(100, 20));
    clock.now += 60_000;
    store.record("p2", "dois", u(100, 20));
    clock.now += 10 * 60_000;
    store.noteLimitSnapshot({ at: clock.now, fiveHour: 41 });
    const [span] = store.limitSpans();
    expect(span!.entries.map((e) => [e.request, e.limit!.shared])).toEqual([["p1", 2], ["p2", 2]]);
    // O pedido seguinte começa um trecho novo.
    clock.now += 60_000;
    store.record("p3", "três", u(100, 20));
    expect(store.limitSpans()).toHaveLength(1);
  });

  test("mais de 30 min entre os dois /usage: outro uso da assinatura pode ter entrado no meio, e o trecho não conta", () => {
    const { clock, store } = make();
    store.noteLimitSnapshot({ at: clock.now, fiveHour: 37 });
    clock.now += 60_000;
    store.record("p1", "Resuma a nota", u(100, 20));
    clock.now += 31 * 60_000;
    store.noteLimitSnapshot({ at: clock.now, fiveHour: 50 });
    expect(store.limitSpans()).toEqual([]);
    // E o pedido que veio mais de 30 min depois do último /usage fica sem "antes".
    clock.now += 31 * 60_000;
    store.record("p2", "outro", u(100, 20));
    expect(store.summary().week.requests).toBe(2);
  });

  test("sem /usage nenhum (o agente não respondeu), o pedido é guardado como antes", () => {
    const { store } = make();
    store.record("p1", "Resuma a nota", u(100, 20));
    expect(store.limitSpans()).toEqual([]);
    expect(store.summary().week.requests).toBe(1);
  });
});

describe("o placar do dia (ADR 0013, T14671)", () => {
  const placar = (idas: number, kind?: "certo" | "nada") => ({
    idas,
    partes: { pedido: 100, achar: kind === "nada" ? 50 : 0, ler: 0, bagagem: 200, fixo: 1000 },
    ...(kind ? { faro: { kind, searched: kind === "nada" } } : {}),
  });

  test("só os pedidos de hoje com placar: as idas, as partes somadas e o faro de primeira", () => {
    // 10h da manhã de um dia, no fuso do Mac.
    const day = new Date(2026, 10, 16, 10, 0, 0).getTime();
    const { clock, store } = make(day - 12 * H);
    store.record("ontem", "pedido de ontem", u(500), placar(2, "certo"));
    clock.now = day;
    store.record("sem", "pedido sem placar", u(500));
    store.record("a", "qual o prazo do Kiwi?", u(1000, 300), placar(1, "certo"));
    store.record("b", "tem algo sobre o fornecedor?", u(2000), placar(3, "nada"));
    store.record("c", "/usage", u(10), placar(1));
    store.record("d", "obrigado", u(10), { ...placar(1), faro: { kind: "nada", searched: false } });
    const d = store.placarDia();
    expect(d.pedidos).toBe(4);
    expect(d.idas).toBe(6);
    expect(d.tokens).toBe(3320);
    expect(d.partes).toEqual({ pedido: 400, achar: 50, ler: 0, bagagem: 800, fixo: 4000 });
    // O "/usage" não passa pelo faro, e o "obrigado" não tinha alvo: os dois ficam de fora da conta de primeira.
    expect(d.comFaro).toBe(2);
    expect(d.dePrimeira).toBe(1);
    expect(d.limite5h).toBeUndefined();
    // Os últimos, do mais novo para o mais velho, também os de ontem.
    expect(d.ultimos.map((x) => x.request)).toEqual(["d", "c", "b", "a", "ontem"]);
  });

  test("o limite do dia: cada trecho entre dois /usage uma vez, e o que passou por uma volta do limite fica de fora", () => {
    const day = new Date(2026, 10, 16, 10, 0, 0).getTime();
    const { clock, store } = make(day);
    store.noteLimitSnapshot({ fiveHour: 10, at: clock.now });
    store.record("a", "um", u(100), placar(1));
    store.record("b", "dois", u(100), placar(1));
    clock.now += 5 * 60_000;
    store.noteLimitSnapshot({ fiveHour: 13, at: clock.now });
    store.record("c", "três", u(100), placar(1));
    clock.now += 5 * 60_000;
    // O limite voltou no meio: o número caiu.
    store.noteLimitSnapshot({ fiveHour: 1, at: clock.now });
    expect(store.placarDia().limite5h).toBe(3);
  });
});
