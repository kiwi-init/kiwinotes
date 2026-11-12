// O Claude Code instalado no Mac (spec #4576): achar o programa, dizer a versão e ver se ele está logado.
//
// - O Kiwi nunca lê nem guarda credenciais (ADR 0011). O login se vê pelo `claude auth status`: conta o código de
//   saída e o `authMethod`. O resto do que ele imprime (a conta, o e-mail, a organização) é descartado aqui mesmo.
// - O Kiwi não modifica o Claude Code e não leva uma cópia: ele usa o programa que a pessoa instalou.
// - Nos testes e na CLI dos agentes, o `claude` é o falso (`fake/claude.ts`); nenhum teste roda o de verdade.

import { accessSync, constants, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Como abrir o programa: o executável e os argumentos que vêm antes dos nossos (o falso é `bun fake/claude.ts`). */
export type ProgramArgv = readonly string[];

/**
 * As pastas onde o instalador do Claude Code costuma pôr o `claude`, depois das do PATH. Um app aberto pelo Finder
 * não herda o PATH do terminal, então as pastas conhecidas importam.
 */
export function claudeSearchDirs(env: Record<string, string | undefined> = process.env, home = os.homedir()): string[] {
  const fromPath = (env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const known = [
    path.join(home, ".local", "bin"), // o instalador nativo
    path.join(home, ".claude", "local"), // a instalação local antiga
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
  return [...new Set([...fromPath, ...known])];
}

function isExecutableFile(p: string): boolean {
  try {
    if (!statSync(p).isFile()) return false;
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** O caminho do `claude` instalado, ou `null` se não há nenhum. */
export function findClaude(dirs = claudeSearchDirs()): string | null {
  for (const dir of dirs) {
    const candidate = path.join(dir, "claude");
    if (isExecutableFile(candidate)) return candidate;
  }
  return null;
}

interface RunResult {
  exitCode: number | null;
  stdout: string;
  timedOut: boolean;
}

/** Roda o programa com os argumentos, sem stdin, e devolve a saída. Mata o processo se passar do prazo. */
async function run(argv: readonly string[], timeoutMs: number): Promise<RunResult> {
  const proc = Bun.spawn([...argv], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGKILL");
  }, timeoutMs);
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  clearTimeout(timer);
  return { exitCode: timedOut ? null : exitCode, stdout, timedOut };
}

/** A versão do Claude Code (`claude --version` diz "2.1.322 (Claude Code)"), ou `null` se ele não respondeu. */
export async function claudeVersion(program: ProgramArgv, timeoutMs = 10_000): Promise<string | null> {
  try {
    const r = await run([...program, "--version"], timeoutMs);
    if (r.exitCode !== 0) return null;
    return /\d+\.\d+\.\d+(?:[-+][\w.]+)?/.exec(r.stdout)?.[0] ?? null;
  } catch {
    return null;
  }
}

export interface ClaudeAuth {
  loggedIn: boolean;
  /** Como ele está logado (`claude.ai`, `api_key`…), quando o `auth status` diz. Nada além disso sai daqui. */
  method?: string;
}

/**
 * Se o Claude Code está logado, pelo `claude auth status`: o código de saída (0 logado, 1 não) e o `authMethod` do
 * JSON. Lê só esses dois campos; a conta, o e-mail e qualquer outra coisa ficam de fora.
 */
export async function claudeAuth(program: ProgramArgv, timeoutMs = 10_000): Promise<ClaudeAuth> {
  let r: RunResult;
  try {
    r = await run([...program, "auth", "status"], timeoutMs);
  } catch {
    return { loggedIn: false };
  }
  let method: string | undefined;
  let saysLoggedIn: boolean | undefined;
  try {
    const json = JSON.parse(r.stdout) as { authMethod?: unknown; loggedIn?: unknown };
    if (typeof json.authMethod === "string") method = json.authMethod;
    if (typeof json.loggedIn === "boolean") saysLoggedIn = json.loggedIn;
  } catch {
    /* uma saída que não é JSON: vale só o código de saída */
  }
  const loggedIn = r.exitCode === 0 && saysLoggedIn !== false && method !== "none";
  return loggedIn ? { loggedIn, ...(method ? { method } : {}) } : { loggedIn: false };
}

export interface ClaudeStatus {
  installed: boolean;
  /** O caminho do programa, quando instalado. */
  path?: string;
  version?: string;
  loggedIn: boolean;
  method?: string;
}

/** Tudo de uma vez, para a CLI e, depois, para a tela: instalado, a versão e o login. */
export async function claudeStatus(program: ProgramArgv | null): Promise<ClaudeStatus> {
  if (!program) return { installed: false, loggedIn: false };
  const version = await claudeVersion(program);
  if (!version) return { installed: false, loggedIn: false };
  const auth = await claudeAuth(program);
  const where = program[program.length - 1]!;
  return { installed: true, path: where, version, ...auth };
}
