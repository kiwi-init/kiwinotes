import { useState } from "react";
import { NO_TEXT_ASSIST } from "../src/textAssist.ts";
import { useT } from "../src/i18n.ts";

export function MeetingSpeakerDialog({
  speakers,
  onRename,
  onClose,
}: {
  speakers: string[];
  onRename(from: string, to: string): Promise<void>;
  onClose(): void;
}) {
  const { t } = useT();
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
      setError(t("notes.speaker.failed"));
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
        aria-label={t("notes.speaker.title")}
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2>{t("notes.speaker.title")}</h2>
        <label>
          {t("notes.speaker.speaker")}
          <select
            aria-label={t("notes.speaker.speaker")}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          >
            {speakers.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          {t("notes.side.newName")}
          <input
            autoFocus
            aria-label={t("notes.side.newName")}
            {...NO_TEXT_ASSIST}
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <p className="kn-faint">
          {t("notes.speaker.hint")}
        </p>
        {error ? <p role="alert">{error}</p> : null}
        <div className="kn-meeting-speaker-actions">
          <button
            className="kn-bt"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            {t("notes.cancel")}
          </button>
          <button
            className="kn-bt kn-bt-acc"
            type="submit"
            disabled={!name.trim() || !from || busy}
          >
            {t("notes.menu.rename")}
          </button>
        </div>
      </form>
    </div>
  );
}
