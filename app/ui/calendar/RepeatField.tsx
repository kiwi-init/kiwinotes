// O campo da repetição (spec #34706, T34775): as prontas (todo dia, toda semana, todo mês, todo ano, nos dias úteis) e
// o "Personalizar…", que monta a regra: a cada N dias/semanas/meses/anos, nos dias da semana escolhidos, até um dia ou
// N vezes. O "+ Novo" usa; o cartão pode usar o mesmo. O valor é o `repeat` do contrato, na forma curta.

import { useState } from "react";

import { CALENDAR_REPEATS, type CalendarRepeat, type CalendarRepeatPreset, isDay, REPEAT_LIMITS, type RepeatRule, repeatOfRule, repeatRule } from "../../src/shared/calendar.ts";
import { useT } from "../src/i18n.ts";
import { repeatLabel, weekdayNames } from "./format.ts";

type Mode = "" | CalendarRepeatPreset | "custom";
type Ends = "never" | "until" | "count";

/** Os dias da semana, de segunda a domingo, como o `Date.getDay` (0 = domingo). */
const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0] as const;

/** A regra que o "Personalizar…" mostra para uma repetição (a pronta vira a regra dela). */
export const ruleFor = (r: CalendarRepeat | null): RepeatRule => repeatRule(r ?? "weekly") ?? { every: 1, unit: "w", days: [], until: null, count: null };

/** O modo do seletor para uma repetição: a pronta, ou "custom". */
export const modeOf = (r: CalendarRepeat | null): Mode => (!r ? "" : (CALENDAR_REPEATS as readonly string[]).includes(r) ? (r as CalendarRepeatPreset) : "custom");

/** A repetição de uma regra montada; `null` quando falta algo (o dia do fim vazio). */
export function repeatOfForm(rule: RepeatRule, ends: Ends, until: string, count: number): CalendarRepeat | null {
  if (ends === "until" && !isDay(until)) return null;
  const every = Math.min(REPEAT_LIMITS.every, Math.max(1, Math.round(rule.every) || 1));
  const n = Math.min(REPEAT_LIMITS.count, Math.max(1, Math.round(count) || 1));
  return repeatOfRule({ ...rule, every, days: rule.unit === "w" ? rule.days : [], until: ends === "until" ? until : null, count: ends === "count" ? n : null });
}

export function RepeatField({ value, onChange, day }: { value: CalendarRepeat | null; /** `null`: não repete; `undefined`: o "Personalizar…" com algo faltando. */ onChange(r: CalendarRepeat | null | undefined): void; day: string }) {
  const { t, locale } = useT();
  const [mode, setMode] = useState<Mode>(modeOf(value));
  const start = ruleFor(value);
  const [rule, setRule] = useState<RepeatRule>(start);
  const [ends, setEnds] = useState<Ends>(start.until ? "until" : start.count !== null ? "count" : "never");
  const [until, setUntil] = useState(start.until ?? "");
  const [count, setCount] = useState(start.count ?? 10);
  const names = weekdayNames(locale);
  const push = (r: RepeatRule, e: Ends, u: string, c: number) => {
    setRule(r);
    setEnds(e);
    setUntil(u);
    setCount(c);
    onChange(repeatOfForm(r, e, u, c) ?? undefined);
  };
  return (
    <div className="kn-cal-repeat">
      <label>
        {t("calendar.repeat.title")}
        <select
          name="repeat"
          value={mode}
          onChange={(e) => {
            const m = e.target.value as Mode;
            setMode(m);
            if (m === "custom") push(rule, ends, until, count);
            else onChange(m || null);
          }}
        >
          <option value="">{t("calendar.repeat.none")}</option>
          {CALENDAR_REPEATS.map((r) => (
            <option key={r} value={r}>
              {t(`calendar.repeat.${r}`)}
            </option>
          ))}
          <option value="custom">{t("calendar.repeat.custom")}</option>
        </select>
      </label>
      {mode === "custom" ? (
        <fieldset className="kn-cal-repeat-custom" aria-label={t("calendar.repeat.custom")}>
          <div className="kn-cal-newrow">
            <label>
              {t("calendar.repeat.everyLabel")}
              <input type="number" name="every" min={1} max={REPEAT_LIMITS.every} value={rule.every} onChange={(e) => push({ ...rule, every: Number(e.target.value) }, ends, until, count)} />
            </label>
            <select name="unit" aria-label={t("calendar.repeat.everyLabel")} value={rule.unit} onChange={(e) => push({ ...rule, unit: e.target.value as RepeatRule["unit"] }, ends, until, count)}>
              {(["d", "w", "m", "y"] as const).map((u) => (
                <option key={u} value={u}>
                  {t(`calendar.repeat.unit.${u}`)}
                </option>
              ))}
            </select>
          </div>
          {rule.unit === "w" ? (
            <div className="kn-cal-repeat-days" role="group" aria-label={t("calendar.repeat.onDays")}>
              {MONDAY_FIRST.map((wd, i) => (
                <button
                  type="button"
                  key={wd}
                  data-weekday={wd}
                  aria-pressed={rule.days.includes(wd)}
                  onClick={() => push({ ...rule, days: rule.days.includes(wd) ? rule.days.filter((d) => d !== wd) : [...rule.days, wd] }, ends, until, count)}
                >
                  {names[i]}
                </button>
              ))}
            </div>
          ) : null}
          <div className="kn-cal-repeat-ends" role="radiogroup" aria-label={t("calendar.repeat.ends")}>
            <span>{t("calendar.repeat.ends")}</span>
            {(["never", "until", "count"] as const).map((e) => (
              <label key={e}>
                <input type="radio" name="ends" value={e} checked={ends === e} onChange={() => push(rule, e, e === "until" && !until ? day : until, count)} />
                {t(`calendar.repeat.ends.${e}`)}
                {e === "until" ? <input type="date" name="until" value={until} min={day} disabled={ends !== "until"} onChange={(ev) => push(rule, ends, ev.target.value, count)} /> : null}
                {e === "count" ? (
                  <>
                    <input type="number" name="count" min={1} max={REPEAT_LIMITS.count} value={count} disabled={ends !== "count"} onChange={(ev) => push(rule, ends, until, Number(ev.target.value))} />
                    {t("calendar.repeat.ends.countUnit")}
                  </>
                ) : null}
              </label>
            ))}
          </div>
          {value ? <p className="kn-cal-muted kn-cal-repeat-says">{repeatLabel(value, locale, t)}</p> : null}
        </fieldset>
      ) : null}
    </div>
  );
}
