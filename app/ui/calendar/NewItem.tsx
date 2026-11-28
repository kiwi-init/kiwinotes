// O "+ Novo" da aba Calendário (T32155): título, tipo, projeto, dia e hora (sem hora, o dia todo). O item vai para
// `<projeto>/Pendências.md`, ou `Calendário.md` na raiz sem projeto (o main decide, T32154). O tipo Nota vira uma nota
// nova, `<projeto>/<título>.md`, e o rodapé diz essa (#492).

import { useEffect, useRef, useState } from "react";

import { CALENDAR_KINDS, type CalendarCreate, type CalendarKind, type CalendarRepeat, titleProblem } from "../../src/shared/calendar.ts";
import { noteFileName } from "../../src/shared/note-name.ts";
import { useT } from "../src/i18n.ts";
import { RepeatField } from "./RepeatField.tsx";

const inFolder = (project: string, name: string) => `${project ? `${project}/` : ""}${name}.md`;

/** O rodapé do "+ Novo": o arquivo que o `calendar.create` escreve. A Nota vira `<projeto>/<título>.md` (com " 2" se o nome já existe). */
export function whereOf(kind: CalendarKind, project: string, title: string): { key: "calendar.new.where" | "calendar.new.whereNote" | "calendar.new.whereNoteBlank"; path?: string } {
  if (kind !== "note") return { key: "calendar.new.where", path: inFolder(project, project ? "Pendências" : "Calendário") }; // i18n-ok: o arquivo que o main escreve
  const name = noteFileName(title);
  return name ? { key: "calendar.new.whereNote", path: inFolder(project, name) } : { key: "calendar.new.whereNoteBlank" };
}

export function NewItem({ day, projects, onCancel, onCreate }: { day: string; projects: string[]; onCancel(): void; onCreate(c: CalendarCreate): void }) {
  const { t } = useT();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<CalendarKind>("task");
  const [project, setProject] = useState("");
  const [date, setDate] = useState(day);
  const [time, setTime] = useState("");
  const [end, setEnd] = useState("");
  // A repetição (T34775): `undefined` é o "Personalizar…" com algo faltando, e o Criar espera.
  const [repeat, setRepeat] = useState<CalendarRepeat | null | undefined>(null);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => field.current?.focus(), []);
  // O pedaço que a nota leria como tipo, aviso, repetição ou data (#493): o Criar fica desligado e o motivo aparece.
  const bad = title.trim() ? titleProblem(title) : null;
  const ok = title.trim() && !bad && /^\d{4}-\d{2}-\d{2}$/.test(date) && (!end || (time && end > time)) && (kind === "note" || repeat !== undefined);
  const submit = () => {
    if (!ok) return;
    onCreate({
      kind,
      title: title.trim(),
      project: project || null,
      start: time ? `${date}T${time}` : date,
      end: time && end ? `${date}T${end}` : null,
      allDay: !time,
      // A nota não repete (o main recusa).
      ...(kind !== "note" && repeat ? { repeat } : {}),
    });
  };
  return (
    <div
      className="kn-cal-newform"
      role="dialog"
      aria-label={t("calendar.new.title")}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h3>{t("calendar.new.title")}</h3>
        <label>
          {t("calendar.new.name")}
          <input ref={field} name="title" value={title} maxLength={300} placeholder={t("calendar.new.placeholder")} onChange={(e) => setTitle(e.target.value)} aria-invalid={bad ? true : undefined} aria-describedby={bad ? "kn-cal-title-problem" : undefined} />
        </label>
        {bad ? (
          <p id="kn-cal-title-problem" className="kn-cal-title-problem" role="alert">
            {t("calendar.new.titleProblem", { piece: bad })}
          </p>
        ) : null}
        <div className="kn-cal-kinds" role="radiogroup" aria-label={t("calendar.row.kind")}>
          {CALENDAR_KINDS.map((k) => (
            <button type="button" role="radio" key={k} data-kind={k} aria-checked={kind === k} onClick={() => setKind(k)}>
              {t(`calendar.kind.${k}`)}
            </button>
          ))}
        </div>
        <label>
          {t("calendar.row.project")}
          <select name="project" value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">{t("calendar.noProject")}</option>
            {projects.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <div className="kn-cal-newrow">
          <label>
            {t("calendar.new.day")}
            <input type="date" name="day" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            {t("calendar.new.time")}
            <input type="time" name="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
          <label>
            {t("calendar.new.end")}
            <input type="time" name="end" step={900} value={end} disabled={!time} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
        {kind !== "note" ? <RepeatField value={repeat ?? null} day={date} onChange={setRepeat} /> : null}
        {(() => {
          const w = whereOf(kind, project, title);
          return <p className="kn-cal-muted kn-cal-where">{t(w.key, w.path ? { path: w.path } : undefined)}</p>;
        })()}
        <div className="kn-cal-acts">
          <button type="button" className="kn-cal-btn" onClick={onCancel}>
            {t("calendar.new.cancel")}
          </button>
          <button type="submit" className="kn-cal-btn kn-cal-primary" disabled={!ok}>
            {t("calendar.new.create")}
          </button>
        </div>
      </form>
    </div>
  );
}
