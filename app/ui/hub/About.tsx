// A seção Sobre do hub (spec #2370, T2386): o app, a versão e o canal, as notas da versão e o "Verificar atualizações",
// que checa na hora pelo mesmo Updater do menu (ADR 0008, com a conferência da assinatura). Com a versão nova baixada e
// conferida, o botão vira "Atualizar e reiniciar": um clique a mais, para não cortar um ditado no meio (#2385).

import "./about.css";

import { useEffect, useState } from "react";

import { type AppAbout, releaseNotesUrl, type UpdatesView } from "../../src/shared/ui-contract.ts";
import { api } from "../src/api.ts";
import { Button } from "../src/kit/index.tsx";
import { CHANNEL, statusLine } from "./aboutText.ts";

/** Abre um link do GitHub fora do app (no navegador padrão, pelo `newWindow: "external"` da janela). */
const openOutside = (url: string) => void window.open(url, "_blank", "noopener,noreferrer");

export function About() {
  const [about, setAbout] = useState<AppAbout | null>(null);
  const [view, setView] = useState<UpdatesView | null>(null);
  const [failed, setFailed] = useState(false);

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
  const apply = async () => {
    if (view) setView({ ...view, state: "applying" } as UpdatesView);
    setView(await api.updates.apply().catch(() => view as UpdatesView));
  };

  if (failed) return <div className="kn-about"><p className="kn-about-line">Não deu para ler a versão do app.</p></div>;
  if (!about || !view) return <div className="kn-about" />;

  const busy = view.state === "checking" || view.state === "downloading" || view.state === "applying";
  return (
    <div className="kn-about">
      <h1 className="kn-about-name">Kiwi Notes</h1>
      <p className="kn-about-version">
        Versão {about.version} · {CHANNEL[about.channel]}
      </p>
      {about.releaseUrl ? (
        <button type="button" className="kn-about-link" onClick={() => openOutside(about.releaseUrl!)}>
          Notas desta versão
        </button>
      ) : null}

      <div className="kn-about-updates" aria-live="polite">
        <p className="kn-about-line" data-state={view.state} data-result={view.lastCheck?.result ?? ""}>
          {statusLine(view)}
        </p>
        {view.state === "ready" ? (
          <>
            <Button variant="primary" onClick={() => void apply()}>
              Atualizar e reiniciar
            </Button>
            <button type="button" className="kn-about-link" onClick={() => openOutside(releaseNotesUrl(view.version))}>
              O que mudou na {view.version}
            </button>
          </>
        ) : (
          <Button variant="primary" disabled={busy || view.state === "off"} onClick={() => void check()}>
            {view.state === "checking" ? "Verificando…" : view.state === "downloading" ? "Baixando…" : view.state === "applying" ? "Atualizando…" : "Verificar atualizações"}
          </Button>
        )}
      </div>
    </div>
  );
}
