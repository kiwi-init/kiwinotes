import { useEffect, useRef, useState } from "react";
import { api, has } from "../src/api.ts";
import { useT } from "../src/i18n.ts";
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
  const { t } = useT();
  if (!c.pending) return null;
  // O caminho fica em `<strong>`, dentro da frase da língua.
  const [before, after = ""] = t("notesFolder.big.body", { n: c.pending.count - 1, path: "\u0000" }).split("\u0000");
  return (
    <div className="kn-palette-scrim">
      <section
        className="kn-palette kn-folder-confirm"
        role="dialog"
        aria-label={t("notesFolder.big.aria")}
      >
        <h2>{t("notesFolder.big.title")}</h2>
        <p>
          {before}
          <strong>{c.pending.path}</strong>
          {after}
        </p>
        <div>
          <button type="button" className="kn-bt" onClick={c.cancel}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="kn-bt kn-bt-acc"
            onClick={() => void c.open(undefined, c.pending!.token)}
          >
            {t("notesFolder.big.open")}
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
  const { t } = useT();
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
        aria-label={t("notesFolder.label")}
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
          aria-label={t("notesFolder.menu")}
        >
          <button type="button" role="menuitem" onClick={() => void choose()}>
            {t("notesFolder.open")}
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
  const { t } = useT();
  const c = useNotesFolders();
  if (!c.supported) return null;
  return (
    <Row
      label={t("notesFolder.label")}
      hint={t("notesFolder.hint", { path: c.view?.current.path ?? t("notesFolder.reading") })}
    >
      <NotesFolderControl controller={c} />
      <FolderConfirmation controller={c} />
    </Row>
  );
}
