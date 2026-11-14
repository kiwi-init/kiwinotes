import type { NoteModel } from "./note-model.ts";
import type { SummarySettings } from "./summary-settings.ts";
import type { LinkWarning, RefactorResult } from "../notes/refactor.ts";
import type { SpellingResult } from "./spelling.ts";
// O contrato entre o engine do Kiwi Notes (o main em Bun) e as UIs do AppEngine (T1192, ADR 0006).
//
// Uma UI só chama o main por `engine.invoke(cap, args)` com um destes nomes. Os nomes são estáveis: tirar ou mudar
// um é versão major (2.0.0); acrescentar é minor (1.1.0), e a UI testa com `engine.has(cap)`. Só dados locais: nada
// aqui sai do Mac.

import type { AliasWarning } from "../store/aliasCheck.ts";
import type { DictionaryTerm } from "../store/dictionary.ts";
import type { HistoryEntry, HistoryPage } from "../store/history.ts";
import type { AgentMeetingSettings, AppSettings } from "../store/settings.ts";
import type { Snippet } from "../store/snippets.ts";
import type { TagNode } from "./tags.ts";
import type { Backlink, CanvasFile, CanvasSaveResult, FileContent, FileSaveResult, FolderNode, Note, NoteMeta, SaveResult, SearchHit, TrashItem, VaultFile,
} from "../notes/vault.ts";
import type { AttachmentData, SavedAttachment } from "../notes/attachments.ts";
import type { AudioInputs } from "./microphone.ts";
import type { FolderView, OpenFolderResult } from "../notes/folders-workspace.ts";
import type { MeetingLive, MeetingNote, MeetingSettings } from "./meetings.ts";
import type { ProjectInfo, ProjectStatus } from "../notes/projects.ts";

export type { AppSettings };
export { NOTES_SHORTCUTS, type NotesShortcut } from "./shortcuts.ts";
export {
  conflictOf, DEFAULT_SHORTCUTS, isShortcutFor, matchesKeyEvent, SHORTCUTS, shortcutDef, shortcutLabel,
  type ShortcutDef, type ShortcutId, type Shortcuts,
} from "./shortcuts.ts";
import type { Shortcuts } from "./shortcuts.ts";
export type { TagNode };
export type { MeetingLive, MeetingNote };
export { MEETING_PAUSE_SHORTCUTS, MEETING_SHORTCUTS, DEFAULT_MEETING_APPS, type MeetingAppEntry, type MeetingSettings } from "./meetings.ts";
/** A busca pelo sentido (T6013): o estado do modelo e do índice da pasta aberta. */
export interface SemanticStatus {
  enabled: boolean;
  phase: "off" | "idle" | "downloading" | "loading" | "ready" | "error";
  /** Bytes baixados e o total, enquanto baixa. */
  done?: number;
  total?: number;
  error?: string;
  notes: number;
  indexed: number;
}
/** O modo preciso do ditado (T6602): o Whisper small, baixado quando a pessoa liga. */
export interface PreciseStatus {
  enabled: boolean;
  /** `waiting`: o modelo está baixado, e vai para o helper quando ele estiver de pé. */
  phase: "off" | "downloading" | "loading" | "ready" | "waiting" | "error";
  /** Bytes baixados e o total, enquanto baixa. */
  done?: number;
  total?: number;
  /** O que falhou: o download, a carga no helper ou o helper que recusou o modelo. */
  error?: "download" | "load" | "helper";
  /** O tamanho do modelo, em bytes. */
  size: number;
}
/** O embed de uma nota (T6594): o pedaço que aparece, ou o fragmento que falta. */
export type NoteEmbed =
  | { path: string; title: string; kind: "note" | "heading" | "block"; content: string }
  | { path: string; title: string; missing: string };
export type { AliasWarning, Backlink, DictionaryTerm, FolderNode, HistoryEntry, HistoryPage, Note, NoteMeta, SaveResult, SearchHit, Snippet, TrashItem };

/** A versão do contrato que este engine implementa (semver estrito). */
// 1.1.0 (T1316): as capacidades `notes.*` e o evento `notes.changed`, só acréscimos.
// 1.2.0 (T1320): `history.toNote`, o ditado vira nota. Só acréscimo.
// 1.3.0 (T1499): `settings.get|set`, com o atalho da janela Notas. Só acréscimo.
// 1.4.0 (T2121): o hub, a janela principal (#2100): `hub.section` e o evento `hub.navigate`. Só acréscimo.
// 1.5.0 (T2308): a janela `intro` e o `intro.done`. Só acréscimo.
// 1.6.0 (T2386): a seção Sobre do hub: `app.about`, `updates.check`, `updates.apply` e o evento `updates.status`. Só acréscimo.
// 1.7.0 (T2468): as pastas (`folders.*`), `notes.move|duplicate|restore|reveal`, o `tree` no `notes.list`, o `ctime` no
//   `NoteMeta` e o `pinned` nas settings. O `notes.delete` passa a esperar 10 min antes da Lixeira (o "Desfazer"). Só
//   acréscimo.
// 1.8.0 (T2503): a Aparência em `AppSettings.appearance` (o `settings.set` aceita só parte dela) e o evento
//   `settings.changed`, que vai a todas as janelas. Só acréscimo.
// 1.9.0 (T2619): as tags (`notes.tags`, `tag:` no `notes.search`), os modelos (`notes.templates`, o `template` do
//   `notes.create`) e o `templatesFolder` nas settings. Só acréscimo.
// 1.10.0 (T2593): a nota do dia (`notes.daily`, `dailyFolder` nas settings), `notes.createFromLink`, "Mencionada sem
//   link" (`notes.unlinkedMentions|linkMentions`) e a Lixeira (`trash.list|empty|reveal`). Só acréscimo.
// 1.11.0 (T2594): os anexos (`attachments.save|read|rename`) e a `attachmentsFolder` nas settings. Só acréscimo.
// 1.12.0 (T2660): a busca com filtros no `notes.search` ("frase", path:, - para excluir) e as `savedSearches` nas
//   settings. Só acréscimo.
// 1.13.0 (T2709): o `ocr` nas settings, e o `notes.search` acha também o texto das imagens e dos PDFs anexados (o
//   trecho diz "na imagem foto.png: …"). Só acréscimo.
// 1.14.0 (T2680): o histórico de versões das notas, fora do vault (`notes.versions|version|restoreVersion`). Só
//   acréscimo.
// 1.15.0 (T2684): exportar nota (`notes.export`) em Markdown com os anexos, em HTML com o tema e em PDF. Só acréscimo.
// 1.16.0 (T2966): o `notes.search` aceita erro de digitação nas palavras soltas (1 em 4+ letras, 2 em 7+), no texto
//   das notas e dos anexos; o `SearchHit` achado assim vem com `approx: true`, e o exato vem antes. Só acréscimo.
// 1.17.0 (T2984): a imagem de fora de uma nota pelo engine (`images.remote` → `data:`), só depois do clique. Só acréscimo.
// 1.18.0 (T3230): o `microphone` nas settings (por qual mic o ditado grava, spec #3202), o `audio.inputs` (as entradas
//   que o helper vê) e o evento `audio.inputs.changed`. Só acréscimo.
// 1.19.0 (T3344): o `audio.inputs` diz também por qual mic o ditado gravaria agora (`using`: a tampa fechada, um salvo
//   desconectado). Só acréscimo.
// 1.20.0 (T3370): a árvore com todos os arquivos (`files` no `notes.list`), o `files.open` (no app padrão do Mac, só
//   com o clique da pessoa), o evento `files.changed` e o `showExtensions` nas settings. Só acréscimo.
// 1.21.0 (T4947): a aba Reuniões do hub (R6, #198): `meetings.list`, `meetings.live`, `meetings.stop`,
//   `meetings.pauseMine`, o evento `meetings.live` e os `meetings` nas settings. Só acréscimo.
// 1.22.0 (T4945): meeting speakers and append-only edit rebase for live meeting notes.
// 1.23.0 (T5161): selectable note folders, recents and folder-scoped note preferences.
// 1.24.0 (T5299): o `noteWidth` nas settings, a largura da coluna da nota (480 a 1400 px). Só acréscimo.
// 1.25.0 (T5350): o `diagnostics.save`, o "Salvar diagnóstico" da seção Sobre. Só acréscimo.
// 1.26.0 (T5349): todos os atalhos configuráveis: `shortcuts` nas settings (o `settings.set` aceita só parte deles e
//   recusa dois nas mesmas teclas), `shortcuts.record` e `shortcuts.cancelRecord`. O `notesShortcut` e os
//   `meetings.shortcut|pauseShortcut` continuam, iguais aos `shortcuts`, mas agora qualquer atalho cabe neles. Só acréscimo.
// 1.27.0 (T5458): o `cancel` nos `shortcuts` (o Esc durante o ditado, L5) e o `bareKey` do `shortcuts.record`. Só acréscimo.
// 1.28.0 (T5459): o `pasteLast` nos `shortcuts`, o "colar a última" (L9). Só acréscimo.
// 1.29.0 (T5455): local dictation recovery, history.retry and history.changed.
// 1.30.0 (T5556): clipboard.read, only on an explicit paste gesture.
// 1.31.0 (T5560): local spelling suggestions.
// 1.32.0 (T5833): o `cues` nas settings, os sons de início e de fim. Só acréscimo.
// 1.33.0 (T6014): refactors de título/tag e avisos de links quebrados. Só acréscimo.
// 1.34.0 (T6013): a busca pelo sentido: `semanticSearch` nas settings, o `notes.semanticStatus` e o `semantic: true` no
//   `SearchHit` achado só pelo sentido. Só acréscimo.
// 1.35.0 (T6385): o `focusMode` e o `typewriter` nos `shortcuts` (atalhos do app: modo foco e máquina de escrever). Só
//   acréscimo.
// 1.36.0 (T6594): o `notes.embed`, o pedaço de nota que um `![[nota]]`, `![[nota#Título]]` ou `![[nota#^id]]` mostra.
//   Só acréscimo.
// 1.37.0 (T6600): o quadro branco (JSON Canvas, o `.canvas` do Obsidian): `notes.canvasGet`, `notes.canvasSave`,
//   `notes.canvasCreate` e `notes.canvasRename`. Só acréscimo.
// 1.38.0 (T6602): o modo preciso do ditado: `preciseDictation` nas settings e o `dictation.preciseStatus`. Só acréscimo.
// 1.39.0 (T7103, spec #7079): o `files.read`, o conteúdo de um arquivo do cofre que não é nota, para as Notas
//   mostrarem na própria janela. Só acréscimo.
// 1.40.0 (T7105, spec #7079): o `files.save`, que grava um texto do cofre (txt, log, json, yaml) aberto nas Notas, e
//   o `readOnly` no `files.read` de um texto que não é UTF-8. Só acréscimo.
// 1.41.0 (T8678, spec #8339): o agente dentro do app, ainda sem tela: `agent.status`, `agent.enable`, `agent.disable`,
//   `agent.download`, `agent.ask`, `agent.cancel`, `agent.remove` e `agent.configure`, os eventos `agent.status` e
//   `agent.turn`, e o `agent` nas settings (só leitura pelo `settings.set`). Só acréscimo.
// 1.42.0 (T8762, spec #8373): o `models` no `AgentStatus`, os modelos que o agente oferece, para a seção Agente dos
//   Ajustes deixar trocar. Só acréscimo.
// 1.43.0 (T8956, spec #7496): o `target` no status `running` do `agent.turn`, o que uma ferramenta do Kiwi leu ou
//   procurou ("Projetos/Kiwi.md"). Só acréscimo.
// 1.44.0 (T9251, spec #8356): o agente escreve nas notas. O `agent.activity` (o registro do que cada pedido leu e
//   mudou) e o `snapshot` no `notes.save`. Só acréscimo.
// 1.45.0 (T9398, spec #9353): o desfazer do agente. O `agent.undo`, o `undone` nas mudanças do `agent.activity` e o
//   `baseVersion` no `notes.delete` (só apaga se a nota ainda está naquela versão). Só acréscimo.
// 1.46.0 (T9493, spec #9480): a tela "Atividade do agente". O `agent.change` (o antes e o depois de uma mudança, só
//   leitura), o `later` no `E_LATER_WRITE` do `agent.undo` e o evento `agent.activityChanged`. Só acréscimo.
// 1.47.0 (T9833, spec #9818): o filtro do guardrail. No `agent.activity`, o `held` de cada leitura e o `requestHeld`
//   do pedido (quantos segredos o Kiwi segurou) e o `removedSecrets` de cada mudança. Só acréscimo.
// 1.48.0 (T10012, spec #9874): os projetos. O `projects.list`, o `projects.mark`, o `projects.unmark`, o
//   `projects.setMain` e o `projects.status`. Só acréscimo.
// 1.49.0 (T10200, spec #9847): os projetos na barra lateral. O evento `projects.changed` e o `meetingsFolder` no
//   `projects.list` (a pasta que não pode ser projeto). Só acréscimo.
// 1.50.0 (T10122, spec #9873): a pergunta na dúvida. O `agent.question` (o cartão aberto, com os trechos, só para a
//   tela), o `agent.answer`, o `agent.answers` e o `agent.forget`, o evento `agent.questionChanged` (só os ids), o status
//   `waiting` no `agent.turn` e as `doubts` de cada pedido no `agent.activity`. Só acréscimo.
// 1.51.0 (T9567, spec #9510): o gato na janela principal. O `kiwicat.show` nas settings ("Mostrar o Kiwi-cat"). Só
//   acréscimo.
// 1.52.0 (T10525, spec #9839): a notificação quando o agente espera uma resposta. O `agent.notice` (a permissão do macOS
//   e o liga/desliga), o `agent.noticeAllow` (o único que pede a permissão, no clique da pessoa), o `agent.noticeSet` e o
//   evento `agent.noticeChanged`. Só acréscimo.
// 1.53.0 (T10830, spec #9810): o gato no overlay. O `kiwicat.overlay` nas settings (o `settings.set` aceita só uma das
//   chaves do `kiwicat`, e a outra fica) e o evento `kiwicat.where`. Só acréscimo.
// 1.54.0 (T11114, spec #11084): o agente econômico. O `agent.usage` (o gasto do Kiwi em 5 horas e na semana, os
//   pedidos mais caros, o último uso da janela e o último `/usage`), o `agent.usageRefresh` (o `/usage`, só sob
//   demanda), o `agent.usageClear`, o evento `agent.usageChanged` e o evento `limit` no `agent.turn`. Só acréscimo.
// 1.55.0 (T11248, spec #9876): o atalho Control. O `controlShortcut` no `AgentStatus` e no `agent.configure` ("Falar
//   com o agente pelo Control") e o evento `agent.voice` (o que o gato mostra durante a fala). Só acréscimo.
// 1.56.0 (T11223, spec #11102): o Modelo de nota. O `agent.noteModel` (o modelo do cofre, ou o padrão) e o
//   `agent.noteModelSet` (grava `.kiwi/modelo-de-nota.md`; não reescreve nenhuma nota). Só acréscimo.
export type { NoteModel };
// 1.57.0 (T11290, spec #8360): a reunião vira nota do projeto. O `agent.proposals`, o `agent.proposal` (a nota nova e a
//   diferença na nota principal), o `agent.proposalChoose`, o `agent.proposalApply`, o `agent.proposalPrepare` (a
//   pergunta do modo econômico), o `agent.proposalDiscard` e o evento `agent.proposalsChanged`. "Suas reuniões": o
//   `meetings` no `AgentStatus` e no `agent.configure`. Só acréscimo.
// 1.58.0 (T11429, spec #9349): a cor da névoa do gato. O `kiwicat.cor` nas settings (a do agente ou uma das cores
//   prontas de `kiwicat-colors.ts`; o `settings.set` recusa qualquer outra). Só acréscimo.
// 1.59.0 (T11559, spec #11546): o resumo executivo. O `summary` no `AgentStatus` e no `agent.configure` (os 6 blocos e o
//   período do primeiro resumo) e o `kind: "summary"` nas propostas. Só acréscimo.
// 1.60.0 (T11665, spec #11469): a memória do agente. O `agent.memory` (os fatos e a última mudança), o
//   `agent.memoryUndo` (o [Desfazer] de cada mudança no balão), o `agent.memorySet` e o `agent.memoryClear` (Ajustes) e o evento `agent.memoryChanged`; as `instructions` no `AgentStatus` e
//   no `agent.configure`. Só acréscimo.
// 1.61.0 (T11808, spec #11469): a ação `full` nas `changes` do `AgentMemoryView` (a memória cheia recusou o fato; o
//   balão avisa, sem [Desfazer]). Só acréscimo.
// 1.62.0 (T11691, spec #11549): os arquivos que o agente gera. O `files.create` (um arquivo novo do agente: txt, csv,
//   xlsx, docx ou pdf, em base64) e o `files.delete` (o desfazer dele, para a Lixeira, pela versão). Só acréscimo.
// 1.63.0 (T11986, spec #11908): "Pesquisar na web". O `webSearch` no `AgentStatus` e no `agent.configure` (desligado por
//   padrão; ligado, o Kiwi libera as ferramentas de web do próprio agente). Só acréscimo.
export const UI_CONTRACT_VERSION = "1.63.0";
/** O que as UIs deste build pedem no `requiresContract` do ui.json. */
export const UI_REQUIRES_CONTRACT = "^1.0.0";
/** O esquema dos dados que as UIs escrevem. As UIs de hoje não guardam nada próprio: tudo passa pelo engine. */
export const UI_DATA_SCHEMA = 1;

/** O maior texto que `clipboard.write` aceita (um ditado longo cabe com folga). */
export const CLIPBOARD_MAX_CHARS = 100_000;

/** Argumentos e resultado de cada capacidade. */
export interface UiCapabilities {
  "notes.folder": { args: Record<string,never>; result: FolderView };
  "notes.openFolder": { args: {recent?: string;confirm?:string;cancel?:string}; result: OpenFolderResult };
  "dictionary.get": { args: Record<string, never>; result: DictionaryTerm[] };
  /** Devolve o que foi salvo (já limpo: sem vazios nem repetidos). */
  "dictionary.set": { args: { terms: DictionaryTerm[] }; result: DictionaryTerm[];
  };
  /** Os aliases que trocariam texto de verdade (#434), com o texto do aviso. */
  "dictionary.check": { args: { terms: DictionaryTerm[] }; result: (AliasWarning & { text: string })[];
  };
  "snippets.get": { args: Record<string, never>; result: Snippet[] };
  "snippets.set": { args: { snippets: Snippet[] }; result: Snippet[] };
  "history.search": { args: { query?: string; limit?: number; before?: string }; result: HistoryPage;
  };
  "history.retry": {args:{id:string};result:HistoryEntry};
  "history.delete": { args: { id: string }; result: boolean };
  /**
   * "Enviar para nota…" (1.2.0, T1320): o ditado vai para o fim da nota `path` ou, sem `path`, para uma nota nova em
   * `Caixa de entrada/`. Mandar de novo não duplica: `already` diz que o trecho já estava lá. Ditado que não existe
   * dá E_NOT_FOUND.
   */
  "history.toNote": { args: { id: string; path?: string }; result: { note: NoteMeta; created: boolean; already: boolean };
  };
  /** As Configurações que o engine guarda (1.3.0, T1499). */
  "settings.get": { args: Record<string, never>; result: AppSettings };
  /** Muda só os campos dados e devolve tudo. Um valor que não existe dá E_INVALID, sem mudar nada. */
  "settings.set": {
    args: Partial<Omit<AppSettings, "meetings" | "shortcuts" | "kiwicat">> & {
      meetings?: Partial<MeetingSettings>;
      shortcuts?: Partial<Shortcuts>;
      /** O que não vem fica como está (spec #9810): o gato do canto e o do overlay mudam cada um sozinho. */
      kiwicat?: Partial<AppSettings["kiwicat"]>;
    };
    result: AppSettings;
  };
  /**
   * "Aperte o atalho" (1.26.0, T5349): o helper lê o que a pessoa aperta, em qualquer tecla (o Fn, o ⌥ direito, uma
   * sequência), e devolve o texto, sem salvar. Esc cancela. E_CANCELLED: cancelado; E_INVALID: não é um atalho (uma
   * letra sozinha); E_NO_HELPER: o helper não está de pé ou não tem o atalho ativo (falta permissão).
   */
  "shortcuts.record": { args: { bareKey?: boolean }; result: { shortcut: string } };
  /** Para o `shortcuts.record` em andamento (o botão Cancelar), que termina com E_CANCELLED. */
  "shortcuts.cancelRecord": { args: Record<string, never>; result: Record<string, never> };
  /** Só num gesto da pessoa (o botão de copiar). Até `CLIPBOARD_MAX_CHARS`. */
  "clipboard.write": { args: { text: string }; result: boolean };
  "clipboard.read": { args: Record<string, never>; result: string };
  "spelling.suggest": { args: { word: string; language?: string }; result: SpellingResult };
  /**
   * A seção que o hub deve mostrar ao abrir (1.4.0, T2121): o menu da barra ou o atalho pediu "Notas", "Ditado"…
   * Devolve e esquece; null é "a de sempre". Com o hub já aberto, o pedido chega pelo evento `hub.navigate`.
   */
  "hub.section": { args: Record<string, never>; result: { section: HubSection | null };
  };
  /**
   * A intro da abertura do zero terminou (1.5.0, T2308): no último frame, no clique para pular ou no "Reduzir
   * movimento". O main fecha a janela `intro` e abre o hub. Fora da intro, não faz nada.
   */
  "intro.done": { args: Record<string, never>; result: true };
  /** A versão do app, o canal, o link das notas da versão e as atualizações agora (1.6.0, T2386). */
  "app.about": { args: Record<string, never>; result: AppAbout };
  /**
   * "Salvar diagnóstico" (1.25.0, T5350): um .txt com versões, permissões (só o estado), STT, quedas e o fim do log, sem
   * texto nem áudio. No app vai para ~/Downloads e aparece no Finder; no headless, para <dados>/diagnostics.
   */
  "diagnostics.save": { args: Record<string, never>; result: { path: string; bytes: number } };
  /**
   * Checa na hora, sem esperar as 6 h (o Updater do ADR 0008, com a conferência da assinatura), e devolve como ficou
   * quando a checagem termina. Com a versão nova baixada e conferida, `state` é `ready`. Desligado (headless, dev,
   * KIWI_DEBUG=1, build sem feed), responde `off` e não vai à rede.
   */
  "updates.check": { args: Record<string, never>; result: UpdatesView };
  /** "Atualizar e reiniciar": só com `ready`. O app fecha, troca e reabre; se voltar, não reiniciou. */
  "updates.apply": { args: Record<string, never>; result: UpdatesView };

  // ---------------------------------------------------------------- notas (1.1.0, T1316)
  // `path` é sempre relativo ao vault, POSIX, terminando em `.md`. Fora do vault (`..`, absoluto, link simbólico,
  // pasta com ponto) dá E_OUTSIDE_VAULT; nota que não existe, E_NOT_FOUND; destino que já existe, E_EXISTS.
  /**
   * `tree` (1.7.0) é a mesma lista em árvore, com as pastas vazias. `files` (1.19.0) são os arquivos que não são nota
   * (anexo, PDF, `.canvas`), fora os ocultos.
   */
  "notes.list": { args: Record<string, never>; result: { folders: string[]; notes: NoteMeta[]; tree?: FolderNode; files?: VaultFile[];
    };
  };
  "notes.get": { args: { path: string }; result: Note };
  /**
   * Com `baseVersion` velha (a nota mudou fora, no Obsidian), não escreve e devolve a nota de agora. Com o disco cheio,
   * E_DISK_FULL (T7942), e a nota fica como estava.
   */
  "notes.save": { args: { path: string; content: string; baseVersion: string;
      baseContent?: string;
      /** 1.44.0 (spec #8356): o texto de antes vira uma versão na hora, sem o intervalo de 2 minutos (o agente). */
      snapshot?: boolean;
    }; result: SaveResult & { content?: string };
  };
  "meetings.speakers": {
    args: { path: string };
    result: { speakers: string[] };
  };
  "meetings.renameSpeaker": {
    args: { path: string; from: string; to: string };
    result: NoteMeta;
  };
  /** Título repetido vira "Título 2". */
  /**
   * Com `template` (1.9.0), o path de uma nota modelo: o conteúdo vem dela, com `{{title}}`, `{{date}}`, `{{time}}` e
   * `{{date:AAAA-MM-DD}}` trocados. `content` e `template` juntos dão E_BAD_ARGS.
   */
  "notes.create": { args: { folder?: string; title: string; content?: string; template?: string;
    }; result: Note;
  };
  /** Renomeia ou move, e atualiza os [[links]] das outras notas. */
  "notes.rename": { args: { path: string; newPath: string }; result: { meta: NoteMeta; updatedLinks: number; skippedPaths?: string[] };
  };
  /**
   * Não apaga: espera 10 min (o `notes.restore`) numa pasta oculta do vault e então vai para a Lixeira do macOS (1.7.0;
   * antes ia direto para a Lixeira). Com `baseVersion` (1.45.0), só apaga se a nota ainda está naquela versão, conferida
   * logo antes de sair do lugar; senão E_CONFLICT, e nada muda.
   */
  "notes.delete": { args: { path: string; baseVersion?: string }; result: true };
  /** Para outra pasta ("" é a raiz), com o mesmo nome; os [[links]] seguem. */
  "notes.move": { args: { path: string; folder: string }; result: { meta: NoteMeta; updatedLinks: number };
  };
  /** Uma cópia na mesma pasta: "Título 2". */
  "notes.duplicate": { args: { path: string }; result: Note };
  /** Desfaz um `notes.delete` ou `folders.delete` dos últimos 10 min, pelo caminho original. Lugar ocupado: E_EXISTS. */
  "notes.restore": { args: { path: string }; result: { path: string } };
  /** "Mostrar no Finder" (nota ou pasta). No headless e com KIWI_DEBUG=1, só registra. */
  "notes.reveal": { args: { path: string }; result: true };
  /**
   * Abre um arquivo do vault que não é nota no app padrão do Mac (1.19.0, T3370), só pelo clique da pessoa. Nota (`.md`)
   * dá E_BAD_ARGS: abre no Kiwi. No headless e com KIWI_DEBUG=1, só registra.
   */
  "files.open": { args: { path: string }; result: true };
  /**
   * O conteúdo de um arquivo do vault que não é nota (1.39.0, T7103), para as Notas mostrarem na própria janela: com
   * `as: "text"`, o texto em UTF-8 (até 5 MB); com `"binary"` (o padrão), os bytes em base64 (até 25 MB). Acima do
   * limite volta `tooLarge` com o tamanho, sem o conteúdo: a UI avisa e oferece o `files.open`. Só lê, e só arquivo
   * de dentro do cofre; nota (`.md`) dá E_BAD_ARGS.
   */
  "files.read": { args: { path: string; as?: "text" | "binary" }; result: FileContent };
  /**
   * Grava um texto do vault aberto nas Notas (1.40.0, T7105): só `.txt`, `.log`, `.json`, `.yaml` e `.yml`, só num
   * arquivo que já existe, até 5 MB. Condicional como o save das notas: com `baseVersion` velha não escreve e devolve
   * o de agora. Outro tipo de arquivo, ou um texto que não é UTF-8 (`readOnly` no `files.read`), dá E_BAD_ARGS.
   */
  "files.save": { args: { path: string; content: string; baseVersion: string }; result: FileSaveResult };
  /**
   * Um arquivo novo que o agente gerou (1.62.0, spec #11549): txt, csv, xlsx, docx ou pdf, em base64, até 25 MB. Nunca
   * por cima de outro: com o nome já usado na pasta, ele ganha um número. A versão é a do `files.read`.
   */
  "files.create": { args: { folder: string; name: string; base64: string }; result: { path: string; size: number; version: string } };
  /**
   * O desfazer de um arquivo que o agente gerou (1.62.0): para a Lixeira (os 10 minutos do Desfazer do app, depois a
   * do macOS), só se ele ainda está em `baseVersion`; senão E_CONFLICT, e nada sai do lugar.
   */
  "files.delete": { args: { path: string; baseVersion: string }; result: true };
  /**
   * O quadro branco (1.37.0, T6600): o texto do `.canvas` e a versão. O save é condicional como o das notas (com
   * `baseVersion` velha não escreve e devolve o de agora) e recusa o que não abre como JSON Canvas. O create aceita o
   * texto inicial; sem ele, o quadro vazio.
   */
  "notes.canvasGet": { args: { path: string }; result: CanvasFile };
  "notes.canvasSave": { args: { path: string; content: string; baseVersion: string }; result: CanvasSaveResult };
  "notes.canvasCreate": { args: { folder?: string; title: string; content?: string }; result: CanvasFile };
  "notes.canvasRename": { args: { from: string; to: string }; result: CanvasFile };

  // ---------------------------------------------------------------- histórico de versões (1.14.0, T2680)
  // Fora do vault, em `<dados do app>/history`: uma versão por save que muda o texto, no máximo uma a cada 2 min por
  // nota, até 50 versões ou 30 dias. O histórico segue a nota quando ela muda de nome ou de pasta.
  /** As versões da nota, a mais nova primeiro. `id` é o carimbo da hora. */
  "notes.versions": { args: { path: string }; result: { versions: { id: string; at: string; size: number }[] };
  };
  "notes.version": { args: { path: string; id: string }; result: { content: string; at: string };
  };
  /**
   * Volta a nota para a versão `id`, gravando por cima (condicionado à versão de agora). O texto de antes e o restaurado
   * viram versões também, então dá para desfazer o restaurar.
   */
  "notes.restoreVersion": { args: { path: string; id: string }; result: SaveResult;
  };

  // ---------------------------------------------------------------- exportar (1.15.0, T2684)
  /**
   * Exporta a nota para uma pasta que a pessoa escolhe no seletor do macOS (o diálogo abre aqui, só no clique). Sai
   * `<Título>.md` (com os anexos em `<Título> anexos/`), `.html` (um arquivo só, com o tema de `theme`, as variáveis CSS
   * da janela) ou `.pdf`; "Título 2" se já existe. Cancelar dá E_CANCELED. Sem o helper, o PDF dá E_NO_PDF.
   */
  "notes.export": { args: { path: string; format: "md" | "html" | "pdf"; theme?: Record<string, string>;
    }; result: { file: string };
  };

  // ---------------------------------------------------------------- nota do dia, links e Lixeira (1.10.0, T2593)
  /** `<dailyFolder>/AAAA-MM-DD.md`, criada vazia se não existe. Sem `date`, a de hoje (no relógio do Mac). */
  "notes.daily": { args: { date?: string }; result: Note };
  /**
   * A nota de um `[[link]]`: a que ele acha, ou uma nova. `[[Pasta/Nota]]` cria em Pasta; `[[Nota]]`, na pasta de `from`
   * (a nota onde o link está) ou na raiz. A `#seção` e o `|apelido` não entram no nome.
   */
  "notes.createFromLink": { args: { link: string; from?: string }; result: Note;
  };
  /** "Mencionada sem link": as notas que citam o título desta sem `[[ ]]` (sem acento nem maiúscula, palavra inteira). */
  "notes.unlinkedMentions": { args: { path: string }; result: { path: string; title: string; context: string }[];
  };
  /** Na nota `path`, as menções de `target` viram `[[Alvo]]` (ou `[[Alvo|texto]]`, se a grafia difere). */
  "notes.linkMentions": { args: { path: string; target: string }; result: { meta: NoteMeta; count: number };
  };
  /**
   * A Lixeira do app: o que espera o Desfazer (`where: "kiwi"`, com `until`) e o que já foi para o Lixo do macOS
   * (`"macos"`, só para mostrar: tirar de lá pede o Acesso Total ao Disco).
   */
  "trash.list": { args: Record<string, never>; result: { items: TrashItem[] } };
  /** O que espera o Desfazer vai já para o Lixo do macOS. */
  "trash.empty": { args: Record<string, never>; result: { trashed: number } };
  /** Abre o Lixo do macOS no Finder. No headless e com KIWI_DEBUG=1, só registra. */
  "trash.reveal": { args: Record<string, never>; result: true };

  // ---------------------------------------------------------------- pastas (1.7.0, T2468)
  // Pastas de verdade, como no Obsidian. Mover ou renomear atualiza os [[links]] de todas as notas. Pasta para dentro
  // dela mesma: E_BAD_ARGS; pasta que não existe: E_NOT_FOUND; destino ocupado: E_EXISTS.
  /** Cria a pasta e as de cima que faltarem. */
  "folders.create": { args: { path: string }; result: { path: string } };
  /** Renomeia ou move (o `newPath` pode estar em outro pai). */
  "folders.rename": { args: { path: string; newPath: string }; result: { path: string; moved: number; updatedLinks: number };
  };
  /** Para dentro de `parent` ("" é a raiz), com o mesmo nome. */
  "folders.move": { args: { path: string; parent: string }; result: { path: string; moved: number; updatedLinks: number };
  };
  /** Com o que tem dentro: espera o "Desfazer" (`notes.restore`) como a nota. */
  "folders.delete": { args: { path: string }; result: true };
  /**
   * Palavras no título ou no texto, sem acento nem maiúscula. Com filtros (1.12.0, src/shared/query.ts): `"frase
   * exata"`, `tag:x` ou `#x` (e as filhas), `path:pedaço` (ou `path:"com espaço"`), e `-` antes de qualquer um para
   * excluir. Só filtros: as notas que passam, das mais recentes. Só exclusões: nada.
   */
  "notes.search": { args: { query: string; limit?: number }; result: SearchHit[];
  };
  "notes.backlinks": { args: { path: string }; result: Backlink[] };
  /** A busca pelo sentido (1.34.0, T6013): o modelo (baixando, pronto…) e quantas notas desta pasta já têm vetores. */
  "notes.semanticStatus": { args: Record<string, never>; result: SemanticStatus };
  /** O modo preciso do ditado (1.38.0, T6602): o Whisper small (desligado, baixando, pronto…). */
  "dictation.preciseStatus": { args: Record<string, never>; result: PreciseStatus };
  /** Para qual nota um `[[link]]` aponta (regra do Obsidian), ou null. */
  "notes.resolve": { args: { link: string }; result: string | null };
  /** O que um embed de nota mostra (1.36.0, T6594): o pedaço já cortado, `missing` sem o título ou o bloco, null sem a nota. */
  "notes.embed": { args: { link: string }; result: NoteEmbed | null };
  /** As tags do vault em árvore (`#projeto/kiwi` dentro de `projeto`), com quantas notas cada uma tem (1.9.0). */
  "notes.tags": { args: Record<string, never>; result: { tags: TagNode[] } };
  "notes.renameHeading": { args: { path: string; offset: number; title: string; baseVersion: string }; result: RefactorResult };
  "notes.renameTag": { args: { from: string; to: string }; result: RefactorResult };
  "notes.linkWarnings": { args: { path: string }; result: { warnings: LinkWarning[] } };
  /** As notas da pasta de modelos (`templatesFolder` das settings), por nome (1.9.0). */
  "notes.templates": { args: Record<string, never>; result: { folder: string; templates: NoteMeta[] };
  };
  // ---------------------------------------------------------------- anexos (1.11.0, T2594)
  /** Grava uma imagem ou um PDF (`data` em base64, até 25 MB) na pasta de anexos, com nome único; devolve o embed. */
  "attachments.save": { args: { name: string; data: string }; result: SavedAttachment;
  };
  /** O anexo de um `![[…]]` (ou de um caminho) como `data:` URL, para o editor desenhar. Sem anexo, E_NOT_FOUND. */
  "attachments.read": { args: { link: string }; result: AttachmentData };
  /** Renomeia ou move o anexo e troca os links das notas que apontavam para ele. */
  "attachments.rename": { args: { path: string; newPath: string }; result: { path: string; updatedLinks: number };
  };
  /**
   * A imagem de fora (https) de uma nota como `data:`, baixada pelo engine só depois do clique da pessoa no cartão
   * (T2984, #3039). A janela não carrega nada da internet. E_BAD_URL, E_FETCH, E_NOT_IMAGE, E_TOO_BIG.
   */
  "images.remote": { args: { url: string }; result: AttachmentData };
  /**
   * As entradas de áudio e a saída padrão, pelo helper (1.18.0, T3230): o seletor de microfone dos Ajustes. Só lista,
   * nunca abre o mic. E_NO_HELPER: o helper não está de pé, ou é antigo e não sabe listar.
   */
  "audio.inputs": { args: Record<string, never>; result: AudioInputs };

  // ---------------------------------------------------------------- reuniões (1.21.0, T4947)
  /**
   * As notas de reunião (`type: meeting` no frontmatter, do R4), em qualquer pasta, a mais nova primeiro. Uma nota sem
   * algum campo ainda aparece, com ele vazio.
   */
  "meetings.list": { args: Record<string, never>; result: { meetings: MeetingNote[] } };
  /** A gravação agora, pelos eventos do helper. Sem o helper, `{recording: false}`. */
  "meetings.live": { args: Record<string, never>; result: MeetingLive };
  /** O "Parar" do card ao vivo: só um clique da pessoa. Sem gravação, E_NOT_RECORDING; sem o helper, E_NO_HELPER. */
  "meetings.stop": { args: Record<string, never>; result: true };
  /** "Pausar meu mic" (ou voltar) no card ao vivo. Sem gravação, E_NOT_RECORDING. */
  "meetings.pauseMine": { args: { paused: boolean }; result: true };
  /**
   * O agente (1.41.0, T8678, spec #8339). O estado; com `refresh: true` (a seção abriu, o "Tentar de novo"), confere
   * também o Claude Code instalado (`claude --version` e `auth status`). Sem `refresh`, nada abre programa.
   */
  "agent.status": { args: { refresh?: boolean }; result: AgentStatus };
  /** Liga o agente. Na primeira vez, só com `consent: true` (a pessoa aceitou a tela do ADR 0011); senão, E_AGENT_CONSENT. Não baixa nem abre nada. */
  "agent.enable": { args: { consent?: boolean }; result: AgentStatus };
  /** Desliga: cancela o pedido e o download e fecha o programa do agente na hora. */
  "agent.disable": { args: Record<string, never>; result: AgentStatus };
  /** Começa o download do adaptador e volta logo; o progresso chega no evento `agent.status`. Desligado: E_AGENT_DISABLED. */
  "agent.download": { args: Record<string, never>; result: AgentStatus };
  /**
   * Manda um pedido e volta logo, com o id; a resposta chega ao vivo no evento `agent.turn`. Abre o programa do agente
   * no primeiro pedido. E_AGENT_DISABLED, E_ADAPTER_MISSING ou E_AGENT_BUSY antes de começar.
   */
  "agent.ask": { args: { text: string }; result: { id: string } };
  /** Cancela o que estiver andando: o pedido ou o download. Sem nada andando, não faz nada. */
  "agent.cancel": { args: Record<string, never>; result: AgentStatus };
  /** Apaga o adaptador baixado (e fecha o programa). O agente continua ligado ou desligado como estava. */
  "agent.remove": { args: Record<string, never>; result: AgentStatus };
  /** O modelo e o esforço que o Kiwi pede ao abrir a sessão (valores das opções do agente, como `default` ou `opus`). */
  /** `controlShortcut` (1.55.0, spec #9876): "Falar com o agente pelo Control". `meetings` (1.57.0, spec #8360): "Suas
   * reuniões", inteiro; o que não vale volta ao padrão. */
  "agent.configure": { args: { model?: string; effort?: string; economy?: boolean; controlShortcut?: boolean; meetings?: AgentMeetingSettings; summary?: SummarySettings; instructions?: string; webSearch?: boolean }; result: AgentStatus };
  /**
   * O registro do agente (1.44.0, spec #8356): os pedidos, do mais novo para o mais velho, com o que cada um leu e o que
   * mudou nas notas (a nota, a hora, o tipo, o tamanho antes e depois e a versão que a escrita deixou). Fica 30 dias.
   */
  "agent.activity": { args: { limit?: number }; result: { requests: AgentActivityRequest[] } };
  /**
   * Desfaz o que o agente mudou (1.45.0, spec #9353): o pedido inteiro, ou só a mudança `change` dele (1 é a primeira,
   * na ordem do `agent.activity`). Nota por nota, e só se a nota está exatamente como o agente deixou: senão aquela nota
   * fica como está, com o motivo. O texto do agente vai antes para as Versões da nota; a nota que ele criou vai para a
   * Lixeira. Não precisa do agente ligado. E_NOT_FOUND: o pedido (ou a mudança) não está no registro, ou passou dos 30
   * dias.
   */
  "agent.undo": { args: { request: string; change?: number }; result: AgentUndoResult };
  /**
   * O antes e o depois de uma mudança do agente (1.46.0, spec #9480), para o [Ver] da tela "Atividade do agente". Só
   * lê: o registro e a nota, na pasta de notas em que o agente escreveu. E_NOT_FOUND: o pedido (ou a mudança) não está
   * no registro.
   */
  "agent.change": { args: { request: string; change: number }; result: AgentChangeView };
  // Os projetos (spec #9874, 1.47.0): uma pasta do cofre marcada pela pessoa, mais a nota principal. A marcação fica em
  // `.kiwi/projects.json`, dentro do cofre, e segue a pasta como as fixadas. E_NOT_FOUND: a pasta (ou a nota) não existe
  // ou não é projeto; E_NESTED: um projeto dentro de outro; E_MEETINGS_FOLDER: a pasta das reuniões.
  /** Os projetos do cofre aberto, com o nome, a nota principal, a última mudança e quantas notas têm. */
  "projects.list": { args: Record<string, never>; result: { projects: ProjectInfo[]; meetingsFolder: string | null } };
  /**
   * Marca a pasta como projeto. Sem a nota com o nome da pasta, cria essa nota, só com o título (`created`); nenhuma
   * outra nota muda. Marcar de novo não muda nada.
   */
  "projects.mark": { args: { folder: string }; result: { project: ProjectInfo; created: boolean } };
  /** Desmarca: o projeto sai, e nenhuma nota muda. */
  "projects.unmark": { args: { folder: string }; result: true };
  /** Troca a nota principal por outra nota de dentro da pasta. */
  "projects.setMain": { args: { folder: string; note: string }; result: { project: ProjectInfo } };
  /** O estado do projeto, só contado: o sumário da nota principal, as notas mudadas por último e as tarefas abertas. */
  "projects.status": { args: { folder: string }; result: ProjectStatus };
  /**
   * O cartão da pergunta na dúvida aberto agora (1.50.0, spec #9873), com os trechos, para a tela da pessoa; null sem
   * cartão. É o único lugar por onde o trecho em dúvida sai, e só para a janela.
   */
  "agent.question": { args: Record<string, never>; result: AgentDoubtCard | null };
  /**
   * A resposta da pessoa (1.50.0): a um trecho do cartão (`card` e `fingerprint`), a todos ("É tudo segredo", `card` e
   * `all: "hold"`), ou depois, na Atividade, a uma dúvida pendente (`request` e `fingerprint`). Fica lembrada.
   */
  "agent.answer": {
    args: { card?: string; request?: string; fingerprint?: string; answer?: "send" | "hold"; all?: "hold" };
    result: true;
  };
  /** O que a pessoa já respondeu (1.50.0), com a máscara do trecho, nunca o trecho. */
  "agent.answers": { args: Record<string, never>; result: { answers: AgentDoubtAnswer[] } };
  /** Esquece uma resposta (1.50.0): o trecho volta a ser perguntado. */
  "agent.forget": { args: { fingerprint: string }; result: boolean };
  /**
   * A linha "Avisar quando o agente esperar uma resposta" (1.52.0, spec #9839): a permissão de notificar do macOS
   * (`notDetermined` quando o Kiwi nunca pediu, `denied`, `allowed`, ou `unavailable` fora do app) e o liga/desliga.
   */
  "agent.notice": { args: Record<string, never>; result: AgentNoticeState };
  /**
   * "Ligar as notificações" (1.52.0): pede a permissão ao macOS, só se ela nunca foi pedida. Só no clique da pessoa;
   * volta na hora, e a resposta dela chega pelo `agent.noticeChanged`.
   */
  "agent.noticeAllow": { args: Record<string, never>; result: AgentNoticeState };
  /** Liga ou desliga o aviso (1.52.0). Desligado, uma notificação na tela sai. */
  "agent.noticeSet": { args: { enabled: boolean }; result: AgentNoticeState };
  /** O medidor (1.54.0, spec #11084): só o que o agente informou. Nada em dinheiro. */
  "agent.usage": { args: Record<string, never>; result: AgentUsageView };
  /** "Atualizar" (1.54.0): o `/usage` do próprio Claude Code, só quando a pessoa abre o medidor ou clica. */
  "agent.usageRefresh": { args: Record<string, never>; result: AgentUsageView };
  /** "Apagar o gasto guardado" (1.54.0): só os pedidos guardados; o estado do limite e o registro do agente ficam. */
  "agent.usageClear": { args: Record<string, never>; result: AgentUsageView };
  /**
   * O Modelo de nota do cofre (1.56.0, spec #11102): o padrão quando ainda não há `.kiwi/modelo-de-nota.md`. `saved`
   * diz se o arquivo existe: sem ele, a tela aparece na primeira vez, com "Pular".
   */
  "agent.noteModel": { args: Record<string, never>; result: { model: NoteModel; saved: boolean } };
  /** Grava o Modelo de nota (1.56.0). Só o arquivo do modelo: nenhuma nota é reescrita. */
  "agent.noteModelSet": { args: { model: NoteModel }; result: NoteModel };
  /** As propostas das reuniões dos últimos 30 dias (1.57.0, spec #8360), da mais nova para a mais velha. */
  "agent.proposals": { args: Record<string, never>; result: { proposals: AgentProposalSummary[] } };
  /** [Ver a proposta] (1.57.0): a nota nova e a diferença na nota principal, como ficariam agora. Só lê. */
  "agent.proposal": { args: { id: string }; result: AgentProposalView };
  /** A escolha do projeto entre os candidatos, ou `folder: null` para "Nenhum: só a nota da reunião" (1.57.0). */
  "agent.proposalChoose": { args: { id: string; folder: string | null }; result: AgentProposalSummary };
  /** [Aplicar] (1.57.0): escreve as duas notas num pedido do registro; o [Desfazer] é o `agent.undo` do `applyRequest`. */
  "agent.proposalApply": { args: { id: string }; result: AgentProposalSummary };
  /**
   * [Preparar] na pergunta do modo econômico (1.57.0): gasta o pedido agora. Volta o id do pedido; a resposta vem pelo
   * `agent.turn`, e a proposta pronta pelo `agent.proposalsChanged`.
   */
  "agent.proposalPrepare": { args: { id: string }; result: { id: string } };
  /** [Descartar], ou "Agora não" na pergunta do modo econômico (1.57.0): nada muda nas notas. */
  "agent.proposalDiscard": { args: { id: string }; result: AgentProposalSummary };
  /** A memória do agente (1.60.0, spec #11469): os fatos de `.kiwi/agente/sobre-mim.md` e a última mudança. */
  "agent.memory": { args: Record<string, never>; result: AgentMemoryView };
  /** O [Desfazer] de uma mudança na memória (1.60.0): o fato anotado sai, ou o esquecido volta no lugar. */
  "agent.memoryUndo": { args: { id: string }; result: AgentMemoryView };
  /** A pessoa muda a memória em Ajustes (1.60.0): a lista inteira. Um fato com cara de senha ou token é recusado. */
  "agent.memorySet": { args: { facts: string[] }; result: AgentMemoryView };
  /** "Apagar tudo" (1.60.0): a memória fica vazia. */
  "agent.memoryClear": { args: Record<string, never>; result: AgentMemoryView };
}

/** A memória do agente (1.60.0, spec #11469). */
export interface AgentMemoryView {
  /** Os fatos, na ordem do arquivo. */
  facts: string[];
  /** O máximo de fatos (60). */
  max: number;
  /**
   * As mudanças que o agente fez no último pedido que mexeu na memória, na ordem (o balão "Anotei: …", cada uma com o
   * seu [Desfazer]); vazio sem nenhuma desde que o app abriu.
   */
  changes: {
    id: string;
    /** `full` (1.61.0, T11808): a memória cheia recusou o fato; o balão avisa, sem [Desfazer]. */
    action: "remember" | "forget" | "full";
    fact: string;
    at: string;
    undone?: boolean;
  }[];
}

/** Uma proposta da reunião (1.57.0, spec #8360). As horas em ISO. */
export interface AgentProposalSummary {
  id: string;
  at: string;
  /**
   * `offer`: com o modo econômico, o Kiwi pergunta antes de gastar um pedido ([Preparar] é o `agent.proposalPrepare`,
   * "Agora não" o `agent.proposalDiscard`); ainda sem tema. `pending`: pronta, esperando [Aplicar] ou [Descartar].
   */
  status: "offer" | "pending" | "applied" | "discarded";
  /** `summary`: o resumo executivo de um projeto (1.59.0, spec #11546), que só muda a nota principal. */
  kind: "meeting" | "summary";
  /** A reunião; null num resumo executivo. */
  meeting: { path: string; title: string; date: string } | null;
  /** O resumo executivo: o sinal e desde quando "o que andou" conta. */
  summary?: { signal: "verde" | "amarelo" | "vermelho"; since: string };
  /** O projeto; null sem projeto (em dúvida, com `candidates`, ou "Nenhum: só a nota da reunião"). */
  project: { folder: string; name: string } | null;
  /** Os projetos parecidos, quando o agente ficou em dúvida: a pessoa escolhe. */
  candidates: { folder: string; name: string }[];
  theme: string;
  /** Onde a nota da reunião vai e com que título (o nome do arquivo); null num resumo executivo. */
  note: { folder: string; title: string } | null;
  /** O caminho da nota criada pelo [Aplicar]. */
  notePath?: string;
  /** O pedido do registro do [Aplicar]: o [Desfazer] é o `agent.undo` dele. */
  applyRequest?: string;
  /** Quando foi aplicada ou descartada. */
  doneAt?: string;
  /** Quando o [Desfazer] voltou tudo o que o [Aplicar] escreveu (pelo balão ou pela Atividade). */
  undoneAt?: string;
}

/** [Ver a proposta] (1.57.0): o texto da nota nova e a nota principal com as linhas que a proposta acrescenta. */
export interface AgentProposalView extends AgentProposalSummary {
  /** A nota nova da reunião; num resumo executivo, a seção "Resumo executivo" como vai ficar. */
  noteContent: string;
  /** O resumo executivo troca o anterior desta data (`AAAA-MM-DD`), que fica nas Versões. */
  replaces?: string;
  /** Null sem projeto ou num projeto sem nota principal: só a nota da reunião. */
  main: { path: string; lines: { text: string; added: boolean }[] } | null;
}

/** Uma soma de gasto do Kiwi (1.54.0). */
export interface AgentUsageSum {
  requests: number;
  tokens: number;
  /** Os tokens que o agente leu do cache. */
  cacheRead: number;
}

/** O medidor de Ajustes › Agente (1.54.0, spec #11084). As horas em ISO. */
export interface AgentUsageView {
  fiveHours: AgentUsageSum;
  week: AgentUsageSum;
  /** Os pedidos mais caros da semana. */
  top: { request: string; at: string; question: string; tokens: number }[];
  /** O último uso da janela que o agente informou no meio de um pedido, e quando chegou. */
  limit: { status: "allowed" | "allowed_warning" | "rejected"; at: string; window?: string; percent?: number; resetsAt?: string } | null;
  /** O limite acabou; a hora de volta só se o agente a informou. */
  out: { at: string; resetsAt?: string } | null;
  /** O último `/usage`, pedido pela pessoa; `unavailable` quando a resposta não trouxe as janelas. */
  subscription: { at: string; fiveHour?: { percent: number; resetsAt?: string }; week?: { percent: number; resetsAt?: string }; unavailable?: true } | null;
}

/** A permissão de notificar e o liga/desliga do aviso (1.52.0). */
export interface AgentNoticeState {
  permission: "unavailable" | "notDetermined" | "denied" | "allowed";
  enabled: boolean;
}

/** O cartão da pergunta na dúvida (1.50.0). */
export interface AgentDoubtCard {
  id: string;
  request: string;
  /** Até quando o pedido espera (ISO 8601). */
  deadline: string;
  items: { fingerprint: string; value: string; context: string; mask: string; kind: string; path: string; line: number; answer?: "send" | "hold" }[];
}

/** Uma resposta guardada (1.50.0). */
export interface AgentDoubtAnswer {
  fingerprint: string;
  answer: "send" | "hold";
  at: string;
  mask: string;
  kind: string;
}

/** O antes e o depois de uma mudança do agente (`agent.change`, 1.46.0). */
export interface AgentChangeView {
  request: string;
  /** A mudança no pedido (1 é a primeira). */
  change: number;
  path: string;
  kind: "created" | "appended" | "replaced";
  section?: string;
  at: string;
  /** Quando a mudança foi desfeita. */
  undone?: string;
  /** O texto de antes: "" numa nota que o agente criou; null se a cópia não está mais no registro. */
  before: string | null;
  /**
   * O que dá para mostrar como o depois:
   * - `exact`: `after` é o texto exato que o agente deixou (a nota de agora, ou a cópia da escrita seguinte dele);
   * - `changed`: `after` é a nota de agora, que mudou depois do agente;
   * - `gone`: a nota não está mais lá (renomeada, movida ou apagada), sem `after`;
   * - `otherFolder`: outra pasta de notas está aberta, sem `after` (nunca lê a nota de mesmo nome da pasta errada);
   * - `undone`: a mudança foi desfeita, sem `after` (o texto do agente está nas Versões da nota).
   */
  state: "exact" | "changed" | "gone" | "otherFolder" | "undone";
  after?: string;
}

/** O que o `agent.undo` fez, nota por nota (1.45.0). */
export interface AgentUndoResult {
  request: string;
  notes: AgentUndoNote[];
}

export interface AgentUndoNote {
  path: string;
  /**
   * `restored`: a nota voltou ao texto de antes; `trashed`: a nota que o agente criou foi para a Lixeira (10 min no
   * Desfazer do app); `already`: já tinha sido desfeita, nada mudou; `refused`: nada mudou, pelo `reason`.
   */
  result: "restored" | "trashed" | "already" | "refused";
  /** As mudanças do pedido (1 é a primeira) que esta nota junta. */
  changes: number[];
  /**
   * Por que nada mudou: `E_LATER_WRITE` outra escrita do agente depois, na mesma nota (desfaça primeiro a mais nova, ou
   * o pedido inteiro); `E_CHANGED` a nota mudou depois do agente; `E_GONE` ela foi renomeada, movida ou apagada;
   * `E_OTHER_FOLDER` outra pasta de notas está aberta; `E_EXPIRED` a mudança tem mais de 30 dias; `E_NO_COPY` a cópia
   * de antes não está mais no registro.
   */
  reason?: "E_LATER_WRITE" | "E_CHANGED" | "E_GONE" | "E_OTHER_FOLDER" | "E_EXPIRED" | "E_NO_COPY";
  /**
   * No `E_LATER_WRITE` (1.46.0): a escrita mais nova do agente na mesma nota, que precisa ser desfeita antes. `request`
   * é o pedido dela (o mesmo pedido, se foi nele), `change` a mudança nele (1 é a primeira) e `at` a hora do pedido.
   */
  later?: { request: string; change: number; at: string };
  /** O motivo, para a pessoa ler. */
  message?: string;
}

/** Um pedido no registro do agente (1.44.0). */
export interface AgentActivityRequest {
  id: string;
  at: string;
  /** O começo do texto do pedido, já sem os segredos (1.47.0). */
  request: string;
  /** Quantos segredos o Kiwi segurou no texto do pedido (1.47.0). */
  requestHeld?: number;
  /** As dúvidas sem resposta do pedido (1.50.0): a impressão digital, a máscara, a nota e a linha, nunca o trecho. */
  doubts?: { fingerprint: string; mask: string; kind: string; path: string; line: number; answered?: "send" | "hold" }[];
  /** O que o agente leu; `held` é quantos segredos o Kiwi segurou naquela leitura (1.47.0), nunca o valor. */
  reads: { at: string; tool: string; target?: string; held?: number }[];
  changes: {
    at: string;
    kind: "created" | "appended" | "replaced";
    path: string;
    section?: string;
    before: number;
    after: number;
    version: string;
    /** A cópia do texto de antes, no registro (o desfazer). */
    copy?: string;
    folder?: string;
    /** Quando a mudança foi desfeita (1.45.0). */
    undone?: string;
    /** Quantos segredos da nota esta escrita tirou (1.47.0): o [Desfazer] os traz de volta. */
    removedSecrets?: number;
  }[];
}

/** O Claude Code instalado, quando conferido (`agent.status` com `refresh`). */
export interface AgentClaudeStatus {
  installed: boolean;
  version?: string;
  loggedIn: boolean;
  /** Como ele está logado (`claude.ai`, `api_key`…); nunca a conta. */
  method?: string;
  versionOk: boolean;
  versionError?: "E_AGENT_TOO_OLD" | "E_AGENT_TOO_NEW";
}

/** O estado do agente no app (1.41.0, T8678). */
export interface AgentStatus {
  /** O nome que a pessoa vê ("Claude Code"). */
  name: string;
  enabled: boolean;
  /** O modo econômico (1.54.0, spec #11084). */
  economy: boolean;
  /** "Suas reuniões" (1.57.0, spec #8360): quando propor, onde salvar, o nome do arquivo e os blocos do resumo. */
  meetings: AgentMeetingSettings;
  /** O resumo executivo (1.59.0, spec #11546): os 6 blocos e o período do primeiro resumo. */
  summary: SummarySettings;
  /** As instruções da pessoa para o agente (1.60.0, spec #11469): até 2.000 caracteres, em todo pedido. */
  instructions: string;
  /** "Pesquisar na web" (1.63.0, spec #11908): desligado por padrão; ligado, o agente pode buscar e ler páginas. */
  webSearch: boolean;
  /** Se a pessoa já aceitou a tela "o que vai para o agente" (ADR 0011). */
  consented: boolean;
  /** null até a primeira conferência (`agent.status {refresh: true}`). */
  claude: AgentClaudeStatus | null;
  adapter: {
    version: string;
    phase: "missing" | "downloading" | "ready" | "error";
    /** Bytes baixados e o total, enquanto baixa. */
    done?: number;
    total?: number;
    /** O último erro do download (sem rede, adulterado, cancelado…), até o próximo começar. */
    error?: { code: string; message: string };
  };
  /** O programa do agente: fechado, abrindo (no primeiro pedido) ou aberto. */
  program: "closed" | "opening" | "open";
  /** Um pedido em andamento. */
  busy: boolean;
  /** "Falar com o agente pelo Control" (1.55.0, spec #9876), desligado por padrão. */
  controlShortcut: boolean;
  /** O que o Kiwi pede ao abrir a sessão. */
  model: string;
  effort: string;
  /** O modelo e o esforço da sessão aberta, como o agente diz; null com o programa fechado. */
  session: { model?: string; effort?: string } | null;
  /**
   * Os modelos que o agente oferece (1.42.0, T8762), da última vez que o programa abriu: vazio até o primeiro pedido.
   * `description` é o que o agente diz de cada um (no `default`, o modelo que ele usa de fato).
   */
  models: AgentModelChoice[];
}

/** Um modelo que o agente oferece (1.42.0). */
export interface AgentModelChoice {
  value: string;
  name: string;
  description?: string;
}

/** Um pedaço da resposta ao vivo de um pedido (`agent.turn`, 1.41.0). */
export type AgentTurnEvent = { id: string } & (
  | { type: "started" }
  | { type: "status"; status: "opening" | "thinking" }
  /** O pedido espera a pessoa responder a dúvida (1.50.0, spec #9873); `target` é a nota do trecho. */
  | { type: "status"; status: "waiting"; target?: string }
  /** `tool` é o nome da ferramenta; numa do Kiwi (spec #7496), `target` é o que ela leu ou procurou. */
  | { type: "status"; status: "running"; tool: string; target?: string }
  | { type: "text"; text: string }
  | { type: "permission"; tool: string; decision: "denied" }
  | { type: "done"; stopReason: string; text: string }
  | { type: "error"; code: string; message: string }
  /**
   * O limite (1.54.0, spec #11084): `warning` é o aviso do próprio agente (uma vez por janela, sem bloquear); `out`, o
   * limite acabado. `resetsAt` (ISO) só quando o agente informou a hora de volta.
   */
  | { type: "limit"; status: "warning" | "out"; percent?: number; resetsAt?: string }
);

export type UiCapability = keyof UiCapabilities;

export const UI_CAPABILITIES = [
  "notes.folder",
  "notes.openFolder",
  "dictionary.get",
  "dictionary.set",
  "dictionary.check",
  "snippets.get",
  "snippets.set",
  "history.search",
  "history.retry",
  "history.delete",
  "history.toNote",
  "settings.get",
  "settings.set",
  "clipboard.write",
  "clipboard.read",
  "spelling.suggest",
  "hub.section",
  "intro.done",
  "app.about",
  "diagnostics.save",
  "updates.check",
  "updates.apply",
  "notes.list",
  "notes.get",
  "notes.save",
  "meetings.speakers",
  "meetings.renameSpeaker",
  "notes.create",
  "notes.rename",
  "notes.delete",
  "notes.search",
  "notes.semanticStatus",
  "dictation.preciseStatus",
  "notes.backlinks",
  "notes.resolve",
  "notes.embed",
  "notes.tags",
  "notes.renameHeading",
  "notes.renameTag",
  "notes.linkWarnings",
  "notes.templates",
  "attachments.save",
  "attachments.read",
  "attachments.rename",
  "images.remote",
  "audio.inputs",
  "shortcuts.record",
  "shortcuts.cancelRecord",
  "notes.move",
  "notes.duplicate",
  "notes.restore",
  "notes.reveal",
  "files.open",
  "files.read",
  "files.save",
  "files.create",
  "files.delete",
  "notes.canvasGet",
  "notes.canvasSave",
  "notes.canvasCreate",
  "notes.canvasRename",
  "folders.create",
  "folders.rename",
  "folders.move",
  "folders.delete",
  "notes.daily",
  "notes.createFromLink",
  "notes.unlinkedMentions",
  "notes.linkMentions",
  "trash.list",
  "trash.empty",
  "trash.reveal",
  "notes.versions",
  "notes.version",
  "notes.restoreVersion",
  "notes.export",
  "meetings.list",
  "meetings.live",
  "meetings.stop",
  "meetings.pauseMine",
  "agent.status",
  "agent.enable",
  "agent.disable",
  "agent.download",
  "agent.ask",
  "agent.cancel",
  "agent.remove",
  "agent.configure",
  "agent.activity",
  "agent.undo",
  "agent.change",
  "projects.list",
  "projects.mark",
  "projects.unmark",
  "projects.setMain",
  "projects.status",
  "agent.question",
  "agent.answer",
  "agent.answers",
  "agent.forget",
  "agent.notice",
  "agent.noticeAllow",
  "agent.noticeSet",
  "agent.usage",
  "agent.usageRefresh",
  "agent.usageClear",
  "agent.noteModel",
  "agent.noteModelSet",
  "agent.proposals",
  "agent.proposal",
  "agent.proposalChoose",
  "agent.proposalApply",
  "agent.proposalPrepare",
  "agent.proposalDiscard",
  "agent.memory",
  "agent.memoryUndo",
  "agent.memorySet",
  "agent.memoryClear",
] as const satisfies readonly UiCapability[];

/** Eventos que o engine manda às UIs (`engine.on(nome, fn)`). */
export interface UiEvents {
  "notes.folderChanged": FolderView;
  /** Um ditado novo entrou no histórico. */
  "history.added": HistoryEntry;
  "history.changed": Record<string,never>;
  /** Notas criadas, mudadas, apagadas ou renomeadas, inclusive fora do app (o watcher do vault). */
  "notes.changed": { paths: string[]; folderId?: string };
  /** Arquivos que não são nota apareceram, mudaram ou sumiram, inclusive fora do app (1.19.0): a árvore lista de novo. */
  "files.changed": { paths: string[]; folderId?: string };
  /** O hub aberto vai para uma seção (1.4.0, T2121): o menu da barra ou o atalho pediram. */
  "hub.navigate": { section: HubSection };
  /** As atualizações mudaram (checando, baixando, pronta, a última checagem): a seção Sobre acompanha (1.6.0). */
  "updates.status": UpdatesView;
  /** As Configurações mudaram (1.8.0): todas as janelas trocam a Aparência na hora, sem reiniciar. */
  "settings.changed": AppSettings;
  /** Entrou ou saiu um microfone, ou mudou a saída padrão (1.18.0): os Ajustes listam de novo. */
  "audio.inputs.changed": Record<string, never>;
  /** A gravação começou, parou ou o canal "você" pausou (1.21.0): o card ao vivo da aba Reuniões. */
  "meetings.live": MeetingLive;
  /** O estado do agente mudou (1.41.0): o download andou, o programa abriu ou fechou, um pedido começou ou acabou. */
  "agent.status": AgentStatus;
  /** A resposta ao vivo de um pedido (1.41.0): o status, o texto que vai chegando e o fim. */
  "agent.turn": AgentTurnEvent;
  /**
   * O registro do agente mudou (1.46.0, spec #9480): um pedido começou, o agente leu ou mudou uma nota, ou algo foi
   * desfeito (também pela CLI). A tela "Atividade do agente" lê de novo.
   */
  "agent.activityChanged": { request: string };
  /**
   * Os projetos de uma pasta de notas mudaram (spec #9847, 1.49.0): marcados, desmarcados, a nota principal trocada,
   * ou a pasta seguida. A barra lateral relê o `projects.list`.
   */
  "projects.changed": { folderId?: string };
  /** O cartão da pergunta na dúvida abriu, mudou ou fechou (1.50.0): só os ids; a tela lê o cartão pelo `agent.question`. */
  "agent.questionChanged": { card: string; request: string; open: boolean };
  /** A permissão de notificar ou o liga/desliga do aviso mudou (1.52.0). */
  "agent.noticeChanged": AgentNoticeState;
  /**
   * O gato foi para o overlay, por cima dos outros apps, ou voltou (1.53.0, spec #9810): com `overlay: true`, o hub
   * esconde o gato do canto. Nunca dois gatos.
   */
  "kiwicat.where": { overlay: boolean };
  /** O medidor mudou (1.54.0). */
  "agent.usageChanged": AgentUsageView;
  /**
   * A fala ao agente pelo Control (1.55.0, spec #9876): `listening` com a voz (as ondas do `ouvindo`), `processing` (a
   * escuta encerrou: sem ondas, ainda em `ouvindo`), `asked` com o texto entendido (o balão, quando o pedido começa) e
   * `idle` (cancelado, ou a fala vazia: o gato volta ao repouso, e no overlay sai pela saída de cancelamento).
   */
  "agent.voice": AgentVoiceUi;
  /** Uma proposta da reunião nasceu, foi escolhida, aplicada ou descartada (1.57.0, spec #8360). */
  "agent.proposalsChanged": { proposals: AgentProposalSummary[] };
  /** A memória do agente mudou (1.60.0, spec #11469): pelo agente, pela pessoa ou por um [Desfazer]. */
  "agent.memoryChanged": AgentMemoryView;
}

/** O que o gato mostra durante a fala ao agente (1.55.0). `voz`: o nível do mic, de 0 a 1. */
export type AgentVoiceUi =
  | { phase: "listening"; voz: number }
  | { phase: "processing" }
  | { phase: "asked"; text: string; id: string }
  | { phase: "idle"; cancelled: boolean };

/** As seções do hub (#2100), na ordem da barra lateral. */
export const HUB_SECTIONS = ["notes", "meetings", "dictation", "settings", "about",
] as const;
export type HubSection = (typeof HUB_SECTIONS)[number];
export const isHubSection = (v: unknown): v is HubSection => (HUB_SECTIONS as readonly unknown[]).includes(v);

/** As janelas que viram UI do AppEngine. */
// O `hub` (T2121) é a janela principal; as outras três seguem como UIs próprias (a CLI e quem tinha uma instalada).
export const UI_WINDOWS = ["settings", "history", "notes", "hub", "intro",
] as const;
export type UiWindow = (typeof UI_WINDOWS)[number];
/**
 * As páginas que o helper abre, fora das janelas do app (spec #9810): o gato no overlay. Saem no mesmo build
 * (`dist/<página>/`, copiado para `views/ui/<página>/` no .app), sem ui.json: não são UI do AppEngine.
 */
export const HELPER_PAGES = ["catoverlay"] as const;

/** O canal do build: as rc recebem as rc (o feed `updates-rc`), a estável só a estável, e o dev nunca checa. */
export type AppChannel = "rc" | "stable" | "dev";

/** A última checagem das atualizações e o que ela achou (`at` em ISO 8601). */
export type UpdatesLastCheck =
  | { at: string; result: "latest" }
  | { at: string; result: "available"; version: string }
  | { at: string; result: "error"; message: string };

/** O estado das atualizações, como a seção Sobre mostra (T2386). */
export type UpdatesView = { lastCheck: UpdatesLastCheck | null } & (
  | { state: "off"; reason: string }
  | { state: "idle" | "checking" | "applying" }
  | { state: "downloading" | "ready"; version: string }
);

export interface AppAbout {
  /** A versão do tag (`0.1.0-rc3`), ou a do package.json num build local. */
  version: string;
  channel: AppChannel;
  /** As notas desta versão no GitHub Releases; null num build local. */
  releaseUrl: string | null;
  updates: UpdatesView;
}

/** As notas de uma versão no GitHub Releases (o tag é `v` + a versão). */
export const releaseNotesUrl = (version: string) => `https://github.com/kiwi-init/kiwinotes/releases/tag/v${encodeURIComponent(version)}`;
