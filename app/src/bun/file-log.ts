// O log em arquivo (T5350, issue #161): no .app de release, o `console` se perde. Cada linha do `console` vai também
// para <dados>/logs/kiwi.log, com a hora e o nível, e o arquivo gira em 1 MB (kiwi.1.log … kiwi.3.log), então o log
// nunca passa de uns 4 MB. A pasta da pessoa vira `~`. O que entra no log já é só número, estado e nome de evento: o
// ditado e as notas nunca são logados (o dryRun do helper, que loga o texto, fica de fora no session.ts).

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { format } from "node:util";

export type LogLevel = "debug" | "info" | "warn" | "error";
const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
export const isLogLevel = (v: unknown): v is LogLevel => typeof v === "string" && v in RANK;

export interface FileLogOptions {
  dir: string;
  /** O nível mínimo que vai para o arquivo. Padrão: `info`. */
  level?: LogLevel;
  /** Quando o arquivo gira. Padrão: 1 MB. */
  maxBytes?: number;
  /** Quantos arquivos velhos ficam (kiwi.1.log …). Padrão: 3. */
  keep?: number;
  now?: () => Date;
  home?: string;
}

export class FileLog {
  readonly dir: string;
  readonly file: string;
  readonly level: LogLevel;
  private readonly maxBytes: number;
  private readonly keep: number;
  private readonly now: () => Date;
  private readonly home: string;
  private size = -1;
  private broken = false;

  constructor(o: FileLogOptions) {
    this.dir = o.dir;
    this.file = path.join(o.dir, "kiwi.log");
    this.level = o.level ?? "info";
    this.maxBytes = o.maxBytes ?? 1024 * 1024;
    this.keep = o.keep ?? 3;
    this.now = o.now ?? (() => new Date());
    this.home = o.home ?? homedir();
  }

  /** Uma linha no arquivo, se o nível passar. Nunca lança: um disco cheio não derruba o app. */
  write(level: LogLevel, message: string): void {
    if (this.broken || RANK[level] < RANK[this.level]) return;
    const text = this.home ? message.split(this.home).join("~") : message;
    const line = `${this.now().toISOString()} ${level.toUpperCase().padEnd(5)} ${text.replace(/\r?\n/g, "\n    ")}\n`;
    try {
      if (this.size < 0) {
        mkdirSync(this.dir, { recursive: true, mode: 0o700 });
        this.size = existsSync(this.file) ? statSync(this.file).size : 0;
      }
      const bytes = Buffer.byteLength(line);
      if (this.size > 0 && this.size + bytes > this.maxBytes) this.rotate();
      appendFileSync(this.file, line, { mode: 0o600 });
      this.size += bytes;
    } catch {
      // Sem onde escrever (pasta só de leitura, disco cheio): o app segue, só sem o arquivo.
      this.broken = true;
    }
  }

  /** kiwi.log → kiwi.1.log → … → kiwi.<keep>.log; o mais velho sai. */
  private rotate(): void {
    const name = (i: number) => (i === 0 ? this.file : path.join(this.dir, `kiwi.${i}.log`));
    rmSync(name(this.keep), { force: true });
    for (let i = this.keep - 1; i >= 0; i--) if (existsSync(name(i))) renameSync(name(i), name(i + 1));
    this.size = 0;
  }

  /** Os arquivos que existem, do mais novo ao mais velho. */
  files(): string[] {
    return [this.file, ...Array.from({ length: this.keep }, (_, i) => path.join(this.dir, `kiwi.${i + 1}.log`))].filter((f) => existsSync(f));
  }

  /** As últimas `n` linhas, na ordem em que aconteceram (atravessa a rotação). */
  tail(n: number): string[] {
    const out: string[] = [];
    for (const f of this.files()) {
      let lines: string[];
      try {
        lines = readFileSync(f, "utf8").split("\n").filter(Boolean);
      } catch {
        continue;
      }
      out.unshift(...lines.slice(-(n - out.length)));
      if (out.length >= n) break;
    }
    return out.slice(-n);
  }
}

/** O nível pelo ambiente: `KIWI_LOG_LEVEL`, ou `debug` com `KIWI_DEBUG=1`, ou `info`. */
export function levelFromEnv(env: Record<string, string | undefined> = process.env): LogLevel {
  if (isLogLevel(env.KIWI_LOG_LEVEL)) return env.KIWI_LOG_LEVEL;
  return env.KIWI_DEBUG === "1" ? "debug" : "info";
}

const METHODS = [["debug", "debug"], ["log", "info"], ["info", "info"], ["warn", "warn"], ["error", "error"]] as const;

/**
 * O `console` passa a escrever também no arquivo (o terminal continua vendo tudo). Devolve como desfazer. Instalar de
 * novo troca o arquivo, sem escrever duas vezes.
 */
export function teeConsole(log: FileLog, target: Console = console): () => void {
  const store = target as unknown as Record<string, unknown>;
  const key = "__kiwiFileLog";
  (store[key] as (() => void) | undefined)?.();
  const originals = METHODS.map(([m]) => [m, target[m]] as const);
  for (const [method, level] of METHODS) {
    const original = target[method].bind(target);
    target[method] = (...args: unknown[]) => {
      original(...args);
      log.write(level, format(...args));
    };
  }
  const undo = () => {
    for (const [m, fn] of originals) target[m] = fn;
    delete store[key];
  };
  store[key] = undo;
  return undo;
}

let installed: FileLog | null = null;

/** O log do app: <dados>/logs, no nível do ambiente, com o `console` passando por ele. Chamado uma vez, no começo. */
export function installFileLog(dataDir: string, env: Record<string, string | undefined> = process.env): FileLog {
  const log = new FileLog({ dir: path.join(dataDir, "logs"), level: levelFromEnv(env) });
  teeConsole(log);
  installed = log;
  return log;
}

/** O log instalado, ou null (testes, ou antes do `installFileLog`). */
export const appLog = (): FileLog | null => installed;
