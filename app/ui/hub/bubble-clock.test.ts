import { describe, expect, test } from "bun:test";

import { BUBBLE_ASK_LEAVE_MS, BUBBLE_IDLE_ASK_MS, BubbleClock } from "./bubble-clock";
import { OVERLAY_TIMES } from "../../src/bun/cat-overlay";

/** Um relógio de mentira: os timers só correm no `advance`, em ordem, inclusive os que nascem dentro de outro. */
function fakeClock() {
  let now = 0;
  let next = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  return {
    timers: {
      set: (fn: () => void, ms: number) => {
        const id = next++;
        pending.set(id, { at: now + ms, fn });
        return id;
      },
      clear: (id: unknown) => void pending.delete(id as number),
    },
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...pending].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = end;
    },
  };
}

function rig() {
  const c = fakeClock();
  const log: string[] = [];
  const k = new BubbleClock({ ask: (on) => log.push(on ? "ask" : "unask"), leave: () => log.push("leave") }, c.timers);
  return { k, c, log };
}

describe("o relógio do balão (spec #32534, Cena 3)", () => {
  test("45 s parado, a pergunta; mais 15 s, e o balão sai", () => {
    const { k, c, log } = rig();
    k.start();
    c.advance(BUBBLE_IDLE_ASK_MS - 1);
    expect(log).toEqual([]);
    c.advance(1);
    expect(log).toEqual(["ask"]);
    expect(k.asking).toBe(true);
    c.advance(BUBBLE_ASK_LEAVE_MS - 1);
    expect(log).toEqual(["ask"]);
    c.advance(1);
    expect(log).toEqual(["ask", "unask", "leave"]);
    // Saiu: nada mais corre.
    c.advance(10 * BUBBLE_IDLE_ASK_MS);
    expect(log).toEqual(["ask", "unask", "leave"]);
  });

  test("os tempos são 45 s e 15 s, os mesmos do overlay", () => {
    expect(BUBBLE_IDLE_ASK_MS).toBe(45_000);
    expect(BUBBLE_ASK_LEAVE_MS).toBe(15_000);
    expect(OVERLAY_TIMES.idleAsk).toBe(BUBBLE_IDLE_ASK_MS);
    expect(OVERLAY_TIMES.askLeave).toBe(BUBBLE_ASK_LEAVE_MS);
  });

  test("o mouse em cima segura: nada corre, e solto a espera recomeça do zero", () => {
    const { k, c, log } = rig();
    k.start();
    c.advance(40_000);
    k.hold(true);
    c.advance(5 * 60_000);
    expect(log).toEqual([]);
    k.hold(false);
    c.advance(BUBBLE_IDLE_ASK_MS - 1);
    expect(log).toEqual([]);
    c.advance(1);
    expect(log).toEqual(["ask"]);
  });

  test("o mouse chega com a pergunta: ela fica à vista e o balão não sai; solto, ela sai e a espera recomeça", () => {
    const { k, c, log } = rig();
    k.start();
    c.advance(BUBBLE_IDLE_ASK_MS + 10_000);
    expect(k.asking).toBe(true);
    k.hold(true);
    expect(log).toEqual(["ask"]);
    c.advance(60_000);
    expect(log).toEqual(["ask"]);
    expect(k.asking).toBe(true);
    k.hold(false);
    expect(log).toEqual(["ask", "unask"]);
    c.advance(BUBBLE_IDLE_ASK_MS + BUBBLE_ASK_LEAVE_MS);
    expect(log).toEqual(["ask", "unask", "ask", "unask", "leave"]);
  });

  test("o mouse já em cima quando a resposta chega: o relógio só começa quando ele sai", () => {
    const { k, c, log } = rig();
    k.hold(true);
    k.start();
    c.advance(5 * 60_000);
    expect(log).toEqual([]);
    k.hold(false);
    c.advance(BUBBLE_IDLE_ASK_MS + BUBBLE_ASK_LEAVE_MS);
    expect(log).toEqual(["ask", "unask", "leave"]);
  });

  test("o clique no balão não fecha: tira a pergunta e recomeça a espera", () => {
    const { k, c, log } = rig();
    k.start();
    c.advance(30_000);
    k.touch();
    c.advance(30_000);
    expect(log).toEqual([]);
    c.advance(15_000);
    expect(log).toEqual(["ask"]);
    k.touch();
    expect(log).toEqual(["ask", "unask"]);
    c.advance(BUBBLE_IDLE_ASK_MS - 1);
    expect(log).toEqual(["ask", "unask"]);
    c.advance(1 + BUBBLE_ASK_LEAVE_MS);
    expect(log).toEqual(["ask", "unask", "ask", "unask", "leave"]);
  });

  test("parado (o ×, o Esc, um pedido novo), o clique e o mouse não religam o relógio", () => {
    const { k, c, log } = rig();
    k.start();
    c.advance(BUBBLE_IDLE_ASK_MS);
    k.stop();
    expect(log).toEqual(["ask", "unask"]);
    k.touch();
    k.hold(true);
    k.hold(false);
    c.advance(10 * BUBBLE_IDLE_ASK_MS);
    expect(log).toEqual(["ask", "unask"]);
  });

  test("um balão novo recomeça a espera inteira", () => {
    const { k, c, log } = rig();
    k.start();
    c.advance(44_000);
    k.start();
    c.advance(44_000);
    expect(log).toEqual([]);
    c.advance(1_000);
    expect(log).toEqual(["ask"]);
  });
});
