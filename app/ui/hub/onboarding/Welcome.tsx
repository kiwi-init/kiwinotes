// A primeira abertura (T20795, spec #20780): depois da intro, o Kiwi Cat grande diz oi num balão que se escreve sozinho,
// com [Vamos lá] e [Agora não]. Daqui saem as telas seguintes, na ordem do lead (#20854, `welcomeNext`):
// - Vamos lá: o que o Kiwi faz (T20838) → as permissões e o modelo de voz (`FirstRunSetup`, T20796) → o consentimento do
//   ADR 0011 → o agente liga, e o onboarding dele (`Onboarding`) abre sozinho no passo do Claude Code.
// - Agora não: `FirstRunSetup` → o Hub, com o agente desligado.
// Só o Continuar do `FirstRunSetup` grava `firstRun: "done"`: se o app fechar antes, a boas-vindas volta na próxima abertura.
import "./onboarding.css";
import "./welcome.css";

import { useEffect, useRef, useState } from "react";

import type { AgentStatus, AppSettings } from "../../../src/shared/ui-contract.ts";
import { TAIL_SVG_INNER } from "../../kiwicat-v2/bubbleTail.ts";
import { Consent } from "../../settings/Agent.tsx";
import { api, has } from "../../src/api.ts";
import { Button } from "../../src/kit/index.tsx";
import { FirstRunSetup } from "./FirstRunSetup.tsx";
import { BigCat } from "./Onboarding.tsx";
import {
  typedLength,
  WELCOME_NO,
  WELCOME_START,
  WELCOME_TEXT,
  WELCOME_YES,
  welcomeNext,
  type WelcomeEvent,
  type WelcomeFlow,
} from "./welcomeText.ts";

/** A tela do que o Kiwi faz (T20838) ainda não está neste build: o Vamos lá vai direto às permissões. */
const TOUR = false;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const systemReduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** O balão que se escreve: um clique nele mostra o texto inteiro. O leitor de tela lê o texto inteiro de uma vez. */
function TypedBubble({ reduced, onTyped }: { reduced: boolean; onTyped: () => void }) {
  const [shown, setShown] = useState(() => typedLength(WELCOME_TEXT, 0, reduced));
  const typed = shown >= WELCOME_TEXT.length;
  useEffect(() => {
    if (typed) return onTyped();
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const n = typedLength(WELCOME_TEXT, now - start, reduced);
      setShown(n);
      if (n < WELCOME_TEXT.length) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed]);
  return (
    <div className="kn-bubble-shell kn-welcome-bubble" data-typed={typed} onClick={() => setShown(WELCOME_TEXT.length)}>
      <p className="kn-welcome-text">
        {/* O leitor de tela lê o texto inteiro de uma vez (um aria-label num parágrafo o WebKit ignora). */}
        <span className="kn-visually-hidden">{WELCOME_TEXT}</span>
        <span aria-hidden="true">{WELCOME_TEXT.slice(0, shown)}</span>
        {/* O resto, invisível, segura o tamanho do balão desde o começo (ele não cresce enquanto escreve). */}
        <span className="kn-welcome-rest" aria-hidden="true">{WELCOME_TEXT.slice(shown)}</span>
      </p>
      <svg className="kn-bubble-tail" data-side="bottom-left" width="34" height="24" viewBox="0 0 34 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: TAIL_SVG_INNER }} />
    </div>
  );
}

function Hello({ settings, onChoose }: { settings: AppSettings; onChoose: (e: WelcomeEvent) => void }) {
  const reduced = settings.appearance.motion === "reduced" || systemReduced();
  const [typed, setTyped] = useState(reduced);
  const actions = useRef<HTMLElement>(null);
  // O foco vai ao Vamos lá quando o balão termina (antes disso, Enter não escolhe nada sem querer).
  useEffect(() => {
    if (typed) actions.current?.querySelector<HTMLElement>("[data-variant=primary]")?.focus();
  }, [typed]);
  return (
    <div className="kn-onb kn-welcome" role="dialog" aria-modal="true" aria-label="Boas-vindas" data-motion={reduced ? "reduced" : "full"}>
      <div className="kn-welcome-stage">
        <TypedBubble reduced={reduced} onTyped={() => setTyped(true)} />
        <BigCat cor={settings.kiwicat.cor} reduced={reduced} />
      </div>
      <footer className="kn-welcome-actions" data-shown={typed} ref={actions}>
        <Button onClick={() => onChoose("no")}>{WELCOME_NO}</Button>
        <Button variant="primary" onClick={() => onChoose("yes")}>
          {WELCOME_YES}
        </Button>
      </footer>
    </div>
  );
}

/** O consentimento do ADR 0011, o mesmo de Ajustes › Agente, em tela cheia. Ligar abre o onboarding do agente. */
function ConsentStep({ status, onDone }: { status: AgentStatus; onDone: () => void }) {
  const [failure, setFailure] = useState<string | null>(null);
  const yes = () => {
    setFailure(null);
    api.agent.enable(true).then(onDone, (e: unknown) => setFailure(message(e)));
  };
  return (
    <div className="kn-onb kn-welcome-consent" role="dialog" aria-modal="true" aria-label={`Antes de ligar o ${status.name}`}>
      <section className="kn-onb-step">
        <Consent name={status.name} onYes={yes} onNo={onDone} />
        {failure ? <p className="kn-onb-failure" role="alert">{failure}</p> : null}
      </section>
    </div>
  );
}

export function Welcome({ settings, onClosed }: { settings: AppSettings; onClosed: () => void }) {
  const [flow, setFlow] = useState<WelcomeFlow>(WELCOME_START);
  const [agent, setAgent] = useState<AgentStatus | null>(null);
  const go = (e: WelcomeEvent) => setFlow((f) => welcomeNext(f, e, { tour: TOUR }));

  // O hub atrás fica `inert` enquanto a primeira abertura está na tela.
  useEffect(() => {
    const behind = [...document.querySelectorAll<HTMLElement>(".kn-hub-top, .kn-hub-main")];
    for (const el of behind) el.inert = true;
    return () => {
      for (const el of behind) el.inert = false;
    };
  }, []);

  // No consentimento: sem o agente neste engine, fecha; já aceito antes, liga direto (não pergunta de novo).
  useEffect(() => {
    if (flow.stage !== "consent") return;
    if (!has("agent.status") || !has("agent.enable")) return void go("no");
    let alive = true;
    void api.agent.status().then(
      (s) => {
        if (!alive) return;
        if (s.enabled) return go("yes");
        if (s.consented) return void api.agent.enable().then(() => alive && go("yes"), () => alive && setAgent(s));
        setAgent(s);
      },
      () => alive && go("no"),
    );
    return () => {
      alive = false;
    };
  }, [flow.stage]);

  useEffect(() => {
    if (flow.stage === "closed") onClosed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.stage]);

  switch (flow.stage) {
    case "welcome":
      return <Hello settings={settings} onChoose={go} />;
    case "tour":
      return null;
    case "setup":
      return <FirstRunSetup onDone={() => go("next")} />;
    case "consent":
      return agent ? <ConsentStep status={agent} onDone={() => go("yes")} /> : null;
    case "closed":
      return null;
  }
}
