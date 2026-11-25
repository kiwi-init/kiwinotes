// O cartão de uma rotina nova (spec #12944): o nome, o que o agente faz, a hora, os dias e a pasta. O mesmo cartão cria
// ("Nova rotina"), edita uma rotina criada e ajusta a que o agente propôs ([Ajustar]). Quem chama diz o que o botão faz;
// o erro do Kiwi (o campo que não vale) aparece embaixo.

import { useState } from "react";

import type { CustomRoutineInput } from "../../src/shared/ui-contract.ts";
import { ROUTINE_NAME_MAX, ROUTINE_PROMPT_MAX } from "../../src/shared/agent-routines.ts";
import { Button, Select } from "../src/kit/index.tsx";
import { useT } from "../src/i18n.ts";
import {
  daysChoice,
  daysOptions,
  routineNameLabel,
  routinePromptLabel,
  routinePromptPlaceholder,
  timeOptions,
  weekday,
  weekdayShort,
  type DaysChoice,
} from "./routinesText.ts";

const DAYS = [0, 1, 2, 3, 4, 5, 6];

export function RoutineEditor({
  title,
  initial,
  folders,
  submit,
  note,
  onSubmit,
  onCancel,
}: {
  title: string;
  initial: CustomRoutineInput;
  folders: readonly string[];
  /** O texto do botão principal: "Criar" ou "Salvar". */
  submit: string;
  /** Uma linha embaixo dos campos (a rotina entra desligada). */
  note?: string;
  onSubmit: (r: CustomRoutineInput) => Promise<unknown>;
  onCancel: () => void;
}) {
  const { t } = useT();
  const [name, setName] = useState(initial.name);
  const [prompt, setPrompt] = useState(initial.prompt);
  const [time, setTime] = useState(initial.time);
  const [choice, setChoice] = useState<DaysChoice>(daysChoice(initial.days));
  const [chosen, setChosen] = useState<number[]>(Array.isArray(initial.days) ? initial.days : [1, 2, 3, 4, 5]);
  const [folder, setFolder] = useState(initial.folder);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const days = choice === "chosen" ? [...chosen].sort((a, b) => a - b) : choice;
  const ready = name.trim() !== "" && prompt.trim() !== "" && (choice !== "chosen" || chosen.length > 0);
  const folderOptions = [...new Set([folder, ...folders])].map((f) => ({ value: f, label: f }));
  const toggle = (d: number) => setChosen((c) => (c.includes(d) ? c.filter((x) => x !== d) : [...c, d]));

  const save = async () => {
    setBusy(true);
    setFailure(null);
    try {
      await onSubmit({ name: name.trim(), prompt: prompt.trim(), time, days, folder });
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="kn-routine-card kn-routine-editor" aria-label={title}>
      <h3 className="kn-routine-editor-title">{title}</h3>
      <label className="kn-routine-editor-field">
        <span>{routineNameLabel()}</span>
        <input className="kn-input" value={name} maxLength={ROUTINE_NAME_MAX} onChange={(e) => setName(e.target.value)} placeholder={t("routines.namePlaceholder")} autoFocus />
      </label>
      <label className="kn-routine-editor-field">
        <span>{routinePromptLabel()}</span>
        <textarea className="kn-input kn-routine-prompt" value={prompt} maxLength={ROUTINE_PROMPT_MAX} rows={3} onChange={(e) => setPrompt(e.target.value)} placeholder={routinePromptPlaceholder()} />
      </label>
      <div className="kn-routine-fields">
        <label className="kn-routine-field">
          <span>{t("routines.time")}</span>
          <Select label={t("routines.timeAria", { title })} value={time} options={timeOptions(time)} onChange={setTime} />
        </label>
        <label className="kn-routine-field">
          <span>{t("routines.daysLabel")}</span>
          <Select label={t("routines.daysAria", { title })} value={choice} options={daysOptions()} onChange={(v) => setChoice(v as DaysChoice)} />
        </label>
        <label className="kn-routine-field">
          <span>{t("routines.folder")}</span>
          <Select label={t("routines.folderAria", { title })} value={folder} options={folderOptions} onChange={setFolder} />
        </label>
      </div>
      {choice === "chosen" ? (
        <div className="kn-routine-days" role="group" aria-label={t("routines.daysGroup")}>
          {DAYS.map((i) => (
            <button key={i} type="button" className="kn-routine-day" aria-pressed={chosen.includes(i)} aria-label={weekday(i)} onClick={() => toggle(i)}>
              {weekdayShort(i)}
            </button>
          ))}
        </div>
      ) : null}
      {failure ? (
        <p className="kn-routine-failure" role="alert">
          {failure}
        </p>
      ) : null}
      <div className="kn-routine-foot">
        <span className="kn-routine-last">{note ?? ""}</span>
        <span className="kn-routine-actions">
          <Button onClick={onCancel} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy || !ready}>
            {busy ? t("common.saving") : submit}
          </Button>
        </span>
      </div>
    </section>
  );
}
