#!/usr/bin/env bun
// T7444: um helper falso que cai no meio de uma reunião. Sem mic, sem permissões de verdade, sem clipboard.
// Na 1ª subida, começa uma reunião sozinho (como o helper de verdade faz depois do "Gravar" do pop-up), manda duas falas
// e sai com 9. Da 2ª subida em diante, só responde. O número da subida fica em KIWI_FAKE_STATE.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { encode, LineDecoder, type Message } from "../../src/shared/ipc.ts";

const socketPath = process.argv[process.argv.indexOf("--socket") + 1]!;
const stateFile = process.env.KIWI_FAKE_STATE!;
const spawnNo = (existsSync(stateFile) ? Number(readFileSync(stateFile, "utf8")) : 0) + 1;
writeFileSync(stateFile, String(spawnNo));

let sock: { write(d: string): number } | undefined;
const send = (m: Record<string, unknown>) => sock?.write(encode({ v: 1, ...m } as unknown as Message));
const decoder = new LineDecoder((m: Message) => {
  const id = (m as { id?: string }).id;
  if (id !== undefined) send({ type: "result", id, ok: true, data: {} });
});

await Bun.connect({
  unix: socketPath,
  socket: {
    open(s) {
      sock = s;
      send({
        type: "ready", version: `fake-meeting-crash-${spawnNo}`, pid: process.pid, hotkey: "fn", hotkeyActive: true,
        permissions: { microphone: "granted", accessibility: "granted", inputMonitoring: "granted" }, llm: { available: false },
      });
      if (spawnNo !== 1) return;
      const session = "crash1";
      setTimeout(() => send({ type: "meeting.started", session, app: "Teams", sampleRate: 16000, output: "headphones" }), 100);
      setTimeout(() => send({ type: "meeting.segment", session, start: 0, end: 3, speaker: "Eu", text: "Primeira fala antes da queda.", final: true, channel: "mine" }), 200);
      setTimeout(() => send({ type: "meeting.segment", session, start: 3, end: 6, speaker: "Eu", text: "Segunda fala antes da queda.", final: true, channel: "mine" }), 300);
      setTimeout(() => process.exit(9), 500);
    },
    data(_s, chunk) {
      decoder.push(chunk);
    },
    close() {
      process.exit(0);
    },
  },
});
