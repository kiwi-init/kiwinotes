// "Suas reuniões" no assunto Reuniões (spec #11966): as linhas do #8360, como estavam em Ajustes › Agente, só mudadas de
// lugar. Elas precisam do estado do agente, que esta seção lê sozinha (o `agent.status` e o evento dele).

import { useEffect, useState } from "react";

import type { AgentStatus } from "../../src/shared/ui-contract.ts";
import { api, has } from "../src/api.ts";
import { Row, Section } from "../src/kit/index.tsx";
import { MeetingsRows } from "./MeetingsRows.tsx";

export const AGENT_MEETINGS_TITLE = "Suas reuniões";
export const AGENT_MEETINGS_OFF = "O resumo das reuniões é do agente. Ligue o agente em Ajustes › Agente para escolher quando ele propõe e onde salva.";

export function AgentMeetingsSection() {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!has("agent.status")) return;
    let alive = true;
    api.agent.status().then(
      (s) => alive && setStatus(s),
      () => alive && setFailure("Não deu para ler o estado do agente."),
    );
    const off = api.agent.onStatus((s) => alive && setStatus(s));
    return () => {
      alive = false;
      off();
    };
  }, []);

  if (!status) return failure ? <Section title={AGENT_MEETINGS_TITLE}><Row label={AGENT_MEETINGS_TITLE} hint={failure} /></Section> : null;

  /** A mesma chamada da seção do Agente: o estado que volta vale, e o erro aparece aqui. */
  const run = async (call: () => Promise<unknown>) => {
    setFailure(null);
    try {
      const r = await call();
      if (r && typeof r === "object" && "adapter" in r) setStatus(r as AgentStatus);
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Section title={AGENT_MEETINGS_TITLE}>
      {status.enabled && status.meetings ? <MeetingsRows status={status} run={run} /> : <Row label={AGENT_MEETINGS_TITLE} hint={AGENT_MEETINGS_OFF} />}
      {failure ? <Row label="Não deu certo" hint={failure} /> : null}
    </Section>
  );
}
