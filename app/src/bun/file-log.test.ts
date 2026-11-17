import { afterEach, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

import { FileLog, levelFromEnv, teeConsole } from "./file-log.ts";
import { tempDir } from "../../test/tmp.ts";

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const fresh = () => (dir = tempDir("kiwi-log-"));
const at = () => new Date("2026-11-06T03:40:00.000Z");

test("uma linha por chamada, com a hora e o nível; o nível mínimo filtra; a pasta da pessoa vira ~", () => {
  fresh();
  const log = new FileLog({ dir: path.join(dir, "logs"), level: "info", now: at, home: "/Users/ana" });
  log.write("debug", "não entra");
  log.write("info", "[sidecar] mic: diag · engine new · first audio 120 ms");
  log.write("error", "[notes] couldn't move /Users/ana/KiwiNotes/A.md\nsegunda linha");
  const text = readFileSync(log.file, "utf8");
  expect(text).toBe(
    "2026-11-06T03:40:00.000Z INFO  [sidecar] mic: diag · engine new · first audio 120 ms\n" +
      "2026-11-06T03:40:00.000Z ERROR [notes] couldn't move ~/KiwiNotes/A.md\n    segunda linha\n",
  );
  expect(statSync(log.file).mode & 0o777).toBe(0o600);
});

test("gira no tamanho: kiwi.log → kiwi.1.log …, guarda só `keep` velhos, e o tail atravessa a rotação", () => {
  fresh();
  const log = new FileLog({ dir, maxBytes: 200, keep: 2, now: at });
  for (let i = 0; i < 30; i++) log.write("info", `linha ${String(i).padStart(2, "0")} ${"x".repeat(20)}`);
  expect(readdirSync(dir).sort()).toEqual(["kiwi.1.log", "kiwi.2.log", "kiwi.log"]);
  for (const f of log.files()) expect(statSync(f).size).toBeLessThanOrEqual(200);
  const tail = log.tail(6);
  expect(tail).toHaveLength(6);
  expect(tail.at(-1)).toContain("linha 29");
  expect(tail.map((l) => Number(l.match(/linha (\d+)/)![1]))).toEqual([24, 25, 26, 27, 28, 29]);
});

test("sem onde escrever, não lança", () => {
  fresh();
  const log = new FileLog({ dir: "/dev/null/kiwi" });
  expect(() => log.write("error", "x")).not.toThrow();
  expect(log.tail(5)).toEqual([]);
});

test("o console escreve também no arquivo, uma vez só mesmo instalado duas vezes, e desfaz", () => {
  fresh();
  const seen: string[] = [];
  const fake = { debug: (...a: unknown[]) => seen.push(`d ${a.join(" ")}`), log: (...a: unknown[]) => seen.push(`l ${a.join(" ")}`), info: () => {}, warn: (...a: unknown[]) => seen.push(`w ${a.join(" ")}`), error: () => {} } as unknown as Console;
  const log = new FileLog({ dir, now: at });
  teeConsole(new FileLog({ dir: path.join(dir, "outro"), now: at }), fake);
  const undo = teeConsole(log, fake);
  fake.log("[instance] up", 3);
  fake.warn("[sidecar] sidecar exited");
  fake.debug("não passa do nível info");
  expect(seen).toEqual(["l [instance] up 3", "w [sidecar] sidecar exited", "d não passa do nível info"]);
  expect(log.tail(10).map((l) => l.slice(25))).toEqual(["INFO  [instance] up 3", "WARN  [sidecar] sidecar exited"]);
  expect(existsSync(path.join(dir, "outro"))).toBe(false);
  undo();
  fake.log("depois");
  expect(log.tail(10)).toHaveLength(2);
});

test("o nível vem do ambiente", () => {
  expect(levelFromEnv({})).toBe("info");
  expect(levelFromEnv({ KIWI_DEBUG: "1" })).toBe("debug");
  expect(levelFromEnv({ KIWI_LOG_LEVEL: "warn", KIWI_DEBUG: "1" })).toBe("warn");
  expect(levelFromEnv({ KIWI_LOG_LEVEL: "verbose" })).toBe("info");
});
