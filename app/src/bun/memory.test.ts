import { describe, expect, test } from "bun:test";
import { memReport, processMemory } from "./memory.ts";

describe.if(process.platform === "darwin")("a RAM de um processo (spec #20953, T21014)", () => {
  test("o principal: agora e pico, em bytes, e o pico nunca abaixo do agora", () => {
    const m = processMemory(process.pid)!;
    expect(m.now).toBeGreaterThan(1e6);
    expect(m.peak).toBeGreaterThanOrEqual(m.now);
  });

  test("uma alocação grande sobe o agora e o pico", () => {
    const before = processMemory(process.pid)!;
    const big = new Uint8Array(64e6).fill(1);
    const after = processMemory(process.pid)!;
    expect(after.now - before.now).toBeGreaterThan(50e6);
    expect(after.peak).toBeGreaterThanOrEqual(after.now);
    expect(big[big.length - 1]).toBe(1);
  });

  test("outro processo: o filho que este abriu", async () => {
    const child = Bun.spawn(["sleep", "5"]);
    try {
      const m = processMemory(child.pid)!;
      expect(m.now).toBeGreaterThan(0);
      expect(m.peak).toBeGreaterThanOrEqual(m.now);
    } finally {
      child.kill();
      await child.exited;
    }
  });

  test("pid que não existe, ou inválido: null", () => {
    expect(processMemory(0)).toBeNull();
    expect(processMemory(-1)).toBeNull();
    expect(processMemory(1.5)).toBeNull();
    expect(processMemory(2 ** 30)).toBeNull();
  });

  test("o relatório: o principal com o heap do JS, e sem helper o helper é null", () => {
    const r = memReport(null);
    expect(r.main!.now).toBeGreaterThan(0);
    expect(r.main!.heapUsed).toBeGreaterThan(0);
    expect(r.main!.heapTotal).toBeGreaterThanOrEqual(r.main!.heapUsed);
    expect(r.helper).toBeNull();
    expect(Object.keys(r).sort()).toEqual(["helper", "main"]);
  });
});
