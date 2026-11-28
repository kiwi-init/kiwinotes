// O "+ Novo" da aba Calendário (T32155): título, tipo, projeto, dia e hora (sem hora, o dia todo). O item vai para
// `<projeto>/Pendências.md`, ou `Calendário.md` na raiz sem projeto (o main decide, T32154). O tipo Nota vira uma nota
// nova, `<projeto>/<título>.md`, e o rodapé diz essa (#492).

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { CALENDAR_KINDS, type CalendarCreate, type CalendarKind, titleProblem } from "../../src/shared/calendar.ts";
import { noteFileName } from "../../src/shared/note-name.ts";
import { useT } from "../src/i18n.ts";
import type { Rect } from "./Detail.tsx";

const inFolder = (project: string, name: string) => `${project ? `${project}/` : ""}${name}.md`;

/** O rodapé do "+ Novo": o arquivo que o `calendar.create` escreve. A Nota vira `<projeto>/<título>.md` (com " 2" se o nome já existe). */
export function whereOf(kind: CalendarKind, project: string, title: string): { key: "calendar.new.where" | "calendar.new.whereNote" | "calendar.new.whereNoteBlank"; path?: string } {
  if (kind !== "note") return { key: "calendar.new.where", path: inFolder(project, project ? "Pendências" : "Calendário") }; // i18n-ok: o arquivo que o main escreve
  const name = noteFileName(title);
  return name ? { key: "calendar.new.whereNote", path: inFolder(project, name) } : { key: "calendar.new.whereNoteBlank" };
}

/** A hora que o "Dia todo" desligado sugere: a próxima hora cheia, até as 23:00 (#531). */
export function nextHour(now: Date): string {
  return `${String(Math.min(23, now.getHours() + 1)).padStart(2, "0")}:00`;
}

/** A folga entre o formulário e o rascunho, e entre ele e a borda da tela. */
const GAP_PX = 8;

/**
 * Onde o formulário abre ao lado do rascunho (spec #34706, ponto 5): à direita dele se cabe, senão à esquerda, na altura
 * dele e sem sair da tela. No Dia, o rascunho ocupa a largura toda e não sobra lado: o formulário encosta na borda da
 * direita, por cima só do fim do rascunho, e o "(sem título)" com a hora, à esquerda, segue à vista. Tudo relativo ao `.kn-cal`.
 */
export function placeNear(near: Rect, box: { width: number; height: number }, area: { width: number; height: number }): { left: number; top: number } {
  const right = near.left + near.width + GAP_PX;
  const leftSide = near.left - box.width - GAP_PX;
  const edge = area.width - box.width - GAP_PX;
  const left = right <= edge ? right : leftSide >= GAP_PX ? leftSide : edge;
  const clamp = (v: number, max: number) => Math.max(GAP_PX, Math.min(max, v));
  return { left: clamp(left, edge), top: clamp(near.top, area.height - box.height - GAP_PX) };
}

export function NewItem({ day, time: startTime = "", end: endTime = "", near, projects, onCancel, onCreate }: { day: string; time?: string; end?: string; near?: Rect; projects: string[]; onCancel(): void; onCreate(c: CalendarCreate): void }) {
  const { t } = useT();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<CalendarKind>("task");
  const [project, setProject] = useState("");
  const [date, setDate] = useState(day);
  const [time, setTime] = useState(startTime);
  const [end, setEnd] = useState(endTime);
  const field = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => field.current?.focus(), []);
  // Aberto pelo vazio, o formulário fica ao lado do horário ou do dia, como no Teams; pelo "+ Novo", no canto de sempre.
  useLayoutEffect(() => {
    const el = box.current;
    const area = el?.offsetParent as HTMLElement | null;
    if (!el || !near || !area) return;
    const at = placeNear(near, { width: el.offsetWidth, height: el.offsetHeight }, { width: area.clientWidth, height: area.clientHeight });
    Object.assign(el.style, { left: `${at.left}px`, top: `${at.top}px`, right: "auto" });
  }, [near]);
  // O pedaço que a nota leria como tipo, aviso, repetição ou data (#493): o Criar fica desligado e o motivo aparece.
  const bad = title.trim() ? titleProblem(title) : null;
  const ok = title.trim() && !bad && /^\d{4}-\d{2}-\d{2}$/.test(date) && (!end || (time && end > time));
  const submit = () => {
    if (!ok) return;
    onCreate({
      kind,
      title: title.trim(),
      project: project || null,
      start: time ? `${date}T${time}` : date,
      end: time && end ? `${date}T${end}` : null,
      allDay: !time,
    });
  };
  return (
    <div
      ref={box}
      className="kn-cal-newform"
      data-near={near ? "" : undefined}
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
        {/* O dia todo é escolha à vista, não a hora vazia (#531): o WebKit desenha "12:30" num campo de hora vazio. */}
        <label className="kn-cal-alldaybox">
          <input
            type="checkbox"
            name="allDay"
            checked={!time}
            onChange={(e) => {
              if (e.target.checked) {
                setTime("");
                setEnd("");
              } else setTime(nextHour(new Date()));
            }}
          />
          {t("calendar.new.allDay")}
        </label>
        <div className="kn-cal-newrow">
          <label>
            {t("calendar.new.day")}
            <input type="date" name="day" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            {t("calendar.new.time")}
            <input type="time" name="time" step={900} value={time} data-empty={time ? undefined : ""} onChange={(e) => setTime(e.target.value)} />
          </label>
          <label>
            {t("calendar.new.end")}
            <input type="time" name="end" step={900} value={end} data-empty={end ? undefined : ""} disabled={!time} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
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
