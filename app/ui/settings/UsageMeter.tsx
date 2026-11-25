// O medidor do agente (spec #11084, T11114), em Ajustes, logo depois da seção Agente: o gasto do Kiwi nas últimas 5
// horas e na semana, os pedidos mais caros e o quanto o cache serviu, tudo como o agente informou. O uso da assinatura
// vem do `/usage` do próprio Claude Code, só quando a seção abre ou a pessoa clica em "Atualizar". Nada em dinheiro.

import { useCallback, useEffect, useRef, useState } from "react";

import type { AgentStatus, AgentUsageView } from "../../src/shared/ui-contract.ts";
import { api, has } from "../src/api.ts";
import { useT } from "../src/i18n.ts";
import { Button, Row, Section } from "../src/kit/index.tsx";
import { kindOf } from "./agentText.ts";
import { Placar } from "./Placar.tsx";
import { at, limitLine, outLine, subagentNote, subscriptionLine, sumLine, tokens } from "./usageText.ts";

export function UsageMeter() {
  const { t, locale } = useT();
  const failedText = t("agent.usage.readFailed");
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

  // O medidor é do Claude Code (o `/usage` dele, spec #11084). Com o Gemini, ele some, sem inventar número (spec
  // #24666), mesmo com o adaptador do Claude ainda baixado.
  const ready = !!status?.enabled && kindOf(status) === "claude" && status.adapter.phase === "ready";

  const refresh = useCallback(() => {
    setRefreshing(true);
    setError(null);
    void api.agent
      .usageRefresh()
      .then(setView, (e: unknown) => setError(e instanceof Error ? e.message : failedText))
      .finally(() => setRefreshing(false));
  }, [failedText]);

  // O `/usage` ao abrir o medidor: uma vez, quando a seção aparece com o agente pronto e livre. Nunca sozinho depois.
  useEffect(() => {
    if (!ready || opened.current || status?.busy) return;
    opened.current = true;
    refresh();
  }, [ready, status?.busy, refresh]);

  if (!has("agent.usage") || !ready || !view) return null;
  const now = Date.now();
  const out = outLine(view.out, now, locale);
  const limit = limitLine(view.limit, now, locale);
  return (
    <>
      {view.placar ? <Placar v={view.placar} now={now} /> : null}
      <Section title={t("agent.usage.section")}>
      {out ? <Row label={t("agent.usage.limitLabel")} hint={out} /> : null}
      <Row label={t("agent.usage.subscription")} hint={error ?? subscriptionLine(view.subscription, now, locale)}>
        <Button onClick={refresh} disabled={refreshing || !!status?.busy}>
          {refreshing ? t("agent.usage.refreshing") : t("agent.usage.refresh")}
        </Button>
      </Row>
      {limit ? <Row label={t("agent.usage.lastNotice")} hint={limit} /> : null}
      <Row label={t("agent.usage.fiveHours")} hint={sumLine(view.fiveHours, locale)} />
      <Row label={t("agent.usage.week")} hint={`${sumLine(view.week, locale)} ${subagentNote(locale)}`} />
      {view.top.length ? (
        <div className="kn-usage-top">
          <div className="kn-row-label">{t("agent.usage.top")}</div>
          <ol>
            {view.top.map((r) => (
              <li key={r.request}>
                <span className="kn-usage-q">{r.question || t("agent.usage.noText")}</span>
                <span className="kn-usage-meta">
                  {at(r.at, now, locale)} · {tokens(r.tokens, locale)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      <Row label={t("agent.usage.clear")} hint={t("agent.usage.clear.hint")}>
        <Button onClick={() => void api.agent.usageClear().then(setView, () => {})} disabled={!view.week.requests}>
          {t("agent.usage.clear.button")}
        </Button>
      </Row>
      </Section>
    </>
  );
}
