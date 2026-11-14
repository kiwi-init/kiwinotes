// O balão das rotinas (spec #12150, T12190): quando o resumo do dia ou os pendentes da semana ficam prontos, o gato
// mostra a nota com [Ver] [Manter] [Descartar]. A nota já foi escrita pela escrita de sempre (as Versões e a Atividade):
// [Ver] abre o que ela tem, [Manter] fecha, e [Descartar] é o desfazer do pedido (a nota vai para a Lixeira). Se a
// rotina não rodou por causa do limite do plano, o balão avisa, com [Ok]. Nunca tira o foco.

import { useEffect, useState } from "react";

import type { AgentRoutineEvent } from "../../src/shared/ui-contract.ts";
import { api, has } from "../src/api.ts";
import { Button } from "../src/kit/index.tsx";
import { type View, ViewPanel } from "../settings/AgentActivity.tsx";
import { ROUTINE_DISCARDED, routineLine } from "./routineText.ts";

export function RoutineBubble({ hidden, onShown }: { hidden: boolean; onShown?: (shown: boolean) => void }) {
  const [event, setEvent] = useState<AgentRoutineEvent | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  useEffect(() => {
    if (!has("agent.routineRun")) return;
    return api.agent.onRoutine((e) => {
      if (!routineLine(e)) return;
      setEvent(e);
      setView(null);
      setOutcome(null);
    });
  }, []);
  useEffect(() => onShown?.(event !== null), [event !== null]);

  if (!event || hidden) return null;
  const close = () => setEvent(null);
  const keepFocus = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) e.preventDefault();
  };
  const done = event.phase === "done" && event.note ? event : null;
  const see = async () => {
    if (!done) return;
    if (view) return setView(null);
    setView({ phase: "loading" });
    try {
      setView({ phase: "ready", view: await api.agent.change(done.request, 1) });
    } catch (e) {
      setView({ phase: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };
  const discard = async () => {
    if (!done) return;
    try {
      await api.agent.undo(done.request);
      setView(null);
      setOutcome(ROUTINE_DISCARDED);
    } catch (e) {
      setOutcome(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="kn-bubble-shell kn-bubble kn-routine-bubble" onMouseDown={keepFocus} role="status" aria-label="A rotina do agente">
      <p className="kn-routine-line">{outcome ?? routineLine(event)}</p>
      {view ? (
        <div className="kn-routine-view">
          <ViewPanel view={view} />
        </div>
      ) : null}
      <div className="kn-routine-actions">
        {done && !outcome ? (
          <>
            <Button onClick={() => void see()}>{view ? "Fechar" : "Ver"}</Button>
            <Button variant="primary" onClick={close}>
              Manter
            </Button>
            <Button onClick={() => void discard()}>Descartar</Button>
          </>
        ) : (
          <Button onClick={close}>Ok</Button>
        )}
      </div>
    </div>
  );
}
