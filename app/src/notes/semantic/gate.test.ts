// Quando a busca pelo sentido pode indexar (spec #24228): para com a pessoa usando o Mac e na bateria.
import { expect, test } from "bun:test";

import { BackgroundGate, onBattery, QUIET_MS } from "./gate.ts";

const AC = "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t80%; charged; 0:00 remaining present: true\n";
const BATT = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t80%; discharging; 5:00 remaining present: true\n";

function clock() {
  let t = 1_000_000;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

test("a saída do pmset: na tomada, na bateria e num Mac de mesa", () => {
  expect(onBattery(AC)).toBe(false);
  expect(onBattery(BATT)).toBe(true);
  expect(onBattery("Now drawing from 'AC Power'\n")).toBe(false);
  expect(onBattery("")).toBe(false);
});

test("ditando, para; ao terminar, volta só depois do tempo parado", async () => {
  const c = clock();
  const g = new BackgroundGate({ now: c.now, battery: null });
  expect(await g.blocked()).toBeNull();
  g.hold("dictation");
  expect(await g.blocked()).toBe("dictation");
  c.advance(60_000);
  expect(await g.blocked()).toBe("dictation");
  g.release("dictation");
  expect(await g.blocked()).toBe("active");
  c.advance(QUIET_MS - 1);
  expect(await g.blocked()).toBe("active");
  c.advance(1);
  expect(await g.blocked()).toBeNull();
});

test("uma reunião e o ditado juntos: só volta quando os dois terminam", async () => {
  const c = clock();
  const g = new BackgroundGate({ now: c.now, battery: null });
  g.hold("meeting");
  g.hold("dictation");
  g.release("dictation");
  c.advance(QUIET_MS);
  expect(await g.blocked()).toBe("meeting");
  g.release("meeting");
  c.advance(QUIET_MS);
  expect(await g.blocked()).toBeNull();
  // Soltar o que não estava preso não conta como uso.
  g.release("agent");
  expect(await g.blocked()).toBeNull();
});

test("digitando numa nota, espera o tempo parado", async () => {
  const c = clock();
  const g = new BackgroundGate({ now: c.now, battery: null });
  g.touch();
  expect(await g.blocked()).toBe("active");
  c.advance(QUIET_MS);
  expect(await g.blocked()).toBeNull();
});

test("na bateria, para; o pmset roda no máximo uma vez por minuto", async () => {
  const c = clock();
  let out = BATT;
  let reads = 0;
  const g = new BackgroundGate({ now: c.now, battery: async () => (reads++, out) });
  expect(await g.blocked()).toBe("battery");
  expect(await g.blocked()).toBe("battery");
  expect(reads).toBe(1);
  out = AC;
  c.advance(59_000);
  expect(await g.blocked()).toBe("battery");
  c.advance(1_000);
  expect(await g.blocked()).toBeNull();
  expect(reads).toBe(2);
});

test("o wait espera até poder andar, e o stop corta a espera", async () => {
  const c = clock();
  const slept: number[] = [];
  const g = new BackgroundGate({
    now: c.now,
    battery: null,
    sleep: async (ms) => {
      slept.push(ms);
      c.advance(ms);
    },
  });
  g.touch();
  await g.wait();
  expect(slept.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(QUIET_MS);
  expect(await g.blocked()).toBeNull();

  g.hold("meeting");
  let stop = false;
  const done = g.wait(() => stop);
  stop = true;
  await done;
  expect(await g.blocked()).toBe("meeting");
});
