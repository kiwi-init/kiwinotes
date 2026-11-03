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
  ];
  expect(lines.map((l) => parseLine(l).type)).toEqual([
    "ready",
    "hotkey.down",
    "record.cancelled",
    "record.error",
    "record.stopped",
    "result",
    "result",
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

test("default socket lives in Application Support", () => {
  expect(defaultSocketPath("/Users/x")).toBe("/Users/x/Library/Application Support/KiwiNotes/sidecar.sock");
});
