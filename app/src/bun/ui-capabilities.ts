import { type NoteModel, noteModelSaved, readNoteModel, writeNoteModel } from "../agent/note-model.ts";
import { statSync } from "node:fs";
import path from "node:path";

import { isSpellingLanguage, isSpellingWord, NO_SPELLING, spellingResult, type SpellingResult } from "../shared/spelling.ts";
// As capacidades do contrato 1.0.0 (src/shared/ui-contract.ts): o único jeito de uma UI do AppEngine pedir algo ao
// main (T1192). Cada handler valida os argumentos e responde `E_BAD_ARGS` quando eles não servem. Nada genérico: não
// há "rodar comando" nem "ler arquivo qualquer".

import type { AppAbout, DictionaryTerm, HistoryEntry, HistoryPage, HubSection, Snippet, UpdatesView,
} from "../shared/ui-contract.ts";
import { CLIPBOARD_MAX_CHARS, UI_CAPABILITIES, type UiCapabilities, type UiCapability,
} from "../shared/ui-contract.ts";
import { aliasWarnings, aliasWarningText } from "../store/aliasCheck.ts";
import { MAX_TERMS, sanitizeTerms } from "../store/dictionary.ts";
import { sanitizeSnippets } from "../store/snippets.ts";
import { NOTE_WIDTH } from "../shared/note-width.ts";
import { isCatColorChoice } from "../shared/kiwicat-colors.ts";
import { type AppSettings, MAX_PINNED, type SettingsPatch,
} from "../store/settings.ts";
import { folderPath, notePath, VaultError } from "../notes/paths.ts";
import { type AttachmentData, type Attachments, attachmentsFolder,
} from "../notes/attachments.ts";
import { openMode } from "../shared/attachments.ts";
import { RemoteImageError } from "../notes/remote-image.ts";
import { type AudioInputs, isMicrophoneChoice } from "../shared/microphone.ts";
import { attachmentHits, type OcrIndex } from "../notes/ocr.ts";
import type { SemanticIndex } from "../notes/semantic/index.ts";
import type { SemanticEngine } from "../notes/semantic/engine.ts";
import { semanticQueryText } from "../shared/query.ts";
import type { PreciseStatus, SemanticStatus } from "../shared/ui-contract.ts";
import { modelBytes } from "../notes/semantic/model.ts";
import { WHISPER_SMALL } from "./precise-dictation.ts";
import { checkShortcutsPatch, isNotesShortcut } from "../shared/shortcuts.ts";
import { type ExternalMoves, followPinned, type Vault,
} from "../notes/vault.ts";
import type { NoteVersions } from "../notes/versions.ts";
import { ExportError, type NoteExporter } from "../notes/export.ts";
import { checkAppearancePatch } from "../shared/appearance.ts";
import { MAX_SAVED_SEARCHES, sanitizeSavedSearches } from "../shared/query.ts";
import type { NotesFolders } from "../notes/folders-workspace.ts";
import { checkMark, followProjects, layoutProblem, mainNoteFor, mapProjects, projectInfo, ProjectsFile, projectStatus } from "../notes/projects.ts";
import { MEETINGS_FOLDER } from "../notes/meetings.ts";
import { folderCapabilities } from "./folder-capabilities.ts";
import type { MeetingNotes } from "../notes/meetings.ts";
import type { ToNoteResult } from "../notes/fromDictation.ts";
import { checkMeetingSettingsPatch, NOT_RECORDING } from "../shared/meetings.ts";
import { listMeetings, type MeetingHost, MeetingHostError } from "./meetings.ts";
import { type AgentService, AgentServiceError } from "../agent/service.ts";
import { ACTIVITY_LIST_MAX } from "../agent/activity.ts";
import { isAgentChoice } from "../store/settings.ts";

/** O que as capacidades usam do app. Nos testes, tudo de mentira. */
export interface CapabilityDeps {
  notesFolders?: NotesFolders;
  /**
   * A pasta das reuniões neste cofre, que não pode ser projeto (spec #9874). Sem ela, `Reuniões` (o cofre interno);
   * `null`: uma pasta de notas escolhida pela pessoa, que não tem pasta de reuniões.
   */
  meetingsFolder?: string | null;
  chooseNotesFolder?(): Promise<string | null>;
  dictionary: { load(): Promise<DictionaryTerm[]>; save(terms: DictionaryTerm[]): Promise<DictionaryTerm[]>;
  };
  snippets: { load(): Promise<Snippet[]>; save(snippets: Snippet[]): Promise<Snippet[]>;
  };
  retryDictation?(id:string):Promise<HistoryEntry>;
  history: {
    search(params: { query?: string; limit?: number; before?: string;
    }): Promise<HistoryPage>;
    delete(id: string): Promise<boolean>;
    get(id: string): Promise<HistoryEntry | null>;
  };
  /** O ditado vira nota (T1320): uma por vez, sem duplicar. */
  meetingNotes?: Pick<MeetingNotes, "speakers" | "renameSpeaker" | "saveEdit">;
  dictationNotes: {
    toNew(text: string, at: Date, id: string): Promise<ToNoteResult>;
    append(path: string, text: string, at: Date, id: string,
    ): Promise<ToNoteResult>;
  };
  /** As Configurações (T1499). */
  /** O `save` mescla a Aparência dada com a que está gravada, uma gravação por vez. */
  settings: {
    load(): Promise<AppSettings>;
    save(patch: SettingsPatch): Promise<AppSettings>;
    /**
     * Ler, decidir e gravar na mesma fila (T2639). Sem ele (stubs de teste), as fixadas caem no `load` + `save`, que
     * podem se atropelar.
     */
    update?(change: (current: AppSettings) => SettingsPatch | null,
    ): Promise<AppSettings>;
  };
  /** O helper passa a vigiar o atalho novo (T1499). */
  settingsChanged?(settings: AppSettings): void;
  /** Os projetos desta pasta de notas mudaram (spec #9847): vira o evento `projects.changed`. */
  projectsChanged?(): void;
  /** Com várias pastas de notas: o mesmo aviso, com a pasta (o `folderId` do evento). */
  projectsChangedIn?(folderId: string): void;
  /** O STT e a limpeza passam a usar o dicionário e os snippets novos já no próximo ditado. */
  dictionaryChanged?(terms: DictionaryTerm[]): void;
  snippetsChanged?(snippets: Snippet[]): void;
  clipboardWrite(text: string): void;
  clipboardRead?(): string | null;
  spelling?(word: string, language?: string): SpellingResult | Promise<SpellingResult>;
  /** A seção pedida para o hub que ainda vai abrir (T2121): devolve e esquece. Sem ela, null. */
  hubSection?(): HubSection | null;
  /** A intro avisou que terminou (T2308): o hub segue. */
  introDone?(): void;
  /**
   * A seção Sobre (T2386): a versão do app, o canal e as atualizações. Sem isto (o headless, os testes), o `app.about`
   * diz "dev" e as atualizações respondem `off`, sem ir à rede.
   */
  /** "Salvar diagnóstico" (T5350). Sem isto (testes), o `diagnostics.save` dá E_NO_DIAGNOSTICS. */
  diagnostics?: { save(): Promise<{ path: string; bytes: number }> };
  about?: {
    info(): Omit<AppAbout, "updates">;
    view(): UpdatesView;
    check(): Promise<UpdatesView>;
    apply(): Promise<UpdatesView>;
  };
  /** O vault das notas (T1316). Aberto na 1ª chamada: o ~/KiwiNotes só nasce quando alguém usa as notas. */
  notes: Pick<
    Vault,
    | "open" | "list" | "get" | "save" | "create" | "rename" | "renameHeading" | "renameTag" | "linkWarnings" | "delete" | "search" | "backlinks" | "resolve"
    | "moveNote" | "duplicate" | "restore" | "locate" | "createFolder" | "moveFolder" | "deleteFolder"
    | "onExternalMoves" | "existing" | "tags" | "templates" | "notesContaining" | "onOtherFiles" | "root"
    | "daily" | "createFromLink" | "unlinkedMentions" | "linkMentions" | "trashList" | "trashEmpty" | "locateFile" | "embed"
    | "getCanvas" | "saveCanvas" | "createCanvas" | "renameCanvas" | "readFile" | "saveFile"
  > &
    // O inode de cada nota (spec #9874): sem ele (os vaults de mentira), o projeto só segue o que o watcher viu.
    Partial<Pick<Vault, "noteInodes">>;
  /**
   * O histórico de versões das notas (T2680), fora do vault. Sem ele (testes antigos), as capacidades `notes.version*`
   * respondem lista vazia e E_NOT_FOUND, e o save não guarda versão.
   */
  versions?: Pick<NoteVersions, "record" | "list" | "get" | "snapshot" | "flush" | "move">;
  /** Exportar nota (T2684). Sem ele, o `notes.export` dá E_NO_EXPORT. */
  exporter?: Pick<NoteExporter, "export">;
  /**
   * A pasta onde o exportar grava: o seletor de pasta do macOS no app, só no clique da pessoa; `KIWI_EXPORT_DIR` no
   * headless e com KIWI_DEBUG. `null`: a pessoa cancelou.
   */
  chooseExportFolder?(): Promise<string | null>;
  /** Abre o Lixo do macOS no Finder (T2593). Sem isto (headless, testes, KIWI_DEBUG), o `trash.reveal` não faz nada. */
  revealTrash?(): void;
  /** O texto dos anexos para a busca (T2709). Sem ele, a busca é só nas notas. */
  ocr?: Pick<OcrIndex, "scan" | "enqueue" | "match">;
  /** A busca pelo sentido desta pasta (T6013). Sem ela, a busca é só pelas palavras, como antes. */
  semantic?: Pick<SemanticIndex, "sync" | "query" | "status" | "clear">;
  /** As notas que o índice do sentido acompanha: o mesmo vault de `notes`. */
  semanticSource?: Pick<Vault, "semanticDocuments" | "onChanged">;
  /** O modo preciso do ditado (T6602), da sessão com o helper. Sem ela, `null`: o status vem só da configuração. */
  precise?(): PreciseStatus | null;
  /** O modelo da busca pelo sentido, um para o app (T6013). */
  semanticEngine?: Pick<SemanticEngine, "state" | "start" | "disable">;
  /** Os anexos das notas (T2594): sem eles (um host antigo), as capacidades `attachments.*` dão E_NO_ATTACHMENTS. */
  attachments?: Pick<Attachments, "save" | "read" | "rename">;
  /** Baixa a imagem de fora depois do clique (T2984). Sem isto, o `images.remote` dá E_NO_REMOTE_IMAGES. */
  remoteImage?(url: string): Promise<AttachmentData>;
  /** As entradas de áudio pelo helper (T3230). Sem isto, ou sem o helper de pé, o `audio.inputs` dá E_NO_HELPER. */
  audioInputs?(): Promise<AudioInputs | null>;
  /**
   * "Aperte o atalho" pelo helper (T5349): o texto do atalho, ou rejeita com o código dele (`cancelled`,
   * `invalid_shortcut`…). Sem isto (o headless, que não tem o tap), o `shortcuts.record` dá E_NO_HELPER.
   */
  shortcuts?: { record(bareKey?: boolean): Promise<string>; cancel(): void };
  /**
   * "Mostrar no Finder" (T2468): o app abre o Finder no caminho absoluto. Sem isto (o headless, os testes, KIWI_DEBUG),
   * o `notes.reveal` só confere que o item existe.
   */
  reveal?(abs: string): void;
  /**
   * Abre um arquivo do vault que não é nota no app padrão do Mac (T3370); `finder` só mostra no Finder (o que não é um
   * tipo de documento conhecido, ou tem o bit de execução: `openMode`). Sem isto (o headless, os testes, KIWI_DEBUG), o `files.open` só confere que o arquivo existe.
   */
  openFile?(abs: string, mode: "app" | "finder"): void;
  /**
   * A gravação de reunião ao vivo (R6, T4947): o estado pelos eventos do helper, parar e pausar o canal "você". Sem
   * isto (testes antigos), `meetings.live` diz que não grava, e parar ou pausar dá E_NO_HELPER.
   */
  meetings?: MeetingHost;
  /** O agente (T8678, spec #8339). Sem ele (testes antigos), as capacidades `agent.*` dão E_NO_AGENT. */
  agent?: AgentService;
  /** Agora, em ms (para o limite de ritmo do clipboard). */
  now?(): number;
}

/** As atualizações sem o Updater por perto (o headless, os testes): nada vai à rede. */
const UPDATES_OFF: UpdatesView = { state: "off", reason: "sem o atualizador no headless e nos testes", lastCheck: null,
};

/** Um erro com código, que o AppEngine passa à UI como está (`E_BAD_ARGS`). */
export class CapabilityError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const bad = (message: string) => new CapabilityError("E_BAD_ARGS", message);

function object(args: unknown, cap: string): Record<string, unknown> {
  if (args === undefined || args === null) return {};
  if (typeof args !== "object" || Array.isArray(args)) throw bad(`${cap}: args must be an object`);
  return args as Record<string, unknown>;
}

function noArgs(args: unknown, cap: string): void {
  const a = object(args, cap);
  if (Object.keys(a).length) throw bad(`${cap}: takes no args`);
}

function list(value: unknown, field: string, max: number): unknown[] {
  if (!Array.isArray(value)) throw bad(`${field} must be an array`);
  if (value.length > max) throw bad(`${field} has more than ${max} items`);
  return value;
}

function optionalString(value: unknown, field: string, max: number,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw bad(`${field} must be a string`);
  if (value.length > max) throw bad(`${field} is longer than ${max}`);
  return value;
}

/** Os handlers do contrato, por nome. O AppEngine recusa (`E_NO_CAPABILITY`) qualquer nome fora daqui. */
/**
 * O disco cheio (T7942): o `ENOSPC` do sistema vira `E_DISK_FULL`, para a janela dizer isso em vez do erro genérico. O
 * AppEngine só passa adiante códigos `E_…`; o `ENOSPC` chegava como `E_FAILED`, com o motivo só na mensagem.
 */
export function diskFull<T extends Record<string, (args: unknown) => unknown>>(handlers: T): T {
  const full = (e: unknown) => {
    const err = e as { code?: unknown; errno?: unknown } | null;
    return err?.code === "ENOSPC" || err?.errno === -28 ? new CapabilityError("E_DISK_FULL", (e as Error).message) : e;
  };
  return Object.fromEntries(Object.entries(handlers).map(([cap, fn]) => [cap, (args: unknown) => {
    try {
      const r = fn(args);
      return r instanceof Promise ? r.catch((e) => { throw full(e); }) : r;
    } catch (e) {
      throw full(e);
    }
  }])) as T;
}

export function uiCapabilities(deps: CapabilityDeps,
): Record<UiCapability, (args: unknown) => Promise<unknown> | unknown> {
  if (deps.notesFolders) return diskFull(folderCapabilities(deps, uiCapabilities));
  const now = deps.now ?? Date.now;
  // O main não vê o clique: a UI só chama no gesto (navigator.userActivation), e aqui vai um limite de ritmo para uma
  // UI que tente encher o clipboard sozinha.
  let lastCopy = -Infinity;

  /**
   * Muda as fixadas a partir da lista de agora, na fila das configurações (T2639): a leitura e a gravação não deixam
   * outra mudança (uma fixada nova da janela, outra correção) entrar no meio. Sem mudança, não grava nem avisa.
   */
  const changePinned = async (change: (pinned: string[]) => string[]) => {
    const same = (a: string[], b: string[]) => a.length === b.length && a.every((p, i) => p === b[i]);
    let changed = false;
    const decide = (current: AppSettings) => {
      const next = change(current.pinned);
      changed = !same(next, current.pinned);
      return changed ? { pinned: next } : null;
    };
    let saved: AppSettings;
    if (deps.settings.update) saved = await deps.settings.update(decide);
    else {
      const patch = decide(await deps.settings.load());
      if (!patch) return;
      saved = await deps.settings.save(patch);
    }
    // Em duas linhas: num `settingsChanged?.(await save())`, sem o listener, o `?.` pula o argumento e nada é salvo.
    if (changed) deps.settingsChanged?.(saved);
  };

  // As fixadas seguem também o que muda por fora (T2559): no 1º uso do vault, sai o que já não existe, e daí em diante
  // um rename feito no Obsidian leva a fixada junto.
  let watchingPins: Promise<void> | null = null;
  const vault = async () => {
    await deps.notes.open();
    watchingPins ??= (async () => {
      deps.notes.onExternalMoves((r) => void followPins(r).catch((e) => console.error("[notes] pinned:", e)),
      );
      // O OCR (T2709): os anexos que mudam por fora, e uma passada em todos na abertura (o cache pula os já lidos).
      if (deps.ocr) {
        const ocr = deps.ocr;
        deps.notes.onOtherFiles((paths) => ocr.enqueue(paths));
        void ocr.scan().catch((e) => console.error("[ocr] scan:", e));
      }
      // A busca pelo sentido (T6013): o índice acompanha as notas, e a fila anda em segundo plano.
      if (deps.semantic && deps.semanticSource) {
        const semantic = deps.semantic;
        const notes = deps.semanticSource;
        semantic.sync(notes.semanticDocuments());
        notes.onChanged(() => semantic.sync(notes.semanticDocuments()));
      }
      // Best effort (revisão #2574): uma limpeza de fixadas que falha (o disco, o settings) nunca derruba as notas.
      await followPins({ moves: new Map(), gone: [] }).catch((e) => console.error("[notes] pinned:", e),
      );
    })();
    await watchingPins;
    return deps.notes;
  };
  const followPins = async (r: ExternalMoves) => {
    // O histórico de versões segue a nota renomeada por fora (T2680), e as fixadas também (T2559).
    await deps.versions?.move((p) => r.moves.get(p) ?? p);
    await changePinned((pinned) => followPinned(pinned, r, deps.notes.existing()),
    );
    // Os projetos também (spec #9874); na abertura (sem `moves`), a nota principal acha a pasta pelo inode.
    await projectsFile().update((list) => followProjects(list, r, deps.notes.existing(), deps.notes.noteInodes?.(), dirIno, meetingsFolder));
  };
  /** O arquivo dos projetos deste cofre (`.kiwi/projects.json`). */
  let projects: ProjectsFile | null = null;
  const projectsFile = () => (projects ??= new ProjectsFile(deps.notes.root, () => deps.projectsChanged?.()));
  /** O inode de uma pasta do cofre (revisão da T10012): um rename a mantém, e é por ele que o projeto segue a pasta. */
  const dirIno = (folder: string): number | undefined => {
    try {
      const st = statSync(path.join(deps.notes.root, folder));
      return st.isDirectory() ? st.ino : undefined;
    } catch {
      return undefined;
    }
  };
  /**
   * Antes de mover uma pasta pelo app (revisão da T10012): um projeto não pode acabar dentro de outro, nem na pasta das
   * reuniões. Recusa antes de mover, com o motivo, em vez de largar um projeto sem a pessoa ver.
   */
  const checkFolderMove = async (from: string, to: string) => {
    const list = await projectsFile().load().catch(() => null);
    if (!list?.length) return;
    const problem = layoutProblem(mapProjects(list, moveUnder(from, to)), meetingsFolder);
    if (problem) throw problem;
  };
  /** A pasta das reuniões neste cofre: só o interno tem uma (`Reuniões`). */
  const meetingsFolder = deps.meetingsFolder === undefined ? MEETINGS_FOLDER : deps.meetingsFolder;
  const projectByFolder = async (folder: unknown, cap: string) => {
    const p = folderPath(folder);
    const e = (await projectsFile().load()).find((x) => x.folder === p);
    if (!e) throw new CapabilityError("E_NOT_FOUND", `${cap}: ${p || "a raiz"} não é um projeto`);
    return e;
  };
  /** Os argumentos de uma capacidade de notas: só os campos conhecidos, para um typo não passar calado. */
  const attachments = () => {
    if (!deps.attachments) throw new CapabilityError("E_NO_ATTACHMENTS", "this host has no attachments",
      );
    return deps.attachments;
  };
  const fields = (args: unknown, cap: string, allowed: string[]) => {
    const a = object(args, cap);
    const extra = Object.keys(a).find((k) => !allowed.includes(k));
    if (extra) throw bad(`${cap}: unknown field ${extra}`);
    return a;
  };

  /**
   * As fixadas seguem a nota ou a pasta (T2468): `map` diz para onde foi cada caminho (null: saiu). Uma pasta movida
   * leva junto as fixadas de dentro dela.
   */
  const fixPinned = async (map: (p: string) => string | null) => {
    await changePinned((pinned) => [...new Set(pinned.map(map).filter((p): p is string => p !== null)),
    ]);
    // Os projetos (spec #9874) seguem o mesmo mapa: a pasta que saiu leva o projeto; a nota principal que saiu o deixa
    // sem ela. Best effort, como a limpeza das fixadas: um `projects.json` estragado nunca desfaz o rename que já
    // aconteceu.
    await projectsFile()
      .update((list) => mapProjects(list, map))
      .catch((e) => console.error("[notes] projects:", e));
  };
  /** A nota (ou a pasta) mudou de lugar pelo app: as fixadas e o histórico de versões vão junto. */
  const followMove = async (map: (p: string) => string) => {
    await deps.versions?.move(map);
    await fixPinned(map);
  };
  /** Parar ou pausar a gravação: só com uma de pé, e o erro do helper vira o código dele. */
  const meetingCall = async (call: (host: MeetingHost) => Promise<void>) => {
    const host = deps.meetings;
    if (!host) throw new CapabilityError("E_NO_HELPER", "no helper to record meetings");
    if (!host.live().recording) throw new CapabilityError("E_NOT_RECORDING", "no meeting is being recorded");
    try {
      await call(host);
    } catch (e) {
      if (e instanceof MeetingHostError) throw new CapabilityError("E_HELPER", e.code);
      throw e;
    }
  };
  /** O agente (T8678): sem ele, E_NO_AGENT; os erros do serviço viram o código deles (`E_AGENT_DISABLED`, `E_ADAPTER_MISSING`…). */
  const agentCall = async <T>(call: (agent: AgentService) => Promise<T>): Promise<T> => {
    const agent = deps.agent;
    if (!agent) throw new CapabilityError("E_NO_AGENT", "no agent in this build");
    try {
      return await call(agent);
    } catch (e) {
      if (e instanceof AgentServiceError) throw new CapabilityError(e.code, e.message);
      throw e;
    }
  };
  const under = (prefix: string, p: string) => p === prefix || p.startsWith(`${prefix}/`);
  const moveUnder = (from: string, to: string) => (p: string) =>
    under(from, p) ? `${to}${p.slice(from.length)}` : p;
  const dropUnder = (gone: string) => (p: string) =>
    under(gone, p) ? null : p;

  const handlers: { [K in UiCapability]: (args: unknown,
    ) => Promise<UiCapabilities[K]["result"]> | UiCapabilities[K]["result"];
  } = {
    "dictionary.get": (args) => {
      noArgs(args, "dictionary.get");
      return deps.dictionary.load();
    },
    "dictionary.set": async (args) => {
      const terms = sanitizeTerms(list(object(args, "dictionary.set").terms, "terms", MAX_TERMS * 2),
      );
      const saved = await deps.dictionary.save(terms);
      deps.dictionaryChanged?.(saved);
      return saved;
    },
    "dictionary.check": (args) => {
      const terms = sanitizeTerms(list(object(args, "dictionary.check").terms, "terms", MAX_TERMS * 2),
      );
      return aliasWarnings(terms).map((w) => ({ ...w, text: aliasWarningText(w),
      }));
    },
    "snippets.get": (args) => {
      noArgs(args, "snippets.get");
      return deps.snippets.load();
    },
    "snippets.set": async (args) => {
      const snippets = sanitizeSnippets(list(object(args, "snippets.set").snippets, "snippets", 2000),
      );
      const saved = await deps.snippets.save(snippets);
      deps.snippetsChanged?.(saved);
      return saved;
    },
    "history.search": (args) => {
      const a = object(args, "history.search");
      const query = optionalString(a.query, "query", 500);
      const before = optionalString(a.before, "before", 128);
      if (a.limit !== undefined && (typeof a.limit !== "number" || !Number.isInteger(a.limit) || a.limit < 1 || a.limit > 500)) {
        throw bad("limit must be an integer from 1 to 500");
      }
      return deps.history.search({ query, before, limit: a.limit as number | undefined,
      });
    },
    "history.retry": async args => {
      const a=fields(args,"history.retry",["id"]);
      const id=optionalString(a.id,"id",128);
      if(!id)throw bad("id is required");
      if(!deps.retryDictation)throw new CapabilityError("E_NO_HELPER","Não há helper para transcrever.");
      return deps.retryDictation(id);
    },
    "history.delete": (args) => {
      const id = optionalString(object(args, "history.delete").id, "id", 128);
      if (!id) throw bad("id is required");
      return deps.history.delete(id);
    },
    "history.toNote": async (args) => {
      const a = fields(args, "history.toNote", ["id", "path"]);
      const id = optionalString(a.id, "id", 128);
      if (!id) throw bad("id is required");
      const path = optionalString(a.path, "path", 1024);
      const entry = await deps.history.get(id);
      if (!entry) throw new CapabilityError("E_NOT_FOUND", `history.toNote: no dictation ${id}`,
        );
      if(!entry.text.trim())throw new CapabilityError("E_NO_TEXT","Transcreva o áudio antes de enviar para uma nota.");
      const at = new Date(entry.at);
      return path ? deps.dictationNotes.append(path, entry.text, at, entry.id) : deps.dictationNotes.toNew(entry.text, at, entry.id);
    },
    "settings.get": (args) => {
      noArgs(args, "settings.get");
      return deps.settings.load();
    },
    "settings.set": async (args) => {
      const a = object(args, "settings.set");
      const patch: SettingsPatch = {};
      let turnSemantic: boolean | null = null;
      // Os atalhos (1.24.0, T5349), também os que vêm nos campos de antes: conferidos juntos no fim, sem conflito.
      const shortcutPatch: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(a)) {
        if (key === "kiwicat") {
          // `show` (o gato do canto) e `overlay` (por cima dos outros apps, spec #9810), cada um sozinho ou os dois: o que
          // não vem fica como está.
          const cat = object(value, "kiwicat");
          const keys = Object.keys(cat);
          // `cor` (spec #9349): só uma das cores prontas ou a do agente; nada de cor livre.
          if (!keys.length || keys.some(k => k !== "show" && k !== "overlay" && k !== "cor") ||
            keys.some(k => (k === "cor" ? !isCatColorChoice(cat[k]) : typeof cat[k] !== "boolean")))
            throw bad("kiwicat.show and kiwicat.overlay must be true or false; kiwicat.cor one of the ready colours");
          const current = (await deps.settings.load()).kiwicat;
          patch.kiwicat = { ...current, ...(cat as Partial<AppSettings["kiwicat"]>) };
        } else if (key === "notesShortcut") {
          if (!isNotesShortcut(value)) throw bad("notesShortcut must be a shortcut, or null");
          shortcutPatch.notes = value;
        } else if (key === "shortcuts") {
          if (!value || typeof value !== "object" || Array.isArray(value)) throw bad("shortcuts must be an object");
          Object.assign(shortcutPatch, value);
        } else if (key === "pinned") {
          patch.pinned = pinnedList(value);
        } else if (key === "appearance") {
          // Só os campos dados (1.8.0, T2503): o resto da Aparência fica como estava.
          const checked = checkAppearancePatch(value);
          if (!checked.ok) throw bad(`settings.set: ${checked.error}`);
          patch.appearance = checked.patch;
        } else if (key === "templatesFolder") {
          // Uma pasta do vault (T2619); a raiz não serve (todas as notas virariam modelo).
          let p: string;
          try {
            p = folderPath(value);
          } catch (e) {
            throw e instanceof VaultError ? new CapabilityError(e.code, `templatesFolder: ${e.message}`) : e;
          }
          if (!p) throw bad("templatesFolder can't be the vault root");
          patch.templatesFolder = p;
        } else if (key === "dailyFolder") {
          let dir: string;
          try {
            dir = folderPath(value);
          } catch (e) {
            throw e instanceof VaultError ? new CapabilityError(e.code, `dailyFolder: ${e.message}`) : e;
          }
          if (!dir) throw bad("dailyFolder must name a folder of the vault");
          patch.dailyFolder = dir;
        } else if (key === "cues") {
          // Os sons de início e de fim (1.32.0, T5833): o helper recebe no `config.set`.
          if (typeof value !== "boolean") throw bad("cues must be true or false");
          patch.cues = value;
        } else if (key === "preciseDictation") {
          // O modo preciso do ditado (1.38.0, T6602): ligar baixa o Whisper small, desligar apaga.
          if (typeof value !== "boolean") throw bad("preciseDictation must be true or false");
          patch.preciseDictation = value;
        } else if (key === "showExtensions") {
          // A extensão na árvore das Notas (1.19.0, T3370).
          if (typeof value !== "boolean") throw bad("showExtensions must be true or false");
          patch.showExtensions = value;
        } else if (key === "noteWidth") {
          // A largura da coluna da nota (1.24.0, T5299): px, dentro dos limites.
          if (typeof value !== "number" || !Number.isFinite(value) || value < NOTE_WIDTH.min || value > NOTE_WIDTH.max) {
            throw bad(`noteWidth must be a number of px from ${NOTE_WIDTH.min} to ${NOTE_WIDTH.max}`);
          }
          patch.noteWidth = Math.round(value);
        } else if (key === "ocr") {
          // O texto dos anexos na busca (T2709): ligar de novo lê o que faltou.
          if (typeof value !== "boolean") throw bad("ocr must be true or false");
          patch.ocr = value;
          if (value) void deps.ocr?.scan().catch(() => {});
        } else if (key === "semanticSearch") {
          // A busca pelo sentido (T6013): desligar apaga o modelo e os vetores; ligar baixa de novo e refaz o índice.
          if (typeof value !== "boolean") throw bad("semanticSearch must be true or false");
          patch.semanticSearch = value;
          turnSemantic = value;
        } else if (key === "attachmentsFolder") {
          // A pasta dos anexos (1.11.0, T2594): relativa ao vault, sem sair dele.
          try {
            patch.attachmentsFolder = attachmentsFolder(value);
          } catch (e) {
            throw bad(`settings.set: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        } else if (key === "savedSearches") {
          // As buscas salvas (T2660): a lista inteira, cada uma com nome e busca.
          if (!Array.isArray(value) || value.length > MAX_SAVED_SEARCHES) throw bad(`savedSearches must be a list of up to ${MAX_SAVED_SEARCHES}`,
            );
          const list = sanitizeSavedSearches(value);
          if (list.length !== value.length) throw bad("savedSearches: each one needs a name and a query, without repeating a query",
            );
          patch.savedSearches = list;
        } else if (key === "meetings") {
          // Os ajustes de reunião (1.21.0, T4947): só os campos dados; o helper recebe no `config.set`.
          const checked = checkMeetingSettingsPatch(value);
          if (!checked.ok) throw bad(`settings.set: ${checked.error}`);
          // Os atalhos das reuniões são `shortcuts.meeting|meetingPause` desde o T5349; o resto, só os campos dados.
          const { shortcut, pauseShortcut, ...rest } = checked.patch;
          if (shortcut !== undefined) shortcutPatch.meeting = shortcut;
          if (pauseShortcut !== undefined) shortcutPatch.meetingPause = pauseShortcut;
          patch.meetings = { ...(await deps.settings.load()).meetings, ...rest };
        } else if (key === "microphone") {
          // Por qual mic o ditado grava (1.18.0, T3230): o helper recebe no `config.set`.
          if (!isMicrophoneChoice(value)) throw bad('microphone must be "auto", "builtin", "system" or "uid:<device UID>"',
            );
          patch.microphone = value;
        } else throw bad(`settings.set: unknown setting ${key}`);
      }
      if (Object.keys(shortcutPatch).length > 0) {
        const current = (await deps.settings.load()).shortcuts;
        const checked = checkShortcutsPatch(current, shortcutPatch);
        if (!checked.ok) throw bad(`settings.set: ${checked.error}`);
        // Inteiros, com os campos de antes iguais a eles: o das Notas e os das reuniões.
        const shortcuts = { ...current, ...checked.patch };
        patch.shortcuts = shortcuts;
        patch.notesShortcut = shortcuts.notes;
        if (patch.meetings) patch.meetings = { ...patch.meetings, shortcut: shortcuts.meeting, pauseShortcut: shortcuts.meetingPause };
        else if ("meeting" in checked.patch || "meetingPause" in checked.patch) {
          patch.meetings = { ...(await deps.settings.load()).meetings, shortcut: shortcuts.meeting, pauseShortcut: shortcuts.meetingPause };
        }
      }
      const saved = await deps.settings.save(patch);
      deps.settingsChanged?.(saved);
      if (turnSemantic === false) {
        await deps.semanticEngine?.disable();
        await deps.semantic?.clear();
      } else if (turnSemantic === true && deps.semantic && deps.semanticSource) {
        await vault();
        deps.semantic.sync(deps.semanticSource.semanticDocuments());
      }
      return saved;
    },
    "hub.section": (args) => {
      noArgs(args, "hub.section");
      return { section: deps.hubSection?.() ?? null };
    },
    "app.about": (args) => {
      noArgs(args, "app.about");
      if (!deps.about) return { version: "dev", channel: "dev", releaseUrl: null, updates: UPDATES_OFF,
        } satisfies AppAbout;
      return { ...deps.about.info(), updates: deps.about.view(),
      } satisfies AppAbout;
    },
    "diagnostics.save": async (args) => {
      noArgs(args, "diagnostics.save");
      if (!deps.diagnostics) throw new CapabilityError("E_NO_DIAGNOSTICS", "Este engine não salva diagnóstico.");
      return deps.diagnostics.save();
    },
    "updates.check": async (args) => {
      noArgs(args, "updates.check");
      return deps.about ? deps.about.check() : UPDATES_OFF;
    },
    "updates.apply": async (args) => {
      noArgs(args, "updates.apply");
      return deps.about ? deps.about.apply() : UPDATES_OFF;
    },
    "intro.done": (args) => {
      noArgs(args, "intro.done");
      deps.introDone?.();
      return true as const;
    },
    "spelling.suggest": async (args) => {
      const o = object(args, "spelling.suggest");
      if (Object.keys(o).some((key) => key !== "word" && key !== "language") || !isSpellingWord(o.word)
          || o.language !== undefined && !isSpellingLanguage(o.language)) throw bad("invalid spelling word or language");
      return spellingResult(await deps.spelling?.(o.word, o.language as string | undefined) ?? NO_SPELLING, o.word);
    },
    "clipboard.read": (args) => {
      noArgs(args, "clipboard.read");
      if (!deps.clipboardRead) throw new CapabilityError("E_UNAVAILABLE", "clipboard read unavailable");
      const text = deps.clipboardRead() ?? "";
      if (text.length > CLIPBOARD_MAX_CHARS) throw bad(`text is longer than ${CLIPBOARD_MAX_CHARS} characters`);
      return text;
    },
    "clipboard.write": (args) => {
      const text = object(args, "clipboard.write").text;
      if (typeof text !== "string") throw bad("text must be a string");
      if (text.length > CLIPBOARD_MAX_CHARS) throw bad(`text is longer than ${CLIPBOARD_MAX_CHARS} characters`);
      const t = now();
      if (t - lastCopy < 300) throw new CapabilityError("E_RATE", "clipboard.write: too soon after the last copy",
        );
      lastCopy = t;
      deps.clipboardWrite(text);
      return true;
    },
    // O vault valida caminho, conteúdo e limites (E_OUTSIDE_VAULT, E_BAD_ARGS); aqui, os campos.
    "notes.folder": () => { throw new CapabilityError("E_NO_FOLDERS","Este engine não troca a pasta das notas."); },
    "notes.openFolder": () => { throw new CapabilityError("E_NO_FOLDERS","Este engine não troca a pasta das notas."); },
    "notes.list": async (args) => {
      noArgs(args, "notes.list");
      return (await vault()).list();
    },
    "meetings.speakers": async (args) => {
      const a = fields(args, "meetings.speakers", ["path"]);
      if (!deps.meetingNotes)
        throw new CapabilityError("E_NO_MEETINGS", "meeting notes unavailable");
      return { speakers: await deps.meetingNotes.speakers(notePath(a.path)) };
    },
    "meetings.renameSpeaker": async (args) => {
      const a = fields(args, "meetings.renameSpeaker", ["path", "from", "to"]);
      if (!deps.meetingNotes)
        throw new CapabilityError("E_NO_MEETINGS", "meeting notes unavailable");
      if (typeof a.from !== "string" || typeof a.to !== "string")
        throw bad("from and to must be strings");
      return deps.meetingNotes.renameSpeaker(notePath(a.path), a.from, a.to);
    },
    "notes.get": async (args) => (await vault()).get(fields(args, "notes.get", ["path"]).path),
    "notes.save": async (args) => {
      const a = fields(args, "notes.save", ["path", "content", "baseVersion",
        "baseContent", "snapshot",
      ]);
      if (a.snapshot !== undefined && typeof a.snapshot !== "boolean") throw bad("snapshot must be true or false");
      const v = await vault();
      // O texto de antes, para a 1ª versão de uma nota sem histórico (T2680).
      const current = deps.versions ? await v.get(a.path).catch(() => undefined) : undefined;
      const before = current?.content;
      if (a.baseContent !== undefined && typeof a.baseContent !== "string")
        throw bad("baseContent must be a string");
      // `snapshot` (1.44.0, spec #8356): o texto de antes vira uma versão agora, sem o intervalo de 2 minutos. É o que
      // o agente usa em cada escrita. Só quando a nota ainda está na versão que vai ser trocada: senão o save não grava.
      if (a.snapshot === true && deps.versions && current && current.version === a.baseVersion)
        await deps.versions.snapshot(current.path, current.content);
      const r =
        deps.meetingNotes &&
        typeof a.path === "string" &&
        typeof a.content === "string" &&
        typeof a.baseVersion === "string"
          ? await deps.meetingNotes.saveEdit(
              a.path,
              a.content,
              a.baseVersion,
              a.baseContent as string | undefined,
            )
          : await v.save(a.path, a.content, a.baseVersion);
      if (r.saved && deps.versions && typeof a.content === "string") {
        await deps.versions.record(r.meta.path,
            "content" in r && typeof r.content === "string"
              ? r.content
              : a.content, before,
          ).catch((e) => console.error("[notes] versions:", e));
      }
      return r;
    },
    "notes.versions": async (args) => {
      const p = notePath(fields(args, "notes.versions", ["path"]).path);
      return { versions: deps.versions ? await deps.versions.list(p) : [] };
    },
    "notes.version": async (args) => {
      const a = fields(args, "notes.version", ["path", "id"]);
      const p = notePath(a.path);
      if (!deps.versions) throw new CapabilityError("E_NOT_FOUND", "no version history");
      try {
        return await deps.versions.get(p, a.id);
      } catch (e) {
        throw new CapabilityError((e as { code?: string }).code ?? "E_FAILED", (e as Error).message,
        );
      }
    },
    "notes.export": async (args) => {
      const a = fields(args, "notes.export", ["path", "format", "theme"]);
      if (!deps.exporter || !deps.chooseExportFolder) throw new CapabilityError("E_NO_EXPORT", "this host can't export");
      const v = await vault();
      // A nota primeiro (que ela existe), e só então o seletor de pasta: um clique numa nota que sumiu não abre diálogo.
      await v.get(a.path);
      const dir = await deps.chooseExportFolder();
      if (!dir) throw new CapabilityError("E_CANCELED", "no folder chosen");
      try {
        return await deps.exporter.export(a.path, a.format, dir, a.theme);
      } catch (e) {
        throw e instanceof ExportError ? new CapabilityError(e.code, e.message) : e;
      }
    },
    "notes.restoreVersion": async (args) => {
      const a = fields(args, "notes.restoreVersion", ["path", "id"]);
      const p = notePath(a.path);
      if (!deps.versions) throw new CapabilityError("E_NOT_FOUND", "no version history");
      const v = await vault();
      await deps.versions.flush(p);
      let old: { content: string };
      try {
        old = await deps.versions.get(p, a.id);
      } catch (e) {
        throw new CapabilityError((e as { code?: string }).code ?? "E_FAILED", (e as Error).message,
        );
      }
      // O de agora vira uma versão antes (para dar para voltar do restaurar), e o restaurado também.
      const current = await v.get(p);
      await deps.versions.snapshot(p, current.content);
      const r = await v.save(p, old.content, current.version);
      if (r.saved) await deps.versions.snapshot(p, old.content);
      return r;
    },
    "notes.create": async (args) => {
      const a = fields(args, "notes.create", ["folder", "title", "content", "template",
      ]);
      return (await vault()).create(a.folder, a.title, a.content ?? "", a.template,
      );
    },
    "notes.rename": async (args) => {
      const a = fields(args, "notes.rename", ["path", "newPath"]);
      const r = await (await vault()).rename(a.path, a.newPath);
      await followMove(moveUnder(notePath(a.path), r.meta.path));
      return r;
    },
    "notes.renameHeading": async (args) => {
      const a = fields(args, "notes.renameHeading", ["path", "offset", "title", "baseVersion"]);
      return (await vault()).renameHeading(a.path, a.offset, a.title, a.baseVersion);
    },
    "notes.renameTag": async (args) => {
      const a = fields(args, "notes.renameTag", ["from", "to"]);
      return (await vault()).renameTag(a.from, a.to);
    },
    "notes.linkWarnings": async (args) => {
      const a = fields(args, "notes.linkWarnings", ["path"]);
      return { warnings: await (await vault()).linkWarnings(a.path) };
    },
    "notes.delete": async (args) => {
      const a = fields(args, "notes.delete", ["path", "baseVersion"]);
      const p = a.path;
      const r = await (await vault()).delete(p, a.baseVersion);
      await fixPinned(dropUnder(notePath(p)));
      return r;
    },
    "notes.move": async (args) => {
      const a = fields(args, "notes.move", ["path", "folder"]);
      const r = await (await vault()).moveNote(a.path, a.folder);
      await followMove(moveUnder(notePath(a.path), r.meta.path));
      return r;
    },
    "notes.duplicate": async (args) => (await vault()).duplicate(fields(args, "notes.duplicate", ["path"]).path),
    "notes.restore": async (args) => (await vault()).restore(fields(args, "notes.restore", ["path"]).path),
    "notes.reveal": async (args) => {
      const abs = await (await vault()).locate(fields(args, "notes.reveal", ["path"]).path);
      deps.reveal?.(abs);
      return true as const;
    },
    "files.open": async (args) => {
      const { abs, mode } = await (await vault()).locateFile(fields(args, "files.open", ["path"]).path);
      deps.openFile?.(abs, openMode(abs, mode));
      return true as const;
    },
    "files.read": async (args) => {
      const a = fields(args, "files.read", ["path", "as"]);
      return (await vault()).readFile(a.path, a.as ?? "binary");
    },
    "files.save": async (args) => {
      const a = fields(args, "files.save", ["path", "content", "baseVersion"]);
      return (await vault()).saveFile(a.path, a.content, a.baseVersion);
    },
    "notes.canvasGet": async (args) => (await vault()).getCanvas(fields(args, "notes.canvasGet", ["path"]).path),
    "notes.canvasSave": async (args) => {
      const a = fields(args, "notes.canvasSave", ["path", "content", "baseVersion"]);
      return (await vault()).saveCanvas(a.path, a.content, a.baseVersion);
    },
    "notes.canvasCreate": async (args) => {
      const a = fields(args, "notes.canvasCreate", ["folder", "title", "content"]);
      return (await vault()).createCanvas(a.folder, a.title, a.content);
    },
    "notes.canvasRename": async (args) => {
      const a = fields(args, "notes.canvasRename", ["from", "to"]);
      return (await vault()).renameCanvas(a.from, a.to);
    },
    "notes.daily": async (args) => {
      const a = fields(args, "notes.daily", ["date"]);
      return (await vault()).daily(a.date, (await deps.settings.load()).dailyFolder,
      );
    },
    "notes.createFromLink": async (args) => {
      const a = fields(args, "notes.createFromLink", ["link", "from"]);
      return (await vault()).createFromLink(a.link, a.from);
    },
    "notes.unlinkedMentions": async (args) => (await vault()).unlinkedMentions(fields(args, "notes.unlinkedMentions", ["path"]).path,
      ),
    "notes.linkMentions": async (args) => {
      const a = fields(args, "notes.linkMentions", ["path", "target"]);
      return (await vault()).linkMentions(a.path, a.target);
    },
    "trash.list": async (args) => {
      noArgs(args, "trash.list");
      return (await vault()).trashList();
    },
    "trash.empty": async (args) => {
      noArgs(args, "trash.empty");
      return (await vault()).trashEmpty();
    },
    "trash.reveal": (args) => {
      noArgs(args, "trash.reveal");
      deps.revealTrash?.();
      return true as const;
    },
    "folders.create": async (args) => (await vault()).createFolder(fields(args, "folders.create", ["path"]).path,
      ),
    "folders.rename": async (args) => {
      const a = fields(args, "folders.rename", ["path", "newPath"]);
      const v = await vault();
      await checkFolderMove(folderPath(a.path), folderPath(a.newPath));
      const r = await v.moveFolder(a.path, a.newPath);
      await followMove(moveUnder(folderPath(a.path), r.path));
      return r;
    },
    "folders.move": async (args) => {
      const a = fields(args, "folders.move", ["path", "parent"]);
      const from = folderPath(a.path);
      const parent = folderPath(a.parent ?? "");
      const name = from.split("/").at(-1) ?? "";
      const v = await vault();
      await checkFolderMove(from, parent ? `${parent}/${name}` : name);
      const r = await v.moveFolder(from, parent ? `${parent}/${name}` : name);
      await followMove(moveUnder(from, r.path));
      return r;
    },
    "folders.delete": async (args) => {
      const p = folderPath(fields(args, "folders.delete", ["path"]).path);
      const r = await (await vault()).deleteFolder(p);
      await fixPinned(dropUnder(p));
      return r;
    },
    "projects.list": async (args) => {
      fields(args, "projects.list", []);
      const v = await vault();
      const { notes } = await v.list();
      return { projects: (await projectsFile().load()).map((e) => projectInfo(e, notes)), meetingsFolder };
    },
    "projects.mark": async (args) => {
      const a = fields(args, "projects.mark", ["folder"]);
      if (typeof a.folder !== "string") throw bad("projects.mark: folder must be a string");
      const folder = folderPath(a.folder);
      const v = await vault();
      let created = false;
      const list = await projectsFile().update(async (list) => {
        if (list.some((e) => e.folder === folder)) return list;
        checkMark(folder, list, v.existing().folders, meetingsFolder);
        let main = mainNoteFor(folder);
        // Sem a nota com o nome da pasta, ela nasce só com o título; nenhuma outra nota muda.
        if (!v.existing().notes.has(main)) {
          const name = main.slice(folder.length + 1, -3);
          main = (await v.create(folder, name, `# ${name}\n`)).path;
          created = true;
        }
        const ino = v.noteInodes?.().get(main);
        const fino = dirIno(folder);
        return [...list, { folder, main, ...(ino !== undefined ? { mainIno: ino } : {}), ...(fino !== undefined ? { folderIno: fino } : {}) }];
      });
      const e = list.find((x) => x.folder === folder)!;
      return { project: projectInfo(e, (await v.list()).notes), created };
    },
    "projects.unmark": async (args) => {
      const a = fields(args, "projects.unmark", ["folder"]);
      await vault();
      const e = await projectByFolder(a.folder, "projects.unmark");
      await projectsFile().update((list) => list.filter((x) => x.folder !== e.folder));
      return true as const;
    },
    "projects.setMain": async (args) => {
      const a = fields(args, "projects.setMain", ["folder", "note"]);
      const v = await vault();
      const e = await projectByFolder(a.folder, "projects.setMain");
      const note = notePath(a.note);
      if (!note.startsWith(`${e.folder}/`)) throw bad(`projects.setMain: ${note} não fica dentro de ${e.folder}`);
      if (!v.existing().notes.has(note)) throw new CapabilityError("E_NOT_FOUND", `projects.setMain: a nota ${note} não existe`);
      const ino = v.noteInodes?.().get(note);
      const list = await projectsFile().update((list) =>
        list.map((x) => (x.folder !== e.folder ? x : { ...x, main: note, ...(ino !== undefined ? { mainIno: ino } : { mainIno: undefined }) })),
      );
      return { project: projectInfo(list.find((x) => x.folder === e.folder)!, (await v.list()).notes) };
    },
    "projects.status": async (args) => {
      const a = fields(args, "projects.status", ["folder"]);
      const v = await vault();
      const e = await projectByFolder(a.folder, "projects.status");
      return projectStatus(e, (await v.list()).notes, async (p) => (await v.get(p)).content);
    },
    "notes.search": async (args) => {
      const a = fields(args, "notes.search", ["query", "limit"]);
      const v = await vault();
      // O sentido só com o modelo já carregado e a busca ligada: a busca nunca espera o download (T6013).
      const text = typeof a.query === "string" && a.query.length <= 500 ? semanticQueryText(a.query) : "";
      const semantic = deps.semantic && text && (await deps.settings.load()).semanticSearch
        ? await deps.semantic.query(text, 50).catch((e) => {
          console.error("[semantic] query:", e);
          return undefined;
        })
        : undefined;
      const hits = v.search(a.query, a.limit, semantic);
      // O texto das imagens e dos PDFs (T2709) completa a lista, depois do que achou nas notas.
      if (!deps.ocr || !(await deps.settings.load()).ocr) return hits;
      const max = typeof a.limit === "number" ? a.limit : 20;
      if (hits.length >= max) return hits;
      // O exato antes do aproximado (T2966), nas notas e nos anexos juntos; o resto da ordem fica como veio.
      const all = [...hits, ...(await attachmentHits(deps.ocr, v, a.query as string, hits, max)),
      ];
      return [...all.filter((h) => !h.approx), ...all.filter((h) => h.approx)];
    },
    "notes.semanticStatus": async (args): Promise<SemanticStatus> => {
      noArgs(args, "notes.semanticStatus");
      const enabled = (await deps.settings.load()).semanticSearch;
      if (!deps.semanticEngine || !deps.semantic) return { enabled, phase: "off", notes: 0, indexed: 0 };
      await vault();
      if (enabled) void deps.semanticEngine.start();
      return { enabled, ...deps.semanticEngine.state(), ...deps.semantic.status() };
    },
    "dictation.preciseStatus": async (args): Promise<PreciseStatus> => {
      noArgs(args, "dictation.preciseStatus");
      const live = deps.precise?.();
      if (live) return live;
      // Sem o helper de pé (ou sem sessão, no headless sem helper): só o que a configuração diz.
      const enabled = (await deps.settings.load()).preciseDictation;
      return { enabled, phase: enabled ? "waiting" : "off", size: modelBytes(WHISPER_SMALL) };
    },
    "notes.backlinks": async (args) => (await vault()).backlinks(fields(args, "notes.backlinks", ["path"]).path),
    "notes.resolve": async (args) => (await vault()).resolve(fields(args, "notes.resolve", ["link"]).link),
    "notes.embed": async (args) => (await vault()).embed(fields(args, "notes.embed", ["link"]).link),
    "notes.tags": async (args) => {
      noArgs(args, "notes.tags");
      return { tags: (await vault()).tags() };
    },
    "notes.templates": async (args) => {
      noArgs(args, "notes.templates");
      const folder = (await deps.settings.load()).templatesFolder;
      return { folder, templates: (await vault()).templates(folder) };
    },
    "attachments.save": async (args) => {
      const a = fields(args, "attachments.save", ["name", "data"]);
      await vault();
      return attachments().save(a.name, a.data);
    },
    "attachments.read": async (args) => {
      const a = fields(args, "attachments.read", ["link"]);
      await vault();
      return attachments().read(a.link);
    },
    "attachments.rename": async (args) => {
      const a = fields(args, "attachments.rename", ["path", "newPath"]);
      await vault();
      return attachments().rename(a.path, a.newPath);
    },
    "images.remote": async (args) => {
      const a = fields(args, "images.remote", ["url"]);
      if (!deps.remoteImage) throw new CapabilityError("E_NO_REMOTE_IMAGES", "this host does not load remote images",
        );
      try {
        const url = optionalString(a.url, "url", 8192);
        if (!url) throw bad("images.remote: url is required");
        return await deps.remoteImage(url);
      } catch (e) {
        if (e instanceof RemoteImageError) throw new CapabilityError(e.code, e.message);
        throw e;
      }
    },
    "shortcuts.record": async (args) => {
      // `bareKey` (1.27.0): gravando o cancelar do ditado, onde uma tecla nomeada sozinha (⌫, ↩) também vale.
      const a = object(args ?? {}, "shortcuts.record");
      for (const k of Object.keys(a)) if (k !== "bareKey") throw bad(`shortcuts.record: unknown field ${k}`);
      if (a.bareKey !== undefined && typeof a.bareKey !== "boolean") throw bad("shortcuts.record: bareKey must be true or false");
      if (!deps.shortcuts) throw new CapabilityError("E_NO_HELPER", "shortcuts.record needs the helper's keyboard tap");
      try {
        return { shortcut: await deps.shortcuts.record(a.bareKey === true) };
      } catch (e) {
        const code = e instanceof Error ? e.message : String(e);
        if (code === "cancelled" || code === "aborted") throw new CapabilityError("E_CANCELLED", "shortcuts.record: cancelled");
        if (code === "invalid_shortcut") throw bad("shortcuts.record: that is not a shortcut (a plain letter, or ⇧ and a letter)");
        throw new CapabilityError("E_NO_HELPER", `shortcuts.record: ${code}`);
      }
    },
    "shortcuts.cancelRecord": (args) => {
      noArgs(args, "shortcuts.cancelRecord");
      deps.shortcuts?.cancel();
      return {};
    },
    "audio.inputs": async (args) => {
      noArgs(args, "audio.inputs");
      const got = await deps.audioInputs?.();
      if (!got) throw new CapabilityError("E_NO_HELPER", "the helper is not running, or does not list audio inputs",
        );
      return got;
    },
    "meetings.list": async (args) => {
      noArgs(args, "meetings.list");
      // "Gravando" é só a da gravação de agora (T7938), não toda nota sem `end`.
      const live = deps.meetings?.live() ?? NOT_RECORDING;
      return { meetings: await listMeetings(await vault(), live.recording ? live.session : null) };
    },
    "meetings.live": (args) => {
      noArgs(args, "meetings.live");
      return deps.meetings?.live() ?? NOT_RECORDING;
    },
    "meetings.stop": async (args) => {
      noArgs(args, "meetings.stop");
      await meetingCall((host) => host.stop());
      return true as const;
    },
    "meetings.pauseMine": async (args) => {
      const paused = fields(args, "meetings.pauseMine", ["paused"]).paused;
      if (typeof paused !== "boolean") throw bad("meetings.pauseMine: paused must be true or false");
      await meetingCall((host) => host.setMinePaused(paused));
      return true as const;
    },
    // O agente (1.41.0, T8678): sem tela ainda; nada liga, baixa nem pede sozinho.
    "agent.status": (args) => {
      const a = object(args, "agent.status");
      const extra = Object.keys(a).filter((k) => k !== "refresh");
      if (extra.length) throw bad(`agent.status: unknown arg ${extra[0]}`);
      if (a.refresh !== undefined && typeof a.refresh !== "boolean") throw bad("agent.status: refresh must be true or false");
      return agentCall((agent) => agent.status(a.refresh === true));
    },
    "agent.enable": (args) => {
      const a = object(args, "agent.enable");
      const extra = Object.keys(a).filter((k) => k !== "consent");
      if (extra.length) throw bad(`agent.enable: unknown arg ${extra[0]}`);
      if (a.consent !== undefined && typeof a.consent !== "boolean") throw bad("agent.enable: consent must be true or false");
      return agentCall((agent) => agent.enable(a.consent === true));
    },
    "agent.disable": (args) => {
      noArgs(args, "agent.disable");
      return agentCall((agent) => agent.disable());
    },
    "agent.download": (args) => {
      noArgs(args, "agent.download");
      return agentCall((agent) => agent.startDownload());
    },
    "agent.ask": (args) => {
      const { text } = fields(args, "agent.ask", ["text"]);
      if (typeof text !== "string") throw bad("agent.ask: text must be a string");
      return agentCall((agent) => agent.ask(text));
    },
    "agent.cancel": (args) => {
      noArgs(args, "agent.cancel");
      return agentCall((agent) => agent.cancel());
    },
    "agent.remove": (args) => {
      noArgs(args, "agent.remove");
      return agentCall((agent) => agent.remove());
    },
    "agent.configure": (args) => {
      const a = object(args, "agent.configure");
      const extra = Object.keys(a).filter((k) => k !== "model" && k !== "effort" && k !== "economy" && k !== "controlShortcut" && k !== "meetings" && k !== "summary" && k !== "instructions");
      if (extra.length) throw bad(`agent.configure: unknown arg ${extra[0]}`);
      for (const k of ["model", "effort"] as const) {
        if (a[k] !== undefined && !isAgentChoice(a[k])) throw bad(`agent.configure: ${k} must be an option id (letters, digits, dot, dash)`);
      }
      if (a.economy !== undefined && typeof a.economy !== "boolean") throw bad("agent.configure: economy must be true or false");
      if (a.controlShortcut !== undefined && typeof a.controlShortcut !== "boolean") throw bad("agent.configure: controlShortcut must be a boolean");
      if (a.meetings !== undefined && (!a.meetings || typeof a.meetings !== "object" || Array.isArray(a.meetings))) throw bad("agent.configure: meetings must be an object");
      if (a.summary !== undefined && (!a.summary || typeof a.summary !== "object" || Array.isArray(a.summary))) throw bad("agent.configure: summary must be an object");
      if (a.instructions !== undefined && (typeof a.instructions !== "string" || a.instructions.length > 2000))
        throw bad("agent.configure: instructions must be a text up to 2000 characters");
      return agentCall((agent) =>
        agent.configure({
          model: a.model as string | undefined,
          effort: a.effort as string | undefined,
          economy: a.economy as boolean | undefined,
          ...(a.controlShortcut !== undefined ? { controlShortcut: a.controlShortcut as boolean } : {}),
          ...(a.meetings !== undefined ? { meetings: a.meetings } : {}),
          ...(a.summary !== undefined ? { summary: a.summary } : {}),
          ...(a.instructions !== undefined ? { instructions: a.instructions as string } : {}),
        }),
      );
    },
    "agent.activity": (args) => {
      const a = object(args, "agent.activity");
      const extra = Object.keys(a).filter((k) => k !== "limit");
      if (extra.length) throw bad(`agent.activity: unknown arg ${extra[0]}`);
      if (a.limit !== undefined && (typeof a.limit !== "number" || !Number.isInteger(a.limit) || a.limit < 1 || a.limit > ACTIVITY_LIST_MAX))
        throw bad(`agent.activity: limit must be an integer from 1 to ${ACTIVITY_LIST_MAX}`);
      return agentCall(async (agent) => ({ requests: await agent.activityLog(a.limit as number | undefined) }));
    },
    "agent.undo": (args) => {
      const a = fields(args, "agent.undo", ["request", "change"]);
      if (typeof a.request !== "string" || !a.request) throw bad("agent.undo: request must be the id of a request");
      if (a.change !== undefined && (!Number.isInteger(a.change) || (a.change as number) < 1))
        throw bad("agent.undo: change must be an integer from 1");
      return agentCall((agent) => agent.undo(a.request as string, a.change as number | undefined));
    },
    // A pergunta na dúvida (spec #9873): o cartão, a resposta, a lista do que já foi respondido e o esquecer.
    "agent.question": (args) => {
      noArgs(args, "agent.question");
      return agentCall(async (agent) => agent.question());
    },
    "agent.answer": (args) => {
      const a = fields(args, "agent.answer", ["card", "request", "fingerprint", "answer", "all"]);
      for (const k of ["card", "request", "fingerprint"] as const)
        if (a[k] !== undefined && (typeof a[k] !== "string" || !a[k])) throw bad(`agent.answer: ${k} must be a string`);
      if (a.answer !== undefined && a.answer !== "send" && a.answer !== "hold") throw bad('agent.answer: answer must be "send" or "hold"');
      if (a.all !== undefined && a.all !== "hold") throw bad('agent.answer: all must be "hold"');
      return agentCall((agent) => agent.answerDoubt(a as Parameters<typeof agent.answerDoubt>[0]));
    },
    "agent.answers": (args) => {
      noArgs(args, "agent.answers");
      return agentCall(async (agent) => ({ answers: agent.answersList() }));
    },
    "agent.forget": (args) => {
      const a = fields(args, "agent.forget", ["fingerprint"]);
      if (typeof a.fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(a.fingerprint)) throw bad("agent.forget: fingerprint must be a fingerprint");
      return agentCall(async (agent) => agent.forgetAnswer(a.fingerprint as string));
    },
    "agent.notice": (args) => {
      noArgs(args, "agent.notice");
      return agentCall((agent) => agent.noticeState());
    },
    "agent.noticeAllow": (args) => {
      noArgs(args, "agent.noticeAllow");
      return agentCall((agent) => agent.noticeAllow());
    },
    "agent.noticeSet": (args) => {
      const a = fields(args, "agent.noticeSet", ["enabled"]);
      if (typeof a.enabled !== "boolean") throw bad("agent.noticeSet: enabled must be true or false");
      return agentCall((agent) => agent.noticeSet(a.enabled as boolean));
    },
    "agent.usage": (args) => {
      noArgs(args, "agent.usage");
      return agentCall(async (agent) => agent.usageView());
    },
    "agent.usageRefresh": (args) => {
      noArgs(args, "agent.usageRefresh");
      return agentCall((agent) => agent.usageRefresh());
    },
    "agent.usageClear": (args) => {
      noArgs(args, "agent.usageClear");
      return agentCall(async (agent) => agent.usageClear());
    },
    // O Modelo de nota (spec #11102): um arquivo legível do cofre. Gravar não reescreve nenhuma nota.
    "agent.noteModel": async (args) => {
      noArgs(args, "agent.noteModel");
      return { model: readNoteModel(deps.notes.root), saved: noteModelSaved(deps.notes.root) };
    },
    "agent.noteModelSet": async (args) => {
      const a = fields(args, "agent.noteModelSet", ["model"]);
      if (!a.model || typeof a.model !== "object") throw bad("agent.noteModelSet: model must be an object");
      return writeNoteModel(deps.notes.root, a.model as NoteModel);
    },
    // A reunião vira nota do projeto (spec #8360): a proposta só se escreve no [Aplicar] da pessoa.
    "agent.proposals": (args) => {
      noArgs(args, "agent.proposals");
      return agentCall(async (agent) => ({ proposals: await agent.proposalsList() }));
    },
    "agent.proposal": (args) => {
      const a = fields(args, "agent.proposal", ["id"]);
      if (typeof a.id !== "string" || !a.id) throw bad("agent.proposal: id must be the id of a proposal");
      return agentCall((agent) => agent.proposalView(a.id as string));
    },
    "agent.proposalChoose": (args) => {
      const a = fields(args, "agent.proposalChoose", ["id", "folder"]);
      if (typeof a.id !== "string" || !a.id) throw bad("agent.proposalChoose: id must be the id of a proposal");
      if (a.folder !== null && (typeof a.folder !== "string" || !a.folder)) throw bad("agent.proposalChoose: folder must be a project folder or null");
      return agentCall((agent) => agent.proposalChoose(a.id as string, a.folder as string | null));
    },
    "agent.proposalApply": (args) => {
      const a = fields(args, "agent.proposalApply", ["id"]);
      if (typeof a.id !== "string" || !a.id) throw bad("agent.proposalApply: id must be the id of a proposal");
      return agentCall((agent) => agent.proposalApply(a.id as string));
    },
    "agent.proposalPrepare": (args) => {
      const a = fields(args, "agent.proposalPrepare", ["id"]);
      if (typeof a.id !== "string" || !a.id) throw bad("agent.proposalPrepare: id must be the id of a proposal");
      return agentCall((agent) => agent.proposalPrepare(a.id as string));
    },
    "agent.proposalDiscard": (args) => {
      const a = fields(args, "agent.proposalDiscard", ["id"]);
      if (typeof a.id !== "string" || !a.id) throw bad("agent.proposalDiscard: id must be the id of a proposal");
      return agentCall((agent) => agent.proposalDiscard(a.id as string));
    },
    // A memória do agente (spec #11469): o que ele sabe sobre a pessoa, no cofre.
    "agent.memory": (args) => {
      noArgs(args, "agent.memory");
      return agentCall((agent) => agent.memoryView());
    },
    "agent.memoryUndo": (args) => {
      const a = fields(args, "agent.memoryUndo", ["id"]);
      if (typeof a.id !== "string" || !a.id) throw bad("agent.memoryUndo: id must be the id of a memory change");
      return agentCall((agent) => agent.memoryUndo(a.id as string));
    },
    "agent.memorySet": (args) => {
      const a = fields(args, "agent.memorySet", ["facts"]);
      if (!Array.isArray(a.facts) || a.facts.some((f) => typeof f !== "string")) throw bad("agent.memorySet: facts must be a list of texts");
      return agentCall((agent) => agent.memorySet(a.facts));
    },
    "agent.memoryClear": (args) => {
      noArgs(args, "agent.memoryClear");
      return agentCall((agent) => agent.memoryClear());
    },
    "agent.change": (args) => {
      const a = fields(args, "agent.change", ["request", "change"]);
      if (typeof a.request !== "string" || !a.request) throw bad("agent.change: request must be the id of a request");
      if (!Number.isInteger(a.change) || (a.change as number) < 1) throw bad("agent.change: change must be an integer from 1");
      return agentCall((agent) => agent.changeView(a.request as string, a.change as number));
    },
  };
  // A lista do contrato e os handlers andam juntos.
  for (const cap of UI_CAPABILITIES) if (!handlers[cap]) throw new Error(`no handler for ${cap}`);
  return diskFull(handlers);
}

export type { HistoryEntry };

/** O `pinned` do `settings.set`: caminhos de nota ou pasta do vault, sem repetir, até `MAX_PINNED`. */
function pinnedList(value: unknown): string[] {
  if (!Array.isArray(value)) throw bad("pinned must be a list of note or folder paths");
  if (value.length > MAX_PINNED) throw bad(`pinned has more than ${MAX_PINNED} items`);
  const out: string[] = [];
  for (const v of value) {
    let p: string;
    try {
      p = typeof v === "string" && /\.md$/i.test(v) ? notePath(v) : folderPath(v);
    } catch (e) {
      throw e instanceof VaultError ? new CapabilityError(e.code, `pinned: ${e.message}`) : e;
    }
    if (!p) throw bad("pinned can't hold the vault root");
    if (!out.includes(p)) out.push(p);
  }
  return out;
}
