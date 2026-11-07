import { readFileSync } from "node:fs";

const MH_MAGIC_64 = 0xfeedfacf;
const FAT_MAGIC = 0xcafebabe;
const CPU_TYPE_ARM64 = 0x0100000c;
const LC_REQ_DYLD = 0x80000000;
const LC_LOAD_DYLIB = 0xc;
const LC_LOAD_WEAK_DYLIB = (0x18 | LC_REQ_DYLD) >>> 0;
const LC_REEXPORT_DYLIB = (0x1f | LC_REQ_DYLD) >>> 0;
const LC_LAZY_LOAD_DYLIB = 0x20;
const LC_LOAD_UPWARD_DYLIB = (0x23 | LC_REQ_DYLD) >>> 0;
const LC_RPATH = (0x1c | LC_REQ_DYLD) >>> 0;
const DYLIB_LOADS = new Set([LC_LOAD_DYLIB, LC_LOAD_WEAK_DYLIB, LC_REEXPORT_DYLIB, LC_LAZY_LOAD_DYLIB, LC_LOAD_UPWARD_DYLIB]);

export interface MachoLoads {
  dylibs: string[];
  rpaths: string[];
}

function cString(bytes: Uint8Array, from: number, end: number): string {
  let to = from;
  while (to < end && bytes[to] !== 0) to++;
  return new TextDecoder().decode(bytes.subarray(from, to));
}

function thinArm64(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, false) !== FAT_MAGIC) return bytes;
  const count = view.getUint32(4, false);
  for (let i = 0; i < count; i++) {
    const at = 8 + i * 20;
    if (view.getUint32(at, false) !== CPU_TYPE_ARM64) continue;
    const offset = view.getUint32(at + 8, false);
    return bytes.subarray(offset, offset + view.getUint32(at + 12, false));
  }
  throw new Error("mach-o: no arm64 slice");
}

export function machoLoads(bytes: Uint8Array): MachoLoads {
  const image = thinArm64(bytes);
  const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
  if (view.getUint32(0, true) !== MH_MAGIC_64) throw new Error("mach-o: not a 64-bit little-endian image");
  const count = view.getUint32(16, true);
  const end = 32 + view.getUint32(20, true);
  const loads: MachoLoads = { dylibs: [], rpaths: [] };
  let at = 32;
  for (let i = 0; i < count; i++) {
    const cmd = view.getUint32(at, true);
    const size = view.getUint32(at + 4, true);
    if (size < 8 || at + size > end) throw new Error("mach-o: bad load command size");
    if (DYLIB_LOADS.has(cmd)) loads.dylibs.push(cString(image, at + view.getUint32(at + 8, true), at + size));
    if (cmd === LC_RPATH) loads.rpaths.push(cString(image, at + view.getUint32(at + 8, true), at + size));
    at += size;
  }
  return loads;
}

export function machoLoadsOf(file: string): MachoLoads {
  return machoLoads(readFileSync(file));
}
