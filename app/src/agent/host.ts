// O host do agente (spec #4576, ADR 0012): a peça do Kiwi que abre um agente de CLI, conversa com ele pelo ACP
// (Agent Client Protocol) e devolve a resposta em eventos. Ainda sem tela e sem rede: quem diz qual programa abrir
// é quem chama (a CLI, os testes e, no spec #8368, o adaptador do Claude Code baixado).
//
// O que ele garante:
// - **um pedido por vez,** com cancelar;
// - **a sessão retomada** entre um pedido e outro, e entre uma abertura e outra (o id fica em `session-<agente>.json`,
//   uma por agente, spec #24666);
// - **o agente isolado:** uma pasta de trabalho só dele, sem as configurações pessoais do Claude Code (hooks, regras,
//   servidores MCP) e sem as ferramentas que mexem no Mac. Ele só conversa e, com `kiwiTools`, lê o cofre pelas
//   ferramentas do Kiwi (spec #7496);
// - **erros claros** (`errors.ts`), e nenhum pedido de permissão aceito, menos o das ferramentas do Kiwi (spec #7496):
//   com `kiwiTools`, o agente recebe o servidor MCP do Kiwi e só as ferramentas dele são permitidas.
//
// Nada liga sozinho: o host só abre o agente quando alguém chama `start()`.

import { type AgentLimit, type AgentUsage, parseLimit, parseUsage } from "./usage.ts";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { client, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import type {
  ClientConnection,
  InitializeRequest,
  InitializeResponse,
  McpServer,
  NewSessionRequest,
  RequestPermissionResponse,
  SessionConfigOption,
  SessionNotification,
} from "@agentclientprotocol/sdk";

import { AgentError, classifyAgentError } from "./errors.ts";
import type { AgentKind } from "./kinds.ts";

/** O arquivo da sessão de antes do spec #24666, só do Claude. */
const LEGACY_SESSION = "session.json";

/** Onde fica a sessão guardada de cada agente (spec #24666): `session-claude.json`, `session-gemini.json`. */
export function sessionFileOf(dir: string, kind: AgentKind): string {
  return path.join(dir, `session-${kind}.json`);
}

/**
 * O isolamento que o host pede ao abrir a sessão, no `_meta.claudeCode.options` que o adaptador do Claude Code passa
 * ao SDK por cima dos padrões dele (`claude-agent-acp`, `v1/acp-agent.js` e `v2/agent.js`):
 * - `settingSources: []` não carrega as configurações da pessoa (`~/.claude`, as do projeto e as locais), com os
 *   hooks, as regras e os servidores MCP do terminal;
 * - `strictMcpConfig` usa só os servidores MCP que o Kiwi mandar (o das ferramentas do Kiwi, spec #7496, ou nenhum);
 * - `tools: []` desliga as ferramentas embutidas (o shell, a edição de arquivos). As ferramentas MCP não são embutidas:
 *   as do Kiwi continuam visíveis (doc do Agent SDK). Com "Pesquisar na web" ligado, a sessão abre com a busca e a
 *   leitura de página (`WEB_TOOLS`, spec #19273, em `sessionBase`); desligado, elas não existem na sessão, e não há
 *   pré-aprovação do agente que as chame (revisão do T19300). Trocar o interruptor reabre a sessão no pedido seguinte
 *   (`sessionWeb`), e o pedido de permissão ainda confere o `webTools` (a segunda trava);
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

/**
 * O enxuto (spec #19273): o que a sessão do gato leva para gastar menos, sem tirar função. A conversa compacta ao chegar
 * em 200 mil tokens (`autoCompactWindow`, nas `settings` da sessão; o SDK aceita de 100 mil a 1 milhão), em vez de
 * carregar a janela inteira do modelo a cada turno. Vai por baixo do isolamento, como o `sessionOptions`.
 */
export const LEAN_SESSION_OPTIONS = {
  settings: { autoCompactWindow: 200_000 },
} as const;

/** Os esforços do Claude Code, do mais baixo ao mais alto: sem escolha da pessoa, vai o mais baixo oferecido (#19294). */
export const EFFORT_ORDER = ["low", "medium", "high", "xhigh", "max"] as const;

/**
 * A categoria do ACP de cada papel que o Kiwi escolhe (T25553): uma opção com outro id, mas desta categoria, faz o
 * papel. O esforço é a `thought_level`: no Antigravity, a linha Esforço não aparecia (harry #25549).
 */
export const CONFIG_CATEGORY: Record<string, string> = { model: "model", effort: "thought_level" };

export type AgentEvent =
  | { type: "status"; status: "thinking" }
  | { type: "status"; status: "running"; tool: string }
  | { type: "text"; text: string }
  | { type: "permission"; tool: string; decision: "denied" }
  /** O uso da janela que o agente informou num `usage_update` (spec #11084): só quando ele solta um `rate_limit_event`. */
  | { type: "limit"; limit: AgentLimit }
  | { type: "done"; stopReason: string };

export interface AgentAnswer {
  text: string;
  stopReason: string;
  /** O gasto do pedido que o agente informou no fim (spec #11084), se informou. */
  usage?: AgentUsage;
}

export interface AgentHostOptions {
  /** O nome que a pessoa vê nas mensagens ("Claude Code"). */
  name: string;
  /** O programa do agente que fala ACP pelo stdin e stdout, com os argumentos. */
  command: readonly string[];
  /**
   * A pasta do agente, dentro dos dados do app: `work/` é a pasta de trabalho dele, e `session-<agente>.json` guarda a
   * sessão de cada agente (spec #24666), para trocar de agente não misturar as conversas.
   */
  dir: string;
  /**
   * Qual agente é (spec #24666): o Claude Code (o padrão) recebe o isolamento no `_meta.claudeCode`; o Gemini se isola
   * pelos argumentos e pelo ambiente com que abre (`gemini.ts`), e a sessão dele vai sem `_meta`.
   */
  kind?: AgentKind;
  /**
   * Como a pessoa entra na conta, quando o agente diz que não está logado: a frase depois de "O {agente} não está
   * logado." Sem ela, "Entre na sua conta pelo próprio {agente}". O Antigravity diz a dele (spec #25046).
   */
  loginHelp?: string;
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
  /**
   * O teto da abertura (o `initialize`, o `session/new` ou a retomada e as opções), em ms. Um agente que não responde
   * dá `E_AGENT_FAILED` e é fechado, em vez de deixar quem espera preso para sempre (revisão do T8678). Padrão: 60 s.
   */
  startTimeoutMs?: number;
  /**
   * As ferramentas do Kiwi (spec #7496): o servidor MCP que vai no `session/new` (montado a cada abertura, com a senha
   * nova) e o prefixo das ferramentas dele (`mcp__kiwi__`). O host pede o `allowedTools` só desse servidor e, num
   * pedido de permissão, aceita só as ferramentas com esse prefixo: o resto continua recusado.
   */
  kiwiTools?: { servers: () => McpServer[]; prefix: string };
  /**
   * "Pesquisar na web" (spec #11908): consultado ao abrir a sessão e a cada pedido de permissão. Ligado, a sessão abre
   * com as ferramentas de web do próprio agente (`WEB_TOOLS`) e o Kiwi as aceita; desligado, ou sem a opção, elas ficam
   * fora da sessão e, se pedidas, são recusadas como qualquer outra. O Kiwi não faz
   * nenhuma chamada de rede: quem busca e lê as páginas é o agente, com o login dele.
   */
  webTools?: () => boolean;
  /**
   * O agente fechou sozinho (caiu), e não pelo `stop()`. O serviço fecha junto o servidor de ferramentas daquela
   * abertura (revisão do T8956).
   */
  onExit?: (err: AgentError) => void;
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
/** O teto padrão da abertura: o Claude Code de verdade abre em poucos segundos. */
const START_TIMEOUT_MS = 60_000;
/** O fim do stderr do agente que fica guardado para explicar uma queda. */
const STDERR_KEEP = 8192;

type Turn = { runningTools?: Set<string>; text: string; onEvent?: (e: AgentEvent) => void; lastStatus?: string };

export class AgentHost {
  private readonly o: AgentHostOptions;
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private conn: ClientConnection | null = null;
  private exited: Promise<AgentError> | null = null;
  /** Por que o agente fechou sozinho, para o `ask` seguinte dizer isso em vez de "não está aberto". */
  private lastExit: AgentError | null = null;
  private stderr = "";
  private sessionId: string | null = null;
  /** A sessão aberta nasceu agora (`session/new`) e ainda não recebeu pedido: a janela (T13835) pode começar nela. */
  private fresh = false;
  /** O `webTools()` da última abertura de sessão: com ele, as ferramentas de web estão no `tools` dela. */
  private openedWeb = false;
  /** O `initialize` da conexão aberta: a sessão nova da janela (T13835) abre com as mesmas capacidades. */
  private init: InitializeResponse | null = null;
  private turn: Turn | null = null;
  /** Durante o `session/load`, o agente repete a conversa antiga em updates: eles não são do pedido de agora. */
  private replaying = false;
  /** As opções da sessão aberta, como o agente respondeu por último. */
  private config: SessionConfigOption[] = [];
  /**
   * O esforço que o agente pôs ao entrar em cada modelo (spec #16793): é o "Padrão" dele quando ele não oferece o valor
   * `default`. Guardado na primeira vez que a sessão aparece no modelo, antes de o Kiwi aplicar o esforço salvo.
   */
  private startEffort = new Map<string, string>();

  constructor(o: AgentHostOptions) {
    this.o = o;
  }

  get workDir(): string {
    return path.join(this.o.dir, "work");
  }

  private get sessionFile(): string {
    return sessionFileOf(this.o.dir, this.o.kind ?? "claude");
  }

  get busy(): boolean {
    return this.turn !== null;
  }

  /** De que agente é este host (spec #24666). */
  get kind(): AgentKind {
    return this.o.kind ?? "claude";
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
      throw classifyAgentError(e, this.o.name, this.o.loginHelp);
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
        const kiwi = this.o.kiwiTools;
        if ((kiwi && tool.startsWith(kiwi.prefix)) || (isWebTool(tool) && this.o.webTools?.() === true)) {
          const allow = params.options.find((o) => o.kind === "allow_once");
          if (allow) return { outcome: { outcome: "selected", optionId: allow.optionId } } satisfies RequestPermissionResponse;
        }
        this.turn?.onEvent?.({ type: "permission", tool, decision: "denied" });
        const reject = params.options.find((o) => o.kind === "reject_once") ?? params.options.find((o) => o.kind === "reject_always");
        const answer: RequestPermissionResponse = reject
          ? { outcome: { outcome: "selected", optionId: reject.optionId } }
          : { outcome: { outcome: "cancelled" } };
        return answer;
      });
    this.conn = app.connect(ndJsonStream(output, proc.stdout as ReadableStream<Uint8Array>));

    const conn = this.conn;
    const open = async (): Promise<AgentSession> => {
      const hello: InitializeRequest = {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: "kiwi-notes", title: "Kiwi Notes", version: this.o.kiwiVersion ?? "dev" },
      };
      const init = await this.untilExit(conn.agent.request("initialize", hello));
      this.init = init;
      const { sessionId, resumed, details } = await this.openSession(init);
      this.sessionId = sessionId;
      this.fresh = !resumed;
      this.config = Array.isArray(details.configOptions) ? (details.configOptions as SessionConfigOption[]) : [];
      // Uma sessão retomada pode trazer o esforço que o Kiwi aplicou antes, não o do agente (revisão #17131).
      if (!resumed) this.noteStartEffort();
      if (this.o.configOptions) await this.applyConfig(this.o.configOptions());
      writeFileSync(this.sessionFile, JSON.stringify({ sessionId }) + "\n", { mode: 0o600 });
      return { sessionId, resumed, agent: { name: init.agentInfo?.title ?? init.agentInfo?.name, version: init.agentInfo?.version }, details };
    };
    const limit = this.o.startTimeoutMs ?? START_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new AgentError("E_AGENT_FAILED", this.o.name, `o agente não abriu a sessão em ${Math.round(limit / 1000)} s`)),
        limit,
      );
    });
    try {
      return await Promise.race([open(), timeout]);
    } catch (e) {
      await this.stop();
      throw classifyAgentError(e, this.o.name, this.o.loginHelp);
    } finally {
      clearTimeout(timer);
    }
  }

  /** A sessão aberta agora (a da janela, T13835), ou null com o agente fechado. */
  get session(): string | null {
    return this.sessionId;
  }

  /** A sessão aberta tem a busca e a leitura de página (`WEB_TOOLS`): o "Pesquisar na web" de quando ela abriu. */
  get sessionWeb(): boolean {
    return this.openedWeb;
  }

  /** A sessão aberta é nova e vazia: nenhum pedido foi a ela (nem um `/usage`). */
  get sessionFresh(): boolean {
    return this.fresh && this.sessionId !== null;
  }

  /**
   * Abre uma sessão nova na mesma conexão (a janela curta, ADR 0013 peça 5): o programa segue aberto, a conversa de antes
   * fica para trás, e o fixo do Claude Code (as instruções e as ferramentas, iguais) continua no cache. As opções (modelo
   * e esforço) são da sessão: voltam a ser aplicadas. A sessão nova é a que um `start()` depois retoma.
   */
  async newSession(): Promise<string> {
    if (!this.conn || !this.sessionId || !this.init) {
      if (this.lastExit) throw this.lastExit;
      throw new Error("o agente não está aberto: chame start() antes");
    }
    if (this.turn) throw new AgentError("E_AGENT_BUSY", this.o.name);
    try {
      const created = await this.untilExit(this.conn.agent.request("session/new", this.sessionBase(this.init)));
      this.sessionId = created.sessionId;
      this.fresh = true;
      this.config = Array.isArray(created.configOptions) ? (created.configOptions as SessionConfigOption[]) : [];
      this.noteStartEffort();
      if (this.o.configOptions) await this.applyConfig(this.o.configOptions());
      writeFileSync(this.sessionFile, JSON.stringify({ sessionId: created.sessionId }) + "\n", { mode: 0o600 });
      return created.sessionId;
    } catch (e) {
      throw classifyAgentError(e, this.o.name, this.o.loginHelp);
    }
  }

  /** O pedido de sessão: o servidor do Kiwi e as opções do isolamento. */
  private sessionBase(init: InitializeResponse): NewSessionRequest {
    const kiwi = this.o.kiwiTools;
    // O servidor do Kiwi vai pelo HTTP do MCP: só para um agente que diz saber (`mcpCapabilities.http`).
    const mcpServers = kiwi && init.agentCapabilities?.mcpCapabilities?.http ? kiwi.servers() : [];
    // Fora do interruptor, as ferramentas de web nem existem na sessão (revisão do T19300).
    this.openedWeb = this.o.webTools?.() === true;
    const options = {
      ...structuredClone(LEAN_SESSION_OPTIONS),
      ...structuredClone(this.o.sessionOptions ?? {}),
      ...structuredClone(ISOLATION_META.claudeCode.options),
      ...(this.openedWeb ? { tools: [...WEB_TOOLS] as string[] } : {}),
      ...(mcpServers.length && kiwi ? { allowedTools: [`${kiwi.prefix}*`] } : {}),
    };
    // O `_meta` é do adaptador do Claude Code. O Gemini não o lê, e o isolamento dele vem de como ele abre.
    if ((this.o.kind ?? "claude") !== "claude") return { cwd: this.workDir, mcpServers };
    return { cwd: this.workDir, mcpServers, _meta: { claudeCode: { options } } };
  }

  /** Retoma a sessão guardada, se o agente sabe (`session/resume`, ou `session/load`); senão, abre uma nova. */
  private async openSession(init: InitializeResponse): Promise<{ sessionId: string; resumed: boolean; details: Record<string, unknown> }> {
    const agent = this.conn!.agent;
    const base = this.sessionBase(init);
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
        const err = classifyAgentError(e, this.o.name, this.o.loginHelp);
        if (err.code !== "E_AGENT_FAILED") throw err;
      } finally {
        this.replaying = false;
      }
    }
    const created = await this.untilExit(agent.request("session/new", base));
    return { sessionId: created.sessionId, resumed: false, details: { ...created } };
  }

  private savedSessionId(): string | null {
    // A sessão do Claude de antes do spec #24666 ficava em `session.json`: ela vale até a primeira gravar a nova.
    const files = (this.o.kind ?? "claude") === "claude" ? [this.sessionFile, path.join(this.o.dir, LEGACY_SESSION)] : [this.sessionFile];
    for (const file of files) {
      try {
        const saved = JSON.parse(readFileSync(file, "utf8")) as { sessionId?: unknown };
        if (typeof saved.sessionId === "string" && saved.sessionId) return saved.sessionId;
        return null;
      } catch {
        /* sem o arquivo: o próximo */
      }
    }
    return null;
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
    this.fresh = false;
    this.status(turn, { type: "status", status: "thinking" });
    try {
      const res = await this.untilExit(conn.agent.request("session/prompt", { sessionId: this.sessionId, prompt: [{ type: "text", text }] }));
      onEvent?.({ type: "done", stopReason: res.stopReason });
      const usage = parseUsage((res as { usage?: unknown }).usage);
      return usage ? { text: turn.text, stopReason: res.stopReason, usage } : { text: turn.text, stopReason: res.stopReason };
    } catch (e) {
      // A conexão fechou no meio (o agente caiu): a biblioteca recusa o pedido antes de o processo terminar de sair.
      if (conn.signal.aborted && proc) {
        const err = e instanceof AgentError ? e : new AgentError("E_AGENT_FAILED", this.o.name, `a conexão fechou: ${this.stderr.slice(-500)}`);
        this.dropProcess(proc, err);
        throw err;
      }
      throw classifyAgentError(e, this.o.name, this.o.loginHelp);
    } finally {
      this.turn = null;
    }
  }

  /** Guarda o esforço com que a sessão chegou ao modelo atual, na primeira vez (o "Padrão" do agente nele). */
  private noteStartEffort(): void {
    const { model, effort } = this.configValues;
    if (model && effort && !this.startEffort.has(model)) this.startEffort.set(model, effort);
  }

  /**
   * A opção da sessão que faz o papel de `configId` (T25553): a do mesmo id e, sem ela, a da categoria do ACP para o
   * papel (`model`, `thought_level`). O adaptador do Claude chama o esforço de `effort`; outro agente pode dar outro id
   * a ele e dizer só a categoria.
   */
  private option(configId: string): SessionConfigOption | undefined {
    const byId = this.config.find((o) => o.id === configId);
    if (byId) return byId;
    const category = CONFIG_CATEGORY[configId];
    return category ? this.config.find((o) => (o as { category?: unknown }).category === category) : undefined;
  }

  /** O valor atual de cada opção da sessão aberta (`model`, `effort`, `mode`…), como o agente diz; o esforço e o modelo também pelo papel. */
  get configValues(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const o of this.config) if ("currentValue" in o && typeof o.currentValue === "string") out[o.id] = o.currentValue;
    for (const role of Object.keys(CONFIG_CATEGORY)) {
      const o = this.option(role);
      if (!(role in out) && o && "currentValue" in o && typeof o.currentValue === "string") out[role] = o.currentValue;
    }
    return out;
  }

  /** O id e a categoria de cada opção da sessão, para o log (T25553): só os nomes que o agente dá, nunca os valores. */
  get configShape(): string {
    return this.config.map((o) => {
      const category = (o as { category?: unknown }).category;
      return typeof category === "string" ? `${o.id} (${category})` : o.id;
    }).join(", ");
  }

  /**
   * As escolhas que o agente oferece numa opção da sessão (`model`, `effort`), com o nome e a descrição, na ordem dele.
   * Os grupos (`options` dentro de `options`) viram uma lista só. Vazio sem a sessão aberta ou sem a opção (T8762).
   */
  choices(configId: string): { value: string; name: string; description?: string }[] {
    const option = this.option(configId);
    if (!option || !("options" in option) || !Array.isArray(option.options)) return [];
    type Choice = { value?: unknown; name?: unknown; description?: unknown; options?: Choice[] };
    const flat = (option.options as unknown as Choice[]).flatMap((x) => (Array.isArray(x.options) ? x.options : [x]));
    const out: { value: string; name: string; description?: string }[] = [];
    for (const x of flat) {
      if (typeof x.value !== "string" || !x.value || out.some((o) => o.value === x.value)) continue;
      const name = typeof x.name === "string" && x.name ? x.name : x.value;
      out.push(typeof x.description === "string" && x.description ? { value: x.value, name, description: x.description } : { value: x.value, name });
    }
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
    for (const [configId, asked] of Object.entries(wanted)) {
      const option = this.option(configId);
      if (!option || !("options" in option)) continue;
      const offered = (option.options as unknown as { value?: string; options?: { value: string }[] }[]).flatMap(
        (x): { value?: string }[] => (x.options ? x.options : [x]),
      );
      // O "Padrão" (a pessoa não escolheu): o esforço mais baixo que o modelo oferece (spec #19273, harry #19294). Um
      // modelo sem nenhum dos níveis conhecidos fica com o `default` dele, ou com o que ele mesmo pôs ao entrar.
      let value = asked;
      if (configId === "effort" && value === "default") {
        const lowest = EFFORT_ORDER.find((e) => offered.some((x) => x.value === e));
        if (lowest) value = lowest;
        else if (!offered.some((x) => x.value === value)) {
          const start = this.startEffort.get(this.configValues.model ?? "");
          if (start) value = start;
        }
      }
      if (option.currentValue === value) continue;
      if (!offered.some((x) => x.value === value)) {
        refused.push(configId);
        continue;
      }
      try {
        const res = await this.untilExit(this.conn.agent.request("session/set_config_option", { sessionId: this.sessionId, configId: option.id, value }));
        if (Array.isArray(res.configOptions)) this.config = res.configOptions;
        if (configId === "model") this.noteStartEffort();
        applied.push(configId);
      } catch (e) {
        const err = classifyAgentError(e, this.o.name, this.o.loginHelp);
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

  /** Cancela o pedido em andamento. O `ask` termina com `stopReason: "cancelled"`. Sem pedido, não faz nada. */
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
    this.init = null;
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
    try {
      this.o.onExit?.(err);
    } catch {
      /* quem ouve não derruba o host */
    }
    this.conn?.close();
    this.conn = null;
    this.proc = null;
    this.sessionId = null;
    this.init = null;
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
        (turn.runningTools ??= new Set()).add(u.toolCallId);
        this.status(turn, { type: "status", status: "running", tool: toolName(u as unknown as Record<string, unknown>) });
        break;
      case "tool_call_update":
        if (u.status === "completed" || u.status === "failed") {
          turn.runningTools?.delete(u.toolCallId);
          if (!turn.runningTools?.size) this.status(turn, { type: "status", status: "thinking" });
        }
        break;
      case "usage_update": {
        // Só o uso da janela (o `rateLimit`); o `cost` em dólar fica de fora (spec #11084).
        const limit = parseLimit((u as { _meta?: unknown })._meta);
        if (limit) turn.onEvent?.({ type: "limit", limit });
        break;
      }
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

/** As ferramentas de web do Claude Code (spec #11908): buscar e ler uma página. */
export const WEB_TOOLS = ["WebSearch", "WebFetch"] as const;
export const isWebTool = (tool: string) => (WEB_TOOLS as readonly string[]).includes(tool);

/**
 * O nome da ferramenta de um `tool_call`: o do Claude Code (`_meta.claudeCode.toolName`), o do Gemini (spec #24666:
 * `_meta["gemini-cli"].mcp`, o servidor e a ferramenta, que viram o mesmo `mcp__<servidor>__<ferramenta>` do Claude
 * Code), o título ou o tipo.
 */
function toolName(call: Record<string, unknown>): string {
  const meta = call._meta as { claudeCode?: { toolName?: unknown }; "gemini-cli"?: { mcp?: { server_name?: unknown; tool_name?: unknown } } } | undefined;
  const fromMeta = meta?.claudeCode?.toolName;
  if (typeof fromMeta === "string" && fromMeta) return fromMeta;
  const mcp = meta?.["gemini-cli"]?.mcp;
  if (typeof mcp?.server_name === "string" && mcp.server_name && typeof mcp.tool_name === "string" && mcp.tool_name) {
    return `mcp__${mcp.server_name}__${mcp.tool_name}`;
  }
  if (typeof call.title === "string" && call.title) return call.title;
  if (typeof call.kind === "string" && call.kind) return call.kind;
  return "ferramenta";
}
