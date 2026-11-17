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
import { RemoveIcon } from "../src/kit/editable.tsx";
import { Button, Row, Section, Switch } from "../src/kit/index.tsx";
import { ShortcutRow } from "../settings/Shortcuts.tsx";
import { useShortcuts } from "../src/useShortcuts.ts";

/** Os apps iguais à lista padrão, na mesma ordem. */
const isDefault = (apps: MeetingAppEntry[]) =>
  apps.length === DEFAULT_MEETING_APPS.length && apps.every((a, i) => a.bundleId === DEFAULT_MEETING_APPS[i]!.bundleId && a.name === DEFAULT_MEETING_APPS[i]!.name);

export function MeetingSettingsSection() {
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
  if (!settings) return failed ? <Section title="Ajustes de reunião"><Row label="Não deu para ler os ajustes de reunião." /></Section> : null;

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
    <Section title="Ajustes de reunião">
      {failed ? <div className="kn-meet-settings-error" role="alert">Não deu para salvar. Tente de novo.</div> : null}
      {shortcuts ? (
        <>
          <ShortcutRow id="meeting" shortcuts={shortcuts} />
          <ShortcutRow id="meetingPause" shortcuts={shortcuts} />
        </>
      ) : null}
      <Row label="Perguntar se quer gravar" hint="Quando um app de reunião pega o microfone, uma vez por reunião. Nunca grava sozinho.">
        <Switch label="Perguntar se quer gravar" checked={settings.suggest} onChange={(suggest) => change({ suggest })} />
      </Row>
      <AppsRow apps={settings.apps} onChange={(apps) => change({ apps })} />
    </Section>
  );
}

function AppsRow({ apps, onChange }: { apps: MeetingAppEntry[]; onChange(apps: MeetingAppEntry[]): void }) {
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
    if (!label) return setError("Dê um nome ao app.");
    if (!isBundleId(id)) return setError("O identificador é como com.empresa.App (no Finder: Mostrar Conteúdo do Pacote › Info.plist).");
    if (apps.some((a) => a.bundleId.toLowerCase() === id.toLowerCase())) return setError("Esse app já está na lista.");
    setError(null);
    setName("");
    setBundleId("");
    onChange([...apps, { bundleId: id, name: label }]);
  };

  return (
    <div className="kn-row kn-meet-apps">
      <div className="kn-row-text">
        <div className="kn-row-label">Apps que contam como reunião</div>
        <div className="kn-row-hint">O Meet conta pelo navegador. O próprio Kiwi nunca conta.</div>
      </div>
      <ul className="kn-meet-app-list" aria-label="Apps que contam como reunião">
        {[...byName].map(([label, entries]) => (
          <li key={label} className="kn-meet-app" title={entries.map((a) => a.bundleId).join(", ")}>
            <span>{label}</span>
            <button
              type="button"
              className="kn-icon-button"
              aria-label={`Tirar ${label}`}
              onClick={() => onChange(apps.filter((a) => a.name !== label))}
            >
              <RemoveIcon />
            </button>
          </li>
        ))}
        {apps.length === 0 ? <li className="kn-meet-app-none">Nenhum: o Kiwi não pergunta sozinho.</li> : null}
      </ul>
      <form className="kn-meet-app-add" onSubmit={add}>
        <input className="kn-input" placeholder="Nome (Discord)" aria-label="Nome do app" value={name} onChange={(e) => setName(e.target.value)} />
        <input
          className="kn-input"
          placeholder="Identificador (com.hnc.Discord)"
          aria-label="Identificador do app"
          value={bundleId}
          onChange={(e) => setBundleId(e.target.value)}
        />
        <Button type="submit">Adicionar</Button>
        {!isDefault(apps) ? <Button onClick={() => onChange([...DEFAULT_MEETING_APPS])}>Restaurar a lista padrão</Button> : null}
      </form>
      {error ? <div className="kn-meet-settings-error" role="alert">{error}</div> : null}
    </div>
  );
}
