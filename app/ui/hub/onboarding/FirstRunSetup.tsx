// O passo da primeira abertura (T20796, spec #20780): depois da boas-vindas do Kiwi Cat (T20795), explica as duas
// permissões do macOS, cada uma com o botão dela, e mostra o modelo de voz baixando. Nada é pedido sem o clique.
// O "Continuar" grava `firstRun: "done"` (`setup.done`) e só então chama o `onDone`; se o app fechar antes, o passo
// volta na próxima abertura.
import "./onboarding.css";
import "./first-run.css";

import { useEffect, useRef, useState } from "react";

import { SETUP_PERMISSIONS, type SetupPermission, type SetupStatus } from "../../../src/shared/first-run.ts";
import { api, has } from "../../src/api.ts";
import { Button } from "../../src/kit/index.tsx";
import { useT } from "../../src/i18n.ts";
import { continueLabel, modelLine, modelTitle, modelWhy, permissionButton, permissionText, setupHint, setupTitle } from "./firstRunText.ts";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function FirstRunSetup({ onDone }: { onDone: () => void }) {
  const { t } = useT();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [asking, setAsking] = useState<SetupPermission | null>(null);
  const [closing, setClosing] = useState(false);
  const finished = useRef(false);
  const title = useRef<HTMLHeadingElement>(null);

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    onDone();
  };

  useEffect(() => {
    // Um engine antigo, sem o passo: segue direto.
    if (!has("setup.status")) return finish();
    let alive = true;
    const off = api.setup.onChanged((s) => alive && setStatus(s));
    void api.setup.status().then(
      (s) => alive && (s.firstRun === "done" ? finish() : setStatus(s)),
      (e: unknown) => alive && setFailure(message(e)),
    );
    return () => {
      alive = false;
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status) title.current?.focus();
  }, [!!status]);

  if (!status) return failure ? <p className="kn-onb-failure" role="alert">{failure}</p> : null;

  const ask = (p: SetupPermission) => {
    setFailure(null);
    setAsking(p);
    api.setup.request(p).then(setStatus, (e: unknown) => setFailure(message(e))).finally(() => setAsking(null));
  };
  const done = () => {
    setFailure(null);
    setClosing(true);
    api.setup.done().then(finish, (e: unknown) => {
      setClosing(false);
      setFailure(message(e));
    });
  };
  const missing = SETUP_PERMISSIONS.filter((p) => status.permissions?.[p] !== "granted").length;
  const model = modelLine(status.model);

  return (
    <div className="kn-onb kn-setup" role="dialog" aria-modal="true" aria-labelledby="kn-setup-title">
      <section className="kn-onb-step kn-setup-step">
        <h1 id="kn-setup-title" className="kn-onb-title" tabIndex={-1} ref={title}>{setupTitle()}</h1>
        <p className="kn-onb-hint">{setupHint()}</p>
        <ul className="kn-setup-list">
          {SETUP_PERMISSIONS.map((p) => {
            const state = status.permissions?.[p];
            const label = permissionButton(state);
            return (
              <li key={p} className="kn-setup-row" data-permission={p} data-state={state ?? "unknown"}>
                <div className="kn-setup-text">
                  <strong>{permissionText(p).name}</strong>
                  <span>{permissionText(p).why}</span>
                </div>
                {label ? (
                  <Button onClick={() => ask(p)} disabled={!status.permissions || asking !== null}>
                    {label}
                  </Button>
                ) : (
                  <span className="kn-setup-ok">{t("setup.allowed")}</span>
                )}
              </li>
            );
          })}
          <li className="kn-setup-row kn-setup-model" data-model={status.model.state}>
            <div className="kn-setup-text">
              <strong>{modelTitle()}</strong>
              <span>{modelWhy()}</span>
              <div className="kn-setup-bar" role="progressbar" aria-label={modelTitle()} aria-valuetext={model.text}
                aria-valuemin={0} aria-valuemax={100} {...(model.fraction !== null ? { "aria-valuenow": Math.round(model.fraction * 100) } : {})}
                data-indeterminate={model.fraction === null && !model.failed}>
                <i style={{ width: `${(model.fraction ?? 0) * 100}%` }} />
              </div>
              <span className="kn-setup-line" data-failed={model.failed} aria-live="polite">{model.text}</span>
            </div>
          </li>
        </ul>
        {failure ? <p className="kn-onb-failure" role="alert">{failure}</p> : null}
      </section>
      <footer className="kn-onb-actions">
        <span />
        <Button variant="primary" onClick={done} disabled={closing}>
          {continueLabel(missing)}
        </Button>
      </footer>
    </div>
  );
}
