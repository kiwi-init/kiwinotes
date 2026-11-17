import { describe, expect, test } from "bun:test";
import { CatVisual, READY_SECONDS, WAKE_HOLD_SECONDS, SlowGuard } from "./visual";

describe("o estado do gato no tempo (spec #14813)", () => {
  test("o pronto volta ao repouso e mostra o feliz", () => {
    const v = new CatVisual("repouso", 0, { sleepSeconds: () => 300 });
    v.update("pronto", 1);
    expect(v.look).toEqual({ estado: "repouso", emote: "feliz" });
    expect(v.sample(1 + READY_SECONDS - 0.01)).toBe("pronto");
    expect(v.sample(1 + READY_SECONDS)).toBe("repouso");
    expect(v.look).toEqual({ estado: "repouso", emote: "auto" });
  });

  test("parado, dorme no tempo sorteado; um repouso novo recomeça a conta", () => {
    const v = new CatVisual("repouso", 0, { sleepSeconds: () => 240 });
    expect(v.sample(239)).toBe("repouso");
    v.update("repouso", 200);
    expect(v.sample(439)).toBe("repouso");
    expect(v.sample(440)).toBe("dormindo");
    v.update("repouso", 441);
    expect(v.state).toBe("repouso");
  });

  test("o sono padrão fica entre 240 e 360 s", () => {
    for (const r of [0, 0.5, 0.999]) {
      const v = new CatVisual("repouso", 0, { random: () => r });
      const due = v.nextBoundary();
      expect(due).toBeGreaterThanOrEqual(240);
      expect(due).toBeLessThanOrEqual(360);
    }
  });

  test("o acordou segura antes do ouvindo", () => {
    const v = new CatVisual("repouso", 0, { sleepSeconds: () => 300 });
    v.update("acordou", 5);
    expect(v.look).toEqual({ estado: "repouso", emote: "alerta" });
    v.update("ouvindo", 5.1);
    expect(v.state).toBe("acordou");
    expect(v.sample(5 + WAKE_HOLD_SECONDS)).toBe("ouvindo");
  });

  test("o erro de limite mostra o limite; o próximo pedido limpa", () => {
    const v = new CatVisual("repouso", 0, { sleepSeconds: () => 300 });
    v.update("erro", 1, true);
    expect(v.look).toEqual({ estado: "repouso", emote: "limite" });
    v.update("thinking", 2);
    expect(v.look).toEqual({ estado: "pensando", emote: "auto" });
    v.update("erro", 3);
    expect(v.look.emote).toBe("confuso");
  });
});

test("a guarda da GPU lenta: 60 quadros abaixo de 24 fps congelam; a 30 fps não; uma pausa não conta", () => {
  const ok = new SlowGuard();
  for (let i = 0; i <= 200; i++) expect(ok.observe(i / 30)).toBe(false);
  expect(ok.slow).toBe(false);

  const paused = new SlowGuard();
  for (let i = 0; i < 40; i++) paused.observe(i / 30);
  paused.reset();
  // Um buraco de 5 s (o repouso, o escondido) depois do reset não entra na média.
  for (let i = 0; i < 40; i++) paused.observe(5 + i / 30);
  expect(paused.slow).toBe(false);

  const slow = new SlowGuard();
  let flipped = 0;
  for (let i = 0; i <= 61; i++) if (slow.observe(i / 20)) flipped++;
  expect(slow.slow).toBe(true);
  expect(flipped).toBe(1);
  // Não volta sozinho.
  for (let i = 0; i < 100; i++) slow.observe(10 + i / 60);
  expect(slow.slow).toBe(true);
});
