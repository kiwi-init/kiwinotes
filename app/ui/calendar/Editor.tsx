// Editar o item à mão (T34745, spec #34706, pontos 3 e 4): o mesmo formulário no cartão (compacto) e na aba Item do
// painel largo. Cada campo grava sozinho pelo `calendar.update`: o título e o texto no Enter ou ao sair do campo, a
// data e as horas ao sair do grupo delas (as setas mudam o valor sem gravar a cada passo), o resto no clique. O Esc
// num campo volta o que estava. Apagar fica embaixo, com o Desfazer na tela (Calendar.tsx).

import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";

import { CALENDAR_LIMITS, CALENDAR_NOTIFY, type CalendarItem, type CalendarNotify, type CalendarRepeat, type CalendarUpdate, itemTextOf, titleProblem } from "../../src/shared/calendar.ts";
import { useT } from "../src/i18n.ts";
import { editable, fieldsOf, isOccurrence, LINE_KINDS, type WhenFields, whenPatch } from "./edit.ts";
import type { CalendarStore } from "./source.ts";

export interface EditorActions {
  /** Grava um pedaço do item; o cartão e o painel passam a mostrar o que o main devolveu. */
  edit(item: CalendarItem, patch: Omit<CalendarUpdate, "id">): Promise<void>;
  /** Apaga o item (ou só esta vez, numa repetição), com o Desfazer. */
  remove(item: CalendarItem, only?: boolean): void;
  setNotify(item: CalendarItem, n: CalendarNotify): void;
}

const REPEATS = ["", "daily", "weekly"] as const;

export function ItemEditor({ item, projects, source, a, compact }: { item: CalendarItem; projects: readonly string[]; source: CalendarStore; a: EditorActions; compact?: boolean }) {
  const { t } = useT();
  const can = editable(item);
  const [title, setTitle] = useState(item.title);
  const [when, setWhen] = useState<WhenFields>(() => fieldsOf(item));
  const [text, setText] = useState<string | null>(null);
  const savedText = useRef<string | null>(null);
  const whenBox = useRef<HTMLFieldSetElement>(null);

  // O item que o main devolveu (ou que mudou na nota) refaz os campos, menos o que a pessoa está digitando agora.
  useEffect(() => {
    const focus = document.activeElement;
    if (!(focus instanceof HTMLInputElement && focus.name === "title")) setTitle(item.title);
    if (!whenBox.current?.contains(focus)) setWhen(fieldsOf(item));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);

  useEffect(() => {
    let alive = true;
    if (!item.source) return setText(null);
    source.source(item.id).then(
      (s) => {
        if (!alive || !s) return;
        const v = itemTextOf(s.text, item.id.startsWith("f:") ? null : s.line);
        savedText.current = v;
        setText(v);
      },
      () => {},
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.source?.path]);

  const bad = title.trim() ? titleProblem(title) : null;
  const saveTitle = () => {
    const v = title.replace(/\s+/g, " ").trim();
    if (!v || bad || v === item.title) return setTitle(item.title);
    void a.edit(item, { title: v });
  };
  const patch = whenPatch(item, when);
  const saveWhen = () => {
    if (!patch) return setWhen(fieldsOf(item));
    if (Object.keys(patch).length) void a.edit(item, patch);
  };
  const saveText = () => {
    if (text === null || text === savedText.current) return;
    savedText.current = text;
    void a.edit(item, { text });
  };
  /** O Esc num campo volta o valor; com o campo igual, ele passa adiante e fecha o painel. */
  const esc = (e: ReactKeyboardEvent, dirty: boolean, revert: () => void) => {
    if (e.key !== "Escape" || !dirty) return;
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation();
    revert();
  };

  if (!can.any) return null;
  const id = (s: string) => `kn-cal-ed-${s}-${item.id.replace(/[^\w-]/g, "_")}`;

  return (
    <div className="kn-cal-editor" data-compact={compact ? "" : undefined} data-id={item.id}>
      <label className="kn-cal-ed-row">
        <span>{t("calendar.edit.title")}</span>
        <input
          name="title"
          value={title}
          maxLength={CALENDAR_LIMITS.title}
          disabled={!can.line}
          title={can.line ? undefined : t("calendar.edit.titleNote")}
          aria-invalid={bad ? true : undefined}
          aria-describedby={bad ? id("title") : undefined}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              saveTitle();
            }
            esc(e, title !== item.title, () => setTitle(item.title));
          }}
        />
      </label>
      {bad ? (
        <p id={id("title")} className="kn-cal-title-problem" role="alert">
          {t("calendar.new.titleProblem", { piece: bad })}
        </p>
      ) : null}
      {can.line ? (
        <div className="kn-cal-kinds" role="radiogroup" aria-label={t("calendar.row.kind")}>
          {LINE_KINDS.map((k) => (
            <button type="button" role="radio" key={k} data-kind={k} aria-checked={item.kind === k} onClick={() => item.kind !== k && void a.edit(item, { kind: k })}>
              {t(`calendar.kind.${k}`)}
            </button>
          ))}
        </div>
      ) : null}
      {can.line ? (
        <label className="kn-cal-ed-row">
          <span>{t("calendar.row.project")}</span>
          <select name="project" value={item.project ?? ""} onChange={(e) => void a.edit(item, { project: e.target.value || null })}>
            <option value="">{t("calendar.noProject")}</option>
            {[...new Set([...projects, ...(item.project ? [item.project] : [])])].map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <fieldset
        ref={whenBox}
        className="kn-cal-ed-when"
        aria-label={t("calendar.row.when")}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) saveWhen();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.target instanceof HTMLInputElement && e.target.type !== "checkbox") {
            e.preventDefault();
            saveWhen();
          }
          const was = fieldsOf(item);
          esc(e, JSON.stringify(when) !== JSON.stringify(was), () => setWhen(was));
        }}
      >
        <label>
          <span>{t("calendar.edit.day")}</span>
          <input type="date" name="day" value={when.day} required onChange={(e) => setWhen((w) => ({ ...w, day: e.target.value }))} />
        </label>
        <label>
          <span>{t("calendar.edit.from")}</span>
          <input type="time" name="from" step={300} value={when.from} disabled={when.allDay} onChange={(e) => setWhen((w) => ({ ...w, from: e.target.value }))} />
        </label>
        <label>
          <span>{t("calendar.edit.to")}</span>
          <input type="time" name="to" step={300} value={when.to} disabled={when.allDay} onChange={(e) => setWhen((w) => ({ ...w, to: e.target.value }))} />
        </label>
        <label className="kn-cal-ed-check">
          <input
            type="checkbox"
            name="allDay"
            checked={when.allDay}
            onChange={(e) => {
              const allDay = e.target.checked;
              const next = { ...when, allDay, from: allDay ? "" : when.from, to: allDay ? "" : when.to };
              setWhen(next);
              const p = whenPatch(item, next);
              if (p && Object.keys(p).length) void a.edit(item, p);
            }}
          />
          <span>{t("calendar.edit.allDay")}</span>
        </label>
      </fieldset>
      {!patch ? (
        <p className="kn-cal-title-problem" role="alert">
          {t("calendar.edit.badWhen")}
        </p>
      ) : null}
      {can.line ? (
        <label className="kn-cal-ed-row">
          <span>{t("calendar.row.repeat")}</span>
          <select name="repeat" value={item.repeat ?? ""} onChange={(e) => void a.edit(item, { repeat: (e.target.value || null) as CalendarRepeat | null })}>
            {REPEATS.map((r) => (
              <option key={r} value={r}>
                {t(r ? `calendar.repeat.${r}` : "calendar.repeat.none")}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {compact ? (
        <div className="kn-cal-chips" role="radiogroup" aria-label={t("calendar.notify.title")}>
          {CALENDAR_NOTIFY.map((n) => (
            <button type="button" role="radio" key={n} data-notify={n} aria-checked={item.notify === n} onClick={() => a.setNotify(item, n)}>
              {t(`calendar.notify.${n}`)}
            </button>
          ))}
        </div>
      ) : null}
      {item.source ? (
        <label className="kn-cal-ed-row kn-cal-ed-text">
          <span>{t("calendar.edit.text")}</span>
          <textarea
            name="text"
            rows={compact ? 2 : 5}
            maxLength={CALENDAR_LIMITS.text}
            value={text ?? ""}
            disabled={text === null}
            placeholder={t(can.line ? "calendar.edit.textLine" : "calendar.edit.textNote")}
            onChange={(e) => setText(e.target.value)}
            onBlur={saveText}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                saveText();
              }
              esc(e, text !== savedText.current, () => setText(savedText.current));
            }}
          />
        </label>
      ) : null}
      <div className="kn-cal-acts kn-cal-ed-acts">
        {isOccurrence(item.id) ? (
          <>
            <button type="button" className="kn-cal-btn kn-cal-danger" data-delete="once" onClick={() => a.remove(item, true)}>
              {t("calendar.edit.deleteOnce")}
            </button>
            <button type="button" className="kn-cal-btn kn-cal-danger" data-delete="series" onClick={() => a.remove(item, false)}>
              {t("calendar.edit.deleteSeries")}
            </button>
          </>
        ) : (
          <button type="button" className="kn-cal-btn kn-cal-danger" data-delete="item" onClick={() => a.remove(item)}>
            {t(item.id.startsWith("f:") ? "calendar.edit.deleteAgenda" : "calendar.edit.delete")}
          </button>
        )}
      </div>
    </div>
  );
}
