// As linhas Modelo e Esforço (spec #16793), em Ajustes › Agente e no passo "claude" do onboarding: o modelo do agente e
// o esforço salvo para ele. No onboarding, a escolha abre a sessão sem pedido (`agent.prepare`), para listar os
// esforços do modelo novo; sem a sessão, o Esforço fica em "Padrão" com a frase de por quê.

import type { AgentStatus } from "../../src/shared/ui-contract.ts";
import { api } from "../src/api.ts";
import { Row, Select } from "../src/kit/index.tsx";
import { EFFORT_NAMES, effortHint, effortOptions, effortValue, modelHint, modelOptions, type Prepare, prepareHint } from "./agentText.ts";

export type { Prepare };

export function ModelRows({
  status,
  run,
  prepare,
}: {
  status: AgentStatus;
  run(fn: () => Promise<AgentStatus>): void;
  /** Só no onboarding: o estado da sessão aberta sem pedido. */
  prepare?: Prepare;
}) {
  const efforts = effortOptions(status);
  const unknown = efforts === null && prepare !== undefined && prepare !== "ready";
  return (
    <>
      <Row label="Modelo" hint={modelHint(status)}>
        <Select label="Modelo do agente" value={status.model} options={modelOptions(status)} onChange={(model) => run(() => api.agent.configure({ model }))} />
      </Row>
      {/* O esforço do modelo escolhido: as escolhas que o agente oferece nele; sem esforço, só a linha. */}
      <Row label="Esforço" hint={unknown ? prepareHint(prepare) : effortHint(status)}>
        {efforts?.length ? (
          <Select label="Esforço do modelo" value={effortValue(status)} options={efforts} onChange={(effort) => run(() => api.agent.configure({ effort }))} />
        ) : unknown ? (
          <Select label="Esforço do modelo" value="default" options={[{ value: "default", label: EFFORT_NAMES.default! }]} onChange={() => {}} />
        ) : null}
      </Row>
    </>
  );
}
