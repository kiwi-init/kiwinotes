import { useEffect, useRef, useState } from "react";
import { api, has } from "../src/api.ts";
import { Row } from "../src/kit/index.tsx";
import type {
  FolderRef,
  FolderView,
} from "../../src/notes/folders-workspace.ts";

export function useNotesFolders(onOpened?: () => void) {
  const [view, setView] = useState<FolderView | null>(null),
    [error, setError] = useState("");
  const [pending, setPending] = useState<{
    token: string;
    path: string;
    count: number;
  } | null>(null);
  const opened = useRef(onOpened);
  opened.current = onOpened;
  const supported = has("notes.folder") && has("notes.openFolder");
  useEffect(() => {
    if (!supported) return;
    void api.noteFolders.get().then(
      (v) => {
        setView(v);
        setPending(v.pending ?? null);
        if (v.error) setError(v.error);
      },
      (e) => setError(e.message),
    );
    return api.noteFolders.onChanged((v) => {
      setView(v);
      setPending(v.pending ?? null);
      if (v.error) setError(v.error);
    });
  }, [supported]);
  const open = async (recent?: string, confirm?: string) => {
    setError("");
    try {
      const result = await api.noteFolders.open({
        ...(recent ? { recent } : {}),
        ...(confirm ? { confirm } : {}),
      });
      if (result.kind === "confirm") setPending(result);
      else if (result.kind === "opened") {
        setPending(null);
        setView(await api.noteFolders.get());
        opened.current?.();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return {
    supported,
    view,
    error,
    pending,
    open,
    cancel: () => {
      if (pending) void api.noteFolders.open({ cancel: pending.token });
      setPending(null);
    },
  };
}
export type FolderController = ReturnType<typeof useNotesFolders>;
export function FolderConfirmation({
  controller: c,
}: {
  controller: FolderController;
}) {
  if (!c.pending) return null;
  return (
    <div className="kn-palette-scrim">
      <section
        className="kn-palette kn-folder-confirm"
        role="dialog"
        aria-label="Pasta grande"
      >
        <h2>Esta pasta tem muitos arquivos</h2>
        <p>
          Há mais de {c.pending.count - 1} arquivos em{" "}
          <strong>{c.pending.path}</strong>. Abrir a pasta pode levar um tempo.
        </p>
        <div>
          <button type="button" className="kn-bt" onClick={c.cancel}>
            Cancelar
          </button>
          <button
            type="button"
            className="kn-bt kn-bt-acc"
            onClick={() => void c.open(undefined, c.pending!.token)}
          >
            Abrir mesmo assim
          </button>
        </div>
      </section>
    </div>
  );
}
export function NotesFolderControl({
  controller: c,
  folder,
  onBeforeOpen,
}: {
  controller: FolderController;
  folder?: FolderRef;
  onBeforeOpen?: () => Promise<boolean>;
}) {
  const [menu, setMenu] = useState(false);
  if (!c.supported || !c.view) return null;
  const shown = folder ?? c.view.current;
  const choose = async (recent?: string) => {
    if (onBeforeOpen && !(await onBeforeOpen())) return;
    setMenu(false);
    await c.open(recent);
  };
  return (
    <div className="kn-notes-folder">
      <button
        type="button"
        className="kn-bt"
        aria-label="Pasta das notas"
        title={shown.path}
        aria-expanded={menu}
        onClick={() => setMenu(!menu)}
      >
        {shown.name} ▾
      </button>
      {menu ? (
        <div
          className="kn-folder-menu"
          role="menu"
          aria-label="Pastas de notas"
        >
          <button type="button" role="menuitem" onClick={() => void choose()}>
            Abrir pasta…
          </button>
          {c.view.recent.map((r) => (
            <button
              type="button"
              role="menuitem"
              key={r.key}
              title={r.path}
              onClick={() => void choose(r.key)}
            >
              <span>{r.name}</span>
              <small>{r.path}</small>
            </button>
          ))}
        </div>
      ) : null}
      {c.error ? <p role="alert">{c.error}</p> : null}
    </div>
  );
}
export function NotesFolderRow() {
  const c = useNotesFolders();
  if (!c.supported) return null;
  return (
    <Row
      label="Pasta das notas"
      hint={`${c.view?.current.path ?? "Lendo a pasta…"} · As reuniões e o histórico do ditado continuam no lugar de sempre.`}
    >
      <NotesFolderControl controller={c} />
      <FolderConfirmation controller={c} />
    </Row>
  );
}
