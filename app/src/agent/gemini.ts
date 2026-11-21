// O Gemini CLI instalado no Mac (spec #24666, parte 1): achar o programa, dizer a versão e montar como o Kiwi o abre,
// isolado. Conferido no código do Gemini CLI 0.70.0 (ADR 0012, seção "O Gemini").
//
// - O Kiwi nunca lê nem guarda credenciais (ADR 0011). O Gemini não tem um `auth status`: o login só aparece quando a
//   sessão abre, pelo `authRequired` do ACP (-32000). Por isso o `geminiStatus` não diz se ele está logado.
// - Nada aqui abre, lê ou lista a pasta do Gemini da pessoa: quem lê as configurações dela é o próprio Gemini.
// - Nos testes e na CLI dos agentes, o `gemini` é o falso (`fake/gemini.ts`); nenhum teste roda o de verdade.

import { accessSync, constants, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { agyHelpHasAcp, programKind } from "./agy.ts";
import type { ProgramArgv } from "./claude.ts";

/**
 * A versão mais antiga que o Kiwi abre. O `--acp` existe desde a 0.34.0, mas o isolamento (as opções abaixo e a regra
 * de administrador) foi conferido na 0.70.0, e o Gemini CLI ainda está na série 0.x, em que uma versão nova pode mudar
 * uma opção. Mais antigo é `E_AGENT_TOO_OLD`: a pessoa atualiza o Gemini.
 */
export const GEMINI_MIN_VERSION = "0.70.0";

/** O nome do servidor de ferramentas do Kiwi na sessão; as ferramentas chegam ao modelo como `mcp_kiwi_<nome>`. */
export const GEMINI_KIWI_SERVER = "kiwi";

/**
 * As pastas onde o `gemini` costuma ficar, depois das do PATH: o Homebrew (`brew install gemini-cli`) e o npm global
 * (`npm install -g @google/gemini-cli`), pelo Node do Homebrew, do instalador oficial, do nvm, do Volta ou do Bun.
 * Um app aberto pelo Finder não herda o PATH do terminal, então as pastas conhecidas importam.
 */
export function geminiSearchDirs(env: Record<string, string | undefined> = process.env, home = os.homedir()): string[] {
  const fromPath = (env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const known = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(home, ".npm-global", "bin"),
    ...(env.NPM_CONFIG_PREFIX ? [path.join(env.NPM_CONFIG_PREFIX, "bin")] : []),
    path.join(home, ".volta", "bin"),
    path.join(home, ".bun", "bin"),
    path.join(home, ".local", "bin"),
    ...nvmBins(home),
  ];
  return [...new Set([...fromPath, ...known])];
}

/** As pastas `bin` das versões do Node do nvm, da mais nova para a mais velha. */
function nvmBins(home: string): string[] {
  const root = path.join(home, ".nvm", "versions", "node");
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return [];
  }
  return names
    .filter((n) => /^v\d+\.\d+\.\d+$/.test(n))
    .sort((a, b) => compareVersions(b.slice(1), a.slice(1)))
    .map((n) => path.join(root, n, "bin"));
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

/** O caminho do executável `name` na primeira pasta que o tem, ou `null`. */
export function findProgram(name: string, dirs: readonly string[]): string | null {
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    if (isExecutableFile(candidate)) return candidate;
  }
  return null;
}

/** O caminho do `gemini` instalado, ou `null` se não há nenhum. */
export function findGemini(dirs = geminiSearchDirs()): string | null {
  return findProgram("gemini", dirs);
}

/** Compara duas versões `a.b.c` (o que vem depois de `-` ou `+` não conta). Negativo se `a` é mais velha. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.split(/[-+]/)[0]!.split(".").map((x) => Number.parseInt(x, 10) || 0);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Se a versão instalada serve: igual ou mais nova que a `GEMINI_MIN_VERSION`. */
export function geminiVersionOk(version: string, min = GEMINI_MIN_VERSION): boolean {
  return compareVersions(version, min) >= 0;
}

/**
 * O ambiente com que o Kiwi abre o `gemini`, por cima do do app:
 * - o PATH começa pela pasta do `gemini`: o do npm é um script `#!/usr/bin/env node`, e um app aberto pelo Finder não
 *   tem o Node no PATH. O Node do Homebrew, do nvm e do Volta fica na mesma pasta do `gemini`;
 * - `GEMINI_CLI_NO_RELAUNCH`: o Gemini não se reabre num 2º processo para ter mais memória. Fica um processo só, que
 *   o host fecha;
 * - `NO_BROWSER`: ele nunca abre o navegador para um login. O login é da pessoa, no Terminal.
 */
export function geminiEnv(program: ProgramArgv, env: Record<string, string | undefined> = process.env): Record<string, string> {
  const exe = program[0] ?? "";
  const dir = path.isAbsolute(exe) ? path.dirname(exe) : null;
  const rest = (env.PATH ?? "").split(path.delimiter).filter((p) => p && p !== dir);
  const PATH = [...(dir ? [dir] : []), ...rest, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];
  return { PATH: [...new Set(PATH)].join(path.delimiter), GEMINI_CLI_NO_RELAUNCH: "1", NO_BROWSER: "true" };
}

/**
 * A regra de administrador do Kiwi (o motor de regras do Gemini, a camada mais alta): nega toda ferramenta, embutida
 * ou de outro servidor MCP, e libera só as do servidor do Kiwi. Uma ferramenta negada sem condição some da lista que o
 * modelo vê. As da pessoa (`~/.gemini/policies`) ficam numa camada abaixo e não passam por cima.
 *
 * Toda regra precisa de `toolName`, `decision` e `priority` (0–999): é o schema do 0.70.0
 * (`packages/core/src/policy/toml-loader.ts`, o `PolicyRuleSchema`). Um arquivo com uma regra fora dele é pulado
 * inteiro, e o isolamento cairia sem aviso. O `toolName = "*"` com o `mcpName = "kiwi"` vira `mcp_kiwi_*`.
 */
export const GEMINI_POLICY = `# O Kiwi Notes abre o Gemini com esta regra (--admin-policy). Ela é refeita a cada abertura.
# Só as ferramentas do Kiwi; nenhuma embutida (shell, arquivos, web) e nenhum outro servidor MCP.

[[rule]]
toolName = "*"
decision = "deny"
priority = 900
denyMessage = "O Kiwi Notes só libera as ferramentas dele."

[[rule]]
toolName = "*"
mcpName = "${GEMINI_KIWI_SERVER}"
decision = "allow"
priority = 999
`;

/** Grava a regra na pasta `<dados>/agent/gemini-policy` e devolve a pasta (o `--admin-policy` recebe a pasta). */
export function writeGeminiPolicy(agentDir: string): string {
  const dir = path.join(agentDir, "gemini-policy");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "kiwi.toml"), GEMINI_POLICY);
  return dir;
}

/**
 * Os argumentos do `gemini` depois do programa, para falar ACP isolado (ADR 0012):
 * - `--acp`: o modo ACP pelo stdin e o stdout;
 * - `--approval-mode default`: o modo que aprova tudo (YOLO) e o `auto_edit` ficam desligados, mesmo que as
 *   configurações da pessoa digam outro (a opção vence o `defaultApprovalMode`);
 * - `--extensions none`: nenhuma extensão da pessoa (que trazem servidores MCP, comandos e `GEMINI.md`);
 * - `--allowed-mcp-server-names kiwi`: dos servidores MCP, só o do Kiwi. Os da `settings.json` da pessoa ficam de fora;
 * - `--admin-policy <pasta>`: a regra acima, que nega as ferramentas embutidas.
 */
export function geminiArgs(policyDir: string): string[] {
  return [
    "--acp",
    "--approval-mode",
    "default",
    "--extensions",
    "none",
    "--allowed-mcp-server-names",
    GEMINI_KIWI_SERVER,
    "--admin-policy",
    policyDir,
  ];
}

interface RunResult {
  exitCode: number | null;
  stdout: string;
  /** O agy 1.5.13 escreve a ajuda aqui, e não no stdout (T25486). */
  stderr: string;
  timedOut: boolean;
}

async function run(argv: readonly string[], env: Record<string, string>, timeoutMs: number): Promise<RunResult> {
  const proc = Bun.spawn([...argv], { stdin: "ignore", stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env } });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGKILL");
  }, timeoutMs);
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;
  clearTimeout(timer);
  return { exitCode: timedOut ? null : exitCode, stdout, stderr, timedOut };
}

/** A versão do Gemini CLI (`gemini --version` diz só "0.70.0"), ou `null` se ele não respondeu. */
export async function geminiVersion(program: ProgramArgv, timeoutMs = 15_000): Promise<string | null> {
  try {
    const r = await run([...program, "--version"], geminiEnv(program), timeoutMs);
    if (r.exitCode !== 0) return null;
    return /\d+\.\d+\.\d+(?:[-+][\w.]+)?/.exec(r.stdout)?.[0] ?? null;
  } catch {
    return null;
  }
}

export interface GeminiStatus {
  installed: boolean;
  /** "agy" quando é o Antigravity CLI (spec #25046); sem ele, é o `gemini` antigo. */
  program?: "agy";
  /** O caminho do programa, quando instalado. */
  path?: string;
  version?: string;
  /** A versão instalada é mais velha que a `GEMINI_MIN_VERSION`; no `agy`, ele não tem o comando `acp`. */
  tooOld?: boolean;
  /**
   * Sempre indefinido: o Gemini não diz se está logado sem abrir uma sessão. O login se vê no `authRequired` da
   * abertura, e quem lembra é o serviço (T24672).
   */
  loggedIn?: undefined;
}

/** Instalado e a versão, para a CLI e para a tela. Não abre sessão e não vai à rede. */
export async function geminiStatus(program: ProgramArgv | null): Promise<GeminiStatus> {
  if (!program) return { installed: false };
  if (programKind(program) === "agy") return agyStatus(program);
  const version = await geminiVersion(program);
  const exe = program[program.length - 1];
  return {
    installed: version !== null,
    ...(exe ? { path: exe } : {}),
    ...(version ? { version, ...(geminiVersionOk(version) ? {} : { tooOld: true }) } : {}),
  };
}

/**
 * O `agy` (spec #25046): instalado se o `agy --help` responde, e novo o bastante se a ajuda (stdout ou stderr) tem o comando `acp`. A
 * versão (`agy --version`) é só para mostrar: a doc não diz em que versão o `acp` entrou.
 */
async function agyStatus(program: ProgramArgv, timeoutMs = 15_000): Promise<GeminiStatus> {
  const exe = program[program.length - 1];
  const where = exe ? { path: exe } : {};
  let help: RunResult;
  try {
    help = await run([...program, "--help"], geminiEnv(program), timeoutMs);
  } catch {
    return { installed: false, ...where };
  }
  if (help.exitCode !== 0) return { installed: false, ...where };
  const version = await geminiVersion(program, timeoutMs);
  return {
    installed: true,
    program: "agy",
    ...where,
    ...(version ? { version } : {}),
    // A ajuda vem no stdout ou no stderr: o agy 1.5.13 usa o stderr (T25486).
    ...(agyHelpHasAcp(`${help.stdout}\n${help.stderr}`) ? {} : { tooOld: true }),
  };
}
