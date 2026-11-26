// A seção Agente dos Ajustes (spec #8373, T8762): escolher o agente (o Claude Code ou o Gemini, spec #24666), ligar,
// ver se ele está pronto e mandar o primeiro pedido. Tudo começa num clique da pessoa: abrir a seção só confere os
// programas instalados (`agent.status` com `refresh`), sem baixar nem abrir nada. O texto da tela de aviso é o do
// ADR 0011, com a empresa do agente escolhido.

import { useEffect, useRef, useState, type ReactNode } from "react";

import type { AgentKind } from "../../src/shared/ui-contract.ts";
import { api, has } from "../src/api.ts";
import { useT } from "../src/i18n.ts";
import { Button, Row, Section, Segmented, Switch } from "../src/kit/index.tsx";
import {
  adapterLine,
  agentLine,
  AGENTS,
  applyTurn,
  canTest,
  consentText,
  KIND_OPTIONS,
  kindHint,
  kindOf,
  programOf,
  switchText,
  IDLE_TEST,
  economyHint,
  webHint,
  switchHint,
  type TestState,
} from "./agentText.ts";
import { NoticeRow } from "./NoticeRow.tsx";
import { CatSpeaksRow } from "./CatSpeaksRow.tsx";
import { ControlRow, SpokenTextRow } from "./ControlRow.tsx";
import { NoteModelRow } from "./NoteModel.tsx";
import { MemoryRows } from "./MemoryRows.tsx";
import { ModelRows } from "./ModelRows.tsx";
import { RoutinesRows } from "./RoutinesRows.tsx";
import "./agent.css";
import { runAgent, setAgentChecking, setAgentStatus, useAgentStore } from "./agentStore.ts";
import { CatColorRow, CatPlaceRow, CatRow, OverlayCatRow } from "./CatRow";

/** O pedido do "Testar" mais longo que a seção manda. */
const TEST_MAX = 500;

/** As abas de Ajustes › Agente (spec #31754): cada uma é um bloco, e todas dividem o mesmo estado (`agentStore`). */
export type AgentPart = "general" | "kiwi" | "voice" | "memory" | "advanced";

export function AgentSection({ part }: { part: AgentPart }) {
  const { t, locale } = useT();
  /** A língua para os eventos do teste, que a escuta de quando a seção abriu lê. */
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const { status, failure, checking } = useAgentStore(t("agent.readFailed"));
  const setStatus = setAgentStatus;
  const [consenting, setConsenting] = useState(false);
  /** A troca de agente esperando a pessoa confirmar a tela "o que vai" do novo. */
  const [switching, setSwitching] = useState<AgentKind | null>(null);
  const [prompt, setPrompt] = useState(() => t("agent.test.prompt"));
  const [test, setTest] = useState<TestState>(IDLE_TEST);
  const lastPrompt = useRef("");

  const name = status?.name ?? "Claude Code";

  // O teste vive na aba Avançado: só ela ouve as respostas.
  useEffect(() => {
    if (part !== "advanced" || !has("agent.status")) return;
    let alive = true;
    const offTurn = api.agent.onTurn((e) => alive && setTest((cur) => applyTurn(cur, e, name, localeRef.current)));
    return () => {
      alive = false;
      offTurn();
    };
    // O nome só muda de agente para agente: os eventos usam o da primeira leitura.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Desligar (na aba Geral) limpa o teste (na aba Avançado).
  useEffect(() => {
    if (status && !status.enabled) setTest(IDLE_TEST);
  }, [status?.enabled]);

  const title = part === "general" ? t("agent.section") : t(`settings.tab.${part}`);

  if (!has("agent.status") || !status) {
    return failure && part === "general" ? (
      <Section title={title}>
        <Row label={t("agent.section")} hint={failure} />
      </Section>
    ) : null;
  }

  const run = runAgent;

  const refresh = async () => {
    setAgentChecking(true);
    await run(() => api.agent.status(true));
    setAgentChecking(false);
  };

  /** Ligar: na primeira vez, a tela de aviso antes; depois, liga e começa o download, se faltar. */
  const turnOn = async (consent: boolean) => {
    setConsenting(false);
    await run(async () => {
      const s = await api.agent.enable(consent);
      return s.adapter.phase === "missing" || s.adapter.phase === "error" ? api.agent.download() : s;
    });
  };

  const toggle = (next: boolean) => {
    if (consenting) {
      setConsenting(false);
      return;
    }
    if (!next) {
      setConsenting(false);
      setTest(IDLE_TEST);
      void run(() => api.agent.disable());
    } else if (!status.consented) setConsenting(true);
    else void turnOn(false);
  };

  const sendTest = async (text: string) => {
    const ask = text.trim().slice(0, TEST_MAX);
    if (!ask) return;
    lastPrompt.current = ask;
    setTest({ ...IDLE_TEST, phase: "running", status: t("agent.turn.sending") });
    try {
      const { id } = await api.agent.ask(ask);
      setTest((cur) => (cur.id ? cur : { ...cur, id }));
    } catch (e) {
      const code = (e as { code?: string })?.code ?? "E_AGENT_FAILED";
      setTest({ ...IDLE_TEST, phase: "error", error: { code, message: e instanceof Error ? e.message : String(e) } });
    }
  };

  const kind = kindOf(status);
  const a = status.adapter;
  const needsAdapter = AGENTS[kind].adapter;

  /**
   * Trocar de agente: com ele ligado, a tela do novo antes, e só o "Trocar" muda (o serviço fecha o aberto). Desligado,
   * nada vai a lugar nenhum, e a mesma tela vem ao ligar: a troca é direta, sem duas telas iguais seguidas (T24673).
   */
  const choose = (to: AgentKind) => {
    setConsenting(false);
    if (to === kind) return setSwitching(null);
    if (!status.enabled) return void confirmSwitch(to);
    setSwitching(to);
  };
  const confirmSwitch = async (to: AgentKind) => {
    setSwitching(null);
    setTest(IDLE_TEST);
    await run(() => api.agent.configure({ kind: to }));
  };
  const ready = canTest(status);
  const running = test.phase === "running";

  // Cada aba com as suas linhas, as mesmas de antes, só mudadas de lugar (spec #31754).
  const rows: Record<AgentPart, ReactNode> = {
    general: (
      <>
          <Row label={t("agent.kind.label")} hint={kindHint(kind, status.enabled, locale)}>
            <Segmented label={t("agent.kind.label")} value={switching ?? kind} options={KIND_OPTIONS} onChange={choose} />
          </Row>

          {switching ? (
            <Consent kind={switching} switching onYes={() => void confirmSwitch(switching)} onNo={() => setSwitching(null)} />
          ) : null}

          {/* O estado de cada agente (spec #24666): o escolhido primeiro, e o outro embaixo, para comparar antes de trocar. */}
          {[kind, ...KIND_OPTIONS.map((o) => o.value).filter((k) => k !== kind)].map((k) => {
            const line = agentLine(k, AGENTS[k].name, programOf({ ...status, kind: k }), locale);
            return (
              <Row key={k} label={k === kind ? AGENTS[k].name : t("agent.notChosen", { name: AGENTS[k].name })} hint={line.text}>
                <Button onClick={() => void refresh()} disabled={checking}>
                  {checking ? t("agent.checking") : line.ok ? t("agent.checkAgain") : t("agent.retry")}
                </Button>
              </Row>
            );
          })}

          <Row label={t("agent.enable")} hint={switchHint(status, consenting, locale)}>
            <Switch label={t("agent.enable")} checked={status.enabled} onChange={toggle} />
          </Row>

          {consenting ? <Consent kind={kind} onYes={() => void turnOn(true)} onNo={() => setConsenting(false)} /> : null}

          {/* O adaptador é só do Claude Code: o Gemini fala ACP sozinho (spec #24666). */}
          {!needsAdapter ? null : status.enabled ? (
            <Row label={t("agent.adapter")} hint={adapterLine(status, locale)}>
              {a.phase === "downloading" ? (
                <Button onClick={() => void run(() => api.agent.cancel())}>{t("agent.cancel")}</Button>
              ) : a.phase === "ready" ? (
                <Button onClick={() => void run(() => api.agent.remove())}>{t("agent.adapter.remove")}</Button>
              ) : (
                <Button variant="primary" onClick={() => void run(() => api.agent.download())}>
                  {a.phase === "error" ? t("agent.retry") : t("agent.adapter.download")}
                </Button>
              )}
            </Row>
          ) : a.phase === "ready" ? (
            <Row label={t("agent.adapter")} hint={`${adapterLine(status, locale)} ${t("agent.adapter.offNote")}`}>
              <Button onClick={() => void run(() => api.agent.remove())}>{t("agent.adapter.remove")}</Button>
            </Row>
          ) : null}

          {/* O Modelo e o esforço salvo para ele (spec #16793), as mesmas linhas do passo "claude" do onboarding. */}
          {status.enabled && (!needsAdapter || a.phase === "ready") ? <ModelRows status={status} run={(fn) => void run(fn)} /> : null}

          {/* O modo econômico (spec #11084): só aqui, em Ajustes › Agente. */}
          {status.enabled && (!needsAdapter || a.phase === "ready") ? (
            <Row label={t("agent.economy.label")} hint={economyHint(status, locale)}>
              <Switch label={t("agent.economy.label")} checked={status.economy === true} onChange={(economy) => void run(() => api.agent.configure({ economy }))} />
            </Row>
          ) : null}

          {/* "Pesquisar na web" (spec #11908): ligado por padrão (spec #19273); vale já no próximo pedido. */}
          {status.enabled && (!needsAdapter || a.phase === "ready") ? (
            <Row label={t("agent.web.label")} hint={webHint(status, locale)}>
              <Switch label={t("agent.web.label")} checked={status.webSearch === true} onChange={(webSearch) => void run(() => api.agent.configure({ webSearch }))} />
            </Row>
          ) : null}

          {/* "Suas reuniões" (spec #8360) foi para o assunto Reuniões (spec #11966): `AgentMeetingsSection`. */}
      </>
    ),
    kiwi: (
      <>
          <CatRow />
          <CatColorRow agentEnabled={status.enabled} />
          <OverlayCatRow />
          <CatPlaceRow />


          {/* A notificação quando o agente espera uma resposta (spec #9839): só com o agente ligado. */}
          {status.enabled ? <NoticeRow /> : null}


          {/* O atalho Control (spec #9876): só com o agente ligado. */}
          {status.enabled ? <ControlRow status={status} onStatus={setStatus} /> : null}

      </>
    ),
    voice: (
      <>
          {/* "Mostrar o que eu falei" (spec #26055): só com o agente ligado. */}
          {status.enabled ? <SpokenTextRow status={status} onStatus={setStatus} /> : null}

          {/* "O Kiwi fala" (spec #26687): só com o agente ligado; a voz baixa no clique, nunca ao abrir os Ajustes. */}
          {status.enabled ? <CatSpeaksRow status={status} onStatus={setStatus} /> : null}

      </>
    ),
    memory: (
      <>
          {/* A memória do agente e as instruções da pessoa (spec #11469): só com o agente ligado. */}
          {status.enabled ? <MemoryRows status={status} run={run} /> : null}

          {/* As rotinas (spec #12150): o resumo do dia e os pendentes da semana. Só com o agente ligado (desligar as desliga). */}
          {status.enabled && status.routines ? <RoutinesRows status={status} run={run} /> : null}

      </>
    ),
    advanced: (
      <>
          {/* O onboarding (spec #11955): abre de novo, do passo 1, por cima do hub. */}
          {status.enabled ? (
            <Row label={t("agent.onboarding")} hint={t("agent.onboarding.hint")}>
              <Button onClick={() => void run(() => api.agent.configure({ onboarding: { state: "open", step: 1 } }))} disabled={status.onboarding?.state === "open"}>
                {t("agent.onboarding.redo")}
              </Button>
            </Row>
          ) : null}

          {ready ? (
            <div className="kn-agent-test">
              <div className="kn-row-text">
                <div className="kn-row-label">{t("agent.test")}</div>
                <div className="kn-row-hint">{t("agent.test.hint")}</div>
              </div>
              <form
                className="kn-agent-test-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!running) void sendTest(prompt);
                }}
              >
                <input
                  className="kn-input kn-agent-test-input"
                  aria-label={t("agent.test.input")}
                  value={prompt}
                  maxLength={TEST_MAX}
                  disabled={running}
                  onChange={(e) => setPrompt(e.target.value)}
                />
                {running ? (
                  <Button onClick={() => void run(() => api.agent.cancel())}>{t("agent.cancel")}</Button>
                ) : (
                  <Button variant="primary" type="submit" disabled={!prompt.trim()}>
                    {t("agent.test")}
                  </Button>
                )}
              </form>
              {test.phase !== "idle" ? (
                <div className="kn-agent-test-out" data-phase={test.phase} aria-live="polite">
                  {test.status ? <p className="kn-agent-test-status">{test.status}</p> : null}
                  {test.text ? <p className="kn-agent-test-text">{test.text}</p> : null}
                  {test.phase === "error" && test.error ? (
                    <p className="kn-agent-test-error">
                      {test.error.message}{" "}
                      <button type="button" className="kn-agent-link" onClick={() => void sendTest(lastPrompt.current)}>
                        {t("agent.retry")}
                      </button>
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* O Modelo de nota (spec #11102): depois do teste; na primeira vez, aberto e com "Pular". */}
          {ready && has("agent.noteModel") ? <NoteModelRow /> : null}

      </>
    ),
  };

  return (
    <Section title={title}>
      {rows[part]}

      {failure ? <Row label={t("agent.failed")} hint={failure} /> : null}
    </Section>
  );
}

/**
 * A tela "Antes de ligar o …" (ADR 0011), dentro da seção, na primeira vez que a pessoa liga, e na troca de agente
 * (`switching`, spec #24666), com a empresa e o adaptador do agente que vai ser usado.
 */
export function Consent({ kind, switching = false, onYes, onNo }: { kind: AgentKind; switching?: boolean; onYes: () => void; onNo: () => void }) {
  const { t: tr, locale } = useT();
  const { name, company, adapter } = AGENTS[kind];
  const t = consentText(name, company, adapter, locale);
  const sw = switching ? switchText(kind, locale) : null;
  return (
    <div className="kn-agent-consent" role="group" aria-label={sw?.title ?? t.title}>
      <h3>{sw?.title ?? t.title}</h3>
      <h4>{tr("agent.consent.goesTo", { name })}</h4>
      <ul>
        {t.goes.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <h4>{tr("agent.consent.never")}</h4>
      <ul>
        {t.never.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <h4>{tr("agent.consent.who")}</h4>
      {t.who.map((l) => (
        <p key={l}>{l}</p>
      ))}
      <div className="kn-agent-consent-buttons">
        <Button variant="primary" onClick={onYes}>
          {sw?.yes ?? tr("agent.consent.turnOn", { name })}
        </Button>
        <Button onClick={onNo}>{tr("agent.consent.notNow")}</Button>
      </div>
    </div>
  );
}
