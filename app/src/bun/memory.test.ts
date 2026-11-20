import { describe, expect, test } from "bun:test";
import path from "node:path";

import { memReport, type ProcessMemory, processMemory } from "./memory.ts";

describe.if(process.platform === "darwin")("a RAM de um processo (spec #20953, T21014)", () => {
  test("o principal: agora e pico, em bytes, e o pico nunca abaixo do agora", () => {
    const m = processMemory(process.pid)!;
    expect(m.now).toBeGreaterThan(1e6);
    expect(m.peak).toBeGreaterThanOrEqual(m.now);
  });

  // Num processo novo (T24621): na suíte, os testes de antes já alocaram e soltaram memória, e a alocação nova reusa
  // páginas que o processo já conta (no CI, subiu 20 MB em vez de 64).
  test("uma alocação grande sobe o agora e o pico", async () => {
    const script = `
      const { processMemory } = await import(${JSON.stringify(path.join(import.meta.dir, "memory.ts"))});
      const before = processMemory(process.pid);
      const big = new Uint8Array(64e6).fill(1);
      const after = processMemory(process.pid);
      console.log(JSON.stringify({ before, after, last: big[big.length - 1] }));`;
    const child = Bun.spawn([process.execPath, "-e", script], { stdout: "pipe", stderr: "inherit" });
    const out = await new Response(child.stdout).text();
    expect(await child.exited).toBe(0);
    const { before, after, last } = JSON.parse(out) as { before: ProcessMemory; after: ProcessMemory; last: number };
    expect(after.now - before.now).toBeGreaterThan(50e6);
    expect(after.peak).toBeGreaterThanOrEqual(after.now);
    expect(last).toBe(1);
  });

  test("outro processo: o filho que este abriu", async () => {
    const child = Bun.spawn(["sleep", "5"]);
    try {
      // Logo depois do spawn, o filho ainda pode estar no exec, sem leitura: espera ele ficar de pé (com a CPU ocupada).
      let m = processMemory(child.pid);
      for (let i = 0; !m && i < 100; i++) {
        await Bun.sleep(10);
        m = processMemory(child.pid);
      }
      expect(m).not.toBeNull();
      expect(m!.now).toBeGreaterThan(0);
      expect(m!.peak).toBeGreaterThanOrEqual(m!.now);
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
    // O `heapTotal` do Bun vem de outra conta que o `heapUsed` e, com a CPU ocupada, pode ficar abaixo dele: só > 0.
    expect(r.main!.heapTotal).toBeGreaterThan(0);
    expect(r.helper).toBeNull();
    expect(Object.keys(r).sort()).toEqual(["helper", "main"]);
  });
});
