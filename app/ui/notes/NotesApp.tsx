// Notas (spec #1107, fase A, T1317): o vault em Markdown, "uma superfície só". Com o T2502 (#2457, versão C · Foco), a
// nota ocupa a janela: a árvore de pastas abre pelo caminho na barra de cima, num popover, e o "Citada em" sai da linha
// de meta. Embaixo, a barra de ditado (o composer do Channels). ⌘K busca, ⌘N cria.
// Tudo passa pelas capacidades `notes.*` do engine (contrato 1.1.0); nada sai do Mac.

import "./notes.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { api as appApi } from "../src/api.ts";
import { Button, Empty } from "../src/kit/index.tsx";
import { TopBar } from "../src/topbar.tsx";
import { Composer } from "./Composer.tsx";
import { Popover } from "./Popover.tsx";
import { ContextMenu, type MenuItem } from "./ContextMenu.tsx";
import { notesApi } from "./api.ts";
import { LinkCache, type LinkTarget } from "./editor/index.ts";
import { wordCount } from "./editor/text.ts";
import { type Draft, Drafts, forgetDraftOnDelete } from "./drafts.ts";
import { splitFrontmatter } from "./frontmatter.ts";
import { FolderPicker } from "./FolderPicker.tsx";
import { folderOf, linkTextFor, noteName, plainContext } from "./links.ts";
import { focusEditor, NoteEditor } from "./NoteEditor.tsx";
import { Palette } from "./Palette.tsx";
import { type SideTarget, Sidebar } from "./Sidebar.tsx";
import { ancestors, buildTree, editedLabel, filterTree, recentNotes, type SortBy } from "./tree.ts";
import { type Toast, UndoToast } from "./UndoToast.tsx";
import type { Backlink, Note, NotesApi, SaveResult, VaultListing } from "./types.ts";

type SaveOutcome = "clean" | "saved" | "conflict" | "error";

/** Onde entram as notas que não têm lugar ainda: a nota rápida do A3 (#1509) e o rascunho órfão recuperado. */
const INBOX = "Caixa de entrada";

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

const join = (folder: string, name: string) => (folder ? `${folder}/${name}` : name);

/** Quanto esperar depois da última tecla para gravar. */
const SAVE_AFTER_MS = 500;

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

function Notes({ api, drafts, active }: { api: NotesApi; drafts: Drafts; active: boolean }) {
  const [listing, setListing] = useState<VaultListing | null>(null);
  const [failed, setFailed] = useState(false);
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const [note, setNote] = useState<Note | null>(null);
  const [docKey, setDocKey] = useState("");
  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  const [conflict, setConflict] = useState<Note | null>(null);
  /** O último save falhou (disco cheio, nota apagada fora, grande demais): a edição fica e a pessoa decide. */
  const [saveFailed, setSaveFailed] = useState(false);
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [palette, setPalette] = useState(false);
  // A árvore e o "Citada em" abrem em popover (C · Foco).
  const [treeOpen, setTreeOpen] = useState(false);
  const [backOpen, setBackOpen] = useState(false);
  const crumbRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  // O básico de app de notas (T2469).
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>(loadSort);
  const [selectedFolder, setSelectedFolder] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; target: SideTarget } | null>(null);
  const [moving, setMoving] = useState<SideTarget | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [pinned, setPinned] = useState<string[]>([]);
  const [words, setWords] = useState(0);
  const entered = useEnterAnimation();

  // O que ainda não foi gravado: o corpo da nota aberta, o frontmatter que volta com ele e a versão que o disco tem.
  const pending = useRef<string | null>(null);
  const frontmatter = useRef("");
  const version = useRef("");
  const current = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const links = useMemo(() => new LinkCache((t) => api.resolve(t)), [api]);
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
          return l;
        },
        () => {
          setFailed(true);
          return null;
        },
      ),
    [api],
  );

  const show = useCallback(
    (n: Note) => {
      const split = splitFrontmatter(n.content);
      frontmatter.current = split.frontmatter;
      version.current = n.version;
      current.current = n.path;
      pending.current = null;
      setNote(n);
      setTitle(n.title);
      setBody(split.body);
      setWords(wordCount(split.body));
      // A pasta da nota aberta é a do próximo ⌘N.
      setSelectedFolder(n.folder);
      setDocKey(`${n.path}@${n.version}`);
      setConflict(null);
      setSaveFailed(false);
      // Um rascunho que não foi gravado (a janela fechou com conflito ou erro na tela): oferece de volta.
      const d = drafts.get(n.path);
      if (d && d.body !== split.body) {
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
   * Grava o que está pendente e diz o que houve: "clean" (nada a gravar), "saved", "conflict" (mudou fora: o aviso
   * aparece) ou "error" (o aviso de erro aparece). Um save por vez, numa fila: dois ao mesmo tempo saíam com a mesma
   * versão, e o 2º via a gravação do 1º como conflito.
   */
  const queue = useRef<Promise<SaveOutcome>>(Promise.resolve("clean"));
  const save = useCallback((): Promise<SaveOutcome> => {
    clearTimeout(timer.current);
    const once = async (): Promise<SaveOutcome> => {
      const path = current.current;
      const text = pending.current;
      if (!path || text === null) return "clean";
      let r: SaveResult;
      try {
        r = await api.save(path, frontmatter.current + text, version.current);
      } catch {
        setSaveFailed(true);
        return "error";
      }
      if (!r.saved) {
        setConflict(r.current);
        return "conflict";
      }
      version.current = r.meta.version;
      setSaveFailed(false);
      // Só limpa se nada foi digitado enquanto gravava.
      if (pending.current === text) {
        pending.current = null;
        if (!undecided.current) drafts.remove(path);
      }
      setNote((old) => (old && old.path === path ? { ...old, ...r.meta, content: frontmatter.current + text } : old));
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
    for (let i = 0; i < 3; i++) {
      const outcome = await save();
      if (outcome === "conflict" || outcome === "error") {
        setPalette(false);
        requestAnimationFrame(() => document.querySelector(".kn-save-alert")?.scrollIntoView({ block: "nearest" }));
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
    api.get(path).then(show, () => {
      current.current = null;
      setNote(null);
      setSaveFailed(false);
    });
  }, [api, drafts, show]);

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

  const create = useCallback(
    async (wanted: string, focusTitle = false, folder?: string) => {
      if (!(await leave())) return;
      const n = await api.create(wanted, folder || undefined).catch(() => null);
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
        // `?note=` (Vite no navegador, testes): abre essa nota. No app a página carrega sem query.
        const asked = new URLSearchParams(location.search).get("note");
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
        void refresh().then((l) => {
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
        if (!paths.includes(path) || pending.current !== null) return;
        api.get(path).then(
          (n) => n.version !== version.current && show(n),
          () => {
            // Apagada ou renomeada fora: a janela fica sem nota aberta.
            current.current = null;
            setNote(null);
          },
        );
      }),
    [api, drafts, links, refresh, show],
  );

  // No hub (T2121) as Notas ficam montadas e escondidas nas outras seções: as teclas só valem com elas na tela (T2200).
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

  // ⌘K busca, ⌘N cria (na pasta escolhida). Ao esconder a janela, grava o que estiver pendente.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!activeRef.current || !e.metaKey || e.altKey || e.ctrlKey) return;
      // Síncrono: a busca já está com o foco antes da próxima tecla (quem digita rápido não escreve na nota).
      if (e.key === "k") flushSync(() => setPalette((p) => !p));
      else if (e.key === "n") void create("Sem título", true, selectedFolderRef.current);
      else return;
      e.preventDefault();
    };
    const onHide = () => document.visibilityState === "hidden" && void save();
    window.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [create, save]);

  const onChange = (doc: string) => {
    pending.current = doc;
    setWords(wordCount(doc));
    // O rascunho anda junto com a edição, para sobreviver a um fechamento que o save não alcançou.
    if (current.current && !undecided.current) {
      drafts.set({ path: current.current, body: doc, frontmatter: frontmatter.current, baseVersion: version.current });
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), SAVE_AFTER_MS);
  };

  const onOpenLink = async (target: string) => {
    const path = await api.resolve(target).catch(() => null);
    // Como no Obsidian: clicar num link para uma nota que não existe cria a nota.
    if (path) await open(path);
    else await create(target);
  };

  const rename = async () => {
    const wanted = title.trim().replace(/[\\/:]/g, "-");
    if (!note || !wanted || wanted === note.title) return setTitle(note?.title ?? "");
    if (!(await leave())) return setTitle(note.title);
    const r = await api.rename(note.path, `${note.folder ? `${note.folder}/` : ""}${wanted}.md`).catch(() => null);
    if (!r) return setTitle(note.title); // já existe uma nota com esse nome
    const n = await api.get(r.meta.path).catch(() => null);
    if (n) show(n);
    void refresh();
  };

  const takeTheirs = (n: Note) => {
    drafts.remove(n.path);
    show(n);
  };

  /** "Recuperar": o rascunho volta ao editor e grava por cima do que está no disco (a pessoa escolheu). */
  const recoverDraft = () => {
    const d = undecided.current;
    if (!d) return;
    undecided.current = null;
    setDraft(null);
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

  const keepMine = () => {
    if (!conflict) return;
    version.current = conflict.version;
    setConflict(null);
    void save();
  };

  // ---------------------------------------------------------------- o básico de app de notas (T2469)

  const folders = api.folders;
  const pins = api.pins;
  useEffect(() => {
    pins?.list().then(setPinned, () => {});
  }, [pins]);

  const say = (text: string, undo?: () => void) => setToast({ text, undo });
  const failed_ = (what: string) => (e: unknown) => say(`Não deu para ${what}${/E_EXISTS/.test(String(e)) ? ": já existe um com esse nome" : ""}.`);

  /** Depois de mexer no vault: a lista de novo, e a nota aberta reaberta no lugar novo, se ela mudou de path. */
  const after = async (moved?: { from: string; to: string }) => {
    await refresh();
    links.clear();
    // O engine corrige as fixadas (renomear, mover, apagar); a janela só relê.
    pins?.list().then(setPinned, () => {});
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
    const taken = new Set((listing?.folders ?? []).filter((f) => folderOf(f) === parent).map((f) => f.slice(f.lastIndexOf("/") + 1)));
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
      if (current.current === target.path && !(await leave())) return;
      const r = await api.rename(target.path, `${join(folderOf(target.path), clean)}.md`).catch(failed_("renomear a nota"));
      if (r) await after({ from: target.path, to: r.meta.path });
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
    const wasPinned = pinned.filter((p) => p === target.path || (target.kind === "folder" && p.startsWith(`${target.path}/`)));
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
              failed_("desfazer"),
            )
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
      { label: "Nome", checked: sortBy === "name", onSelect: () => sort("name") },
      { label: "Edição", checked: sortBy === "edited", onSelect: () => sort("edited") },
      { label: "Criação", checked: sortBy === "created", onSelect: () => sort("created") },
    ];
    if (t.kind === "empty") {
      return [
        { label: "Nova nota", hint: "⌘N", onSelect: () => void create("Sem título", true, "") },
        ...(folders ? [{ label: "Nova pasta", onSelect: () => void newFolder("") }] : []),
        { kind: "separator" },
        ...sortItems,
      ];
    }
    if (t.kind === "folder") {
      return [
        { label: "Nova nota aqui", onSelect: () => void create("Sem título", true, t.path) },
        { label: "Nova pasta aqui", onSelect: () => void newFolder(t.path), disabled: !folders },
        { kind: "separator" },
        { label: "Renomear", onSelect: () => setRenaming(`f:${t.path}`), disabled: !folders },
        { label: "Mover para…", onSelect: () => setMoving(t), disabled: !folders },
        { label: "Mostrar no Finder", onSelect: () => void folders?.reveal(t.path).catch(failed_("mostrar no Finder")), disabled: !folders },
        { kind: "separator" },
        { label: "Apagar", danger: true, onSelect: () => void remove(t), disabled: !folders },
      ];
    }
    const isPinned = pinned.includes(t.path);
    return [
      { label: "Abrir", onSelect: () => void open(t.path) },
      { label: isPinned ? "Desafixar" : "Fixar", onSelect: () => void togglePin(t.path), disabled: !pins },
      { kind: "separator" },
      { label: "Renomear", onSelect: () => setRenaming(`n:${t.path}`) },
      { label: "Duplicar", onSelect: () => void duplicate(t.path), disabled: !folders },
      { label: "Mover para…", onSelect: () => setMoving(t), disabled: !folders },
      { label: "Copiar link [[…]]", onSelect: () => copyLink(t.path) },
      { label: "Mostrar no Finder", onSelect: () => void folders?.reveal(t.path).catch(failed_("mostrar no Finder")), disabled: !folders },
      { kind: "separator" },
      { label: "Apagar", danger: true, onSelect: () => void remove(t) },
    ];
  };

  const linkTargets = (): LinkTarget[] => {
    const notes = listing?.notes ?? [];
    const paths = notes.map((n) => n.path);
    return notes.filter((n) => n.path !== note?.path).map((n) => ({ title: n.title, folder: n.folder, link: linkTextFor(n.path, paths) }));
  };

  const fullTree = useMemo(() => (listing ? buildTree(listing, sortBy) : []), [listing, sortBy]);
  const found = useMemo(() => filterTree(fullTree, query), [fullTree, query]);
  const openNow = useMemo(() => (query.trim() ? new Set([...openFolders, ...found.open]) : openFolders), [openFolders, found, query]);
  const byPath = useMemo(() => new Map((listing?.notes ?? []).map((n) => [n.path, n])), [listing]);
  const pinnedNotes = pinned.map((p) => byPath.get(p)).filter((n) => n !== undefined);
  const recent = useMemo(() => recentNotes(listing?.notes ?? [], 5), [listing]);

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
    <div className="kn-notes" data-entered={entered}>
      <TopBar
        start={
          <button
            ref={crumbRef}
            type="button"
            className="kn-float kn-crumb-bt"
            aria-expanded={treeOpen}
            aria-haspopup="dialog"
            title="Pastas e notas"
            onClick={() => setTreeOpen((o) => !o)}
          >
            <TreeIcon />
            <span className="kn-crumb-label">{note?.folder ? note.folder.replace(/\//g, " / ") : "Notas"}</span>
            <Chevron />
          </button>
        }
        end={
          <span className="kn-float-group">
            <button type="button" title="Nova nota (⌘N)" aria-label="Nova nota" onClick={() => void create("Sem título", true, selectedFolderRef.current)}>
              <PenIcon />
            </button>
            <button type="button" title="Buscar (⌘K)" aria-label="Buscar" onClick={() => setPalette(true)}>
              <SearchIcon />
            </button>
          </span>
        }
      />
      {treeOpen ? (
        <Popover className="kn-tree-pop" label="Pastas e notas" anchor={crumbRef} onClose={() => setTreeOpen(false)}>
          <Sidebar
            tree={found.tree}
            open={openNow}
            current={note?.path ?? null}
            selectedFolder={selectedFolder}
            query={query}
            onQuery={setQuery}
            pinned={pinnedNotes}
            recent={recent}
            renaming={renaming}
            menuOn={menu && menu.target.kind !== "empty" ? `${menu.target.kind === "note" ? "n" : "f"}:${menu.target.path}` : null}
            onRename={(t, name) => void renameItem(t, name)}
            onSelectFolder={setSelectedFolder}
            onMenu={(at, target) => setMenu({ ...at, target })}
            onDrop={folders ? (what, folder) => void moveItem(what, folder) : undefined}
            onToggle={(f) =>
              setOpenFolders((s) => {
                const next = new Set(s);
                if (!next.delete(f)) next.add(f);
                return next;
              })
            }
            onOpen={(p) => void open(p)}
          />
        </Popover>
      ) : null}
      <main className="kn-center">
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
          <article className="kn-page">
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
              {[...note.tags.map((t) => `#${t}`), editedLabel(note), `${words} ${words === 1 ? "palavra" : "palavras"}`].map((t) => (
                <span key={t}>{t}</span>
              ))}
              <button
                ref={backRef}
                type="button"
                className="kn-meta-bt"
                aria-expanded={backOpen}
                aria-haspopup="dialog"
                disabled={!backlinks.length}
                onClick={() => setBackOpen((o) => !o)}
              >
                {backlinks.length ? `citada em ${backlinks.length}` : "nenhuma nota cita esta"}
              </button>
              {backOpen && backlinks.length ? (
                <Popover className="kn-back-pop" label="Citada em" anchor={backRef} onClose={() => setBackOpen(false)}>
                  {backlinks.map((b) => (
                    <button type="button" className="kn-back" key={b.path} onClick={() => void open(b.path)}>
                      <span className="kn-link">{b.title}</span>
                      <span className="kn-back-ctx">{plainContext(b.context)}</span>
                    </button>
                  ))}
                </Popover>
              ) : null}
            </div>
            {conflict ? (
              <div className="kn-conflict kn-save-alert" role="alert">
                Esta nota mudou fora do Kiwi Notes enquanto você editava.
                <span className="kn-conflict-actions">
                  <button type="button" className="kn-bt" onClick={() => takeTheirs(conflict)}>
                    Usar a de fora
                  </button>
                  <button type="button" className="kn-bt kn-bt-acc" onClick={keepMine}>
                    Manter a minha
                  </button>
                </span>
              </div>
            ) : saveFailed ? (
              <div className="kn-conflict kn-save-alert" role="alert">
                Não deu para gravar esta nota. O que você escreveu continua aqui.
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
            <NoteEditor docKey={docKey} doc={body} links={links} onChange={onChange} onOpenLink={(t) => void onOpenLink(t)} linkTargets={linkTargets} />
          </article>
        ) : listing && !listing.notes.length ? (
          <Empty title="Nenhuma nota ainda">
            <Button variant="primary" onClick={() => void create("Sem título", true)}>
              Nova nota
            </Button>
          </Empty>
        ) : null}
      </main>
      <Composer disabled={!note} />
      {palette ? (
        <Palette api={api} notes={listing?.notes ?? []} onOpen={(p) => void open(p)} onCreate={(t) => void create(t)} onClose={() => setPalette(false)} />
      ) : null}
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menuFor(menu.target)} onClose={() => setMenu(null)} /> : null}
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
export function NotesApp({ active = true }: { active?: boolean } = {}) {
  const drafts = useMemo(() => new Drafts(), []);
  const api = useMemo(() => {
    const a = notesApi();
    return a && forgetDraftOnDelete(a, drafts);
  }, [drafts]);
  if (!api) {
    return (
      <Shell>
        <Empty title="As notas ainda não chegaram a esta versão do app">Atualize o Kiwi Notes para abrir o vault.</Empty>
      </Shell>
    );
  }
  return <Notes api={api} drafts={drafts} active={active} />;
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
