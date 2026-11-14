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

import { lastSummaryDate, mainNoteWithSummary, SUMMARY_TITLE, summarySection, summarySince } from "./summary.ts";
import { noteWithReferences, REFERENCES_TITLE } from "./references.ts";
import type { SummarySettings } from "../shared/summary-settings.ts";
import { DEFAULT_SUMMARY_SETTINGS, sanitizeSummarySettings } from "../shared/summary-settings.ts";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { AgentError, type AgentErrorCode } from "./errors.ts";
import { isWebTool, type AgentHost, type AgentHostOptions } from "./host.ts";
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
import type {
  AgentChangeView,
  AgentClaudeStatus,
  AgentModelChoice,
  AgentMemoryView,
  AgentProposalSummary,
  AgentRoutineEvent,
  RoutineEventWho,
  AgentProposalView,
  AgentStatus,
  AgentTurnEvent,
  AgentUndoResult,
  AgentUsageView,
} from "../shared/ui-contract.ts";
import { type AgentLimit, parseResetFromError, parseUsageMarkdown, type SubscriptionUsage, type UsageWindow } from "./usage.ts";
import { UsageStore } from "./usage-store.ts";
import { type NoteModel } from "./note-model.ts";
import { fixedPrefix } from "./fixed-prefix.ts";
import { sanitizeAgentOnboarding } from "../shared/agent-onboarding.ts";
import {
  createRoutine,
  CUSTOM_ROUTINES_MAX,
  customRoutineInput,
  deleteRoutine,
  dueRoutine,
  newRoutineId,
  patchRoutines,
  routinesOff,
  sanitizeAgentRoutines,
  updateRoutine,
  type AgentRoutines,
  type CustomRoutineInput,
  type RoutineRef,
} from "../shared/agent-routines.ts";
import { customRoutinePrompt, ROUTINE_LABELS, routineDeclined, routineEconomyQuestion, routineNoteChange, routinePrompt } from "./routines.ts";
import { cleanFact, FACT_MAX_CHARS, factKey, forgetFact, INSTRUCTIONS_MAX, MEMORY_MAX, MemoryError, type MemoryFile, readMemoryFile, rememberFact, writeMemory } from "./memory.ts";

/** Quantas mudanças na memória o [Desfazer] lembra (só na memória do app). */
const MEMORY_OPS_KEEP = 50;
interface MemoryOp {
  id: string;
  /** O pedido do agente em que a mudança aconteceu: o balão mostra todas as do mesmo pedido. */
  request: string;
  /**
   * `full`: a memória cheia recusou o fato (T11808); `over`: a memória escrita à mão passou do limite (spec #12749). Só o
   * aviso no balão, sem [Desfazer].
   */
  action: "remember" | "forget" | "full" | "over";
  fact: string;
  over?: { facts: number; long: number };
  /** Onde o fato estava (para o esquecido voltar no mesmo lugar). */
  index: number;
  at: number;
  undone?: boolean;
}
import {
  addedLines,
  mainHasMeeting,
  mainNoteWithMeeting,
  meetingNoteContent,
  meetingNoteFolder,
  meetingNoteTitle,
  needsChoice,
  ProposalStore,
  type MeetingNoteSettings,
  type MeetingProposal,
  type ProposalFields,
  type ProposalMeeting,
  type ProposalProject,
} from "./proposals.ts";
import type { MemorySink, ProposalDraft, ProposalSink, SummaryDraft } from "./tools/tools.ts";
import { DEFAULT_AGENT_MEETING_SETTINGS, sanitizeAgentMeetingSettings, type AgentMeetingSettings, type AgentSettings } from "../store/settings.ts";
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
/** As instruções do modo econômico (spec #11084): o texto mora no começo fixo (`fixed-prefix.ts`). */
export { ECONOMY_INSTRUCTIONS } from "./fixed-prefix.ts";

/** O modelo mais barato que o agente oferece (spec #11084): Haiku, depois Sonnet; null se a lista não tem nenhum. */
/**
 * O pedido da proposta da reunião (spec #8360): sempre o mesmo texto, com a reunião. O agente lê a transcrição pelo
 * `meetings_get`, que passa pelo guardrail; o áudio nunca vai.
 */
export function meetingPrompt(m: { path: string; title: string }): string {
  return `[Pedido automático do Kiwi] A reunião gravada "${m.title}" (${m.path}) terminou. Leia a transcrição com meetings_get, compare o assunto, os termos e os nomes com os projetos (projects_list) e prepare a proposta com meeting_propose. Não escreva notas: a pessoa aprova a proposta no Kiwi.`;
}

export function cheapestModel(models: { value: string; name: string }[]): string | null {
  for (const family of [/haiku/i, /sonnet/i]) {
    const m = models.find((x) => family.test(x.value) || family.test(x.name));
    if (m) return m.value;
  }
  return null;
}
/** O agendador das rotinas confere a hora a cada 30 s (spec #12150). */
export const ROUTINE_TICK_MS = 30_000;
/** Um limite acabado sem a hora de volta segura as rotinas por 5 horas (a janela do plano). */
const ROUTINE_OUT_UNKNOWN_MS = 5 * 60 * 60_000;
/** Quantos pedidos do registro o fim da rotina olha para achar o dela. */
const ROUTINE_ACTIVITY_LOOKBACK = 20;
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
    /** "Pesquisar na web" (spec #11908): o host pergunta a cada pedido de permissão do agente. */
    webTools?: () => boolean;
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

type AgentCode = AgentErrorCode | "E_AGENT_CONSENT" | "E_AGENT_DISABLED" | "E_BAD_ARGS" | "E_NOT_FOUND" | "E_NO_UNDO" | "E_CHANGED" | "E_SECRET";

/** Um erro de capacidade do agente, com o código que a tela entende. */
/** Um pedido de resumo executivo (spec #11546): com o modo econômico, a pessoa confirma antes. */
const SUMMARY_REQUEST = /resumo\s+executivo/i;
export const SUMMARY_ECONOMY_QUESTION = "O resumo executivo lê várias notas do projeto e gasta mais do seu limite. Fazer agora?";
const SUMMARY_ECONOMY_NO = "Tudo bem, não fiz o resumo: nada foi lido.";

/** O pedido de uma rotina (spec #12150; as novas, #12944): qual, e se foi o "Rodar agora". */
type RoutineTurn = ({ kind: "daily" | "weekly" } | { kind: "custom"; id: string; name: string }) & { manual: boolean };

/** Qual rotina, como o evento `agent.routine` diz: uma nova leva o id e o nome. */
const routineOf = (t: RoutineTurn): RoutineEventWho =>
  t.kind === "custom" ? { kind: "custom", id: t.id, name: t.name } : { kind: t.kind };

/** O nome da rotina, como a pessoa vê. */
const routineName = (t: RoutineTurn) => (t.kind === "custom" ? t.name : ROUTINE_LABELS[t.kind]);

const ROUTINE_FIELD_NAMES: Record<keyof CustomRoutineInput, string> = {
  name: "o nome (até 60 caracteres)",
  prompt: "o que o agente faz (até 1.000 caracteres)",
  time: "a hora (HH:MM)",
  days: "os dias",
  folder: "a pasta",
};

/** Os campos de uma rotina nova, ou o erro que diz qual não vale. */
function routineFields(input: unknown): CustomRoutineInput {
  const r = customRoutineInput(input);
  if (!r.ok) throw new AgentServiceError("E_BAD_ARGS", `Falta ou não vale ${ROUTINE_FIELD_NAMES[r.field]}.`);
  return r.value;
}

const routineGone = () => new AgentServiceError("E_NOT_FOUND", "Essa rotina não existe mais.");

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
  /** "Pesquisar na web" (spec #11908) agora: o host consulta a cada pedido de permissão do agente. */
  private webNow = false;
  /** As propostas das reuniões (spec #8360): guardadas por 30 dias, nada escrito antes do [Aplicar]. */
  private readonly proposals: ProposalStore;
  private readonly proposalListeners = new Set<(list: AgentProposalSummary[]) => void>();
  /** Um [Aplicar], escolher ou [Descartar] por vez: dois cliques rápidos não aplicam a mesma proposta duas vezes. */
  private proposing: Promise<unknown> = Promise.resolve();
  /** As reuniões que esperam o agente acabar o pedido de agora para pedir a proposta (spec #8360). */
  private readonly meetingsQueued: string[] = [];
  /** Os pedidos das rotinas (spec #12150): o fim de cada um vira o evento `agent.routine`. */
  private readonly routineTurns = new Map<string, RoutineTurn>();
  /** A rotina do próximo `ask` (o `startRoutine` marca antes de pedir, e o `ask` a prende ao pedido). */
  private nextRoutine: RoutineTurn | null = null;
  private readonly routineListeners = new Set<(e: AgentRoutineEvent) => void>();
  /** O agendador das rotinas: uma conferência a cada tanto, com o app aberto. */
  private routineTimer: ReturnType<typeof setInterval> | null = null;
  /** Uma conferência por vez. */
  private routineChecking = false;
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
    this.proposals = new ProposalStore(agentDir(d.data), d.now);
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
  /**
   * O Modelo de nota do cofre aberto (spec #11102): vai no começo fixo de todo pedido, antes das instruções do modo
   * econômico, com os mesmos bytes para o mesmo modelo (o cache do agente).
   */
  useNoteModel(source: () => Promise<NoteModel>): void {
    this.noteModel = source;
  }
  private noteModel: (() => Promise<NoteModel>) | null = null;

  /**
   * A raiz do cofre aberto (spec #11469): a memória do agente fica nele, em `.kiwi/agente/sobre-mim.md`. Sem ela (os
   * testes antigos), as ferramentas da memória não aparecem e o pedido vai sem a memória.
   */
  useVaultRoot(source: () => Promise<string>): void {
    this.vaultRoot = source;
  }
  private vaultRoot: (() => Promise<string>) | null = null;

  /** O glossário do ditado (spec #11469, T11667): os termos do dicionário, que vão no começo fixo do pedido. */
  useGlossary(source: () => Promise<string[]>): void {
    this.glossary = source;
  }
  private glossary: (() => Promise<string[]>) | null = null;
  /** As últimas mudanças na memória, para o [Desfazer] do balão. Só na memória do app. */
  private memoryOps: MemoryOp[] = [];
  private readonly memoryListeners = new Set<(v: AgentMemoryView) => void>();
  /** Uma mudança na memória por vez: o agente e a pessoa não gravam um por cima do outro. */
  private memoryQueue: Promise<unknown> = Promise.resolve();

  private oneMemory<T>(run: (root: string) => T | Promise<T>): Promise<T> {
    const go = async () => {
      if (!this.vaultRoot) throw new AgentServiceError("E_NO_UNDO", "Este app não guarda a memória do agente.");
      return run(await this.vaultRoot());
    };
    const next = this.memoryQueue.then(go, go);
    this.memoryQueue = next.catch(() => {});
    return next;
  }

  private memoryOp(action: MemoryOp["action"], fact: string, index: number, over?: MemoryOp["over"]): MemoryOp {
    const op: MemoryOp = { id: crypto.randomUUID(), request: this.activityId(), action, fact, index, at: (this.d.now ?? Date.now)(), ...(over ? { over } : {}) };
    this.memoryOps = [...this.memoryOps, op].slice(-MEMORY_OPS_KEEP);
    return op;
  }

  /**
   * A memória escrita à mão passou do limite (spec #12749): o agente não muda nada, a pessoa vê o aviso no balão com
   * [Abrir a memória], e o agente recebe o erro. Gravar agora apagaria ou deixaria de fora o que ela escreveu.
   */
  private refuseOver(file: MemoryFile, fact: string): void {
    if (!file.skipped.length) return;
    const long = file.skipped.filter((x) => x.reason === "long").length;
    const facts = file.facts.length + file.skipped.length;
    this.emitMemory(file, this.memoryOp("over", cleanFact(fact), file.facts.length, { facts, long }));
    throw new MemoryError(
      "E_MEMORY_OVER",
      `a memória escrita à mão passou do limite (${facts} fatos${long ? `, ${long} com mais de ${FACT_MAX_CHARS} caracteres` : ""}): nada foi mudado. A pessoa arruma em Ajustes › Agente › Memória; não tente de novo neste pedido`,
    );
  }

  /** A `memory_remember` e a `memory_forget` gravam aqui, e o balão mostra a mudança com o [Desfazer]. */
  private readonly memorySink: MemorySink = {
    remember: (fact) =>
      this.oneMemory((root) => {
        const before = readMemoryFile(root);
        this.refuseOver(before, fact);
        let r: ReturnType<typeof rememberFact>;
        try {
          r = rememberFact(before.facts, fact);
        } catch (e) {
          // Cheia (spec #11469, T11808): o agente recebe o erro, e a pessoa vê o aviso no balão, sem [Desfazer].
          if (e instanceof MemoryError && e.code === "E_MEMORY_FULL") this.emitMemory(before, this.memoryOp("full", cleanFact(fact), before.facts.length));
          throw e;
        }
        if (!r.added) return { added: false, total: r.facts.length };
        const file = writeMemory(root, r.facts);
        this.emitMemory(file, this.memoryOp("remember", r.facts[r.index]!, r.index));
        return { added: true, total: file.facts.length };
      }),
    forget: (fact) =>
      this.oneMemory((root) => {
        const before = readMemoryFile(root);
        this.refuseOver(before, fact);
        const r = forgetFact(before.facts, fact);
        const file = writeMemory(root, r.facts);
        this.emitMemory(file, this.memoryOp("forget", r.removed, r.index));
        return { removed: r.removed, total: file.facts.length };
      }),
  };

  private viewOf(file: MemoryFile): AgentMemoryView {
    // As mudanças do último pedido que mexeu na memória, na ordem: cada uma com o seu [Desfazer] no balão.
    const request = this.memoryOps.at(-1)?.request;
    const changes = this.memoryOps
      .filter((o) => o.request === request)
      .map((o) => ({ id: o.id, action: o.action, fact: o.fact, at: new Date(o.at).toISOString(), ...(o.over ? { over: o.over } : {}), ...(o.undone ? { undone: true } : {}) }));
    return { facts: file.facts, max: MEMORY_MAX, changes, skipped: file.skipped, outside: file.outside };
  }

  private emitMemory(file: MemoryFile, _op?: MemoryOp): void {
    const v = this.viewOf(file);
    for (const fn of this.memoryListeners) fn(v);
  }

  /** A memória do agente agora (`agent.memory`), com a última mudança para o balão. Não precisa do agente ligado. */
  memoryView(): Promise<AgentMemoryView> {
    return this.oneMemory((root) => this.viewOf(readMemoryFile(root)));
  }

  /**
   * A pessoa muda a memória em Ajustes › Agente › Memória (`agent.memorySet`, T11668): a lista inteira, na ordem dela.
   * Cada fato passa pelo filtro do guardrail, como o que o agente anota: a memória vai inteira no começo de todo pedido,
   * sem o filtro do pedido, então um trecho com cara de senha ou token é recusado. `skipped` (spec #12749): os fatos
   * escritos à mão que o agente não lê e que ficam no arquivo; sem a lista, ficam todos. As outras linhas do arquivo
   * nunca mudam.
   */
  memorySet(facts: unknown, skipped?: unknown): Promise<AgentMemoryView> {
    if (!Array.isArray(facts) || facts.some((f) => typeof f !== "string")) return Promise.reject(new AgentServiceError("E_BAD_ARGS", "facts deve ser uma lista de textos"));
    if (skipped !== undefined && (!Array.isArray(skipped) || skipped.some((f) => typeof f !== "string")))
      return Promise.reject(new AgentServiceError("E_BAD_ARGS", "skipped deve ser uma lista de textos"));
    const list = (facts as string[]).map(cleanFact).filter(Boolean);
    if (list.length > MEMORY_MAX) return Promise.reject(new AgentServiceError("E_BAD_ARGS", `A memória tem no máximo ${MEMORY_MAX} fatos.`));
    const long = list.find((f) => f.length > FACT_MAX_CHARS);
    if (long !== undefined) return Promise.reject(new AgentServiceError("E_BAD_ARGS", `Um fato tem no máximo ${FACT_MAX_CHARS} caracteres.`));
    const secret = list.find((f) => /‹segredo [^›\n]{0,40}›/.test(f) || this.guard.read("", f).held > 0);
    if (secret !== undefined)
      return Promise.reject(new AgentServiceError("E_SECRET", "Um fato parece ter uma senha ou um token. A memória vai ao agente em todo pedido: tire esse trecho."));
    return this.oneMemory((root) => {
      const saved = writeMemory(root, list, (skipped as string[] | undefined) ?? null);
      this.emitMemory(saved);
      return this.viewOf(saved);
    });
  }

  /**
   * O guardrail na prática (spec #11955, o passo 4 do onboarding): o texto pelo filtro local, num filtro novo, só para
   * mostrar. Nada vai ao agente, nada fica guardado, e os marcadores do pedido de verdade não mudam.
   */
  async guardPreview(text: string): Promise<{ text: string; held: number }> {
    return new SecretGuard().request(text.slice(0, 2000));
  }

  /**
   * "Apagar tudo" (`agent.memoryClear`): todos os fatos saem, também os que o agente não lia. O resto do que a pessoa
   * escreveu no arquivo (parágrafos, títulos) fica (spec #12749).
   */
  memoryClear(): Promise<AgentMemoryView> {
    return this.oneMemory((root) => {
      const saved = writeMemory(root, [], []);
      this.emitMemory(saved);
      return this.viewOf(saved);
    });
  }

  /** A memória mudou (`agent.memoryChanged`): pelo agente, pela pessoa ou por um [Desfazer]. */
  onMemoryChanged(fn: (v: AgentMemoryView) => void): () => void {
    this.memoryListeners.add(fn);
    return () => this.memoryListeners.delete(fn);
  }

  /**
   * O [Desfazer] do balão (`agent.memoryUndo`): o fato anotado sai, ou o esquecido volta no lugar dele. Só a mudança
   * dada, e só se ela ainda vale (a pessoa pode ter mudado a memória depois).
   */
  memoryUndo(id: string): Promise<AgentMemoryView> {
    return this.oneMemory((root) => {
      const op = this.memoryOps.find((o) => o.id === id);
      if (!op) throw new AgentServiceError("E_NOT_FOUND", "Essa mudança na memória já não pode ser desfeita.");
      const file = readMemoryFile(root);
      if (op.undone) return this.viewOf(file);
      if (op.action === "full" || op.action === "over") throw new AgentServiceError("E_BAD_ARGS", "Esse fato não foi anotado: não há o que desfazer.");
      let facts = file.facts;
      const at = facts.findIndex((f) => factKey(f) === factKey(op.fact));
      if (op.action === "remember") {
        if (at >= 0) facts = facts.filter((_, i) => i !== at);
      } else if (at < 0) {
        if (facts.length >= MEMORY_MAX) throw new AgentServiceError("E_BAD_ARGS", `A memória está cheia (${MEMORY_MAX} fatos): apague um antes de trazer este de volta.`);
        facts = [...facts.slice(0, op.index), op.fact, ...facts.slice(op.index)];
      }
      op.undone = true;
      const saved = writeMemory(root, facts);
      this.emitMemory(saved);
      return this.viewOf(saved);
    });
  }

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
        const r = await undo({ activity: this.activity, notes }, request, change);
        await this.proposalUndone(request);
        return r;
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
  private snapshot(): Omit<AgentStatus, "name" | "enabled" | "consented" | "model" | "effort" | "economy" | "controlShortcut" | "meetings" | "summary" | "instructions" | "webSearch" | "onboarding" | "routines"> {
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
    return {
      name: this.name,
      enabled: s.enabled,
      consented: s.consented,
      ...snap,
      model: s.model,
      effort: s.effort,
      economy: s.economy === true,
      controlShortcut: s.controlShortcut === true,
      meetings: s.meetings ?? DEFAULT_AGENT_MEETING_SETTINGS,
      summary: s.summary ?? DEFAULT_SUMMARY_SETTINGS,
      instructions: s.instructions ?? "",
      webSearch: s.webSearch === true,
      onboarding: sanitizeAgentOnboarding(s.onboarding),
      routines: sanitizeAgentRoutines(s.routines),
    };
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

  /** A `meeting_propose` guarda aqui (spec #8360): no pedido em que o agente propôs, e avisa quem escuta. */
  private readonly proposalSink: ProposalSink = {
    propose: async (d: ProposalDraft) => {
      const p = this.proposals.add({ request: this.activityId(), meeting: d.meeting, project: d.project, candidates: d.candidates, fields: d.fields });
      void this.emitProposals();
      return { id: p.id };
    },
    summary: async (d: SummaryDraft) => {
      const since = d.project ? await this.summarySinceFor(d.project) : "";
      const p = this.proposals.add({ kind: "summary", request: this.activityId(), project: d.project, candidates: d.candidates, fields: null, summary: { ...d.fields, since } });
      void this.emitProposals();
      return { id: p.id };
    },
    since: (project: ProposalProject) => this.summarySinceFor(project),
    references: async (d) => {
      const p = this.proposals.add({ kind: "references", request: this.activityId(), project: null, candidates: [], fields: null, references: d });
      void this.emitProposals();
      return { id: p.id };
    },
    // A rotina nova (spec #12944): a pessoa cria, ajusta ou descarta; nada liga sozinho.
    routine: async (d) => {
      const p = this.proposals.add({ kind: "routine", request: this.activityId(), project: null, candidates: [], fields: null, routine: d });
      void this.emitProposals();
      return { id: p.id };
    },
  };

  /** Desde quando "o que andou" conta no resumo de um projeto: o último resumo da nota principal, ou o período de Ajustes. */
  private async summarySinceFor(project: ProposalProject): Promise<string> {
    const content = project.main ? await this.proposalWriter().get(project.main).then((n) => n.content, () => null) : null;
    return summarySince(content, await this.summarySettings(), new Date((this.d.now ?? Date.now)()));
  }

  /**
   * O [Desfazer] do pedido de um [Aplicar] (pelo balão ou pela Atividade): com todas as mudanças dele desfeitas, a
   * proposta fica marcada, e as duas telas dizem "Desfeito" sem oferecer o [Desfazer] de novo.
   */
  private async proposalUndone(request: string): Promise<void> {
    const p = this.proposals.list().find((x) => x.applyRequest === request && x.status === "applied" && x.undoneAt === undefined);
    if (!p) return;
    const r = await this.activity.get(request);
    if (!r || !r.changes.length || r.changes.some((c) => !c.undone)) return;
    this.proposals.update(p.id, (x) => (x.undoneAt = (this.d.now ?? Date.now)()));
    void this.emitProposals();
  }

  /**
   * A forma da nota da reunião (T11478): o Modelo de nota do cofre (#11102), ou o padrão sem ele, e o projeto para as
   * propriedades. O [Ver] e o [Aplicar] leem o modelo de agora: o mesmo texto nos dois.
   */
  private async noteOptions(p: MeetingProposal): Promise<{ model?: NoteModel; project: string | null }> {
    const model = this.noteModel ? await this.noteModel().catch(() => null) : null;
    return { ...(model ? { model } : {}), project: p.project?.name ?? null };
  }

  /** O que a pessoa escolheu em Ajustes › Agente › "Suas reuniões". */
  private async meetingSettings(): Promise<AgentMeetingSettings> {
    return (await this.d.settings.load()).meetings ?? DEFAULT_AGENT_MEETING_SETTINGS;
  }

  private proposalSummary(p: MeetingProposal, s: MeetingNoteSettings): AgentProposalSummary {
    const iso = (ms: number) => new Date(ms).toISOString();
    const short = (x: { folder: string; name: string }) => ({ folder: x.folder, name: x.name });
    const theme = p.kind === "summary" ? SUMMARY_TITLE : p.kind === "references" ? REFERENCES_TITLE : p.kind === "routine" ? (p.routine?.name ?? "") : (p.fields?.theme ?? "");
    return {
      id: p.id,
      at: iso(p.at),
      status: p.status,
      kind: p.kind ?? "meeting",
      meeting: p.meeting ?? null,
      ...(p.summary ? { summary: { signal: p.summary.signal, since: p.summary.since } } : {}),
      ...(p.references ? { references: { note: p.references.note, count: p.references.items.length } } : {}),
      ...(p.routine ? { routine: p.routine } : {}),
      project: p.project ? short(p.project) : null,
      candidates: p.candidates.map(short),
      theme,
      note: p.meeting ? { folder: meetingNoteFolder(p.project, s), title: meetingNoteTitle(p.meeting.date, theme, s.name) } : null,
      ...(p.notePath ? { notePath: p.notePath } : {}),
      ...(p.applyRequest ? { applyRequest: p.applyRequest } : {}),
      ...(p.doneAt !== undefined ? { doneAt: iso(p.doneAt) } : {}),
      ...(p.undoneAt !== undefined ? { undoneAt: iso(p.undoneAt) } : {}),
    };
  }

  private async summaryOf(p: MeetingProposal): Promise<AgentProposalSummary> {
    return this.proposalSummary(p, await this.meetingSettings());
  }

  /** As propostas dos últimos 30 dias (`agent.proposals`), da mais nova para a mais velha. */
  async proposalsList(): Promise<AgentProposalSummary[]> {
    const s = await this.meetingSettings();
    return this.proposals.list().map((p) => this.proposalSummary(p, s));
  }

  /** Avisa a cada proposta nova, escolhida, aplicada ou descartada (`agent.proposalsChanged`). */
  onProposalsChanged(fn: (list: AgentProposalSummary[]) => void): () => void {
    this.proposalListeners.add(fn);
    return () => this.proposalListeners.delete(fn);
  }

  private async emitProposals(): Promise<void> {
    if (!this.proposalListeners.size) return;
    const list = await this.proposalsList().catch(() => null);
    if (!list) return;
    for (const fn of this.proposalListeners) fn(list);
  }

  private proposalOr404(id: unknown): MeetingProposal {
    if (typeof id !== "string" || !id) throw new AgentServiceError("E_BAD_ARGS", "falta o id da proposta");
    const p = this.proposals.get(id);
    if (!p) throw new AgentServiceError("E_NOT_FOUND", "Essa proposta não existe mais (as propostas ficam 30 dias).");
    return p;
  }

  /** A reunião de uma proposta de reunião (um resumo executivo não tem). */
  private meetingOf(p: MeetingProposal): ProposalMeeting {
    if (!p.meeting) throw new AgentServiceError("E_BAD_ARGS", "Essa proposta não é de uma reunião.");
    return p.meeting;
  }

  /** O que a pessoa escolheu para o resumo executivo (spec #11546). */
  private async summarySettings(): Promise<SummarySettings> {
    return (await this.d.settings.load()).summary ?? DEFAULT_SUMMARY_SETTINGS;
  }

  /** O dia local de hoje, `AAAA-MM-DD`. */
  private today(): string {
    const d = new Date((this.d.now ?? Date.now)());
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  /** Os campos de uma proposta pronta; a pergunta do modo econômico ainda não tem. */
  private fieldsOf(p: MeetingProposal): ProposalFields {
    if (!p.fields) throw new AgentServiceError("E_BAD_ARGS", "Essa proposta ainda não foi preparada: toque em [Preparar].");
    return p.fields;
  }

  private proposalWriter(): VaultWriter {
    if (!this.writer) throw new AgentServiceError("E_NO_UNDO", "Este app não escreve as propostas do agente.");
    return this.writer;
  }

  /**
   * [Ver a proposta] (`agent.proposal`): a nota nova e a diferença na nota principal do projeto, como ficariam agora.
   * Só lê; não precisa do agente ligado.
   */
  async proposalView(id: string): Promise<AgentProposalView> {
    const p = this.proposalOr404(id);
    // A rotina (spec #12944) não escreve nota: o [Ajustar] abre o cartão com os campos dela.
    if (p.kind === "routine") return { ...(await this.summaryOf(p)), noteContent: "", main: null };
    if (p.kind === "references") {
      // As referências (spec #11908): as linhas que entram e a nota com elas no fim da seção.
      const summary = await this.summaryOf(p);
      const r = p.references!;
      const before = (await this.proposalWriter().get(r.note)).content;
      const after = noteWithReferences(before, r.items);
      // Com a seção já na nota, só as linhas novas; sem ela, a seção inteira que o Kiwi cria.
      const noteContent = !after.lines.length ? "" : after.created ? `## ${REFERENCES_TITLE}\n\n${after.lines.join("\n")}\n` : `${after.lines.join("\n")}\n`;
      return { ...summary, noteContent, main: { path: r.note, lines: addedLines(before, after.content) } };
    }
    if (p.kind === "summary") {
      // O resumo executivo (spec #11546): a seção como vai ficar, e a nota principal com ela no topo.
      const summary = await this.summaryOf(p);
      const section = summarySection(p.summary!, await this.summarySettings(), this.today());
      let main: AgentProposalView["main"] = null;
      let replaces: string | null = null;
      if (p.project?.main) {
        const before = (await this.proposalWriter().get(p.project.main)).content;
        replaces = lastSummaryDate(before);
        main = { path: p.project.main, lines: addedLines(before, mainNoteWithSummary(before, section)) };
      }
      return { ...summary, noteContent: section, main, ...(replaces ? { replaces } : {}) };
    }
    const meeting = this.meetingOf(p);
    const fields = this.fieldsOf(p);
    const s = await this.meetingSettings();
    const summary = this.proposalSummary(p, s);
    const noteContent = meetingNoteContent(meeting, fields, s, await this.noteOptions(p));
    let main: AgentProposalView["main"] = null;
    if (p.project?.main) {
      const before = (await this.proposalWriter().get(p.project.main)).content;
      const note = summary.note!;
      const notePath = p.notePath ?? `${note.folder ? `${note.folder}/` : ""}${note.title}.md`;
      const after = p.mainDone || mainHasMeeting(before, notePath) ? before : mainNoteWithMeeting(before, notePath, meeting, fields);
      main = { path: p.project.main, lines: addedLines(before, after) };
    }
    return { ...summary, noteContent, main };
  }

  /** Uma operação de proposta por vez, na ordem dos cliques. */
  private oneProposal<T>(run: () => Promise<T>): Promise<T> {
    const next = this.proposing.then(run, run);
    this.proposing = next.catch(() => {});
    return next;
  }

  /** A pessoa escolhe o projeto entre os candidatos, ou "Nenhum: só a nota da reunião" (`folder` null). */
  proposalChoose(id: string, folder: string | null): Promise<AgentProposalSummary> {
    return this.oneProposal(async () => {
      const p = this.proposalOr404(id);
      if (!needsChoice(p)) throw new AgentServiceError("E_BAD_ARGS", "Essa proposta não espera uma escolha de projeto.");
      const chosen = folder === null ? null : p.candidates.find((c) => c.folder === folder);
      if (chosen === undefined) throw new AgentServiceError("E_BAD_ARGS", "Esse projeto não é um dos candidatos da proposta.");
      if (p.kind === "summary" && !chosen) throw new AgentServiceError("E_BAD_ARGS", "O resumo executivo é de um projeto: escolha um dos candidatos.");
      if (p.kind === "summary" && chosen && !chosen.main)
        throw new AgentServiceError("E_BAD_ARGS", `${chosen.name} não tem nota principal: marque uma em Notas, no projeto, e peça o resumo de novo.`);
      const since = p.kind === "summary" && chosen ? await this.summarySinceFor(chosen) : null;
      const next = this.proposals.update(id, (x) => {
        x.project = chosen;
        x.candidates = [];
        if (since && x.summary) x.summary.since = since;
      })!;
      void this.emitProposals();
      return this.summaryOf(next);
    });
  }

  /** [Descartar] (`agent.proposalDiscard`), ou "Agora não" na pergunta do modo econômico: nada muda nas notas. */
  proposalDiscard(id: string): Promise<AgentProposalSummary> {
    return this.oneProposal(async () => {
      const p = this.proposalOr404(id);
      if (p.status !== "pending" && p.status !== "offer") throw new AgentServiceError("E_BAD_ARGS", "Essa proposta já foi aplicada ou descartada.");
      const next = this.proposals.update(id, (x) => {
        x.status = "discarded";
        x.doneAt = (this.d.now ?? Date.now)();
      })!;
      void this.emitProposals();
      return this.summaryOf(next);
    });
  }

  /**
   * [Aplicar] (`agent.proposalApply`): cria a nota da reunião e acrescenta a reunião na nota principal do projeto, num
   * pedido do registro do agente, com a cópia de antes e o [Desfazer] (spec #9353). Não abre o programa do agente.
   */
  proposalApply(id: string, routine?: unknown): Promise<AgentProposalSummary> {
    return this.oneProposal(async () => {
      const p = this.proposalOr404(id);
      if (p.status !== "pending") throw new AgentServiceError("E_BAD_ARGS", p.status === "offer" ? "Essa proposta ainda não foi preparada." : "Essa proposta já foi aplicada ou descartada.");
      if (needsChoice(p)) throw new AgentServiceError("E_BAD_ARGS", p.kind === "summary" ? "Escolha antes o projeto do resumo." : "Escolha antes o projeto da reunião.");
      if (p.kind === "summary") return this.applySummary(p);
      if (p.kind === "references") return this.applyReferences(p);
      if (p.kind === "routine") return this.applyRoutine(p, routine);
      const meeting = this.meetingOf(p);
      const fields = this.fieldsOf(p);
      const writer = this.proposalWriter();
      const s = await this.meetingSettings();
      const request = p.applyRequest ?? `proposta-${crypto.randomUUID()}`;
      if (!p.applyRequest) {
        await this.activity.begin(request, `Aplicar a proposta da reunião "${meeting.title}"`);
        this.proposals.update(id, (x) => (x.applyRequest = request));
      }
      const folderId = await writer.folder();
      const where = folderId ? { folder: folderId } : {};
      // A nota da reunião, uma vez só: um [Aplicar] que parou no meio não cria outra.
      let notePath = p.notePath;
      if (!notePath) {
        const n = await writer.create(meetingNoteFolder(p.project, s), meetingNoteTitle(meeting.date, fields.theme, s.name), meetingNoteContent(meeting, fields, s, await this.noteOptions(p)));
        notePath = n.path;
        this.proposals.update(id, (x) => (x.notePath = n.path));
        await this.activity.change(request, { kind: "created", path: n.path, before: 0, after: n.content.length, version: n.version, ...where });
      }
      if (p.project?.main && !p.mainDone) {
        // Só acrescenta: lida agora e gravada se ninguém mudou a nota no meio; senão, lida de novo.
        for (let tries = 0; ; tries++) {
          const n = await writer.get(p.project.main);
          if (n.readOnly) throw new AgentServiceError("E_BAD_ARGS", `${n.path} não é UTF-8: o Kiwi não escreve nela.`);
          // Um [Aplicar] que parou depois de gravar a principal (antes de marcar): ela já tem a reunião.
          if (mainHasMeeting(n.content, notePath)) break;
          const next = mainNoteWithMeeting(n.content, notePath, meeting, fields);
          const copy = await this.activity.keep(request, n.content);
          const r = await writer.save(n.path, next, n.version).catch(async (e) => {
            await this.activity.drop(copy);
            throw e;
          });
          if (r.saved) {
            this.proposals.update(id, (x) => (x.mainDone = true));
            await this.activity.change(request, { kind: "appended", path: r.path, before: n.content.length, after: next.length, version: r.version, copy, ...where });
            break;
          }
          await this.activity.drop(copy);
          if (tries >= 2) throw new AgentServiceError("E_CHANGED", `${n.path} mudou enquanto o Kiwi aplicava. A nota da reunião já foi criada: tente [Aplicar] de novo.`);
        }
      }
      const done = this.proposals.update(id, (x) => {
        x.status = "applied";
        x.doneAt = (this.d.now ?? Date.now)();
      })!;
      void this.emitProposals();
      return this.summaryOf(done);
    });
  }

  /**
   * [Criar] numa proposta de rotina (spec #12944): a rotina entra desligada, com os campos do agente ou os do cartão do
   * [Ajustar]. Não escreve nota, então não há [Desfazer]: a rotina se apaga em Ajustes.
   */
  private async applyRoutine(p: MeetingProposal, adjusted: unknown): Promise<AgentProposalSummary> {
    const fields = routineFields(adjusted ?? p.routine);
    await this.saveRoutines(async (current) => {
      if (current.custom.length >= CUSTOM_ROUTINES_MAX) throw new AgentServiceError("E_BAD_ARGS", `Cabem até ${CUSTOM_ROUTINES_MAX} rotinas novas: apague uma antes.`);
      return createRoutine(current, fields, newRoutineId(current.custom));
    });
    const done = this.proposals.update(p.id, (x) => {
      x.status = "applied";
      x.routine = fields;
      x.doneAt = (this.d.now ?? Date.now)();
    })!;
    void this.emitProposals();
    return this.summaryOf(done);
  }

  /**
   * [Aplicar] num resumo executivo (spec #11546): só a nota principal muda. A seção entra no topo, ou troca a anterior,
   * que fica nas Versões; a escrita entra no registro, com a cópia de antes e o [Desfazer]. Lida de novo se a nota
   * mudou no meio.
   */
  /**
   * O [Aplicar] das referências (spec #11908): só a nota pedida, no fim da seção "Referências", sem repetir um link que
   * ela já tem. Uma escrita como as outras: a cópia de antes no registro, as Versões e o [Desfazer].
   */
  private async applyReferences(p: MeetingProposal): Promise<AgentProposalSummary> {
    const r = p.references!;
    const writer = this.proposalWriter();
    const request = p.applyRequest ?? `referencias-${crypto.randomUUID()}`;
    if (!p.applyRequest) {
      await this.activity.begin(request, `Aplicar as referências de "${r.note.replace(/\.md$/i, "")}"`);
      this.proposals.update(p.id, (x) => (x.applyRequest = request));
    }
    const folderId = await writer.folder();
    const where = folderId ? { folder: folderId } : {};
    for (let tries = 0; ; tries++) {
      const n = await writer.get(r.note);
      if (n.readOnly) throw new AgentServiceError("E_BAD_ARGS", `${n.path} não é UTF-8: o Kiwi não escreve nela.`);
      const next = noteWithReferences(n.content, r.items).content;
      if (next === n.content) break;
      const copy = await this.activity.keep(request, n.content);
      const w = await writer.save(n.path, next, n.version).catch(async (e) => {
        await this.activity.drop(copy);
        throw e;
      });
      if (w.saved) {
        await this.activity.change(request, { kind: "appended", path: w.path, section: REFERENCES_TITLE, before: n.content.length, after: next.length, version: w.version, copy, ...where });
        break;
      }
      await this.activity.drop(copy);
      if (tries >= 2) throw new AgentServiceError("E_CHANGED", `${n.path} mudou enquanto o Kiwi aplicava. Tente [Aplicar] de novo.`);
    }
    const done = this.proposals.update(p.id, (x) => {
      x.status = "applied";
      x.doneAt = (this.d.now ?? Date.now)();
    })!;
    void this.emitProposals();
    return this.summaryOf(done);
  }

  private async applySummary(p: MeetingProposal): Promise<AgentProposalSummary> {
    const main = p.project?.main;
    if (!main) throw new AgentServiceError("E_BAD_ARGS", "Esse projeto não tem nota principal: marque uma em Notas, no projeto.");
    const writer = this.proposalWriter();
    const section = summarySection(p.summary!, await this.summarySettings(), this.today());
    const request = p.applyRequest ?? `resumo-${crypto.randomUUID()}`;
    if (!p.applyRequest) {
      await this.activity.begin(request, `Aplicar o resumo executivo de "${p.project!.name}"`);
      this.proposals.update(p.id, (x) => (x.applyRequest = request));
    }
    const folderId = await writer.folder();
    const where = folderId ? { folder: folderId } : {};
    for (let tries = 0; ; tries++) {
      const n = await writer.get(main);
      if (n.readOnly) throw new AgentServiceError("E_BAD_ARGS", `${n.path} não é UTF-8: o Kiwi não escreve nela.`);
      const next = mainNoteWithSummary(n.content, section);
      if (next === n.content) break;
      const copy = await this.activity.keep(request, n.content);
      const r = await writer.save(n.path, next, n.version).catch(async (e) => {
        await this.activity.drop(copy);
        throw e;
      });
      if (r.saved) {
        await this.activity.change(request, { kind: "replaced", path: r.path, section: SUMMARY_TITLE, before: n.content.length, after: next.length, version: r.version, copy, ...where });
        break;
      }
      await this.activity.drop(copy);
      if (tries >= 2) throw new AgentServiceError("E_CHANGED", `${n.path} mudou enquanto o Kiwi aplicava. Tente [Aplicar] de novo.`);
    }
    const done = this.proposals.update(p.id, (x) => {
      x.status = "applied";
      x.doneAt = (this.d.now ?? Date.now)();
    })!;
    void this.emitProposals();
    return this.summaryOf(done);
  }

  /**
   * A transcrição de uma reunião ficou pronta (spec #8360): com o agente ligado e "propor sozinho", o Kiwi pede a
   * proposta, sem a pessoa pedir. Uma reunião só gera uma. Com o modo econômico, só pergunta antes de gastar (a
   * `offer`). Com o agente ocupado, espera o pedido de agora acabar. Nunca lança: o fim da reunião não depende disto.
   */
  async meetingReady(path: string): Promise<void> {
    try {
      const s = await this.d.settings.load();
      if (!s.enabled || !s.consented || (s.meetings ?? DEFAULT_AGENT_MEETING_SETTINGS).propose !== "auto") return;
      if (!this.reader || !this.writer || !installedAdapter({ root: this.root }, this.packages)) return;
      if (this.meetingsQueued.includes(path) || this.proposals.hasMeeting(path)) return;
      const meeting = (await this.reader.meetings()).find((m) => m.path === path && !m.live);
      if (!meeting) return;
      const m = { path: meeting.path, title: meeting.title, date: meeting.date };
      if (s.economy) {
        this.proposals.add({ request: "", meeting: m, project: null, candidates: [], fields: null }, "offer");
        void this.emitProposals();
        return;
      }
      this.meetingsQueued.push(path);
      this.nextMeeting();
    } catch (e) {
      this.d.log?.(`[agent] meeting proposal: ${String((e as Error)?.message ?? e)}`);
    }
  }

  /**
   * [Preparar] na pergunta do modo econômico (`agent.proposalPrepare`): gasta o pedido agora. A resposta chega como
   * um pedido comum (`agent.turn`), e a proposta pronta pelo `agent.proposalsChanged`.
   */
  async proposalPrepare(id: string): Promise<{ id: string }> {
    const p = this.proposalOr404(id);
    if (p.status !== "offer") throw new AgentServiceError("E_BAD_ARGS", "Essa proposta já foi preparada.");
    return this.ask(meetingPrompt(this.meetingOf(p)));
  }

  /** Manda o pedido da próxima reunião da fila, se o agente está livre. */
  private nextMeeting(): void {
    if (this.turn) return;
    const path = this.meetingsQueued.shift();
    if (!path) return;
    void (async () => {
      const meeting = (await this.reader?.meetings())?.find((m) => m.path === path);
      if (!meeting || this.proposals.hasMeeting(path)) return this.nextMeeting();
      await this.ask(meetingPrompt({ path: meeting.path, title: meeting.title }));
    })().catch((e) => {
      this.d.log?.(`[agent] meeting proposal: ${String((e as Error)?.message ?? e)}`);
      this.nextMeeting();
    });
  }

  // ── As rotinas (spec #12150) ─────────────────────────────────────────────────────────────────────────────────────

  /** O relógio do serviço (o do medidor e das rotinas): falso nos testes. */
  private clock(): number {
    return (this.d.now ?? Date.now)();
  }

  onRoutine(fn: (e: AgentRoutineEvent) => void): () => void {
    this.routineListeners.add(fn);
    return () => this.routineListeners.delete(fn);
  }

  private emitRoutine(e: AgentRoutineEvent): void {
    for (const fn of this.routineListeners) fn(e);
  }

  /**
   * Liga o agendador (o app e o headless, depois do leitor e do escritor do cofre): uma conferência agora, que pega a
   * rotina que passou da hora com o app fechado, e outra a cada `everyMs`.
   */
  startRoutines(everyMs = ROUTINE_TICK_MS): void {
    if (this.routineTimer || this.closed) return;
    this.routineTimer = setInterval(() => void this.routineTick(), everyMs);
    (this.routineTimer as { unref?: () => void }).unref?.();
    void this.routineTick();
  }

  private stopRoutines(): void {
    if (this.routineTimer) clearInterval(this.routineTimer);
    this.routineTimer = null;
  }

  /**
   * Uma conferência do agendador: a primeira rotina na hora roda. Com o agente desligado, sem o adaptador ou ocupado,
   * nada roda agora, e a próxima conferência tenta de novo (no mesmo dia). Nunca lança.
   */
  async routineTick(): Promise<void> {
    if (this.routineChecking || this.closed) return;
    this.routineChecking = true;
    try {
      const s = await this.d.settings.load();
      if (!s.enabled || !s.consented || this.turn) return;
      if (!this.reader || !this.writer || !installedAdapter({ root: this.root }, this.packages)) return;
      const routines = sanitizeAgentRoutines(s.routines);
      const now = new Date(this.clock());
      const due = dueRoutine(routines, now);
      if (due) await this.startRoutine(due, false);
    } catch (e) {
      this.d.log?.(`[agent] routine: ${String((e as Error)?.message ?? e)}`);
    } finally {
      this.routineChecking = false;
    }
  }

  /** "Rodar agora" (`agent.routineRun`): o pedido da rotina já, ligada ou não. Uma nova, pelo id. */
  async routineRun(ref: RoutineRef): Promise<{ id: string }> {
    const s = await this.d.settings.load();
    if (!s.enabled || !s.consented) throw fail("E_AGENT_DISABLED");
    if (ref.kind === "custom" && !sanitizeAgentRoutines(s.routines).custom.some((x) => x.id === ref.id)) throw routineGone();
    return this.startRoutine(ref, true);
  }

  /**
   * "Nova rotina" (`agent.routineCreate`, spec #12944): entra desligada, como as prontas. Também é o [Criar] da proposta
   * do agente (o `proposalApply` de uma proposta de rotina).
   */
  async routineCreate(input: unknown): Promise<AgentStatus> {
    const fields = routineFields(input);
    await this.saveRoutines(async (current) => {
      if (current.custom.length >= CUSTOM_ROUTINES_MAX) throw new AgentServiceError("E_BAD_ARGS", `Cabem até ${CUSTOM_ROUTINES_MAX} rotinas novas: apague uma antes.`);
      return createRoutine(current, fields, newRoutineId(current.custom));
    });
    return this.status();
  }

  /** Muda uma rotina nova (`agent.routineUpdate`): o liga/desliga e os campos dados. Ligar ou mudar a hora arma de novo. */
  async routineUpdate(id: string, patch: { on?: boolean } & Partial<CustomRoutineInput>): Promise<AgentStatus> {
    await this.saveRoutines(async (current) => {
      const before = current.custom.find((x) => x.id === id);
      if (!before) throw routineGone();
      const { on, ...fields } = patch;
      const checked = Object.keys(fields).length ? routineFields({ ...before, ...fields }) : {};
      return updateRoutine(current, id, { ...checked, ...(on !== undefined ? { on } : {}) }, this.clock())!;
    });
    return this.status();
  }

  /** Apaga uma rotina nova (`agent.routineDelete`). As prontas não se apagam: só se desligam. */
  async routineDelete(id: string): Promise<AgentStatus> {
    await this.saveRoutines(async (current) => deleteRoutine(current, id) ?? Promise.reject(routineGone()));
    return this.status();
  }

  /** Lê, muda e grava as rotinas, uma mudança por vez (duas mudanças rápidas não perdem uma rotina). */
  private routineEdits: Promise<unknown> = Promise.resolve();
  private saveRoutines(change: (current: AgentRoutines) => Promise<AgentRoutines>): Promise<void> {
    const next = this.routineEdits.then(async () => {
      const current = sanitizeAgentRoutines((await this.d.settings.load()).routines);
      await this.d.settings.save({ routines: await change(current) });
      this.emitStatus();
    });
    this.routineEdits = next.catch(() => {});
    return next;
  }

  /**
   * Manda o pedido da rotina e só então marca a vez dela (a mesma não dispara de novo no próximo tique). Se um pedido da
   * pessoa entrou antes, o `ask` falha com E_AGENT_BUSY e nada é marcado: a próxima conferência tenta de novo, no mesmo
   * dia (revisão do #479). Com o limite do plano acabado, não manda nada, marca a vez (o dia pula) e avisa (o evento
   * `agent.routine`).
   */
  private async startRoutine(ref: RoutineRef, manual: boolean): Promise<{ id: string }> {
    const now = this.clock();
    const s = await this.d.settings.load();
    const routines = sanitizeAgentRoutines(s.routines);
    const custom = ref.kind === "custom" ? routines.custom.find((x) => x.id === ref.id) : undefined;
    if (ref.kind === "custom" && !custom) throw routineGone();
    const who: RoutineTurn = custom ? { kind: "custom", id: custom.id, name: custom.name, manual } : { kind: ref.kind as "daily" | "weekly", manual };
    const out = this.usageView().out;
    const limited = out !== null && (out.resetsAt ? Date.parse(out.resetsAt) > now : now - Date.parse(out.at) < ROUTINE_OUT_UNKNOWN_MS);
    const mark = () =>
      this.saveRoutines(async (current) => {
        const at = new Date(now).toISOString();
        if (who.kind !== "custom") return { ...current, [who.kind]: { ...current[who.kind], lastRun: at } };
        // Apagada no meio do pedido: não há o que marcar.
        return { ...current, custom: current.custom.map((x) => (x.id === who.id ? { ...x, lastRun: at } : x)) };
      });
    if (limited) {
      await mark();
      this.emitRoutine({ ...routineOf(who), phase: "skipped", reason: "limit", ...(out.resetsAt ? { resetsAt: out.resetsAt } : {}) });
      throw fromAgentError(new AgentError("E_AGENT_LIMIT", this.name), this.name);
    }
    this.nextRoutine = who;
    let sent: { id: string };
    try {
      sent = await this.ask(custom ? customRoutinePrompt(custom, new Date(now)) : routinePrompt(who.kind as "daily" | "weekly", routines[who.kind as "daily" | "weekly"].folder, new Date(now)));
    } finally {
      this.nextRoutine = null;
    }
    await mark();
    return sent;
  }

  /** O fim de uma rotina: a nota que o pedido criou (pela Atividade), para o balão [Ver] [Manter] [Descartar]. */
  private async finishRoutine(request: string, who: RoutineTurn): Promise<void> {
    let found: { note: string; change: number } | null = null;
    try {
      const r = (await this.activity.list(ROUTINE_ACTIVITY_LOOKBACK)).find((x) => x.id === request);
      found = r ? routineNoteChange(r.changes) : null;
    } catch (e) {
      this.d.log?.(`[agent] routine: ${String((e as Error)?.message ?? e)}`);
    }
    this.emitRoutine({ ...routineOf(who), phase: "done", request, note: found?.note ?? null, change: found?.change ?? null });
  }

  /** Liga. Na primeira vez, só com o aceite da tela do ADR 0011. Não baixa nem abre nada. */
  async enable(consent = false): Promise<AgentStatus> {
    const s = await this.d.settings.load();
    if (!s.consented && !consent) throw fail("E_AGENT_CONSENT");
    // A primeira vez que o agente liga abre o onboarding (spec #11955). Quem já o tinha ligado antes dele, só pelo
    // "Refazer o onboarding" em Ajustes.
    const first = sanitizeAgentOnboarding(s.onboarding).state === "pending";
    await this.d.settings.save({ enabled: true, consented: true, ...(first ? { onboarding: { state: "open", step: 1 } } : {}) });
    this.emitStatus();
    return this.status();
  }

  /** Desliga: cancela o pedido e o download, e fecha o programa na hora. */
  async disable(): Promise<AgentStatus> {
    // Desligar o agente desliga as rotinas (spec #12150): ligar de novo não as religa sozinho.
    const s0 = await this.d.settings.load();
    await this.d.settings.save({ enabled: false, routines: routinesOff(sanitizeAgentRoutines(s0.routines)) });
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
    // O pedido de uma rotina (spec #12150): o fim dele vira o evento `agent.routine`.
    if (this.nextRoutine) this.routineTurns.set(turn.id, this.nextRoutine);
    this.nextRoutine = null;
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
    this.webNow = s.webSearch === true;
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
      // O resumo executivo com o modo econômico (spec #11546): ele lê várias notas, então a pessoa diz antes se pode
      // gastar. Sem resposta no prazo é "não", e nada vai ao agente.
      if (s.economy && SUMMARY_REQUEST.test(text)) {
        const go = await this.questions.confirm(turn.id, SUMMARY_ECONOMY_QUESTION);
        if (!go || turn.cancelled) {
          this.emitTurn({ id: turn.id, type: "done", stopReason: "cancelled", text: go ? "" : SUMMARY_ECONOMY_NO });
          return;
        }
      }
      // Uma rotina na hora marcada, com o modo econômico (spec #12150): a pessoa diz antes se pode gastar o pedido. O
      // "Rodar agora" não pergunta: o clique já foi o sim, e o cartão diz que gasta.
      const routineNow = this.routineTurns.get(turn.id);
      if (routineNow && !routineNow.manual && s.economy) {
        const name = routineName(routineNow);
        const go = await this.questions.confirm(turn.id, routineEconomyQuestion(name));
        if (!go || turn.cancelled) {
          this.emitTurn({ id: turn.id, type: "done", stopReason: "cancelled", text: go ? "" : routineDeclined(name, routineNow.kind !== "custom") });
          if (!go) this.emitRoutine({ ...routineOf(routineNow), phase: "skipped", reason: "declined" });
          return;
        }
      }
      // As instruções fixas vão na frente do pedido, sempre iguais (o cache): o Modelo de nota (spec #11102) e o modo
      // econômico (spec #11084). Um erro ao ler o modelo não derruba o pedido: ele vai sem o modelo.
      const model = this.noteModel ? await this.noteModel().catch(() => null) : null;
      // A memória do agente (spec #11469) vem depois do modelo, com os mesmos bytes para os mesmos fatos.
      const facts = this.vaultRoot ? await this.memoryView().then((v) => v.facts, () => [] as string[]) : [];
      // As instruções da pessoa e o glossário do ditado (T11667), sempre nesta ordem. No modo econômico, o glossário vai
      // só com os termos que aparecem no pedido.
      const terms = this.glossary ? await this.glossary().catch(() => []) : [];
      // No modo econômico o glossário muda a cada pedido (só os termos dele): ele vai por último, depois das instruções do
      // econômico, para o cache pegar tudo antes dele (revisão do T11667).
      const fixed = fixedPrefix({ model, facts, instructions: s.instructions ?? "", terms, economy: s.economy === true, request: text });
      const answer = await host.ask(fixed + text, (e) => {
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
        // A web do agente (spec #11908): o status diz "web", e o balão mostra que ele saiu do cofre.
        if (e.type === "status" && e.status === "running" && isWebTool(e.tool)) {
          this.emitTurn({ id: turn.id, type: "status", status: "running", tool: "web" });
          return;
        }
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
      const finished = this.routineTurns.get(turn.id);
      if (finished) await this.finishRoutine(turn.id, finished);
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
          const routine = this.routineTurns.get(turn.id);
          if (routine) this.emitRoutine({ ...routineOf(routine), phase: "skipped", reason: "limit", ...(out?.resetsAt ? { resetsAt: out.resetsAt } : {}) } as AgentRoutineEvent);
        }
        this.emitTurn({ id: turn.id, type: "error", code: err.code, message: err.message });
      }
    } finally {
      if (this.turn === turn) this.turn = null;
      this.routineTurns.delete(turn.id);
      this.armIdle();
      this.emitStatus();
      // Uma reunião que terminou com o agente ocupado pede a proposta agora (spec #8360).
      this.nextMeeting();
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
            ...(writer ? { proposals: this.proposalSink } : {}),
            ...(this.vaultRoot ? { memory: this.memorySink } : {}),
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
        webTools: () => this.webNow,
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
  async configure(o: { model?: string; effort?: string; economy?: boolean; controlShortcut?: boolean; meetings?: unknown; summary?: unknown; instructions?: string; webSearch?: boolean; onboarding?: unknown; routines?: unknown }): Promise<AgentStatus> {
    const patch: Partial<AgentSettings> = {};
    // O onboarding (spec #11955): o passo em que a pessoa está, fechar (`done`) e o "Refazer" (`open` no passo 1).
    // As rotinas (spec #12150): ligar ou mudar a hora arma a rotina agora (um horário de antes não dispara).
    if (o.routines !== undefined) patch.routines = patchRoutines(sanitizeAgentRoutines((await this.d.settings.load()).routines), o.routines, this.clock());
    if (o.onboarding !== undefined) {
      const now = sanitizeAgentOnboarding((await this.d.settings.load()).onboarding);
      patch.onboarding = sanitizeAgentOnboarding({ ...now, ...(o.onboarding && typeof o.onboarding === "object" ? o.onboarding : {}) });
    }
    // O resumo executivo (spec #11546): os blocos e o período, inteiros e saneados.
    if (o.summary !== undefined) patch.summary = sanitizeSummarySettings(o.summary);
    // "Suas reuniões" (spec #8360): inteiro, saneado; uma pasta fora do cofre volta para a do projeto.
    if (o.meetings !== undefined) patch.meetings = sanitizeAgentMeetingSettings(o.meetings);
    // As instruções da pessoa (spec #11469): valem a partir do pedido seguinte. Elas vão no começo fixo de todo pedido,
    // por fora do filtro do pedido: um trecho com cara de senha ou token é recusado aqui, e nada é gravado (revisão do
    // T11667). Assim o começo continua com os mesmos bytes, sem marcador no meio.
    // "Pesquisar na web" (spec #11908): vale já no próximo pedido de permissão do agente, sem reabrir a sessão.
    if (o.webSearch !== undefined) {
      patch.webSearch = o.webSearch === true;
      this.webNow = patch.webSearch;
    }
    if (o.instructions !== undefined) {
      const text = o.instructions.replace(/\r\n?/g, "\n").slice(0, INSTRUCTIONS_MAX);
      if (/‹segredo [^›\n]{0,40}›/.test(text) || this.guard.read("", text).held > 0)
        throw new AgentServiceError("E_SECRET", "As instruções têm uma senha ou um token: tire esse trecho antes de salvar. Elas vão ao agente em todo pedido.");
      patch.instructions = text;
    }
    if (o.model !== undefined) patch.model = o.model;
    if (o.effort !== undefined) patch.effort = o.effort;
    if (o.economy !== undefined) {
      patch.economy = o.economy;
      this.economyNow = o.economy;
    }
    // Spec #9876: "Falar com o agente pelo Control".
    if (o.controlShortcut !== undefined) patch.controlShortcut = o.controlShortcut;
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
    this.stopRoutines();
    this.closed = true;
    this.download?.abort.abort();
    await this.stopProgram("o app saiu");
  }

  /** A saída do processo (`process.on("exit")`), sem tempo de esperar: o SIGTERM, que o adaptador trata limpo. */
  killNow(): void {
    this.notice?.stop();
    this.stopRoutines();
    this.closed = true;
    this.download?.abort.abort();
    this.pending?.killNow();
    this.host?.killNow();
    this.tools?.stop();
  }
}
