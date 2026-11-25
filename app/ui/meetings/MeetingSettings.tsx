// Os ajustes de reunião, dentro da aba Reuniões (R6, T4947): o atalho de gravar e parar, o "pausar meu mic", o pop-up
// "Gravar esta reunião?" e os apps que contam como reunião. O engine guarda (`settings.meetings`) e manda ao helper no
// `config.set` do R2.
import { type FormEvent, useEffect, useState } from "react";

import {
  DEFAULT_MEETING_APPS,
  isBundleId,
  type MeetingAppEntry,
  type MeetingSettings,
} from "../../src/shared/meetings.ts";
import { api, has } from "../src/api.ts";
import { useT } from "../src/i18n.ts";
import { RemoveIcon } from "../src/kit/editable.tsx";
import { Button, Row, Section, Switch } from "../src/kit/index.tsx";
import { ShortcutRow } from "../settings/Shortcuts.tsx";
import { useShortcuts } from "../src/useShortcuts.ts";

/** Os apps iguais à lista padrão, na mesma ordem. */
const isDefault = (apps: MeetingAppEntry[]) =>
  apps.length === DEFAULT_MEETING_APPS.length && apps.every((a, i) => a.bundleId === DEFAULT_MEETING_APPS[i]!.bundleId && a.name === DEFAULT_MEETING_APPS[i]!.name);

export function MeetingSettingsSection() {
  const { t } = useT();
  const [settings, setSettings] = useState<MeetingSettings | null>(null);
  const [failed, setFailed] = useState(false);
  // Os atalhos das reuniões são os de Configurações › Atalhos (T5349): a mesma linha, nos dois lugares.
  const shortcuts = useShortcuts();

  useEffect(() => {
    if (!has("settings.get")) return;
    api.settings.get().then(
      (s) => s.meetings && setSettings(s.meetings),
      () => setFailed(true),
    );
    return api.settings.onChanged((s) => s.meetings && setSettings(s.meetings));
  }, []);

  // Um engine sem os ajustes de reunião: a seção não aparece.
  if (!settings) return failed ? <Section title={t("meetings.settings.title")}><Row label={t("meetings.settings.loadFailed")} /></Section> : null;

  const change = (patch: Partial<MeetingSettings>) => {
    const before = settings;
    setSettings({ ...settings, ...patch });
    setFailed(false);
    api.settings.set({ meetings: patch }).then(
      (s) => s.meetings && setSettings(s.meetings),
      () => {
        setSettings(before);
        setFailed(true);
      },
    );
  };

  return (
    <Section title={t("meetings.settings.title")}>
      {failed ? <div className="kn-meet-settings-error" role="alert">{t("meetings.settings.saveFailed")}</div> : null}
      {shortcuts ? (
        <>
          <ShortcutRow id="meeting" shortcuts={shortcuts} />
          <ShortcutRow id="meetingPause" shortcuts={shortcuts} />
        </>
      ) : null}
      <Row label={t("meetings.settings.suggest")} hint={t("meetings.settings.suggestHint")}>
        <Switch label={t("meetings.settings.suggest")} checked={settings.suggest} onChange={(suggest) => change({ suggest })} />
      </Row>
      <AppsRow apps={settings.apps} onChange={(apps) => change({ apps })} />
    </Section>
  );
}

function AppsRow({ apps, onChange }: { apps: MeetingAppEntry[]; onChange(apps: MeetingAppEntry[]): void }) {
  const { t } = useT();
  const [name, setName] = useState("");
  const [bundleId, setBundleId] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Uma entrada por nome na tela: Teams e FaceTime têm dois bundle ids, que saem juntos.
  const byName = new Map<string, MeetingAppEntry[]>();
  for (const a of apps) byName.set(a.name, [...(byName.get(a.name) ?? []), a]);

  const add = (e: FormEvent) => {
    e.preventDefault();
    const id = bundleId.trim();
    const label = name.trim();
    if (!label) return setError(t("meetings.settings.needName"));
    if (!isBundleId(id)) return setError(t("meetings.settings.badId"));
    if (apps.some((a) => a.bundleId.toLowerCase() === id.toLowerCase())) return setError(t("meetings.settings.already"));
    setError(null);
    setName("");
    setBundleId("");
    onChange([...apps, { bundleId: id, name: label }]);
  };

  return (
    <div className="kn-row kn-meet-apps">
      <div className="kn-row-text">
        <div className="kn-row-label">{t("meetings.settings.apps")}</div>
        <div className="kn-row-hint">{t("meetings.settings.appsHint")}</div>
      </div>
      <ul className="kn-meet-app-list" aria-label={t("meetings.settings.apps")}>
        {[...byName].map(([label, entries]) => (
          <li key={label} className="kn-meet-app" title={entries.map((a) => a.bundleId).join(", ")}>
            <span>{label}</span>
            <button
              type="button"
              className="kn-icon-button"
              aria-label={t("meetings.settings.removeApp", { name: label })}
              onClick={() => onChange(apps.filter((a) => a.name !== label))}
            >
              <RemoveIcon />
            </button>
          </li>
        ))}
        {apps.length === 0 ? <li className="kn-meet-app-none">{t("meetings.settings.noApps")}</li> : null}
      </ul>
      <form className="kn-meet-app-add" onSubmit={add}>
        <input className="kn-input" placeholder={t("meetings.settings.name")} aria-label={t("meetings.settings.nameLabel")} value={name} onChange={(e) => setName(e.target.value)} />
        <input
          className="kn-input"
          placeholder={t("meetings.settings.id")}
          aria-label={t("meetings.settings.idLabel")}
          value={bundleId}
          onChange={(e) => setBundleId(e.target.value)}
        />
        <Button type="submit">{t("meetings.settings.add")}</Button>
        {!isDefault(apps) ? <Button onClick={() => onChange([...DEFAULT_MEETING_APPS])}>{t("meetings.settings.restore")}</Button> : null}
      </form>
      {error ? <div className="kn-meet-settings-error" role="alert">{error}</div> : null}
    </div>
  );
}
