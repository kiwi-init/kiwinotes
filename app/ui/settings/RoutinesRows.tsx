// A parte "Rotinas" em Ajustes › Agente (spec #12150, T12191): um cartão por rotina (o resumo do dia e os pendentes da
// semana), com o liga/desliga (as duas vêm desligadas), a hora, o dia (os pendentes), a pasta, a última vez que rodou e
// "Rodar agora". Cada mudança vai pelo `agent.configure`; o "Rodar agora", pelo `agent.routineRun`.
//
// As rotinas novas (spec #12944): o botão "Nova rotina" abre o cartão (o nome, o pedido, a hora, os dias e a pasta), e a
// rotina entra desligada. As criadas aparecem embaixo das prontas, com editar e apagar. O [Ajustar] de uma proposta do
// agente abre o mesmo cartão, preenchido: salvar é o [Criar] da proposta.

import { useEffect, useState } from "react";

import type { AgentStatus, CustomRoutine, CustomRoutineInput, RoutineKind } from "../../src/shared/ui-contract.ts";
import { DEFAULT_ROUTINES_FOLDER } from "../../src/shared/agent-routines.ts";
import { api, has } from "../src/api.ts";
import { folderChoices } from "../src/folderChoices.ts";
import { Button, Row, Select, Switch } from "../src/kit/index.tsx";
import { RoutineEditor } from "./RoutineEditor.tsx";
import { adjustTaken, onAdjust } from "./routineAdjust.ts";
import { useT } from "../src/i18n.ts";
import {
  adjustRoutine,
  customHint,
  customScheduleLine,
  customScheduleMid,
  editRoutine,
  lastRunLine,
  newRoutine,
  routineCreatedOff,
  routineHint,
  routinesHint,
  routinesPaths,
  routinesTitle,
  routineTitle,
  scheduleLine,
  timeOptions,
  weekdayOptions,
} from "./routinesText.ts";

const KINDS: RoutineKind[] = ["daily", "weekly"];

/** O cartão aberto: uma nova, a edição de uma criada, ou o [Ajustar] de uma proposta do agente. */
type Editing = { mode: "new" } | { mode: "edit"; id: string } | { mode: "adjust"; proposal: string; routine: CustomRoutineInput };

const BLANK: CustomRoutineInput = { name: "", prompt: "", time: "18:00", days: "every", folder: DEFAULT_ROUTINES_FOLDER };

export function RoutinesRows({ status, run }: { status: AgentStatus; run: (call: () => Promise<unknown>) => Promise<void> }) {
  const { t } = useT();
  const [folders, setFolders] = useState<string[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ kind: string; message: string } | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // O [Ajustar] de uma proposta (o balão do gato ou a Atividade): abre o cartão com os campos dela.
  useEffect(
    () =>
      onAdjust((r) => {
        adjustTaken(r.proposal);
        setEditing({ mode: "adjust", proposal: r.proposal, routine: r.routine });
      }),
    [],
  );

  // Só os nomes das pastas (spec #12918): o `notes.list` inteiro mandava o cofre todo para a tela.
  useEffect(() => {
    const load = has("notes.folders") ? api.notes.folders : has("notes.list") ? api.notes.list : null;
    if (!load) return;
    let alive = true;
    void load().then(
      (r) => alive && setFolders(r.folders),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, []);

  const save = (kind: RoutineKind, patch: { on?: boolean; time?: string; weekday?: number; folder?: string }) =>
    void run(() => api.agent.configure({ routines: { [kind]: patch } }));
  /** "Rodar agora": uma pronta pelo tipo, uma nova pelo id. */
  const runNow = async (kind: string) => {
    setRunning(kind);
    setFailure(null);
    try {
      await api.agent.routineRun(kind === "daily" || kind === "weekly" ? { kind } : { id: kind });
    } catch (e) {
      setFailure({ kind, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="kn-agent-routines" role="group" aria-label={routinesTitle()}>
      <Row label={routinesTitle()} hint={routinesHint()}>
        <Button onClick={() => setEditing({ mode: "new" })} disabled={editing !== null}>
          {newRoutine()}
        </Button>
      </Row>
      <p className="kn-routine-paths">{routinesPaths()}</p>
      {editing && editing.mode !== "edit" ? (
        <RoutineEditor
          key={editing.mode === "adjust" ? editing.proposal : "new"}
          title={editing.mode === "adjust" ? adjustRoutine() : newRoutine()}
          initial={editing.mode === "adjust" ? editing.routine : BLANK}
          folders={folders}
          submit={t("routines.create")}
          note={routineCreatedOff()}
          onSubmit={async (r) => {
            if (editing.mode === "adjust") await api.agent.proposalApply(editing.proposal, r);
            // Direto, sem o `run`: o erro (o campo que não vale) aparece no próprio cartão. O status volta pelo evento.
            else await api.agent.routineCreate(r);
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      ) : null}
      {KINDS.map((kind) => {
        const r = status.routines[kind];
        const title = routineTitle(kind);
        const choices = folderChoices([r.folder, DEFAULT_ROUTINES_FOLDER], folders).map((f) => ({ value: f, label: f }));
        return (
          <section key={kind} className="kn-routine-card" data-routine={kind} aria-label={title}>
            <Row label={title} hint={routineHint(kind, status.economy === true)}>
              <Switch label={title} checked={r.on} onChange={(on) => save(kind, { on })} />
            </Row>
            <div className="kn-routine-fields">
              <label className="kn-routine-field">
                <span>{t("routines.time")}</span>
                <Select label={t("routines.timeAria", { title })} value={r.time} options={timeOptions(r.time)} onChange={(time) => save(kind, { time })} />
              </label>
              {kind === "weekly" ? (
                <label className="kn-routine-field">
                  <span>{t("routines.day")}</span>
                  <Select label={t("routines.dayAria", { title })} value={String(r.weekday ?? 1)} options={weekdayOptions()} onChange={(d) => save(kind, { weekday: Number(d) })} />
                </label>
              ) : null}
              <label className="kn-routine-field">
                <span>{t("routines.folder")}</span>
                <Select label={t("routines.folderAria", { title })} value={r.folder} options={choices} onChange={(folder) => save(kind, { folder })} />
              </label>
            </div>
            <div className="kn-routine-foot">
              <span className="kn-routine-last" aria-live="polite">
                {r.on ? `${scheduleLine(kind, r)}. ` : `${t("routines.off")} `}
                {lastRunLine(r, new Date())}
              </span>
              <Button onClick={() => void runNow(kind)} disabled={running !== null || status.busy}>
                {running === kind ? t("routines.sending") : t("routines.runNow")}
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
      {status.routines.custom.map((r) =>
        editing?.mode === "edit" && editing.id === r.id ? (
          <RoutineEditor
            key={r.id}
            title={editRoutine()}
            initial={r}
            folders={folders}
            submit={t("common.save")}
            onSubmit={async (next) => {
              await api.agent.routineUpdate(r.id, next);
              setEditing(null);
            }}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <CustomCard
            key={r.id}
            r={r}
            economy={status.economy === true}
            busy={status.busy}
            running={running}
            failure={failure?.kind === r.id ? failure.message : null}
            confirming={confirmDelete === r.id}
            onToggle={(on) => void run(() => api.agent.routineUpdate(r.id, { on }))}
            onRun={() => void runNow(r.id)}
            onEdit={() => setEditing({ mode: "edit", id: r.id })}
            onDelete={() => setConfirmDelete(r.id)}
            onConfirm={(yes) => {
              setConfirmDelete(null);
              if (yes) void run(() => api.agent.routineDelete(r.id));
            }}
          />
        ),
      )}
    </div>
  );
}

/** Uma rotina criada: o liga/desliga, quando roda, a última vez, "Rodar agora", editar e apagar (com a confirmação). */
function CustomCard({
  r,
  economy,
  busy,
  running,
  failure,
  confirming,
  onToggle,
  onRun,
  onEdit,
  onDelete,
  onConfirm,
}: {
  r: CustomRoutine;
  economy: boolean;
  busy: boolean;
  running: string | null;
  failure: string | null;
  confirming: boolean;
  onToggle: (on: boolean) => void;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onConfirm: (yes: boolean) => void;
}) {
  const { t } = useT();
  return (
    <section className="kn-routine-card" data-routine={r.id} aria-label={r.name}>
      <Row label={r.name} hint={customHint(r, economy)}>
        <Switch label={r.name} checked={r.on} onChange={onToggle} />
      </Row>
      <div className="kn-routine-foot">
        <span className="kn-routine-last" aria-live="polite">
          {r.on ? `${customScheduleLine(r)}. ` : `${t("routines.offWhen", { when: customScheduleMid(r) })} `}
          {lastRunLine(r, new Date())}
        </span>
        {confirming ? (
          <span className="kn-routine-actions" role="group" aria-label={t("routines.deleteAria", { name: r.name })}>
            <span className="kn-routine-last">{t("routines.deleteQuestion")}</span>
            <Button onClick={() => onConfirm(false)}>{t("common.keep")}</Button>
            <Button onClick={() => onConfirm(true)}>{t("common.delete")}</Button>
          </span>
        ) : (
          <span className="kn-routine-actions">
            <Button onClick={onEdit}>{t("common.edit")}</Button>
            <Button onClick={onDelete}>{t("common.delete")}</Button>
            <Button onClick={onRun} disabled={running !== null || busy}>
              {running === r.id ? t("routines.sending") : t("routines.runNow")}
            </Button>
          </span>
        )}
      </div>
      {failure ? (
        <p className="kn-routine-failure" role="alert">
          {failure}
        </p>
      ) : null}
    </section>
  );
}
