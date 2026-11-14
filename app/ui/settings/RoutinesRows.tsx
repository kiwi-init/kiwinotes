// A parte "Rotinas" em Ajustes › Agente (spec #12150, T12191): um cartão por rotina (o resumo do dia e os pendentes da
// semana), com o liga/desliga (as duas vêm desligadas), a hora, o dia (os pendentes), a pasta, a última vez que rodou e
// "Rodar agora". Cada mudança vai pelo `agent.configure`; o "Rodar agora", pelo `agent.routineRun`.

import { useEffect, useState } from "react";

import type { AgentStatus, RoutineKind } from "../../src/shared/ui-contract.ts";
import { DEFAULT_ROUTINES_FOLDER } from "../../src/shared/agent-routines.ts";
import { api, has } from "../src/api.ts";
import { Button, Row, Select, Switch } from "../src/kit/index.tsx";
import { lastRunLine, ROUTINE_TITLES, routineHint, ROUTINES_HINT, ROUTINES_TITLE, scheduleLine, timeOptions, WEEKDAY_OPTIONS } from "./routinesText.ts";

const KINDS: RoutineKind[] = ["daily", "weekly"];

export function RoutinesRows({ status, run }: { status: AgentStatus; run: (call: () => Promise<unknown>) => Promise<void> }) {
  const [folders, setFolders] = useState<string[]>([]);
  const [running, setRunning] = useState<RoutineKind | null>(null);
  const [failure, setFailure] = useState<{ kind: RoutineKind; message: string } | null>(null);

  useEffect(() => {
    if (!has("notes.list")) return;
    let alive = true;
    void api.notes.list().then(
      (r) => alive && setFolders(r.folders.filter((f) => !f.startsWith("."))),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, []);

  const save = (kind: RoutineKind, patch: { on?: boolean; time?: string; weekday?: number; folder?: string }) =>
    void run(() => api.agent.configure({ routines: { [kind]: patch } }));
  const runNow = async (kind: RoutineKind) => {
    setRunning(kind);
    setFailure(null);
    try {
      await api.agent.routineRun(kind);
    } catch (e) {
      setFailure({ kind, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="kn-agent-routines" role="group" aria-label={ROUTINES_TITLE}>
      <Row label={ROUTINES_TITLE} hint={ROUTINES_HINT} />
      {KINDS.map((kind) => {
        const r = status.routines[kind];
        const title = ROUTINE_TITLES[kind];
        const choices = [...new Set([r.folder, DEFAULT_ROUTINES_FOLDER, ...folders])].map((f) => ({ value: f, label: f }));
        return (
          <section key={kind} className="kn-routine-card" data-routine={kind} aria-label={title}>
            <Row label={title} hint={routineHint(kind, status.economy === true)}>
              <Switch label={title} checked={r.on} onChange={(on) => save(kind, { on })} />
            </Row>
            <div className="kn-routine-fields">
              <label className="kn-routine-field">
                <span>Hora</span>
                <Select label={`${title}: a hora`} value={r.time} options={timeOptions(r.time)} onChange={(time) => save(kind, { time })} />
              </label>
              {kind === "weekly" ? (
                <label className="kn-routine-field">
                  <span>Dia</span>
                  <Select label={`${title}: o dia`} value={String(r.weekday ?? 1)} options={WEEKDAY_OPTIONS} onChange={(d) => save(kind, { weekday: Number(d) })} />
                </label>
              ) : null}
              <label className="kn-routine-field">
                <span>Pasta</span>
                <Select label={`${title}: a pasta`} value={r.folder} options={choices} onChange={(folder) => save(kind, { folder })} />
              </label>
            </div>
            <div className="kn-routine-foot">
              <span className="kn-routine-last" aria-live="polite">
                {r.on ? `${scheduleLine(kind, r)}. ` : "Desligada. "}
                {lastRunLine(r, new Date())}
              </span>
              <Button onClick={() => void runNow(kind)} disabled={running !== null || status.busy}>
                {running === kind ? "Mandando…" : "Rodar agora"}
              </Button>
            </div>
            {failure?.kind === kind ? (
              <p className="kn-routine-failure" role="alert">
                {failure.message}
              </p>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
