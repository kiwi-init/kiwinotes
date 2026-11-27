// As Configurações que o engine guarda (T1499): `settings.json`, ao lado do dicionário e dos snippets. O atalho da janela
// Notas e a Aparência (T2503); o resto da tela de Configurações ainda é casca.

import { NOTE_WIDTH, sanitizeNoteWidth } from "../shared/note-width.ts";
import { existsSync } from "node:fs";
import path from "node:path";
import { DEFAULT_SUMMARY_SETTINGS, sanitizeSummarySettings, type SummarySettings } from "../shared/summary-settings.ts";

import { attachmentsFolder, DEFAULT_ATTACHMENTS_FOLDER } from "../notes/attachments.ts";
import { type Appearance, DEFAULT_APPEARANCE, sanitizeAppearance } from "../shared/appearance.ts";
import { type SavedSearch, sanitizeSavedSearches } from "../shared/query.ts";
import { DEFAULT_TEMPLATES_FOLDER } from "../shared/templates.ts";
import { DEFAULT_MICROPHONE, isMicrophoneChoice, type MicrophoneChoice } from "../shared/microphone.ts";
import { type NotesShortcut, sanitizeShortcuts, type Shortcuts } from "../shared/shortcuts.ts";
import { DEFAULT_MEETING_SETTINGS, type MeetingSettings, sanitizeMeetingSettings } from "../shared/meetings.ts";
import { type CatColorChoice, DEFAULT_CAT_COLOR, isCatColorChoice } from "../shared/kiwicat-colors.ts";
import { CAT_SIZE, type CatPosition, catSize, DEFAULT_CAT_POSITION, isCatPosition } from "../shared/kiwicat-place.ts";
import { type CatVoiceId, DEFAULT_CAT_VOICE, isCatVoiceId } from "../shared/cat-voices.ts";
import {
  type CatVoiceProvider,
  DEFAULT_CAT_VOICE_PROVIDER,
  DEFAULT_ELEVENLABS_MODEL,
  DEFAULT_ELEVENLABS_VOICE,
  type ElevenLabsModel,
  isCatVoiceProvider,
  isElevenLabsModel,
  isElevenLabsVoiceId,
} from "../shared/elevenlabs.ts";
import { folderPath } from "../notes/paths.ts";
import { type AgentOnboarding, DEFAULT_AGENT_ONBOARDING, sanitizeAgentOnboarding } from "../shared/agent-onboarding.ts";
import type { AgentKind } from "../shared/ui-contract.ts";
import { type AgentRoutines, DEFAULT_AGENT_ROUTINES, sanitizeAgentRoutines } from "../shared/agent-routines.ts";
import { DEFAULT_LANGUAGE, isLanguageSetting, type LanguageSetting } from "../shared/i18n/index.ts";
import { readJson, writeJson } from "./files.ts";

export interface AppSettings {
  /**
   * Todos os atalhos, de cada ação (T5349, #175): o ditado, as Notas, as reuniões, a paleta… null é desligado. O helper
   * recebe os globais no `config.set {shortcuts}`.
   */
  shortcuts: Shortcuts;
  /** O atalho global que abre a janela Notas, ou null. Desde o T5349, o mesmo que `shortcuts.notes` (fica pelo contrato 1.x). */
  notesShortcut: NotesShortcut | null;
  /**
   * As notas e pastas fixadas na janela Notas (T2468), relativas ao vault. Ficam aqui e não no frontmatter, para não
   * mexer no arquivo da pessoa por uma preferência da UI; o engine corrige quando elas mudam de nome, de pasta ou somem.
   */
  pinned: string[];
  /** Modo, temas, texto, fonte e movimento, para todas as janelas (T2503). */
  appearance: Appearance;
  /** A pasta dos modelos de nota, relativa ao vault (T2619). */
  templatesFolder: string;
  /** A pasta da nota do dia (T2593), relativa ao vault. Como no Obsidian, configurável. */
  dailyFolder: string;
  /** Onde os anexos colados e arrastados vão, relativo ao vault ("" é a raiz). Padrão: `Anexos` (T2594). */
  attachmentsFolder: string;
  /** As buscas salvas, fixadas na árvore das Notas (T2660). */
  savedSearches: SavedSearch[];
  /** Ler o texto das imagens e dos PDFs anexados para a busca, no Mac (T2709). Ligado por padrão. */
  ocr: boolean;
  /** A busca pelo sentido (T6013, #4766): o modelo local, baixado uma vez. Ligada por padrão; desligar apaga o modelo. */
  semanticSearch: boolean;
  /**
   * "Buscar atualizações" (T25110, spec #25011): o Updater e o canal da UI só vão à rede com ele ligado. Ligado por
   * padrão; desligado, nenhum GET a partir da próxima checagem, sem reiniciar.
   */
  checkUpdates: boolean;
  /**
   * "Idioma do app" (spec #28171, T28190): Automático (a língua do macOS), português ou inglês. Muda os textos de todas
   * as janelas na hora; o ditado, a voz do gato e as respostas do agente não mudam por ele.
   */
  language: LanguageSetting;
  /** Por qual microfone o ditado grava (spec #3202, T3230). O helper recebe no `config.set`. Padrão: "auto". */
  microphone: MicrophoneChoice;
  /** A árvore das Notas mostra a extensão (`.md`, `.pdf`…) depois do nome (T3370). Desligado por padrão. */
  showExtensions: boolean;
  /** Os sons de início e de fim do ditado e da reunião (T5833, #213). Ligados por padrão; o helper recebe no `config.set`. */
  cues: boolean;
  /**
   * O modo preciso do ditado (T6602, #6894): o Whisper small no lugar do Parakeet, com o dicionário como prompt. Erra
   * menos os termos técnicos, a ~0,3 s por ditado. Desligado por padrão; ligar baixa o modelo (270 MB), e desligar apaga.
   */
  preciseDictation: boolean;
  /**
   * Quem fala com a voz do Kiwi (spec #31616): a voz local (o padrão) ou o ElevenLabs, com a conta e a chave da pessoa
   * (no Keychain, nunca aqui). Sem chave, ou com o ElevenLabs falhando, o Kiwi fala com a local daquela vez.
   */
  catVoiceProvider: CatVoiceProvider;
  /** O ID da voz no ElevenLabs, colado pela pessoa (harry #31625). Padrão: a Matilda. */
  elevenLabsVoiceId: string;
  /** O modelo do ElevenLabs (harry #31625), um de `ELEVENLABS_MODELS`. Padrão: `eleven_v4_turbo`. */
  elevenLabsModel: ElevenLabsModel;
  /** Os ajustes de reunião (R6, T4947): os atalhos, o pop-up e os apps que contam. O helper recebe no `config.set`. */
  meetings: MeetingSettings;
  /** A largura máxima da coluna da nota, em px (T5299, issue #212): a alça na borda da nota muda, dentro dos limites. */
  noteWidth: number;
  /**
   * O agente (spec #8339, T8678): ligado, se a pessoa já aceitou a tela "o que vai para o agente" (ADR 0011), e o modelo
   * e o esforço que o Kiwi pede ao abrir a sessão. Só muda pelas capacidades `agent.*`, nunca pelo `settings.set`.
   */
  agent: AgentSettings;
  /**
   * Mostrar o gato no hub (T9567), condicionado ao agente ligado; `overlay` (spec #9810): mostrar o gato por cima dos
   * outros apps quando o Kiwi não está na frente, separado do gato do canto. `cor` (spec #14963): a paleta do gato, uma das 5
   * do pacote (`src/shared/kiwicat-colors.ts`); uma escolha antiga (a do agente ou um preset do spec #9349) vira o padrão.
   */
  kiwicat: {
    show: boolean;
    overlay: boolean;
    cor: CatColorChoice;
    /** Onde o gato aparece por cima dos apps (spec #12949): uma das seis posições; o padrão é o centro. */
    posicao: CatPosition;
    /** O tamanho dele, em vezes o de hoje (de 0,6 a 1,6). */
    tamanho: number;
    /** A voz do gato (spec #27531): um id de `src/shared/cat-voices.ts`. Trocar não baixa nada. */
    voz: CatVoiceId;
  };
  /**
   * A primeira abertura (T20796, spec #20780): `pending` só numa instalação nova (sem settings.json), até o fim do passo
   * das permissões e do modelo. Se o app fechar no meio, segue `pending` e o passo volta. Quem já usa o app: `done`.
   */
  firstRun: "pending" | "done";
}

export interface AgentSettings {
  /** O agente escolhido (spec #24666): o Claude Code por padrão, ou o Gemini CLI. Um por vez. */
  kind: AgentKind;
  enabled: boolean;
  consented: boolean;
  /** Um valor da opção `model` do agente; "default" é o padrão do Claude Code, e não o modelo do terminal da pessoa. */
  model: string;
  /**
   * O modelo de cada agente (spec #24666), guardado ao trocar: voltar ao Claude traz o modelo que ele tinha. O `model`
   * é sempre o do agente escolhido.
   */
  modelByKind: Partial<Record<AgentKind, string>>;
  /**
   * Um valor da opção `effort` do agente; "default" é o padrão. Desde o spec #16793 é só o valor inicial: vale para um
   * modelo que ainda não tem esforço próprio em `effortByModel` (assim o ajuste de antes migra sem perder nada).
   */
  effort: string;
  /** O esforço de cada modelo (spec #16793), pelo valor do modelo: `{ "sonnet": "low", "opus": "high" }`. */
  effortByModel: Record<string, string>;
  /** "Avisar quando o agente esperar uma resposta" (spec #9839): a notificação do macOS; ligado por padrão. */
  notifyWaiting: boolean;
  /** O modo econômico (spec #11084): o modelo mais barato, as ferramentas por seção e respostas curtas; desligado. */
  economy: boolean;
  /** "Falar com o agente pelo Control" (spec #9876): segurar o Control ouve e soltar manda. Desligado por padrão. */
  controlShortcut: boolean;
  /**
   * "Mostrar o que eu falei" (spec #26055): o balão do Kiwi mostra a transcrição da fala até a resposta. Ligado por
   * padrão desde o spec #32534 (T33177).
   */
  showSpokenText: boolean;
  /**
   * A pessoa já mexeu no "Mostrar o que eu falei" (T33177), como o `webSearchChosen`: os arquivos de antes têm o `false`
   * do padrão velho, gravado junto com o resto. Sem esta marca vale o padrão novo (ligado); com ela, a escolha.
   */
  showSpokenTextChosen: boolean;
  /**
   * "O gato fala" (spec #26687): num pedido feito por voz, o gato fala 1 ou 2 frases da resposta (o `kiwi falar`, T26709).
   * Desligado por padrão; o interruptor em Ajustes é outra parte do spec.
   */
  catSpeaks: boolean;
  /** "Suas reuniões" (spec #8360): quando o agente propõe a nota da reunião, onde ela vai, o nome e os blocos. */
  meetings: AgentMeetingSettings;
  /** As instruções da pessoa para o agente (spec #11469): até 2.000 caracteres, em todo pedido. */
  instructions: string;
  /**
   * "Pesquisar na web" (spec #11908): o Kiwi libera as ferramentas de web do agente. Ligado por padrão desde o spec
   * #19273 (harry #19290): buscar e ler uma página gasta menos que trazer a página inteira.
   */
  webSearch: boolean;
  /**
   * A pessoa já mexeu no "Pesquisar na web" (spec #19273). As configurações são gravadas inteiras, então todo arquivo de
   * antes tem o `webSearch: false` do padrão velho: sem esta marca, vale o padrão novo (ligado); com ela, a escolha.
   */
  webSearchChosen: boolean;
  /** O resumo executivo (spec #11546): os blocos e o período do primeiro. */
  summary: SummarySettings;
  /** O onboarding (spec #11955): pendente até a primeira vez que o agente liga; aberto (com o passo) ou feito. */
  onboarding: AgentOnboarding;
  /** As rotinas (spec #12150): o resumo do dia e os pendentes da semana, as duas desligadas de fábrica. */
  routines: AgentRoutines;
}

/** "Suas reuniões" em Ajustes › Agente (spec #8360). */
export interface AgentMeetingSettings {
  /** Depois da reunião: propor sozinho (o padrão, #8360) ou só quando a pessoa pedir. */
  propose: "auto" | "on-request";
  /** Onde vai a nota: na pasta do projeto (o padrão), ou numa pasta única. */
  folder: { kind: "project" } | { kind: "single"; path: string };
  /** O nome do arquivo: `data · tema` (o padrão) ou `tema · data`. */
  name: "date-theme" | "theme-date";
  /** Os blocos do resumo, cada um liga e desliga. */
  blocks: { summary: boolean; decisions: boolean; actions: boolean; participants: boolean; nextSteps: boolean };
}

export const DEFAULT_AGENT_MEETING_SETTINGS: AgentMeetingSettings = {
  propose: "auto",
  folder: { kind: "project" },
  name: "date-theme",
  blocks: { summary: true, decisions: true, actions: true, participants: true, nextSteps: true },
};

/** Uma pasta do cofre que vale: relativa, sem `..`, sem ponto no começo de um nome, até 300 caracteres. */
function vaultFolder(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const p = v.trim().replace(/^\/+|\/+$/g, "");
  if (!p || p.length > 300 || p.split("/").some((x) => !x.trim() || x === ".." || x.startsWith("."))) return null;
  return p;
}

export function sanitizeAgentMeetingSettings(input: unknown): AgentMeetingSettings {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const f = (o.folder && typeof o.folder === "object" ? o.folder : {}) as Record<string, unknown>;
  const single = f.kind === "single" ? vaultFolder(f.path) : null;
  const b = (o.blocks && typeof o.blocks === "object" ? o.blocks : {}) as Record<string, unknown>;
  const on = (k: string) => b[k] !== false;
  return {
    propose: o.propose === "on-request" ? "on-request" : "auto",
    folder: single ? { kind: "single", path: single } : { kind: "project" },
    name: o.name === "theme-date" ? "theme-date" : "date-theme",
    blocks: { summary: on("summary"), decisions: on("decisions"), actions: on("actions"), participants: on("participants"), nextSteps: on("nextSteps") },
  };
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  kind: "claude",
  enabled: false,
  consented: false,
  model: "default",
  modelByKind: {},
  effort: "default",
  effortByModel: {},
  notifyWaiting: true,
  economy: false,
  controlShortcut: false,
  showSpokenText: true,
  showSpokenTextChosen: false,
  catSpeaks: false,
  meetings: DEFAULT_AGENT_MEETING_SETTINGS,
  summary: DEFAULT_SUMMARY_SETTINGS,
  instructions: "",
  webSearch: true,
  webSearchChosen: false,
  onboarding: DEFAULT_AGENT_ONBOARDING,
  routines: DEFAULT_AGENT_ROUTINES,
};

/** Um id de modelo ou de esforço que vale: letras, números, ponto, hífen e sublinhado (um agente como o `agy` pode usar, T25553), até 64. */
export function isAgentChoice(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._\-]{0,63}$/.test(v);
}

/** Até quantos modelos guardam o esforço: a lista do agente tem uns 10, e um modelo que saiu dela fica guardado. */
export const MAX_EFFORT_MODELS = 50;

/** O esforço por modelo, saneado: só ids que valem, nos dois lados, até `MAX_EFFORT_MODELS`. */
export function sanitizeEffortByModel(input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  for (const [model, effort] of Object.entries(input as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_EFFORT_MODELS) break;
    if (isAgentChoice(model) && isAgentChoice(effort)) out[model] = effort;
  }
  return out;
}

/** O modelo de cada agente (spec #24666): só os agentes que existem, e só ids que valem. */
export function sanitizeModelByKind(input: unknown): Partial<Record<AgentKind, string>> {
  const o = (input && typeof input === "object" && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const out: Partial<Record<AgentKind, string>> = {};
  for (const kind of ["claude", "gemini"] as const) if (isAgentChoice(o[kind])) out[kind] = o[kind] as string;
  return out;
}

/** O esforço de um modelo (spec #16793): o salvo para ele, ou o `effort` de antes, que vale para todos. */
export function effortOf(s: Pick<AgentSettings, "effort" | "effortByModel">, model: string): string {
  return s.effortByModel?.[model] ?? s.effort;
}

export function sanitizeAgentSettings(input: unknown): AgentSettings {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return {
    kind: o.kind === "gemini" ? "gemini" : "claude",
    enabled: o.enabled === true,
    consented: o.consented === true,
    model: isAgentChoice(o.model) ? o.model : DEFAULT_AGENT_SETTINGS.model,
    modelByKind: sanitizeModelByKind(o.modelByKind),
    effort: isAgentChoice(o.effort) ? o.effort : DEFAULT_AGENT_SETTINGS.effort,
    effortByModel: sanitizeEffortByModel(o.effortByModel),
    notifyWaiting: o.notifyWaiting !== false,
    economy: o.economy === true,
    controlShortcut: o.controlShortcut === true,
    showSpokenText: o.showSpokenTextChosen === true ? o.showSpokenText === true : DEFAULT_AGENT_SETTINGS.showSpokenText,
    showSpokenTextChosen: o.showSpokenTextChosen === true,
    catSpeaks: o.catSpeaks === true,
    meetings: sanitizeAgentMeetingSettings(o.meetings),
    instructions: typeof o.instructions === "string" ? o.instructions.replace(/\r\n?/g, "\n").slice(0, 2000) : "",
    webSearch: o.webSearchChosen === true ? o.webSearch === true : DEFAULT_AGENT_SETTINGS.webSearch,
    webSearchChosen: o.webSearchChosen === true,
    summary: sanitizeSummarySettings(o.summary),
    onboarding: sanitizeAgentOnboarding(o.onboarding),
    routines: sanitizeAgentRoutines(o.routines),
  };
}

/** Até quantas fixadas. */
export const MAX_PINNED = 200;

export const DEFAULT_SETTINGS: AppSettings = { shortcuts: sanitizeShortcuts({}), notesShortcut: sanitizeShortcuts({}).notes, pinned: [], appearance: DEFAULT_APPEARANCE, templatesFolder: DEFAULT_TEMPLATES_FOLDER, dailyFolder: "Diário", attachmentsFolder: DEFAULT_ATTACHMENTS_FOLDER, ocr: true, semanticSearch: true, checkUpdates: true, language: DEFAULT_LANGUAGE, savedSearches: [], microphone: DEFAULT_MICROPHONE, showExtensions: false, cues: true, preciseDictation: false, catVoiceProvider: DEFAULT_CAT_VOICE_PROVIDER, elevenLabsVoiceId: DEFAULT_ELEVENLABS_VOICE, elevenLabsModel: DEFAULT_ELEVENLABS_MODEL, meetings: DEFAULT_MEETING_SETTINGS, noteWidth: NOTE_WIDTH.default, agent: DEFAULT_AGENT_SETTINGS, kiwicat: { show: true, overlay: true, cor: DEFAULT_CAT_COLOR, posicao: DEFAULT_CAT_POSITION, tamanho: CAT_SIZE.default, voz: DEFAULT_CAT_VOICE }, firstRun: "done" };

/** Uma pasta de modelos que vale: relativa, sem `..` nem ponto no começo de um pedaço (a validação de vault é do engine). */
export function sanitizeTemplatesFolder(input: unknown): string {
  if (typeof input !== "string") return DEFAULT_TEMPLATES_FOLDER;
  const p = input.trim().replace(/^\/+|\/+$/g, "");
  return p && p.length <= 512 && p.split("/").every((s) => s && !s.startsWith(".")) ? p : DEFAULT_TEMPLATES_FOLDER;
}

/** A pasta da nota do dia que vale: um caminho de pasta do vault, não vazio; senão, a padrão. */
export function sanitizeDailyFolder(input: unknown): string {
  try {
    const p = folderPath(input);
    return p || DEFAULT_SETTINGS.dailyFolder;
  } catch {
    return DEFAULT_SETTINGS.dailyFolder;
  }
}

/** A pasta de anexos que vale, ou o padrão (um valor editado à mão que sai do vault volta ao padrão). */
function sanitizeAttachmentsFolder(input: unknown): string {
  try {
    return attachmentsFolder(input);
  } catch {
    return DEFAULT_ATTACHMENTS_FOLDER;
  }
}

/** A lista de fixadas que vale: strings curtas, sem repetir, até `MAX_PINNED` (a validação de caminho é de quem grava). */
export function sanitizePinned(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.filter((p): p is string => typeof p === "string" && p.length > 0 && p.length <= 1024))].slice(0, MAX_PINNED);
}

/** O que o `save` aceita: a Aparência pode vir em parte, e o resto dela fica como está. */
export type SettingsPatch = Partial<Omit<AppSettings, "appearance">> & { appearance?: Partial<Appearance> };

interface SettingsFile extends Partial<AppSettings> {
  version: 1;
}

/** Só o que vale: um campo editado à mão com um valor que não existe volta ao padrão, sem derrubar os outros. */
export function sanitizeSettings(input: unknown): AppSettings {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const m = (o.meetings && typeof o.meetings === "object" ? o.meetings : {}) as Record<string, unknown>;
  // Um settings.json de antes do T5349 tem os atalhos nos campos antigos.
  const shortcuts = sanitizeShortcuts(o.shortcuts, { notes: o.notesShortcut, meeting: m.shortcut, meetingPause: m.pauseShortcut });
  return withShortcutMirrors({
    shortcuts,
    notesShortcut: shortcuts.notes,
    pinned: sanitizePinned(o.pinned),
    appearance: sanitizeAppearance(o.appearance),
    templatesFolder: sanitizeTemplatesFolder(o.templatesFolder),
    dailyFolder: "dailyFolder" in o ? sanitizeDailyFolder(o.dailyFolder) : DEFAULT_SETTINGS.dailyFolder,
    attachmentsFolder: "attachmentsFolder" in o ? sanitizeAttachmentsFolder(o.attachmentsFolder) : DEFAULT_ATTACHMENTS_FOLDER,
    savedSearches: sanitizeSavedSearches(o.savedSearches),
    ocr: typeof o.ocr === "boolean" ? o.ocr : true,
    semanticSearch: o.semanticSearch !== false,
    checkUpdates: o.checkUpdates !== false,
    language: isLanguageSetting(o.language) ? o.language : DEFAULT_LANGUAGE,
    microphone: isMicrophoneChoice(o.microphone) ? o.microphone : DEFAULT_MICROPHONE,
    showExtensions: o.showExtensions === true,
    cues: o.cues !== false,
    preciseDictation: o.preciseDictation === true,
    catVoiceProvider: isCatVoiceProvider(o.catVoiceProvider) ? o.catVoiceProvider : DEFAULT_CAT_VOICE_PROVIDER,
    elevenLabsVoiceId: isElevenLabsVoiceId(o.elevenLabsVoiceId) ? o.elevenLabsVoiceId : DEFAULT_ELEVENLABS_VOICE,
    elevenLabsModel: isElevenLabsModel(o.elevenLabsModel) ? o.elevenLabsModel : DEFAULT_ELEVENLABS_MODEL,
    meetings: sanitizeMeetingSettings(o.meetings),
    noteWidth: sanitizeNoteWidth(o.noteWidth),
    agent: sanitizeAgentSettings(o.agent),
    kiwicat: {
      show: !o.kiwicat || typeof o.kiwicat !== "object" || (o.kiwicat as Record<string, unknown>).show !== false,
      overlay: !o.kiwicat || typeof o.kiwicat !== "object" || (o.kiwicat as Record<string, unknown>).overlay !== false,
      cor: o.kiwicat && typeof o.kiwicat === "object" && isCatColorChoice((o.kiwicat as Record<string, unknown>).cor) ? (o.kiwicat as { cor: CatColorChoice }).cor : DEFAULT_CAT_COLOR,
      posicao: o.kiwicat && typeof o.kiwicat === "object" && isCatPosition((o.kiwicat as Record<string, unknown>).posicao) ? (o.kiwicat as { posicao: CatPosition }).posicao : DEFAULT_CAT_POSITION,
      tamanho: catSize(o.kiwicat && typeof o.kiwicat === "object" ? (o.kiwicat as Record<string, unknown>).tamanho : undefined),
      voz: o.kiwicat && typeof o.kiwicat === "object" && isCatVoiceId((o.kiwicat as Record<string, unknown>).voz) ? (o.kiwicat as { voz: CatVoiceId }).voz : DEFAULT_CAT_VOICE,
    },
    firstRun: o.firstRun === "pending" ? "pending" : "done",
  });
}

/** Os campos de antes do T5349 (`notesShortcut`, `meetings.shortcut|pauseShortcut`) repetem os `shortcuts`. */
function withShortcutMirrors(s: AppSettings): AppSettings {
  return {
    ...s,
    notesShortcut: s.shortcuts.notes,
    meetings: { ...s.meetings, shortcut: s.shortcuts.meeting, pauseShortcut: s.shortcuts.meetingPause },
  };
}

export class SettingsStore {
  readonly file: string;

  constructor(dir: string) {
    this.file = path.join(dir, "settings.json");
  }

  async load(): Promise<AppSettings> {
    return sanitizeSettings(await readJson<SettingsFile>(this.file));
  }

  /**
   * Na abertura do app (T20796): sem settings.json e sem nenhum dos `traces` (arquivos que um app já usado deixa, como o
   * permissions.json de quem nunca mexeu nas Configurações), é uma instalação nova, e o arquivo nasce com
   * `firstRun: "pending"`. Na fila, para nenhuma gravação de antes criar o arquivo no meio. Devolve o `firstRun` de agora.
   */
  async beginFirstRun(traces: string[] = []): Promise<AppSettings["firstRun"]> {
    const used = () => [this.file, ...traces].some((f) => existsSync(f));
    const s = await this.update(() => (used() ? null : { firstRun: "pending" }));
    return s.firstRun;
  }

  /** As gravações, uma depois da outra: ler, mesclar e gravar sem outra no meio (o `fixPinned` e a Aparência). */
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * Muda só os campos de `patch` (já validados por quem chama), e da Aparência só os campos dados. Devolve tudo como
   * ficou. Uma por vez: duas trocas rápidas de janelas diferentes não perdem campo (T2503, revisão #2582).
   */
  save(patch: SettingsPatch): Promise<AppSettings> {
    return this.update(() => patch);
  }

  /**
   * Lê, decide e grava na mesma fila (T2639): `change` recebe as configurações de agora (depois de toda gravação que veio
   * antes) e devolve o que mudar, ou null para não gravar. É o caminho das fixadas que seguem a nota (`fixPinned`): ler
   * fora da fila deixava uma fixada nova da janela, gravada no meio, ser trocada pela lista velha.
   */
  update(change: (current: AppSettings) => SettingsPatch | null): Promise<AppSettings> {
    const run = this.queue.then(async () => {
      const current = await this.load();
      const patch = change(current);
      if (!patch) return current;
      // Os atalhos vêm em parte; os campos de antes (o das Notas e os das reuniões) entram neles.
      const shortcuts = { ...current.shortcuts, ...patch.shortcuts };
      if (patch.notesShortcut !== undefined) shortcuts.notes = patch.notesShortcut;
      if (patch.meetings?.shortcut !== undefined) shortcuts.meeting = patch.meetings.shortcut;
      if (patch.meetings?.pauseShortcut !== undefined) shortcuts.meetingPause = patch.meetings.pauseShortcut;
      const next: AppSettings = withShortcutMirrors({
        ...current,
        ...patch,
        appearance: { ...current.appearance, ...patch.appearance },
        meetings: { ...current.meetings, ...patch.meetings },
        shortcuts,
      });
      await writeJson(this.file, { version: 1, ...next } satisfies SettingsFile);
      return next;
    });
    this.queue = run.catch(() => {});
    return run;
  }
}
