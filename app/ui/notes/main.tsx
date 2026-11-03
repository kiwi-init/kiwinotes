// Notas (spec #1107, fase A, T1317): o vault em Markdown no design B v4, "uma superfície só". Barra lateral com pastas e
// notas, a nota (título, uma linha de meta e o editor ao vivo) e, à direita, "Citada em". ⌘K busca, ⌘N cria.
// Tudo passa pelas capacidades `notes.*` do engine (contrato 1.1.0); nada sai do Mac.

import "./notes.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { Button, Empty, mount } from "../src/kit/index.tsx";
import { notesApi } from "./api.ts";
import { LinkCache, type LinkTarget } from "./editor/index.ts";
import { splitFrontmatter } from "./frontmatter.ts";
import { linkTextFor, plainContext } from "./links.ts";
import { focusEditor, NoteEditor } from "./NoteEditor.tsx";
import { Palette } from "./Palette.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { ancestors, buildTree, editedLabel } from "./tree.ts";
import type { Backlink, Note, NotesApi, SaveResult, VaultListing } from "./types.ts";

type SaveOutcome = "clean" | "saved" | "conflict" | "error";

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

function Notes({ api }: { api: NotesApi }) {
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
  const entered = useEnterAnimation();

  // O que ainda não foi gravado: o corpo da nota aberta, o frontmatter que volta com ele e a versão que o disco tem.
  const pending = useRef<string | null>(null);
  const frontmatter = useRef("");
  const version = useRef("");
  const current = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const links = useMemo(() => new LinkCache((t) => api.resolve(t)), [api]);

  const refresh = useCallback(
    () =>
      api.list().then(
        (l) => {
          setListing(l);
          setFailed(false);
        },
        () => setFailed(true),
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
      setDocKey(`${n.path}@${n.version}`);
      setConflict(null);
      setSaveFailed(false);
      setOpenFolders((open) => new Set([...open, ...ancestors(n.path)]));
      api.backlinks(n.path).then(setBacklinks, () => setBacklinks([]));
    },
    [api],
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
      if (pending.current === text) pending.current = null;
      setNote((old) => (old && old.path === path ? { ...old, ...r.meta, content: frontmatter.current + text } : old));
      return "saved";
    };
    queue.current = queue.current.then(once, once);
    return queue.current;
  }, [api]);

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
    api.get(path).then(show, () => {
      current.current = null;
      setNote(null);
      setSaveFailed(false);
    });
  }, [api, show]);

  const open = useCallback(
    async (path: string) => {
      if (!(await leave())) return;
      const n = await api.get(path).catch(() => null);
      if (n) show(n);
      setPalette(false);
    },
    [api, leave, show],
  );

  const create = useCallback(
    async (wanted: string, focusTitle = false) => {
      if (!(await leave())) return;
      const n = await api.create(wanted).catch(() => null);
      setPalette(false);
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

  // Abre o vault e a primeira nota (a Caixa de entrada, se existir).
  useEffect(() => {
    api.list().then(
      (l) => {
        setListing(l);
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
        void refresh();
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
    [api, links, refresh, show],
  );

  // ⌘K busca, ⌘N cria. Ao esconder a janela, grava o que estiver pendente.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.altKey || e.ctrlKey) return;
      // Síncrono: a busca já está com o foco antes da próxima tecla (quem digita rápido não escreve na nota).
      if (e.key === "k") flushSync(() => setPalette((p) => !p));
      else if (e.key === "n") void create("Sem título", true);
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

  const keepMine = () => {
    if (!conflict) return;
    version.current = conflict.version;
    setConflict(null);
    void save();
  };

  const linkTargets = (): LinkTarget[] => {
    const notes = listing?.notes ?? [];
    const paths = notes.map((n) => n.path);
    return notes.filter((n) => n.path !== note?.path).map((n) => ({ title: n.title, folder: n.folder, link: linkTextFor(n.path, paths) }));
  };

  const tree = useMemo(() => (listing ? buildTree(listing) : []), [listing]);

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
      <div className="kn-drag electrobun-webkit-app-region-drag" />
      <Sidebar
        tree={tree}
        open={openFolders}
        current={note?.path ?? null}
        onToggle={(f) =>
          setOpenFolders((s) => {
            const next = new Set(s);
            if (!next.delete(f)) next.add(f);
            return next;
          })
        }
        onOpen={(p) => void open(p)}
      />
      <main className="kn-center">
        <div className="kn-top">
          <span className="kn-crumb">{note?.folder.replace(/\//g, " / ") ?? ""}</span>
          <span className="kn-top-r electrobun-webkit-app-region-no-drag">
            <button type="button" className="kn-bt" onClick={() => setPalette(true)}>
              ⌕ Buscar <span className="kn-faint">⌘K</span>
            </button>
          </span>
        </div>
        {note ? (
          <article className="kn-page">
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
            <div className="kn-meta">{[...note.tags.map((t) => `#${t}`), editedLabel(note)].join(" · ")}</div>
            {conflict ? (
              <div className="kn-conflict kn-save-alert" role="alert">
                Esta nota mudou fora do Kiwi Notes enquanto você editava.
                <span className="kn-conflict-actions">
                  <button type="button" className="kn-bt" onClick={() => show(conflict)}>
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
      <aside className="kn-right" aria-label="Citada em">
        {note ? (
          <>
            <div className="kn-right-h">Citada em</div>
            {backlinks.length ? (
              backlinks.map((b) => (
                <button type="button" className="kn-back" key={b.path} onClick={() => void open(b.path)}>
                  <span className="kn-link">{b.title}</span>
                  <span className="kn-back-ctx">{plainContext(b.context)}</span>
                </button>
              ))
            ) : (
              <div className="kn-faint">Nenhuma nota cita esta ainda.</div>
            )}
          </>
        ) : null}
      </aside>
      {palette ? (
        <Palette api={api} notes={listing?.notes ?? []} onOpen={(p) => void open(p)} onCreate={(t) => void create(t)} onClose={() => setPalette(false)} />
      ) : null}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="kn-notes kn-notes-empty">
      <div className="kn-drag electrobun-webkit-app-region-drag" />
      {children}
    </div>
  );
}

function App() {
  const api = useMemo(notesApi, []);
  if (!api) {
    return (
      <Shell>
        <Empty title="As notas ainda não chegaram a esta versão do app">Atualize o Kiwi Notes para abrir o vault.</Empty>
      </Shell>
    );
  }
  return <Notes api={api} />;
}

document.title = "Notas";
mount(<App />);
