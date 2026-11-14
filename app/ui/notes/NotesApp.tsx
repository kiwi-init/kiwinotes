// Notas (spec #1107, fase A, T1317): o vault em Markdown, "uma superfície só". Com o T2502 (#2457, versão C · Foco), a
// nota ocupa a janela: a árvore de pastas abre pelo caminho na barra de cima, num popover, e o "Citada em" sai da linha
// de meta. Com o T3826 (#3816), a árvore abre pela borda, sobre a nota, sem mover o editor.
// ⌘K busca, ⌘N cria. A barra de ditado de baixo saiu no T3144 (#3140): o ditado cola direto no editor.
// Tudo passa pelas capacidades `notes.*` do engine (contrato 1.1.0); nada sai do Mac.

import "./notes.css";

import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { api as appApi } from "../src/api.ts";
import { Button, Empty, HoverLabel } from "../src/kit/index.tsx";
import { TopBar } from "../src/topbar.tsx";
import { useShortcuts } from "../src/useShortcuts.ts";
import { DEFAULT_SHORTCUTS, matchesKeyEvent, shortcutLabel } from "../../src/shared/shortcuts.ts";
import { Popover } from "./Popover.tsx";
import { TreePopover } from "./TreePopover.tsx";
import { NoteWidthHandles } from "./NoteWidth.tsx";
import { NOTE_WIDTH } from "../../src/shared/note-width.ts";
import { ContextMenu, type MenuItem } from "./ContextMenu.tsx";
import { FolderConfirmation, useNotesFolders, type FolderController } from "./NotesFolder.tsx";
import type { FolderRef } from "../../src/notes/folders-workspace.ts";
import { notesApi } from "./api.ts";
import { LinkCache, type LinkTarget } from "./editor/index.ts";
import { wordCount } from "./editor/text.ts";
import { type Draft, Drafts, forgetDraftOnDelete } from "./drafts.ts";
import { RefactorDialog } from "./RefactorDialog.tsx";
import type { LinkWarning, RefactorResult } from "../../src/notes/refactor.ts";
import { MeetingSpeakerDialog } from "./MeetingSpeakerDialog.tsx";
import { isMeetingNote } from "../../src/shared/meeting-note.ts";
import { merge3, mergeNoteEdit, type MergeResult } from "../../src/shared/merge3.ts";
import { splitFrontmatter } from "./frontmatter.ts";
import { Properties } from "./Properties.tsx";
import { addProperty } from "./frontmatter-properties.ts";
import { FolderPicker, ListPicker } from "./FolderPicker.tsx";
import { folderOf, linkTextFor, noteName, plainContext } from "./links.ts";
import { errorCode } from "./errors.ts";
import { linkSafeName, makeFileResolver, type Resolver } from "../../src/shared/wikilinks.ts";
import { focusEditor, insertIntoEditor,
  updateEditorDocument,
  NoteEditor,
} from "./NoteEditor.tsx";
import { fillTemplate } from "../../src/shared/templates.ts";
import { Palette } from "./Palette.tsx";
import { type SideRoot, type SideTarget, Sidebar } from "./Sidebar.tsx";
import { ancestors, buildTree, editedLabel, filterTree, filterTreeToPaths, recentNotes, type SortBy,
} from "./tree.ts";
import { TrashView } from "./TrashView.tsx";
import { VersionsDialog } from "./VersionsDialog.tsx";
import { hasFilters, parseQuery, type SavedSearch, searchTooLong,
} from "../../src/shared/query.ts";
import { type Toast, UndoToast } from "./UndoToast.tsx";
import { CanvasView } from "./canvas/CanvasView.tsx";
import { FileView, type FilesApi } from "./files/FileView.tsx";
import { viewerFor } from "./files/viewers.ts";
import { allFolders, loadCollapsed, loadOpenFolders, saveCollapsed, saveOpenFolders, type SectionId, toggled } from "./sidebarState.ts";
import { UnlinkedMentions } from "./UnlinkedMentions.tsx";
import type { Backlink, Note, NoteMeta, NotesApi, SaveResult, TagNode, VaultListing, ExportFormat, TreePrefs, ProjectView,
} from "./types.ts";

type SaveOutcome = "clean" | "saved" | "conflict" | "error";

/** Onde entram as notas que não têm lugar ainda: a nota rápida do A3 (#1509) e o rascunho órfão recuperado. */
const INBOX = "Caixa de entrada";
/** O porquê de um nome com `# ^ | [ ]` mudar ao renomear (T7520). */
const LINK_SAFE_NOTE = " (sem # ^ | [ ], que quebram os [[links]] para ela)";

/** A ordem da árvore fica no navegador da janela (uma conveniência de quem vê, T2469). */
const SORT_KEY = "kiwi.notes.sort";
const loadSort = (): SortBy => {
  try {
    const v = localStorage.getItem(SORT_KEY);
    return v === "edited" || v === "created" ? v : "name";
  } catch {
    return "name";
  }
};

/** Um nome que ainda não existe entre `taken`: "Nova pasta", "Nova pasta 2"… */
export function freeName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
}

const join = (folder: string, name: string) =>
  folder ? `${folder}/${name}` : name;

/** Quanto esperar depois da última tecla para gravar. */
const SAVE_AFTER_MS = 500;
/**
 * O que não precisa ir a cada tecla (T7876): a contagem de palavras e o rascunho no `localStorage` esperam a pessoa
 * parar de digitar. Os dois leem a nota inteira, e numa nota de 400 KB custavam dezenas de ms por tecla. O rascunho
 * também é gravado antes de cada save e ao esconder ou fechar a janela, então ele nunca fica para trás.
 */
const SETTLE_MS = 300;
/**
 * O teto da espera (revisão do T7876): quem digita sem parar não fica sem rascunho. Ele existe para o que o save não alcança
 * (o WebView que cai, o app morto, a falta de luz), e a cada SETTLE_MAX_MS de digitação contínua ele é gravado.
 */
const SETTLE_MAX_MS = 1500;

function useEnterAnimation() {
  const [n, setN] = useState(0);
  useEffect(() => {
    window.__kiwiEnter = () => setN((x) => x + 1);
    return () => {
      delete window.__kiwiEnter;
    };
  }, []);
  return n;
}

function Notes({ api, drafts, active, openRequest, folderController, folderRef }: { api: NotesApi; drafts: Drafts; active: boolean; openRequest?: { path: string; n: number; internal?: boolean } | null; folderController?:FolderController;folderRef?:FolderRef }) {
  // A nota que outra seção do hub pediu (T4947): a de antes de montar abre na carga; as seguintes, pelo efeito abaixo.
  const openRequestRef = useRef(openRequest);
  const handledRequest = useRef(openRequest?.n ?? 0);
  const [listing, setListing] = useState<VaultListing | null>(null);
  const listingRef = useRef(listing);
  listingRef.current = listing;
  const [failed, setFailed] = useState(false);
  // As pastas abertas e as seções recolhidas da barra ficam guardadas entre aberturas (T7390, spec #7383). As pastas
  // são de cada cofre (este componente remonta a cada troca de pasta das notas).
  const vaultKey = folderRef?.key ?? "";
  const [openFolders, setOpenFolders] = useState<Set<string>>(() => loadOpenFolders(vaultKey));
  const [collapsed, setCollapsed] = useState<Set<SectionId>>(() => loadCollapsed());
  useEffect(() => saveCollapsed(collapsed), [collapsed]);
  const [note, setNote] = useState<Note | null>(null);
  /** A nota aberta não é UTF-8 (T7575): só leitura. */
  const readOnlyRef = useRef(false);
  readOnlyRef.current = note?.readOnly === true;
  const [docKey, setDocKey] = useState("");
  const [headingJump, setHeadingJump] = useState<{ path: string; heading: string; sequence: number } | null>(null);
  const shown = useRef(0);
  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  /**
   * A nota mudou fora no mesmo trecho que a pessoa editou (T5454): a nota de agora no disco e o merge, com o resto já
   * junto e só os trechos que batem para a pessoa escolher.
   */
  const [conflict, setConflict] = useState<{ note: Note; merge: Extract<MergeResult, { clean: false }> } | null>(null);
  /** O último save falhou (disco cheio, nota apagada fora, grande demais): a edição fica e a pessoa decide. */
  /** O save falhou: `"disk-full"` quando o disco está cheio (T7942), para o aviso dizer o porquê. */
  const [saveFailed, setSaveFailed] = useState<false | "error" | "disk-full">(false);
  // A nota aberta sumiu fora (apagada ou renomeada) com texto por gravar (T7513): o texto fica no editor e o aviso deixa
  // a pessoa escolher. Até lá não grava (não recria a nota calado) e não sai dela.
  const [gone, setGone] = useState(false);
  const goneRef = useRef(false);
  const markGone = (v: boolean) => {
    goneRef.current = v;
    setGone(v);
  };
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [palette, setPalette] = useState(false);
  /** O texto com que o ⌘K abre (T2619: `tag:…` vindo de um clique numa tag). */
  const [paletteQuery, setPaletteQuery] = useState("");
  const [tagList, setTagList] = useState<TagNode[]>([]);
  /** As buscas salvas (T2660); `null` num engine que ainda não as tem. */
  const [saved, setSaved] = useState<SavedSearch[] | null>(null);
  /** A extensão nos nomes e a pasta da nota do dia (T3370), das settings; segue quando os Ajustes mudam. */
  const [prefs, setPrefs] = useState<TreePrefs>({ showExtensions: false, dailyFolder: "", noteWidth: null,
  });
  /** A largura enquanto a pessoa arrasta a alça, até as settings voltarem com ela (T5299). */
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  useEffect(() => setDragWidth(null), [prefs.noteWidth]);
  /** "Nova nota a partir de modelo…": os modelos e a pasta onde a nota nasce. */
  // `insert` (T2660, "/modelo"): o modelo entra no cursor da nota aberta, em vez de criar uma nota.
  const [picking, setPicking] = useState<{ folder: string; templates: NoteMeta[]; insert?: boolean;
  } | null>(null);
  // A árvore e o "Citada em" abrem em popover (C · Foco).
  const [treeOpen, setTreeOpen] = useState(false);
  const [backOpen, setBackOpen] = useState(false);
  const [crumbEl, setCrumbEl] = useState<HTMLButtonElement | null>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  // O básico de app de notas (T2469).
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>(loadSort);
  const [selectedFolder, setSelectedFolder] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; target: SideTarget;
  } | null>(null);
  const [speakerDialog, setSpeakerDialog] = useState<{
    path: string;
    speakers: string[];
  } | null>(null);
  const [moving, setMoving] = useState<SideTarget | null>(null);
  /** O "Versões…" aberto (T2680): a nota e o texto dela no disco, para a diferença. */
  /** "Exportar…" (T2684): a nota cujo formato a pessoa está escolhendo. */
  const [exporting, setExporting] = useState<string | null>(null);
  const [versionsOf, setVersionsOf] = useState<{ path: string; title: string; content: string;
  } | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  /** O meio da janela: a nota, ou a Lixeira do app (T2593). */
  const [view, setView] = useState<"note" | "trash" | "canvas" | "file">("note");
  /** O arquivo que não é nota aberto no lugar dela (T7103, spec #7079). */
  const [fileOpen, setFileOpen] = useState<string | null>(null);
  /** O "grava antes de sair" do arquivo aberto, quando o visualizador edita (T7105). */
  const fileFlush = useRef<(() => Promise<boolean>) | null>(null);
  /** O quadro branco aberto (T6600), e o "grava antes de sair" dele. */
  const [board, setBoard] = useState<string | null>(null);
  const boardFlush = useRef<(() => Promise<boolean>) | null>(null);
  /** Sobe a cada mudança no vault: a Lixeira e o "Mencionada sem link" se refazem (T2593). */
  const [vaultVersion, setVaultVersion] = useState(0);
  const [linkWarnings, setLinkWarnings] = useState<LinkWarning[]>([]);
  const [tagMenu, setTagMenu] = useState<{ x: number; y: number; tag: string } | null>(null);
  const [refactor, setRefactor] = useState<
    { kind: "tag"; name: string } | { kind: "heading"; name: string; path: string; offset: number; source: string } | null>(null);
  useEffect(() => {
    let stale = false;
    setLinkWarnings([]);
    if (note && api.linkWarnings) api.linkWarnings(note.path).then(r => { if (!stale) setLinkWarnings(r.warnings); }, () => {});
    return () => { stale = true; };
  }, [api, note?.path, note?.version, vaultVersion]);
  const [trashCount, setTrashCount] = useState(0);
  const [pinned, setPinned] = useState<string[]>([]);
  // Os projetos (spec #9847): a lista do engine e a pasta das reuniões, que não pode ser projeto.
  const [projectList, setProjectList] = useState<{ projects: ProjectView[]; meetingsFolder: string | null }>({ projects: [], meetingsFolder: null });
  const [projectPick, setProjectPick] = useState<{ x: number; y: number; folder: string } | null>(null);
  /** A linha (ou o "…") que abriu o menu da barra lateral: o Esc devolve o foco a ela (spec #10211). */
  const menuOpener = useRef<HTMLElement | null>(null);
  const restoreMenuFocus = () => {
    const el = menuOpener.current;
    // Só se o foco ficou solto: o item que abre um campo (Renomear) ou outro menu fica com ele.
    requestAnimationFrame(() => {
      // Solto: no body, ou num contêiner da própria linha (o painel da árvore, a barra), nunca num campo ou noutro menu.
      const a = document.activeElement;
      // O painel da árvore devolve o foco à busca quando o menu fecha; com uma linha como dona do menu, ela fica com ele.
      const free =
        !a || a === document.body || (a instanceof HTMLElement && !!el && (a.contains(el) || (a.classList.contains("kn-side-search") && el.classList.contains("kn-side-item"))));
      if (el?.isConnected && free) el.focus();
    });
  };
  const [words, setWords] = useState(0);
  const entered = useEnterAnimation();

  // O que ainda não foi gravado: o corpo da nota aberta, o frontmatter que volta com ele e a versão que o disco tem.
  const pending = useRef<string | null>(null);
  // T7876: a contagem de palavras e o rascunho do que foi digitado, um pouco depois da última tecla (SETTLE_MS).
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const settleRef = useRef<() => void>(() => {});
  /** Quando começou a digitação que ainda espera (o primeiro onChange depois do último settle). */
  const settleSince = useRef(0);
  const frontmatter = useRef("");
  /** O mesmo frontmatter, em estado: o painel de propriedades (T6598) desenha a partir dele. */
  const [frontmatterText, setFrontmatterText] = useState("");
  const setFrontmatter = (text: string) => {
    frontmatter.current = text;
    setFrontmatterText(text);
  };
  const [newProperty, setNewProperty] = useState<string | null>(null);
  const clearNewProperty = useCallback(() => setNewProperty(null), []);
  const version = useRef("");
  const baseContent = useRef("");
  const current = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Um `[[relatorio.pdf]]` acha o arquivo do vault (T7616): o link não fica de quebrado, e seguir abre o arquivo.
  // Pela lista dos arquivos, não pela listagem (spec #13384): um save de nota traz a mesma lista, e o resolvedor fica.
  const files = listing?.files;
  // E só quando um link pede (um `[[relatorio.pdf]]`): montar o resolvedor de 150 mil arquivos leva 0,2 s.
  const fileOf = useMemo<Resolver>(() => {
    let made: Resolver | null = null;
    return (target) => (made ??= makeFileResolver((files ?? []).map((f) => f.path)))(target);
  }, [files]);
  const fileOfRef = useRef(fileOf);
  fileOfRef.current = fileOf;
  const links = useMemo(() => new LinkCache((t) => api.resolve(t).then((p) => p ?? fileOfRef.current(t))), [api]);
  useEffect(() => links.clear(), [fileOf, links]);
  /** O rascunho achado ao abrir a nota, enquanto a pessoa não escolhe: ele não é sobrescrito nem apagado até lá. */
  const [draft, setDraft] = useState<Draft | null>(null);
  const undecided = useRef<Draft | null>(null);
  /**
   * Rascunhos de notas que não existem mais quando a janela abre: a nota foi renomeada ou apagada fora com a janela
   * fechada. Um por vez, para recuperar como nota nova na Caixa de entrada ou descartar (#1525).
   */
  const [orphans, setOrphans] = useState<Draft[]>([]);

  const refresh = useCallback(
    () =>
      api.list().then(
        (l) => {
          setListing(l);
          setFailed(false);
          // As tags andam com a lista (T2619): o mesmo notes.changed refaz as duas.
          api.tags?.().then(setTagList, () => {});
          return l;
        },
        () => {
          setFailed(true);
          return null;
        },
      ),
    [api],
  );

  /**
   * Só mudaram notas que já estão na lista (o save da nota aberta, uma edição no Obsidian): troca os dados delas, sem
   * pedir a lista inteira (spec #13384: com 6 mil pastas, a lista e a árvore refeitas a cada save davam quadros de
   * 90 ms). `null`: entrou, saiu ou mudou de lugar alguma coisa, e a lista inteira vem.
   */
  const patchListing = useCallback(
    async (paths: string[]): Promise<VaultListing | null> => {
      const l = listingRef.current;
      if (!l || !paths.length || paths.length > 20) return null;
      const at = new Map(l.notes.map((n, i) => [n.path, i]));
      if (!paths.every((p) => at.has(p))) return null;
      const got = await Promise.all(paths.map((p) => api.get(p).catch(() => null)));
      if (got.some((n) => !n) || listingRef.current !== l) return null;
      const notes = [...l.notes];
      for (const n of got) {
        const i = at.get(n!.path)!;
        const old = notes[i]!;
        // Os campos da lista, tirados da nota de agora (sem o conteúdo).
        notes[i] = Object.fromEntries(Object.keys(old).map((k) => [k, (n as unknown as Record<string, unknown>)[k] ?? (old as unknown as Record<string, unknown>)[k]])) as unknown as NoteMeta;
      }
      const next = { ...l, notes };
      listingRef.current = next;
      setListing(next);
      api.tags?.().then(setTagList, () => {});
      return next;
    },
    [api],
  );

  const show = useCallback(
    /** Mostra a nota. `stay`: uma recarga por fora (a nota mudou no disco) não tira a Lixeira da tela (T2593). */
    (n: Note, stay = false) => {
      if (!stay) setView("note");
      const split = splitFrontmatter(n.content);
      setFrontmatter(split.frontmatter);
      version.current = n.version;
      baseContent.current = n.content;
      current.current = n.path;
      setHeadingJump(null);
      pending.current = null;
      setNote(n);
      setTitle(n.title);
      setBody(split.body);
      setWords(wordCount(split.body));
      // A pasta da nota aberta é a do próximo ⌘N.
      setSelectedFolder(n.folder);
      // Um número a cada nota mostrada (T2680): a versão é o hash do texto, e um autosave não troca a chave. Restaurar o texto
      // de antes daria a mesma chave de quando a nota abriu, e o editor ficava com o texto editado na tela.
      setDocKey(`${n.path}@${n.version}@${++shown.current}`);
      setConflict(null);
      setSaveFailed(false);
      markGone(false);
      // Um rascunho que não foi gravado (a janela fechou com conflito ou erro na tela): oferece de volta.
      // Com o frontmatter também (T7516): a edição só das propriedades é um rascunho. O de antes do T1550 não tem o campo.
      const d = drafts.get(n.path);
      if (d && (d.body !== split.body || (d.frontmatter !== undefined && d.frontmatter !== split.frontmatter))) {
        undecided.current = d;
        setDraft(d);
      } else {
        if (d) drafts.remove(n.path);
        undecided.current = null;
        setDraft(null);
      }
      setOpenFolders((open) => new Set([...open, ...ancestors(n.path)]));
      api.backlinks(n.path).then(setBacklinks, () => setBacklinks([]));
    },
    [api, drafts],
  );

  /**
   * Um texto juntado (T5454, ou a escrita da reunião) passa a ser o do editor, sobre a nota de agora no disco: a base
   * vira a de fora, e o que ainda difere dela fica por gravar. O editor troca só as linhas que mudaram.
   */
  const applyMerged = (n: Note, merged: string) => {
    const split = splitFrontmatter(merged);
    const dirty = merged !== n.content;
    baseContent.current = n.content;
    setFrontmatter(split.frontmatter);
    version.current = n.version;
    pending.current = dirty ? split.body : null;
    if (dirty) drafts.set({ path: n.path, body: split.body, frontmatter: split.frontmatter, baseVersion: n.version });
    else drafts.remove(n.path);
    updateEditorDocument(split.body);
    setBody(split.body);
    setWords(wordCount(split.body));
    setNote(n);
    if (dirty) {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(), SAVE_AFTER_MS);
    }
  };

  /**
   * Grava o que está pendente e diz o que houve: "clean" (nada a gravar), "saved", "conflict" (mudou fora: o aviso
   * aparece) ou "error" (o aviso de erro aparece). Um save por vez, numa fila: dois ao mesmo tempo saíam com a mesma
   * versão, e o 2º via a gravação do 1º como conflito.
   */
  const queue = useRef<Promise<SaveOutcome>>(Promise.resolve("clean"));
  const save = useCallback((): Promise<SaveOutcome> => {
    clearTimeout(timer.current);
    // O rascunho do que foi digitado vai antes do save (T7876): se ele falhar, o texto já está guardado.
    settleRef.current();
    const once = async (): Promise<SaveOutcome> => {
      const path = current.current;
      const text = pending.current;
      if (!path || text === null) return "clean";
      if (goneRef.current) return "error";
      const submitted = frontmatter.current + text;
      let r: SaveResult & { content?: string };
      try {
        r = await api.save(path,
          submitted, version.current,
          baseContent.current,
        );
      } catch (e) {
        setSaveFailed(errorCode(e) === "E_DISK_FULL" ? "disk-full" : "error");
        return "error";
      }
      if (!r.saved) {
        // O engine já tentou juntar (T5454). Se ainda assim deu certo aqui (um engine antigo), aplica e grava de novo.
        if (current.current !== path) return "conflict";
        const merged = merge3(baseContent.current, submitted, r.current.content);
        if (merged.clean) {
          applyMerged(r.current, merged.text);
          return "saved";
        }
        setConflict({ note: r.current, merge: merged });
        return "conflict";
      }
      if (current.current !== path) return "saved";
      const savedContent = r.content ?? submitted;
      // A gravação da própria janela volta pelo onChanged antes da resposta do save, e o applyMerged já deixa o
      // pending em null quando o disco tem o texto dela (T6374). Null aqui não é digitação: é tudo gravado.
      const typing = pending.current !== null && pending.current !== text;
      const latest =
        pending.current === null
          ? submitted
          : frontmatter.current + pending.current;
      const displayContent = typing
        ? (mergeNoteEdit(submitted, latest, savedContent) ?? latest)
        : savedContent;
      const display = splitFrontmatter(displayContent);
      version.current = r.meta.version;
      baseContent.current = savedContent;
      setFrontmatter(display.frontmatter);
      setSaveFailed(false);
      setConflict(null);
      pending.current = typing ? display.body : null;
        if (!undecided.current) {
        if (typing)
          drafts.set({
            path,
            body: display.body,
            frontmatter: display.frontmatter,
            baseVersion: r.meta.version,
          });
        else drafts.remove(path);
      }
      if (r.content) {
        updateEditorDocument(display.body);
        setBody(display.body);
        setWords(wordCount(display.body));
      }
      setNote((old) =>
        old && old.path === path ? { ...old, ...r.meta, content: savedContent } : old,
      );
      return "saved";
    };
    queue.current = queue.current.then(once, once);
    return queue.current;
  }, [api, drafts]);

  /**
   * Antes de sair da nota (abrir outra, criar, renomear): grava, e só deixa sair com tudo gravado. Com conflito ou erro,
   * fica na nota com o aviso na tela, para a pessoa escolher; trocar de nota nunca descarta texto calado.
   */
  const leave = useCallback(async (): Promise<boolean> => {
    // O quadro aberto grava primeiro; com conflito ou erro, fica nele com o aviso.
    if (boardFlush.current && !(await boardFlush.current())) return false;
    // O texto aberto no view de arquivo também (T7105).
    if (fileFlush.current && !(await fileFlush.current())) return false;
    for (let i = 0; i < 3; i++) {
      const outcome = await save();
      if (outcome === "conflict" || outcome === "error") {
        setPalette(false);
        requestAnimationFrame(() => document.querySelector(".kn-save-alert")?.scrollIntoView({ block: "nearest" }),
        );
        return false;
      }
      if (pending.current === null) return true;
    }
    return false;
  }, [save]);

  /** "Descartar a edição": volta ao que está no disco (ou a nenhuma nota, se ela sumiu). */
  const discard = useCallback(() => {
    const path = current.current;
    pending.current = null;
    if (!path) return;
    drafts.remove(path);
    const close = () => {
      current.current = null;
      setNote(null);
      setSaveFailed(false);
      markGone(false);
    };
    if (goneRef.current) return close();
    api.get(path).then(show, close);
  }, [api, drafts, show]);

  /** "Recuperar como nota nova" (T7513): a nota aberta sumiu fora; o texto do editor vira uma nota na mesma pasta. */
  const recoverGone = async () => {
    const path = current.current;
    if (!path || pending.current === null) return;
    const text = frontmatter.current + pending.current;
    const n = await api
      .create(noteName(path), folderOf(path) || undefined, text)
      // A pasta pode ter sumido junto: vai para a Caixa de entrada, como o rascunho órfão.
      .catch(() => api.create(noteName(path), INBOX, text))
      .catch(() => null);
    if (!n || current.current !== path) return; // o aviso fica: dá para tentar de novo
    drafts.remove(path);
    await refresh();
    show(n);
  };

  const open = useCallback(
    async (path: string) => {
      if (!(await leave())) return;
      const n = await api.get(path).catch(() => null);
      if (n) show(n);
      setPalette(false);
      setTreeOpen(false);
      setBackOpen(false);
    },
    [api, leave, show],
  );

  /** Abre o quadro branco (T6600) no lugar da nota. */
  const openCanvas = useCallback(
    async (p: string) => {
      if (!(await leave())) return;
      setFocusMode(false);
      setBoard(p);
      setView("canvas");
      setPalette(false);
      setTreeOpen(false);
      setBackOpen(false);
    },
    [leave],
  );

  /** Abre um arquivo que não é nota no lugar da nota (T7103): o visualizador do tipo, ou o aviso com o app padrão. */
  const openFileView = useCallback(
    async (p: string) => {
      if (!(await leave())) return;
      setFocusMode(false);
      setFileOpen(p);
      setView("file");
      setPalette(false);
      setTreeOpen(false);
      setBackOpen(false);
    },
    [leave],
  );

  const create = useCallback(
    async (wanted: string, focusTitle = false, folder?: string, template?: string,
    ) => {
      if (!(await leave())) return;
      const n = await api.create(wanted, folder || undefined, undefined, template).catch(() => null);
      setPalette(false);
      setTreeOpen(false);
      if (!n) return;
      await refresh();
      show(n);
      requestAnimationFrame(() => {
        if (focusTitle) (document.querySelector(".kn-title") as HTMLInputElement | null)?.select();
        else focusEditor();
      });
    },
    [api, leave, refresh, show],
  );

  // Abre o vault e a primeira nota (a Caixa de entrada, se existir). Tira os rascunhos velhos.
  useEffect(() => {
    drafts.prune();
    api.list().then(
      (l) => {
        setListing(l);
        const have = new Set(l.notes.map((n) => n.path));
        setOrphans(drafts.all().filter((d) => !have.has(d.path)));
        // `?note=` (Vite no navegador, testes): abre essa nota. No app a página carrega sem query. No hub, a nota que
        // outra seção pediu (Reuniões, T4947) antes de as Notas montarem.
        const asked = openRequestRef.current?.path ?? new URLSearchParams(location.search).get("note");
        if (asked && /\.canvas$/i.test(asked) && api.canvas && l.files?.some((f) => f.path === asked)) {
          void openCanvas(asked);
          return;
        }
        // Um arquivo que não é nota, pedido pelo caminho: abre no view de arquivo (T7103).
        if (asked && api.files?.read && l.files?.some((f) => f.path === asked)) {
          void openFileView(asked);
          return;
        }
        const first =
          l.notes.find((n) => n.path === asked) ??
          l.notes.find((n) => n.path === "Caixa de entrada.md") ??
          [...l.notes].sort((a, b) => b.mtime.localeCompare(a.mtime))[0];
        if (first) void open(first.path);
      },
      () => setFailed(true),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  // Mudou no disco (pelo app ou fora dele, no Obsidian): a lista, os links e os backlinks se refazem. A nota aberta só
  // recarrega se não tem nada pendente; com edição pendente, o próximo save mostra o conflito.
  useEffect(
    () =>
      api.onChanged((paths) => {
        // O rascunho do que foi digitado antes de olhar o disco (T7876): a nota pode ter sumido fora (T7513).
        settleRef.current();
        setVaultVersion((n) => n + 1);
        void (async () => (await patchListing(paths)) ?? (await refresh()))().then((l) => {
          if (!l) return;
          // Nota que sumiu (apagada ou renomeada fora) leva o rascunho junto (#1525). A aberta com edição pendente fica:
          // o texto ainda está no editor, e o aviso de erro do save deixa a pessoa decidir.
          const have = new Set(l.notes.map((n) => n.path));
          for (const p of paths) if (!have.has(p) && !(p === current.current && pending.current !== null)) drafts.remove(p);
        });
        links.clear();
        const path = current.current;
        if (!path) return;
        api.backlinks(path).then(setBacklinks, () => {});
        if (!paths.includes(path)) return;
        api.get(path).then(
          (n) => {
            if (current.current !== path) return;
            // Voltou (desfeito no Finder, renomeada de volta): o aviso sai e o texto segue para o disco.
            if (goneRef.current) {
              markGone(false);
              if (n.version === version.current) {
                void save();
                return;
              }
            }
            if (n.version === version.current) return;
            const local =
              frontmatter.current +
              (pending.current ?? splitFrontmatter(baseContent.current).body);
            if (pending.current === null || undecided.current) {
              if (pending.current === null) show(n, true);
              return;
            }
            // Com edição por gravar (T5454): junta a de fora com a minha. Limpo, segue escrevendo; senão, o aviso
            // mostra só os trechos que os dois mudaram.
            const merged = mergeNoteEdit(baseContent.current, local, n.content);
            if (merged !== null) {
              applyMerged(n, merged);
              return;
            }
            const m = merge3(baseContent.current, local, n.content);
            if (!m.clean) setConflict({ note: n, merge: m });
          },
          () => {
            // Apagada ou renomeada fora: a janela fica sem nota aberta. Com texto por gravar, fica nela com o aviso (T7513).
            if (current.current !== path) return;
            if (pending.current !== null) {
              clearTimeout(timer.current);
              markGone(true);
              return;
            }
            current.current = null;
            setNote(null);
          },
        );
      }),
    [api, drafts, links, patchListing, refresh, show],
  );

  // No hub (T2121) as Notas ficam montadas e escondidas nas outras seções: as teclas só valem com elas na tela (T2200).
  useEffect(() => {
    if (!openRequest || openRequest.n === handledRequest.current) return;
    handledRequest.current = openRequest.n;
    void open(openRequest.path);
  }, [openRequest, open]);

  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    if (!active) {
      setPalette(false);
      setTreeOpen(false);
      setBackOpen(false);
    }
  }, [active]);

  const selectedFolderRef = useRef(selectedFolder);
  selectedFolderRef.current = selectedFolder;
  const shortcuts = useShortcuts() ?? DEFAULT_SHORTCUTS;
  // E13 (T6385): o modo foco esconde a árvore e as barras; a máquina de escrever centraliza a linha do cursor.
  const [focusMode, setFocusMode] = useState(false);
  const [typewriter, setTypewriter] = useState(false);
  const toggleFocus = () => {
    if (view !== "note") return;
    setTreeOpen(false);
    setFocusMode((f) => !f);
  };
  const toggleTypewriter = () => {
    if (view !== "note") return;
    setTypewriter((t) => !t);
  };
  const togglesRef = useRef({ toggleFocus, toggleTypewriter });
  togglesRef.current = { toggleFocus, toggleTypewriter };
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;
  /** "Nova nota (⌘N)", com o atalho que valer agora; sem nada quando desligado. */
  const withKey = (label: string, id: "palette" | "newNote" | "dailyNote") =>
    shortcuts[id] === null ? label : `${label} (${shortcutLabel(shortcuts[id])})`;
  /** A nota do dia pelo ⇧⌘D (o `openDaily` vem mais abaixo). */
  const openDailyRef = useRef<() => Promise<void>>(async () => {});

  // ⌘K busca, ⌘N cria (na pasta escolhida), ⇧⌘D abre a nota do dia: os padrões, que a pessoa troca nas Configurações
  // (T5349). Ao esconder a janela, grava o que estiver pendente.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // O editor já usou a tecla (o ⌘K com texto selecionado vira link, E1): a paleta não abre por cima.
      if (!activeRef.current || e.defaultPrevented) return;
      const s = shortcutsRef.current;
      if (matchesKeyEvent(s.dailyNote, e)) void openDailyRef.current();
      else if (matchesKeyEvent(s.palette, e)) {
        // Síncrono: a busca já está com o foco antes da próxima tecla (quem digita rápido não escreve na nota).
        setPaletteQuery("");
        flushSync(() => setPalette((p) => !p));
      }
      else if (matchesKeyEvent(s.newNote, e)) void create("Sem título", true, selectedFolderRef.current);
      else if (matchesKeyEvent(s.focusMode, e)) togglesRef.current.toggleFocus();
      else if (matchesKeyEvent(s.typewriter, e)) togglesRef.current.toggleTypewriter();
      else return;
      e.preventDefault();
    };
    const onHide = () => document.visibilityState === "hidden" && void save();
    // Fechar a janela no meio da digitação: o rascunho vai antes (T7876).
    const onPageHide = () => settleRef.current();
    window.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [create, save]);

  /** Faz agora o que esperava a pessoa parar de digitar: as palavras e o rascunho. Sem nada esperando, não faz nada. */
  settleRef.current = () => {
    if (settleTimer.current === undefined) return;
    clearTimeout(settleTimer.current);
    settleTimer.current = undefined;
    const doc = pending.current;
    if (doc === null) return;
    setWords(wordCount(doc));
    if (current.current && !undecided.current)
      drafts.set({ path: current.current, body: doc, frontmatter: frontmatter.current, baseVersion: version.current });
  };

  const onChange = (doc: string) => {
    // A nota que não é UTF-8 só é lida (T7575): nada fica por gravar, nem vira rascunho.
    if (readOnlyRef.current) return;
    pending.current = doc;
    // As palavras e o rascunho quando a pessoa para (T7876); o rascunho sobrevive a um fechamento que o save não alcançou.
    // Com o teto SETTLE_MAX_MS: digitando sem parar, eles rodam assim mesmo.
    const now = Date.now();
    if (settleTimer.current === undefined) settleSince.current = now;
    if (now - settleSince.current >= SETTLE_MAX_MS) settleRef.current();
    else {
      clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(() => settleRef.current(), SETTLE_MS);
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), SAVE_AFTER_MS);
  };

  /** Uma edição do painel de propriedades (T6598): o frontmatter novo grava junto com o corpo de agora. */
  const onProperties = (text: string) => {
    if (text === frontmatter.current || readOnlyRef.current) return;
    setFrontmatter(text);
    if (pending.current === null) pending.current = splitFrontmatter(baseContent.current).body;
    if (current.current && !undecided.current)
      drafts.set({ path: current.current, body: pending.current, frontmatter: text, baseVersion: version.current });
    void save();
  };
  const addNoteProperty = () => {
    if (view !== "note") return;
    const added = addProperty(frontmatter.current);
    if (!added) return failed_("adicionar uma propriedade: o frontmatter desta nota não é YAML válido")(null);
    onProperties(added.frontmatter);
    setNewProperty(added.key);
  };

  /** Um arquivo do vault que não é nota, pela árvore ou por um `[[link]]` (T7616). */
  const openVaultFile = (p: string) => {
    // O quadro branco abre no Kiwi (T6600); o resto, no app padrão do Mac.
    if (api.canvas && /\.canvas$/i.test(p)) return void openCanvas(p);
    // O tipo que tem visualizador abre nas Notas (T7103, spec #7079).
    if (api.files?.read && viewerFor(p)) return void openFileView(p);
    setTreeOpen(false);
    api.files?.open(p).catch(failed_("abrir o arquivo"));
  };

  const onOpenLink = async (target: string) => {
    const hash = target.indexOf("#");
    const name = hash < 0 ? target : target.slice(0, hash);
    const heading = hash < 0 ? "" : target.slice(hash + 1);
    const path = name ? await api.resolve(name).catch(() => null) : current.current;
    const file = path || !name ? null : fileOf(name);
    if (path) {
      if (path !== current.current) await open(path);
      if (heading && current.current === path) setHeadingJump((previous) => ({ path, heading, sequence: (previous?.sequence ?? 0) + 1 }));
    }
    else if (file) openVaultFile(file);
    else if (api.extras) {
      if (!(await leave())) return;
      const n = await api.extras.createFromLink(name, current.current ?? undefined).catch(() => null);
      if (!n) return;
      setTreeOpen(false);
      setBackOpen(false);
      await refresh();
      show(n);
      requestAnimationFrame(() => focusEditor());
    } else if (name) await create(name);
  };

  /** A nota do dia (T2593): abre a de hoje, criando se ainda não existe. */
  const openDaily = useCallback(async () => {
    const extras = api.extras;
    if (!extras || !(await leave())) return;
    const n = await extras.daily().catch(() => null);
    if (!n) return;
    setTreeOpen(false);
    setBackOpen(false);
    await refresh();
    show(n);
    requestAnimationFrame(() => focusEditor());
  }, [api, leave, refresh, show]);
  openDailyRef.current = openDaily;

  // O número da Lixeira, na lateral.
  useEffect(() => {
    api.extras?.trashList().then((items) => setTrashCount(items.length), () => {},
    );
  }, [api, vaultVersion]);

  const rename = async () => {
    const typed = title.trim().replace(/[\\/:]/g, "-");
    // `# ^ | [ ]` quebram os [[links]] para a nota (T7520): viram espaço, e o aviso diz.
    const wanted = linkSafeName(typed);
    const cleaned = wanted !== typed ? LINK_SAFE_NOTE : "";
    if (!note || !wanted || wanted === note.title) {
      setTitle(note?.title ?? "");
      if (note && cleaned) say(`O nome continua “${note.title}”${cleaned}.`);
      return;
    }
    const original = note.path, opened = shown.current;
    if (!(await leave())) return setTitle(note.title);
    if (current.current !== original) return;
    const r = await api.rename(note.path, `${note.folder ? `${note.folder}/` : ""}${wanted}.md`).catch(() => null);
    if (!r) return setTitle(note.title); // já existe uma nota com esse nome
    const n = await api.get(r.meta.path).catch(() => null);
    if (n && pending.current === null && (current.current === original || (current.current === null && shown.current === opened))) show(n);
    const done = cleaned ? `Nota renomeada para “${noteName(r.meta.path)}”${cleaned}.` : "Nota renomeada.";
    say(r.skippedPaths?.length ? `${done} Confira os links em: ${r.skippedPaths.join(", ")}.` : `${done} ${r.updatedLinks} ${r.updatedLinks === 1 ? "link atualizado" : "links atualizados"}.`);
    void refresh();
  };

  const reportRefactor = (r: RefactorResult) => {
    const summary = `${r.updatedReferences} ${r.updatedReferences === 1 ? "referência atualizada" : "referências atualizadas"} em ${r.updatedNotes} ${r.updatedNotes === 1 ? "nota" : "notas"}.`;
    say(r.skippedPaths.length ? `${summary} Confira as notas que não puderam ser atualizadas por completo: ${r.skippedPaths.join(", ")}.` : summary);
    void refresh();
  };
  const performRefactor = async (name: string) => {
    const chosen = refactor;
    if (!chosen) return;
    if (!(await leave())) throw Object.assign(new Error("unsaved changes"), { code: "E_CONFLICT" });
    if (chosen.kind === "tag") {
      if (!api.renameTag) throw new Error("unavailable");
      reportRefactor(await api.renameTag(chosen.name, name));
    } else {
      if (!api.renameHeading || current.current !== chosen.path) throw Object.assign(new Error("note changed"), { code: "E_CONFLICT" });
      const source = await api.get(chosen.path), split = splitFrontmatter(source.content);
      if (split.body !== chosen.source) throw Object.assign(new Error("note changed"), { code: "E_CONFLICT" });
      reportRefactor(await api.renameHeading(chosen.path, split.frontmatter.length + chosen.offset, name, source.version));
    }
  };

  /** Resolve os trechos que bateram com um lado (T5454): o resto do que os dois mudaram já está junto. */
  const resolveConflict = (side: "mine" | "theirs") => {
    if (!conflict) return;
    const n = conflict.note;
    setConflict(null);
    // De novo com o texto de agora: o que a pessoa escreveu com o aviso aberto não se perde.
    const local = frontmatter.current + (pending.current ?? splitFrontmatter(baseContent.current).body);
    const merge = merge3(baseContent.current, local, n.content);
    applyMerged(n, merge.clean ? merge.text : merge.resolve(side));
    if (pending.current !== null) void save();
  };

  /** "Recuperar": o rascunho volta ao editor e grava por cima do que está no disco (a pessoa escolheu). */
  const recoverDraft = () => {
    const d = undecided.current;
    if (!d) return;
    undecided.current = null;
    setDraft(null);
    // As propriedades do rascunho voltam junto (T7516); o de antes do T1550 fica com as do disco.
    if (d.frontmatter !== undefined) setFrontmatter(d.frontmatter);
    pending.current = d.body;
    setBody(d.body);
    setDocKey(`${d.path}@rascunho@${d.at}`);
    void save();
  };

  const dropDraft = () => {
    const d = undecided.current;
    undecided.current = null;
    setDraft(null);
    if (d) drafts.remove(d.path);
  };

  const recoverOrphan = async (d: Draft) => {
    // Com o frontmatter de quando a edição começou: as tags e as propriedades vêm junto (#1538).
    const n = await api.create(noteName(d.path), INBOX, (d.frontmatter ?? "") + d.body).catch(() => null);
    if (!n) return; // o aviso fica: dá para tentar de novo
    drafts.remove(d.path);
    setOrphans((o) => o.filter((x) => x !== d));
    await refresh();
    await open(n.path);
  };

  const dropOrphan = (d: Draft) => {
    drafts.remove(d.path);
    setOrphans((o) => o.filter((x) => x !== d));
  };


  // ---------------------------------------------------------------- o básico de app de notas (T2469)

  const folders = api.folders;
  const pins = api.pins;
  useEffect(() => {
    pins?.list().then(setPinned, () => {});
  }, [pins]);
  const projectsApi = api.projects;
  const reloadProjects = () => void projectsApi?.list().then(setProjectList, () => {});
  // Relê quando os projetos mudam por outro lugar (a CLI, outra janela), e quando as notas mudam: a nota principal
  // apagada ou a pasta renomeada por fora o engine já corrigiu.
  useEffect(() => {
    if (!projectsApi) return;
    reloadProjects();
    const offs = [projectsApi.onChanged(reloadProjects), api.onChanged(() => reloadProjects())];
    return () => offs.forEach((off) => off());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectsApi, api]);
  const projectByFolder = useMemo(() => new Map(projectList.projects.map((x) => [x.folder, x] as const)), [projectList]);
  const projectMains = useMemo(() => new Set(projectList.projects.flatMap((x) => (x.main ? [x.main] : []))), [projectList]);
  const insideOrIs = (folder: string, p: string) => p === folder || p.startsWith(`${folder}/`);
  /** Pode virar projeto: não a raiz, não a pasta das reuniões (nem dentro dela), nem dentro ou em volta de outro. */
  const canMark = (folder: string) =>
    !!folder &&
    !(projectList.meetingsFolder && insideOrIs(projectList.meetingsFolder, folder)) &&
    !projectList.projects.some((x) => insideOrIs(x.folder, folder) || insideOrIs(folder, x.folder));
  const projectAction = (what: string, run: () => Promise<unknown>) =>
    void run().then(
      () => reloadProjects(),
      (e) => {
        const code = errorCode(e);
        say(
          code === "E_NESTED"
            ? `Não deu para ${what}: um projeto não fica dentro de outro.`
            : code === "E_MEETINGS_FOLDER"
              ? `Não deu para ${what}: a pasta das reuniões não pode ser um projeto.`
              : `Não deu para ${what}.`,
        );
      },
    );

  const say = (text: string, undo?: () => void) => setToast({ text, undo });
  const failed_ = (what: string) => (e: unknown) => say(`Não deu para ${what}${errorCode(e) === "E_EXISTS" ? ": já existe um com esse nome" : ""}.`,
    );

  /** Depois de mexer no vault: a lista de novo, e a nota aberta reaberta no lugar novo, se ela mudou de path. */
  const after = async (moved?: { from: string; to: string }) => {
    await refresh();
    links.clear();
    // O engine corrige as fixadas (renomear, mover, apagar); a janela só relê.
    pins?.list().then(setPinned, () => {});
    reloadProjects();
    // A pasta escolhida acompanha o renomear e o mover (T3371): a "Nova pasta" que virou "Ideias" continua sendo onde
    // o + Nota e o + Pasta criam.
    if (moved) {
      const follow = (f: string) =>
        f === moved.from ? moved.to : f.startsWith(`${moved.from}/`) ? moved.to + f.slice(moved.from.length) : f;
      setSelectedFolder(follow);
      setOpenFolders((o) => new Set([...o].map(follow)));
    }
    if (!moved || !current.current) return;
    const cur = current.current;
    const to = cur === moved.from ? moved.to : cur.startsWith(`${moved.from}/`) ? moved.to + cur.slice(moved.from.length) : null;
    if (to) {
      current.current = null; // a nota velha não existe mais; o leave não tenta gravar nela
      const n = await api.get(to).catch(() => null);
      if (n) show(n);
    }
  };

  const newFolder = async (parent: string) => {
    if (!folders) return;
    const taken = new Set((listing?.folders ?? []).filter((f) => folderOf(f) === parent).map((f) => f.slice(f.lastIndexOf("/") + 1)),
    );
    const r = await folders.create(join(parent, freeName("Nova pasta", taken))).catch(failed_("criar a pasta"));
    if (!r) return;
    await after();
    setOpenFolders((o) => new Set([...o, ...ancestors(`${r.path}/x`)]));
    setSelectedFolder(r.path);
    setRenaming(`f:${r.path}`);
  };

  const renameItem = async (target: SideTarget, name: string | null) => {
    setRenaming(null);
    if (!name || target.kind === "empty") return;
    const clean = name.replace(/[\\/:]/g, "-");
    if (target.kind === "note") {
      const safe = linkSafeName(clean); // T7520: sem `# ^ | [ ]`, que quebram os [[links]]
      if (!safe || safe === noteName(target.path)) return;
      if (current.current === target.path && !(await leave())) return;
      const r = await api.rename(target.path, `${join(folderOf(target.path), safe)}.md`).catch(failed_("renomear a nota"));
      if (r) await after({ from: target.path, to: r.meta.path });
      if (r && safe !== clean) say(`Nota renomeada para “${noteName(r.meta.path)}”${LINK_SAFE_NOTE}.`);
    } else if (folders) {
      if (current.current?.startsWith(`${target.path}/`) && !(await leave())) return;
      const r = await folders.rename(target.path, join(folderOf(target.path), clean)).catch(failed_("renomear a pasta"));
      if (r) await after({ from: target.path, to: r.path });
    }
  };

  const moveItem = async (target: SideTarget, folder: string) => {
    setMoving(null);
    if (!folders || target.kind === "empty") return;
    if (target.kind === "note") {
      if (folderOf(target.path) === folder) return;
      if (current.current === target.path && !(await leave())) return;
      const r = await folders.moveNote(target.path, folder).catch(failed_("mover a nota"));
      if (r) await after({ from: target.path, to: r.meta.path });
    } else {
      if (folder === target.path || folder.startsWith(`${target.path}/`) || folderOf(target.path) === folder) return;
      if (current.current?.startsWith(`${target.path}/`) && !(await leave())) return;
      const r = await folders.move(target.path, folder).catch(failed_("mover a pasta"));
      if (r) await after({ from: target.path, to: r.path });
    }
  };

  const duplicate = async (path: string) => {
    const n = await folders?.duplicateNote(path).catch(failed_("duplicar a nota"));
    if (!n) return;
    await after();
    await open(n.path);
  };

  /** "Versões…" (T2680): grava o que estiver pendente (a versão de agora entra no histórico) e abre o diálogo. */
  const openVersions = async (path: string) => {
    if (current.current === path && !(await leave())) return;
    const n = await api.get(path).catch(() => null);
    if (n) setVersionsOf({ path, title: n.title, content: n.content });
  };

  /**
   * Exportar (T2684): grava o que estiver pendente, e o engine abre o seletor de pasta (só aqui, no clique). O HTML e
   * o PDF saem com as cores de agora: as variáveis CSS que a Aparência pôs no <html>.
   */
  const exportNote = async (path: string, format: ExportFormat) => {
    setExporting(null);
    const ex = api.export;
    if (!ex) return;
    if (current.current === path && !(await leave())) return;
    const theme: Record<string, string> = {};
    const style = document.documentElement.style;
    for (let i = 0; i < style.length; i++) {
      const k = style.item(i);
      if (k.startsWith("--")) theme[k] = style.getPropertyValue(k).trim();
    }
    try {
      const { file } = await ex(path, format, theme);
      say(`Exportada: ${file.slice(file.lastIndexOf("/") + 1)}`);
    } catch (e) {
      if (errorCode(e) === "E_CANCELED") return;
      failed_("exportar a nota")(e);
    }
  };

  /** Apagar vai para a Lixeira do macOS, com "Desfazer" no aviso de baixo. */
  const remove = async (target: SideTarget) => {
    if (target.kind === "empty") return;
    const isOpen = current.current === target.path || (target.kind === "folder" && !!current.current?.startsWith(`${target.path}/`));
    if (isOpen) {
      // O que estava sendo editado grava antes; se não der, não apaga.
      if (!(await leave())) return;
      current.current = null;
      setNote(null);
    }
    const name = target.path.slice(target.path.lastIndexOf("/") + 1).replace(/\.md$/, "");
    // O engine tira das fixadas o que foi apagado; o Desfazer põe de volta.
    const wasPinned = pinned.filter((p) => p === target.path || (target.kind === "folder" && p.startsWith(`${target.path}/`)),
    );
    const r =
      target.kind === "note"
        ? await api.delete(target.path).catch(failed_("apagar a nota"))
        : await folders?.delete(target.path).catch(failed_("apagar a pasta"));
    if (!r) return;
    await after();
    // O engine guarda o apagado por 10 min antes da Lixeira (#2493); o aviso dura 8 s, então o Desfazer sempre chega a tempo.
    say(
      `“${name}” foi para a Lixeira.`,
      folders
        ? () =>
            void folders.restore(target.path).then(
              async (back) => {
                if (wasPinned.length && pins) {
                  const now = await pins.list().catch(() => []);
                  await pins.set([...new Set([...now, ...wasPinned])]).then(setPinned, () => {});
                }
                await after();
                if (target.kind === "note") await open(back.path);
              },
              failed_("desfazer"))
        : undefined,
    );
  };

  const togglePin = async (path: string) => {
    if (!pins) return;
    const next = pinned.includes(path) ? pinned.filter((p) => p !== path) : [...pinned, path];
    setPinned(await pins.set(next).catch(() => pinned));
  };

  const copyLink = (path: string) => {
    const paths = (listing?.notes ?? []).map((n) => n.path);
    void appApi.copy(`[[${linkTextFor(path, paths)}]]`).then(
      () => say("Link copiado."),
      () => say("Não deu para copiar o link."),
    );
  };

  const sort = (by: SortBy) => {
    setSortBy(by);
    try {
      localStorage.setItem(SORT_KEY, by);
    } catch {}
  };

  /** O menu de botão direito, para uma nota, uma pasta ou a área vazia. */
  const menuFor = (t: SideTarget): MenuItem[] => {
    const sortItems: MenuItem[] = [
      { kind: "title", label: "Ordenar por" },
      { label: "Nome", checked: sortBy === "name", onSelect: () => sort("name"),
      },
      { label: "Edição", checked: sortBy === "edited", onSelect: () => sort("edited"),
      },
      { label: "Criação", checked: sortBy === "created", onSelect: () => sort("created"),
      },
    ];
    if (t.kind === "empty") {
      return [
        ...(folderController?.supported ? [
          {label:"Abrir pasta…",onSelect:()=>{void leave().then(async ok=>{if(ok)await folderController.open();});}},
          ...(folderController.view?.recent??[]).map(r=>({label:`Abrir ${r.name}`,onSelect:()=>{void leave().then(async ok=>{if(ok)await folderController.open(r.key);});}})),
          {kind:"separator" as const},
        ]:[]),
        { label: "Nova nota", hint: shortcuts.newNote === null ? undefined : shortcutLabel(shortcuts.newNote), onSelect: () => void create("Sem título", true, ""),
        },
        ...(api.templates ? [{ label: "Nova nota a partir de modelo…", onSelect: () => fromTemplate(""),
              },
            ] : []),
        ...(api.canvas ? [{ label: "Novo quadro branco", onSelect: () => void newCanvas("") }] : []),
        ...(folders ? [{ label: "Nova pasta", onSelect: () => void newFolder("") }] : []),
        { kind: "separator" },
        ...sortItems,
      ];
    }
    if (t.kind === "folder") {
      return [
        { label: "Nova nota aqui", onSelect: () => void create("Sem título", true, t.path),
        },
        ...(api.templates ? [{ label: "Nova nota a partir de modelo…", onSelect: () => fromTemplate(t.path),
              },
            ] : []),
        ...(api.canvas ? [{ label: "Novo quadro branco aqui", onSelect: () => void newCanvas(t.path) }] : []),
        { label: "Nova pasta aqui", onSelect: () => void newFolder(t.path), disabled: !folders,
        },
        { kind: "separator" },
        { label: "Renomear", onSelect: () => setRenaming(`f:${t.path}`), disabled: !folders,
        },
        { label: "Mover para…", onSelect: () => setMoving(t), disabled: !folders,
        },
        { label: "Mostrar no Finder", onSelect: () => void folders?.reveal(t.path).catch(failed_("mostrar no Finder")), disabled: !folders,
        },
        // Os projetos (spec #9847): só o que o engine aceitaria aparece no menu.
        ...(projectsApi && projectByFolder.has(t.path)
          ? [
              { kind: "separator" as const },
              // Pelo teclado, o caminho até a escolha da nota principal apagada (o aviso é só do mouse).
              ...(projectByFolder.get(t.path)!.main === null && menu
                ? [{ label: "Escolher a nota principal…", onSelect: () => setProjectPick({ x: menu.x, y: menu.y, folder: t.path }) }]
                : []),
              { label: "Deixar de ser projeto", onSelect: () => projectAction("deixar de ser projeto", () => projectsApi.unmark(t.path)) },
            ]
          : projectsApi && canMark(t.path)
            ? [{ kind: "separator" as const }, { label: "Marcar como projeto", onSelect: () => projectAction("marcar como projeto", () => projectsApi.mark(t.path)) }]
            : []),
        { kind: "separator" },
        { label: "Apagar", danger: true, onSelect: () => void remove(t), disabled: !folders,
        },
      ];
    }
    const isPinned = pinned.includes(t.path);
    return [
      { label: "Abrir", onSelect: () => void open(t.path) },
      { label: isPinned ? "Desafixar" : "Fixar", onSelect: () => void togglePin(t.path), disabled: !pins,
      },
      ...(() => {
        // A nota dentro de um projeto, que ainda não é a principal (spec #9847).
        const project = projectsApi ? projectList.projects.find((x) => insideOrIs(x.folder, t.path)) : undefined;
        return project && project.main !== t.path
          ? [{ label: "Usar como nota principal", onSelect: () => projectAction("trocar a nota principal", () => projectsApi!.setMain(project.folder, t.path)) }]
          : [];
      })(),
      { kind: "separator" },
      { label: "Renomear", onSelect: () => setRenaming(`n:${t.path}`) },
      ...(api.meetings && note?.path === t.path && isMeetingNote(note.content)
        ? [
            {
              label: "Renomear falante…",
              onSelect: () => {
                void leave()
                  .then(async (ok) => {
                    if (!ok) return;
                    const speakers = await api.meetings!.speakers(t.path);
                    if (speakers.length)
                      setSpeakerDialog({ path: t.path, speakers });
                    else say("Ainda não há falantes nesta reunião.");
                  })
                  .catch(failed_("ler os falantes"));
              },
            },
          ]
        : []),
      { label: "Duplicar", onSelect: () => void duplicate(t.path), disabled: !folders,
      },
      { label: "Mover para…", onSelect: () => setMoving(t), disabled: !folders,
      },
      { label: "Copiar link [[…]]", onSelect: () => copyLink(t.path) },
      ...(api.versions ? [{ label: "Versões…", onSelect: () => void openVersions(t.path) }] : []),
      ...(api.export ? [{ label: "Exportar…", onSelect: () => setExporting(t.path) }] : []),
      { label: "Mostrar no Finder", onSelect: () => void folders?.reveal(t.path).catch(failed_("mostrar no Finder")), disabled: !folders,
      },
      { kind: "separator" },
      { label: "Apagar", danger: true, onSelect: () => void remove(t) },
    ];
  };

  // ---------------------------------------------------------------- tags e modelos (T2619)

  const openPalette = (q = "") => {
    setPaletteQuery(q);
    setPalette(true);
  };

  const openTag = (tag: string) => {
    setTreeOpen(false);
    setBackOpen(false);
    openPalette(`tag:${tag}`);
  };

  const fromTemplate = (folder: string, insert = false) => {
    setPalette(false);
    api.templates?.().then(
      (r) =>
        r.templates.length
          ? setPicking({ folder, templates: r.templates, insert })
          : say(`Nenhum modelo ainda. As notas da pasta “${r.folder}” viram modelos.`,
              ),
      failed_("ler os modelos"),
    );
  };

  useEffect(() => {
    api.savedSearches?.list().then(setSaved, () => {});
  }, [api]);

  // As preferências da árvore e os outros arquivos do cofre (T3370): um anexo novo ou apagado por fora refaz a lista.
  useEffect(() => {
    api.prefs?.get().then(setPrefs, () => {});
    const offs = [api.prefs?.onChanged(setPrefs), api.files?.onChanged(() => void refresh()),
    ];
    return () => offs.forEach((off) => off?.());
  }, [api, refresh]);

  const setSavedList = (list: SavedSearch[]) => {
    const sv = api.savedSearches;
    if (!sv) return;
    sv.set(list).then(setSaved, failed_("guardar a busca"));
  };

  /** Guarda a busca do ⌘K na árvore (o nome é a própria busca; repetida, não duplica). */
  const saveSearch = (query: string) => {
    const q = query.trim();
    if (!q || !saved) return;
    setPalette(false);
    if (saved.some((s) => s.query === q)) return say("Essa busca já está salva.");
    setSavedList([...saved, { name: q, query: q }]);
    say(`Busca salva: “${q}”. Ela fica na árvore.`);
  };

  /** "Novo quadro branco" (T6600): um `.canvas` vazio na pasta, aberto na hora, com o nome pronto para trocar. */
  const newCanvas = async (folder: string) => {
    if (!api.canvas || !(await leave())) return;
    try {
      const c = await api.canvas.create(folder, "Quadro sem título");
      await refresh();
      await openCanvas(c.path);
      requestAnimationFrame(() => (document.querySelector(".kn-canvas-title") as HTMLInputElement | null)?.select());
    } catch (e) {
      failed_("criar o quadro")(e);
    }
  };

  const paletteCommands = [
    ...(api.canvas ? [{ id: "canvas", title: "Novo quadro branco", words: "canvas quadro branco tela whiteboard desenho" }] : []),
    ...(api.templates ? [{ id: "template", title: "Nova nota a partir de modelo…", words: "modelo template",
          },
        ] : []),
    ...(saved ? [{ id: "save-search", title: "Salvar esta busca na árvore", withQuery: true,
          },
        ] : []),
    ...(note && view === "note" ? [
      { id: "focus", title: focusMode ? "Sair do modo foco" : "Modo foco", words: "foco concentrar distração zen esconder" },
      { id: "typewriter", title: typewriter ? "Desligar a máquina de escrever" : "Máquina de escrever", words: "máquina escrever centralizar linha typewriter" },
      { id: "add-property", title: "Adicionar propriedade", words: "propriedade frontmatter metadado campo yaml" },
    ] : []),
  ];

  const linkTargets = (): LinkTarget[] => {
    const notes = listing?.notes ?? [];
    const paths = notes.map((n) => n.path);
    return notes.filter((n) => n.path !== note?.path).map((n) => ({ title: n.title, folder: n.folder, link: linkTextFor(n.path, paths),
      }));
  };

  const fullTree = useMemo(() => (listing ? buildTree(listing, sortBy, projectMains) : []), [listing, sortBy, projectMains],
  );
  // Grava as pastas abertas; com o cofre lido, as que foram apagadas saem da lista (revisão do T7390).
  useEffect(
    () => saveOpenFolders(vaultKey, openFolders, listing ? new Set(allFolders(fullTree)) : undefined),
    [vaultKey, openFolders, listing, fullTree],
  );
  // T6011: o engine decide as notas também sem filtros (raízes PT e conteúdo); a árvore mantém a hierarquia.
  const [queryPaths, setQueryPaths] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (!query.trim()) return setQueryPaths(null);
    // Longa demais (T7791): sem chamar o engine, a árvore fica vazia e diz por quê.
    if (searchTooLong(query)) return setQueryPaths(new Set());
    setQueryPaths(null);
    let live = true;
    const t = setTimeout(() => {
      api.search(query, Math.min(100_000, Math.max(100, listing?.notes.length ?? 0))).then(
        (hits) => live && setQueryPaths(new Set(hits.map((h) => h.path))),
        () => live && setQueryPaths(new Set()),
      );
    }, 120);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [api, query, listing]);
  const found = useMemo(
    () =>
      queryPaths ? filterTreeToPaths(fullTree, queryPaths, hasFilters(parseQuery(query)) ? undefined : query) : filterTree(fullTree, query),
    [fullTree, query, queryPaths],
  );
  const openNow = useMemo(() =>
      query.trim() ? new Set([...openFolders, ...found.open]) : openFolders, [openFolders, found, query],
  );
  const byPath = useMemo(() => new Map((listing?.notes ?? []).map((n) => [n.path, n])), [listing],
  );
  const fileTimes = useMemo(() => new Map((files ?? []).map((f) => [f.path, f.mtime])), [files],
  );
  const pinnedNotes = pinned.map((p) => byPath.get(p)).filter((n) => n !== undefined);
  const recent = useMemo(() => recentNotes(listing?.notes ?? [], 5), [listing]);
  // T5298 (#211): a pasta raiz vive dentro da árvore do topo, e não num botão ao lado dela.
  const folderView = folderController?.supported ? folderController.view : null;
  const shownFolder = folderRef ?? folderView?.current;
  const rootFolder: SideRoot | undefined = folderController && folderView && shownFolder ? {
    name: shownFolder.name,
    path: shownFolder.path,
    recent: folderView.recent.filter((r) => r.key !== shownFolder.key),
    error: folderController.error || undefined,
    onOpen: (key) => {
      void leave().then(async (ok) => {
        if (!ok) return;
        setTreeOpen(false);
        await folderController.open(key);
      });
    },
  } : undefined;

  if (failed && !listing) {
    return (
      <Shell>
        <Empty title="Não deu para abrir o vault">
          <Button onClick={() => void refresh()}>Tentar de novo</Button>
        </Empty>
      </Shell>
    );
  }

  return (
    <div className="kn-notes" data-entered={entered} data-focus={focusMode && note && view === "note" ? "true" : undefined}>
      <TopBar
        start={
          <button
            ref={setCrumbEl}
            type="button"
            className="kn-float kn-crumb-bt"
            // No WebKit, como no Safari, o Tab pula os botões sem um tabIndex explícito (spec #10211): com ele, o Tab
            // chega aqui e abre a árvore, como o código do TreePopover já esperava.
            tabIndex={0}
            aria-expanded={treeOpen}
            aria-haspopup="dialog"
            title="Pastas e notas"
          >
            <TreeIcon />
            <span className="kn-crumb-label">{note?.folder ? note.folder.replace(/\//g, " / ") : "Notas"}</span>
            <Chevron />
          </button>
        }
        end={
          <span className="kn-float-group">
            <button type="button" className="kn-expand" title={withKey("Nova nota", "newNote")} aria-label="Nova nota" onClick={() => void create("Sem título", true, selectedFolderRef.current)}>
              <PenIcon />
              <HoverLabel>Nova nota</HoverLabel>
            </button>
            <button type="button" className="kn-expand" title={withKey("Buscar", "palette")} aria-label="Buscar" onClick={() => openPalette()}>
              <SearchIcon />
              <HoverLabel>Buscar</HoverLabel>
            </button>
          </span>
        }
      />
      <TreePopover open={treeOpen} onOpenChange={setTreeOpen} anchor={crumbEl} busy={Boolean(renaming || menu || moving || picking || projectPick)}>
        <Sidebar
          autoFocus={false}
          metadata={byPath}
          fileTimes={fileTimes}
          onPin={pins ? togglePin : undefined}
          projects={projectsApi ? projectByFolder : undefined}
          onProjectWarning={projectsApi ? (folder, at) => setProjectPick({ ...at, folder }) : undefined}
          tree={found.tree}
          open={openNow}
          current={note?.path ?? null}
          selectedFolder={selectedFolder}
          keys={{
            newNote: shortcuts.newNote === null ? null : shortcutLabel(shortcuts.newNote),
            dailyNote: shortcuts.dailyNote === null ? null : shortcutLabel(shortcuts.dailyNote),
          }}
          query={query}
          onQuery={setQuery}
          pinned={pinnedNotes}
          recent={recent}
          renaming={renaming}
          menuOn={menu && menu.target.kind !== "empty" ? `${menu.target.kind === "note" ? "n" : "f"}:${menu.target.path}` : null}
          onRename={(t, name) => void renameItem(t, name)}
          onSelectFolder={setSelectedFolder}
          onMenu={(at, target) => {
            // Quem abriu o menu (a linha, pelo teclado, ou o "…"): o Esc devolve o foco a ela (spec #10211).
            menuOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            setMenu({ ...at, target });
          }}
          onDrop={folders ? (what, folder) => void moveItem(what, folder) : undefined}
          onToggle={(f) => setOpenFolders((s) => toggled(s, f))}
          collapsed={collapsed}
          onSection={(id) => setCollapsed((s) => toggled(s, id))}
          onCollapseAll={() => setOpenFolders(new Set())}
          onExpandAll={() => {
            setOpenFolders(new Set(allFolders(fullTree)));
            // Expandir tudo mostra a árvore: a seção Notas abre junto, se estava recolhida.
            setCollapsed((s) => (s.has("notes") ? toggled(s, "notes") : s));
          }}
          onOpen={(p) => void open(p)}
          onOpenFile={api.files ? openVaultFile : undefined}
          onNewNote={(f) => void create("Sem título", true, f)}
          onNewFolder={folders ? (f) => void newFolder(f) : undefined}
          showExtensions={prefs.showExtensions}
          dailyFolder={prefs.dailyFolder}
          onDaily={api.extras ? () => void openDaily() : undefined}
          onTrash={
            api.extras
              ? () => {
                  setTreeOpen(false);
                  setView((v) => (v === "trash" ? "note" : "trash"));
                }
              : undefined
          }
          trashCount={trashCount}
          trashOpen={view === "trash"}
          tags={tagList}
          onTag={openTag}
          onTagMenu={api.renameTag ? (pos, tag) => setTagMenu({ ...pos, tag }) : undefined}
          saved={saved ?? undefined}
          onSaved={(q) => {
            setTreeOpen(false);
            openPalette(q);
          }}
          onUnsave={(q) => saved && setSavedList(saved.filter((s) => s.query !== q))}
          root={rootFolder}
        />
      </TreePopover>
      {/* A largura da nota vale também para o .txt aberto (spec #13382): o texto quebra na mesma coluna. */}
      <main className="kn-center" style={{ "--note-width": `${dragWidth ?? prefs.noteWidth ?? NOTE_WIDTH.default}px` } as CSSProperties}>
        {view === "canvas" && board && api.canvas ? (
          <CanvasView
            key={board}
            api={api as NotesApi & { canvas: NonNullable<NotesApi["canvas"]> }}
            path={board}
            flushRef={boardFlush}
            onOpenLink={(t) => void onOpenLink(t)}
            onOpenNote={(p) => void open(p)}
            onOpenTag={openTag}
            onOpenFile={api.files ? (p) => void api.files?.open(p).catch(failed_("abrir o arquivo")) : undefined}
            onRenamed={(p) => {
              setBoard(p);
              void refresh();
            }}
            onError={(text) => say(text)}
          />
        ) : view === "file" && fileOpen && api.files?.read ? (
          <FileView
            key={fileOpen}
            files={api.files as FilesApi}
            path={fileOpen}
            flushRef={fileFlush}
            onOpenExternal={(p) => void api.files?.open(p).catch(failed_("abrir o arquivo"))}
          />
        ) : view === "trash" && api.extras ? (
          <TrashView
            extras={api.extras}
            folders={api.folders}
            version={vaultVersion}
            onRestored={(p, kind) => {
              void refresh();
              if (kind === "note") void open(p);
            }}
          />
        ) : (
          <>
        {orphans[0] ? (
          <div className="kn-conflict kn-orphan" role="alert">
            {`Há um rascunho de “${noteName(orphans[0].path)}”, uma nota que não existe mais (renomeada ou apagada fora do Kiwi Notes).`}
            <span className="kn-conflict-actions">
              <button type="button" className="kn-bt" onClick={() => dropOrphan(orphans[0]!)}>
                Descartar
              </button>
              <button type="button" className="kn-bt kn-bt-acc" onClick={() => void recoverOrphan(orphans[0]!)}>
                Recuperar como nota nova
              </button>
            </span>
          </div>
        ) : null}
        {note ? (
          <article
            className="kn-page"
            style={{ "--note-width": `${dragWidth ?? prefs.noteWidth ?? NOTE_WIDTH.default}px` } as CSSProperties}
          >
            {api.prefs && prefs.noteWidth !== null ? (
              <NoteWidthHandles
                width={dragWidth ?? prefs.noteWidth}
                onChange={setDragWidth}
                onCommit={(px) => {
                  if (px === prefs.noteWidth) setDragWidth(null);
                  else api.prefs?.setNoteWidth(px).catch(failed_("guardar a largura da nota"));
                }}
              />
            ) : null}
            {note.folder ? (
              <div className="kn-page-crumbs" aria-label="Pasta">
                {note.folder.split("/").map((part, i) => (
                  <span key={i}>{part}</span>
                ))}
              </div>
            ) : null}
            <input
              className="kn-title"
              aria-label="Título da nota"
              value={title}
              spellCheck={false}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => void rename()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  focusEditor();
                } else if (e.key === "Escape") {
                  setTitle(note.title);
                  focusEditor();
                }
              }}
            />
            <div className="kn-meta">
              {note.tags.map((t) => (
                <button type="button" key={`#${t}`} className="kn-meta-bt" title={`Notas com #${t}`} onClick={() => openTag(t)}
                  onContextMenu={api.renameTag ? e => { e.preventDefault(); e.stopPropagation(); setTagMenu({ x: e.clientX, y: e.clientY, tag: t }); } : undefined}>
                  #{t}
                </button>
              ))}
              {[editedLabel(note), `${words} ${words === 1 ? "palavra" : "palavras"}`,
                  ].map((t) => (
                <span key={t}>{t}</span>
              ))}
              <button
                ref={backRef}
                type="button"
                className="kn-meta-bt"
                aria-expanded={backOpen}
                aria-haspopup="dialog"
                disabled={!backlinks.length && !api.extras}
                onClick={() => setBackOpen((o) => !o)}
              >
                {backlinks.length ? `citada em ${backlinks.length}` : "nenhuma nota cita esta"}
              </button>
              {backOpen && (backlinks.length || api.extras) ? (
                <Popover className="kn-back-pop" label="Citada em" anchor={backRef} onClose={() => setBackOpen(false)}>
                  {backlinks.map((b) => (
                    <button type="button" className="kn-back" key={b.path} onClick={() => void open(b.path)}>
                      <span className="kn-link">{b.title}</span>
                      <span className="kn-back-ctx">{plainContext(b.context)}</span>
                    </button>
                  ))}
                  {!backlinks.length ? (
                        <div className="kn-faint">Nenhuma nota cita esta com link.</div>
                      ) : null}
                  {/* "Mencionada sem link" (T2593): as que citam o título sem [[ ]], com o "Linkar". */}
                  {api.extras ? (
                        <UnlinkedMentions extras={api.extras} path={note.path} version={vaultVersion} onOpen={(p) => void open(p)} />
                      ) : null}
                </Popover>
              ) : null}
            </div>
            <Properties
              key={note.path}
              frontmatter={frontmatterText}
              onChange={onProperties}
              onAdd={addNoteProperty}
              onOpenTag={openTag}
              onOpenLink={(t) => void onOpenLink(t)}
              renaming={newProperty}
              onRenamingDone={clearNewProperty}
            />
            {note.readOnly ? (
              <div className="kn-conflict kn-readonly" role="status">
                Esta nota não está em UTF-8, e os caracteres que o Kiwi Notes não entendeu aparecem como �. Aqui ela só é
                lida, para eles não se perderem; para editar, salve a nota em UTF-8 no app de onde ela veio.
              </div>
            ) : null}
            {gone ? (
              <div className="kn-conflict kn-save-alert kn-gone" role="alert">
                Esta nota foi apagada ou renomeada fora do Kiwi Notes. O que você escreveu continua aqui.
                <span className="kn-conflict-actions">
                  <button type="button" className="kn-bt" onClick={discard}>
                    Descartar
                  </button>
                  <button type="button" className="kn-bt kn-bt-acc" onClick={() => void recoverGone()}>
                    Recuperar como nota nova
                  </button>
                </span>
              </div>
            ) : conflict ? (
              <div className="kn-conflict kn-save-alert kn-merge" role="alert">
                {/* T5454: o resto do que mudou fora já entrou; só os trechos que os dois mudaram pedem uma escolha. */}
                <span>
                  {conflict.merge.conflicts.length === 1
                    ? "Esta nota mudou fora do Kiwi Notes no mesmo trecho que você editou. Escolha esse trecho; o resto do que mudou fora entra junto."
                    : `Esta nota mudou fora do Kiwi Notes em ${conflict.merge.conflicts.length} trechos que você também editou. Escolha esses trechos; o resto do que mudou fora entra junto.`}
                </span>
                {conflict.merge.conflicts.slice(0, 3).map((c, i) => (
                  <div className="kn-merge-block" key={i}>
                    <div>
                      <small>A sua</small>
                      <pre>{c.mine.trim() || "(apagado)"}</pre>
                    </div>
                    <div>
                      <small>A de fora</small>
                      <pre>{c.theirs.trim() || "(apagado)"}</pre>
                    </div>
                  </div>
                ))}
                <span className="kn-conflict-actions">
                  <button type="button" className="kn-bt" onClick={() => resolveConflict("theirs")}>
                    {conflict.merge.conflicts.length === 1 ? "Usar a de fora nesse trecho" : "Usar a de fora nesses trechos"}
                  </button>
                  <button type="button" className="kn-bt kn-bt-acc" onClick={() => resolveConflict("mine")}>
                    Manter a minha
                  </button>
                </span>
              </div>
            ) : saveFailed ? (
              <div className="kn-conflict kn-save-alert" role="alert" data-reason={saveFailed}>
                    {saveFailed === "disk-full"
                      ? "O disco está cheio: não deu para gravar esta nota. Libere espaço e tente de novo; o que você escreveu continua aqui."
                      : "Não deu para gravar esta nota. O que você escreveu continua aqui."}
                    <span className="kn-conflict-actions">
                  <button type="button" className="kn-bt" onClick={discard}>
                    Descartar a edição
                  </button>
                  <button type="button" className="kn-bt kn-bt-acc" onClick={() => void save()}>
                    Tentar de novo
                  </button>
                </span>
              </div>
            ) : draft ? (
              <div className="kn-conflict kn-draft" role="alert">
                {`Esta nota tem uma edição das ${new Date(draft.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}${
                  isToday(draft.at) ? "" : ` de ${new Date(draft.at).toLocaleDateString("pt-BR", { day: "numeric", month: "short" })}`
                } que não foi gravada${draft.baseVersion !== note.version ? ", e a nota mudou depois disso" : ""}.`}
                <span className="kn-conflict-actions">
                  <button type="button" className="kn-bt" onClick={dropDraft}>
                    Descartar
                  </button>
                  <button type="button" className="kn-bt kn-bt-acc" onClick={recoverDraft}>
                    Recuperar
                  </button>
                </span>
              </div>
            ) : null}
            {linkWarnings.length ? <details className="kn-link-warnings">
              <summary>{linkWarnings.length === 100 ? "100 ou mais" : linkWarnings.length} {linkWarnings.length === 1 ? "link quebrado" : "links quebrados"}</summary>
              <ul>{linkWarnings.map((w, i) => <li key={`${w.line}:${i}`}><span>{w.target}</span> — {w.reason === "note" ? "nota não encontrada" : "título não encontrado"} · linha {w.line}</li>)}</ul>
            </details> : null}
            <NoteEditor
              docKey={docKey}
              readOnly={note.readOnly === true}
              title={note.title}
              headingJump={headingJump?.path === note.path ? headingJump : null}
              doc={body}
              links={links}
              onChange={onChange}
              createSplit={!conflict && !draft ? async (tail) => {
                const n = await api.create(`${note.title} — continuação`, note.folder || undefined, tail);
                void refresh();
                return n.path;
              } : undefined}
              onSplitDone={(path) => { void open(path); }}
              onRenameHeading={api.renameHeading && !conflict && !draft ? (offset, name, source) => setRefactor({ kind: "heading", path: note.path, offset, name, source }) : undefined}
              onOpenLink={(t) => void onOpenLink(t)}
              onOpenTag={openTag}
              onSlashTemplate={api.templates ? () => fromTemplate(note?.folder ?? "", true) : undefined}
              linkTargets={linkTargets}
              headingContent={async (target) => {
                const path = await api.resolve(target);
                if (!path) return null;
                return path === note.path ? pending.current ?? splitFrontmatter(baseContent.current).body : (await api.get(path)).content;
              }}
              attachments={api.attachments}
              embed={api.embed}
              onError={(t) => say(t)}
              focus={focusMode}
              typewriter={typewriter}
              viewModes={{
                focusKey: shortcuts.focusMode ? shortcutLabel(shortcuts.focusMode) : undefined,
                typewriterKey: shortcuts.typewriter ? shortcutLabel(shortcuts.typewriter) : undefined,
                toggleFocus,
                toggleTypewriter,
              }}
              onAddProperty={addNoteProperty}
            />
          </article>
        ) : listing && !listing.notes.length ? (
          <Empty icon={<NoNotesIcon />} title="Nenhuma nota ainda">
            <Button variant="primary" onClick={() => void create("Sem título", true)}>
              Nova nota
            </Button>
          </Empty>
        ) : null}
          </>
        )}
      </main>
      {palette ? (
        <Palette
          api={api}
          notes={listing?.notes ?? []}
          initialQuery={paletteQuery}
          commands={paletteCommands}
          onCommand={(id, q) =>
            id === "template" ? fromTemplate(selectedFolderRef.current) : id === "save-search" ? saveSearch(q) : id === "canvas" ? void newCanvas(selectedFolderRef.current)
              : id === "focus" ? toggleFocus() : id === "typewriter" ? toggleTypewriter() : id === "add-property" ? addNoteProperty() : undefined
          }
          onOpen={(p) => void open(p)}
          onCreate={(t) => void create(t)}
          onClose={() => setPalette(false)}
        />
      ) : null}
      {refactor ? <RefactorDialog key={`${refactor.kind}:${refactor.name}`} kind={refactor.kind} name={refactor.name} onRename={performRefactor} onClose={() => setRefactor(null)} /> : null}
      {tagMenu && api.renameTag ? <ContextMenu x={tagMenu.x} y={tagMenu.y} items={[
        { label: `Renomear #${tagMenu.tag}…`, onSelect: () => { setTreeOpen(false); setRefactor({ kind: "tag", name: tagMenu.tag }); } },
      ]} onClose={() => setTagMenu(null)} /> : null}
      {speakerDialog && api.meetings ? (
        <MeetingSpeakerDialog
          speakers={speakerDialog.speakers}
          onClose={() => setSpeakerDialog(null)}
          onRename={async (from, to) => {
            await api.meetings!.renameSpeaker(speakerDialog.path, from, to);
            if (current.current === speakerDialog.path)
              show(await api.get(speakerDialog.path));
            void refresh();
          }}
        />
      ) : null}
      {menu ? (
        <ContextMenu x={menu.x} y={menu.y} items={menuFor(menu.target)} onClose={() => setMenu(null)} onRestoreFocus={restoreMenuFocus} />
      ) : null}
      {projectPick && projectsApi ? (
        // A nota principal apagada (spec #9847): escolher outra nota da pasta, ou criar a do nome da pasta.
        <ContextMenu
          onRestoreFocus={restoreMenuFocus}
          x={projectPick.x}
          y={projectPick.y}
          onClose={() => setProjectPick(null)}
          items={(() => {
            const folder = projectPick.folder;
            const name = folder.slice(folder.lastIndexOf("/") + 1);
            const notes = (listing?.notes ?? []).filter((n) => n.path.startsWith(`${folder}/`)).sort((a, b) => a.path.localeCompare(b.path, "pt-BR"));
            return [
              { kind: "title" as const, label: `A nota principal de “${name}”` },
              ...notes.map((n) => ({
                label: n.path.slice(folder.length + 1).replace(/\.md$/i, ""),
                onSelect: () => projectAction("trocar a nota principal", () => projectsApi.setMain(folder, n.path)),
              })),
              ...(notes.length ? [{ kind: "separator" as const }] : []),
              {
                label: `Criar “${name}”`,
                onSelect: () =>
                  projectAction("criar a nota principal", async () => {
                    const created = await api.create(name, folder, `# ${name}\n`);
                    await projectsApi.setMain(folder, created.path);
                    await refresh();
                  }),
              },
            ];
          })()}
        />
      ) : null}
      {moving && moving.kind !== "empty" ? (
        <FolderPicker
          title={`Mover “${moving.path.slice(moving.path.lastIndexOf("/") + 1).replace(/\.md$/, "")}” para…`}
          folders={["", ...(listing?.folders ?? [])].filter(
            (f) => f !== folderOf(moving.path) && (moving.kind === "note" || (f !== moving.path && !f.startsWith(`${moving.path}/`))),
          )}
          onPick={(f) => void moveItem(moving, f)}
          onClose={() => setMoving(null)}
        />
      ) : null}
      {picking ? (
        <ListPicker
          title={picking.insert ? "Pôr o modelo na nota…" : `Nova nota${picking.folder ? ` em “${picking.folder.replace(/\//g, " / ")}”` : ""} a partir de…`}
          items={picking.templates.map((m) => ({ value: m.path, label: m.title,
          }))}
          emptyText="Nenhum modelo com esse nome"
          onPick={(path) => {
            const m = picking.templates.find((x) => x.path === path);
            setPicking(null);
            if (!m) return;
            if (!picking.insert) return void create(m.title, true, picking.folder, m.path);
            // "/modelo": o corpo do modelo (sem o frontmatter dele) no cursor, com as variáveis da nota aberta.
            api.get(m.path).then((t) => {
              const body = splitFrontmatter(t.content).body;
              insertIntoEditor(fillTemplate(body, { title: note?.title ?? "", now: new Date(),
                }),
              );
              focusEditor();
            }, failed_("ler o modelo"));
          }}
          onClose={() => setPicking(null)}
        />
      ) : null}
      {versionsOf && api.versions ? (
        <VersionsDialog
          api={api.versions}
          path={versionsOf.path}
          title={versionsOf.title}
          current={versionsOf.content}
          onClose={() => setVersionsOf(null)}
          onRestored={() => {
            const p = versionsOf.path;
            setVersionsOf(null);
            void refresh();
            // A nota aberta é a restaurada: o editor mostra o texto de volta.
            if (current.current === p) api.get(p).then((n) => show(n), () => {},
              );
          }}
        />
      ) : null}
      {exporting ? (
        <ListPicker
          title={`Exportar “${noteName(exporting)}” como…`}
          items={[
            { value: "md", label: "Markdown (.md), com os anexos ao lado" },
            { value: "html", label: "HTML (.html), com o tema de agora" },
            { value: "pdf", label: "PDF (.pdf)" },
          ]}
          emptyText="Nenhum formato com esse nome"
          onPick={(f) => void exportNote(exporting, f as ExportFormat)}
          onClose={() => setExporting(null)}
        />
      ) : null}
      {toast ? <UndoToast toast={toast} onDone={() => setToast(null)} /> : null}
    </div>
  );
}

const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="kn-notes kn-notes-empty">
      <div className="kn-drag electrobun-webkit-app-region-drag" />
      {children}
    </div>
  );
}

/**
 * A janela Notas inteira: o vault, a nota e o "Citada em". A janela Notas e o hub (T2121) montam esta. `active`: as
 * Notas estão na tela. No hub, com outra seção à frente, elas ficam montadas e escondidas, e o ⌘N e o ⌘K não podem
 * agir sem ninguém ver (T2200).
 */
export function NotesApp({ active = true, openRequest = null }: { active?: boolean; openRequest?: { path: string; n: number; internal?:boolean } | null } = {}) {
  const request = openRequest?.n ?? 0;
  const [mode,setMode] = useState({n:request,internal:openRequest?.internal===true});
  const controller = useNotesFolders(()=>setMode({n:request,internal:false}));
  const internal = mode.n===request?mode.internal:openRequest?.internal===true;
  const previousFolder = useRef<string | undefined>(undefined);
  useEffect(()=>{
    const id=controller.view?.current.id;
    if(previousFolder.current&&id&&previousFolder.current!==id)setMode({n:request,internal:false});
    previousFolder.current=id;
  },[controller.view?.current.id,request]);
  const folder = internal?controller.view?.internal:controller.view?.current;
  const namespace = folder&&folder.key!==controller.view?.internal.key?folder.key:"";
  const drafts = useMemo(() => new Drafts(undefined,Date.now,namespace), [namespace]);
  const api = useMemo(() => {
    if(controller.supported&&!folder)return null;
    const a = notesApi(folder?.id);
    return a && forgetDraftOnDelete(a,drafts);
  }, [drafts,folder?.id,controller.supported]);
  if (!api) return <Shell><Empty title={controller.error|| (controller.supported?"Abrindo a pasta das notas…":"As notas ainda não chegaram a esta versão do app")}/></Shell>;
  return <>{controller.view&&controller.view.progress.phase!=="idle"?<div className="kn-folder-progress" role="status" aria-live="polite">Lendo {controller.view.progress.path}… {controller.view.progress.seen} arquivos encontrados.</div>:null}<Notes key={folder?.id??"legacy"} api={api} drafts={drafts} active={active} openRequest={openRequest} folderController={controller} folderRef={folder}/><FolderConfirmation controller={controller}/></>;
}


function TreeIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3h4M3 3v10M3 8h4M3 13h4M9.5 3h3.5M9.5 8h3.5M9.5 13h3.5" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4.5 6.5 8 10l3.5-3.5" />
    </svg>
  );
}

function PenIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.5 3 13 5.5 6 12.5H3.5V10z" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3 3" />
    </svg>
  );
}

/** O glifo do vazio das Notas, no tom dos outros vazios: 44 px, na cor de destaque (T2778). */
function NoNotesIcon() {
  return (
    <svg width="44" height="44" viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: "var(--accent)" }}>
      <path d="M9 5h12l7 7v19H9z" />
      <path d="M21 5v7h7M14 19h9M14 24h6" />
    </svg>
  );
}
