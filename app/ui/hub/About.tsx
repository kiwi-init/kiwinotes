// A seção Sobre do hub (spec #2370, T2386; lado a lado desde o spec #16837, o mockup B): o ícone à esquerda; à direita
// o app, a versão e o canal, e a faixa da atualização, que checa pelo mesmo Updater do menu (ADR 0008, com a
// conferência da assinatura). A faixa tem um estado de cada vez: parado, procurando, baixando (com a barra), pronta,
// aplicando, e erro ou desligado. Com a versão nova baixada e conferida, o botão vira "Atualizar e reiniciar": um
// clique a mais, para não cortar um ditado no meio (#2385).
// Embaixo, discretos: a regra de privacidade (`privacy.rule`, ADR 0011), o "Salvar diagnóstico" (T5350) e as Licenças, numa tela à parte.

import "./about.css";

import { useEffect, useState } from "react";

import { type AppAbout, releaseNotesUrl, type UiAppearance, type UpdatesView } from "../../src/shared/ui-contract.ts";
import { api, has } from "../src/api.ts";
import { Button, Row, Switch } from "../src/kit/index.tsx";
import { useT } from "../src/i18n.ts";
import { appearanceLine, CHANNEL, CREDITS, creditUse, updateBand } from "./aboutText.ts";
import appIcon from "./app-icon.webp";

/** Abre um link do GitHub fora do app (no navegador padrão, pelo `newWindow: "external"` da janela). */
const openOutside = (url: string) => void window.open(url, "_blank", "noopener,noreferrer");

type Diag = { state: "idle" | "saving" } | { state: "saved"; folder: string; name: string } | { state: "failed" };

export function About() {
  const { t } = useT();
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

  if (failed) return <div className="kn-about"><p className="kn-about-line">{t("about.readFailed")}</p></div>;
  if (!about || !view) return <div className="kn-about" />;
  if (licenses) return <Licenses onBack={() => setLicenses(false)} />;

  const band = updateBand(view);
  return (
    <div className="kn-about">
      <div className="kn-about-main">
        <img className="kn-about-icon" src={appIcon} alt="" width={156} height={156} draggable={false} />
        <div className="kn-about-body">
          <h1 className="kn-about-name">{t("app.name")}</h1>
          <p className="kn-about-version">
            {t("about.version", { version: about.version, channel: t(CHANNEL[about.channel]) })}
            {about.releaseUrl ? (
              <>
                {" · "}
                <button type="button" className="kn-about-link" onClick={() => openOutside(about.releaseUrl!)}>
                  {t("about.releaseNotes")}
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
                      {t("about.whatChanges")}
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
        <span className="kn-about-privacy">{t("privacy.rule")}.</span>
        <span className="kn-about-actions">
          {has("diagnostics.save") ? (
            <button type="button" className="kn-about-quiet" title={t("about.diagHint")} disabled={diag.state === "saving"} onClick={() => void saveDiagnostics()}>
              {diag.state === "saving" ? t("about.diagSaving") : t("about.diagSave")}
            </button>
          ) : null}
          <button type="button" className="kn-about-quiet" onClick={() => setLicenses(true)}>
            {t("about.licenses")}
          </button>
        </span>
      </footer>
      <p className="kn-about-hint kn-about-diag" aria-live="polite">
        {diag.state === "saved" ? t("about.diagSaved", { folder: diag.folder, name: diag.name }) : diag.state === "failed" ? t("about.diagFailed") : ""}
      </p>
    </div>
  );
}

/**
 * A aba Janelas de Ajustes › Sobre (T31766, spec #31754): a aparência de cada janela, que antes ficava embaixo da versão.
 * Sem a UI do canal (a CLI headless), toda janela está na de fábrica, e a aba diz isso em vez de ficar vazia.
 */
export function AboutWindows() {
  const { t } = useT();
  const [ui, setUi] = useState<UiAppearance | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api.app.about().then(
      (a) => setUi(a.ui && a.ui.windows.length ? a.ui : null),
      () => setFailed(true),
    );
  }, []);
  if (failed) return <div className="kn-about"><p className="kn-about-line">{t("about.readFailed")}</p></div>;
  if (ui === undefined) return <div className="kn-about" />;
  return (
    <div className="kn-about">
      {ui ? <Appearance initial={ui} /> : <p className="kn-about-hint">{t("about.windowsBuiltIn")}</p>}
    </div>
  );
}

/**
 * A aparência de cada janela (spec #25011): a versão da UI que ela mostra, a de fábrica ou uma que o canal trouxe, e o
 * "Voltar à aparência anterior", que desfaz a última de cada janela sem fechar o app.
 */
function Appearance({ initial }: { initial: UiAppearance }) {
  const { t } = useT();
  const [ui, setUi] = useState(initial);
  const [state, setState] = useState<"idle" | "reverting" | "failed">("idle");
  const revert = async () => {
    setState("reverting");
    try {
      setUi(await api.ui.revert());
      setState("idle");
    } catch {
      setState("failed");
    }
  };
  return (
    <section className="kn-about-appearance" aria-label={t("about.appearance")}>
      <h2 className="kn-about-subtitle">{t("about.appearance")}</h2>
      <ul className="kn-about-windows">
        {ui.windows.map((w) => {
          const line = appearanceLine(w);
          return (
            <li key={w.window} data-window={w.window}>
              <span>{line.name}</span>
              <span className="kn-about-detail">{line.version}</span>
            </li>
          );
        })}
      </ul>
      {has("ui.revert") ? (
        <button type="button" className="kn-about-quiet" title={t("about.revertHint")} disabled={!ui.canRevert || state === "reverting"} onClick={() => void revert()}>
          {state === "reverting" ? t("about.reverting") : t("about.revert")}
        </button>
      ) : null}
      {state === "failed" ? <p className="kn-about-hint">{t("about.revertFailed")}</p> : null}
    </section>
  );
}

/** As Licenças (spec #7079, à parte desde o #16837): o software de terceiros que vai dentro do app, um por linha. */
function Licenses({ onBack }: { onBack: () => void }) {
  const { t } = useT();
  return (
    <div className="kn-about kn-about-licenses">
      <div className="kn-about-licenses-head">
        <button type="button" className="kn-about-quiet kn-about-back" onClick={onBack}>
          ‹ {t("hub.tab.about")}
        </button>
        <h1 className="kn-about-title">{t("about.licenses")}</h1>
        <p className="kn-about-hint">{t("about.licensesHint")}</p>
      </div>
      <ul className="kn-about-credits">
        {CREDITS.map((c) => (
          <li key={c.name}>
            <span className="kn-about-credit-name">{c.name}</span>
            <span className="kn-about-credit-by">{t(c.by.startsWith("Mozilla") ? "about.credit.byFem" : "about.credit.by", { by: c.by, license: c.license })}</span>
            <span className="kn-about-credit-use">{t("about.credit.use", { use: creditUse(c) })}</span>
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
  const { t } = useT();
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
      <Row label={t("about.checkUpdates")} hint={failed ? t("common.saveFailed") : t("about.checkUpdatesHint")}>
        <Switch label={t("about.checkUpdates")} checked={on} onChange={change} />
      </Row>
    </div>
  );
}
