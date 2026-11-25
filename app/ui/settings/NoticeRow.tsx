// A linha "Avisar quando o agente esperar uma resposta" (spec #9839, T10525), em Ajustes › Agente. O Kiwi nunca pediu
// ao macOS a permissão de notificar: a linha começa com "Ligar as notificações", e só esse clique pede (uma vez). Com a
// permissão dada, vira um liga/desliga; negada, diz onde mudar nos Ajustes do macOS. A linha relê a permissão quando a
// janela volta ao foco (a pessoa pode ter mudado nos Ajustes do Sistema).

import { useCallback, useEffect, useState } from "react";

import type { AgentNoticeState } from "../../src/shared/ui-contract.ts";
import { api, has } from "../src/api.ts";
import { useT } from "../src/i18n.ts";
import { Button, Row, Switch } from "../src/kit/index.tsx";
import { noticeHint } from "./agentText.ts";

export function NoticeRow() {
  const { t, locale } = useT();
  const [state, setState] = useState<AgentNoticeState | null>(null);
  const [asking, setAsking] = useState(false);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    void api.agent.notice().then(setState, () => setFailed(true));
  }, []);
  useEffect(() => {
    if (!has("agent.notice")) return;
    load();
    const off = api.agent.onNotice((s) => {
      setAsking(false);
      setState(s);
    });
    window.addEventListener("focus", load);
    return () => {
      off();
      window.removeEventListener("focus", load);
    };
  }, [load]);
  if (!has("agent.notice") || !state) return null;

  const allow = () => {
    setAsking(true);
    setFailed(false);
    void api.agent.noticeAllow().then(setState, () => {
      setAsking(false);
      setFailed(true);
    });
  };
  const change = (on: boolean) => {
    setState({ ...state, enabled: on });
    setFailed(false);
    void api.agent.noticeSet(on).then(setState, () => {
      setState({ ...state, enabled: !on });
      setFailed(true);
    });
  };

  return (
    <Row label={t("agent.notice.label")} hint={failed ? t("agent.saveFailed") : noticeHint(state, asking, locale)}>
      {state.permission === "notDetermined" ? (
        <Button onClick={allow} disabled={asking}>
          {t("agent.notice.allow")}
        </Button>
      ) : state.permission === "allowed" ? (
        <Switch label={t("agent.notice.label")} checked={state.enabled} onChange={change} />
      ) : null}
    </Row>
  );
}
