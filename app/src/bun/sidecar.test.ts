import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { encode, LineDecoder, type Message } from "../shared/ipc.ts";
import { Sidecar, SidecarError, type SidecarOptions } from "./sidecar.ts";

const READY = {
  v: 1,
  type: "ready",
  version: "test",
  pid: 1,
  hotkey: "fn",
  hotkeyActive: true,
  permissions: {
    microphone: "granted",
    accessibility: "granted",
    inputMonitoring: "granted",
  },
  llm: { available: false },
} as const;

/**
 * Um helper de mentira: conecta no socket como o de verdade, manda o `ready` e responde cada comando com
 * `answer`. Cada "processo" fica numa lista, para o teste matar e ver o restart.
 */
interface FakeProcess {
  kill(signal?: "SIGTERM" | "SIGKILL"): void;
  exited: Promise<number>;
  socket?: any;
  signals: string[];
  finish(code: number, signal?: string): void;
  exitCode: number | null;
  signalCode: string | null;
}
function fakeHelper(
  answer: (m: any) => object | undefined = () => ({ ok: true, data: {} }),
  behavior: {
    ready?: boolean;
    ignoreTerm?: boolean;
    exitOnClose?: boolean;
    crashAfterMs?: number;
  } = {},
) {
  const procs: FakeProcess[] = [];
  const spawn = (argv: string[]) => {
    const socketPath = argv[argv.indexOf("--socket") + 1]!;
    let exit!: (code: number) => void,
      done = false;
    const proc: FakeProcess = {
      exited: new Promise<number>((r) => {
        exit = r;
      }),
      kill: () => {},
      signals: [],
      exitCode: null,
      signalCode: null,
      finish(code, signal) {
        if (done) return;
        done = true;
        proc.exitCode = code;
        proc.signalCode = signal ?? null;
        proc.socket?.end();
        exit(code);
      },
    };
    const decoder = new LineDecoder((m: Message) => {
      const reply = answer(m);
      if (reply && "id" in m)
        proc.socket.write(
          JSON.stringify({ v: 1, type: "result", id: m.id, ...reply }) + "\n",
        );
    });
    void Bun.connect({
      unix: socketPath,
      socket: {
        open(s) {
          proc.socket = s;
          if (behavior.ready !== false) s.write(encode(READY as any));
          if (behavior.crashAfterMs !== undefined)
            setTimeout(() => proc.finish(7), behavior.crashAfterMs);
        },
        data(_s, chunk) {
          decoder.push(chunk);
        },
        close() {
          if (behavior.exitOnClose !== false) proc.finish(0);
        },
      },
    });
    proc.kill = (signal = "SIGTERM") => {
      proc.signals.push(signal);
      if (signal === "SIGTERM" && behavior.ignoreTerm) return;
      proc.finish(signal === "SIGKILL" ? 137 : 0, signal);
    };
    procs.push(proc);
    return proc;
  };
  return { spawn, procs };
}

let dir: string;
let sidecar: Sidecar | undefined;
afterEach(async () => {
  await sidecar?.stop();
  sidecar = undefined;
  rmSync(dir, { recursive: true, force: true });
});

function make(
  helper: ReturnType<typeof fakeHelper>,
  requestTimeoutMs?: number,
  overrides: Partial<SidecarOptions> = {},
) {
  dir = mkdtempSync(path.join(tmpdir(), "kiwi-sidecar-"));
  sidecar = new Sidecar({
    helper: "kiwi-helper",
    socketPath: path.join(dir, "s.sock"),
    spawn: helper.spawn,
    requestTimeoutMs,
    log: () => {},
    ...overrides,
  });
  sidecar.start();
  return sidecar;
}

describe("Sidecar", () => {
  test("listens on a 0600 socket, gets ready and matches results by id", async () => {
    const s = make(
      fakeHelper((m) =>
        m.type === "ping"
          ? { ok: true, data: {} }
          : { ok: false, error: "not_implemented" },
      ),
    );
    expect(statSync(path.join(dir, "s.sock")).mode & 0o777).toBe(0o600);
    const ready = await s.whenReady();
    expect(ready.hotkey).toBe("fn");
    expect((await s.request({ type: "ping" })).ok).toBe(true);
    const failed = await s.send({ type: "notify", title: "a", body: "b" });
    expect(failed).toMatchObject({ ok: false, error: "not_implemented" });
    await expect(
      s.request({ type: "notify", title: "a", body: "b" }),
    ).rejects.toBeInstanceOf(SidecarError);
  });

  test("events reach their listeners, and permissions.changed updates ready.llm", async () => {
    const helper = fakeHelper();
    const s = make(helper);
    await s.whenReady();
    const got: string[] = [];
    s.on("app.active", (e) => got.push(e.name));
    s.on("*", (e) => got.push(`*${e.type}`));
    helper.procs[0]!.socket.write(
      JSON.stringify({
        v: 1,
        type: "app.active",
        bundleId: "com.apple.mail",
        name: "Mail",
      }) + "\n",
    );
    helper.procs[0]!.socket.write(
      JSON.stringify({
        v: 1,
        type: "permissions.changed",
        permissions: READY.permissions,
        hotkeyActive: false,
        llm: { available: true },
      }) + "\n",
    );
    await Bun.sleep(30);
    expect(got).toEqual(["Mail", "*app.active", "*permissions.changed"]);
    expect(s.ready?.llm).toEqual({ available: true });
    expect(s.ready?.hotkeyActive).toBe(false);
  });

  test("a big message arrives whole, even when the socket takes it in pieces (review #521)", async () => {
    // The fake helper answers with the size of what it got; 600 terms with aliases is ~30 KB, this is ~200 KB.
    const helper = fakeHelper((m) => ({
      ok: true,
      data: { bytes: JSON.stringify(m).length },
    }));
    const s = make(helper, 5000);
    await s.whenReady();
    const dictionary = Array.from({ length: 4000 }, (_, i) => ({
      term: `Termo${i}`,
      aliases: [`alias numero ${i}`],
    }));
    const command = { type: "config.set" as const, dictionary };
    const [big, small] = await Promise.all([
      s.send(command),
      s.send({ type: "ping" }),
    ]);
    expect(big.ok).toBe(true);
    expect((big as any).data.bytes).toBeGreaterThan(200_000);
    expect(small.ok).toBe(true);
  });

  test("a helper that can't start (ENOENT) doesn't take the app down: it's tried again", async () => {
    const helper = fakeHelper();
    let attempts = 0;
    dir = mkdtempSync(path.join(tmpdir(), "kiwi-sidecar-"));
    sidecar = new Sidecar({
      helper: "/no/such/kiwi-helper",
      socketPath: path.join(dir, "s.sock"),
      spawn: (argv) => {
        if (attempts++ === 0)
          throw new Error("ENOENT: no such file or directory, posix_spawn");
        return helper.spawn(argv);
      },
      log: () => {},
    });
    expect(() => sidecar!.start()).not.toThrow();
    expect((await sidecar.whenReady()).type).toBe("ready");
    expect(attempts).toBe(2);
  });

  test("a request without an answer times out", async () => {
    const s = make(
      fakeHelper(() => undefined),
      50,
    );
    await s.whenReady();
    await expect(s.request({ type: "ping" })).rejects.toMatchObject({
      code: "sidecar_timeout",
    });
  });

  test("when the helper dies, pending requests fail and a new helper is started", async () => {
    const helper = fakeHelper(() => undefined);
    const s = make(helper);
    await s.whenReady();
    const pending = s.request({ type: "ping" });
    helper.procs[0]!.kill();
    await expect(pending).rejects.toMatchObject({ code: "sidecar_closed" });
    await expect(s.request({ type: "ping" })).rejects.toMatchObject({
      code: "sidecar_closed",
    });
    const again = await s.whenReady();
    expect(again.type).toBe("ready");
    expect(helper.procs).toHaveLength(2);
  });

  test("onClose tells when the helper goes away, so the menu stops saying it's ready (T914)", async () => {
    const helper = fakeHelper();
    const s = make(helper);
    await s.whenReady();
    let closed = 0;
    s.onClose(() => {
      closed++;
      expect(s.ready).toBeUndefined();
    });
    helper.procs[0]!.kill();
    await Bun.sleep(30);
    expect(closed).toBe(1);
  });
});

test("unstable ready must not reset restart backoff (T5351 reproduction)", async () => {
  const helper = fakeHelper();
  const spawn = helper.spawn;
  helper.spawn = (argv) => {
    const proc = spawn(argv);
    setTimeout(() => proc.kill(), 10);
    return proc;
  };
  make(helper);
  await Bun.sleep(1150);
  // First restart at ~0.5s; the next one must wait another ~1s, despite ready.
  expect(helper.procs.length).toBe(2);
});

const until = async (check: () => boolean) => {
  const end = Date.now() + 1500;
  while (!check() && Date.now() < end) await Bun.sleep(2);
  expect(check()).toBe(true);
};

test("ready/crash loop exhausts the rolling budget and logs code/signal without command payload", async () => {
  const helper = fakeHelper(undefined, { crashAfterMs: 5 });
  const logs: string[] = [];
  const s = make(helper, undefined, {
    supervision: { stableMs: 100, backoffMs: 10, maxCrashes: 3 },
    log: (m) => logs.push(m),
  });
  await until(() => s.supervision().state === "failed");
  expect(helper.procs.length).toBe(3);
  expect(s.exits).toHaveLength(3);
  expect(logs.some((m) => m.includes("waitMs=20"))).toBe(true);
  expect(logs.some((m) => m.includes("exitCode=7 signal=none"))).toBe(true);
  expect(logs.at(-1)).toContain("supervisor failed");
  await expect(s.whenReady()).rejects.toMatchObject({ code: "sidecar_failed" });
  await Bun.sleep(50);
  expect(helper.procs.length).toBe(3);
});

test("only a stable ready resets the backoff, while the rolling crash budget remains", async () => {
  const helper = fakeHelper();
  const s = make(helper, undefined, {
    supervision: { stableMs: 30, backoffMs: 10, maxCrashes: 10 },
  });
  await s.whenReady();
  helper.procs[0]!.finish(7);
  await until(() => helper.procs.length === 2 && !!s.ready);
  await Bun.sleep(45);
  helper.procs[1]!.finish(7);
  await until(() => s.supervision().state === "backoff");
  expect(s.supervision()).toMatchObject({ restartInMs: 10, crashes: 2 });
});

test("no ready has a deadline; the original whenReady waiter rejects at terminal failure", async () => {
  const helper = fakeHelper(undefined, { ready: false });
  const s = make(helper, undefined, {
    supervision: { readyTimeoutMs: 15, backoffMs: 5, maxCrashes: 2 },
  });
  await expect(s.whenReady()).rejects.toMatchObject({ code: "sidecar_failed" });
  expect(s.supervision()).toMatchObject({
    state: "failed",
    reason: "ready_timeout",
  });
  expect(helper.procs).toHaveLength(2);
  expect(helper.procs[0]!.signals).toEqual(["SIGTERM"]);
});

test("three consecutive missing pongs restart the helper after their deadlines", async () => {
  const helper = fakeHelper((m) =>
    m.type === "ping" ? undefined : { ok: true, data: {} },
  );
  const s = make(helper, 1000, {
    supervision: {
      pingIntervalMs: 10,
      pingTimeoutMs: 10,
      backoffMs: 5,
      maxCrashes: 2,
    },
  });
  await until(() => s.supervision().state === "failed");
  expect(s.supervision().reason).toBe("ping_timeout");
  expect(helper.procs).toHaveLength(2);
  expect(s.ready).toBeUndefined();
  expect(s.exits).toHaveLength(2);
});

test("stop escalates from SIGTERM to SIGKILL and waits for exit, even without a socket", async () => {
  const helper = fakeHelper(undefined, {
    ignoreTerm: true,
    exitOnClose: false,
  });
  const logs: string[] = [];
  const s = make(helper, undefined, {
    supervision: { terminateMs: 15 },
    log: (m) => logs.push(m),
  });
  await s.whenReady();
  const stopping = s.stop();
  expect(helper.procs[0]!.signals).toEqual(["SIGTERM"]);
  await stopping;
  expect(helper.procs[0]!.signals).toEqual(["SIGTERM", "SIGKILL"]);
  expect(s.exits).toMatchObject([{ code: 137, signal: "SIGKILL" }]);
  expect(logs.some((m) => m.includes("signal=SIGKILL reason=stop"))).toBe(true);
  await Bun.sleep(30);
  expect(helper.procs).toHaveLength(1);
});

test("stop cancels a scheduled restart", async () => {
  const helper = fakeHelper();
  const s = make(helper, undefined, { supervision: { backoffMs: 40 } });
  await s.whenReady();
  helper.procs[0]!.finish(7);
  await until(() => s.supervision().state === "backoff");
  await s.stop();
  await Bun.sleep(60);
  expect(helper.procs).toHaveLength(1);
});

test("spawn failures also have a finite budget and do not log the exception text", async () => {
  let attempts = 0;
  const logs: string[] = [];
  const s = make(fakeHelper(), undefined, {
    spawn: () => {
      attempts++;
      throw new Error("private payload");
    },
    supervision: { maxCrashes: 3, backoffMs: 5 },
    log: (m) => logs.push(m),
  });
  await expect(s.whenReady()).rejects.toMatchObject({ code: "sidecar_failed" });
  expect(attempts).toBe(3);
  expect(logs.join("\n")).not.toContain("private payload");
});

test("socket loss kills the old process before any replacement is started", async () => {
  const helper = fakeHelper(undefined, {
    ignoreTerm: true,
    exitOnClose: false,
  });
  const s = make(helper, undefined, {
    supervision: { terminateMs: 25, backoffMs: 10, maxCrashes: 1 },
  });
  await s.whenReady();
  helper.procs[0]!.socket.end();
  await Bun.sleep(10);
  expect(helper.procs).toHaveLength(1);
  expect(helper.procs[0]!.signals).toEqual(["SIGTERM"]);
  await until(() => s.supervision().state === "failed");
  expect(helper.procs[0]!.signals).toEqual(["SIGTERM", "SIGKILL"]);
  expect(s.supervision().reason).toBe("socket_closed");
});

test("old crashes expire from the rolling window", async () => {
  const helper = fakeHelper();
  const s = make(helper, undefined, {
    supervision: { windowMs: 30, maxCrashes: 2, stableMs: 1000, backoffMs: 10 },
  });
  await s.whenReady();
  helper.procs[0]!.finish(7);
  await until(() => helper.procs.length === 2 && !!s.ready);
  await Bun.sleep(40);
  helper.procs[1]!.finish(7);
  await until(() => s.supervision().state === "backoff");
  expect(s.supervision().crashes).toBe(1);
});

test("stop also escalates before the helper ever connects; numeric signals are normalized", async () => {
  let exited!: (code: number) => void;
  const signals: string[] = [];
  const proc = {
    exited: new Promise<number>((r) => {
      exited = r;
    }),
    signalCode: null as number | null,
    kill(signal?: "SIGTERM" | "SIGKILL") {
      signals.push(signal!);
      if (signal === "SIGKILL") {
        proc.signalCode = 9;
        exited(137);
      }
    },
  };
  const s = make(fakeHelper(), undefined, {
    spawn: () => proc,
    supervision: { terminateMs: 10 },
  });
  await s.stop();
  expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
  expect(s.exits).toMatchObject([{ code: 137, signal: "SIGKILL" }]);
});

test("healthy pongs keep the same helper, even when it repeats ready", async () => {
  let pings = 0;
  const helper = fakeHelper((m) => {
    if (m.type === "ping") pings++;
    return { ok: true, data: {} };
  });
  const s = make(helper, undefined, {
    supervision: { pingIntervalMs: 10, pingTimeoutMs: 20 },
  });
  await s.whenReady();
  const repeats = setInterval(
    () => helper.procs[0]!.socket.write(encode(READY as any)),
    4,
  );
  try {
    await until(() => pings >= 2);
    expect(s.supervision().state).toBe("ready");
    expect(helper.procs).toHaveLength(1);
  } finally {
    clearInterval(repeats);
  }
});

test("one lost ping does not kill the helper, and a pong resets the consecutive count", async () => {
  let pings = 0;
  // Two losses, one pong, two more losses: never three in a row.
  const helper = fakeHelper((m) => {
    if (m.type !== "ping") return { ok: true, data: {} };
    pings++;
    return pings === 3 || pings >= 6 ? { ok: true, data: {} } : undefined;
  });
  const logs: string[] = [];
  const s = make(helper, undefined, {
    supervision: { pingIntervalMs: 5, pingTimeoutMs: 5 },
    log: (m) => logs.push(m),
  });
  await until(() => pings >= 6);
  expect(helper.procs).toHaveLength(1);
  expect(s.exits).toHaveLength(0);
  expect(logs.filter((m) => m.includes("missed=1 "))).toHaveLength(2);
  expect(logs.filter((m) => m.includes("missed=2 "))).toHaveLength(2);
  expect(logs.some((m) => m.includes("missed=3 "))).toBe(false);
});

test("three consecutive ping deadlines terminate exactly after the third loss", async () => {
  let pings = 0;
  const helper = fakeHelper((m) => {
    if (m.type === "ping") {
      pings++;
      return undefined;
    }
    return { ok: true, data: {} };
  });
  const s = make(helper, undefined, {
    supervision: { pingIntervalMs: 5, pingTimeoutMs: 5, maxCrashes: 1 },
  });
  await until(() => s.supervision().state === "failed");
  expect(pings).toBe(3);
  expect(helper.procs).toHaveLength(1);
  expect(helper.procs[0]!.signals).toEqual(["SIGTERM"]);
  expect(s.supervision().reason).toBe("ping_timeout");
});

test("a valid pong arriving after its deadline also clears the missed count", async () => {
  let pings = 0;
  const timers: Timer[] = [];
  const helper = fakeHelper((m) => {
    if (m.type !== "ping") return { ok: true, data: {} };
    pings++;
    timers.push(
      setTimeout(
        () =>
          helper.procs[0]!.socket.write(
            encode({
              v: 1,
              type: "result",
              id: m.id,
              ok: true,
              data: {},
            } as Message),
          ),
        20,
      ),
    );
    return undefined;
  });
  const logs: string[] = [];
  const s = make(helper, undefined, {
    supervision: { pingIntervalMs: 15, pingTimeoutMs: 5 },
    log: (m) => logs.push(m),
  });
  try {
    await until(() => pings >= 4);
    await Bun.sleep(22);
    expect(s.supervision().state).toBe("ready");
    expect(helper.procs).toHaveLength(1);
    expect(logs.some((m) => m.includes("missed=2 "))).toBe(false);
  } finally {
    for (const timer of timers) clearTimeout(timer);
  }
});
