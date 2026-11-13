// O medidor do agente (spec #11084, T11114), em Ajustes, logo depois da seção Agente: o gasto do Kiwi nas últimas 5
// horas e na semana, os pedidos mais caros e o quanto o cache serviu, tudo como o agente informou. O uso da assinatura
// vem do `/usage` do próprio Claude Code, só quando a seção abre ou a pessoa clica em "Atualizar". Nada em dinheiro.

import { useCallback, useEffect, useRef, useState } from "react";

import type { AgentStatus, AgentUsageView } from "../../src/shared/ui-contract.ts";
import { api, has } from "../src/api.ts";
import { Button, Row, Section } from "../src/kit/index.tsx";
import { at, limitLine, outLine, SUBAGENT_NOTE, subscriptionLine, sumLine, tokens } from "./usageText.ts";

export function UsageMeter() {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [view, setView] = useState<AgentUsageView | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const opened = useRef(false);

  useEffect(() => {
    if (!has("agent.usage") || !has("agent.status")) return;
    const offS = api.agent.onStatus(setStatus);
    const offU = api.agent.onUsage(setView);
    void api.agent.status().then(setStatus, () => {});
    void api.agent.usage().then(setView, () => {});
    return () => {
      offS();
      offU();
    };
  }, []);

  const ready = !!status?.enabled && status.adapter.phase === "ready";

  const refresh = useCallback(() => {
    setRefreshing(true);
    setError(null);
    void api.agent
      .usageRefresh()
      .then(setView, (e: unknown) => setError(e instanceof Error ? e.message : "Não deu para ver o uso agora."))
      .finally(() => setRefreshing(false));
  }, []);

  // O `/usage` ao abrir o medidor: uma vez, quando a seção aparece com o agente pronto e livre. Nunca sozinho depois.
  useEffect(() => {
    if (!ready || opened.current || status?.busy) return;
    opened.current = true;
    refresh();
  }, [ready, status?.busy, refresh]);

  if (!has("agent.usage") || !ready || !view) return null;
  const now = Date.now();
  const out = outLine(view.out, now);
  const limit = limitLine(view.limit, now);
  return (
    <Section title="O gasto do agente">
      {out ? <Row label="Limite" hint={out} /> : null}
      <Row label="A sua assinatura" hint={error ?? subscriptionLine(view.subscription, now)}>
        <Button onClick={refresh} disabled={refreshing || !!status?.busy}>
          {refreshing ? "Atualizando…" : "Atualizar"}
        </Button>
      </Row>
      {limit ? <Row label="O último aviso do agente" hint={limit} /> : null}
      <Row label="Últimas 5 horas" hint={sumLine(view.fiveHours)} />
      <Row label="Esta semana" hint={`${sumLine(view.week)} ${SUBAGENT_NOTE}`} />
      {view.top.length ? (
        <div className="kn-usage-top">
          <div className="kn-row-label">Os pedidos mais caros da semana</div>
          <ol>
            {view.top.map((t) => (
              <li key={t.request}>
                <span className="kn-usage-q">{t.question || "(sem texto)"}</span>
                <span className="kn-usage-meta">
                  {at(t.at, now)} · {tokens(t.tokens)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      <Row label="Apagar o gasto guardado" hint="O gasto fica guardado só no Mac, por 8 dias. O registro do agente não muda.">
        <Button onClick={() => void api.agent.usageClear().then(setView, () => {})} disabled={!view.week.requests && !view.limit && !view.out}>
          Apagar
        </Button>
      </Row>
    </Section>
  );
}
