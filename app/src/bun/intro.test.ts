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

test("o intro.done chega ao main e não aceita argumento", async () => {
  let done = 0;
  // Só o introDone importa aqui; o resto das peças nunca é chamado.
  const caps = uiCapabilities({ introDone: () => void done++ } as unknown as Parameters<typeof uiCapabilities>[0]);
  expect(await directInvoke(caps, "intro.done", {})).toEqual({ ok: true, value: true });
  expect(done).toBe(1);
  expect(await directInvoke(caps, "intro.done", { x: 1 })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
  expect(done).toBe(1);
});

