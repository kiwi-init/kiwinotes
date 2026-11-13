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
import { SecretGuard, type DoubtDecider } from "../guardrail/filter.ts";
import { DoubtAnswers, type DoubtAnswer, type StoredAnswer } from "../guardrail/answers.ts";
import { DoubtQuestions, type DoubtCardView } from "../guardrail/questions.ts";
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
import type { AgentChangeView, AgentClaudeStatus, AgentModelChoice, AgentStatus, AgentTurnEvent, AgentUndoResult, AgentUsageView } from "../shared/ui-contract.ts";
import { type AgentLimit, parseResetFromError, parseUsageMarkdown, type SubscriptionUsage, type UsageWindow } from "./usage.ts";
import { UsageStore } from "./usage-store.ts";
import type { AgentSettings } from "../store/settings.ts";
import type { Notices } from "../bun/notices.ts";
import { WaitingNotice, type NoticeState } from "./notice.ts";

/** O prazo da dúvida nos roteiros do WebKit (`KIWI_DOUBT_TIMEOUT_MS`), só com o agente falso (`KIWI_FAKE_AGENT=1`). */
function testDoubtTimeout(): number | undefined {
  const ms = Number(process.env.KIWI_DOUBT_TIMEOUT_MS);
  return process.env.KIWI_FAKE_AGENT === "1" && Number.isInteger(ms) && ms > 0 ? ms : undefined;
}

/** O teto sem uso: depois disso, o programa do agente fecha (a sessão fica guardada e volta no próximo pedido). */
export const AGENT_IDLE_MS = 10 * 60_000;
/** O pedido mais longo que o app manda. */
export const AGENT_MAX_TEXT = 20_000;
/** O comando local do Claude Code que diz o uso da assinatura (spec #11084): só sob demanda. */
export const USAGE_COMMAND = "/usage";
/**
 * As instruções do modo econômico (spec #11084), no começo do pedido: sempre os mesmos bytes, na mesma ordem, para o
 * cache do agente reaproveitar. Nada da pessoa vai aqui.
 */
export const ECONOMY_INSTRUCTIONS =
  "[Modo econômico do Kiwi: responda curto e direto, em poucas linhas. Leia as notas por seção (notes_outline e section), não inteiras.]\n\n";

/** O modelo mais barato que o agente oferece (spec #11084): Haiku, depois Sonnet; null se a lista não tem nenhum. */
export function cheapestModel(models: { value: string; name: string }[]): string | null {
  for (const family of [/haiku/i, /sonnet/i]) {
    const m = models.find((x) => family.test(x.value) || family.test(x.name));
    if (m) return m.value;
  }
  return null;
}
/** O progresso do download sai no máximo uma vez a cada tanto, para não inundar as janelas de eventos. */
const PROGRESS_EVERY_MS = 100;

export interface AgentServiceDeps {
  /** A pasta de dados do app: o adaptador fica em `<dados>/agent/adapter`, e a sessão em `<dados>/agent`. */
  data: string;
  /** O nome que a pessoa vê. */
  name?: string;
  /** O prazo da pergunta na dúvida (spec #9873); 2 minutos, e menos nos testes. */
  doubtTimeoutMs?: number;
  /** O relógio do medidor (spec #11084); os testes andam com ele. */
  now?: () => number;
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
  /** O que a pessoa já respondeu na dúvida (spec #9873), por impressão digital com chave. */
  private readonly answers: DoubtAnswers;
  /** O cartão da pergunta na dúvida, por pedido (spec #9873). */
  private readonly questions: DoubtQuestions;
  /** O gasto que o agente informa, por 8 dias (spec #11084). */
  private readonly usage: UsageStore;
  /** O último `/usage` que a pessoa pediu (só sob demanda), e o erro, se não deu. Só na memória. */
  private subscription: { at: number; usage: SubscriptionUsage | null } | null = null;
  private readonly usageListeners = new Set<(v: AgentUsageView) => void>();
  /** O modo econômico agora, para as ferramentas lerem a cada chamada (spec #11084). */
  private economyNow = false;
  private readonly questionListeners = new Set<(e: { card: string; request: string; open: boolean }) => void>();
  /**
   * A notificação quando o agente espera uma resposta (spec #9839): o app liga com o `attachNotice`, que sabe da janela;
   * sem ela (a CLI sem o aviso falso, os testes), a permissão é "unavailable" e nada notifica.
   */
  private notice: WaitingNotice | null = null;
  private readonly noticeListeners = new Set<(s: NoticeState) => void>();
  /** O último pedido: uma ferramenta que chega sem pedido em andamento entra nele. */
  private lastTurn: string | null = null;
  /** O servidor de ferramentas do programa aberto (ou abrindo): fecha junto com ele. */
  private tools: KiwiToolServer | null = null;
  /**
   * O filtro do guardrail (spec #9818): um por vida do app. A sessão do agente continua de uma abertura para outra, e o
   * guard também; com o app reaberto, um marcador de antes vira "de outra sessão". Desligar o agente começa um guard
   * novo: os segredos da sessão saem da memória (revisão do T9833).
   */
  private guard = new SecretGuard();
  /** As notas do desfazer (spec #9353), pelas capacidades das janelas. */
  private undoNotes: UndoNotes | null = null;
  /** Um desfazer por vez: dois ao mesmo tempo não anotam o registro um por cima do outro. */
  private undoing: Promise<unknown> = Promise.resolve();

  constructor(private readonly d: AgentServiceDeps) {
    this.name = d.name ?? "Claude Code";
    this.reader = d.reader ?? null;
    this.writer = d.writer ?? null;
    this.activity = new AgentActivity({ dir: path.join(agentDir(d.data), "activity") });
    this.answers = new DoubtAnswers(agentDir(d.data));
    this.usage = new UsageStore(agentDir(d.data), d.now);
    this.questions = new DoubtQuestions({
      answers: this.answers,
      // O prazo menor só nos testes: no app de verdade, sempre os 2 minutos.
      ...(d.doubtTimeoutMs ? { timeoutMs: d.doubtTimeoutMs } : testDoubtTimeout() ? { timeoutMs: testDoubtTimeout() } : {}),
      onChange: (e) => this.onQuestion(e),
      onPending: (request, items) =>
        void this.activity.doubts(request, items).catch((err) => this.d.log?.(`[agent] activity: ${String((err as Error)?.message ?? err)}`)),
    });
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

  /** Quem decide a dúvida agora: o pedido em andamento, com as respostas guardadas e o cartão (spec #9873). */
  private decider(): DoubtDecider | undefined {
    const turn = this.turn;
    return turn && !turn.cancelled ? { answers: this.answers, questions: this.questions, request: turn.id } : undefined;
  }

  /** O cartão abriu, mudou ou fechou: avisa a tela (só os ids) e diz no status que o pedido espera a pessoa. */
  private onQuestion(e: { card: string; request: string; open: boolean }): void {
    void this.notice?.onQuestion(e).catch((err) => this.d.log?.(`[agent] notice: ${String((err as Error)?.message ?? err)}`));
    for (const fn of this.questionListeners) {
      try {
        fn(e);
      } catch {
        // quem escuta cuida dos próprios erros
      }
    }
    const turn = this.turn;
    if (!turn || turn.id !== e.request || turn.cancelled) return;
    const card = e.open ? this.questions.current() : null;
    const open = card?.items.find((i) => !i.answer);
    if (open) this.emitTurn({ id: turn.id, type: "status", status: "waiting", ...(open.path ? { target: open.path } : {}) });
    else if (!e.open) this.emitTurn({ id: turn.id, type: "status", status: "thinking" });
  }

  /** Avisa a cada mudança no cartão da dúvida (`agent.questionChanged`): só os ids, nunca o trecho. */
  onQuestionChanged(fn: (e: { card: string; request: string; open: boolean }) => void): () => void {
    this.questionListeners.add(fn);
    return () => this.questionListeners.delete(fn);
  }

  /** O cartão aberto, com os trechos, para a tela (`agent.question`); null sem cartão. */
  question(): DoubtCardView | null {
    return this.questions.current();
  }

  /**
   * A resposta da pessoa (`agent.answer`): a um trecho do cartão aberto, a todos ("É tudo segredo"), ou, depois, a uma
   * dúvida pendente de um pedido na Atividade (por `request` e impressão digital).
   */
  async answerDoubt(a: { card?: string; request?: string; fingerprint?: string; answer?: DoubtAnswer; all?: "hold" }): Promise<true> {
    if (a.card && a.all === "hold") {
      if (!this.questions.holdAll(a.card)) throw new AgentServiceError("E_NOT_FOUND", "Esse cartão já fechou.");
      return true;
    }
    if (!a.fingerprint || !a.answer) throw new AgentServiceError("E_BAD_ARGS", "agent.answer: falta a impressão digital ou a resposta");
    if (a.card) {
      if (!this.questions.answer(a.card, a.fingerprint, a.answer)) throw new AgentServiceError("E_NOT_FOUND", "Esse cartão já fechou.");
      return true;
    }
    if (!a.request) throw new AgentServiceError("E_BAD_ARGS", "agent.answer: falta o cartão ou o pedido");
    const d = await this.activity.answerDoubt(a.request, a.fingerprint, a.answer);
    if (!d) throw new AgentServiceError("E_NOT_FOUND", "Essa dúvida não está no registro.");
    this.answers.set(a.fingerprint, a.answer, d.mask, d.kind);
    return true;
  }

  /** O que a pessoa já respondeu (`agent.answers`), com a máscara, nunca o trecho. */
  answersList(): StoredAnswer[] {
    return this.answers.list();
  }

  /** Esquece uma resposta (`agent.forget`): o trecho volta a ser perguntado. */
  forgetAnswer(fingerprint: string): boolean {
    return this.answers.forget(fingerprint);
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
      const done = e.change
        ? this.activity.change(id, e.change)
        : this.activity.read(id, { tool: e.tool, ...(e.target ? { target: e.target } : {}), ...(e.held ? { held: e.held } : {}) });
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
  private snapshot(): Omit<AgentStatus, "name" | "enabled" | "consented" | "model" | "effort" | "economy"> {
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
    return { name: this.name, enabled: s.enabled, consented: s.consented, ...snap, model: s.model, effort: s.effort, economy: s.economy === true };
  }

  /** O modelo e o esforço que o Kiwi pede: no modo econômico, o modelo mais barato que o agente oferece (spec #11084). */
  private wantedConfig(s: AgentSettings): { model: string; effort: string } {
    const cheap = s.economy ? cheapestModel(this.knownModels()) : null;
    return { model: cheap ?? s.model, effort: s.effort };
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

  /** O medidor não derruba o pedido: um erro ao gravar o gasto vai para o log. */
  private safely(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.d.log?.(`[agent] usage: ${String((err as Error)?.message ?? err)}`);
    }
  }

  /** O uso da janela que chegou no meio de um pedido (spec #11084). */
  private noteLimit(request: string, limit: AgentLimit): void {
    let warn = false;
    this.safely(() => {
      warn = this.usage.noteLimit(limit);
    });
    const resetsAt = limit.resetsAt !== undefined ? { resetsAt: new Date(limit.resetsAt).toISOString() } : {};
    if (warn) this.emitTurn({ id: request, type: "limit", status: "warning", ...(limit.percent !== undefined ? { percent: Math.round(limit.percent) } : {}), ...resetsAt });
    this.emitUsage();
  }

  private emitUsage(): void {
    if (!this.usageListeners.size) return;
    const v = this.usageView();
    for (const fn of this.usageListeners) fn(v);
  }

  /** O medidor mudou (`agent.usageChanged`). */
  onUsageChanged(fn: (v: AgentUsageView) => void): () => void {
    this.usageListeners.add(fn);
    return () => this.usageListeners.delete(fn);
  }

  /** O medidor de Ajustes › Agente (`agent.usage`): o gasto do Kiwi, o último uso da janela e o último `/usage`. */
  usageView(): AgentUsageView {
    const s = this.usage.summary();
    const iso = (ms: number) => new Date(ms).toISOString();
    const win = (w: UsageWindow | undefined) => (w ? { percent: Math.round(w.percent), ...(w.resetsAt !== undefined ? { resetsAt: iso(w.resetsAt) } : {}) } : undefined);
    const sub = this.subscription;
    return {
      fiveHours: s.fiveHours,
      week: s.week,
      top: s.top.map((t) => ({ request: t.request, at: iso(t.at), question: t.question, tokens: t.tokens })),
      limit: s.limit
        ? {
            status: s.limit.status,
            at: iso(s.limit.at),
            ...(s.limit.window ? { window: s.limit.window } : {}),
            ...(s.limit.percent !== undefined ? { percent: Math.round(s.limit.percent) } : {}),
            ...(s.limit.resetsAt !== undefined ? { resetsAt: iso(s.limit.resetsAt) } : {}),
          }
        : null,
      out: s.out ? { at: iso(s.out.at), ...(s.out.resetsAt !== undefined ? { resetsAt: iso(s.out.resetsAt) } : {}) } : null,
      subscription: sub
        ? {
            at: iso(sub.at),
            ...(sub.usage ? { ...(sub.usage.fiveHour ? { fiveHour: win(sub.usage.fiveHour)! } : {}), ...(sub.usage.week ? { week: win(sub.usage.week)! } : {}) } : { unavailable: true }),
          }
        : null,
    };
  }

  /**
   * "Atualizar" (`agent.usageRefresh`): o `/usage` do próprio Claude Code, só quando a pessoa abre o medidor ou clica.
   * Vai como um pedido interno: fora do registro, sem evento de pedido e sem balão. Nada da pessoa vai junto.
   */
  async usageRefresh(): Promise<AgentUsageView> {
    const s = await this.d.settings.load();
    if (!s.enabled || !s.consented) throw fail("E_AGENT_DISABLED");
    if (!installedAdapter({ root: this.root }, this.packages)) throw fromAgentError(new AgentError("E_ADAPTER_MISSING", this.name), this.name);
    if (this.turn) throw fromAgentError(new AgentError("E_AGENT_BUSY", this.name), this.name);
    const marker = { id: `usage-${crypto.randomUUID()}`, cancelled: false };
    this.turn = marker;
    try {
      const host = this.host?.running ? this.host : await this.openProgram();
      const answer = await host.ask(USAGE_COMMAND);
      const now = (this.d.now ?? Date.now)();
      this.subscription = { at: now, usage: parseUsageMarkdown(answer.text, now) };
    } catch (e) {
      throw fromAgentError(e, this.name);
    } finally {
      if (this.turn === marker) this.turn = null;
      this.armIdle();
      this.emitStatus();
    }
    this.emitUsage();
    return this.usageView();
  }

  /** "Apagar o gasto guardado" (`agent.usageClear`): só os pedidos guardados; o estado do limite e o registro do agente ficam. */
  usageClear(): AgentUsageView {
    this.usage.clear();
    this.subscription = null;
    this.emitUsage();
    return this.usageView();
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
    this.questions.closeAll();
    await this.stopProgram("desligado");
    this.guard = new SecretGuard();
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
    // O pedido sai pelo filtro (spec #9818): um segredo colado nele não vai ao agente nem ao registro. O registro
    // começa com a dúvida segurada; ela é decidida no `runTurn` (spec #9873), que grava o pedido como foi.
    const filtered = this.guard.request(text);
    void this.activity.begin(turn.id, filtered.text, filtered.held).catch((err) => this.d.log?.(`[agent] activity: ${String((err as Error)?.message ?? err)}`));
    this.clearIdle();
    this.emitTurn({ id: turn.id, type: "started" });
    this.emitStatus();
    void this.runTurn(turn, text, s);
    return { id: turn.id };
  }

  private async runTurn(turn: { id: string; cancelled: boolean }, text: string, s: AgentSettings): Promise<void> {
    const wanted = this.wantedConfig(s);
    this.economyNow = s.economy;
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
      // A dúvida do texto do pedido é perguntada antes de ele ir ao agente (spec #9873).
      const decided = await this.guard.decide("", text, this.decider(), true);
      text = decided.text;
      void this.activity.setRequest(turn.id, decided.text, decided.held).catch((err) => this.d.log?.(`[agent] activity: ${String((err as Error)?.message ?? err)}`));
      if (turn.cancelled) {
        this.emitTurn({ id: turn.id, type: "done", stopReason: "cancelled", text: "" });
        return;
      }
      // O modo econômico (spec #11084): as instruções fixas vão na frente do pedido, sempre iguais (o cache).
      const answer = await host.ask(s.economy ? ECONOMY_INSTRUCTIONS + text : text, (e) => {
        if (e.type === "done") return; // o `done` sai abaixo, com o texto inteiro
        // O uso da janela (spec #11084) não é um evento do pedido: vai para o medidor, e o aviso, uma vez, para o balão.
        if (e.type === "limit") {
          this.noteLimit(turn.id, e.limit);
          return;
        }
        // Uma ferramenta do Kiwi sai duas vezes: aqui, quando ela começa, com o nome sem o `mcp__kiwi__` e ainda sem o
        // que foi lido ("Lendo uma nota…"; o gato entra em `agindo` na hora, spec #9510), e de novo pelo próprio
        // servidor, quando ela termina, com o `target` (`onToolCall`). O `thinking` de quando ela acaba vem do host
        // (`tool_call_update`). O nome cru nunca chega à tela.
        if (e.type === "status" && e.status === "running" && e.tool.startsWith(KIWI_TOOL_PREFIX)) {
          this.emitTurn({ id: turn.id, type: "status", status: "running", tool: e.tool.slice(KIWI_TOOL_PREFIX.length) });
          return;
        }
        this.emitTurn({ id: turn.id, ...e } as AgentTurnEvent);
      });
      if (answer.usage) {
        // A pergunta guardada é a que já passou pelo guardrail (sem segredo).
        this.safely(() => this.usage.record(turn.id, decided.text, answer.usage!));
        this.emitUsage();
      }
      this.emitTurn({ id: turn.id, type: "done", stopReason: answer.stopReason, text: answer.text });
    } catch (e) {
      if (turn.cancelled) {
        // Desligar ou sair do app no meio fecha o programa: o pedido acaba cancelado, e não "falhou".
        this.emitTurn({ id: turn.id, type: "done", stopReason: "cancelled", text: "" });
      } else {
        const err = fromAgentError(e, this.name);
        if (err.code === "E_AGENT_LIMIT") {
          // A hora de volta só quando o agente a informou: no `rateLimit` de antes, ou na frase da mensagem dele.
          const raw = e instanceof AgentError ? `${e.detail ?? ""} ${e.message}` : e instanceof Error ? e.message : "";
          this.safely(() => this.usage.noteOut(parseResetFromError(raw, (this.d.now ?? Date.now)())));
          const out = this.usageView().out;
          this.emitTurn({ id: turn.id, type: "limit", status: "out", ...(out?.resetsAt ? { resetsAt: out.resetsAt } : {}) });
          this.emitUsage();
        }
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
      this.economyNow = s.economy;
      const wanted = () => this.wantedConfig(s);
      // Um servidor que tenha sobrado de uma abertura anterior fecha antes do novo (revisão do T8956).
      this.stopTools(this.tools);
      const reader = this.reader;
      const writer = this.writer;
      const tools = reader
        ? new KiwiToolServer({
            reader,
            ...(writer ? { writer, journal: this.journal } : {}),
            guard: this.guard,
            decider: () => this.decider(),
            economy: () => this.economyNow,
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
      // O cartão da dúvida fecha, e o que faltava fica como não respondido (spec #9873).
      this.questions.cancel(this.turn.id);
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
  async configure(o: { model?: string; effort?: string; economy?: boolean }): Promise<AgentStatus> {
    const patch: Partial<AgentSettings> = {};
    if (o.model !== undefined) patch.model = o.model;
    if (o.effort !== undefined) patch.effort = o.effort;
    if (o.economy !== undefined) {
      patch.economy = o.economy;
      this.economyNow = o.economy;
    }
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

  /**
   * Liga a notificação (spec #9839) à janela do app: as notificações do macOS (a dylib, ou o aviso falso da CLI), se a
   * janela principal está na vista, e como trazê-la. A janela avisa quando entra e sai da vista pelo `noticeView`.
   */
  attachNotice(o: { notices: Notices; inView: () => boolean; show: () => void }): void {
    this.notice?.stop();
    this.notice = new WaitingNotice({
      ...o,
      card: () => this.questions.current(),
      enabled: async () => (await this.d.settings.load()).notifyWaiting !== false,
      setEnabled: async (on) => void (await this.d.settings.save({ notifyWaiting: on })),
      onChange: (s) => {
        for (const fn of this.noticeListeners) fn(s);
      },
      log: (m) => this.d.log?.(`[agent] ${m}`),
    });
  }

  /** A linha de Ajustes › Agente (`agent.notice`): a permissão do macOS e o liga/desliga. */
  async noticeState(): Promise<NoticeState> {
    if (this.notice) return this.notice.state();
    return { permission: "unavailable", enabled: (await this.d.settings.load()).notifyWaiting !== false };
  }

  /** "Ligar as notificações" (`agent.noticeAllow`): o único caminho que pede a permissão ao macOS. */
  async noticeAllow(): Promise<NoticeState> {
    return this.notice ? this.notice.allow() : this.noticeState();
  }

  /** O liga/desliga "Avisar quando o agente esperar uma resposta" (`agent.noticeSet`). */
  async noticeSet(on: boolean): Promise<NoticeState> {
    if (this.notice) return this.notice.setEnabled(on);
    await this.d.settings.save({ notifyWaiting: on });
    return this.noticeState();
  }

  /** A permissão ou o liga/desliga mudou (o evento `agent.noticeChanged`). */
  onNoticeChanged(fn: (s: NoticeState) => void): () => void {
    this.noticeListeners.add(fn);
    return () => this.noticeListeners.delete(fn);
  }

  /** A janela principal entrou ou saiu da vista. */
  noticeView(inView: boolean): void {
    void this.notice?.onView(inView).catch((err) => this.d.log?.(`[agent] notice: ${String((err as Error)?.message ?? err)}`));
  }

  /** O clique numa notificação do app (o `notification-response` da engine). */
  noticeResponse(e: { id: string; action: string }): void {
    this.notice?.onResponse(e);
  }

  /** O app vai sair: cancela tudo e fecha o programa do agente, esperando ele sair. */
  async close(): Promise<void> {
    this.notice?.stop();
    this.closed = true;
    this.download?.abort.abort();
    await this.stopProgram("o app saiu");
  }

  /** A saída do processo (`process.on("exit")`), sem tempo de esperar: o SIGTERM, que o adaptador trata limpo. */
  killNow(): void {
    this.notice?.stop();
    this.closed = true;
    this.download?.abort.abort();
    this.pending?.killNow();
    this.host?.killNow();
    this.tools?.stop();
  }
}
