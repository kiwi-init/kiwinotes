// O agente dentro do app (spec #8339, T8678): o que as capacidades `agent.*` chamam. Junta o host (#4576), o adaptador
// (#8368) e os ajustes, e cuida do ciclo do programa do agente. Ainda sem tela: a seção de Ajustes é o spec #8373.
//
// - **Nada liga, baixa nem pede sozinho.** Desligado, nenhuma capacidade abre o programa do agente nem vai à rede. O
//   `agent.status` só confere o Claude Code instalado com `refresh` (a seção abriu, o "Tentar de novo").
// - **O programa abre no primeiro pedido e fica aberto,** para os seguintes não esperarem. Fecha ao desligar, depois de
//   10 minutos sem uso e quando o app sai (`close()` no quit, `killNow()` no `exit`): nunca sobra um Claude Code rodando.
// - **O modelo e o esforço são do Kiwi:** o host aplica os dos ajustes ao abrir a sessão (`session/set_config_option`),
//   e antes de cada pedido, se mudaram. A prova de verdade mostrou que, sem isso, vinham os do terminal (#8666).
// - **Pedir e baixar voltam logo:** a chamada do AppEngine tem teto de 10 s. A resposta chega pelo evento `agent.turn`,
//   e o progresso do download pelo `agent.status`.
// - **As ferramentas do Kiwi** (spec #7496): com o leitor do cofre (`useReader`), o servidor MCP do Kiwi abre junto
//   com o programa do agente, com uma senha nova, e fecha junto com ele. Cada uso de ferramenta vira um status no
//   pedido ("lendo Projetos/Kiwi.md").
// - **A escrita** (spec #8356): com o escritor (`useWriter`), o servidor também oferece as ferramentas de escrita. O
//   registro do agente (`activity.ts`) anota, para cada pedido, o que foi lido e o que mudou, e guarda a cópia do texto
//   de antes de cada mudança, antes dela. O `agent.activity` mostra o registro.
// - **O desfazer** (spec #9353): com as notas do desfazer (`useUndo`), o `agent.undo` volta o que um pedido mudou, pela
//   cópia do registro (`undo.ts`). É da pessoa: não precisa do agente ligado e não vira ferramenta dele. Um por vez.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { AgentError, type AgentErrorCode } from "./errors.ts";
import type { AgentHost, AgentHostOptions } from "./host.ts";
import { KIWI_TOOL_PREFIX, KiwiToolServer, type ToolCallEvent } from "./tools/server.ts";
import type { VaultReader } from "./tools/reader.ts";
import type { VaultWriter } from "./tools/writer.ts";
import type { WriteJournal } from "./tools/tools.ts";
import { AgentActivity, type ActivityRequest } from "./activity.ts";
import { undo, UndoError, type UndoNotes } from "./undo.ts";
import { viewChange } from "./change-view.ts";
import { claudeStatus, type ProgramArgv } from "./claude.ts";
import { downloadAdapter, installedAdapter, removeAdapter } from "./adapter/download.ts";
import { ADAPTER_PACKAGES, ADAPTER_VERSION, type PinnedPackage } from "./adapter/pinned.ts";
import { checkClaudeVersion } from "./adapter/version.ts";
import { adapterRoot, agentDir } from "./adapter/open.ts";
import type { AgentChangeView, AgentClaudeStatus, AgentModelChoice, AgentStatus, AgentTurnEvent, AgentUndoResult } from "../shared/ui-contract.ts";
import type { AgentSettings } from "../store/settings.ts";

/** O teto sem uso: depois disso, o programa do agente fecha (a sessão fica guardada e volta no próximo pedido). */
export const AGENT_IDLE_MS = 10 * 60_000;
/** O pedido mais longo que o app manda. */
export const AGENT_MAX_TEXT = 20_000;
/** O progresso do download sai no máximo uma vez a cada tanto, para não inundar as janelas de eventos. */
const PROGRESS_EVERY_MS = 100;

export interface AgentServiceDeps {
  /** A pasta de dados do app: o adaptador fica em `<dados>/agent/adapter`, e a sessão em `<dados>/agent`. */
  data: string;
  /** O nome que a pessoa vê. */
  name?: string;
  settings: {
    load(): Promise<AgentSettings>;
    save(patch: Partial<AgentSettings>): Promise<AgentSettings>;
  };
  /** Como abrir o `claude` para conferir a versão e o login (o instalado, ou o falso nos testes); null se não há. */
  claude(): ProgramArgv | null;
  /**
   * Monta o host do agente (sem abrir): no app, o adaptador apontado para o Claude Code instalado, depois das
   * conferências; nos testes, o agente falso. Recebe o que o host precisa do serviço.
   */
  openHost(o: {
    configOptions: () => Record<string, string>;
    kiwiTools?: AgentHostOptions["kiwiTools"];
    /** O programa caiu sozinho: o serviço fecha o servidor de ferramentas daquela abertura. */
    onExit: () => void;
  }): Promise<AgentHost>;
  /** O leitor do cofre para as ferramentas do Kiwi (spec #7496). Também pode chegar depois, pelo `useReader`. */
  reader?: VaultReader;
  /** O escritor do cofre (spec #8356): com ele, as ferramentas de escrita aparecem. Também pelo `useWriter`. */
  writer?: VaultWriter;
  /** A versão do Kiwi, que o servidor de ferramentas diz ao agente. */
  version?: string;
  /** O registro do npm e a lista de pacotes (nos testes, um registro falso e uma lista de teste). */
  registry?: string;
  packages?: readonly PinnedPackage[];
  idleMs?: number;
  log?: (msg: string) => void;
}

type AgentCode = AgentErrorCode | "E_AGENT_CONSENT" | "E_AGENT_DISABLED" | "E_BAD_ARGS" | "E_NOT_FOUND" | "E_NO_UNDO";

/** Um erro de capacidade do agente, com o código que a tela entende. */
export class AgentServiceError extends Error {
  constructor(
    readonly code: AgentCode,
    message: string,
  ) {
    super(message);
  }
}

const MESSAGES: Record<"E_AGENT_CONSENT" | "E_AGENT_DISABLED", string> = {
  E_AGENT_CONSENT: "Antes de ligar o agente, a pessoa precisa aceitar a tela que diz o que vai para ele.",
  E_AGENT_DISABLED: "O agente está desligado. Ligue em Ajustes › Agente.",
};

function fail(code: keyof typeof MESSAGES): AgentServiceError {
  return new AgentServiceError(code, MESSAGES[code]);
}

function fromAgentError(e: unknown, name: string): AgentServiceError {
  if (e instanceof AgentServiceError) return e;
  const err = e instanceof AgentError ? e : new AgentError("E_AGENT_FAILED", name, String((e as Error)?.message ?? e));
  return new AgentServiceError(err.code, err.message);
}

export class AgentService {
  private readonly name: string;
  private host: AgentHost | null = null;
  private opening: Promise<AgentHost> | null = null;
  /** O host que ainda está abrindo: o `stopProgram` e o `killNow` fecham ele também, sem esperar a abertura (revisão). */
  private pending: AgentHost | null = null;
  /** Sobe a cada `stopProgram`: um host montado antes de um Desligar não chega a abrir. */
  private epoch = 0;
  private turn: { id: string; cancelled: boolean } | null = null;
  private idle: ReturnType<typeof setTimeout> | null = null;
  private download: { abort: AbortController; done: number; total: number; lastEmit: number } | null = null;
  private downloadError: { code: string; message: string } | undefined;
  private claude: AgentClaudeStatus | null = null;
  /** Os modelos que o agente ofereceu da última vez que abriu (T8762), lidos de `<dados>/agent/models.json` na 1ª vez. */
  private models: AgentModelChoice[] | null = null;
  private applied: Record<string, string> = {};
  private readonly statusListeners = new Set<(s: AgentStatus) => void>();
  private readonly turnListeners = new Set<(e: AgentTurnEvent) => void>();
  private closed = false;
  private reader: VaultReader | null;
  private writer: VaultWriter | null;
  /** O registro do agente (spec #8356): o que cada pedido leu e mudou, e a cópia de antes de cada mudança. */
  private readonly activity: AgentActivity;
  /** O último pedido: uma ferramenta que chega sem pedido em andamento entra nele. */
  private lastTurn: string | null = null;
  /** O servidor de ferramentas do programa aberto (ou abrindo): fecha junto com ele. */
  private tools: KiwiToolServer | null = null;
  /** As notas do desfazer (spec #9353), pelas capacidades das janelas. */
  private undoNotes: UndoNotes | null = null;
  /** Um desfazer por vez: dois ao mesmo tempo não anotam o registro um por cima do outro. */
  private undoing: Promise<unknown> = Promise.resolve();

  constructor(private readonly d: AgentServiceDeps) {
    this.name = d.name ?? "Claude Code";
    this.reader = d.reader ?? null;
    this.writer = d.writer ?? null;
    this.activity = new AgentActivity({ dir: path.join(agentDir(d.data), "activity") });
  }

  /**
   * O leitor do cofre que as ferramentas do Kiwi usam (as capacidades de leitura das janelas). Vale a partir da próxima
   * abertura do programa do agente.
   */
  useReader(reader: VaultReader): void {
    this.reader = reader;
  }

  /**
   * O escritor do cofre (spec #8356): as ferramentas de escrita, pelas capacidades das Notas. Vale a partir da próxima
   * abertura do programa do agente.
   */
  useWriter(writer: VaultWriter): void {
    this.writer = writer;
  }

  /** As notas que o desfazer usa (spec #9353): ler, voltar o texto e mandar para a Lixeira, pelas capacidades das Notas. */
  useUndo(notes: UndoNotes): void {
    this.undoNotes = notes;
  }

  /**
   * Desfaz o pedido inteiro, ou só a mudança `change` dele (1 é a primeira), nota por nota (`agent.undo`, spec #9353).
   * Não abre o programa do agente.
   */
  undo(request: string, change?: number): Promise<AgentUndoResult> {
    const notes = this.undoNotes;
    if (!notes) return Promise.reject(new AgentServiceError("E_NO_UNDO", "Este app não desfaz as mudanças do agente."));
    const run = async () => {
      try {
        return await undo({ activity: this.activity, notes }, request, change);
      } catch (e) {
        if (e instanceof UndoError) throw new AgentServiceError("E_NOT_FOUND", e.message);
        throw e;
      }
    };
    const next = this.undoing.then(run, run);
    this.undoing = next.catch(() => {});
    return next;
  }

  /**
   * O antes e o depois de uma mudança (`agent.change`, spec #9480), para o [Ver] da tela "Atividade do agente". Só lê;
   * não precisa do agente ligado.
   */
  async changeView(request: string, change: number): Promise<AgentChangeView> {
    const notes = this.undoNotes;
    if (!notes) throw new AgentServiceError("E_NO_UNDO", "Este app não mostra as mudanças do agente.");
    try {
      return await viewChange({ activity: this.activity, notes }, request, change);
    } catch (e) {
      if (e instanceof UndoError) throw new AgentServiceError("E_NOT_FOUND", e.message);
      throw e;
    }
  }

  /** Avisa a cada mudança no registro (`agent.activityChanged`, spec #9480), com o id do pedido. */
  onActivity(fn: (request: string) => void): () => void {
    return this.activity.onChanged(fn);
  }

  /** Os pedidos do registro, do mais novo para o mais velho (`agent.activity`). */
  activityLog(limit?: number): Promise<ActivityRequest[]> {
    return this.activity.list(limit);
  }

  /** O pedido em que uma ferramenta entra no registro: o em andamento, ou o último. */
  private activityId(): string {
    return (this.lastTurn ??= `sem-pedido-${crypto.randomUUID()}`);
  }

  /** A cópia de antes de cada escrita vai para o registro, no pedido em que ela acontece. */
  private readonly journal: WriteJournal = {
    keep: (_path, before) => this.activity.keep(this.activityId(), before),
    drop: (copy) => this.activity.drop(copy),
  };

  /** Um uso de ferramenta do Kiwi: entra no registro e vira um status do pedido em andamento. */
  private onToolCall(e: ToolCallEvent): void {
    if (e.ok) {
      const id = this.activityId();
      const done = e.change ? this.activity.change(id, e.change) : this.activity.read(id, { tool: e.tool, ...(e.target ? { target: e.target } : {}) });
      void done.catch((err) => this.d.log?.(`[agent] activity: ${String((err as Error)?.message ?? err)}`));
    }
    const turn = this.turn;
    if (!turn || turn.cancelled) return;
    this.emitTurn({ id: turn.id, type: "status", status: "running", tool: e.tool, ...(e.target ? { target: e.target } : {}) });
  }

  onStatus(fn: (s: AgentStatus) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  onTurn(fn: (e: AgentTurnEvent) => void): () => void {
    this.turnListeners.add(fn);
    return () => this.turnListeners.delete(fn);
  }

  private get root(): string {
    return adapterRoot(this.d.data);
  }

  private get packages(): readonly PinnedPackage[] {
    return this.d.packages ?? ADAPTER_PACKAGES;
  }

  /** O estado. Com `refresh`, confere o Claude Code instalado (abre o `claude --version` e o `auth status`). */
  async status(refresh = false): Promise<AgentStatus> {
    if (refresh) await this.checkClaude();
    return this.statusFrom(this.snapshot(), await this.d.settings.load());
  }

  /** O que muda a todo instante (o download, o programa, o pedido), lido agora, antes de qualquer `await`. */
  private snapshot(): Omit<AgentStatus, "name" | "enabled" | "consented" | "model" | "effort"> {
    const installed = !!installedAdapter({ root: this.root }, this.packages);
    const values = this.host?.running ? this.host.configValues : null;
    return {
      claude: this.claude,
      adapter: {
        version: ADAPTER_VERSION,
        phase: this.download ? "downloading" : installed ? "ready" : this.downloadError ? "error" : "missing",
        ...(this.download ? { done: this.download.done, total: this.download.total } : {}),
        ...(this.downloadError && !this.download ? { error: this.downloadError } : {}),
      },
      program: this.host?.running ? "open" : this.opening ? "opening" : "closed",
      busy: !!this.turn,
      session: values ? { model: values.model, effort: values.effort } : null,
      models: this.knownModels(),
    };
  }

  private get modelsFile(): string {
    return path.join(agentDir(this.d.data), "models.json");
  }

  /** A lista de modelos guardada: a seção mostra as escolhas mesmo com o programa fechado, depois de ele abrir uma vez. */
  private knownModels(): AgentModelChoice[] {
    if (this.models) return this.models;
    try {
      const saved = JSON.parse(readFileSync(this.modelsFile, "utf8")) as unknown;
      this.models = Array.isArray(saved)
        ? saved.filter((m): m is AgentModelChoice => !!m && typeof m.value === "string" && typeof m.name === "string")
        : [];
    } catch {
      this.models = [];
    }
    return this.models;
  }

  /** Guarda os modelos que o agente acabou de oferecer (ao abrir, e depois de trocar as opções). */
  private rememberModels(host: AgentHost): void {
    const models = host.choices("model");
    if (!models.length || JSON.stringify(models) === JSON.stringify(this.knownModels())) return;
    this.models = models;
    try {
      mkdirSync(agentDir(this.d.data), { recursive: true, mode: 0o700 });
      writeFileSync(this.modelsFile, JSON.stringify(models) + "\n", { mode: 0o600 });
    } catch (e) {
      this.d.log?.(`[agent] models: ${String((e as Error)?.message ?? e)}`);
    }
  }

  private statusFrom(snap: ReturnType<AgentService["snapshot"]>, s: AgentSettings): AgentStatus {
    return { name: this.name, enabled: s.enabled, consented: s.consented, ...snap, model: s.model, effort: s.effort };
  }

  private async checkClaude(): Promise<void> {
    const program = this.d.claude();
    const st = await claudeStatus(program);
    const version = checkClaudeVersion(st.version);
    this.claude = {
      installed: st.installed,
      ...(st.version ? { version: st.version } : {}),
      loggedIn: st.loggedIn,
      ...(st.method ? { method: st.method } : {}),
      versionOk: version.ok,
      ...(!version.ok && version.code !== "E_AGENT_NOT_INSTALLED" ? { versionError: version.code } : {}),
    };
  }

  private emitStatus(): void {
    if (!this.statusListeners.size) return;
    // O retrato é de agora: um evento do meio do download não pode sair já com o download acabado.
    const snap = this.snapshot();
    void this.d.settings
      .load()
      .then((s) => {
        const status = this.statusFrom(snap, s);
        for (const fn of this.statusListeners) fn(status);
      })
      .catch((e) => this.d.log?.(`[agent] status: ${String((e as Error)?.message ?? e)}`));
  }

  private emitTurn(e: AgentTurnEvent): void {
    for (const fn of this.turnListeners) fn(e);
  }

  /** Liga. Na primeira vez, só com o aceite da tela do ADR 0011. Não baixa nem abre nada. */
  async enable(consent = false): Promise<AgentStatus> {
    const s = await this.d.settings.load();
    if (!s.consented && !consent) throw fail("E_AGENT_CONSENT");
    await this.d.settings.save({ enabled: true, consented: true });
    this.emitStatus();
    return this.status();
  }

  /** Desliga: cancela o pedido e o download, e fecha o programa na hora. */
  async disable(): Promise<AgentStatus> {
    await this.d.settings.save({ enabled: false });
    this.download?.abort.abort();
    await this.stopProgram("desligado");
    this.emitStatus();
    return this.status();
  }

  /** Começa o download do adaptador e volta logo. O fim (ou o erro) chega pelo `agent.status`. */
  async startDownload(): Promise<AgentStatus> {
    const s = await this.d.settings.load();
    if (!s.enabled) throw fail("E_AGENT_DISABLED");
    if (this.download || installedAdapter({ root: this.root }, this.packages)) return this.status();
    const abort = new AbortController();
    const total = this.packages.reduce((sum, p) => sum + p.size, 0);
    const dl = { abort, done: 0, total, lastEmit: 0 };
    this.download = dl;
    this.downloadError = undefined;
    this.emitStatus();
    void downloadAdapter({
      root: this.root,
      registry: this.d.registry,
      packages: this.packages,
      agentName: this.name,
      signal: abort.signal,
      onProgress: ({ done, total: t }) => {
        dl.done = done;
        dl.total = t;
        const now = Date.now();
        if (now - dl.lastEmit >= PROGRESS_EVERY_MS || done === t) {
          dl.lastEmit = now;
          this.emitStatus();
        }
      },
    })
      .then(
        () => {
          this.downloadError = undefined;
        },
        (e) => {
          const err = fromAgentError(e, this.name);
          this.downloadError = { code: err.code, message: err.message };
          this.d.log?.(`[agent] download: ${err.code}`);
        },
      )
      .finally(() => {
        if (this.download === dl) this.download = null;
        this.emitStatus();
      });
    return this.status();
  }

  /** Manda um pedido e volta logo, com o id. A resposta chega pelo `agent.turn`. */
  async ask(text: string): Promise<{ id: string }> {
    if (typeof text !== "string" || !text.trim()) throw new AgentServiceError("E_BAD_ARGS", "agent.ask: o texto do pedido está vazio");
    if (text.length > AGENT_MAX_TEXT) throw new AgentServiceError("E_BAD_ARGS", `agent.ask: o pedido passa de ${AGENT_MAX_TEXT} caracteres`);
    const s = await this.d.settings.load();
    if (!s.enabled || !s.consented) throw fail("E_AGENT_DISABLED");
    if (!installedAdapter({ root: this.root }, this.packages)) throw fromAgentError(new AgentError("E_ADAPTER_MISSING", this.name), this.name);
    if (this.turn) throw fromAgentError(new AgentError("E_AGENT_BUSY", this.name), this.name);
    const turn = { id: crypto.randomUUID(), cancelled: false };
    this.turn = turn;
    this.lastTurn = turn.id;
    void this.activity.begin(turn.id, text).catch((err) => this.d.log?.(`[agent] activity: ${String((err as Error)?.message ?? err)}`));
    this.clearIdle();
    this.emitTurn({ id: turn.id, type: "started" });
    this.emitStatus();
    void this.runTurn(turn, text, s);
    return { id: turn.id };
  }

  private async runTurn(turn: { id: string; cancelled: boolean }, text: string, s: AgentSettings): Promise<void> {
    const wanted = { model: s.model, effort: s.effort };
    try {
      let host = this.host?.running ? this.host : null;
      if (!host) {
        this.emitTurn({ id: turn.id, type: "status", status: "opening" });
        host = await this.openProgram();
      } else if (wanted.model !== this.applied.model || wanted.effort !== this.applied.effort) {
        await host.applyConfig(wanted);
        this.applied = { ...wanted };
        this.rememberModels(host);
      }
      if (turn.cancelled) {
        this.emitTurn({ id: turn.id, type: "done", stopReason: "cancelled", text: "" });
        return;
      }
      const answer = await host.ask(text, (e) => {
        if (e.type === "done") return; // o `done` sai abaixo, com o texto inteiro
        // O uso de uma ferramenta do Kiwi sai do próprio servidor, com o que foi lido (`onToolCall`).
        if (e.type === "status" && e.status === "running" && e.tool.startsWith(KIWI_TOOL_PREFIX)) return;
        this.emitTurn({ id: turn.id, ...e } as AgentTurnEvent);
      });
      this.emitTurn({ id: turn.id, type: "done", stopReason: answer.stopReason, text: answer.text });
    } catch (e) {
      if (turn.cancelled) {
        // Desligar ou sair do app no meio fecha o programa: o pedido acaba cancelado, e não "falhou".
        this.emitTurn({ id: turn.id, type: "done", stopReason: "cancelled", text: "" });
      } else {
        const err = fromAgentError(e, this.name);
        this.emitTurn({ id: turn.id, type: "error", code: err.code, message: err.message });
      }
    } finally {
      if (this.turn === turn) this.turn = null;
      this.armIdle();
      this.emitStatus();
    }
  }

  /** Abre o programa do agente (uma vez, mesmo com dois pedidos chegando juntos). */
  private openProgram(): Promise<AgentHost> {
    this.opening ??= (async () => {
      const epoch = this.epoch;
      const s = await this.d.settings.load();
      const wanted = () => ({ model: s.model, effort: s.effort });
      // Um servidor que tenha sobrado de uma abertura anterior fecha antes do novo (revisão do T8956).
      this.stopTools(this.tools);
      const reader = this.reader;
      const writer = this.writer;
      const tools = reader
        ? new KiwiToolServer({
            reader,
            ...(writer ? { writer, journal: this.journal } : {}),
            version: this.d.version,
            onCall: (e) => this.onToolCall(e),
          })
        : null;
      let config: ReturnType<KiwiToolServer["start"]> | null = null;
      const kiwiTools = tools
        ? {
            prefix: KIWI_TOOL_PREFIX,
            // O servidor abre só quando o host monta a sessão, e uma vez por abertura (a senha é desta sessão).
            servers: () => [(config ??= tools.start())],
          }
        : undefined;
      const host = await this.d.openHost({
        configOptions: wanted,
        ...(kiwiTools ? { kiwiTools } : {}),
        onExit: () => {
          this.stopTools(tools);
          this.emitStatus();
        },
      });
      if (this.closed || epoch !== this.epoch) throw new AgentError("E_AGENT_FAILED", this.name, "o programa foi fechado antes de abrir");
      this.pending = host;
      this.tools = tools;
      this.emitStatus();
      try {
        await host.start();
      } catch (e) {
        await host.stop();
        this.stopTools(tools);
        throw e;
      } finally {
        if (this.pending === host) this.pending = null;
      }
      this.applied = wanted();
      this.host = host;
      this.rememberModels(host);
      if (this.closed) {
        await this.stopProgram("o app saiu");
        throw new AgentError("E_AGENT_FAILED", this.name, "o app saiu");
      }
      return host;
    })().finally(() => {
      this.opening = null;
      this.emitStatus();
    });
    return this.opening;
  }

  /** Cancela o que estiver andando: o pedido ou o download. */
  async cancel(): Promise<AgentStatus> {
    this.download?.abort.abort();
    if (this.turn) {
      this.turn.cancelled = true;
      await this.host?.cancel();
    }
    return this.status();
  }

  /** Apaga o adaptador baixado, fechando o programa antes. */
  async remove(): Promise<AgentStatus> {
    this.download?.abort.abort();
    await this.stopProgram("o adaptador foi removido");
    removeAdapter({ root: this.root });
    this.downloadError = undefined;
    this.emitStatus();
    return this.status();
  }

  /** O modelo e o esforço do Kiwi. Valem já no próximo pedido. */
  async configure(o: { model?: string; effort?: string }): Promise<AgentStatus> {
    const patch: Partial<AgentSettings> = {};
    if (o.model !== undefined) patch.model = o.model;
    if (o.effort !== undefined) patch.effort = o.effort;
    if (Object.keys(patch).length) await this.d.settings.save(patch);
    this.emitStatus();
    return this.status();
  }

  private clearIdle(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
  }

  private armIdle(): void {
    this.clearIdle();
    if (!this.host?.running || this.closed) return;
    this.idle = setTimeout(() => {
      this.idle = null;
      if (!this.turn) void this.stopProgram("10 minutos sem uso").then(() => this.emitStatus());
    }, this.d.idleMs ?? AGENT_IDLE_MS);
    (this.idle as { unref?: () => void }).unref?.();
  }

  private async stopProgram(why: string): Promise<void> {
    this.epoch++;
    this.clearIdle();
    if (this.turn) {
      this.turn.cancelled = true;
      await this.host?.cancel().catch(() => {});
    }
    // Um programa abrindo é parado na hora, sem esperar a abertura: um agente que não responde não pode prender o
    // Desligar nem a saída do app. O `start()` dele falha, e o pedido acaba cancelado.
    const pending = this.pending;
    this.pending = null;
    if (pending) await pending.stop();
    const opening = this.opening;
    if (opening) await opening.catch(() => {});
    const host = this.host;
    this.host = null;
    if (host?.running) {
      this.d.log?.(`[agent] fechando o programa: ${why}`);
      await host.stop();
    }
    this.stopTools(this.tools);
  }

  /** Fecha o servidor de ferramentas (e esquece a senha dele). */
  private stopTools(tools: KiwiToolServer | null): void {
    if (!tools) return;
    tools.stop();
    if (this.tools === tools) this.tools = null;
  }

  /** O app vai sair: cancela tudo e fecha o programa do agente, esperando ele sair. */
  async close(): Promise<void> {
    this.closed = true;
    this.download?.abort.abort();
    await this.stopProgram("o app saiu");
  }

  /** A saída do processo (`process.on("exit")`), sem tempo de esperar: o SIGTERM, que o adaptador trata limpo. */
  killNow(): void {
    this.closed = true;
    this.download?.abort.abort();
    this.pending?.killNow();
    this.host?.killNow();
    this.tools?.stop();
  }
}
