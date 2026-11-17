import { expect, test } from "bun:test";

import { LineWriter } from "./lineWriter.ts";

test("uma linha maior que o buffer sai inteira, na ordem, depois dos drains (T2594)", () => {
  const got: number[] = [];
  let room = 5;
  const w = new LineWriter({
    write(data) {
      const n = Math.min(room, data.length);
      got.push(...data.subarray(0, n));
      room -= n;
      return n;
    },
  });
  w.line("abcdefgh");
  w.line("ij");
  expect(w.waiting).toBe(9 + 3 - 5);
  while (w.waiting) {
    room = 4;
    w.flush();
  }
  expect(new TextDecoder().decode(new Uint8Array(got))).toBe("abcdefgh\nij\n");
});

test("texto com acento conta em bytes, não em caracteres", () => {
  const out: number[] = [];
  const w = new LineWriter({
    write(data) {
      const n = Math.min(3, data.length);
      out.push(...data.subarray(0, n));
      return n;
    },
  });
  w.line("ação");
  while (w.waiting) w.flush();
  expect(new TextDecoder().decode(new Uint8Array(out))).toBe("ação\n");
});
