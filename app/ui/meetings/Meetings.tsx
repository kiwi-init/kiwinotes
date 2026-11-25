// A aba Reuniões do hub (R6, T4947, issue #198, spec #4823): a lista das notas de reunião (`type: meeting`, do R4),
// abrir nas Notas, renomear e apagar (para a Lixeira do app, com Desfazer), o card ao vivo durante a gravação e os
// ajustes de reunião. Sem "ouvir o trecho": o áudio é apagado depois de transcrito (#4840).
import "./meetings.css";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

import {
  durationLabel,
  elapsedLabel,
  type MeetingLive,
  MEETINGS_FOLDER_LABEL,
  type MeetingNote,
  NOT_RECORDING,
  participantsLabel,
} from "../../src/shared/meetings.ts";
import { INTL_TAG, type Locale, translate } from "../../src/shared/i18n/index.ts";
import { api, has } from "../src/api.ts";
import { useT, withStrong } from "../src/i18n.ts";
import { Button, Empty, Window } from "../src/kit/index.tsx";
import { TrashIcon } from "../src/kit/editable.tsx";
import { MeetingSettingsSection } from "./MeetingSettings.tsx";

type Load = "loading" | "ready" | "error";

/** O atalho padrão de gravar, como o vazio mostra. */
const MEETING_SHORTCUT = "⌃⌥R";

/** "Hoje", "Ontem" ou "quinta-feira, 6 de novembro" ("Thursday, November 6"), na língua das telas (T29247). */
export function dayLabel(day: string, now = new Date(), locale: Locale = "pt"): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y!, m! - 1, d!);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === now.toDateString()) return translate(locale, "meetings.today");
  if (date.toDateString() === yesterday.toDateString()) return translate(locale, "meetings.yesterday");
  return date.toLocaleDateString(INTL_TAG[locale], { weekday: "long", day: "numeric", month: "long" });
}

/** "09:05" em português, "9:05 AM" em inglês. */
export const clock = (iso: string, locale: Locale = "pt") =>
  new Date(iso).toLocaleTimeString(INTL_TAG[locale], { hour: locale === "pt" ? "2-digit" : "numeric", minute: "2-digit" });

/** `onOpen`: abrir a nota nas Notas (o hub troca de seção). */
export function Meetings({ onOpen }: { onOpen(path: string): void }) {
  const { t, locale } = useT();
  const [meetings, setMeetings] = useState<MeetingNote[]>([]);
  const [load, setLoad] = useState<Load>("loading");
  const [live, setLive] = useState<MeetingLive>(NOT_RECORDING);
  /** A nota que acabou de ir para a Lixeira: "Desfazer" por um tempo. */
  const [trashed, setTrashed] = useState<MeetingNote | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const seq = useRef(0);

  const refresh = useCallback(() => {
    const my = ++seq.current;
    api.meetings.list().then(
      (r) => {
        if (my !== seq.current) return;
        setMeetings(r.meetings);
        setLoad("ready");
      },
      () => my === seq.current && setLoad("error"),
    );
  }, []);

  useEffect(() => {
    if (!has("meetings.list")) return setLoad("error");
    refresh();
    // As notas mudam (a transcrição crescendo, um rename no Obsidian): a lista lê de novo, sem pressa.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = api.meetings.onNotesChanged(() => {
      clearTimeout(timer);
      timer = setTimeout(refresh, 300);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [refresh]);

  useEffect(() => {
    if (!has("meetings.live")) return;
    api.meetings.live().then(setLive, () => {});
    return api.meetings.onLive(setLive);
  }, []);

  // O Desfazer some depois de um tempo (a nota segue 10 min na Lixeira do app, e dá para tirar de lá pelas Notas).
  useEffect(() => {
    if (!trashed) return;
    const t = setTimeout(() => setTrashed(null), 8000);
    return () => clearTimeout(t);
  }, [trashed]);

  const remove = async (m: MeetingNote) => {
    setProblem(null);
    try {
      await api.meetings.delete(m.path);
      setMeetings((list) => list.filter((x) => x.path !== m.path));
      setTrashed(m);
    } catch {
      setProblem(t("meetings.deleteFailed", { title: m.title }));
    }
  };

  const undo = async () => {
    if (!trashed) return;
    const m = trashed;
    setTrashed(null);
    try {
      await api.meetings.restore(m.path);
      refresh();
    } catch {
      setProblem(t("meetings.restoreFailed", { title: m.title }));
    }
  };

  const rename = async (m: MeetingNote, title: string) => {
    const name = title.trim();
    setRenaming(null);
    if (!name || name === m.title) return;
    const folder = m.path.includes("/") ? m.path.slice(0, m.path.lastIndexOf("/") + 1) : "";
    setProblem(null);
    try {
      await api.meetings.rename(m.path, `${folder}${name}.md`);
      refresh();
    } catch (e) {
      const code = (e as { code?: string }).code;
      setProblem(code === "E_EXISTS" ? t("meetings.renameExists", { name }) : t("meetings.renameFailed", { title: m.title }));
    }
  };

  const groups: { day: string; items: MeetingNote[] }[] = [];
  for (const m of meetings) {
    if (groups.at(-1)?.day !== m.date) groups.push({ day: m.date, items: [] });
    groups.at(-1)!.items.push(m);
  }

  return (
    <Window title={t("meetings.title")}>
      {live.recording ? <LiveCard live={live} /> : null}
      {trashed ? (
        <div className="kn-meet-notice" role="status">
          <span>{t("meetings.trashed", { title: trashed.title })}</span>
          <Button onClick={undo}>{t("meetings.undo")}</Button>
        </div>
      ) : null}
      {problem ? (
        <div className="kn-meet-notice" data-tone="danger" role="alert">
          {problem}
        </div>
      ) : null}
      {load === "error" ? (
        <Empty title={t("meetings.loadFailed")}>
          <Button onClick={refresh}>{t("meetings.retry")}</Button>
        </Empty>
      ) : load === "ready" && meetings.length === 0 ? (
        <Empty icon={<MeetingIcon />} title={t("meetings.empty")}>
          {withStrong((shortcut) => t("meetings.emptyHint", { shortcut, folder: MEETINGS_FOLDER_LABEL }), MEETING_SHORTCUT)}
        </Empty>
      ) : (
        groups.map((g) => (
          <section key={g.day} className="kn-meet-day">
            <h2 className="kn-day">{dayLabel(g.day, undefined, locale)}</h2>
            <div className="kn-card">
              {g.items.map((m) => (
                <MeetingRow
                  key={m.path}
                  meeting={m}
                  renaming={renaming === m.path}
                  onOpen={() => onOpen(m.path)}
                  onRename={() => setRenaming(m.path)}
                  onRenamed={(title) => void rename(m, title)}
                  onCancelRename={() => setRenaming(null)}
                  onDelete={() => void remove(m)}
                />
              ))}
            </div>
          </section>
        ))
      )}
      <div className="kn-meet-settings">
        <MeetingSettingsSection />
      </div>
    </Window>
  );
}

export function MeetingRow({
  meeting: m,
  renaming,
  onOpen,
  onRename,
  onRenamed,
  onCancelRename,
  onDelete,
}: {
  meeting: MeetingNote;
  renaming: boolean;
  onOpen(): void;
  onRename(): void;
  onRenamed(title: string): void;
  onCancelRename(): void;
  onDelete(): void;
}) {
  const { t, locale } = useT();
  const meta = [
    m.start ? clock(m.start, locale) : null,
    // Sem `end` e sem gravação (o helper ou o app caiu antes do T7938): o `duration: 0` não é a duração dela.
    m.live
      ? t("meetings.row.recording")
      : m.start && m.end === null
        ? t("meetings.row.interrupted")
        : m.duration !== null
          ? durationLabel(m.duration, locale)
          : null,
    m.app,
  ].filter(Boolean);
  const people = participantsLabel(m.participants, locale);
  return (
    <article className="kn-meet-row" data-live={m.live}>
      {renaming ? (
        <RenameField title={m.title} onDone={onRenamed} onCancel={onCancelRename} />
      ) : (
        <button type="button" className="kn-meet-open" onClick={onOpen} aria-label={t("meetings.row.open", { title: m.title })}>
          <span className="kn-meet-title">{m.title}</span>
          <span className="kn-meet-meta">
            {meta.map((part, i) => (
              <span key={i}>{part}</span>
            ))}
          </span>
          {people ? <span className="kn-meet-people">{people}</span> : null}
        </button>
      )}
      <span className="kn-entry-actions kn-meet-actions">
        <button type="button" className="kn-icon-button" aria-label={t("meetings.row.rename", { title: m.title })} onClick={onRename}>
          <PencilIcon />
        </button>
        <button type="button" className="kn-icon-button" data-tone="danger" aria-label={t("meetings.row.delete", { title: m.title })} onClick={onDelete}>
          <TrashIcon />
        </button>
      </span>
    </article>
  );
}

function RenameField({ title, onDone, onCancel }: { title: string; onDone(title: string): void; onCancel(): void }) {
  const { t } = useT();
  const [value, setValue] = useState(title);
  const ref = useRef<HTMLInputElement>(null);
  // O Enter e o blur que vem logo depois (o campo sai da tela) não renomeiam duas vezes.
  const done = useRef(false);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    if (v === null) onCancel();
    else onDone(v);
  };
  useEffect(() => ref.current?.select(), []);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    finish(value);
  };
  return (
    <form className="kn-meet-rename" onSubmit={submit}>
      <input
        ref={ref}
        className="kn-input"
        aria-label={t("meetings.row.newName")}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && finish(null)}
        onBlur={() => finish(value)}
      />
    </form>
  );
}

/** O card ao vivo: o app, o tempo, "pausar meu mic" e parar. Os botões só agem no clique da pessoa. */
export function LiveCard({ live }: { live: Extract<MeetingLive, { recording: true }> }) {
  const { t } = useT();
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const act = async (what: () => Promise<unknown>, failed: string) => {
    setBusy(true);
    setError(null);
    try {
      await what();
    } catch {
      setError(failed);
    } finally {
      setBusy(false);
    }
  };
  const elapsed = elapsedLabel((now - Date.parse(live.since)) / 1000);
  return (
    <section className="kn-meet-live" aria-label={t("meetings.live.label")}>
      <span className="kn-meet-dot" aria-hidden="true" />
      <div className="kn-meet-live-text">
        <div className="kn-meet-live-title">{live.app ? t("meetings.live.titleApp", { app: live.app }) : t("meetings.live.title")}</div>
        <div className="kn-meet-live-hint">
          <span className="kn-meet-clock">{elapsed}</span>
          {live.minePaused ? <span> · {t("meetings.live.minePaused")}</span> : null}
        </div>
        {live.warning === "system_audio_silent" ? (
          <div className="kn-meet-live-error">{t("meetings.live.silent")}</div>
        ) : live.warning === "transcription_unavailable" ? (
          <div className="kn-meet-live-error">{t("meetings.live.noTranscription")}</div>
        ) : live.warning === "note_recreated" ? (
          <div className="kn-meet-live-error">{t("meetings.live.noteRecreated", { folder: MEETINGS_FOLDER_LABEL })}</div>
        ) : null}
        {error ? <div className="kn-meet-live-error">{error}</div> : null}
      </div>
      <Button
        disabled={busy}
        aria-pressed={live.minePaused}
        onClick={() => act(() => api.meetings.pauseMine(!live.minePaused), t("meetings.live.pauseFailed"))}
      >
        {live.minePaused ? t("meetings.live.resumeMine") : t("meetings.live.pauseMine")}
      </Button>
      <Button variant="primary" disabled={busy} onClick={() => act(() => api.meetings.stop(), t("meetings.live.stopFailed"))}>
        {t("meetings.live.stop")}
      </Button>
    </section>
  );
}

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10.5 2.5l3 3L6 13H3v-3z" />
    </svg>
  );
}

/** O glifo da seção: o mesmo do vazio de antes (T2778). */
export function MeetingIcon() {
  return (
    <svg width="44" height="44" viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ color: "var(--accent)" }}>
      <circle cx="12" cy="13" r="4.5" />
      <circle cx="24" cy="13" r="4.5" />
      <path d="M4.5 28c.8-4.6 3.8-7 7.5-7s6.7 2.4 7.5 7M16.5 28c.8-4.6 3.8-7 7.5-7s6.7 2.4 7.5 7" />
    </svg>
  );
}
