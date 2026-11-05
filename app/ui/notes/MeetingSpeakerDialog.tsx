import { useState } from "react";
import { NO_TEXT_ASSIST } from "../src/textAssist.ts";

export function MeetingSpeakerDialog({
  speakers,
  onRename,
  onClose,
}: {
  speakers: string[];
  onRename(from: string, to: string): Promise<void>;
  onClose(): void;
}) {
  const [from, setFrom] = useState(speakers[0] ?? "");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!name.trim() || !from || busy) return;
    setBusy(true);
    setError("");
    try {
      await onRename(from, name.trim());
      onClose();
    } catch {
      setError(
        "Não deu para renomear. Confira se o nome já está em uso e tente de novo.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="kn-palette-scrim"
      onMouseDown={onClose}
      onKeyDown={(e) => e.key === "Escape" && !busy && onClose()}
    >
      <form
        className="kn-palette kn-meeting-speaker"
        role="dialog"
        aria-label="Renomear falante"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2>Renomear falante</h2>
        <label>
          Falante
          <select
            aria-label="Falante"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          >
            {speakers.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Novo nome
          <input
            autoFocus
            aria-label="Novo nome"
            {...NO_TEXT_ASSIST}
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <p className="kn-faint">
          O nome muda nesta transcrição e nas próximas falas desta reunião.
        </p>
        {error ? <p role="alert">{error}</p> : null}
        <div className="kn-meeting-speaker-actions">
          <button
            className="kn-bt"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            Cancelar
          </button>
          <button
            className="kn-bt kn-bt-acc"
            type="submit"
            disabled={!name.trim() || !from || busy}
          >
            Renomear
          </button>
        </div>
      </form>
    </div>
  );
}
