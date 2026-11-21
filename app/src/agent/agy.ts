// O Antigravity CLI (`agy`) instalado no Mac (spec #25046, T25059): o programa que substituiu o Gemini CLI para contas
// pessoais. Ele fala ACP sozinho (`agy acp`), então o host e o serviço do Gemini (spec #24666) ficam; muda o programa,
// os argumentos e o isolamento. Tudo pela doc oficial (antigravity.google/docs: ACP, CLI, settings, permissions,
// subagents); o que a doc não diz está na ADR 0012, seção "O Antigravity".
//
// - O Kiwi nunca lê nem guarda credenciais (ADR 0011): o login é do `agy` (`agy` no Terminal, ou `agy acp --login`).
// - Nada aqui abre, lê ou lista a pasta `~/.gemini` da pessoa. O Kiwi só escreve na pasta de trabalho dele.
// - Nos testes e na CLI dos agentes, o `agy` é o falso (`fake/agy.ts`); nenhum teste roda o de verdade.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { ProgramArgv } from "./claude.ts";
import { findGemini, findProgram, geminiSearchDirs } from "./gemini.ts";

/** O agente do Kiwi (`--agent`): o nome do arquivo em `<pasta de trabalho>/.agents/agents/`. */
export const AGY_AGENT = "kiwi";

/** O `agy` instalado, nas mesmas pastas do `gemini` (o PATH e as de sempre), ou `null`. */
export function findAgy(dirs = geminiSearchDirs()): string | null {
  return findProgram("agy", dirs);
}

/** O programa da opção Gemini: o `agy` primeiro; o `gemini` antigo fica para quem ainda o tem (conta empresa). */
export function findGeminiAgent(dirs = geminiSearchDirs()): string | null {
  return findAgy(dirs) ?? findGemini(dirs);
}

/** Qual programa é: o `agy` (o executável `agy`, ou o falso `agy.ts`) ou o `gemini` antigo. */
export function programKind(program: ProgramArgv): "agy" | "gemini" {
  const exe = program[program.length - 1] ?? "";
  return /^agy(\.ts)?$/.test(path.basename(exe)) ? "agy" : "gemini";
}

/**
 * O agente do Kiwi, pelo `--agent` (o formato da doc "Subagents"):
 * - `tools: []`: nenhuma ferramenta embutida do `agy` (ler e escrever arquivo, grep, shell). As do Kiwi chegam pelo
 *   servidor MCP da sessão (`session/new`);
 * - `mcpServers`, `skills` e `plugins` vazios: nada além do servidor do Kiwi;
 * - `commandExecutionPolicy: off`: nenhum comando de shell roda sozinho;
 * - `subagent: false`: ele não é chamado por outro agente da pessoa.
 * Uma ferramenta com nome errado em `tools` pode travar o `agy` (a doc avisa), por isso a lista fica vazia.
 */
export const AGY_AGENT_FILE = `---
name: ${AGY_AGENT}
description: O agente do Kiwi Notes. Só usa as ferramentas do Kiwi, pelo servidor MCP da sessão.
tools: []
mcpServers: []
skills: []
plugins: []
mainAgent: true
subagent: false
model: inherit
commandExecutionPolicy: off
---

Você é o agente do Kiwi Notes. Use só as ferramentas do Kiwi. Não rode comandos, não leia nem escreva arquivos e não
vá à web por conta própria.
`;

/**
 * Os ajustes de workspace, na pasta de trabalho do Kiwi (o formato do `settings.json` da doc "Settings"):
 * - `toolPermission: "strict"`: o `agy` pede permissão antes de toda ação, até de ler um arquivo;
 * - `permissions.deny`: shell, escrita, leitura de arquivo e web negados, em qualquer modo (a doc: o deny vence o ask
 *   e o allow). O servidor do Kiwi não entra no deny: um `mcp(*)` negaria as ferramentas dele também;
 * - `enableTerminalSandbox`: os comandos, se algum passar, rodam no sandbox do macOS.
 * A doc só documenta o `settings.json` da pessoa (`~/.gemini/antigravity-cli/`). Se o `agy` não ler este, o agente e o
 * `--sandbox` seguram sozinhos (ADR 0012).
 */
export const AGY_SETTINGS = {
  toolPermission: "strict",
  enableTerminalSandbox: true,
  permissions: {
    allow: [],
    ask: [],
    deny: ["command(*)", "write_file(*)", "read_file(*)", "read_url(*)", "execute_url(*)"],
  },
} as const;

/** Grava o agente e os ajustes em `<pasta de trabalho>/.agents/`, a cada abertura. Devolve a pasta de trabalho. */
export function writeAgyWorkspace(workDir: string): string {
  const agents = path.join(workDir, ".agents");
  mkdirSync(path.join(agents, "agents"), { recursive: true, mode: 0o700 });
  writeFileSync(path.join(agents, "agents", `${AGY_AGENT}.md`), AGY_AGENT_FILE);
  writeFileSync(path.join(agents, "settings.json"), JSON.stringify(AGY_SETTINGS, null, 2) + "\n");
  return workDir;
}

/**
 * Os argumentos do `agy` depois do programa (doc "CLI reference" e "ACP"):
 * - `acp`: o servidor ACP pelo stdin e o stdout;
 * - `--disable-telemetry`: nada de telemetria do `agy`;
 * - `--process-per-session`: a doc pede para o `agy` ver servidores MCP http, como o do Kiwi;
 * - `--sandbox`: os comandos no sandbox do sistema;
 * - `--agent kiwi`: o agente acima.
 * Nunca `--dangerously-skip-permissions`.
 */
export function agyArgs(): string[] {
  return ["acp", "--disable-telemetry", "--process-per-session", "--sandbox", "--agent", AGY_AGENT];
}

/** Se o `agy` tem o ACP: o `acp` aparece como comando no `agy --help`. */
export function agyHelpHasAcp(help: string): boolean {
  return /^\s*acp\b/m.test(help);
}
