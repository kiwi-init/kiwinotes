// "Salvar diagnóstico" (T5350, issue #161): um .txt para a pessoa mandar quando algo der errado. Versões, sistema,
// permissões (só o estado: nunca pede nada), o STT, as quedas do helper e os relatórios de crash do macOS (só o nome e a
// data), e o fim do log em arquivo. Nada de texto de ditado, de nota ou de áudio: o log já não leva isso (file-log.ts).
// Ideia do SystemInfoService do VoiceInk (GPL-3.0), sem código portado: aqui é só ler o que o app já sabe.

import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import os, { homedir } from "node:os";
import path from "node:path";

import { type Locale, type Params, type TextKey, translate } from "../shared/i18n/index.ts";
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
  /** A língua do texto (T30631). Sem, português. */
  locale?: Locale;
}

/** O texto do diagnóstico, na língua do app (T30631; sem, português). Puro, para o teste conferir o que entra e o que não entra. */
export function diagnosticsReport(i: DiagnosticsInput): string {
  const s = i.session;
  const tr = (key: TextKey, params?: Params) => translate(i.locale ?? "pt", key, params);
  const yesNo = (v: boolean) => tr(v ? "diag.yes" : "diag.no");
  const lines = [
    tr("diag.title"),
    tr("diag.generated", { at: i.now.toISOString() }),
    tr("diag.private"),
    "",
    "== App",
    tr("diag.version", { version: i.app.version, channel: i.app.channel }),
    tr("diag.contract", { contract: i.contract }),
    "",
    tr("diag.system"),
    `macOS: ${i.system.macos}`,
    tr("diag.arch", { arch: i.system.arch }),
    tr("diag.cpu", { cpu: i.system.cpu }),
    tr("diag.memory", { gb: String(i.system.memoryGb) }),
    "",
    "== Helper",
  ];
  if (!s) lines.push(tr("diag.helperOff"));
  else {
    lines.push(tr("diag.running", { yes: yesNo(s.connected) }));
    if (s.supervision)
      lines.push(
        tr("diag.supervisor", { state: s.supervision.state, crashes: String(s.supervision.crashes) }) +
          (s.supervision.reason ? tr("diag.reason", { reason: s.supervision.reason }) : ""),
      );
    if (s.helper) {
      lines.push(tr("diag.helperVersion", { version: s.helper.version, pid: String(s.helper.pid) }));
      lines.push(tr("diag.hotkey", { yes: yesNo(s.hotkeyActive) }));
    }
    lines.push(tr("diag.exits", { count: String(s.exits.length) }));
    for (const e of s.exits) lines.push(`  ${e.at} · ${e.signal ? tr("diag.signal", { signal: String(e.signal) }) : tr("diag.code", { code: String(e.code ?? "?") })}`);
  }
  lines.push("", tr("diag.permissions"));
  if (s?.helper) {
    for (const [name, state] of Object.entries(s.helper.permissions)) lines.push(`${name}: ${state}`);
    if (s.missing.length) lines.push(tr("diag.missing", { list: s.missing.join(", ") }));
    if (s.helper.llm) lines.push(s.helper.llm.available ? tr("diag.llmReady") : tr("diag.llmOff", { reason: s.helper.llm.reason ?? "?" }));
  } else lines.push(tr("diag.unknown"));
  lines.push("", tr("diag.dictation"));
  lines.push(`STT: ${s ? s.stt : tr("diag.noHelper")}`);
  if (s?.boosting) lines.push(tr("diag.boosting", { words: s.boosting }));
  lines.push(tr("diag.microphone", { mic: i.settings.microphone }));
  lines.push(tr("diag.notesShortcut", { shortcut: i.settings.notesShortcut ?? tr("diag.off") }));
  lines.push("", tr("diag.crashes"));
  if (!i.crashes.length) lines.push(tr("diag.none"));
  for (const c of i.crashes) lines.push(`${c.at} · ${c.name}`);
  lines.push("", tr("diag.log", { count: String(i.log.length) }));
  lines.push(...(i.log.length ? i.log : [tr("diag.empty")]));
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

/** O nome do arquivo: `Kiwi Notes diagnóstico 2026-11-06 03h40.txt`, na hora local e na língua do app. */
export function diagnosticsFileName(now: Date, locale: Locale = "pt"): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return translate(locale, "diag.fileName", { date: `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`, time: `${p(now.getHours())}h${p(now.getMinutes())}` });
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
  /** A língua do app (T30631): o texto e o nome do arquivo saem nela. */
  locale?(): Locale;
}

/** Escreve o .txt e mostra no Finder. Devolve onde ficou. */
export async function saveDiagnostics(d: DiagnosticsDeps): Promise<{ path: string; bytes: number }> {
  const now = d.now?.() ?? new Date();
  const locale = d.locale?.() ?? "pt";
  const text = diagnosticsReport({
    now,
    app: d.app(),
    contract: d.contract,
    system: (d.system ?? systemInfo)(),
    session: d.session(),
    settings: await d.settings(),
    crashes: crashReports(d.crashDir),
    log: d.log()?.tail(d.logLines ?? 400) ?? [],
    locale,
  });
  mkdirSync(d.saveDir, { recursive: true });
  const file = path.join(d.saveDir, diagnosticsFileName(now, locale));
  writeFileSync(file, text, { mode: 0o600 });
  console.log(`[diagnostics] saved ${Buffer.byteLength(text)} bytes`);
  d.reveal?.(file);
  return { path: file, bytes: Buffer.byteLength(text) };
}
