// A seção Sobre do hub (spec #2370, T2386; lado a lado desde o spec #16837, o mockup B): o ícone à esquerda; à direita
// o app, a versão e o canal, e a faixa da atualização, que checa pelo mesmo Updater do menu (ADR 0008, com a
// conferência da assinatura). A faixa tem um estado de cada vez: parado, procurando, baixando (com a barra), pronta,
// aplicando, e erro ou desligado. Com a versão nova baixada e conferida, o botão vira "Atualizar e reiniciar": um
// clique a mais, para não cortar um ditado no meio (#2385).
// Embaixo, discretos: a regra de privacidade (`PRIVACY_RULE`, ADR 0011), o "Salvar diagnóstico" (T5350) e as Licenças, numa tela à parte.

import "./about.css";

import { useEffect, useState } from "react";

import { type AppAbout, releaseNotesUrl, type UpdatesView } from "../../src/shared/ui-contract.ts";
import { api, has } from "../src/api.ts";
import { Button, Row, Switch } from "../src/kit/index.tsx";
import { PRIVACY_RULE } from "../settings/agentText.ts";
import { CHANNEL, CHECK_UPDATES_HINT, CREDITS, DIAG_HINT, updateBand } from "./aboutText.ts";
import appIcon from "./app-icon.webp";

/** Abre um link do GitHub fora do app (no navegador padrão, pelo `newWindow: "external"` da janela). */
const openOutside = (url: string) => void window.open(url, "_blank", "noopener,noreferrer");

type Diag = { state: "idle" | "saving" } | { state: "saved"; folder: string; name: string } | { state: "failed" };

export function About() {
  const [about, setAbout] = useState<AppAbout | null>(null);
  const [view, setView] = useState<UpdatesView | null>(null);
  const [failed, setFailed] = useState(false);
  const [diag, setDiag] = useState<Diag>({ state: "idle" });
  const [licenses, setLicenses] = useState(false);

  useEffect(() => {
    api.app.about().then(
      (a) => {
        setAbout(a);
        setView(a.updates);
      },
      () => setFailed(true),
    );
    return api.updates.onStatus(setView);
  }, []);

  const check = async () => {
    if (view) setView({ ...view, state: "checking" } as UpdatesView);
    setView(await api.updates.check().catch(() => ({ state: "idle", lastCheck: null }) as UpdatesView));
  };
  const saveDiagnostics = async () => {
    setDiag({ state: "saving" });
    try {
      const r = await api.diagnostics.save();
      const parts = r.path.split("/");
      setDiag({ state: "saved", name: parts.at(-1) ?? r.path, folder: parts.at(-2) ?? "" });
    } catch {
      setDiag({ state: "failed" });
    }
  };
  const apply = async () => {
    if (view) setView({ ...view, state: "applying" } as UpdatesView);
    setView(await api.updates.apply().catch(() => view as UpdatesView));
  };

  if (failed) return <div className="kn-about"><p className="kn-about-line">Não deu para ler a versão do app.</p></div>;
  if (!about || !view) return <div className="kn-about" />;
  if (licenses) return <Licenses onBack={() => setLicenses(false)} />;

  const band = updateBand(view);
  return (
    <div className="kn-about">
      <div className="kn-about-main">
        <img className="kn-about-icon" src={appIcon} alt="" width={156} height={156} draggable={false} />
        <div className="kn-about-body">
          <h1 className="kn-about-name">Kiwi Notes</h1>
          <p className="kn-about-version">
            Versão {about.version} · {CHANNEL[about.channel]}
            {about.releaseUrl ? (
              <>
                {" · "}
                <button type="button" className="kn-about-link" onClick={() => openOutside(about.releaseUrl!)}>
                  notas desta versão
                </button>
              </>
            ) : null}
          </p>

          <div className="kn-about-band" data-state={view.state} data-tone={band.tone} data-result={view.lastCheck?.result ?? ""} aria-live="polite">
            <span className="kn-about-dot" aria-hidden="true" />
            <div className="kn-about-band-text">
              <p className="kn-about-line">
                {band.title}
                {band.notesOf ? (
                  <>
                    {" · "}
                    <button type="button" className="kn-about-link" onClick={() => openOutside(releaseNotesUrl(band.notesOf!))}>
                      O que muda
                    </button>
                  </>
                ) : null}
              </p>
              {band.detail ? <p className="kn-about-detail">{band.detail}</p> : null}
              {band.bar ? (
                <div
                  className="kn-about-bar"
                  role="progressbar"
                  aria-label={band.title}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  {...(band.bar.pct === null ? { "data-indeterminate": "" } : { "aria-valuenow": band.bar.pct })}
                >
                  <span style={band.bar.pct === null ? undefined : { width: `${band.bar.pct}%` }} />
                </div>
              ) : null}
            </div>
            {band.action ? (
              <Button variant="primary" onClick={() => void (band.action!.kind === "apply" ? apply() : check())}>
                {band.action.label}
              </Button>
            ) : null}
          </div>
          <CheckUpdates onChanged={(v) => setView(v)} />
        </div>
      </div>

      <footer className="kn-about-foot">
        <span className="kn-about-privacy">{PRIVACY_RULE}.</span>
        <span className="kn-about-actions">
          {has("diagnostics.save") ? (
            <button type="button" className="kn-about-quiet" title={DIAG_HINT} disabled={diag.state === "saving"} onClick={() => void saveDiagnostics()}>
              {diag.state === "saving" ? "Salvando…" : "Salvar diagnóstico"}
            </button>
          ) : null}
          <button type="button" className="kn-about-quiet" onClick={() => setLicenses(true)}>
            Licenças
          </button>
        </span>
      </footer>
      <p className="kn-about-hint kn-about-diag" aria-live="polite">
        {diag.state === "saved" ? `Salvo em ${diag.folder}: ${diag.name}` : diag.state === "failed" ? "Não deu para salvar o diagnóstico." : ""}
      </p>
    </div>
  );
}

/** As Licenças (spec #7079, à parte desde o #16837): o software de terceiros que vai dentro do app, um por linha. */
function Licenses({ onBack }: { onBack: () => void }) {
  return (
    <div className="kn-about kn-about-licenses">
      <div className="kn-about-licenses-head">
        <button type="button" className="kn-about-quiet kn-about-back" onClick={onBack}>
          ‹ Sobre
        </button>
        <h1 className="kn-about-title">Licenças</h1>
        <p className="kn-about-hint">O software de terceiros que vai dentro do Kiwi Notes. O texto de cada licença vai junto do app.</p>
      </div>
      <ul className="kn-about-credits">
        {CREDITS.map((c) => (
          <li key={c.name}>
            <span className="kn-about-credit-name">{c.name}</span>
            <span className="kn-about-credit-by">
              {c.by.startsWith("Mozilla") ? "da" : "de"} {c.by} · {c.license}
            </span>
            <span className="kn-about-credit-use">Para {c.use}.</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * "Buscar atualizações" (T25110, spec #25011): ligado por padrão. Desligado, nem o Updater nem o canal da UI vão à rede,
 * a partir da próxima checagem e sem reiniciar. Depois de salvar, a faixa de cima é lida de novo.
 */
function CheckUpdates({ onChanged }: { onChanged: (v: UpdatesView) => void }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api.settings.get().then((s) => setOn(s.checkUpdates), () => {});
  }, []);
  if (on === null) return null;
  const change = (next: boolean) => {
    setFailed(false);
    setOn(next);
    api.settings.set({ checkUpdates: next }).then(
      (s) => {
        setOn(s.checkUpdates);
        api.app.about().then((a) => onChanged(a.updates), () => {});
      },
      () => {
        setOn(!next);
        setFailed(true);
      },
    );
  };
  return (
    <div className="kn-about-check">
      <Row label="Buscar atualizações" hint={failed ? "Não deu para salvar. Tente de novo." : CHECK_UPDATES_HINT}>
        <Switch label="Buscar atualizações" checked={on} onChange={change} />
      </Row>
    </div>
  );
}
