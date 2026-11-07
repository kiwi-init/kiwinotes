import { describe, expect, test } from "bun:test";

import { machoLoads } from "./macho.ts";

const LC_ID_DYLIB = 0xd;
const LC_LOAD_DYLIB = 0xc;
const LC_LOAD_WEAK_DYLIB = 0x80000018;
const LC_RPATH = 0x8000001c;

function command(cmd: number, text: string): Uint8Array {
  const name = new TextEncoder().encode(text);
  const offset = cmd === LC_RPATH ? 12 : 24;
  const size = Math.ceil((offset + name.length + 1) / 8) * 8;
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, cmd, true);
  view.setUint32(4, size, true);
  view.setUint32(8, offset, true);
  bytes.set(name, offset);
  return bytes;
}

function image(commands: Uint8Array[]): Uint8Array {
  const body = commands.reduce((n, c) => n + c.length, 0);
  const bytes = new Uint8Array(32 + body);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0xfeedfacf, true);
  view.setUint32(4, 0x0100000c, true);
  view.setUint32(16, commands.length, true);
  view.setUint32(20, body, true);
  let at = 32;
  for (const c of commands) {
    bytes.set(c, at);
    at += c.length;
  }
  return bytes;
}

function fat(slices: { cpu: number; bytes: Uint8Array }[]): Uint8Array {
  const header = 8 + slices.length * 20;
  const total = slices.reduce((n, s) => n + s.bytes.length, header);
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0xcafebabe, false);
  view.setUint32(4, slices.length, false);
  let offset = header;
  slices.forEach((s, i) => {
    view.setUint32(8 + i * 20, s.cpu, false);
    view.setUint32(8 + i * 20 + 8, offset, false);
    view.setUint32(8 + i * 20 + 12, s.bytes.length, false);
    bytes.set(s.bytes, offset);
    offset += s.bytes.length;
  });
  return bytes;
}

const binding = image([
  command(LC_ID_DYLIB, "@rpath/self.node"),
  command(LC_LOAD_DYLIB, "@rpath/libonnxruntime.1.dylib"),
  command(LC_LOAD_WEAK_DYLIB, "/usr/lib/libc++.1.dylib"),
  command(LC_RPATH, "@loader_path"),
]);

describe("machoLoads", () => {
  test("lê as dylibs pedidas e os rpaths, sem o nome da própria dylib", () => {
    expect(machoLoads(binding)).toEqual({
      dylibs: ["@rpath/libonnxruntime.1.dylib", "/usr/lib/libc++.1.dylib"],
      rpaths: ["@loader_path"],
    });
  });

  test("num binário universal, lê a fatia arm64", () => {
    const x86 = image([command(LC_LOAD_DYLIB, "/x86/only.dylib")]);
    expect(machoLoads(fat([{ cpu: 0x01000007, bytes: x86 }, { cpu: 0x0100000c, bytes: binding }])).rpaths).toEqual(["@loader_path"]);
  });

  test("recusa o que não é Mach-O 64, um universal sem arm64 e um comando que passa do fim", () => {
    expect(() => machoLoads(new Uint8Array(32))).toThrow("not a 64-bit");
    expect(() => machoLoads(fat([{ cpu: 0x01000007, bytes: binding }]))).toThrow("no arm64 slice");
    const broken = binding.slice();
    new DataView(broken.buffer).setUint32(36, 4096, true);
    expect(() => machoLoads(broken)).toThrow("bad load command size");
  });
});
