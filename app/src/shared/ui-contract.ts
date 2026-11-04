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
import type { Backlink, FolderNode, Note, NoteMeta, SaveResult, SearchHit } from "../notes/vault.ts";

export type { AppSettings };
export { NOTES_SHORTCUTS, type NotesShortcut } from "./shortcuts.ts";
export type { TagNode };
export type { AliasWarning, Backlink, DictionaryTerm, FolderNode, HistoryEntry, HistoryPage, Note, NoteMeta, SaveResult, SearchHit, Snippet };

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
export const UI_CONTRACT_VERSION = "1.9.0";
/** O que as UIs deste build pedem no `requiresContract` do ui.json. */
export const UI_REQUIRES_CONTRACT = "^1.0.0";
/** O esquema dos dados que as UIs escrevem. As UIs de hoje não guardam nada próprio: tudo passa pelo engine. */
export const UI_DATA_SCHEMA = 1;

/** O maior texto que `clipboard.write` aceita (um ditado longo cabe com folga). */
export const CLIPBOARD_MAX_CHARS = 100_000;

/** Argumentos e resultado de cada capacidade. */
export interface UiCapabilities {
  "dictionary.get": { args: Record<string, never>; result: DictionaryTerm[] };
  /** Devolve o que foi salvo (já limpo: sem vazios nem repetidos). */
  "dictionary.set": { args: { terms: DictionaryTerm[] }; result: DictionaryTerm[] };
  /** Os aliases que trocariam texto de verdade (#434), com o texto do aviso. */
  "dictionary.check": { args: { terms: DictionaryTerm[] }; result: (AliasWarning & { text: string })[] };
  "snippets.get": { args: Record<string, never>; result: Snippet[] };
  "snippets.set": { args: { snippets: Snippet[] }; result: Snippet[] };
  "history.search": { args: { query?: string; limit?: number; before?: string }; result: HistoryPage };
  "history.delete": { args: { id: string }; result: boolean };
  /**
   * "Enviar para nota…" (1.2.0, T1320): o ditado vai para o fim da nota `path` ou, sem `path`, para uma nota nova em
   * `Caixa de entrada/`. Mandar de novo não duplica: `already` diz que o trecho já estava lá. Ditado que não existe
   * dá E_NOT_FOUND.
   */
  "history.toNote": { args: { id: string; path?: string }; result: { note: NoteMeta; created: boolean; already: boolean } };
  /** As Configurações que o engine guarda (1.3.0, T1499). */
  "settings.get": { args: Record<string, never>; result: AppSettings };
  /** Muda só os campos dados e devolve tudo. Um valor que não existe dá E_INVALID, sem mudar nada. */
  "settings.set": { args: Partial<AppSettings>; result: AppSettings };
  /** Só num gesto da pessoa (o botão de copiar). Até `CLIPBOARD_MAX_CHARS`. */
  "clipboard.write": { args: { text: string }; result: boolean };
  /**
   * A seção que o hub deve mostrar ao abrir (1.4.0, T2121): o menu da barra ou o atalho pediu "Notas", "Ditado"…
   * Devolve e esquece; null é "a de sempre". Com o hub já aberto, o pedido chega pelo evento `hub.navigate`.
   */
  "hub.section": { args: Record<string, never>; result: { section: HubSection | null } };
  /**
   * A intro da abertura do zero terminou (1.5.0, T2308): no último frame, no clique para pular ou no "Reduzir
   * movimento". O main fecha a janela `intro` e abre o hub. Fora da intro, não faz nada.
   */
  "intro.done": { args: Record<string, never>; result: true };
  /** A versão do app, o canal, o link das notas da versão e as atualizações agora (1.6.0, T2386). */
  "app.about": { args: Record<string, never>; result: AppAbout };
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
  /** `tree` (1.7.0) é a mesma lista em árvore, com as pastas vazias. */
  "notes.list": { args: Record<string, never>; result: { folders: string[]; notes: NoteMeta[]; tree?: FolderNode } };
  "notes.get": { args: { path: string }; result: Note };
  /** Com `baseVersion` velha (a nota mudou fora, no Obsidian), não escreve e devolve a nota de agora. */
  "notes.save": { args: { path: string; content: string; baseVersion: string }; result: SaveResult };
  /** Título repetido vira "Título 2". */
  /**
   * Com `template` (1.9.0), o path de uma nota modelo: o conteúdo vem dela, com `{{title}}`, `{{date}}`, `{{time}}` e
   * `{{date:AAAA-MM-DD}}` trocados. `content` e `template` juntos dão E_BAD_ARGS.
   */
  "notes.create": { args: { folder?: string; title: string; content?: string; template?: string }; result: Note };
  /** Renomeia ou move, e atualiza os [[links]] das outras notas. */
  "notes.rename": { args: { path: string; newPath: string }; result: { meta: NoteMeta; updatedLinks: number } };
  /**
   * Não apaga: espera 10 min (o `notes.restore`) numa pasta oculta do vault e então vai para a Lixeira do macOS (1.7.0;
   * antes ia direto para a Lixeira).
   */
  "notes.delete": { args: { path: string }; result: true };
  /** Para outra pasta ("" é a raiz), com o mesmo nome; os [[links]] seguem. */
  "notes.move": { args: { path: string; folder: string }; result: { meta: NoteMeta; updatedLinks: number } };
  /** Uma cópia na mesma pasta: "Título 2". */
  "notes.duplicate": { args: { path: string }; result: Note };
  /** Desfaz um `notes.delete` ou `folders.delete` dos últimos 10 min, pelo caminho original. Lugar ocupado: E_EXISTS. */
  "notes.restore": { args: { path: string }; result: { path: string } };
  /** "Mostrar no Finder" (nota ou pasta). No headless e com KIWI_DEBUG=1, só registra. */
  "notes.reveal": { args: { path: string }; result: true };

  // ---------------------------------------------------------------- pastas (1.7.0, T2468)
  // Pastas de verdade, como no Obsidian. Mover ou renomear atualiza os [[links]] de todas as notas. Pasta para dentro
  // dela mesma: E_BAD_ARGS; pasta que não existe: E_NOT_FOUND; destino ocupado: E_EXISTS.
  /** Cria a pasta e as de cima que faltarem. */
  "folders.create": { args: { path: string }; result: { path: string } };
  /** Renomeia ou move (o `newPath` pode estar em outro pai). */
  "folders.rename": { args: { path: string; newPath: string }; result: { path: string; moved: number; updatedLinks: number } };
  /** Para dentro de `parent` ("" é a raiz), com o mesmo nome. */
  "folders.move": { args: { path: string; parent: string }; result: { path: string; moved: number; updatedLinks: number } };
  /** Com o que tem dentro: espera o "Desfazer" (`notes.restore`) como a nota. */
  "folders.delete": { args: { path: string }; result: true };
  "notes.search": { args: { query: string; limit?: number }; result: SearchHit[] };
  "notes.backlinks": { args: { path: string }; result: Backlink[] };
  /** Para qual nota um `[[link]]` aponta (regra do Obsidian), ou null. */
  "notes.resolve": { args: { link: string }; result: string | null };
  /** As tags do vault em árvore (`#projeto/kiwi` dentro de `projeto`), com quantas notas cada uma tem (1.9.0). */
  "notes.tags": { args: Record<string, never>; result: { tags: TagNode[] } };
  /** As notas da pasta de modelos (`templatesFolder` das settings), por nome (1.9.0). */
  "notes.templates": { args: Record<string, never>; result: { folder: string; templates: NoteMeta[] } };
}

export type UiCapability = keyof UiCapabilities;

export const UI_CAPABILITIES = [
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
  "updates.check",
  "updates.apply",
  "notes.list",
  "notes.get",
  "notes.save",
  "notes.create",
  "notes.rename",
  "notes.delete",
  "notes.search",
  "notes.backlinks",
  "notes.resolve",
  "notes.tags",
  "notes.templates",
  "notes.move",
  "notes.duplicate",
  "notes.restore",
  "notes.reveal",
  "folders.create",
  "folders.rename",
  "folders.move",
  "folders.delete",
] as const satisfies readonly UiCapability[];

/** Eventos que o engine manda às UIs (`engine.on(nome, fn)`). */
export interface UiEvents {
  /** Um ditado novo entrou no histórico. */
  "history.added": HistoryEntry;
  /** Notas criadas, mudadas, apagadas ou renomeadas, inclusive fora do app (o watcher do vault). */
  "notes.changed": { paths: string[] };
  /** O hub aberto vai para uma seção (1.4.0, T2121): o menu da barra ou o atalho pediram. */
  "hub.navigate": { section: HubSection };
  /** As atualizações mudaram (checando, baixando, pronta, a última checagem): a seção Sobre acompanha (1.6.0). */
  "updates.status": UpdatesView;
  /** As Configurações mudaram (1.8.0): todas as janelas trocam a Aparência na hora, sem reiniciar. */
  "settings.changed": AppSettings;
}

/** As seções do hub (#2100), na ordem da barra lateral. */
export const HUB_SECTIONS = ["notes", "meetings", "dictation", "settings", "about"] as const;
export type HubSection = (typeof HUB_SECTIONS)[number];
export const isHubSection = (v: unknown): v is HubSection => (HUB_SECTIONS as readonly unknown[]).includes(v);

/** As janelas que viram UI do AppEngine. */
// O `hub` (T2121) é a janela principal; as outras três seguem como UIs próprias (a CLI e quem tinha uma instalada).
export const UI_WINDOWS = ["settings", "history", "notes", "hub", "intro"] as const;
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
