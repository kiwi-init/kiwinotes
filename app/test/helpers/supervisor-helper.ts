#!/usr/bin/env bun
// T5351: fake process, no native APIs, mic, permissions, clipboard or user files.
import { encode, LineDecoder, type Message } from "../../src/shared/ipc.ts";
const socketPath = process.argv[process.argv.indexOf("--socket") + 1]!;
const hang = process.env.KIWI_FAKE_SUPERVISOR === "hang";
if (hang) {
  process.on("SIGTERM", () => {});
  setInterval(() => {}, 1000);
}
let connection: { write(data: Uint8Array): number } | undefined;
const decoder = new LineDecoder((m: Message) => {
  if ("id" in m)
    connection?.write(
      encode({ v: 1, type: "result", id: m.id, ok: true, data: {} } as Message),
    );
});
await Bun.connect({
  unix: socketPath,
  socket: {
    open(s) {
      connection = s;
      s.write(
        encode({
          v: 1,
          type: "ready",
          version: "fake-supervisor",
          pid: process.pid,
          hotkey: "fn",
          hotkeyActive: true,
          permissions: {
            microphone: "granted",
            accessibility: "granted",
            inputMonitoring: "granted",
          },
          llm: { available: false },
        } as Message),
      );
      if (!hang) setTimeout(() => process.exit(7), 30);
    },
    data(_s, chunk) {
      decoder.push(chunk);
    },
    close() {
      /* hung fake stays alive even after losing the socket */
    },
  },
});
