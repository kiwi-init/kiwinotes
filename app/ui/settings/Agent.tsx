// A seção Agente dos Ajustes (spec #8373, T8762): ligar o agente, ver se o Claude Code está pronto e mandar o primeiro
// pedido. Tudo começa num clique da pessoa: abrir a seção só confere o Claude Code instalado (`agent.status` com
// `refresh`), sem baixar nem abrir nada. O texto da tela de aviso é o do ADR 0011.

import { useEffect, useRef, useState } from "react";

import type { AgentStatus } from "../../src/shared/ui-contract.ts";
import { api, has } from "../src/api.ts";
import { Button, Row, Section, Select, Switch } from "../src/kit/index.tsx";
import {
  adapterLine,
  applyTurn,
  canTest,
  claudeLine,
  consentText,
  IDLE_TEST,
  modelHint,
  modelOptions,
  switchHint,
  type TestState,
} from "./agentText.ts";
import "./agent.css";

/** O pedido do "Testar" mais longo que a seção manda. */
const TEST_MAX = 500;

export function AgentSection() {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [consenting, setConsenting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [prompt, setPrompt] = useState("Diga oi em uma frase.");
  const [test, setTest] = useState<TestState>(IDLE_TEST);
  const lastPrompt = useRef("");
  /** Conta os eventos `agent.status`: a resposta de uma chamada só vale se nenhum evento chegou durante ela. */
  const events = useRef(0);

  const name = status?.name ?? "Claude Code";

  useEffect(() => {
    if (!has("agent.status")) return;
    let alive = true;
    setChecking(true);
    api.agent.status(true).then(
      (s) => alive && setStatus(s),
      () => alive && setFailure("Não deu para ler o estado do agente."),
    ).finally(() => alive && setChecking(false));
    const offStatus = api.agent.onStatus((s) => {
      events.current++;
      if (alive) setStatus(s);
    });
    const offTurn = api.agent.onTurn((e) => alive && setTest((t) => applyTurn(t, e, name)));
    return () => {
      alive = false;
      offStatus();
      offTurn();
    };
    // O nome só muda de agente para agente: os eventos usam o da primeira leitura.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!has("agent.status") || !status) {
    return failure ? (
      <Section title="Agente">
        <Row label="Agente" hint={failure} />
      </Section>
    ) : null;
  }

  /**
   * Chama uma capacidade e mostra o erro dela na seção, sem derrubar a tela. O estado que ela devolve é de antes do fim
   * (o `cancel` responde antes de o download parar): se um evento chegou no meio, ele é mais novo e fica.
   */
  const run = async (call: () => Promise<AgentStatus | unknown>) => {
    setFailure(null);
    const before = events.current;
    try {
      const r = await call();
      if (r && typeof r === "object" && "adapter" in r && events.current === before) setStatus(r as AgentStatus);
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
    }
  };

  const refresh = async () => {
    setChecking(true);
    await run(() => api.agent.status(true));
    setChecking(false);
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
    const t = text.trim().slice(0, TEST_MAX);
    if (!t) return;
    lastPrompt.current = t;
    setTest({ ...IDLE_TEST, phase: "running", status: "Mandando o pedido…" });
    try {
      const { id } = await api.agent.ask(t);
      setTest((cur) => (cur.id ? cur : { ...cur, id }));
    } catch (e) {
      const code = (e as { code?: string })?.code ?? "E_AGENT_FAILED";
      setTest({ ...IDLE_TEST, phase: "error", error: { code, message: e instanceof Error ? e.message : String(e) } });
    }
  };

  const claude = claudeLine(name, status.claude);
  const a = status.adapter;
  const ready = canTest(status);
  const running = test.phase === "running";

  return (
    <Section title="Agente">
      <Row label={name} hint={claude.text}>
        <Button onClick={() => void refresh()} disabled={checking}>
          {checking ? "Conferindo…" : claude.ok ? "Conferir de novo" : "Tentar de novo"}
        </Button>
      </Row>

      <Row label="Ligar o agente" hint={switchHint(status, consenting)}>
        <Switch label="Ligar o agente" checked={status.enabled} onChange={toggle} />
      </Row>

      {consenting ? <Consent name={name} onYes={() => void turnOn(true)} onNo={() => setConsenting(false)} /> : null}

      {status.enabled ? (
        <Row label="Adaptador" hint={adapterLine(status)}>
          {a.phase === "downloading" ? (
            <Button onClick={() => void run(() => api.agent.cancel())}>Cancelar</Button>
          ) : a.phase === "ready" ? (
            <Button onClick={() => void run(() => api.agent.remove())}>Remover o adaptador</Button>
          ) : (
            <Button variant="primary" onClick={() => void run(() => api.agent.download())}>
              {a.phase === "error" ? "Tentar de novo" : "Baixar"}
            </Button>
          )}
        </Row>
      ) : a.phase === "ready" ? (
        <Row label="Adaptador" hint={`${adapterLine(status)} Desligado, ele não abre.`}>
          <Button onClick={() => void run(() => api.agent.remove())}>Remover o adaptador</Button>
        </Row>
      ) : null}

      {status.enabled && a.phase === "ready" ? (
        <Row label="Modelo" hint={modelHint(status)}>
          <Select label="Modelo do agente" value={status.model} options={modelOptions(status)} onChange={(model) => void run(() => api.agent.configure({ model }))} />
        </Row>
      ) : null}

      {ready ? (
        <div className="kn-agent-test">
          <div className="kn-row-text">
            <div className="kn-row-label">Testar</div>
            <div className="kn-row-hint">Cada teste gasta um pedido do seu plano. Aqui o agente só conversa: não mexe nas notas nem no Mac.</div>
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
              aria-label="Pedido de teste"
              value={prompt}
              maxLength={TEST_MAX}
              disabled={running}
              onChange={(e) => setPrompt(e.target.value)}
            />
            {running ? (
              <Button onClick={() => void run(() => api.agent.cancel())}>Cancelar</Button>
            ) : (
              <Button variant="primary" type="submit" disabled={!prompt.trim()}>
                Testar
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
                    Tentar de novo
                  </button>
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {failure ? <Row label="Não deu certo" hint={failure} /> : null}
    </Section>
  );
}

/** A tela "Antes de ligar o …" (ADR 0011), dentro da seção, na primeira vez que a pessoa liga. */
function Consent({ name, onYes, onNo }: { name: string; onYes: () => void; onNo: () => void }) {
  const t = consentText(name);
  return (
    <div className="kn-agent-consent" role="group" aria-label={t.title}>
      <h3>{t.title}</h3>
      <h4>O que vai para o {name}</h4>
      <ul>
        {t.goes.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <h4>O que nunca vai</h4>
      <ul>
        {t.never.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <h4>Quem envia</h4>
      {t.who.map((l) => (
        <p key={l}>{l}</p>
      ))}
      <div className="kn-agent-consent-buttons">
        <Button variant="primary" onClick={onYes}>
          Ligar o {name}
        </Button>
        <Button onClick={onNo}>Agora não</Button>
      </div>
    </div>
  );
}
