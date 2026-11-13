import { describe, expect, test } from "bun:test";

import {
  defaultSocketPath,
  encode,
  IpcError,
  isCommand,
  isEvent,
  isResult,
  LineDecoder,
  MAX_LINE_BYTES,
  type Message,
  parseLine,
} from "./ipc.ts";

function collect() {
  const messages: Message[] = [];
  const errors: IpcError[] = [];
  const decoder = new LineDecoder(
    (m) => messages.push(m),
    (e) => errors.push(e),
  );
  return { decoder, messages, errors };
}

describe("encode/parseLine", () => {
  test("os comandos do gato no overlay (spec #9810) vão e voltam, e um tipo errado é recusado", () => {
    const cmds: Message[] = [
      { v: 1, id: "c1", type: "catOverlay.load", dir: "/Applications/Kiwi Notes.app/Contents/Resources/app/views/ui/catoverlay" },
      { v: 1, id: "c2", type: "catOverlay.show", estado: "acordou", fadeMs: 180 },
      { v: 1, id: "c3", type: "catOverlay.state", estado: "thinking" },
      { v: 1, id: "c4", type: "catOverlay.hide", fadeMs: 160 },
      { v: 1, id: "c5", type: "catOverlay.unload" },
    ];
    for (const m of cmds) {
      expect(parseLine(encode(m).slice(0, -1))).toEqual(m);
      expect(isCommand(m)).toBe(true);
    }
    expect(() => parseLine(JSON.stringify({ v: 1, id: "x", type: "catOverlay.explode" }))).toThrow();
  });

  test("round-trips a command, an event and a result", () => {
    const cmd: Message = { v: 1, id: "1", type: "insert.text", text: "olá", restoreClipboard: true };
    const ev: Message = { v: 1, type: "transcript.final", text: "oi", raw: "oi", lang: "pt", durationMs: 820, latencyMs: 160 };
    const res: Message = { v: 1, type: "result", id: "1", ok: true, data: { pasted: true, restored: true } };
    const fail: Message = { v: 1, type: "result", id: "2", ok: false, error: "not_implemented" };
    for (const m of [cmd, ev, res, fail]) {
      const line = encode(m);
      expect(line.endsWith("\n")).toBe(true);
      expect(line.slice(0, -1)).not.toContain("\n");
      expect(parseLine(line.slice(0, -1))).toEqual(m);
    }
    expect(isCommand(cmd)).toBe(true);
    expect(isEvent(ev)).toBe(true);
    expect(isResult(res)).toBe(true);
  });

  test("debug.transcribe is a command (it needs an id)", () => {
    const cmd: Message = { v: 1, id: "9", type: "debug.transcribe", path: "/tmp/frase.aiff" };
    expect(isCommand(parseLine(encode(cmd).toString().trim()))).toBe(true);
  });

  test("rejects bad JSON, wrong version, unknown type and commands without id", () => {
    const code = (line: string) => {
      try {
        parseLine(line);
        return "ok";
      } catch (e) {
        return (e as IpcError).code;
      }
    };
    expect(code("{nope")).toBe("bad_json");
    expect(code("[1]")).toBe("bad_message");
    expect(code(`{"v":2,"type":"hotkey.down"}`)).toBe("bad_version");
    expect(code(`{"v":1,"type":"audio.chunk"}`)).toBe("bad_message");
    expect(code(`{"v":1,"type":"record.start"}`)).toBe("bad_message");
    expect(code(`{"v":1,"type":"result","id":"9"}`)).toBe("bad_message");
    expect(code(`{"v":1,"type":"hotkey.down"}`)).toBe("ok");
  });

  test("refuses to encode a line over 1 MB", () => {
    const big: Message = { v: 1, id: "2", type: "insert.text", text: "a".repeat(MAX_LINE_BYTES), restoreClipboard: false };
    expect(() => encode(big)).toThrow(IpcError);
  });
});

test("parses lines exactly as the Swift sidecar (T50) emits them", () => {
  const lines = [
    `{"v":1,"type":"ready","version":"0.1.0","pid":42,"hotkey":"fn","hotkeyActive":false,"permissions":{"microphone":"granted","accessibility":"denied","inputMonitoring":"undetermined"}}`,
    `{"v":1,"type":"hotkey.down","key":"fn"}`,
    `{"v":1,"type":"record.cancelled","reason":"hotkey"}`,
    `{"v":1,"type":"record.error","reason":"hotkey","error":"noInput","microphone":"denied"}`,
    `{"v":1,"type":"record.stopped","reason":"hotkey","mode":"ptt","durationMs":1200,"samples":19200}`,
    `{"v":1,"type":"result","id":"7","ok":false,"error":"hotkeys_must_match"}`,
    `{"v":1,"type":"result","id":"8","ok":true,"data":{"hotkey":"rightOption","hotkeyActive":true}}`,
    // T457, from a `--stdio` run with `debug.transcribe` (KIWI_DEBUG=1) on a `say` clip.
    `{"bundleId":"com.apple.mail","name":"Mail","pid":4009,"type":"app.active","v":1}`,
    `{"app":{"bundleId":"com.apple.mail","name":"Mail"},"reason":"debug","type":"record.started","v":1}`,
    `{"durationMs":3634,"mode":"debug","reason":"debug","samples":58158,"type":"record.stopped","v":1}`,
    `{"state":"ready","type":"stt.status","v":1}`,
    `{"state":"loading","type":"stt.boosting","v":1}`,
    // T1499: the Notes window shortcut, emitted with no fields.
    `{"type":"hotkey.notes","v":1}`,
  ];
  expect(lines.map((l) => parseLine(l).type)).toEqual([
    "ready",
    "hotkey.down",
    "record.cancelled",
    "record.error",
    "record.stopped",
    "result",
    "result",
    "app.active",
    "record.started",
    "record.stopped",
    "stt.status",
    "stt.boosting",
    "hotkey.notes",
  ]);
});

describe("LineDecoder", () => {
  test("splits several messages in one chunk and joins one split across chunks", () => {
    const { decoder, messages, errors } = collect();
    const a = encode({ v: 1, type: "hotkey.down", key: "fn" });
    const b = encode({ v: 1, type: "audio.level", rms: 0.4 });
    const c = encode({ v: 1, type: "hotkey.up", key: "fn" });
    decoder.push(a + b.slice(0, 10));
    decoder.push(new TextEncoder().encode(b.slice(10) + c));
    expect(messages.map((m) => m.type)).toEqual(["hotkey.down", "audio.level", "hotkey.up"]);
    expect(errors).toEqual([]);
  });

  test("decodes UTF-8 split in the middle of a character", () => {
    const { decoder, messages } = collect();
    const bytes = new TextEncoder().encode(encode({ v: 1, type: "transcript.partial", text: "ação" }));
    const cut = bytes.indexOf(0xc3) + 1; // no meio do "ç"
    decoder.push(bytes.slice(0, cut));
    decoder.push(bytes.slice(cut));
    expect(messages).toEqual([{ v: 1, type: "transcript.partial", text: "ação" }]);
  });

  test("a bad line reports an error and the next one still arrives", () => {
    const { decoder, messages, errors } = collect();
    decoder.push(`garbage\n\n${encode({ v: 1, type: "hotkey.up", key: "fn" })}`);
    expect(errors.map((e) => e.code)).toEqual(["bad_json"]);
    expect(messages.map((m) => m.type)).toEqual(["hotkey.up"]);
  });

  test("drops a line over 1 MB up to its newline and recovers", () => {
    const { decoder, messages, errors } = collect();
    const half = "x".repeat(MAX_LINE_BYTES / 2 + 1);
    decoder.push(half);
    decoder.push(half);
    decoder.push(`tail\n${encode({ v: 1, type: "hotkey.down", key: "fn" })}`);
    expect(errors.map((e) => e.code)).toEqual(["line_too_long"]);
    expect(messages.map((m) => m.type)).toEqual(["hotkey.down"]);
  });
});

test("meeting detection (R2): the pop-up's events, its answers and the meeting settings", () => {
  const messages: Message[] = [
    { v: 1, id: "c1", type: "config.set", meetingShortcut: "control+option+r", meetingPauseShortcut: null, meetingSuggest: true, meetingApps: [{ bundleId: "com.microsoft.teams2", name: "Teams" }] },
    { v: 1, id: "a1", type: "meeting.answer", answer: "notNow" },
    { v: 1, id: "d1", type: "debug.meetingMicUsers", users: [{ pid: 500, bundleId: "com.microsoft.teams2" }] },
    { v: 1, type: "meeting.suggested", app: { bundleId: "com.microsoft.teams2", name: "Teams" } },
    { v: 1, type: "meeting.endSuggested", app: { bundleId: "com.microsoft.teams2", name: "Teams" } },
    { v: 1, type: "meeting.answered", answer: "keepGoing" },
  ];
  for (const message of messages) {
    const parsed = parseLine(encode(message).trim());
    expect(parsed).toEqual(message);
    expect("id" in message ? isCommand(parsed) : isEvent(parsed)).toBe(true);
  }
});

test("default socket lives in Application Support", () => {
  expect(defaultSocketPath("/Users/x")).toBe("/Users/x/Library/Application Support/KiwiNotes/sidecar.sock");
});

test("meeting IPC carries control and chunk metadata, never raw audio", () => {
  const messages: Message[] = [
    { v: 1, id: "m1", type: "meeting.start", app: "Teams", chunkDuration: 10 },
    { v: 1, id: "m2", type: "meeting.pauseMine" },
    { v: 1, id: "m3", type: "meeting.resumeMine" },
    { v: 1, id: "m4", type: "meeting.stop" },
    { v: 1, id: "m5", type: "meeting.pending" },
    { v: 1, id: "m6", type: "meeting.ack", session: "test", channel: "mine", finalThroughFrame: 64_000, contextFrames: 32_000 },
    { v: 1, type: "meeting.started", session: "test", sampleRate: 16000, output: "speaker" },
    { v: 1, type: "meeting.stopped", session: "test", pendingChunks: 0 },
    { v: 1, type: "meeting.segment", session: "test", channel: "system", start: 1, end: 3, speaker: "Pessoa 1", text: "Olá.", final: true },
    { v: 1, type: "meeting.level", channel: "system", rms: 0.25 },
    { v: 1, type: "meeting.error", error: "microphone_permission", microphone: "undetermined" },
    { v: 1, type: "meeting.chunk", session: "test", chunkId: "mine-0", channel: "mine", startFrame: 0, frames: 160_000, sampleRate: 16000, format: "f32le", path: "/tmp/fake/mine.pcm", recovered: true },
  ];
  for (const message of messages) {
    const parsed = parseLine(encode(message).trim());
    expect(parsed).toEqual(message);
    expect("id" in message ? isCommand(parsed) : isEvent(parsed)).toBe(true);
  }
});
