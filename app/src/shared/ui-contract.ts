// O contrato entre o engine do Kiwi Notes (o main em Bun) e as UIs do AppEngine (T1192, ADR 0006).
//
// Uma UI só chama o main por `engine.invoke(cap, args)` com um destes nomes. Os nomes são estáveis: tirar ou mudar
// um é versão major (2.0.0); acrescentar é minor (1.1.0), e a UI testa com `engine.has(cap)`. Só dados locais: nada
// aqui sai do Mac.

import type { AliasWarning } from "../store/aliasCheck.ts";
import type { DictionaryTerm } from "../store/dictionary.ts";
import type { HistoryEntry, HistoryPage } from "../store/history.ts";
import type { AppSettings } from "../store/settings.ts";
import type { Snippet } from "../store/snippets.ts";
import type { TagNode } from "./tags.ts";
import type { Backlink, FolderNode, Note, NoteMeta, SaveResult, SearchHit, TrashItem, VaultFile,
} from "../notes/vault.ts";
import type { AttachmentData, SavedAttachment } from "../notes/attachments.ts";
import type { AudioInputs } from "./microphone.ts";
import type { FolderView, OpenFolderResult } from "../notes/folders-workspace.ts";
import type { MeetingLive, MeetingNote, MeetingSettings } from "./meetings.ts";

export type { AppSettings };
export { NOTES_SHORTCUTS, type NotesShortcut } from "./shortcuts.ts";
export type { TagNode };
export type { MeetingLive, MeetingNote };
export { MEETING_PAUSE_SHORTCUTS, MEETING_SHORTCUTS, DEFAULT_MEETING_APPS, type MeetingAppEntry, type MeetingSettings } from "./meetings.ts";
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
export const UI_CONTRACT_VERSION = "1.25.0";
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
  "settings.set": { args: Partial<Omit<AppSettings, "meetings">> & { meetings?: Partial<MeetingSettings> }; result: AppSettings };
  /** Só num gesto da pessoa (o botão de copiar). Até `CLIPBOARD_MAX_CHARS`. */
  "clipboard.write": { args: { text: string }; result: boolean };
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
  /** Com `baseVersion` velha (a nota mudou fora, no Obsidian), não escreve e devolve a nota de agora. */
  "notes.save": { args: { path: string; content: string; baseVersion: string;
      baseContent?: string;
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
  "notes.rename": { args: { path: string; newPath: string }; result: { meta: NoteMeta; updatedLinks: number };
  };
  /**
   * Não apaga: espera 10 min (o `notes.restore`) numa pasta oculta do vault e então vai para a Lixeira do macOS (1.7.0;
   * antes ia direto para a Lixeira).
   */
  "notes.delete": { args: { path: string }; result: true };
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
  /** Para qual nota um `[[link]]` aponta (regra do Obsidian), ou null. */
  "notes.resolve": { args: { link: string }; result: string | null };
  /** As tags do vault em árvore (`#projeto/kiwi` dentro de `projeto`), com quantas notas cada uma tem (1.9.0). */
  "notes.tags": { args: Record<string, never>; result: { tags: TagNode[] } };
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
}

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
  "history.delete",
  "history.toNote",
  "settings.get",
  "settings.set",
  "clipboard.write",
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
  "notes.backlinks",
  "notes.resolve",
  "notes.tags",
  "notes.templates",
  "attachments.save",
  "attachments.read",
  "attachments.rename",
  "images.remote",
  "audio.inputs",
  "notes.move",
  "notes.duplicate",
  "notes.restore",
  "notes.reveal",
  "files.open",
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
] as const satisfies readonly UiCapability[];

/** Eventos que o engine manda às UIs (`engine.on(nome, fn)`). */
export interface UiEvents {
  "notes.folderChanged": FolderView;
  /** Um ditado novo entrou no histórico. */
  "history.added": HistoryEntry;
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
}

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
