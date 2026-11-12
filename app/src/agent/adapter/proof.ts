// A prova do adaptador (spec #8368): abre uma sessão no Claude Code **sem mandar nenhum pedido** e mostra o que o
// harry precisa conferir. É o mesmo código nas duas provas:
// - **a do builder,** com um `claude` falso que só anota como foi chamado (`fake/claude.ts`): nenhum agente do time
//   abre o Claude Code de verdade (ADR 0011);
// - **a de verdade, do harry:** `bun run cli agent proof --real`, com o Claude Code instalado no Mac dele, que o lead
//   pede a ele.
//
// O que ela mostra:
// - **o programa:** o processo que o adaptador abriu (o filho dele, pelo `ps`), que tem de ser o `claude` instalado;
// - **a versão e o login** (só o método, nunca a conta);
// - **o isolamento:** as opções com que o Claude Code foi aberto (`--setting-sources=`, `--tools=`,
//   `--strict-mcp-config`, sem `--mcp-config`, o modo de permissão);
// - **o que a sessão recebeu:** os comandos, os agentes e os modelos que o Claude Code anunciou. Um comando, um
//   agente ou um plugin que o harry usa no terminal e aparece aqui é uma configuração pessoal que entrou.
//
// Nada é guardado: a sessão abre na pasta de dados que a CLI usa (um tmp), com o `persistSession: false` (o Claude Code
// não grava a conversa em `~/.claude/projects/`, e a prova confere o `--no-session-persistence`), e a resposta não traz
// e-mail nem conta.

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";

import type { SessionNotification } from "@agentclientprotocol/sdk";

import { claudeAdapterHost } from "./open.ts";
import { ADAPTER_VERSION, CLAUDE_CODE_FOR_ADAPTER } from "./pinned.ts";

export interface ChildProcess {
  pid: number;
  command: string;
}

/** Os processos filhos de um pid, com a linha de comando (`pgrep -P` e `ps`). */
export function childProcesses(pid: number): ChildProcess[] {
  const kids = spawnSync("/usr/bin/pgrep", ["-P", String(pid)], { encoding: "utf8" }).stdout.split("\n").filter(Boolean);
  const out: ChildProcess[] = [];
  for (const k of kids) {
    const command = spawnSync("/bin/ps", ["-o", "command=", "-p", k], { encoding: "utf8" }).stdout.trim();
    if (command) out.push({ pid: Number(k), command });
  }
  return out;
}

export interface Isolation {
  /** `--setting-sources=` vazio: nenhuma configuração da pessoa (hooks, regras, CLAUDE.md, MCP do terminal). */
  semConfiguracoesPessoais: boolean;
  /** `--tools=` vazio: nenhuma ferramenta embutida. */
  semFerramentas: boolean;
  /** `--strict-mcp-config` e nenhum `--mcp-config`: nenhum servidor MCP. */
  semServidoresMcp: boolean;
  /** O `--permission-mode` (o esperado é `default`) e se o modo que pula permissões foi liberado. */
  modoDePermissao: string | null;
  pulaPermissoes: boolean;
  /** `--no-session-persistence`: a sessão da prova não fica gravada em `~/.claude/projects/`. */
  semRegistroDaSessao: boolean;
}

/** Lê as opções de isolamento na linha de comando do Claude Code. */
export function isolationOf(command: string): Isolation {
  const has = (flag: string) => new RegExp(`(^|\\s)${flag}(\\s|$)`).test(command);
  const mode = /(?:^|\s)--permission-mode[= ](\S+)/.exec(command)?.[1] ?? null;
  return {
    semConfiguracoesPessoais: has("--setting-sources="),
    semFerramentas: has("--tools="),
    semServidoresMcp: has("--strict-mcp-config") && !/(?:^|\s)--mcp-config(?:[= ]|$)/.test(command),
    modoDePermissao: mode,
    pulaPermissoes: has("--allow-dangerously-skip-permissions") || mode === "bypassPermissions",
    semRegistroDaSessao: has("--no-session-persistence"),
  };
}

export interface ProofReport {
  ok: boolean;
  claude: { caminho: string; versao?: string; logado: boolean; metodo?: string; versaoDoAdaptador: string };
  adaptador: { versao: string; pasta: string };
  sessao: { abriu: boolean; pedidosEnviados: 0; agente?: string };
  /** O processo que o adaptador abriu. */
  processo: { pid: number; comando: string } | null;
  abriuOClaudeIndicado: boolean;
  isolamento: Isolation | null;
  /** Os comandos (`/…`) que o Claude Code anunciou para a sessão. */
  comandos: string[];
  /** Se a lista de comandos chegou. Sem ela, uma lista vazia não quer dizer "nada pessoal entrou". */
  comandosChegaram: boolean;
  /** As opções da sessão (o modelo, o agente, o modo), com os valores que o Claude Code ofereceu. */
  opcoes: { id: string; atual?: unknown; valores: string[] }[];
  /** O que falta conferir a olho (o harry, contra o terminal dele). */
  conferir: string[];
}

export interface ProofOptions {
  data: string;
  /** O `claude` a abrir: o instalado (`--real`) ou o falso. */
  claudePath: string;
  env?: Record<string, string | undefined>;
  /** O teto da espera pela lista de comandos, depois de a sessão abrir. */
  commandsTimeoutMs?: number;
}

function optionsOf(details: Record<string, unknown> | undefined): ProofReport["opcoes"] {
  const list = (details?.configOptions ?? []) as { id?: unknown; currentValue?: unknown; options?: unknown }[];
  return list.map((o) => {
    const flat = (Array.isArray(o.options) ? o.options : []).flatMap((x: { value?: unknown; options?: unknown }) =>
      Array.isArray(x.options) ? (x.options as { value?: unknown }[]) : [x],
    );
    return { id: String(o.id), atual: o.currentValue, valores: flat.map((x) => String(x.value)) };
  });
}

/** Roda a prova. Lança o `AgentError` das conferências (não instalado, versão, login, adaptador que falta). */
/** Os dois caminhos levam ao mesmo arquivo (o link `~/.local/bin/claude` e a versão para onde ele aponta)? */
export function sameProgram(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

/** Roda a prova. Lança o `AgentError` das conferências (não instalado, versão, login, adaptador que falta). */
export async function runAdapterProof(o: ProofOptions): Promise<ProofReport> {
  const commands = new Set<string>();
  let commandsArrived: () => void = () => {};
  const arrived = new Promise<boolean>((resolve) => {
    commandsArrived = () => resolve(true);
    setTimeout(() => resolve(false), o.commandsTimeoutMs ?? 5000);
  });
  const onUpdate = (n: SessionNotification) => {
    const u = n.update as { sessionUpdate?: string; availableCommands?: { name?: string }[] };
    if (u.sessionUpdate !== "available_commands_update") return;
    for (const c of u.availableCommands ?? []) if (c.name) commands.add(c.name);
    commandsArrived();
  };
  const { host, status, adapter } = await claudeAdapterHost({
    data: o.data,
    claudePath: o.claudePath,
    env: o.env,
    host: { onUpdate, sessionOptions: { persistSession: false } },
  });
  host.forgetSession(); // a prova abre sempre uma sessão nova
  const session = await host.start();
  try {
    const gotCommands = await arrived;
    const kids = host.pid ? childProcesses(host.pid) : [];
    const child = kids.find((k) => /--input-format/.test(k.command)) ?? kids[0] ?? null;
    const isolation = child ? isolationOf(child.command) : null;
    // O executável é o começo da linha do `ps`: o caminho indicado, ou outro caminho para o mesmo arquivo (o Claude Code
    // nativo pode aparecer pelo caminho da versão, `…/versions/2.1.322`, em vez do link).
    const opened =
      !!child && (child.command === o.claudePath || child.command.startsWith(`${o.claudePath} `) || sameProgram(child.command.split(" ")[0]!, o.claudePath));
    const ok =
      opened &&
      gotCommands &&
      !!isolation &&
      isolation.semConfiguracoesPessoais &&
      isolation.semFerramentas &&
      isolation.semServidoresMcp &&
      isolation.semRegistroDaSessao &&
      !isolation.pulaPermissoes;
    return {
      ok,
      claude: { caminho: o.claudePath, versao: status.version, logado: status.loggedIn, metodo: status.method, versaoDoAdaptador: CLAUDE_CODE_FOR_ADAPTER },
      adaptador: { versao: ADAPTER_VERSION, pasta: adapter },
      sessao: { abriu: true, pedidosEnviados: 0, agente: [session.agent.name, session.agent.version].filter(Boolean).join(" ") },
      processo: child ? { pid: child.pid, comando: child.command } : null,
      abriuOClaudeIndicado: opened,
      isolamento: isolation,
      comandos: [...commands].sort(),
      comandosChegaram: gotCommands,
      opcoes: optionsOf(session.details),
      conferir: [
        gotCommands
          ? "Os comandos: algum é um comando, uma skill ou um plugin seu, do terminal? Se for, uma configuração pessoal entrou."
          : "A lista de comandos não chegou: a prova não consegue dizer se uma configuração pessoal entrou. Avise o lead.",
        "As opções: os agentes listados são só os padrão do Claude Code, sem os seus?",
        "O processo: o caminho é o do seu Claude Code (o `which claude` do terminal)?",
      ],
    };
  } finally {
    await host.stop();
  }
}
