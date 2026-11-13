// A linha "Falar com o agente pelo Control" (spec #9876, T11248), em Ajustes › Agente: desligada por padrão, com o aviso
// do Ditado da Apple. Com o ditado num Control, ela fica desligada e diz por quê.

import { useEffect, useState } from "react";

import type { AgentStatus } from "../../src/shared/ui-contract.ts";
import { api } from "../src/api.ts";
import { Row, Switch } from "../src/kit/index.tsx";
import { CONTROL_LABEL, controlHint } from "./agentText.ts";

/** O ditado no Control direito (o único Control que o ditado pode usar). */
export const dictationOnControl = (dictation: string | null | undefined) => (dictation ?? "").replace(/^double:/, "") === "rightControl";

export function ControlRow({ status, onStatus }: { status: AgentStatus; onStatus(s: AgentStatus): void }) {
  const [dictation, setDictation] = useState<string | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let changes = 0;
    const off = api.settings.onChanged((s) => {
      changes++;
      if (alive) setDictation(s.shortcuts?.dictation ?? null);
    });
    void api.settings.get().then((s) => {
      if (alive && !changes) setDictation(s.shortcuts?.dictation ?? null);
    }, () => {});
    return () => {
      alive = false;
      off();
    };
  }, []);
  if (dictation === undefined) return null;
  const blocked = dictationOnControl(dictation);
  const change = (on: boolean) => {
    setFailed(false);
    onStatus({ ...status, controlShortcut: on });
    void api.agent.configure({ controlShortcut: on }).then(onStatus, () => {
      onStatus({ ...status, controlShortcut: !on });
      setFailed(true);
    });
  };
  return (
    <Row label={CONTROL_LABEL} hint={failed ? "Não deu para salvar. Tente de novo." : controlHint(blocked)}>
      <Switch label={CONTROL_LABEL} checked={!blocked && status.controlShortcut} disabled={blocked} onChange={change} />
    </Row>
  );
}
