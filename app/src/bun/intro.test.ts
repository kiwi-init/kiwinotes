import { describe, expect, test } from "bun:test";

import { makeIntro } from "./intro.ts";
import { uiCapabilities } from "./ui-capabilities.ts";
import { directInvoke } from "./ui-engine.ts";

function fake(timeoutMs = 1000) {
  const log: string[] = [];
  const done = new Set<() => void>();
  const closed = new Set<() => void>();
  const intro = makeIntro({
    show: async () => void log.push("show"),
    close: () => log.push("close"),
    onDone: (fn) => (done.add(fn), () => done.delete(fn)),
    onClosed: (fn) => (closed.add(fn), () => closed.delete(fn)),
    timeoutMs,
  });
  return { intro, log, fireDone: () => [...done].forEach((f) => f()), fireClosed: () => [...closed].forEach((f) => f()), done, closed };
}

describe("a intro da abertura do zero", () => {
  test("abre, espera o intro.done e fecha a janela", async () => {
    const f = fake();
    const p = f.intro();
    await Bun.sleep(5);
    expect(f.log).toEqual(["show"]);
    f.fireDone();
    await p;
    expect(f.log).toEqual(["show", "close"]);
    expect(f.done.size + f.closed.size).toBe(0); // desligou os ouvintes
  });

  test("a janela fechada por outro caminho também segue para o hub", async () => {
    const f = fake();
    const p = f.intro();
    await Bun.sleep(5);
    f.fireClosed();
    await p;
    expect(f.log).toEqual(["show", "close"]);
  });

  test("sem aviso nenhum, o tempo máximo segue para o hub", async () => {
    const f = fake(30);
    const t0 = performance.now();
    await f.intro();
    expect(performance.now() - t0).toBeGreaterThanOrEqual(25);
    expect(f.log).toEqual(["show", "close"]);
  });
});

describe("o fim que vira o hub (T16769)", () => {
  function withHub(o: { prepared?: boolean; prepareMs?: number; reveal?: boolean } = {}) {
    const log: string[] = [];
    const done = new Set<() => void>();
    const intro = makeIntro({
      show: async () => void log.push("show"),
      close: () => log.push("close"),
      onDone: (fn) => (done.add(fn), () => done.delete(fn)),
      onClosed: () => () => {},
      prepare: async () => {
        log.push("prepare");
        await Bun.sleep(o.prepareMs ?? 0);
        log.push("hub pronto");
        return o.prepared ?? true;
      },
      reveal: async () => (log.push("reveal"), o.reveal ?? true),
      settleMs: 20,
    });
    return { intro, log, fireDone: () => [...done].forEach((f) => f()) };
  }

  test("o hub abre escondido antes da intro, aparece por cima no fim, e só depois a intro fecha", async () => {
    const f = withHub();
    const p = f.intro();
    await Bun.sleep(5);
    // O hub escondido começa a abrir antes da janela da intro (e as duas abrem juntas).
    expect(f.log[0]).toBe("prepare");
    expect(f.log.toSorted()).toEqual(["hub pronto", "prepare", "show"]);
    const t0 = performance.now();
    f.fireDone();
    expect(await p).toBe(true);
    expect(f.log.slice(3)).toEqual(["reveal", "close"]);
    // A intro fica atrás do hub o tempo de ele pintar.
    expect(performance.now() - t0).toBeGreaterThanOrEqual(15);
  });

  test("o fim espera o hub escondido terminar de abrir", async () => {
    const f = withHub({ prepareMs: 40 });
    const p = f.intro();
    await Bun.sleep(5);
    f.fireDone();
    expect(await p).toBe(true);
    expect(f.log).toEqual(["prepare", "show", "hub pronto", "reveal", "close"]);
  });

  test("o hub que não ficou pronto, ou não apareceu: a intro fecha e o hub abre do jeito de antes", async () => {
    for (const o of [{ prepared: false }, { reveal: false }]) {
      const f = withHub(o);
      const p = f.intro();
      await Bun.sleep(5);
      f.fireDone();
      expect(await p).toBe(false);
      expect(f.log.at(-1)).toBe("close");
    }
  });
});

test("o intro.done chega ao main e não aceita argumento", async () => {
  let done = 0;
  // Só o introDone importa aqui; o resto das peças nunca é chamado.
  const caps = uiCapabilities({ introDone: () => void done++ } as unknown as Parameters<typeof uiCapabilities>[0]);
  expect(await directInvoke(caps, "intro.done", {})).toEqual({ ok: true, value: true });
  expect(done).toBe(1);
  expect(await directInvoke(caps, "intro.done", { x: 1 })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
  expect(done).toBe(1);
});


test("o intro.layout dá ao main o retângulo do hub, e null fora da intro (T16769)", async () => {
  const layout = { target: { x: 64, y: 64, width: 1380, height: 820 }, radius: 16, center: { x: 754, y: 474 }, box: { width: 720, height: 480 } };
  let now: typeof layout | null = layout;
  const caps = uiCapabilities({ introLayout: () => now } as unknown as Parameters<typeof uiCapabilities>[0]);
  expect(await directInvoke(caps, "intro.layout", {})).toEqual({ ok: true, value: layout });
  now = null;
  expect(await directInvoke(caps, "intro.layout", {})).toEqual({ ok: true, value: null });
  expect(await directInvoke(caps, "intro.layout", { x: 1 })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
  // Sem o main (o headless, os testes): null, e a moldura não cresce.
  const none = uiCapabilities({} as unknown as Parameters<typeof uiCapabilities>[0]);
  expect(await directInvoke(none, "intro.layout", {})).toEqual({ ok: true, value: null });
});
