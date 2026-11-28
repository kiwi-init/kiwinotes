import { describe, expect, test } from "bun:test";

import { BubblePeek, PEEK_LEAVE_MS } from "./bubble-peek";

/** Um relógio de mentira: os timers só correm no `advance`. */
function clock() {
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
      now += ms;
      for (const [id, t] of [...pending].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at > now) continue;
        pending.delete(id);
        t.fn();
      }
    },
    get pending() {
      return pending.size;
    },
  };
}

function peek() {
  const c = clock();
  const seen: boolean[] = [];
  const p = new BubblePeek((s) => seen.push(s), c.timers);
  return { p, c, seen };
}

describe("o balão no mouse (spec #32534)", () => {
  test("começa escondido e aparece com o mouse no Kiwi", () => {
    const { p, seen } = peek();
    expect(p.shown).toBe(false);
    p.hover("kiwi", true);
    expect(p.shown).toBe(true);
    expect(seen).toEqual([true]);
  });

  test("sai 250 ms depois que o mouse sai, nem antes", () => {
    const { p, c, seen } = peek();
    p.hover("kiwi", true);
    p.hover("kiwi", false);
    c.advance(PEEK_LEAVE_MS - 1);
    expect(p.shown).toBe(true);
    c.advance(1);
    expect(p.shown).toBe(false);
    expect(seen).toEqual([true, false]);
  });

  test("do Kiwi para o balão, sem piscar", () => {
    const { p, c, seen } = peek();
    p.hover("kiwi", true);
    p.hover("kiwi", false);
    c.advance(120);
    p.hover("balao", true);
    c.advance(PEEK_LEAVE_MS * 2);
    expect(p.shown).toBe(true);
    expect(seen).toEqual([true]);
    expect(c.pending).toBe(0);
  });

  test("dois lugares ao mesmo tempo: sair de um não esconde", () => {
    const { p, c } = peek();
    p.hover("kiwi", true);
    p.hover("balao", true);
    p.hover("kiwi", false);
    c.advance(PEEK_LEAVE_MS * 2);
    expect(p.shown).toBe(true);
  });

  test("o Ver mais aberto prende; fechado com o mouse longe, sai depois da espera", () => {
    const { p, c } = peek();
    p.hover("balao", true);
    p.pin(true);
    p.hover("balao", false);
    c.advance(PEEK_LEAVE_MS * 10);
    expect(p.shown).toBe(true);
    p.pin(false);
    expect(p.shown).toBe(true);
    c.advance(PEEK_LEAVE_MS);
    expect(p.shown).toBe(false);
  });

  test("o pino aparece sem o mouse (o teclado abriu o Ver mais)", () => {
    const { p } = peek();
    p.pin(true);
    expect(p.shown).toBe(true);
  });

  test("o dispose solta a espera", () => {
    const { p, c } = peek();
    p.hover("kiwi", true);
    p.hover("kiwi", false);
    p.dispose();
    expect(c.pending).toBe(0);
  });
});
