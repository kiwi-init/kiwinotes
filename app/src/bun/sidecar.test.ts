import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { encode, LineDecoder, type Message } from "../shared/ipc.ts";
import { Sidecar, SidecarError } from "./sidecar.ts";

const READY = {
  v: 1,
  type: "ready",
  version: "test",
  pid: 1,
  hotkey: "fn",
  hotkeyActive: true,
  permissions: { microphone: "granted", accessibility: "granted", inputMonitoring: "granted" },
  llm: { available: false },
} as const;

/**
 * Um helper de mentira: conecta no socket como o de verdade, manda o `ready` e responde cada comando com
 * `answer`. Cada "processo" fica numa lista, para o teste matar e ver o restart.
 */
function fakeHelper(answer: (m: any) => object | undefined = () => ({ ok: true, data: {} })) {
  const procs: { kill(): void; exited: Promise<unknown>; socket?: any }[] = [];
  const spawn = (argv: string[]) => {
    const socketPath = argv[argv.indexOf("--socket") + 1]!;
    let exit!: () => void;
    const proc = { exited: new Promise<void>((r) => (exit = r)), kill: () => {}, socket: undefined as any };
    const decoder = new LineDecoder((m: Message) => {
      const reply = answer(m);
      if (reply && "id" in m) proc.socket.write(JSON.stringify({ v: 1, type: "result", id: m.id, ...reply }) + "\n");
    });
    void Bun.connect({
      unix: socketPath,
      socket: {
        open(s) {
          proc.socket = s;
          s.write(encode(READY as any));
        },
        data(_s, chunk) {
          decoder.push(chunk);
        },
        close() {
          exit();
        },
      },
    });
    proc.kill = () => {
      proc.socket?.end();
      exit();
    };
    procs.push(proc);
    return proc;
  };
  return { spawn, procs };
}

let dir: string;
let sidecar: Sidecar | undefined;
afterEach(() => {
  sidecar?.stop();
  sidecar = undefined;
  rmSync(dir, { recursive: true, force: true });
});

function make(helper: ReturnType<typeof fakeHelper>, requestTimeoutMs?: number) {
  dir = mkdtempSync(path.join(tmpdir(), "kiwi-sidecar-"));
  sidecar = new Sidecar({ helper: "kiwi-helper", socketPath: path.join(dir, "s.sock"), spawn: helper.spawn, requestTimeoutMs, log: () => {} });
  sidecar.start();
  return sidecar;
}

describe("Sidecar", () => {
  test("listens on a 0600 socket, gets ready and matches results by id", async () => {
    const s = make(fakeHelper((m) => (m.type === "ping" ? { ok: true, data: {} } : { ok: false, error: "not_implemented" })));
    expect(statSync(path.join(dir, "s.sock")).mode & 0o777).toBe(0o600);
    const ready = await s.whenReady();
    expect(ready.hotkey).toBe("fn");
    expect((await s.request({ type: "ping" })).ok).toBe(true);
    const failed = await s.send({ type: "notify", title: "a", body: "b" });
    expect(failed).toMatchObject({ ok: false, error: "not_implemented" });
    await expect(s.request({ type: "notify", title: "a", body: "b" })).rejects.toBeInstanceOf(SidecarError);
  });

  test("events reach their listeners, and permissions.changed updates ready.llm", async () => {
    const helper = fakeHelper();
    const s = make(helper);
    await s.whenReady();
    const got: string[] = [];
    s.on("app.active", (e) => got.push(e.name));
    s.on("*", (e) => got.push(`*${e.type}`));
    helper.procs[0]!.socket.write(JSON.stringify({ v: 1, type: "app.active", bundleId: "com.apple.mail", name: "Mail" }) + "\n");
    helper.procs[0]!.socket.write(
      JSON.stringify({ v: 1, type: "permissions.changed", permissions: READY.permissions, hotkeyActive: false, llm: { available: true } }) + "\n",
    );
    await Bun.sleep(30);
    expect(got).toEqual(["Mail", "*app.active", "*permissions.changed"]);
    expect(s.ready?.llm).toEqual({ available: true });
    expect(s.ready?.hotkeyActive).toBe(false);
  });

  test("a request without an answer times out", async () => {
    const s = make(fakeHelper(() => undefined), 50);
    await s.whenReady();
    await expect(s.request({ type: "ping" })).rejects.toMatchObject({ code: "sidecar_timeout" });
  });

  test("when the helper dies, pending requests fail and a new helper is started", async () => {
    const helper = fakeHelper(() => undefined);
    const s = make(helper);
    await s.whenReady();
    const pending = s.request({ type: "ping" });
    helper.procs[0]!.kill();
    await expect(pending).rejects.toMatchObject({ code: "sidecar_closed" });
    await expect(s.request({ type: "ping" })).rejects.toMatchObject({ code: "sidecar_closed" });
    const again = await s.whenReady();
    expect(again.type).toBe("ready");
    expect(helper.procs).toHaveLength(2);
  });
});
