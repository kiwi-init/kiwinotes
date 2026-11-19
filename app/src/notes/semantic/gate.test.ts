// Quando a busca pelo sentido pode indexar (spec #24228): para com a pessoa usando o Mac e na bateria.
import { expect, test } from "bun:test";

import { BackgroundGate, hidIdleMs, onBattery, QUIET_MS, SYSTEM_IDLE_EVERY_MS, SYSTEM_IDLE_MS, wireGate } from "./gate.ts";

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
  const g = new BackgroundGate({ now: c.now, battery: null, systemIdle: null });
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
  const g = new BackgroundGate({ now: c.now, battery: null, systemIdle: null });
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
  const g = new BackgroundGate({ now: c.now, battery: null, systemIdle: null });
  g.touch();
  expect(await g.blocked()).toBe("active");
  c.advance(QUIET_MS);
  expect(await g.blocked()).toBeNull();
});

test("na bateria, para; o pmset roda no máximo uma vez por minuto", async () => {
  const c = clock();
  let out = BATT;
  let reads = 0;
  const g = new BackgroundGate({ now: c.now, battery: async () => (reads++, out), systemIdle: null });
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

test("com `battery: false`, a bateria não segura: o índice do conteúdo segue nela (lead #24453)", async () => {
  const c = clock();
  let slept = 0;
  const g = new BackgroundGate({ now: c.now, battery: async () => BATT, systemIdle: null, sleep: async () => void slept++ });
  expect(await g.blocked()).toBe("battery");
  expect(await g.blocked({ battery: false })).toBeNull();
  await g.wait(() => false, { battery: false });
  expect(slept).toBe(0);
  // O uso segura do mesmo jeito.
  g.touch();
  expect(await g.blocked({ battery: false })).toBe("active");
});

test("o wait espera até poder andar, e o stop corta a espera", async () => {
  const c = clock();
  const slept: number[] = [];
  const g = new BackgroundGate({
    now: c.now,
    battery: null,
    systemIdle: null,
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

const ioreg = (ms: number) => `+-o IOHIDSystem  <class IOHIDSystem>\n    {\n      "HIDIdleTime" = ${Math.round(ms * 1e6)}\n    }\n`;

test("a saída do ioreg: o tempo parado em ms, ou nada", () => {
  expect(hidIdleMs(ioreg(12_500))).toBe(12_500);
  expect(hidIdleMs("")).toBeNull();
});

test("mexendo em outro app (o tempo parado do sistema < 30 s), para; o ioreg roda no máximo a cada 10 s", async () => {
  const c = clock();
  let idle = 2_000;
  let reads = 0;
  const g = new BackgroundGate({ now: c.now, battery: null, systemIdle: async () => (reads++, ioreg(idle)) });
  expect(await g.blocked()).toBe("system");
  expect(await g.blocked()).toBe("system");
  expect(reads).toBe(1);
  // A pessoa parou: 30 s parado, o modelo anda.
  c.advance(SYSTEM_IDLE_MS - 2_000);
  idle = SYSTEM_IDLE_MS;
  expect(await g.blocked()).toBeNull();
  expect(reads).toBe(2);
  c.advance(5_000);
  expect(await g.blocked()).toBeNull();
  expect(reads).toBe(2);
  // Voltou a mexer: a próxima leitura (10 s depois) para o modelo de novo.
  idle = 500;
  c.advance(SYSTEM_IDLE_EVERY_MS);
  expect(await g.blocked()).toBe("system");
  expect(reads).toBe(3);
  // Entre leituras, o parado cresce com o relógio: 25 s lidos e 4 s depois, ainda espera; 1,5 s mais, anda, sem ler.
  idle = 25_000;
  c.advance(SYSTEM_IDLE_EVERY_MS);
  expect(await g.blocked()).toBe("system");
  expect(reads).toBe(4);
  c.advance(4_000);
  expect(await g.blocked()).toBe("system");
  c.advance(1_500);
  idle = 0; // uma leitura agora daria "mexendo"; a regra é não ler antes de 10 s
  expect(await g.blocked()).toBeNull();
  expect(reads).toBe(4);
});

test("sem resposta do ioreg, o tempo parado não segura nada", async () => {
  const g = new BackgroundGate({ now: clock().now, battery: null, systemIdle: async () => "" });
  expect(await g.blocked()).toBeNull();
});

test("o wait do tempo parado dorme até os 30 s, de 10 em 10 no máximo", async () => {
  const c = clock();
  const start = c.now();
  const slept: number[] = [];
  const g = new BackgroundGate({
    now: c.now,
    battery: null,
    systemIdle: async () => ioreg(25_000 + c.now() - start),
    sleep: async (ms) => {
      slept.push(ms);
      c.advance(ms);
    },
  });
  await g.wait();
  expect(slept).toEqual([5_000]);
});

test("o helper e as reuniões ligam o portão: o ditado, o agente, a reunião, e o ready solta os dois", async () => {
  const on = new Map<string, () => void>();
  let meeting!: (live: { recording: boolean }) => void;
  const g = new BackgroundGate({ now: clock().now, battery: null, systemIdle: null, quietMs: 0 });
  wireGate({ on: (t, fn) => on.set(t, fn) }, { onChange: (fn) => (meeting = fn) }, g);
  const fire = (t: string) => on.get(t)!();

  fire("record.started");
  expect(await g.blocked()).toBe("dictation");
  fire("record.stopped");
  expect(await g.blocked()).toBeNull();
  fire("record.started");
  fire("record.cancelled");
  expect(await g.blocked()).toBeNull();

  fire("agent.record.started");
  expect(await g.blocked()).toBe("agent");
  fire("agent.record.stopped");
  expect(await g.blocked()).toBeNull();
  fire("agent.record.started");
  fire("agent.record.cancelled");
  expect(await g.blocked()).toBeNull();

  meeting({ recording: true });
  expect(await g.blocked()).toBe("meeting");
  meeting({ recording: false });
  expect(await g.blocked()).toBeNull();

  // O helper caiu no meio do ditado e da fala com o agente: o novo manda o ready.
  fire("record.started");
  fire("agent.record.started");
  fire("ready");
  expect(await g.blocked()).toBeNull();
});
