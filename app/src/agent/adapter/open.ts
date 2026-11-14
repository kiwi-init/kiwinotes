// Abrir o Claude Code pelo adaptador (spec #8368): junta o que a tela de Ajustes › Agente vai usar.
//
// - **O adaptador é aberto pelo Bun do Kiwi** (`process.execPath`: no app, o Bun de dentro do .app). A pessoa não
//   instala mais nada.
// - **Ele usa o Claude Code instalado,** e só ele: o `CLAUDE_CODE_EXECUTABLE` aponta para o `claude` que o Kiwi achou.
//   Sem essa variável, o adaptador procuraria a cópia do SDK (`@anthropic-ai/claude-agent-sdk-darwin-*`), que o Kiwi
//   nunca baixa: ele falharia, em vez de usar outra cópia.
// - **Antes de abrir,** a ordem das conferências é a das mensagens que a pessoa vê: instalado, a versão, o login e o
//   adaptador baixado.

import path from "node:path";

import { claudeStatus, type ClaudeStatus } from "../claude.ts";
import { AgentError } from "../errors.ts";
import { AgentHost, type AgentHostOptions } from "../host.ts";
import { adapterEntry, installedAdapter } from "./download.ts";
import { versionError } from "./version.ts";

export const CLAUDE_CODE = "Claude Code";

/** `<dados>/agent`: a sessão e a pasta de trabalho do agente (`host.ts`) e, em `adapter/`, o adaptador baixado. */
export function agentDir(data: string): string {
  return path.join(data, "agent");
}

export function adapterRoot(data: string): string {
  return path.join(agentDir(data), "adapter");
}

/** O comando que abre o adaptador: o Bun do Kiwi e o programa do adaptador baixado. */
export function adapterCommand(dir: string, bun = process.execPath): string[] {
  return [bun, adapterEntry(dir)];
}

/**
 * O ambiente do adaptador: o do Kiwi, com o `CLAUDE_CODE_EXECUTABLE` no Claude Code instalado, no caminho como o Kiwi
 * achou (`~/.local/bin/claude`). Não resolve o link: o instalador do Claude Code se atualiza trocando o link, e a
 * próxima abertura já pega a versão nova.
 */
export function adapterEnv(claudePath: string, base: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  return { ...base, CLAUDE_CODE_EXECUTABLE: path.resolve(claudePath) };
}

export interface ClaudeAdapterOptions {
  /** A pasta de dados do app (ou a de teste). */
  data: string;
  /** O `claude` instalado (`findClaude()`), ou null se não há nenhum. */
  claudePath: string | null;
  /** Para os testes: o ambiente base e outros campos do host. */
  env?: Record<string, string | undefined>;
  host?: Partial<Pick<AgentHostOptions, "kiwiVersion" | "onUpdate" | "sessionOptions" | "configOptions" | "kiwiTools" | "webTools" | "onExit">>;
  bun?: string;
}

/** Confere tudo e devolve o host pronto para o `start()`, ou o erro que a pessoa vai ler. Não abre nada. */
export async function claudeAdapterHost(o: ClaudeAdapterOptions): Promise<{ host: AgentHost; status: ClaudeStatus; adapter: string }> {
  const status = await claudeStatus(o.claudePath ? [o.claudePath] : null);
  if (!status.installed || !o.claudePath) throw new AgentError("E_AGENT_NOT_INSTALLED", CLAUDE_CODE);
  const tooOld = versionError(status.version, CLAUDE_CODE);
  if (tooOld) throw tooOld;
  if (!status.loggedIn) throw new AgentError("E_AGENT_NOT_LOGGED_IN", CLAUDE_CODE);
  const adapter = installedAdapter({ root: adapterRoot(o.data) });
  if (!adapter) throw new AgentError("E_ADAPTER_MISSING", CLAUDE_CODE);
  const host = new AgentHost({
    name: CLAUDE_CODE,
    command: adapterCommand(adapter, o.bun),
    dir: agentDir(o.data),
    env: adapterEnv(o.claudePath, o.env),
    ...o.host,
  });
  return { host, status, adapter };
}
