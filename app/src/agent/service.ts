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
import { keyOf, undo, UndoError, type UndoNotes } from "./undo.ts";
import { viewChange } from "./change-view.ts";
import { claudeStatus, type ProgramArgv } from "./claude.ts";
import { AGENT_NAMES, type AgentKind, isAgentKind } from "./kinds.ts";
import { geminiStatus } from "./gemini.ts";
import { geminiPrompt } from "./gemini-host.ts";
import { downloadAdapter, installedAdapter, removeAdapter } from "./adapter/download.ts";
import { ADAPTER_PACKAGES, ADAPTER_VERSION, type PinnedPackage } from "./adapter/pinned.ts";
import { checkClaudeVersion } from "./adapter/version.ts";
import { adapterRoot, agentDir } from "./adapter/open.ts";
import type {
  AgentChangeView,
  AgentClaudeStatus,
  AgentGeminiStatus,
  AgentModelChoice,
  AgentMemoryView,
  AgentProposalSummary,
  AgentRoutineEvent,
  RoutineEventWho,
  AgentProposalView,
  AgentStatus,
  AgentTurnEvent,
  AgentUndoResult,
  AgentTrailsView,
  AgentUsageView,
  BubbleLink,
} from "../shared/ui-contract.ts";
import { type BubbleLinkResolver, findBubbleLinks } from "./bubble-links.ts";
import { type AgentLimit, parseResetFromError, parseUsageMarkdown, type SubscriptionUsage, type UsageWindow } from "./usage.ts";
import { aprendendo, type LugarDaNota, notaDaMaioria, palavrasDoPedido, TrilhaStore, trilhasDaPasta } from "./trilhas.ts";

/** Uma palavra está em muitas notas (T21325) a partir de tantas, e de tal parte do cofre. */
const MUITAS_MIN = 3;
const MUITAS_PARTE = 0.1;
import { type LimitSnapshot, UsageStore } from "./usage-store.ts";
import { faroDoPlacar, PlacarTurno } from "./placar.ts";
import { RegistroEntrega } from "./entrega.ts";
import { type NoteModel } from "./note-model.ts";
import { PREFIX_RESEND_EVERY, prefixParts } from "./fixed-prefix.ts";
import { buildIndex, type FaroIndex, type FaroResult, sniff } from "./faro.ts";
import { buildPackage } from "./pacote.ts";
import { cardsBlock, cardsFor } from "./tools/kiwi-tool.ts";
import {
  buildCapsule,
  CAPSULE_TURNS,
  type CapsuleMap,
  type CapsuleTurn,
  folderCounts,
  modelTokens,
  modelTokensOfChars,
  windowCloseReason,
  type WindowCloseReason,
  withCapsule,
  type WindowState,
} from "./window.ts";
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
import { customRoutinePrompt, isRoutinePrompt, ROUTINE_LABELS, routineDeclined, routineEconomyQuestion, routineNoteChange, routinePrompt } from "./routines.ts";
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
import { ToolError, type MemorySink, type ProposalDraft, type ProposalSink, type SpeechSink, type SummaryDraft } from "./tools/tools.ts";
import { DEFAULT_AGENT_MEETING_SETTINGS, DEFAULT_AGENT_SETTINGS, effortOf, isAgentChoice, sanitizeAgentMeetingSettings, sanitizeEffortByModel, type AgentMeetingSettings, type AgentSettings } from "../store/settings.ts";
import type { Notices } from "../bun/notices.ts";
import type { Locale } from "../shared/i18n/index.ts";
import { WaitingNotice, type NoticeState } from "./notice.ts";
import { LiveWrites, liveWriter } from "./live-write.ts";

/** O prazo da dúvida nos roteiros do WebKit (`KIWI_DOUBT_TIMEOUT_MS`), só com o agente falso (`KIWI_FAKE_AGENT=1`). */
function testDoubtTimeout(): number | undefined {
  const ms = Number(process.env.KIWI_DOUBT_TIMEOUT_MS);
  return process.env.KIWI_FAKE_AGENT === "1" && Number.isInteger(ms) && ms > 0 ? ms : undefined;
}

/** O teto sem uso: depois disso, o programa do agente fecha (a sessão fica guardada e volta no próximo pedido). */
export const AGENT_IDLE_MS = 10 * 60_000;
/** O pedido mais longo que o app manda. */
export const AGENT_MAX_TEXT = 20_000;

/** O pedido em andamento. `fala`: veio por voz com "O gato fala" ligado (T26709); `falou`: o `kiwi falar` já saiu. */
interface AskTurn {
  id: string;
  cancelled: boolean;
  fala?: boolean;
  falou?: boolean;
}

/** Uma fala do gato (T26709): as frases de um `kiwi falar`, já por extenso, na ordem em que a voz lê. */
export interface CatSpeech {
  turnId: string;
  frases: string[];
}

/**
 * A linha do pedido feito por voz com "O gato fala" ligado (T26709). Vai só nesse pedido, depois dos cartões: a
 * definição da ferramenta fica a mesma em toda sessão (o cache).
 */
export const FALA_PEDIDO =
  '[Pedido feito por voz: antes da resposta, chame kiwi com fazer "falar" e o texto que a pessoa vai ouvir: 1 ou 2 frases curtas, sem Markdown, com o essencial. A resposta completa vai no texto, como sempre.]';
/** O comando local do Claude Code que diz o uso da assinatura (spec #11084): só sob demanda. */
export const USAGE_COMMAND = "/usage";
/** Um timer que não segura o processo aberto (o `/usage` em segundo plano não é motivo para o app ficar de pé). */
function timer(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
  const t = setTimeout(fn, ms);
  (t as { unref?: () => void }).unref?.();
  return t;
}

/**
 * O `/usage` em segundo plano depois de um pedido (ADR 0013, T13702, #13853): no máximo um a cada 10 min (cada um fica
 * na conversa), 2 s depois da resposta, e de novo a cada 15 s enquanto a conversa com o gato está na tela (até 5 min).
 */
export const LIMIT_PROBE_EVERY_MS = 10 * 60_000;
export const LIMIT_PROBE_DELAY_MS = 2_000;
export const LIMIT_PROBE_RETRY_MS = 15_000;
export const LIMIT_PROBE_TRIES = 20;
/** As instruções do modo econômico (spec #11084): o texto mora no começo fixo (`fixed-prefix.ts`). */
export { ECONOMY_INSTRUCTIONS } from "./fixed-prefix.ts";

/** O modelo mais barato que o agente oferece (spec #11084): Haiku, depois Sonnet; null se a lista não tem nenhum. */
/**
 * O pedido da proposta da reunião (spec #8360): sempre o mesmo texto, com a reunião. O agente lê a transcrição pelo
 * `meetings_get`, que passa pelo guardrail; o áudio nunca vai.
 */
export function meetingPrompt(m: { path: string; title: string }): string {
  return `[Pedido automático do Kiwi] A reunião gravada "${m.title}" (${m.path}) terminou. Leia a transcrição com kiwi ler/reuniao, compare o assunto, os termos e os nomes com os projetos (kiwi achar/projetos) e prepare a proposta com kiwi propor/reuniao. Não escreva notas: a pessoa aprova a proposta no Kiwi.`;
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
  /** Como abrir o `gemini` para conferir a versão (spec #24666): o instalado, ou o falso nos testes; null se não há. */
  gemini?(): ProgramArgv | null;
  /**
   * Monta o host do agente (sem abrir): no app, o adaptador apontado para o Claude Code instalado, depois das
   * conferências; nos testes, o agente falso. Recebe o que o host precisa do serviço.
   */
  openHost(o: {
    /** O agente a abrir (spec #24666). */
    kind: AgentKind;
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
  /** A janela curta (T13835), para os testes: o teto da conversa e a pausa que a esfria. */
  window?: { maxTokens?: number; idleMs?: number };
  /** Os tempos do `/usage` depois do pedido (ADR 0013), para os testes: a espera, a nova tentativa e o intervalo mínimo. */
  limitProbe?: { delayMs?: number; retryMs?: number; everyMs?: number };
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
  /** O agente escolhido (spec #24666), do último `settings.load()`/`save()`: vale para o nome e o que é de um só. */
  private kind: AgentKind = "claude";
  /** Os ajustes, que anotam o `kind` a cada leitura e gravação. */
  private readonly settings: AgentServiceDeps["settings"];
  /** Se a última abertura do Gemini abriu a sessão (o login dele só se vê ali); null até a primeira. */
  private geminiLogin: boolean | null = null;

  /** O nome que a pessoa vê: o do agente escolhido. */
  private get name(): string {
    return this.kind === "claude" ? (this.d.name ?? AGENT_NAMES.claude) : AGENT_NAMES[this.kind];
  }
  private host: AgentHost | null = null;
  private opening: Promise<AgentHost> | null = null;
  /** O host que ainda está abrindo: o `stopProgram` e o `killNow` fecham ele também, sem esperar a abertura (revisão). */
  private pending: AgentHost | null = null;
  /** Sobe a cada `stopProgram`: um host montado antes de um Desligar não chega a abrir. */
  private epoch = 0;
  private turn: AskTurn | null = null;
  private idle: ReturnType<typeof setTimeout> | null = null;
  private download: { abort: AbortController; done: number; total: number; lastEmit: number } | null = null;
  private downloadError: { code: string; message: string } | undefined;
  private claude: AgentClaudeStatus | null = null;
  /** O Gemini CLI instalado (spec #24666): null até a primeira conferência. */
  private gemini: AgentGeminiStatus | null = null;
  /** Os modelos que o agente ofereceu da última vez que abriu (T8762), lidos de `<dados>/agent/models.json` na 1ª vez. */
  private models: AgentModelChoice[] | null = null;
  /** Os esforços que o agente oferece em cada modelo (spec #16793), como ficaram guardados; `[]` é um modelo sem esforço. */
  private efforts: Record<string, AgentModelChoice[]> | null = null;
  /** O último formato das opções que foi ao log (T25553). */
  private loggedShape: string | null = null;
  private applied: Record<string, string> = {};
  private readonly statusListeners = new Set<(s: AgentStatus) => void>();
  private readonly turnListeners = new Set<(e: AgentTurnEvent) => void>();
  /** Quem toca a fala do gato (T26709): o player recebe as frases do `kiwi falar`. */
  private readonly speechListeners = new Set<(e: CatSpeech) => void>();
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
  /** O começo fixo que foi ao agente (spec #13379): em qual abertura do programa, qual texto e há quantos pedidos. */
  private prefixSent: { host: AgentHost; stable: string; requests: number } | null = null;
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
  /** O `/usage` em segundo plano depois de um pedido (ADR 0013), e quando foi o último. */
  private limitProbe: Promise<void> | null = null;
  /**
   * Pedidos entre a chamada do `ask` e o `this.turn` deles (há `await`s no meio): o `/usage` de depois do pedido
   * anterior não começa nessa janela, senão o agente recusa o pedido com E_AGENT_BUSY (main vermelha do #292).
   */
  private askStarting = 0;
  private limitProbedAt = -Infinity;
  /**
   * O `/usage` do medidor andando (T16712). Não é um pedido: não ocupa o `turn`, e cede a vez a um pedido da pessoa.
   * `asking` diz que o `/usage` já foi ao agente (aí ele é cancelado); antes disso, ainda abrindo o programa, só não vai.
   */
  private usageRun: { done: Promise<void>; yielded: boolean; asking: boolean } | null = null;
  private limitProbeTimer: ReturnType<typeof setTimeout> | null = null;
  /** A conversa com o gato está na tela (#13380): o `/usage` espera ela acabar. Quem liga é o app (`useConversationCheck`). */
  private conversationOpen: () => boolean = () => false;
  /**
   * A janela curta (ADR 0013 peça 5, T13835): a sessão do agente de agora, a última ida e quantos tokens de conversa ela
   * já tem. Fica em `<dados>/agent/window.json`: o programa reaberto dentro da hora retoma a janela, com o cache quente.
   */
  private window: WindowState | null | undefined;
  /** A pessoa pediu uma conversa nova: a janela fecha no próximo pedido. */
  private windowAsked = false;
  /** Os tokens dos resultados das ferramentas do pedido de agora, que ficam na conversa. */
  private turnToolTokens = 0;
  /**
   * O registro de entrega da janela (ADR 0013 peça 4, T14682): o que o Kiwi já mandou à sessão, com a versão. Só na
   * memória; zera quando a janela fecha. Depois de reabrir o programa, ele começa vazio e o texto vai de novo.
   */
  private readonly registro = new RegistroEntrega();
  /** O placar do pedido de agora (T14671): as idas e as partes. */
  private placar: PlacarTurno | null = null;
  /** O que o faro achou no pedido de agora (o "nada" também), para o placar. */
  private turnFaro: FaroResult | null = null;
  /**
   * As notas que o agente leu no pedido, na ordem (T14682, T21325): se o faro não deu a nota, as palavras do pedido
   * viram trilha para a primeira lida na pasta da maioria.
   */
  private turnReads: string[] = [];
  /** A pasta de notas aberta no pedido de agora (T16650): a trilha aprendida é dela, e o faro só segue as dela. */
  private turnPasta: string | null = null;
  private readonly trilhas: TrilhaStore;
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
    this.settings = {
      load: async () => this.noteKind(await d.settings.load()),
      save: async (patch) => this.noteKind(await d.settings.save(patch)),
    };
    this.reader = d.reader ?? null;
    this.writer = d.writer ? this.live(d.writer) : null;
    this.activity = new AgentActivity({ dir: path.join(agentDir(d.data), "activity") });
    this.answers = new DoubtAnswers(agentDir(d.data));
    this.usage = new UsageStore(agentDir(d.data), d.now);
    this.trilhas = new TrilhaStore(agentDir(d.data), d.now);
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
  /** Diz ao agente quando a conversa com o gato está na tela (#13380): o `/usage` de depois do pedido espera. */
  useConversationCheck(open: () => boolean): void {
    this.conversationOpen = open;
  }

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

  /**
   * O índice da pasta para os links do balão (spec #17683): o `done` leva as notas e os arquivos que a resposta cita e
   * que existem nela. Sem ele (os testes antigos), o `done` vai sem `links`.
   */
  useLinkResolver(source: () => Promise<BubbleLinkResolver>): void {
    this.linkResolver = source;
  }
  private linkResolver: (() => Promise<BubbleLinkResolver>) | null = null;

  /** Os links da resposta; um erro no índice não derruba o pedido, só tira os links. */
  private async bubbleLinks(text: string): Promise<BubbleLink[] | undefined> {
    if (!this.linkResolver || !text) return undefined;
    try {
      const links = findBubbleLinks(text, await this.linkResolver());
      return links.length ? links : undefined;
    } catch (err) {
      this.d.log?.(`[agent] links: ${String((err as Error)?.message ?? err)}`);
      return undefined;
    }
  }

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
    this.writer = this.live(writer);
  }

  /**
   * O Kiwi escrevendo ao vivo (spec #20843): as escritas do agente que a janela das Notas anima. Quem manda o
   * `notes.changed` e o `files.changed` às janelas chama `liveWrites.take` antes, e manda o `agent.wrote` primeiro.
   */
  readonly liveWrites = new LiveWrites();

  /** O escritor que avisa o `liveWrites`, com o pedido de agora. */
  private live(writer: VaultWriter): VaultWriter {
    return liveWriter(writer, this.liveWrites, () => this.turn?.id);
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
    // O resultado fica na conversa da janela (T13835), certo ou com erro.
    if (e.chars !== undefined) this.turnToolTokens += modelTokensOfChars(e.chars);
    if (e.chars !== undefined) this.placar?.resultado(e.tool, e.ok, modelTokensOfChars(e.chars));
    if (e.ok && e.notePath && this.placar && !this.turnReads.includes(e.notePath)) this.turnReads.push(e.notePath);
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

  /** A fala do gato (T26709): as frases do `kiwi falar`, já por extenso, para o player tocar na ordem. */
  onSpeech(fn: (e: CatSpeech) => void): () => void {
    this.speechListeners.add(fn);
    return () => this.speechListeners.delete(fn);
  }

  /**
   * Quem recebe o `kiwi falar` agora: o pedido em andamento. A fala vai ao balão, como o resumo (o evento `speech`, spec
   * #27881), em todo pedido; à voz, só no pedido feito por voz com "O gato fala" ligado. Uma fala por pedido; a segunda
   * volta como erro, e o resto vai no texto.
   */
  private speechSink(): SpeechSink | undefined {
    const turn = this.turn;
    if (!turn || turn.cancelled) return undefined;
    return {
      falar: (frases, texto) => {
        if (turn.falou) throw new ToolError("E_ALREADY_SPOKEN", "a fala deste pedido já saiu: o resto vai no texto da resposta");
        turn.falou = true;
        this.emitTurn({ id: turn.id, type: "speech", text: texto });
        if (!turn.fala) return;
        for (const fn of this.speechListeners) {
          try {
            fn({ turnId: turn.id, frases });
          } catch (err) {
            this.d.log?.(`[agent] fala: ${String((err as Error)?.message ?? err)}`);
          }
        }
      },
    };
  }

  private get root(): string {
    return adapterRoot(this.d.data);
  }

  private get packages(): readonly PinnedPackage[] {
    return this.d.packages ?? ADAPTER_PACKAGES;
  }

  /** O estado. Com `refresh`, confere o Claude Code instalado (abre o `claude --version` e o `auth status`). */
  async status(refresh = false): Promise<AgentStatus> {
    if (refresh) await this.checkAgents();
    return this.statusFrom(this.snapshot(), await this.settings.load());
  }

  /** O que muda a todo instante (o download, o programa, o pedido), lido agora, antes de qualquer `await`. */
  private snapshot(): Omit<AgentStatus, "name" | "kind" | "enabled" | "consented" | "model" | "effort" | "effortByModel" | "economy" | "controlShortcut" | "showSpokenText" | "catSpeaks" | "meetings" | "summary" | "instructions" | "webSearch" | "onboarding" | "routines"> {
    const installed = !!installedAdapter({ root: this.root }, this.packages);
    const values = this.currentHost?.configValues ?? null;
    return {
      claude: this.claude,
      gemini: this.gemini,
      adapter: {
        version: ADAPTER_VERSION,
        phase: this.download ? "downloading" : installed ? "ready" : this.downloadError ? "error" : "missing",
        ...(this.download ? { done: this.download.done, total: this.download.total } : {}),
        ...(this.downloadError && !this.download ? { error: this.downloadError } : {}),
      },
      program: this.currentHost ? "open" : this.opening ? "opening" : "closed",
      busy: !!this.turn || !!this.usageRun,
      session: values ? { model: values.model, effort: values.effort } : null,
      models: this.knownModels(),
      efforts: this.knownEfforts(),
    };
  }

  private get modelsFile(): string {
    // Cada agente tem a sua lista (spec #24666); a do Claude continua no arquivo de antes.
    return path.join(agentDir(this.d.data), this.kind === "claude" ? "models.json" : `models-${this.kind}.json`);
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

  private get effortsFile(): string {
    return path.join(agentDir(this.d.data), this.kind === "claude" ? "efforts.json" : `efforts-${this.kind}.json`);
  }

  /**
   * Os esforços guardados, por modelo (spec #16793). O agente só diz os do modelo da sessão (no adaptador, o esforço
   * depende do modelo, e um modelo sem esforço não tem a opção): o Kiwi junta o que viu de cada um, de uma abertura
   * para outra, e a seção mostra as escolhas do modelo escolhido mesmo com o programa fechado.
   */
  private knownEfforts(): Record<string, AgentModelChoice[]> {
    if (this.efforts) return this.efforts;
    const out: Record<string, AgentModelChoice[]> = {};
    try {
      const saved = JSON.parse(readFileSync(this.effortsFile, "utf8")) as unknown;
      if (saved && typeof saved === "object" && !Array.isArray(saved))
        for (const [model, list] of Object.entries(saved as Record<string, unknown>))
          if (isAgentChoice(model) && Array.isArray(list))
            out[model] = list.filter((m): m is AgentModelChoice => !!m && typeof m.value === "string" && typeof m.name === "string");
    } catch {
      // Sem o arquivo (ainda nenhum pedido) ou estragado: começa vazio.
    }
    return (this.efforts = out);
  }

  /** Guarda o que o agente acabou de oferecer (ao abrir, e depois de trocar as opções): os modelos e os esforços do atual. */
  private rememberModels(host: AgentHost): void {
    const save = (file: string, value: unknown, what: string) => {
      try {
        mkdirSync(agentDir(this.d.data), { recursive: true, mode: 0o700 });
        writeFileSync(file, JSON.stringify(value) + "\n", { mode: 0o600 });
      } catch (e) {
        this.d.log?.(`[agent] ${what}: ${String((e as Error)?.message ?? e)}`);
      }
    };
    // Os ids e as categorias das opções que o agente trouxe (T25553), uma vez por formato: só os nomes, sem valores.
    const shape = host.configShape;
    if (`${this.kind} ${shape}` !== this.loggedShape) {
      this.loggedShape = `${this.kind} ${shape}`;
      this.d.log?.(`[agent] opções da sessão (${this.kind}): ${shape || "nenhuma"}`);
    }
    const models = host.choices("model");
    if (models.length && JSON.stringify(models) !== JSON.stringify(this.knownModels())) {
      this.models = models;
      save(this.modelsFile, models, "models");
    }
    // O esforço do modelo da sessão: as escolhas dele, ou `[]` se ele não tem a opção.
    const model = host.configValues.model;
    if (!isAgentChoice(model)) return;
    const efforts = host.choices("effort");
    const known = this.knownEfforts();
    if (JSON.stringify(known[model]) === JSON.stringify(efforts)) return;
    this.efforts = { ...known, [model]: efforts };
    save(this.effortsFile, this.efforts, "efforts");
  }

  private statusFrom(snap: ReturnType<AgentService["snapshot"]>, s: AgentSettings): AgentStatus {
    const kind = s.kind ?? "claude";
    return {
      name: AGENT_NAMES[kind],
      kind,
      enabled: s.enabled,
      consented: s.consented,
      ...snap,
      model: s.model,
      effort: effortOf(s, s.model),
      effortByModel: s.effortByModel ?? {},
      economy: s.economy === true,
      controlShortcut: s.controlShortcut === true,
      showSpokenText: s.showSpokenText === true,
      catSpeaks: s.catSpeaks === true,
      meetings: s.meetings ?? DEFAULT_AGENT_MEETING_SETTINGS,
      summary: s.summary ?? DEFAULT_SUMMARY_SETTINGS,
      instructions: s.instructions ?? "",
      webSearch: s.webSearch === true,
      onboarding: sanitizeAgentOnboarding(s.onboarding),
      routines: sanitizeAgentRoutines(s.routines),
    };
  }

  /**
   * O modelo e o esforço que o Kiwi pede: no modo econômico, o modelo mais barato que o agente oferece (spec #11084).
   * O esforço é o salvo para o modelo que vai de fato (spec #16793): no econômico, o do modelo barato.
   */
  private wantedConfig(s: AgentSettings): { model: string; effort: string } {
    const cheap = s.economy ? cheapestModel(this.knownModels()) : null;
    const model = cheap ?? s.model;
    return { model, effort: effortOf(s, model) };
  }

  /** Anota o agente escolhido de uns ajustes lidos ou gravados, e os devolve. */
  private noteKind(s: AgentSettings): AgentSettings {
    const kind = isAgentKind(s.kind) ? s.kind : "claude";
    if (kind !== this.kind) {
      // As listas guardadas são do agente de antes.
      this.models = null;
      this.efforts = null;
    }
    this.kind = kind;
    return s;
  }

  /**
   * O programa aberto, se ele é do agente escolhido. Um host de outro agente (uma troca que correu com um pedido) nunca é
   * reusado: o próximo pedido abre o escolhido (revisão do T24672).
   */
  private get currentHost(): AgentHost | null {
    return this.host?.running && this.host.kind === this.kind ? this.host : null;
  }

  /** O agente escolhido precisa do adaptador e ele não está baixado. Só o Claude Code usa adaptador (spec #24666). */
  private adapterMissing(): boolean {
    return this.kind === "claude" && !installedAdapter({ root: this.root }, this.packages);
  }

  /** Confere os dois agentes instalados, para a tela mostrar o estado de cada um (spec #24666). */
  private async checkAgents(): Promise<void> {
    await Promise.all([this.checkClaude(), this.checkGemini()]);
  }

  /**
   * O Gemini CLI instalado e a versão. O login dele não tem conferência à parte: só a abertura da sessão diz (o
   * `authRequired`), e o Kiwi nunca lê o `~/.gemini`. Até lá, `loginKnown: false`.
   */
  private async checkGemini(): Promise<void> {
    const st = await geminiStatus(this.d.gemini?.() ?? null);
    const tooOld = st.installed && st.tooOld === true;
    this.gemini = {
      installed: st.installed,
      ...(st.version ? { version: st.version } : {}),
      loggedIn: this.geminiLogin === true,
      ...(this.geminiLogin === null ? { loginKnown: false as const } : {}),
      versionOk: st.installed && !tooOld,
      ...(tooOld ? { versionError: "E_AGENT_TOO_OLD" as const } : {}),
    };
  }

  /** O que a abertura do Gemini disse do login (spec #24666): abriu, logado; `authRequired`, não logado. */
  private noteGeminiLogin(loggedIn: boolean): void {
    this.geminiLogin = loggedIn;
    if (this.gemini) {
      const { loginKnown: _unknown, ...rest } = this.gemini;
      this.gemini = { ...rest, loggedIn };
    }
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
    const pd = this.usage.placarDia();
    const placar = pd.ultimos.length
      ? {
          placar: {
            pedidos: pd.pedidos,
            idas: pd.idas,
            tokens: pd.tokens,
            partes: pd.partes,
            comFaro: pd.comFaro,
            dePrimeira: pd.dePrimeira,
            ...(pd.limite5h !== undefined ? { limite5h: Math.round(pd.limite5h * 10) / 10 } : {}),
            ultimos: pd.ultimos.map((u) => ({ request: u.request, at: iso(u.at), question: u.question, tokens: u.tokens, idas: u.placar.idas, partes: u.placar.partes, ...(u.placar.faro ? { faro: u.placar.faro } : {}) })),
          },
        }
      : {};
    return {
      ...placar,
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
   * O programa aberto sem pedido nenhum (`agent.prepare`, spec #16793): o `session/new` do ACP já traz os modelos e os
   * esforços, então o onboarding mostra o Modelo e o Esforço logo depois de conectar. Aplica o modelo e o esforço
   * escolhidos (o esforço de um modelo novo só aparece depois de a sessão estar nele). Nada vai ao agente e não gasta
   * o plano. Com um pedido rodando, só devolve o estado: o próximo pedido aplica a escolha. O mesmo com um `/usage` andando.
   */
  async prepare(): Promise<AgentStatus> {
    const s = await this.settings.load();
    if (!s.enabled || !s.consented) throw fail("E_AGENT_DISABLED");
    if (this.adapterMissing()) throw fromAgentError(new AgentError("E_ADAPTER_MISSING", this.name), this.name);
    // Um pedido, o `/usage` do medidor (T16712) ou o de depois do pedido: o agente está ocupado, e o próximo pedido
    // aplica a escolha (revisão #17024).
    const busy = () => !!this.turn || !!this.usageRun || !!this.limitProbe;
    if (busy()) return this.status();
    // A sessão aberta aqui já sai com a web do interruptor: o 1º pedido não precisa reabrir.
    this.webNow = s.webSearch === true;
    try {
      if (!this.currentHost) await this.openProgram();
      else {
        const wanted = this.wantedConfig(s);
        if (!busy() && this.host && (wanted.model !== this.applied.model || wanted.effort !== this.applied.effort)) {
          await this.host.applyConfig(wanted);
          this.applied = { ...wanted };
          this.rememberModels(this.host);
        }
      }
    } catch (e) {
      throw fromAgentError(e, this.name);
    } finally {
      if (!busy()) this.armIdle();
      this.emitStatus();
    }
    return this.status();
  }

  /**
   * "Atualizar" (`agent.usageRefresh`): o `/usage` do próprio Claude Code, só quando a pessoa abre o medidor ou clica.
   * Vai como um pedido interno: fora do registro, sem evento de pedido e sem balão. Nada da pessoa vai junto.
   * Um pedido da pessoa passa na frente (T16712): o `/usage` não vai, ou é cancelado, e o medidor fica com o número que
   * já tinha, sem erro.
   */
  async usageRefresh(): Promise<AgentUsageView> {
    // O `/usage` é um comando do Claude Code (spec #24666): com o Gemini, o medidor fica só com o que o ACP disse.
    // Aqui sem `await`, pelo agente já carregado (a marca abaixo tem de entrar antes do 1º `await`); de novo depois
    // de carregar os ajustes, lá dentro.
    if (this.kind !== "claude") return this.usageView();
    // Um pedido da pessoa já andando: o /usage não entra no meio dele (o botão do medidor fica desligado com `busy`).
    if (this.turn) throw fromAgentError(new AgentError("E_AGENT_BUSY", this.name), this.name);
    // Um `/usage` já andando (o medidor apareceu e a pessoa clicou em Atualizar): o mesmo serve aos dois.
    if (this.usageRun) {
      await this.usageRun.done;
      return this.usageView();
    }
    const run = { done: Promise.resolve(), yielded: false, asking: false };
    let error: unknown;
    let read = false;
    // A marca entra antes do primeiro `await`: um pedido da pessoa que chegue enquanto os ajustes carregam já a
    // encontra e passa na frente, em vez de pegar o `turn` e fazer o medidor dar E_AGENT_BUSY (T16712).
    this.usageRun = run;
    run.done = (async () => {
      try {
        await this.limitProbe;
        const s = await this.settings.load();
        if (this.kind !== "claude") return;
        if (!s.enabled || !s.consented) throw fail("E_AGENT_DISABLED");
        if (this.adapterMissing()) throw new AgentError("E_ADAPTER_MISSING", this.name);
        if (run.yielded) return;
        const host = this.currentHost ?? (await this.openProgram());
        if (run.yielded) return;
        run.asking = true;
        const answer = await host.ask(USAGE_COMMAND);
        this.windowGrow(host, modelTokens(USAGE_COMMAND) + modelTokens(answer.text));
        // Cancelado no meio para o pedido da pessoa: a resposta veio pela metade e não vale como número.
        if (run.yielded) return;
        const now = (this.d.now ?? Date.now)();
        this.subscription = { at: now, usage: parseUsageMarkdown(answer.text, now) };
        read = true;
      } catch (e) {
        if (!run.yielded) error = e;
      } finally {
        if (this.usageRun === run) this.usageRun = null;
      }
    })();
    this.emitStatus();
    try {
      await run.done;
    } finally {
      this.armIdle();
      this.emitStatus();
    }
    if (error !== undefined) throw fromAgentError(error, this.name);
    if (read) this.emitUsage();
    return this.usageView();
  }

  /** Um pedido da pessoa vai na frente do `/usage` do medidor (T16712): o `/usage` cede a vez, e o pedido espera ele sair. */
  private async yieldUsage(): Promise<void> {
    for (let run = this.usageRun; run; run = this.usageRun) {
      run.yielded = true;
      if (run.asking) void this.host?.cancel().catch(() => {});
      await run.done;
    }
  }

  /**
   * O limite depois de um pedido que deu certo (ADR 0013, T13702, #13853): um `/usage` em segundo plano, com a resposta
   * já na tela. É pulado se a pessoa já mandou outro pedido, espera a conversa com o gato acabar, e roda no máximo um a
   * cada 10 min, porque cada `/usage` fica na conversa. O número vira o "depois" deste pedido e o "antes" do próximo.
   */
  private probeLimit(after: string): void {
    // Só o Claude Code responde ao `/usage` (spec #24666).
    if (this.kind !== "claude") return;
    if (this.limitProbeTimer) clearTimeout(this.limitProbeTimer);
    const o = this.d.limitProbe ?? {};
    let tries = 0;
    const check = () => {
      this.limitProbeTimer = null;
      // Outro pedido já começou (ou já acabou): o /usage deste é pulado.
      if (this.lastTurn !== after || this.turn || this.askStarting || this.limitProbe || this.usageRun) return;
      const now = (this.d.now ?? Date.now)();
      if (now - this.limitProbedAt < (o.everyMs ?? LIMIT_PROBE_EVERY_MS)) return;
      const host = this.host;
      if (!host?.running) return;
      if (this.conversationOpen()) {
        if (++tries < LIMIT_PROBE_TRIES) this.limitProbeTimer = timer(check, o.retryMs ?? LIMIT_PROBE_RETRY_MS);
        return;
      }
      this.limitProbedAt = now;
      this.limitProbe = (async () => {
        const snap = await this.limitSnapshot(host);
        if (snap) this.safely(() => this.usage.noteLimitSnapshot(snap));
      })().finally(() => {
        this.limitProbe = null;
      });
    };
    this.limitProbeTimer = timer(check, o.delayMs ?? LIMIT_PROBE_DELAY_MS);
  }

  /** O `/usage` agora, só os números (ADR 0013). `null` se o agente não respondeu como o adaptador formata. */
  private async limitSnapshot(host: AgentHost): Promise<LimitSnapshot | null> {
    try {
      const answer = await host.ask(USAGE_COMMAND);
      this.windowGrow(host, modelTokens(USAGE_COMMAND) + modelTokens(answer.text));
      const now = (this.d.now ?? Date.now)();
      const u = parseUsageMarkdown(answer.text, now);
      if (!u) return null;
      this.subscription = { at: now, usage: u };
      return { at: now, ...(u.fiveHour ? { fiveHour: u.fiveHour.percent } : {}), ...(u.week ? { week: u.week.percent } : {}) };
    } catch {
      return null;
    }
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
    return (await this.settings.load()).meetings ?? DEFAULT_AGENT_MEETING_SETTINGS;
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
    return (await this.settings.load()).summary ?? DEFAULT_SUMMARY_SETTINGS;
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
          const r = await writer.save(n.path, next, n.version, n.content).catch(async (e) => {
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
      const w = await writer.save(n.path, next, n.version, n.content).catch(async (e) => {
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
      const r = await writer.save(n.path, next, n.version, n.content).catch(async (e) => {
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
      const s = await this.settings.load();
      if (!s.enabled || !s.consented || (s.meetings ?? DEFAULT_AGENT_MEETING_SETTINGS).propose !== "auto") return;
      if (!this.reader || !this.writer || this.adapterMissing()) return;
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
      const s = await this.settings.load();
      if (!s.enabled || !s.consented || this.turn) return;
      if (!this.reader || !this.writer || this.adapterMissing()) return;
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
    const s = await this.settings.load();
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
  private saveRoutines(change: (current: AgentRoutines) => Promise<AgentRoutines>, also: Partial<AgentSettings> = {}): Promise<void> {
    const next = this.routineEdits.then(async () => {
      const current = sanitizeAgentRoutines((await this.settings.load()).routines);
      await this.settings.save({ ...also, routines: await change(current) });
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
    const s = await this.settings.load();
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
    const s = await this.settings.load();
    if (!s.consented && !consent) throw fail("E_AGENT_CONSENT");
    // A primeira vez que o agente liga abre o onboarding (spec #11955). Quem já o tinha ligado antes dele, só pelo
    // "Refazer o onboarding" em Ajustes.
    const first = sanitizeAgentOnboarding(s.onboarding).state === "pending";
    await this.settings.save({ enabled: true, consented: true, ...(first ? { onboarding: { state: "open", step: 1 } } : {}) });
    this.emitStatus();
    return this.status();
  }

  /** Desliga: cancela o pedido e o download, e fecha o programa na hora. */
  async disable(): Promise<AgentStatus> {
    // Desligar o agente desliga as rotinas (spec #12150): ligar de novo não as religa sozinho.
    // Pela fila das rotinas: um "Nova rotina" em andamento não grava as rotinas ligadas de novo (revisão do T13010).
    await this.saveRoutines(async (current) => routinesOff(current), { enabled: false });
    this.download?.abort.abort();
    this.questions.closeAll();
    await this.stopProgram("desligado");
    this.guard = new SecretGuard();
    this.emitStatus();
    return this.status();
  }

  /** Começa o download do adaptador e volta logo. O fim (ou o erro) chega pelo `agent.status`. */
  async startDownload(): Promise<AgentStatus> {
    const s = await this.settings.load();
    if (!s.enabled) throw fail("E_AGENT_DISABLED");
    // O Gemini fala ACP sozinho: não há adaptador a baixar (spec #24666).
    if (this.kind !== "claude" || this.download || installedAdapter({ root: this.root }, this.packages)) return this.status();
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
  /** Um pedido. `voz`: ele veio pela fala (o atalho do Control), e o gato pode falar a resposta (T26709). */
  async ask(text: string, opts: { voz?: boolean } = {}): Promise<{ id: string }> {
    // Marcado antes do 1º `await`: o `/usage` do pedido anterior não começa até este ter o turno (ou falhar).
    this.askStarting++;
    try {
      return await this.startAsk(text, opts.voz === true);
    } finally {
      this.askStarting--;
    }
  }

  private async startAsk(text: string, voz = false): Promise<{ id: string }> {
    // O `/usage` de depois do pedido anterior ainda rodando (são milissegundos): ele é cancelado, e o pedido não espera
    // a resposta dele. O agente responde um prompt por vez.
    if (this.limitProbe) {
      void this.host?.cancel().catch(() => {});
      await this.limitProbe;
    }
    if (typeof text !== "string" || !text.trim()) throw new AgentServiceError("E_BAD_ARGS", "agent.ask: o texto do pedido está vazio");
    if (text.length > AGENT_MAX_TEXT) throw new AgentServiceError("E_BAD_ARGS", `agent.ask: o pedido passa de ${AGENT_MAX_TEXT} caracteres`);
    const s = await this.settings.load();
    if (!s.enabled || !s.consented) throw fail("E_AGENT_DISABLED");
    if (this.adapterMissing()) throw fromAgentError(new AgentError("E_ADAPTER_MISSING", this.name), this.name);
    // Sem `await` daqui até o `this.turn = turn`: um /usage do medidor que comece agora já encontra o pedido.
    await this.yieldUsage();
    if (this.turn) throw fromAgentError(new AgentError("E_AGENT_BUSY", this.name), this.name);
    // A fala do gato (T26709): só no pedido por voz, com "O gato fala" ligado no começo do pedido.
    const turn: AskTurn = { id: crypto.randomUUID(), cancelled: false, fala: voz && s.catSpeaks === true, falou: false };
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

  private async runTurn(turn: AskTurn, text: string, s: AgentSettings): Promise<void> {
    const wanted = this.wantedConfig(s);
    this.economyNow = s.economy;
    this.webNow = s.webSearch === true;
    let succeeded = false;
    /** O que foi ao agente (a conversa da janela cresce com isso, e com o que voltou), mesmo num pedido que falhou. */
    let asked: { host: AgentHost; prompt: string } | null = null;
    let answered = "";
    try {
      let host = this.currentHost;
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
      const parts = prefixParts({ model, facts, instructions: s.instructions ?? "", terms, economy: s.economy === true, request: text });
      // A sessão é retomada entre os pedidos (spec #13379): o começo fixo só vai quando muda, numa abertura nova do
      // programa, ou a cada `PREFIX_RESEND_EVERY` pedidos. Antes ia sempre, e cada cópia ficava no histórico.
      // A janela curta (ADR 0013 peça 5): fechada, a sessão é nova, e a cápsula vai na frente do pedido.
      const capsule = await this.openWindow(host, turn.id);
      if (turn.cancelled) {
        this.emitTurn({ id: turn.id, type: "done", stopReason: "cancelled", text: "" });
        return;
      }
      // O faro e o pacote (ADR 0013 peças 1 e 2): o que o pedido cita vai junto, e o agente não precisa procurar. Um erro
      // aqui não derruba o pedido: ele vai sem o pacote.
      this.turnFaro = null;
      this.turnReads = [];
      const pkg = await this.faroPackage(text).catch((err) => {
        this.d.log?.(`[agent] faro: ${String((err as Error)?.message ?? err)}`);
        return null;
      });
      if (turn.cancelled) {
        this.emitTurn({ id: turn.id, type: "done", stopReason: "cancelled", text: "" });
        return;
      }
      for (const d of pkg?.delivered ?? [])
        void this.activity.read(turn.id, { tool: "faro", target: d.path }).catch((err) => this.d.log?.(`[agent] activity: ${String((err as Error)?.message ?? err)}`));
      const sent = this.prefixSent;
      const resend = !sent || sent.host !== host || sent.stable !== parts.stable || sent.requests >= PREFIX_RESEND_EVERY;
      // O cartão de instrução (ADR 0013 peça 6, T14563): o jeito longo de gerar um arquivo, propor uma reunião, um resumo
      // ou uma rotina saiu da lista fixa e vai aqui, só no pedido que precisa dele.
      // A rotina que roda já diz o que fazer, ação por ação: o "Rotina" dela não pede o cartão de propor uma.
      const cards = isRoutinePrompt(text) ? "" : cardsBlock(cardsFor(text));
      // O pedido por voz com "O gato fala" (T26709) leva uma linha: a definição da ferramenta fica igual (o cache).
      const voz = turn.fala ? `${FALA_PEDIDO}\n\n` : "";
      const prompt =
        (resend ? parts.stable : "") + withCapsule(capsule, (pkg ? `${pkg.text}\n\n` : "") + (cards ? `${cards}\n\n` : "") + voz + parts.perRequest + text);
      this.turnToolTokens = 0;
      // O placar (T14671): o que o Kiwi mandou neste pedido e a conversa de antes (a janela e a cápsula).
      const w = this.loadWindow();
      this.placar = new PlacarTurno(
        modelTokens((pkg ? `${pkg.text}\n\n` : "") + (cards ? `${cards}\n\n` : "") + voz + parts.perRequest + text),
        (w && w.sessionId === host.session ? w.tokens : 0) + (capsule ? modelTokens(capsule) : 0),
        faroDoPlacar(this.turnFaro),
      );
      asked = { host, prompt };
      // Com o Gemini, um pedido que começa por `/` não vira um comando da pessoa (ADR 0012, T24672).
      const answer = await host.ask(host.kind === "gemini" ? geminiPrompt(prompt) : prompt, (e) => {
        if (e.type === "done") return; // o `done` sai abaixo, com o texto inteiro
        // O uso da janela (spec #11084) não é um evento do pedido: vai para o medidor, e o aviso, uma vez, para o balão.
        if (e.type === "limit") {
          this.noteLimit(turn.id, e.limit);
          return;
        }
        // As idas (T14671): cada leva de ferramentas, do "rodando" até o "pensando" de novo, pede mais uma.
        if (e.type === "status" && e.status === "running") this.placar?.ferramentaComecou();
        if (e.type === "status" && e.status === "thinking") this.placar?.pensando();
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
      this.prefixSent = resend || !sent ? { host, stable: parts.stable, requests: 1 } : { ...sent, requests: sent.requests + 1 };
      answered = answer.text;
      if (answer.usage) {
        // A pergunta guardada é a que já passou pelo guardrail (sem segredo).
        const placar = this.placar?.fim(answer.usage);
        this.safely(() => this.usage.record(turn.id, decided.text, answer.usage!, placar));
        this.emitUsage();
      }
      if (answer.stopReason !== "cancelled" && !turn.cancelled && !isRoutinePrompt(text)) await this.learnTrail(decided.text).catch((err) => this.d.log?.(`[agent] trilha: ${String((err as Error)?.message ?? err)}`));
      // Depois da trilha (T28584): o aviso desta escrita faz Ajustes › Agente recarregar as trilhas, e elas já têm a de agora.
      // A resposta guardada passa pelo filtro, como o pedido: um segredo que a pessoa deixou ir e o agente repetiu não
      // vai para o disco (nem, depois, para a cápsula).
      void this.activity.setAnswer(turn.id, this.guard.request(answer.text).text).catch((err) => this.d.log?.(`[agent] activity: ${String((err as Error)?.message ?? err)}`));
      const links = answer.stopReason === "cancelled" ? undefined : await this.bubbleLinks(answer.text);
      this.emitTurn({ id: turn.id, type: "done", stopReason: answer.stopReason, text: answer.text, ...(links ? { links } : {}) });
      succeeded = answer.stopReason !== "cancelled" && !turn.cancelled;
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
      this.placar = null;
      if (asked) this.windowGrow(asked.host, modelTokens(asked.prompt) + this.turnToolTokens + (answered ? modelTokens(answered) : 0), true);
      if (this.turn === turn) this.turn = null;
      this.routineTurns.delete(turn.id);
      this.armIdle();
      this.emitStatus();
      // O limite depois do pedido (ADR 0013): em segundo plano, com a resposta já na tela; nada depois de um cancelado
      // ou com erro.
      if (succeeded) this.probeLimit(turn.id);
      // Uma reunião que terminou com o agente ocupado pede a proposta agora (spec #8360).
      this.nextMeeting();
    }
  }

  /** O aberto na janela Notas (T14359, T19969), nota ou arquivo, que a tela avisa: "essa nota", "esse arquivo". Só na memória. */
  private openNote: string | null = null;
  /** O índice de nomes do faro (T14359), refeito só quando a lista do cofre muda. */
  private faroIndex: { key: string; idx: FaroIndex } | null = null;
  setOpenNote(path: string | null): void {
    this.openNote = path || null;
  }

  /**
   * O faro (T14359): o índice de nomes, guardado enquanto a lista do cofre não muda (quantas notas e pastas, e a
   * mudança mais nova), e as citações do pedido. Devolve o pacote, ou null no "nada" e sem cofre.
   */
  private async faroPackage(request: string): Promise<{ text: string; delivered: { path: string }[]; result: FaroResult } | null> {
    const reader = this.reader;
    // Um comando do agente ("/usage", "/compact") vai como está: não é um pedido sobre as notas.
    if (!reader || request.trimStart().startsWith("/")) return null;
    const list = await reader.list();
    // A chave do índice são os caminhos (revisão do T14359): renomear uma nota ou uma pasta muda a chave, e o índice
    // nunca aponta para um nome velho. Um hash da lista, sem guardar a lista.
    const key = Bun.hash(`${list.folders.join("\n")}\u0000${list.notes.map((n) => n.path).join("\n")}`).toString(36);
    if (this.faroIndex?.key !== key) {
      const [projects, meetings] = await Promise.all([reader.projects().catch(() => []), reader.meetings().catch(() => [])]);
      this.faroIndex = { key, idx: buildIndex({ notes: list.notes, folders: list.folders, projects, meetings }) };
    }
    const folderId = (await this.writer?.folder().catch(() => null)) ?? null;
    this.turnPasta = folderId ? keyOf(folderId) : null;
    const result = sniff(request, this.faroIndex.idx, { openNote: this.openNote, trilhas: trilhasDaPasta(this.trilhas.list(), this.turnPasta) });
    this.turnFaro = result;
    const decider = this.decider();
    const pkg = await buildPackage({ reader, seen: async (path, content) => (await this.guard.decide(path, content, decider)).text, registro: this.registro }, result, request);
    return pkg ? { ...pkg, result } : null;
  }

  /**
   * As trilhas (ADR 0013 decisão 4, T14682): o agente leu uma nota que o faro não deu como certa. As palavras do pedido
   * (já pelo filtro de segredos) passam a levar a ela. Nunca num comando ("/usage"). Leu várias: a pasta da maioria
   * conta, e nela a primeira nota lida (T21325).
   */
  private async learnTrail(request: string): Promise<void> {
    const read = notaDaMaioria(this.turnReads);
    this.turnReads = [];
    if (!read || request.trimStart().startsWith("/")) return;
    const f = this.turnFaro;
    if (!f) return;
    if (f.kind === "certo") {
      const t = f.hit.target;
      const same = t.path === read || (t.kind === "projeto" && t.main === read);
      // A trilha que acertou conta mais uma vez; o nome que acertou não precisa de trilha.
      if (f.hit.how === "apontado" || (same && f.hit.how !== "trilha")) return;
    }
    const pasta = this.turnPasta;
    const lugar = await this.lugarDaNota(read, request).catch(() => undefined);
    const learned = this.trilhas.aprender(request, read, pasta, lugar);
    if (learned) this.d.log?.(`[agent] trilha: ${learned.vezes}× para a nota`);
  }

  /**
   * Onde está a nota (T21325): o nome da pasta e o título, os vizinhos que dividem pedaços do nome (as pastas irmãs e
   * as outras notas da pasta), e as palavras raras do pedido que aparecem em muitas notas.
   */
  private async lugarDaNota(nota: string, request: string): Promise<LugarDaNota | undefined> {
    const reader = this.reader;
    if (!reader) return undefined;
    const list = await reader.list();
    const pastaDe = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
    const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);
    const titulo = (p: string) => base(p).replace(/\.(md|txt)$/i, "");
    const dir = pastaDe(nota);
    const mae = pastaDe(dir);
    const vizinhos = [
      ...(dir ? list.folders.filter((f) => f !== dir && pastaDe(f) === mae).map(base) : []),
      ...list.notes.filter((n) => n.path !== nota && pastaDe(n.path) === dir).map((n) => titulo(n.path)),
    ];
    // Uma palavra que aparece em muitas notas não diz qual delas é: pelo menos 3 e um décimo das notas.
    const corte = Math.max(MUITAS_MIN, Math.ceil(list.notes.length * MUITAS_PARTE));
    const muitas = new Set<string>();
    const raras = palavrasDoPedido(request);
    for (const [i, k] of raras.chaves.entries()) {
      const w = raras.palavras[i]!;
      const hits = await reader.search(w, Math.min(corte, 200)).catch(() => []);
      if (hits.filter((h) => !h.approx && !h.semantic).length >= Math.min(corte, 200)) muitas.add(k);
    }
    return { nomes: [dir ? base(dir) : "", titulo(nota)], vizinhos, muitas };
  }

  /** As trilhas, para Ajustes › Agente: as que esperam a segunda vez vão com `aprendendo` e as palavras candidatas. */
  trails(): AgentTrailsView {
    return {
      trilhas: this.trilhas.list().map((t) => ({
        id: t.id,
        palavras: aprendendo(t) ? (t.candidatas?.palavras ?? []) : t.palavras,
        path: t.path,
        titulo: path.basename(t.path).replace(/\.(md|txt)$/i, ""),
        vezes: t.vezes,
        em: t.em,
        ...(aprendendo(t) ? { aprendendo: true } : {}),
      })),
    };
  }

  /**
   * As notas da pasta `pasta` mudaram de lugar ou saíram (T16650), pelo app ou por fora: as trilhas dela vão junto, e a
   * de uma nota que saiu sai da lista. `map` é o mesmo das fixadas: o caminho novo, ou null. As de outra pasta ficam.
   */
  trailsFollow(pasta: string | null, map: (p: string) => string | null): void {
    const n = this.trilhas.seguir(pasta, map);
    if (n) this.d.log?.(`[agent] trilhas: ${n} seguiram a nota`);
  }

  /** Apaga uma trilha. */
  trailDelete(id: string): AgentTrailsView {
    this.trilhas.apagar(id);
    return this.trails();
  }

  /** A conversa nova que a pessoa pediu (ADR 0013 peça 5): a janela fecha no próximo pedido, que começa com a cápsula. */
  newConversation(): void {
    this.windowAsked = true;
  }

  /** A janela agora (T13835), para os testes e a CLI. */
  windowState(): WindowState | null {
    return this.loadWindow();
  }

  private get windowFile(): string {
    return path.join(agentDir(this.d.data), "window.json");
  }

  private loadWindow(): WindowState | null {
    if (this.window !== undefined) return this.window;
    try {
      const w = JSON.parse(readFileSync(this.windowFile, "utf8")) as Partial<WindowState>;
      const ok = typeof w.sessionId === "string" && [w.startedAt, w.lastIdaAt, w.tokens].every((n) => typeof n === "number" && Number.isFinite(n));
      this.window = ok ? (w as WindowState) : null;
    } catch {
      this.window = null;
    }
    return this.window;
  }

  private saveWindow(w: WindowState | null): void {
    this.window = w;
    this.safely(() => {
      mkdirSync(agentDir(this.d.data), { recursive: true, mode: 0o700 });
      writeFileSync(this.windowFile, JSON.stringify(w ?? {}) + "\n", { mode: 0o600 });
    });
  }

  /**
   * Antes do pedido: a janela segue, ou fecha e a sessão do agente é nova (`newSession`, na mesma conexão). Devolve a
   * cápsula da janela nova, ou "" quando ela segue. A sessão que o agente tem e não é a da janela (outra pessoa, um
   * estado perdido, a 1ª vez) também começa uma janela: o tamanho dela o Kiwi não conhece.
   */
  private async openWindow(host: AgentHost, request: string): Promise<string> {
    const now = (this.d.now ?? Date.now)();
    const saved = this.loadWindow();
    const w = saved && saved.sessionId === host.session ? saved : null;
    // O interruptor da web mudou: a sessão abre de novo com as ferramentas certas (revisão do T19300).
    const reason: WindowCloseReason | null = host.sessionWeb !== this.webNow ? "web" : windowCloseReason(w, { now, asked: this.windowAsked, conversationOpen: this.conversationOpen(), ...this.d.window });
    if (!reason) {
      this.registro.novoPedido();
      return "";
    }
    // A sessão nova não tem nada do que foi entregue (ADR 0013 peça 4).
    this.registro.zerar();
    this.registro.novoPedido();
    this.windowAsked = false;
    // A sessão que acabou de nascer, sem pedido nenhum, já é a janela nova; as outras dão lugar a uma (só o `session/new`,
    // sem ida).
    if (reason !== "start" || !host.sessionFresh) await host.newSession();
    // A sessão é nova: o começo fixo vai de novo (ele está no cache, igual, e não pesa).
    this.prefixSent = null;
    const capsule = await this.capsule(request);
    this.saveWindow({ sessionId: host.session ?? "", startedAt: now, lastIdaAt: now, tokens: 0 });
    this.d.log?.(`[agent] janela nova (${reason}): cápsula de ${capsule ? modelTokens(capsule) : 0} tokens`);
    return capsule;
  }

  /** A conversa da janela cresceu (um pedido, um `/usage`). `ida`: houve uma chamada ao modelo agora. */
  private windowGrow(host: AgentHost, tokens: number, ida = false): void {
    const w = this.loadWindow();
    if (!w || w.sessionId !== host.session) return;
    this.saveWindow({ ...w, tokens: w.tokens + tokens, ...(ida ? { lastIdaAt: (this.d.now ?? Date.now)() } : {}) });
  }

  /** A cápsula (ADR 0013 peça 5): os pedidos de antes do registro, as notas que eles tocaram e o mapa da pasta. */
  private async capsule(request: string): Promise<string> {
    const recent = await this.activity.conversation(CAPSULE_TURNS + 1).catch(() => [] as ActivityRequest[]);
    const turns: CapsuleTurn[] = recent
      .filter((r) => r.id !== request && r.request.trim())
      .slice(0, CAPSULE_TURNS)
      .reverse()
      .map((r) => ({
        request: r.request,
        ...(r.answer ? { answer: r.answer } : {}),
        // Só o que é nota ou arquivo: o `target` de uma busca é o que foi procurado.
        read: [...new Set(r.reads.map((x) => x.target ?? "").filter((t) => /\.(md|txt)$/i.test(t)))],
        changed: [...new Set(r.changes.map((c) => c.path))],
      }));
    let map: CapsuleMap | null = null;
    if (this.reader) {
      try {
        const [list, projects] = await Promise.all([this.reader.list(), this.reader.projects().catch(() => [])]);
        map = { projects: projects.map((p) => ({ name: p.name, folder: p.folder, notes: p.notes })), folders: folderCounts(list.notes) };
      } catch {
        map = null;
      }
    }
    return buildCapsule(turns, map);
  }

  /** Abre o programa do agente (uma vez, mesmo com dois pedidos chegando juntos). */
  private openProgram(): Promise<AgentHost> {
    this.opening ??= (async () => {
      const epoch = this.epoch;
      const s = await this.settings.load();
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
            speech: () => this.speechSink(),
            version: this.d.version,
            registro: this.registro,
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
      const kind = this.kind;
      // Um host de outro agente que ficou aberto fecha antes: nunca dois programas, nem o de antes reusado.
      const stale = this.host;
      if (stale && stale.kind !== kind) {
        this.host = null;
        if (stale.running) await stale.stop();
      }
      const host = await this.d.openHost({
        kind,
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
        // O login do Gemini só se vê aqui (spec #24666): o `authRequired` da sessão diz que falta.
        if (kind === "gemini" && e instanceof AgentError && e.code === "E_AGENT_NOT_LOGGED_IN") this.noteGeminiLogin(false);
        throw e;
      } finally {
        if (this.pending === host) this.pending = null;
      }
      // A pessoa trocou de agente enquanto este abria: ele fecha, e nada vai a ele.
      if (kind !== this.kind) {
        await host.stop();
        this.stopTools(tools);
        throw new AgentError("E_AGENT_FAILED", this.name, "trocou de agente enquanto o programa abria");
      }
      if (kind === "gemini") this.noteGeminiLogin(true);
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
  async configure(o: { kind?: AgentKind; model?: string; effort?: string; economy?: boolean; controlShortcut?: boolean; showSpokenText?: boolean; catSpeaks?: boolean; meetings?: unknown; summary?: unknown; instructions?: string; webSearch?: boolean; onboarding?: unknown; routines?: unknown }): Promise<AgentStatus> {
    const patch: Partial<AgentSettings> = {};
    // O onboarding (spec #11955): o passo em que a pessoa está, fechar (`done`) e o "Refazer" (`open` no passo 1).
    // As rotinas (spec #12150): ligar ou mudar a hora arma a rotina agora (um horário de antes não dispara).
    // Pela fila das rotinas (revisão do T13010): ligar uma pronta junto com um "Nova rotina" não perde a nova.
    if (o.routines !== undefined) await this.saveRoutines(async (current) => patchRoutines(current, o.routines, this.clock()));
    if (o.onboarding !== undefined) {
      const now = sanitizeAgentOnboarding((await this.settings.load()).onboarding);
      patch.onboarding = sanitizeAgentOnboarding({ ...now, ...(o.onboarding && typeof o.onboarding === "object" ? o.onboarding : {}) });
    }
    // O resumo executivo (spec #11546): os blocos e o período, inteiros e saneados.
    if (o.summary !== undefined) patch.summary = sanitizeSummarySettings(o.summary);
    // "Suas reuniões" (spec #8360): inteiro, saneado; uma pasta fora do cofre volta para a do projeto.
    if (o.meetings !== undefined) patch.meetings = sanitizeAgentMeetingSettings(o.meetings);
    // As instruções da pessoa (spec #11469): valem a partir do pedido seguinte. Elas vão no começo fixo de todo pedido,
    // por fora do filtro do pedido: um trecho com cara de senha ou token é recusado aqui, e nada é gravado (revisão do
    // T11667). Assim o começo continua com os mesmos bytes, sem marcador no meio.
    // "Pesquisar na web" (spec #11908): vale já no próximo pedido de permissão, e o pedido seguinte abre uma sessão com as
    // ferramentas de web, ou sem elas (`openWindow`, revisão do T19300).
    if (o.webSearch !== undefined) {
      patch.webSearch = o.webSearch === true;
      patch.webSearchChosen = true;
      this.webNow = patch.webSearch;
    }
    if (o.instructions !== undefined) {
      const text = o.instructions.replace(/\r\n?/g, "\n").slice(0, INSTRUCTIONS_MAX);
      if (/‹segredo [^›\n]{0,40}›/.test(text) || this.guard.read("", text).held > 0)
        throw new AgentServiceError("E_SECRET", "As instruções têm uma senha ou um token: tire esse trecho antes de salvar. Elas vão ao agente em todo pedido.");
      patch.instructions = text;
    }
    if (o.model !== undefined) patch.model = o.model;
    // O esforço é do modelo (spec #16793): do que veio junto, ou do escolhido agora. Vale a partir do próximo pedido,
    // pelo `set_config_option`, sem mexer numa resposta em andamento.
    if (o.effort !== undefined) {
      const now = await this.settings.load();
      const model = o.model ?? now.model;
      patch.effortByModel = sanitizeEffortByModel({ ...now.effortByModel, [model]: o.effort });
    }
    if (o.economy !== undefined) {
      patch.economy = o.economy;
      this.economyNow = o.economy;
    }
    // Spec #9876: "Falar com o agente pelo Control".
    if (o.controlShortcut !== undefined) patch.controlShortcut = o.controlShortcut;
    // Spec #26055: "Mostrar o que eu falei".
    if (o.showSpokenText !== undefined) patch.showSpokenText = o.showSpokenText;
    // "O gato fala" (spec #26687, T26736): vale no próximo pedido por voz. Ligar não baixa nada; o download é o clique.
    if (o.catSpeaks !== undefined) patch.catSpeaks = o.catSpeaks;
    // Trocar de agente (spec #24666): o aberto fecha antes de gravar, e o próximo pedido abre o escolhido, na sessão dele.
    // O modelo é de cada agente: o de agora fica guardado, e volta o que o outro tinha.
    if (o.kind !== undefined) {
      if (!isAgentKind(o.kind)) throw new AgentServiceError("E_BAD_ARGS", `agente desconhecido: ${String(o.kind)}`);
      const now = await this.settings.load();
      const from = isAgentKind(now.kind) ? now.kind : "claude";
      if (o.kind !== from) {
        if (this.turn || this.usageRun) throw fromAgentError(new AgentError("E_AGENT_BUSY", this.name), this.name);
        // O agente novo é gravado antes de fechar o de agora: um pedido que chega durante o fechamento já abre o
        // escolhido, e um que abria o de antes é parado (revisão do T24672).
        const byKind = { ...now.modelByKind, [from]: patch.model ?? now.model };
        delete patch.model;
        await this.settings.save({ kind: o.kind, modelByKind: byKind, model: byKind[o.kind] ?? DEFAULT_AGENT_SETTINGS.model });
        this.subscription = null;
        await this.stopProgram(`trocou de agente: ${from} → ${o.kind}`);
      }
    }
    if (Object.keys(patch).length) await this.settings.save(patch);
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
      if (!this.turn && !this.usageRun) void this.stopProgram("10 minutos sem uso").then(() => this.emitStatus());
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
  attachNotice(o: { notices: Notices; inView: () => boolean; show: () => void; locale?: () => Locale }): void {
    this.notice?.stop();
    this.notice = new WaitingNotice({
      ...o,
      card: () => this.questions.current(),
      enabled: async () => (await this.settings.load()).notifyWaiting !== false,
      setEnabled: async (on) => void (await this.settings.save({ notifyWaiting: on })),
      onChange: (s) => {
        for (const fn of this.noticeListeners) fn(s);
      },
      log: (m) => this.d.log?.(`[agent] ${m}`),
    });
  }

  /** A linha de Ajustes › Agente (`agent.notice`): a permissão do macOS e o liga/desliga. */
  async noticeState(): Promise<NoticeState> {
    if (this.notice) return this.notice.state();
    return { permission: "unavailable", enabled: (await this.settings.load()).notifyWaiting !== false };
  }

  /** "Ligar as notificações" (`agent.noticeAllow`): o único caminho que pede a permissão ao macOS. */
  async noticeAllow(): Promise<NoticeState> {
    return this.notice ? this.notice.allow() : this.noticeState();
  }

  /** O liga/desliga "Avisar quando o agente esperar uma resposta" (`agent.noticeSet`). */
  async noticeSet(on: boolean): Promise<NoticeState> {
    if (this.notice) return this.notice.setEnabled(on);
    await this.settings.save({ notifyWaiting: on });
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
