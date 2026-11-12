// O host do agente (spec #4576, ADR 0012): a peça do Kiwi que abre um agente de CLI, conversa com ele pelo ACP
// (Agent Client Protocol) e devolve a resposta em eventos. Ainda sem tela e sem rede: quem diz qual programa abrir
// é quem chama (a CLI, os testes e, no spec #8368, o adaptador do Claude Code baixado).
//
// O que ele garante:
// - **um pedido por vez,** com cancelar;
// - **a sessão retomada** entre um pedido e outro, e entre uma abertura e outra (o id fica em `session.json`);
// - **o agente isolado:** uma pasta de trabalho só dele, sem as configurações pessoais do Claude Code (hooks, regras,
//   servidores MCP) e sem as ferramentas que mexem no Mac. Neste spec ele só conversa;
// - **erros claros** (`errors.ts`), e nenhum pedido de permissão aceito: sem tela, toda ferramenta é recusada.
//
// Nada liga sozinho: o host só abre o agente quando alguém chama `start()`.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { client, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import type {
  ClientConnection,
  InitializeRequest,
  InitializeResponse,
  NewSessionRequest,
  RequestPermissionResponse,
  SessionConfigOption,
  SessionNotification,
} from "@agentclientprotocol/sdk";

import { AgentError, classifyAgentError } from "./errors.ts";

/**
 * O isolamento que o host pede ao abrir a sessão, no `_meta.claudeCode.options` que o adaptador do Claude Code passa
 * ao SDK por cima dos padrões dele (`claude-agent-acp`, `v1/acp-agent.js` e `v2/agent.js`):
 * - `settingSources: []` não carrega as configurações da pessoa (`~/.claude`, as do projeto e as locais), com os
 *   hooks, as regras e os servidores MCP do terminal;
 * - `strictMcpConfig` usa só os servidores MCP que o Kiwi mandar (nenhum, neste spec);
 * - `tools: []` desliga as ferramentas embutidas (o shell, a edição de arquivos e a web);
 * - `allowDangerouslySkipPermissions: false` desliga o modo que pula as permissões (spec #8368). Sem ele, um
 *   `"defaultMode": "bypassPermissions"` no `~/.claude/settings.json` da pessoa vira `--permission-mode=bypassPermissions`
 *   no Claude Code: foi o que a prova do builder viu, com o adaptador de verdade e um `claude` falso. Com ele, a sessão
 *   abre em `--permission-mode=default`, e toda ferramenta passa pelo pedido de permissão do Kiwi.
 * Um agente que não é o Claude Code ignora o `_meta`. A prova de ponta a ponta é do spec #8368, no Mac do harry.
 *
 * O que o `_meta` não segura (revisão do T8478): o próprio adaptador lê o `~/.claude/settings.json` da pessoa, com o
 * `resolveSettings` do SDK, para o modo de permissão padrão, o bloqueio do bypass, a escolha de modelo e o
 * `apiKeyHelper`. Os hooks e os servidores MCP não voltam por aí: a sessão recebe só o `settings` que o Kiwi mandar.
 */
export const ISOLATION_META = {
  claudeCode: {
    options: {
      settingSources: [] as string[],
      strictMcpConfig: true,
      tools: [] as string[],
      allowDangerouslySkipPermissions: false,
    },
  },
} as const;

export type AgentEvent =
  | { type: "status"; status: "thinking" }
  | { type: "status"; status: "running"; tool: string }
  | { type: "text"; text: string }
  | { type: "permission"; tool: string; decision: "denied" }
  | { type: "done"; stopReason: string };

export interface AgentAnswer {
  text: string;
  stopReason: string;
}

export interface AgentHostOptions {
  /** O nome que a pessoa vê nas mensagens ("Claude Code"). */
  name: string;
  /** O programa do agente que fala ACP pelo stdin e stdout, com os argumentos. */
  command: readonly string[];
  /** A pasta do agente, dentro dos dados do app: `work/` é a pasta de trabalho dele, e `session.json` guarda a sessão. */
  dir: string;
  /** O ambiente do processo do agente (o padrão é o do Kiwi). */
  env?: Record<string, string | undefined>;
  /** A versão do Kiwi, que vai na apresentação do protocolo (`clientInfo`). */
  kiwiVersion?: string;
  /**
   * Cada `session/update` que chega, cru, inclusive fora de um pedido (por exemplo, a lista de comandos que o agente
   * manda ao abrir). É para diagnóstico, como a prova do #8368; a tela usa os eventos do `ask`.
   */
  onUpdate?: (n: SessionNotification) => void;
  /**
   * Opções a mais para o `_meta.claudeCode.options` da sessão, por baixo do isolamento: uma chave do `ISOLATION_META`
   * nunca é trocada por aqui. A prova do #8368 manda o `persistSession: false`, para não deixar a sessão gravada.
   */
  sessionOptions?: Record<string, unknown>;
  /**
   * Os valores que o Kiwi escolhe para as opções da sessão (T8678), por id: `{ model: "default", effort: "default" }`.
   * Ao abrir, o host aplica cada um pelo `session/set_config_option` do ACP, por cima do que o agente trouxe (na prova
   * de verdade, o Claude Code abriu com o modelo e o esforço do terminal do harry, #8666).
   */
  configOptions?: () => Record<string, string>;
}

export interface AgentSession {
  sessionId: string;
  /** `true` quando a sessão anterior foi retomada, `false` quando começou uma nova. */
  resumed: boolean;
  agent: { name?: string; version?: string };
  /** A resposta crua da abertura (`session/new`, `resume` ou `load`): os modos, os modelos e as opções do agente. */
  details?: Record<string, unknown>;
}

/** Quanto o host espera o agente sair por conta própria, no `stop()`, antes de matar. */
const STOP_GRACE_MS = 2000;
/** O fim do stderr do agente que fica guardado para explicar uma queda. */
const STDERR_KEEP = 8192;

type Turn = { text: string; onEvent?: (e: AgentEvent) => void; lastStatus?: string };

export class AgentHost {
  private readonly o: AgentHostOptions;
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private conn: ClientConnection | null = null;
  private exited: Promise<AgentError> | null = null;
  /** Por que o agente fechou sozinho, para o `ask` seguinte dizer isso em vez de "não está aberto". */
  private lastExit: AgentError | null = null;
  private stderr = "";
  private sessionId: string | null = null;
  private turn: Turn | null = null;
  /** Durante o `session/load`, o agente repete a conversa antiga em updates: eles não são do pedido de agora. */
  private replaying = false;
  /** As opções da sessão aberta, como o agente respondeu por último. */
  private config: SessionConfigOption[] = [];

  constructor(o: AgentHostOptions) {
    this.o = o;
  }

  get workDir(): string {
    return path.join(this.o.dir, "work");
  }

  private get sessionFile(): string {
    return path.join(this.o.dir, "session.json");
  }

  get busy(): boolean {
    return this.turn !== null;
  }

  get running(): boolean {
    return this.proc !== null;
  }

  /** O pid do processo do agente, enquanto ele está aberto (a prova do #8368 olha os filhos dele). */
  get pid(): number | null {
    return this.proc?.pid ?? null;
  }

  /** Abre o agente, faz a apresentação do protocolo e abre (ou retoma) a sessão. */
  async start(): Promise<AgentSession> {
    if (this.proc) throw new Error("o agente já está aberto");
    mkdirSync(this.workDir, { recursive: true, mode: 0o700 });
    let proc: ReturnType<typeof Bun.spawn>;
    try {
      proc = Bun.spawn([...this.o.command], {
        cwd: this.workDir,
        env: this.o.env ?? process.env,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch (e) {
      throw classifyAgentError(e, this.o.name);
    }
    this.proc = proc;
    this.lastExit = null;
    this.collectStderr(proc.stderr as ReadableStream<Uint8Array>);
    this.exited = proc.exited.then((code) => {
      const err = new AgentError("E_AGENT_FAILED", this.o.name, `o agente fechou (saída ${code}): ${this.stderr.slice(-500)}`);
      this.dropProcess(proc, err);
      return err;
    });

    const stdin = proc.stdin as import("bun").FileSink;
    const output = new WritableStream<Uint8Array>({
      write(chunk) {
        stdin.write(chunk);
        stdin.flush();
      },
      close() {
        stdin.end();
      },
    });
    const app = client({ name: "kiwi-notes" })
      .onNotification("session/update", ({ params }) => this.onUpdate(params))
      .onRequest("session/request_permission", ({ params }) => {
        const tool = toolName(params.toolCall as Record<string, unknown>);
        this.turn?.onEvent?.({ type: "permission", tool, decision: "denied" });
        const reject = params.options.find((o) => o.kind === "reject_once") ?? params.options.find((o) => o.kind === "reject_always");
        const answer: RequestPermissionResponse = reject
          ? { outcome: { outcome: "selected", optionId: reject.optionId } }
          : { outcome: { outcome: "cancelled" } };
        return answer;
      });
    this.conn = app.connect(ndJsonStream(output, proc.stdout as ReadableStream<Uint8Array>));

    try {
      const hello: InitializeRequest = {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: "kiwi-notes", title: "Kiwi Notes", version: this.o.kiwiVersion ?? "dev" },
      };
      const init = await this.untilExit(this.conn.agent.request("initialize", hello));
      const { sessionId, resumed, details } = await this.openSession(init);
      this.sessionId = sessionId;
      this.config = Array.isArray(details.configOptions) ? (details.configOptions as SessionConfigOption[]) : [];
      if (this.o.configOptions) await this.applyConfig(this.o.configOptions());
      writeFileSync(this.sessionFile, JSON.stringify({ sessionId }) + "\n", { mode: 0o600 });
      return { sessionId, resumed, agent: { name: init.agentInfo?.title ?? init.agentInfo?.name, version: init.agentInfo?.version }, details };
    } catch (e) {
      await this.stop();
      throw classifyAgentError(e, this.o.name);
    }
  }

  /** Retoma a sessão guardada, se o agente sabe (`session/resume`, ou `session/load`); senão, abre uma nova. */
  private async openSession(init: InitializeResponse): Promise<{ sessionId: string; resumed: boolean; details: Record<string, unknown> }> {
    const agent = this.conn!.agent;
    const options = { ...structuredClone(this.o.sessionOptions ?? {}), ...structuredClone(ISOLATION_META.claudeCode.options) };
    const base: NewSessionRequest = { cwd: this.workDir, mcpServers: [], _meta: { claudeCode: { options } } };
    const saved = this.savedSessionId();
    if (saved) {
      const caps = init.agentCapabilities;
      try {
        if (caps?.sessionCapabilities?.resume) {
          const details = await this.untilExit(agent.request("session/resume", { ...base, sessionId: saved }));
          return { sessionId: saved, resumed: true, details: { ...details } };
        }
        if (caps?.loadSession) {
          this.replaying = true;
          const details = await this.untilExit(agent.request("session/load", { ...base, sessionId: saved }));
          return { sessionId: saved, resumed: true, details: { ...details } };
        }
      } catch (e) {
        // A sessão guardada não existe mais (outro agente, ou o agente a apagou): começa uma nova. Um erro de login,
        // de limite ou de rede não se resolve com uma sessão nova, e sobe.
        const err = classifyAgentError(e, this.o.name);
        if (err.code !== "E_AGENT_FAILED") throw err;
      } finally {
        this.replaying = false;
      }
    }
    const created = await this.untilExit(agent.request("session/new", base));
    return { sessionId: created.sessionId, resumed: false, details: { ...created } };
  }

  private savedSessionId(): string | null {
    try {
      const saved = JSON.parse(readFileSync(this.sessionFile, "utf8")) as { sessionId?: unknown };
      return typeof saved.sessionId === "string" && saved.sessionId ? saved.sessionId : null;
    } catch {
      return null;
    }
  }

  /** Esquece a sessão guardada: o próximo `start()` começa do zero. */
  forgetSession(): void {
    try {
      writeFileSync(this.sessionFile, "{}\n", { mode: 0o600 });
    } catch {
      /* sem pasta, sem sessão */
    }
  }

  /** Manda um pedido e espera a resposta inteira. Os eventos chegam em `onEvent`, na ordem. Um pedido por vez. */
  async ask(text: string, onEvent?: (e: AgentEvent) => void): Promise<AgentAnswer> {
    if (!this.conn || !this.sessionId) {
      if (this.lastExit) throw this.lastExit;
      throw new Error("o agente não está aberto: chame start() antes");
    }
    if (this.turn) throw new AgentError("E_AGENT_BUSY", this.o.name);
    const turn: Turn = { text: "", onEvent };
    const { conn, proc } = this;
    this.turn = turn;
    this.status(turn, { type: "status", status: "thinking" });
    try {
      const res = await this.untilExit(conn.agent.request("session/prompt", { sessionId: this.sessionId, prompt: [{ type: "text", text }] }));
      onEvent?.({ type: "done", stopReason: res.stopReason });
      return { text: turn.text, stopReason: res.stopReason };
    } catch (e) {
      // A conexão fechou no meio (o agente caiu): a biblioteca recusa o pedido antes de o processo terminar de sair.
      if (conn.signal.aborted && proc) {
        const err = e instanceof AgentError ? e : new AgentError("E_AGENT_FAILED", this.o.name, `a conexão fechou: ${this.stderr.slice(-500)}`);
        this.dropProcess(proc, err);
        throw err;
      }
      throw classifyAgentError(e, this.o.name);
    } finally {
      this.turn = null;
    }
  }

  /** Cancela o pedido em andamento. O `ask` termina com `stopReason: "cancelled"`. Sem pedido, não faz nada. */
  /** O valor atual de cada opção da sessão aberta (`model`, `effort`, `mode`…), como o agente diz. */
  get configValues(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const o of this.config) if ("currentValue" in o && typeof o.currentValue === "string") out[o.id] = o.currentValue;
    return out;
  }

  /**
   * Aplica os valores que o Kiwi escolheu, um por vez, só onde o atual é outro. Um valor que o agente não oferece fica
   * de fora (e volta na lista `refused`), e a sessão segue com o que tinha. Só com a sessão aberta e sem pedido em andamento.
   */
  async applyConfig(wanted: Record<string, string>): Promise<{ applied: string[]; refused: string[] }> {
    const applied: string[] = [];
    const refused: string[] = [];
    if (!this.conn || !this.sessionId) return { applied, refused };
    for (const [configId, value] of Object.entries(wanted)) {
      const option = this.config.find((o) => o.id === configId);
      if (!option || !("options" in option)) continue;
      if (option.currentValue === value) continue;
      const offered = (option.options as unknown as { value?: string; options?: { value: string }[] }[]).flatMap(
        (x): { value?: string }[] => (x.options ? x.options : [x]),
      );
      if (!offered.some((x) => x.value === value)) {
        refused.push(configId);
        continue;
      }
      try {
        const res = await this.untilExit(this.conn.agent.request("session/set_config_option", { sessionId: this.sessionId, configId, value }));
        if (Array.isArray(res.configOptions)) this.config = res.configOptions;
        applied.push(configId);
      } catch (e) {
        const err = classifyAgentError(e, this.o.name);
        if (err.code !== "E_AGENT_FAILED") throw err;
        refused.push(configId);
      }
    }
    return { applied, refused };
  }

  /** Mata o processo na hora, sem esperar (a saída do app, no `process.on("exit")`): o adaptador fecha limpo com o SIGTERM. */
  killNow(): void {
    try {
      this.proc?.kill("SIGTERM");
    } catch {
      /* já saiu */
    }
  }

  async cancel(): Promise<void> {
    if (!this.turn || !this.conn || !this.sessionId) return;
    await this.conn.agent.notify("session/cancel", { sessionId: this.sessionId });
  }

  /**
   * Fecha o agente: fecha a conexão e o stdin, manda o SIGTERM (o adaptador do Claude Code fecha limpo com ele) e
   * espera até 2 s; se o processo não sair, manda o SIGKILL.
   */
  async stop(): Promise<void> {
    const proc = this.proc;
    this.conn?.close();
    this.conn = null;
    this.proc = null;
    this.sessionId = null;
    if (!proc) return;
    try {
      (proc.stdin as import("bun").FileSink).end();
    } catch {
      /* já fechado */
    }
    proc.kill("SIGTERM");
    const done = await Promise.race([proc.exited.then(() => true), Bun.sleep(STOP_GRACE_MS).then(() => false)]);
    if (!done) {
      proc.kill("SIGKILL");
      await proc.exited;
    }
  }

  /**
   * O agente fechou sozinho (caiu), e não pelo `stop()`: o host volta a "fechado", e um `start()` abre de novo
   * (revisão do T8478). O `stop()` zera o `proc` antes de matar, então ele não passa por aqui.
   */
  private dropProcess(proc: ReturnType<typeof Bun.spawn>, err: AgentError): void {
    if (this.proc !== proc) return;
    this.lastExit = err;
    this.conn?.close();
    this.conn = null;
    this.proc = null;
    this.sessionId = null;
    proc.kill("SIGKILL"); // a conexão fechou, mas o processo pode estar preso: não fica nada para trás
  }

  /** A promessa, ou o erro de o agente ter fechado no meio. */
  private untilExit<T>(p: Promise<T>): Promise<T> {
    const exited = this.exited;
    if (!exited) return p;
    return Promise.race([p, exited.then((err) => Promise.reject(err))]);
  }

  private onUpdate(n: SessionNotification): void {
    this.o.onUpdate?.(n);
    if (this.replaying || n.sessionId !== this.sessionId) return;
    const turn = this.turn;
    if (!turn) return;
    const u = n.update;
    switch (u.sessionUpdate) {
      case "agent_message_chunk":
        if (u.content.type === "text") {
          turn.text += u.content.text;
          turn.lastStatus = undefined;
          turn.onEvent?.({ type: "text", text: u.content.text });
        }
        break;
      case "agent_thought_chunk":
        this.status(turn, { type: "status", status: "thinking" });
        break;
      case "tool_call":
        this.status(turn, { type: "status", status: "running", tool: toolName(u as unknown as Record<string, unknown>) });
        break;
      default:
        break;
    }
  }

  /** Um status só sai quando muda: dez pedaços de pensamento seguidos são um "thinking". */
  private status(turn: Turn, e: Extract<AgentEvent, { type: "status" }>): void {
    const key = e.status === "running" ? `running:${e.tool}` : e.status;
    if (turn.lastStatus === key) return;
    turn.lastStatus = key;
    turn.onEvent?.(e);
  }

  private collectStderr(stream: ReadableStream<Uint8Array>): void {
    const decoder = new TextDecoder();
    void (async () => {
      const reader = stream.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          this.stderr = (this.stderr + decoder.decode(value, { stream: true })).slice(-STDERR_KEEP);
        }
      } catch {
        /* o processo fechou */
      }
    })();
  }
}

/** O nome da ferramenta de um `tool_call`: o do Claude Code (`_meta.claudeCode.toolName`), o título ou o tipo. */
function toolName(call: Record<string, unknown>): string {
  const meta = call._meta as { claudeCode?: { toolName?: unknown } } | undefined;
  const fromMeta = meta?.claudeCode?.toolName;
  if (typeof fromMeta === "string" && fromMeta) return fromMeta;
  if (typeof call.title === "string" && call.title) return call.title;
  if (typeof call.kind === "string" && call.kind) return call.kind;
  return "ferramenta";
}
