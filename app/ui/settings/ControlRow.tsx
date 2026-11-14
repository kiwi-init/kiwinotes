// A linha "Falar com o Kiwi Cat" (spec #9876, T11248; o atalho escolhido, spec #12946), em Ajustes › Agente e no passo 2
// do onboarding: o interruptor, desligado por padrão, e embaixo o atalho (o Control, ou o que a pessoa gravar). Com o
// ditado nas mesmas teclas, o interruptor fica desligado e diz por quê; o atalho embaixo deixa escolher outro.

import type { AgentStatus } from "../../src/shared/ui-contract.ts";
import { DEFAULT_SHORTCUTS, parseShortcut, shortcutsConflict } from "../../src/shared/shortcuts.ts";
import { api } from "../src/api.ts";
import { Row, Switch } from "../src/kit/index.tsx";
import { useShortcuts } from "../src/useShortcuts.ts";
import { holdName } from "../hub/onboarding/onboardingText.ts";
import { CONTROL_LABEL, controlHint } from "./agentText.ts";
import { ShortcutRow } from "./Shortcuts.tsx";
import { useState } from "react";

/** O ditado nas mesmas teclas do atalho do Kiwi Cat (o do agent-voice do app, que então não arma o atalho). */
export const dictationOnControl = (dictation: string | null | undefined, agent: string | null | undefined = DEFAULT_SHORTCUTS.agent) =>
  !!dictation && shortcutsConflict(dictation, agent ?? DEFAULT_SHORTCUTS.agent!);

export function ControlRow({ status, onStatus }: { status: AgentStatus; onStatus(s: AgentStatus): void }) {
  const shortcuts = useShortcuts();
  const [failed, setFailed] = useState(false);
  if (!shortcuts) return null;
  const agent = shortcuts.agent ?? DEFAULT_SHORTCUTS.agent!;
  const blocked = dictationOnControl(shortcuts.dictation, agent);
  const parsed = parseShortcut(agent);
  const controlAlone = parsed?.kind === "key" && (parsed.key === "control" || parsed.key === "rightControl");
  const change = (on: boolean) => {
    setFailed(false);
    onStatus({ ...status, controlShortcut: on });
    void api.agent.configure({ controlShortcut: on }).then(onStatus, () => {
      onStatus({ ...status, controlShortcut: !on });
      setFailed(true);
    });
  };
  return (
    <>
      <Row label={CONTROL_LABEL} hint={failed ? "Não deu para salvar. Tente de novo." : controlHint(blocked, holdName(agent), controlAlone)}>
        <Switch label={CONTROL_LABEL} checked={!blocked && status.controlShortcut} disabled={blocked} onChange={change} />
      </Row>
      {/* Desligado, o atalho não faz nada: o campo fica, mas só troca com o interruptor ligado (ou para sair do conflito). */}
      <ShortcutRow id="agent" shortcuts={shortcuts} disabled={!status.controlShortcut && !blocked} />
    </>
  );
}
