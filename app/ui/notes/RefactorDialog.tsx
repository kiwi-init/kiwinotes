import { useEffect, useRef, useState } from "react";
import { NO_TEXT_ASSIST } from "../src/textAssist.ts";
import { useT } from "../src/i18n.ts";

/** App-owned form: no native prompts, permission dialogs or clipboard access. */
export function RefactorDialog({ kind, name, onRename, onClose }: {
  kind: "heading" | "tag";
  name: string;
  onRename(name: string): Promise<void>;
  onClose(): void;
}) {
  const { t } = useT();
  const [value, setValue] = useState(name), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  const submit = async () => {
    if (busy || !value.trim() || value.trim() === name) return;
    setBusy(true); setError("");
    try { await onRename(value.trim()); onClose(); }
    catch (e) {
      const code = (e as { code?: string }).code;
      setError(t(code === "E_EXISTS" ? "notes.refactor.exists" : code === "E_CONFLICT" ? "notes.refactor.conflict" : code === "E_BAD_ARGS" ? (kind === "tag" ? "notes.refactor.badTag" : "notes.refactor.badHeading") : "notes.refactor.failed"));
    } finally { setBusy(false); }
  };
  return <div className="kn-palette-scrim" onMouseDown={() => !busy && onClose()}
    onKeyDown={e => {
      e.stopPropagation();
      if (e.key === "Escape" && !busy) onClose();
      if (e.key === "Tab") {
        const controls = [...e.currentTarget.querySelectorAll<HTMLElement>('input:not(:disabled),button:not(:disabled)')];
        const first = controls[0], last = controls.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    }}>
    <form className="kn-palette kn-meeting-speaker" role="dialog" aria-modal="true" aria-label={t(kind === "tag" ? "notes.refactor.tag" : "notes.refactor.heading")}
      onMouseDown={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); void submit(); }}>
      <h2>{t(kind === "tag" ? "notes.refactor.tag" : "notes.refactor.heading")}</h2>
      <label>{t("notes.side.newName")}<input ref={input} aria-label={t("notes.side.newName")} {...NO_TEXT_ASSIST} maxLength={200} value={value} onChange={e => { setValue(e.target.value); setError(""); }} disabled={busy} /></label>
      <p className="kn-faint">{t(kind === "tag" ? "notes.refactor.tagHint" : "notes.refactor.headingHint")}</p>
      {error ? <p role="alert">{error}</p> : null}
      <div className="kn-meeting-speaker-actions">
        <button type="button" className="kn-bt" disabled={busy} onClick={onClose}>{t("notes.cancel")}</button>
        <button type="submit" className="kn-bt kn-bt-acc" disabled={busy || !value.trim() || value.trim() === name}>{t(busy ? "notes.refactor.busy" : "notes.menu.rename")}</button>
      </div>
    </form>
  </div>;
}
