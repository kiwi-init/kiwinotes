// Notas (spec #1107, fase A, T1317): o vault em Markdown no design B v4, "uma superfície só". Barra lateral com pastas e
// notas, a nota (título, uma linha de meta e o editor ao vivo) e, à direita, "Citada em". ⌘K busca, ⌘N cria.
// Tudo passa pelas capacidades `notes.*` do engine (contrato 1.1.0); nada sai do Mac.

import "./notes.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { Button, Empty, mount } from "../src/kit/index.tsx";
import { notesApi } from "./api.ts";
import { LinkCache, type LinkTarget } from "./editor/index.ts";
import { type Draft, Drafts, forgetDraftOnDelete } from "./drafts.ts";
import { splitFrontmatter } from "./frontmatter.ts";
import { linkTextFor, noteName, plainContext } from "./links.ts";
import { focusEditor, NoteEditor } from "./NoteEditor.tsx";
import { Palette } from "./Palette.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { ancestors, buildTree, editedLabel } from "./tree.ts";
import type { Backlink, Note, NotesApi, SaveResult, VaultListing } from "./types.ts";

type SaveOutcome = "clean" | "saved" | "conflict" | "error";

/** Onde entram as notas que não têm lugar ainda: a nota rápida do A3 (#1509) e o rascunho órfão recuperado. */
const INBOX = "Caixa de entrada";

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

function Notes({ api, drafts }: { api: NotesApi; drafts: Drafts }) {
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
    // O rascunho anda junto com a edição, para sobreviver a um fechamento que o save não alcançou.
    if (current.current && !undecided.current) drafts.set({ path: current.current, body: doc, baseVersion: version.current });
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
    const n = await api.create(noteName(d.path), INBOX, d.body).catch(() => null);
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

const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="kn-notes kn-notes-empty">
      <div className="kn-drag electrobun-webkit-app-region-drag" />
      {children}
    </div>
  );
}

function App() {
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
  return <Notes api={api} drafts={drafts} />;
}

document.title = "Notas";
mount(<App />);
