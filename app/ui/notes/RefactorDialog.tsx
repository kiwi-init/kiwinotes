import { useEffect, useRef, useState } from "react";
import { NO_TEXT_ASSIST } from "../src/textAssist.ts";

/** App-owned form: no native prompts, permission dialogs or clipboard access. */
export function RefactorDialog({ kind, name, onRename, onClose }: {
  kind: "heading" | "tag";
  name: string;
  onRename(name: string): Promise<void>;
  onClose(): void;
}) {
  const [value, setValue] = useState(name), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  const submit = async () => {
    if (busy || !value.trim() || value.trim() === name) return;
    setBusy(true); setError("");
    try { await onRename(value.trim()); onClose(); }
    catch (e) {
      const code = (e as { code?: string }).code;
      setError(code === "E_EXISTS" ? "Este nome já está em uso. Escolha outro." : code === "E_CONFLICT" ? "A nota mudou. Feche e abra o renomear novamente." : code === "E_BAD_ARGS" ? (kind === "tag" ? "Use letras, números, _ ou -, e / entre níveis." : "Use um título simples, em uma linha, sem marcação.") : "Não deu para renomear. Tente novamente.");
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
    <form className="kn-palette kn-meeting-speaker" role="dialog" aria-modal="true" aria-label={kind === "tag" ? "Renomear tag" : "Renomear título"}
      onMouseDown={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); void submit(); }}>
      <h2>{kind === "tag" ? "Renomear tag" : "Renomear título"}</h2>
      <label>Novo nome<input ref={input} aria-label="Novo nome" {...NO_TEXT_ASSIST} maxLength={200} value={value} onChange={e => { setValue(e.target.value); setError(""); }} disabled={busy} /></label>
      <p className="kn-faint">{kind === "tag" ? "As menções a esta tag e às suas subtags mudam em todas as notas desta pasta." : "Os links para este título acompanham a mudança em todas as notas desta pasta. Os rótulos dos links são mantidos."}</p>
      {error ? <p role="alert">{error}</p> : null}
      <div className="kn-meeting-speaker-actions">
        <button type="button" className="kn-bt" disabled={busy} onClick={onClose}>Cancelar</button>
        <button type="submit" className="kn-bt kn-bt-acc" disabled={busy || !value.trim() || value.trim() === name}>{busy ? "Renomeando…" : "Renomear"}</button>
      </div>
    </form>
  </div>;
}
