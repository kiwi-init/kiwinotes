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
//
// **Com as ferramentas do Kiwi** (`--tools`, spec #7496): a sessão abre com o servidor MCP do Kiwi, sobre um cofre
// vazio (nenhuma nota da pessoa entra), ainda sem pedido. A prova mostra se o Claude Code conectou e pediu a lista
// (`tools/list`): é o que diz que ele enxerga as seis, mesmo com o `tools: []` e o `--strict-mcp-config`. A senha do
// servidor não aparece no relatório.

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";

import type { SessionNotification } from "@agentclientprotocol/sdk";

import { claudeAdapterHost } from "./open.ts";
import { ADAPTER_VERSION, CLAUDE_CODE_FOR_ADAPTER } from "./pinned.ts";
import { EMPTY_READER } from "../tools/reader.ts";
import { KIWI_TOOL_NAMES } from "../tools/tools.ts";
import { KIWI_MCP_NAME, KIWI_TOOL_PREFIX, KiwiToolServer } from "../tools/server.ts";

export interface ChildProcess {
  pid: number;
  command: string;
}

/** Os processos filhos de um pid, com a linha de comando (`pgrep -P` e `ps`). */
export function childProcesses(pid: number): ChildProcess[] {
  const kids = spawnSync("/usr/bin/pgrep", ["-P", String(pid)], { encoding: "utf8" }).stdout.split("\n").filter(Boolean);
  const out: ChildProcess[] = [];
  for (const k of kids) {
    // `-ww`: a linha inteira, sem cortar na largura do terminal (o `--mcp-config` é longo).
    const command = spawnSync("/bin/ps", ["-ww", "-o", "command=", "-p", k], { encoding: "utf8" }).stdout.trim();
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
  /** Os servidores MCP do `--mcp-config` (com `--tools`, só o `kiwi`), e as ferramentas liberadas sem pedir. */
  servidoresMcp: string[];
  liberadas: string[];
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
  const allowed = /(?:^|\s)--allowedTools[= ](\S+)/.exec(command)?.[1];
  return {
    semConfiguracoesPessoais: has("--setting-sources="),
    semFerramentas: has("--tools="),
    semServidoresMcp: has("--strict-mcp-config") && !/(?:^|\s)--mcp-config(?:[= ]|$)/.test(command),
    servidoresMcp: mcpServerNames(command),
    liberadas: allowed ? allowed.split(",").filter(Boolean) : [],
    modoDePermissao: mode,
    pulaPermissoes: has("--allow-dangerously-skip-permissions") || mode === "bypassPermissions",
    semRegistroDaSessao: has("--no-session-persistence"),
  };
}

/**
 * Os nomes dos servidores do `--mcp-config` (o SDK manda `{"mcpServers":{…}}` num argumento só). Um JSON que não dá
 * para ler vira `["?"]`: a prova não aceita o que não entende.
 */
export function mcpServerNames(command: string): string[] {
  const at = /(?:^|\s)--mcp-config[= ]/.exec(command);
  if (!at) return [];
  const start = command.indexOf("{", at.index);
  if (start < 0) return ["?"];
  // O JSON vai até a chave que fecha a primeira; as aspas e os escapes contam.
  let depth = 0;
  let inString = false;
  for (let i = start; i < command.length; i++) {
    const c = command[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        const parsed = JSON.parse(command.slice(start, i + 1)) as { mcpServers?: Record<string, unknown> };
        return Object.keys(parsed.mcpServers ?? {}).sort();
      } catch {
        return ["?"];
      }
    }
  }
  return ["?"];
}

/** A linha de comando sem a senha do servidor do Kiwi: o relatório vai para o canal. */
export function redactToken(command: string, token: string | null): string {
  return token ? command.split(token).join("***") : command;
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
  /**
   * Com `--tools` (spec #7496): se o Claude Code conectou no servidor do Kiwi e pediu a lista, e o que ele pediu.
   * Sem `--tools`, null.
   */
  ferramentasDoKiwi: { conectou: boolean; pediuALista: boolean; metodos: string[]; oferecidas: string[] } | null;
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
  /** Abre a sessão com as ferramentas do Kiwi (spec #7496), sobre um cofre vazio. */
  tools?: boolean;
  /** O teto da espera pelo `tools/list` do Claude Code, depois de a sessão abrir. */
  toolsTimeoutMs?: number;
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

/** Os dois caminhos levam ao mesmo arquivo (o link `~/.local/bin/claude` e a versão para onde ele aponta)? */
export function sameProgram(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

/** A linha do `ps` começa por um caminho que leva ao mesmo arquivo do programa indicado? Aceita caminho com espaço. */
export function opensProgram(command: string, program: string): boolean {
  if (command === program || command.startsWith(`${program} `)) return true;
  for (let i = command.indexOf(" "); ; i = command.indexOf(" ", i + 1)) {
    const prefix = i < 0 ? command : command.slice(0, i);
    if (sameProgram(prefix, program)) return true;
    if (i < 0) return false;
  }
}

/**
 * A espera pela lista de comandos. Ela anota o primeiro `available_commands_update` desde já (ele pode chegar durante a
 * abertura), mas o teto só começa a contar no `wait()`, depois de a sessão abrir: o `claude --version`, o `auth status`,
 * o adaptador e o Claude Code abrindo não comem o tempo da lista (revisão do T8603).
 */
export function commandsWaiter(): { arrived(): void; wait(timeoutMs: number): Promise<boolean> } {
  let resolveFirst: () => void = () => {};
  const first = new Promise<true>((resolve) => {
    resolveFirst = () => resolve(true);
  });
  return {
    arrived: () => resolveFirst(),
    wait: async (timeoutMs) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      });
      try {
        return await Promise.race([first, timeout]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Roda a prova. Lança o `AgentError` das conferências (não instalado, versão, login, adaptador que falta). */
export async function runAdapterProof(o: ProofOptions): Promise<ProofReport> {
  const commands = new Set<string>();
  const waiter = commandsWaiter();
  const onUpdate = (n: SessionNotification) => {
    const u = n.update as { sessionUpdate?: string; availableCommands?: { name?: string }[] };
    if (u.sessionUpdate !== "available_commands_update") return;
    for (const c of u.availableCommands ?? []) if (c.name) commands.add(c.name);
    waiter.arrived();
  };
  // Com `--tools`: o servidor do Kiwi sobre um cofre vazio, que anota cada método que o Claude Code chamou.
  const methods: string[] = [];
  const listed = commandsWaiter();
  const tools = o.tools
    ? new KiwiToolServer({
        reader: EMPTY_READER,
        onRequest: (m) => {
          methods.push(m);
          if (m === "tools/list") listed.arrived();
        },
      })
    : null;
  let token: string | null = null;
  const { host, status, adapter } = await claudeAdapterHost({
    data: o.data,
    claudePath: o.claudePath,
    env: o.env,
    host: {
      onUpdate,
      sessionOptions: { persistSession: false },
      ...(tools
        ? {
            kiwiTools: {
              prefix: KIWI_TOOL_PREFIX,
              servers: () => {
                const config = tools.running ? null : tools.start();
                if (config) token = config.headers[0]?.value ?? null;
                return config ? [config] : [];
              },
            },
          }
        : {}),
    },
  });
  host.forgetSession(); // a prova abre sempre uma sessão nova
  let session: Awaited<ReturnType<typeof host.start>>;
  try {
    session = await host.start();
  } catch (e) {
    tools?.stop();
    throw e;
  }
  try {
    const gotCommands = await waiter.wait(o.commandsTimeoutMs ?? 5000);
    const gotTools = tools ? await listed.wait(o.toolsTimeoutMs ?? 10_000) : false;
    const kids = host.pid ? childProcesses(host.pid) : [];
    const child = kids.find((k) => /--input-format/.test(k.command)) ?? kids[0] ?? null;
    const isolation = child ? isolationOf(child.command) : null;
    // Com as ferramentas, o esperado é um servidor só, o do Kiwi, e só as ferramentas dele liberadas.
    const mcpOk = !isolation
      ? false
      : tools
        ? isolation.servidoresMcp.join() === KIWI_MCP_NAME &&
          isolation.liberadas.join() === `${KIWI_TOOL_PREFIX}*` &&
          / --strict-mcp-config(\s|$)/.test(` ${child!.command}`)
        : isolation.semServidoresMcp;
    // O executável é o começo da linha do `ps`: o caminho indicado, ou outro caminho para o mesmo arquivo (o Claude Code
    // nativo pode aparecer pelo caminho da versão, `…/versions/2.1.322`, em vez do link).
    const opened = !!child && opensProgram(child.command, o.claudePath);
    const ok =
      opened &&
      gotCommands &&
      !!isolation &&
      isolation.semConfiguracoesPessoais &&
      isolation.semFerramentas &&
      mcpOk &&
      isolation.semRegistroDaSessao &&
      !isolation.pulaPermissoes &&
      (!tools || gotTools);
    return {
      ok,
      claude: { caminho: o.claudePath, versao: status.version, logado: status.loggedIn, metodo: status.method, versaoDoAdaptador: CLAUDE_CODE_FOR_ADAPTER },
      adaptador: { versao: ADAPTER_VERSION, pasta: adapter },
      sessao: { abriu: true, pedidosEnviados: 0, agente: [session.agent.name, session.agent.version].filter(Boolean).join(" ") },
      processo: child ? { pid: child.pid, comando: redactToken(child.command, token) } : null,
      abriuOClaudeIndicado: opened,
      isolamento: isolation,
      comandos: [...commands].sort(),
      comandosChegaram: gotCommands,
      opcoes: optionsOf(session.details),
      ferramentasDoKiwi: tools
        ? { conectou: methods.includes("initialize"), pediuALista: gotTools, metodos: [...new Set(methods)], oferecidas: [...KIWI_TOOL_NAMES] }
        : null,
      conferir: [
        ...(tools
          ? [
              gotTools
                ? "As ferramentas: o Claude Code conectou no servidor do Kiwi e pediu a lista das seis."
                : "As ferramentas: o Claude Code não pediu a lista ao servidor do Kiwi. Avise o lead, com este relatório.",
            ]
          : []),
        gotCommands
          ? "Os comandos: algum é um comando, uma skill ou um plugin seu, do terminal? Se for, uma configuração pessoal entrou."
          : "A lista de comandos não chegou: a prova não consegue dizer se uma configuração pessoal entrou. Avise o lead.",
        "As opções: os agentes listados são só os padrão do Claude Code, sem os seus?",
        "O processo: o caminho é o do seu Claude Code (o `which claude` do terminal)?",
      ],
    };
  } finally {
    await host.stop();
    tools?.stop();
  }
}
