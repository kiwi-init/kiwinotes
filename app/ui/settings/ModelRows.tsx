// As linhas Modelo e Esforço (spec #16793), em Ajustes › Agente e no passo "claude" do onboarding: o modelo do agente e
// o esforço salvo para ele. No onboarding, a escolha abre a sessão sem pedido (`agent.prepare`), para listar os
// esforços do modelo novo; sem a sessão, o Esforço fica em "Padrão" com a frase de por quê. Em Ajustes (T25729), a
// tela faz o mesmo sozinha: a lista do modelo escolhido desconhecida (trocou de agente, de modelo, ou reabriu o app)
// abre o programa sem pedido, com o "Abrindo…" enquanto abre.

import { useEffect, useRef, useState } from "react";

import type { AgentStatus } from "../../src/shared/ui-contract.ts";
import { api, has } from "../src/api.ts";
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
  const own = useAutoPrepare(status, prepare === undefined);
  const shown = prepare ?? own;
  const efforts = effortOptions(status);
  const unknown = efforts === null && shown !== undefined && shown !== "ready";
  return (
    <>
      <Row label="Modelo" hint={modelHint(status)}>
        <Select label="Modelo do agente" value={status.model} options={modelOptions(status)} onChange={(model) => run(() => api.agent.configure({ model }))} />
      </Row>
      {/* O esforço do modelo escolhido: as escolhas que o agente oferece nele; sem esforço, só a linha. */}
      <Row label="Esforço" hint={unknown ? prepareHint(shown!, status.name, prepare === undefined) : effortHint(status)}>
        {efforts?.length ? (
          <Select label="Esforço do modelo" value={effortValue(status)} options={efforts} onChange={(effort) => run(() => api.agent.configure({ effort }))} />
        ) : unknown ? (
          <Select label="Esforço do modelo" value="default" options={[{ value: "default", label: EFFORT_NAMES.default! }]} onChange={() => {}} />
        ) : null}
      </Row>
    </>
  );
}

/**
 * Em Ajustes (sem o `prepare` do onboarding): a lista de esforços do modelo escolhido desconhecida abre o programa sem
 * pedido (`agent.prepare`), uma vez por agente e modelo. Nada vai ao agente e não gasta o plano. `undefined` quando a
 * lista já é conhecida e nada abriu.
 */
function useAutoPrepare(status: AgentStatus, on: boolean): Prepare | undefined {
  const key = `${status.kind ?? "claude"}:${status.model}`;
  const missing = on && status.enabled && effortOptions(status) === null;
  const tried = useRef(new Set<string>());
  const [state, setState] = useState<{ key: string; prepare: Prepare } | null>(null);
  useEffect(() => {
    if (!missing || tried.current.has(key)) return;
    tried.current.add(key);
    if (!has("agent.prepare")) return setState({ key, prepare: "failed" });
    setState({ key, prepare: "opening" });
    api.agent.prepare().then(
      () => setState((s) => (s?.key === key ? { key, prepare: "ready" } : s)),
      () => setState((s) => (s?.key === key ? { key, prepare: "failed" } : s)),
    );
  }, [missing, key]);
  return state?.key === key ? state.prepare : undefined;
}
