// A RAM de um processo (spec #20953, T21014): o `phys_footprint` do macOS, o mesmo número da coluna "Memória" do
// Monitor de Atividade, e o pico dele desde que o processo abriu. Lido pelo `proc_pid_rusage` (libproc), sem abrir
// processo nenhum. Só números: nada de nome, caminho ou argumento do processo.

import { dlopen, FFIType, ptr } from "bun:ffi";

/** A RAM de um processo, em bytes. */
export interface ProcessMemory {
  /** O `phys_footprint` de agora. */
  now: number;
  /** O maior `phys_footprint` desde que o processo abriu (`ri_lifetime_max_phys_footprint`). */
  peak: number;
}

/** O `rusage_info_v4` (sys/resource.h): 16 bytes de uuid e depois campos de 64 bits. */
const RUSAGE_INFO_V4 = 4;
const OFF_PHYS_FOOTPRINT = 16 + 7 * 8;
const OFF_LIFETIME_MAX = 16 + 28 * 8;
const SIZE = 16 + 40 * 8;

type Lib = { symbols: { proc_pid_rusage(pid: number, flavor: number, buf: number): number } };
let lib: Lib | null | undefined;

function libproc(): Lib | null {
  if (lib !== undefined) return lib;
  try {
    lib = process.platform === "darwin"
      ? (dlopen("/usr/lib/libproc.dylib", { proc_pid_rusage: { args: [FFIType.i32, FFIType.i32, FFIType.ptr], returns: FFIType.i32 } }) as unknown as Lib)
      : null;
  } catch {
    lib = null;
  }
  return lib;
}

/** A RAM do processo `pid`; `null` fora do macOS, ou se o processo não existe ou não é deste usuário. */
export function processMemory(pid: number): ProcessMemory | null {
  const l = libproc();
  if (!l || !Number.isInteger(pid) || pid <= 0) return null;
  const buf = new Uint8Array(SIZE);
  if (l.symbols.proc_pid_rusage(pid, RUSAGE_INFO_V4, ptr(buf)) !== 0) return null;
  const v = new DataView(buf.buffer);
  const now = Number(v.getBigUint64(OFF_PHYS_FOOTPRINT, true));
  // O kernel atualiza o pico com atraso: um processo que acabou de abrir pode dar o pico abaixo do agora (T21014, #21601).
  return { now, peak: Math.max(Number(v.getBigUint64(OFF_LIFETIME_MAX, true)), now) };
}

/** O que o `cli mem` devolve: o principal (com o heap do JS) e o helper, se estiver de pé. Tudo em bytes. */
export interface MemReport {
  main: (ProcessMemory & { heapUsed: number; heapTotal: number }) | null;
  helper: ProcessMemory | null;
}

/** A RAM do principal (este processo) e do helper (`helperPid`, ou nenhum). */
export function memReport(helperPid: number | null | undefined): MemReport {
  const m = processMemory(process.pid);
  const heap = process.memoryUsage();
  return {
    main: m ? { ...m, heapUsed: heap.heapUsed, heapTotal: heap.heapTotal } : null,
    helper: helperPid ? processMemory(helperPid) : null,
  };
}
