// "Salvar diagnóstico" (T5350, issue #161): um .txt para a pessoa mandar quando algo der errado. Versões, sistema,
// permissões (só o estado: nunca pede nada), o STT, as quedas do helper e os relatórios de crash do macOS (só o nome e a
// data), e o fim do log em arquivo. Nada de texto de ditado, de nota ou de áudio: o log já não leva isso (file-log.ts).
// Ideia do SystemInfoService do VoiceInk (GPL-3.0), sem código portado: aqui é só ler o que o app já sabe.

import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import os, { homedir } from "node:os";
import path from "node:path";

import type { FileLog } from "./file-log.ts";
import type { SessionDiagnostics } from "./session.ts";

export interface SystemInfo {
  macos: string;
  arch: string;
  cpu: string;
  memoryGb: number;
}

export interface CrashReport {
  name: string;
  at: string;
}

export interface DiagnosticsInput {
  now: Date;
  app: { version: string; channel: string };
  contract: string;
  system: SystemInfo;
  /** null: o app está sem o helper (headless `--no-helper`). */
  session: SessionDiagnostics | null;
  settings: { microphone: string; notesShortcut: string | null };
  crashes: CrashReport[];
  log: string[];
}

const yesNo = (v: boolean) => (v ? "sim" : "não");

/** O texto do diagnóstico. Puro, para o teste conferir o que entra e o que não entra. */
export function diagnosticsReport(i: DiagnosticsInput): string {
  const s = i.session;
  const lines = [
    "Kiwi Notes · diagnóstico",
    `Gerado em ${i.now.toISOString()}`,
    "Sem texto de ditado, de notas nem áudio.",
    "",
    "== App",
    `versão: ${i.app.version} (${i.app.channel})`,
    `contrato da UI: ${i.contract}`,
    "",
    "== Sistema",
    `macOS: ${i.system.macos}`,
    `arquitetura: ${i.system.arch}`,
    `processador: ${i.system.cpu}`,
    `memória: ${i.system.memoryGb} GB`,
    "",
    "== Helper",
  ];
  if (!s) lines.push("desligado neste app (sem o helper)");
  else {
    lines.push(`de pé: ${yesNo(s.connected)}`);
    if (s.helper) {
      lines.push(`versão: ${s.helper.version} · pid ${s.helper.pid}`);
      lines.push(`atalho recebendo teclas: ${yesNo(s.hotkeyActive)}`);
    }
    lines.push(`quedas desde que o app abriu: ${s.exits.length}`);
    for (const e of s.exits) lines.push(`  ${e.at} · ${e.signal ? `sinal ${e.signal}` : `código ${e.code ?? "?"}`}`);
  }
  lines.push("", "== Permissões (só o estado; nada é pedido)");
  if (s?.helper) {
    for (const [name, state] of Object.entries(s.helper.permissions)) lines.push(`${name}: ${state}`);
    if (s.missing.length) lines.push(`faltam: ${s.missing.join(", ")}`);
    if (s.helper.llm) lines.push(`LLM local: ${s.helper.llm.available ? "pronto" : `indisponível (${s.helper.llm.reason ?? "?"})`}`);
  } else lines.push("sem o helper de pé, o estado não é conhecido");
  lines.push("", "== Ditado");
  lines.push(`STT: ${s ? s.stt : "sem o helper"}`);
  if (s?.boosting) lines.push(`vocabulário (boosting): ${s.boosting}`);
  lines.push(`microfone escolhido: ${i.settings.microphone}`);
  lines.push(`atalho das Notas: ${i.settings.notesShortcut ?? "desligado"}`);
  lines.push("", "== Crashes do macOS (só o nome e a data)");
  if (!i.crashes.length) lines.push("nenhum");
  for (const c of i.crashes) lines.push(`${c.at} · ${c.name}`);
  lines.push("", `== Log (as últimas ${i.log.length} linhas)`);
  lines.push(...(i.log.length ? i.log : ["(vazio)"]));
  return `${lines.join("\n")}\n`;
}

/** O macOS e a máquina. O `sw_vers` só lê; se falhar, fica o Darwin do kernel. */
export function systemInfo(): SystemInfo {
  let macos = `Darwin ${os.release()}`;
  try {
    const r = spawnSync("/usr/bin/sw_vers", ["-productVersion"], { encoding: "utf8", timeout: 2000 });
    if (r.status === 0 && r.stdout.trim()) macos = `${r.stdout.trim()} (Darwin ${os.release()})`;
  } catch {
    // fica o Darwin
  }
  return { macos, arch: os.arch(), cpu: os.cpus()[0]?.model ?? "?", memoryGb: Math.round(os.totalmem() / 2 ** 30) };
}

/** Os relatórios de crash do macOS do Kiwi (o app e o helper), os 20 mais novos: só o nome e a data, sem abrir. */
export function crashReports(dir = path.join(homedir(), "Library", "Logs", "DiagnosticReports")): CrashReport[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => /kiwi/i.test(n) && /\.(ips|crash|diag|spin|hang)$/i.test(n))
    .flatMap((name) => {
      try {
        return [{ name, at: statSync(path.join(dir, name)).mtime.toISOString() }];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 20);
}

/** O nome do arquivo: `Kiwi Notes diagnóstico 2026-11-06 03h40.txt`, na hora local. */
export function diagnosticsFileName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `Kiwi Notes diagnóstico ${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}h${p(now.getMinutes())}.txt`;
}

export interface DiagnosticsDeps {
  app(): { version: string; channel: string };
  contract: string;
  session(): SessionDiagnostics | null;
  settings(): Promise<{ microphone: string; notesShortcut: string | null }>;
  log(): FileLog | null;
  /** Onde o .txt vai: ~/Downloads no app; uma pasta do tmp no headless. */
  saveDir: string;
  crashDir?: string;
  /** Mostra o arquivo no Finder (no app, fora do KIWI_DEBUG). */
  reveal?(abs: string): void;
  now?(): Date;
  system?(): SystemInfo;
  /** Quantas linhas do log entram. Padrão: 400. */
  logLines?: number;
}

/** Escreve o .txt e mostra no Finder. Devolve onde ficou. */
export async function saveDiagnostics(d: DiagnosticsDeps): Promise<{ path: string; bytes: number }> {
  const now = d.now?.() ?? new Date();
  const text = diagnosticsReport({
    now,
    app: d.app(),
    contract: d.contract,
    system: (d.system ?? systemInfo)(),
    session: d.session(),
    settings: await d.settings(),
    crashes: crashReports(d.crashDir),
    log: d.log()?.tail(d.logLines ?? 400) ?? [],
  });
  mkdirSync(d.saveDir, { recursive: true });
  const file = path.join(d.saveDir, diagnosticsFileName(now));
  writeFileSync(file, text, { mode: 0o600 });
  console.log(`[diagnostics] saved ${Buffer.byteLength(text)} bytes`);
  d.reveal?.(file);
  return { path: file, bytes: Buffer.byteLength(text) };
}
