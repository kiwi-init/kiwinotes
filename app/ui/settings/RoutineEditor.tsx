// O cartão de uma rotina nova (spec #12944): o nome, o que o agente faz, a hora, os dias e a pasta. O mesmo cartão cria
// ("Nova rotina"), edita uma rotina criada e ajusta a que o agente propôs ([Ajustar]). Quem chama diz o que o botão faz;
// o erro do Kiwi (o campo que não vale) aparece embaixo.

import { useState } from "react";

import type { CustomRoutineInput } from "../../src/shared/ui-contract.ts";
import { ROUTINE_NAME_MAX, ROUTINE_PROMPT_MAX } from "../../src/shared/agent-routines.ts";
import { Button, Select } from "../src/kit/index.tsx";
import {
  DAYS_OPTIONS,
  daysChoice,
  ROUTINE_NAME_LABEL,
  ROUTINE_PROMPT_LABEL,
  ROUTINE_PROMPT_PLACEHOLDER,
  timeOptions,
  WEEKDAY_SHORT,
  WEEKDAYS,
  type DaysChoice,
} from "./routinesText.ts";

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
        <span>{ROUTINE_NAME_LABEL}</span>
        <input className="kn-input" value={name} maxLength={ROUTINE_NAME_MAX} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Resumo das reuniões" autoFocus />
      </label>
      <label className="kn-routine-editor-field">
        <span>{ROUTINE_PROMPT_LABEL}</span>
        <textarea className="kn-input kn-routine-prompt" value={prompt} maxLength={ROUTINE_PROMPT_MAX} rows={3} onChange={(e) => setPrompt(e.target.value)} placeholder={ROUTINE_PROMPT_PLACEHOLDER} />
      </label>
      <div className="kn-routine-fields">
        <label className="kn-routine-field">
          <span>Hora</span>
          <Select label={`${title}: a hora`} value={time} options={timeOptions(time)} onChange={setTime} />
        </label>
        <label className="kn-routine-field">
          <span>Dias</span>
          <Select label={`${title}: os dias`} value={choice} options={DAYS_OPTIONS} onChange={(v) => setChoice(v as DaysChoice)} />
        </label>
        <label className="kn-routine-field">
          <span>Pasta</span>
          <Select label={`${title}: a pasta`} value={folder} options={folderOptions} onChange={setFolder} />
        </label>
      </div>
      {choice === "chosen" ? (
        <div className="kn-routine-days" role="group" aria-label="Os dias da rotina">
          {WEEKDAY_SHORT.map((d, i) => (
            <button key={d} type="button" className="kn-routine-day" aria-pressed={chosen.includes(i)} aria-label={WEEKDAYS[i]} onClick={() => toggle(i)}>
              {d}
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
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy || !ready}>
            {busy ? "Salvando…" : submit}
          </Button>
        </span>
      </div>
    </section>
  );
}
