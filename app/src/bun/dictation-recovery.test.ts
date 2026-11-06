import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Dictation, type DictationSidecar } from "./dictation.ts";
import { RecordingRecoveries } from "../store/recording-recovery.ts";
import { HistoryStore } from "../store/history.ts";
import type { Command, Event } from "../shared/ipc.ts";
const all: {
  dir: string;
  dictation: Dictation;
  recoveries: RecordingRecoveries;
}[] = [];
async function rig(insertFails = false) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kn-dictation-recover-"));
  const recoveries = new RecordingRecoveries(dir),
    history = new HistoryStore(dir, recoveries);
  const ref = { id: crypto.randomUUID(), at: new Date().toISOString() };
  await mkdir(recoveries.dir, { recursive: true, mode: 0o700 });
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(3236, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(3200, 40);
  await writeFile(
    path.join(recoveries.dir, ref.id + ".wav"),
    Buffer.concat([header, Buffer.alloc(3200)]),
    { mode: 0o600 },
  );
  await writeFile(
    path.join(recoveries.dir, ref.id + ".json"),
    JSON.stringify(ref),
    { mode: 0o600 },
  );
  const listeners = new Map<string, Set<(e: any) => void>>(),
    sent: Command[] = [];
  const fake = {
    on: (type: string, fn: (e: any) => void) => {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(fn);
      return () => set!.delete(fn);
    },
    send: async (command: Command) => {
      sent.push(command);
      return command.type === "insert.text" && insertFails
        ? { v: 1, type: "result", id: "x", ok: false, error: "insert_failed" }
        : {
            v: 1,
            type: "result",
            id: "x",
            ok: true,
            data:
              command.type === "insert.text"
                ? { pasted: false, dryRun: true }
                : {},
          };
    },
  } as unknown as DictationSidecar;
  const dictation = new Dictation({
    sidecar: fake,
    history,
    recovery: recoveries,
    dryRun: true,
    log: () => {},
  });
  dictation.attach();
  const emit = (event: Event) => {
    for (const fn of listeners.get(event.type) ?? []) fn({ v: 1, ...event });
  };
  all.push({ dir, dictation, recoveries });
  return { dir, dictation, recoveries, history, ref, emit, sent };
}
afterEach(async () => {
  for (const r of all.splice(0)) {
    r.dictation.detach();
    r.recoveries.stop();
    await rm(r.dir, { recursive: true, force: true });
  }
});
const final = (
  recovery: { id: string; at: string },
  text = "teste de recuperação",
): Event => ({
  type: "transcript.final",
  text,
  raw: text,
  lang: "pt",
  durationMs: 100,
  latencyMs: 1,
  recovery,
});
test("STT failure retains the managed WAV and shows a retry row", async () => {
  const r = await rig();
  r.emit({ type: "record.started", reason: "debug", recovery: r.ref });
  expect((await r.history.search()).entries).toEqual([]);
  r.emit({ type: "transcript.error", error: "stt_failed", recovery: r.ref });
  await r.dictation.idle();
  expect((await r.history.search()).entries).toMatchObject([
    { text: "", recoveryId: r.ref.id, recoveryError: "stt_failed" },
  ]);
  expect((await readdir(r.recoveries.dir)).length).toBe(2);
  expect(r.sent.some((c) => c.type === "insert.text")).toBe(false);
});
test("confirmed dry-run delivery persists text then removes the managed WAV and manifest", async () => {
  const r = await rig();
  r.emit({ type: "record.started", reason: "debug", recovery: r.ref });
  r.emit(final(r.ref));
  await r.dictation.idle();
  expect((await r.history.search()).entries).toMatchObject([
    { text: "Teste de recuperação." },
  ]);
  expect((await r.history.search()).entries[0]).not.toHaveProperty(
    "recoveryId",
  );
  expect(await readdir(r.recoveries.dir)).toEqual([]);
  expect(r.sent.filter((c) => c.type === "insert.text")).toMatchObject([
    { dryRun: true },
  ]);
});
test("failed insertion keeps one history entry with text and a retry, not a duplicate placeholder", async () => {
  const r = await rig(true);
  r.emit({ type: "record.started", reason: "debug", recovery: r.ref });
  r.emit(final(r.ref));
  await r.dictation.idle();
  const page = await r.history.search();
  expect(page.entries).toHaveLength(1);
  expect(page.entries[0]).toMatchObject({
    text: "Teste de recuperação.",
    recoveryId: r.ref.id,
  });
  expect((await readdir(r.recoveries.dir)).length).toBe(2);
});
test("cancel discards immediately; an empty STT with actual audio remains recoverable", async () => {
  const r = await rig();
  r.emit({ type: "record.started", reason: "debug", recovery: r.ref });
  r.emit({ type: "record.cancelled", reason: "hotkey" });
  await r.dictation.idle();
  expect(await readdir(r.recoveries.dir)).toEqual([]);
  expect((await r.history.search()).entries).toEqual([]);
  const silent = await rig();
  silent.emit({
    type: "record.started",
    reason: "debug",
    recovery: silent.ref,
  });
  silent.emit(final(silent.ref, ""));
  await silent.dictation.idle();
  expect((await silent.history.search()).entries).toMatchObject([
    { recoveryId: silent.ref.id, recoveryError: "stt_empty" },
  ]);
});
