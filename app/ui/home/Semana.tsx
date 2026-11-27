// A Semana da aba Início (T15875, harry #15873; o desenho é a proposta 5, p5.tsx): os números dos 7 dias e a linha do
// tempo, um dia por linha, com as notas e as reuniões (o clique abre) e quantos ditados.
import type { HomeWeek, WeekDay } from "../../src/shared/home.ts";
import { api } from "../src/api.ts";
import { MeetingIcon, MicIcon, NoteIcon } from "./icons.tsx";
import { dayLabel, hours, thousands, weekRange } from "./when.ts";
import { useHome } from "./useHome.ts";
import { useT } from "../src/i18n.ts";

export function Semana({ onOpen, onCalendar }: { onOpen(path: string, internal: boolean): void; onCalendar?(): void }) {
  const { t } = useT();
  const load = useHome(api.home.week);
  return (
    <div className="kn-home-v-page" data-view="semana">
      <div className="kn-home-v-head">
        <h1 className="kn-home-v-title">{t("home.week.title")}</h1>
        {onCalendar ? (
          <button type="button" className="kn-home-week-open" onClick={onCalendar}>
            {t("home.week.openCalendar")} →
          </button>
        ) : null}
      </div>
      {load.state === "ready" ? <Week week={load.data} onOpen={onOpen} /> : load.state === "error" ? <p className="kn-home-v-empty">{t("home.week.readFailed")}</p> : null}
    </div>
  );
}

function Week({ week, onOpen }: { week: HomeWeek; onOpen(path: string, internal: boolean): void }) {
  const { t } = useT();
  const tot = week.totals;
  const numbers = [
    { id: "notes", value: tot.notes, label: t("home.week.notesEdited", { n: tot.notes }) },
    { id: "meetings", value: tot.meetings, label: t("home.week.meetings", { n: tot.meetings }), extra: tot.meetingMin ? t("home.week.recorded", { time: hours(tot.meetingMin) }) : null },
    { id: "dictations", value: tot.dictations, label: t("home.week.dictations", { n: tot.dictations }), extra: tot.words ? t("home.week.words", { n: tot.words, count: thousands(tot.words) }) : null },
  ];
  return (
    <>
      <p className="kn-home-v-sub">{weekRange(week.days.at(-1)!.date, week.days[0]!.date)}</p>
      <div className="kn-home-v-numbers">
        {numbers.map((n) => (
          <div key={n.id} className="kn-home-v-card kn-home-v-number">
            <b>{thousands(n.value)}</b>
            <span>{n.label}</span>
            {n.extra ? <span className="kn-home-v-muted">{n.extra}</span> : null}
          </div>
        ))}
      </div>
      <ol className="kn-home-v-timeline">
        {week.days.map((d, i) => (
          <Day key={d.date} d={d} i={i} onOpen={onOpen} />
        ))}
      </ol>
    </>
  );
}

function Day({ d, i, onOpen }: { d: WeekDay; i: number; onOpen(path: string, internal: boolean): void }) {
  const { t } = useT();
  const empty = !d.notes.length && !d.meetings.length && !d.dictations;
  return (
    <li data-today={i === 0 ? "true" : undefined} data-date={d.date}>
      <span className="kn-home-v-day">{dayLabel(d.date, i)}</span>
      <span className="kn-home-v-dot" aria-hidden="true" />
      <span className="kn-home-v-chips">
        {d.meetings.map((m) => (
          <button type="button" key={m.path} className="kn-home-v-chip" data-kind="meeting" onClick={() => onOpen(m.path, m.internal)}>
            <MeetingIcon size={13} />
            {m.title}
            {m.durationMin ? <span className="kn-home-v-muted">{hours(m.durationMin)}</span> : null}
          </button>
        ))}
        {d.notes.map((n) => (
          <button type="button" key={n.path} className="kn-home-v-chip" data-kind="note" onClick={() => onOpen(n.path, false)}>
            <NoteIcon size={13} />
            {n.title}
          </button>
        ))}
        {d.moreNotes ? <span className="kn-home-v-chip" data-kind="more">{t("home.week.moreNotes", { n: d.moreNotes, count: String(d.moreNotes) })}</span> : null}
        {d.dictations ? (
          <span className="kn-home-v-chip" data-kind="dictation">
            <MicIcon size={13} />
            {t("home.week.dayDictations", { n: d.dictations, count: String(d.dictations) })}
          </span>
        ) : null}
        {empty ? <span className="kn-home-v-muted kn-home-v-quiet">{t("home.week.nothing")}</span> : null}
      </span>
    </li>
  );
}
