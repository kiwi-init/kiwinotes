import { expect, test } from "bun:test";

import { dataUrlBytes } from "./rive.ts";

test("dataUrlBytes: os bytes do `?inline` do Vite, sem fetch", () => {
  const bytes = new Uint8Array([0x52, 0x49, 0x56, 0x45, 0x00, 0xff, 0x10]); // "RIVE", e bytes fora do ASCII
  const url = `data:application/octet-stream;base64,${Buffer.from(bytes).toString("base64")}`;
  expect(new Uint8Array(dataUrlBytes(url))).toEqual(bytes);
});

test("dataUrlBytes: recusa o que não é data: em base64", () => {
  expect(() => dataUrlBytes("/assets/kiwi-cat.riv")).toThrow("base64");
  expect(() => dataUrlBytes("data:text/plain,RIVE")).toThrow("base64");
});

test("sem o kiwi-cat.riv no build, a intro fica sem o gato do Rive", () => {
  expect(globalThis.window?.kiwiRiveCat).toBeUndefined();
});
