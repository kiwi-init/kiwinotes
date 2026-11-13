import { afterEach, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";

import { crashReports, diagnosticsFileName, diagnosticsReport, saveDiagnostics } from "./diagnostics.ts";
import { FileLog } from "./file-log.ts";
import type { SessionDiagnostics } from "./session.ts";
import { tempDir } from "../../test/tmp.ts";

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});
const fresh = () => (dir = tempDir("kiwi-diag-"));
const system = { macos: "26.1 (Darwin 25.1.0)", arch: "arm64", cpu: "Apple M1 Pro", memoryGb: 16 };
const session: SessionDiagnostics = {
  connected: true,
  stt: "ready",
  boosting: "ready",
  hotkeyActive: true,
  missing: ["inputMonitoring"],
  helper: {
    version: "0.1.0",
    pid: 4242,
    permissions: { microphone: "granted", accessibility: "granted", inputMonitoring: "denied", systemAudio: "undetermined" },
    llm: { available: false, reason: "appleIntelligenceNotEnabled" },
  },
  exits: [{ at: "2026-11-06T03:00:00.000Z", code: null, signal: "SIGSEGV" }, { at: "2026-11-06T03:10:00.000Z", code: 1 }],
};

test("o relatório: versões, sistema, helper, permissões só no estado, STT, quedas, crashes e o fim do log", () => {
  const text = diagnosticsReport({
    now: new Date("2026-11-06T03:40:00.000Z"),
    app: { version: "0.1.0-rc10", channel: "rc" },
    contract: "1.25.0",
    system,
    session,
    settings: { microphone: "builtin", notesShortcut: null },
    crashes: [{ name: "kiwi-helper-2026-11-06-030000.ips", at: "2026-11-06T03:00:01.000Z" }],
    log: ["2026-11-06T03:39:00.000Z INFO  [sidecar] mic: diag · engine new"],
  });
  for (const want of [
    "versão: 0.1.0-rc10 (rc)",
    "contrato da UI: 1.25.0",
    "macOS: 26.1 (Darwin 25.1.0)",
    "memória: 16 GB",
    "versão: 0.1.0 · pid 4242",
    "quedas desde que o app abriu: 2",
    "  2026-11-06T03:00:00.000Z · sinal SIGSEGV",
    "  2026-11-06T03:10:00.000Z · código 1",
    "inputMonitoring: denied",
    "faltam: inputMonitoring",
    "LLM local: indisponível (appleIntelligenceNotEnabled)",
    "STT: ready",
    "microfone escolhido: builtin",
    "atalho das Notas: desligado",
    "2026-11-06T03:00:01.000Z · kiwi-helper-2026-11-06-030000.ips",
    "== Log (as últimas 1 linhas)",
    "[sidecar] mic: diag · engine new",
  ]) expect(text).toContain(want);
});

test("sem o helper, o relatório diz isso e não inventa estado", () => {
  const text = diagnosticsReport({
    now: new Date(0), app: { version: "dev", channel: "dev" }, contract: "1.25.0", system, session: null,
    settings: { microphone: "auto", notesShortcut: "control+option+n" }, crashes: [], log: [],
  });
  expect(text).toContain("desligado neste app (sem o helper)");
  expect(text).toContain("sem o helper de pé, o estado não é conhecido");
  expect(text).toContain("STT: sem o helper");
  expect(text).toContain("== Crashes do macOS (só o nome e a data)\nnenhum");
  expect(text).toContain("(vazio)");
});

test("os crashes: só os do Kiwi, só os relatórios, os mais novos primeiro, sem abrir nenhum", () => {
  fresh();
  const crashDir = path.join(dir, "DiagnosticReports");
  mkdirSync(crashDir);
  const put = (name: string, t: number) => {
    writeFileSync(path.join(crashDir, name), "conteúdo que não é lido");
    utimesSync(path.join(crashDir, name), t, t);
  };
  put("Kiwi Notes-2026-11-05-100000.ips", 1_000);
  put("kiwi-helper-2026-11-06-030000.ips", 2_000);
  put("Safari-2026-11-06.ips", 3_000);
  put("kiwi-notas.txt", 4_000);
  expect(crashReports(crashDir).map((c) => c.name)).toEqual(["kiwi-helper-2026-11-06-030000.ips", "Kiwi Notes-2026-11-05-100000.ips"]);
  expect(crashReports(path.join(dir, "não existe"))).toEqual([]);
});

test("salvar: o .txt com o nome da hora, 0600, com o fim do log, e o Finder mostra o arquivo", async () => {
  fresh();
  const log = new FileLog({ dir: path.join(dir, "logs") });
  for (let i = 0; i < 5; i++) log.write("info", `linha ${i}`);
  const revealed: string[] = [];
  const now = new Date(2026, 10, 6, 3, 40);
  const r = await saveDiagnostics({
    app: () => ({ version: "0.1.0", channel: "rc" }),
    contract: "1.25.0",
    session: () => session,
    settings: async () => ({ microphone: "auto", notesShortcut: null }),
    log: () => log,
    saveDir: path.join(dir, "out"),
    crashDir: path.join(dir, "nenhum"),
    reveal: (abs) => revealed.push(abs),
    now: () => now,
    system: () => system,
    logLines: 3,
  });
  expect(path.basename(r.path)).toBe(diagnosticsFileName(now));
  expect(path.basename(r.path)).toBe("Kiwi Notes diagnóstico 2026-11-06 03h40.txt");
  expect(revealed).toEqual([r.path]);
  expect(statSync(r.path).mode & 0o777).toBe(0o600);
  const text = readFileSync(r.path, "utf8");
  expect(Buffer.byteLength(text)).toBe(r.bytes);
  expect(text).toContain("== Log (as últimas 3 linhas)");
  expect(text).toContain("linha 4");
  expect(text).not.toContain("linha 1");
});
