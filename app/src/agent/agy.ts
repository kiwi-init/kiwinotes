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

/** As variáveis que não passam ao `agy`: as do Gemini e do Google (spec #25046). */
export const AGY_SCRUBBED_ENV = /^(GEMINI_|GOOGLE_)/;

/**
 * O ambiente do `agy` sem nenhuma variável `GEMINI_*` ou `GOOGLE_*` do ambiente do Kiwi. Uma chave
 * (`GEMINI_API_KEY`, `GOOGLE_API_KEY`), a troca para a Vertex (`GOOGLE_GENAI_USE_VERTEXAI`) ou uma credencial
 * (`GOOGLE_APPLICATION_CREDENTIALS`) no ambiente trocariam o login da pessoa por outro, e o Kiwi passaria a decidir o
 * login (ADR 0011). Sai o prefixo inteiro, não uma lista, para uma variável nova não passar. As que o Kiwi põe
 * (`geminiEnv`) entram depois.
 */
export function agyEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !AGY_SCRUBBED_ENV.test(k)));
}

/**
 * Se o `agy` tem o ACP: o `acp` aparece como comando no `agy --help`, no começo de uma linha, sozinho ou depois do
 * `agy` (`  acp  Start…`, `agy acp …`, `acp, a …`). Nunca no meio de outra palavra (`--no-acpx`) nem na descrição de
 * outro comando. O formato da ajuda não está na doc, e o Kiwi não roda o `agy` de verdade: por isso as variações.
 * Decidir pelo `initialize` do `agy acp` exigiria abri-lo, e num `agy` sem o comando o `acp` poderia virar um pedido ao
 * modelo (#25489).
 */
export function agyHelpHasAcp(help: string): boolean {
  return /^[ \t]*(?:agy[ \t]+)?acp(?=[ \t,:]|$)/m.test(help);
}
