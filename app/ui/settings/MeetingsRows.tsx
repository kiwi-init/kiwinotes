// "Suas reuniões" em Ajustes › Agente (spec #8360, T11294): quando o agente propõe a nota da reunião, onde ela vai, o
// nome do arquivo (com prévia ao vivo) e os blocos do resumo. E o resumo executivo do projeto (spec #11546): os 6
// blocos e o período do primeiro. Cada mudança vai inteira pelo `agent.configure`.

import { useEffect, useState } from "react";

import type { AgentStatus } from "../../src/shared/ui-contract.ts";
import type { SummarySettings } from "../../src/shared/summary-settings.ts";
import type { AgentMeetingSettings } from "../../src/store/settings.ts";
import { api, has } from "../src/api.ts";
import { folderChoices } from "../src/folderChoices.ts";
import { useT } from "../src/i18n.ts";
import { Row, Segmented, Select, Switch } from "../src/kit/index.tsx";
import { blocks, blocksHint, folderHint, folderOptions, nameOptions, namePreview, proposeHint, proposeOptions } from "./meetingsText.ts";
import { firstDaysHint, firstDaysOptions, summaryBlockLabels, summaryBlocksHint } from "./summaryText.ts";

/**
 * A pasta única que vem marcada quando a pessoa troca para "Numa pasta única" e o cofre não tem pastas. É o nome de uma
 * pasta do cofre, não um texto da tela: fica igual nas duas línguas.
 */
const FIRST_FOLDER = "Atas";

export function MeetingsRows({ status, run }: { status: AgentStatus; run: (call: () => Promise<unknown>) => Promise<void> }) {
  const { t, locale } = useT();
  const m = status.meetings;
  const [folders, setFolders] = useState<string[] | null>(null);

  useEffect(() => {
    // Só os nomes das pastas (spec #12918), sem o cofre inteiro.
    const load = has("notes.folders") ? api.notes.folders : has("notes.list") ? api.notes.list : null;
    if (m.folder.kind !== "single" || folders || !load) return;
    let alive = true;
    void load().then(
      (r) => alive && setFolders(r.folders.filter((f) => f !== "Reuniões" && !f.startsWith("Reuniões/"))), // i18n-ok: o nome da pasta das reuniões no vault
      () => alive && setFolders([]),
    );
    return () => {
      alive = false;
    };
  }, [m.folder.kind, folders]);

  const save = (next: AgentMeetingSettings) => void run(() => api.agent.configure({ meetings: next }));
  const r = status.summary;
  const saveSummary = (next: SummarySettings) => void run(() => api.agent.configure({ summary: next }));
  const single = m.folder.kind === "single" ? m.folder.path : null;
  const choices = folderChoices([single], folders ?? []);

  return (
    <div className="kn-agent-meetings" role="group" aria-label={t("settings.meetings.title")}>
      <Row label={t("settings.meetings.title")} hint={t("settings.meetings.hint")} />
      <Row label={t("settings.meetings.after")} hint={proposeHint(m.propose, status.economy === true, locale)}>
        <Segmented label={t("settings.meetings.after")} value={m.propose} options={proposeOptions(locale)} onChange={(propose) => save({ ...m, propose })} />
      </Row>
      <Row label={t("settings.meetings.where")} hint={folderHint(m.folder, locale)}>
        <div className="kn-agent-meetings-folder">
          <Segmented
            label={t("settings.meetings.where")}
            value={m.folder.kind}
            options={folderOptions(locale)}
            onChange={(kind) =>
              save({ ...m, folder: kind === "single" ? { kind, path: single ?? folders?.[0] ?? FIRST_FOLDER } : { kind: "project" } })
            }
          />
          {single ? (
            <Select
              label={t("settings.meetings.folder.select")}
              value={single}
              options={choices.map((f) => ({ value: f, label: f }))}
              onChange={(path) => save({ ...m, folder: { kind: "single", path } })}
            />
          ) : null}
        </div>
      </Row>
      <Row label={t("settings.meetings.name")} hint={t("settings.meetings.name.preview", { name: namePreview(m.name, new Date(), locale) })}>
        <Segmented label={t("settings.meetings.name")} value={m.name} options={nameOptions(locale)} onChange={(name) => save({ ...m, name })} />
      </Row>
      <Row label={t("settings.meetings.blocks")} hint={blocksHint(m.blocks, locale)} />
      {blocks(locale).map((b) => (
        <Row key={b.key} label={b.label}>
          <Switch label={b.label} checked={m.blocks[b.key]} onChange={(on) => save({ ...m, blocks: { ...m.blocks, [b.key]: on } })} />
        </Row>
      ))}
      <Row label={t("settings.meetings.summary.title")} hint={t("settings.meetings.summary.hint")} />
      <Row label={t("settings.meetings.summary.first")} hint={firstDaysHint(r.firstDays, locale)}>
        <Segmented
          label={t("settings.meetings.summary.first")}
          value={String(r.firstDays) as "7" | "14" | "30"}
          options={firstDaysOptions(locale)}
          onChange={(d) => saveSummary({ ...r, firstDays: Number(d) as SummarySettings["firstDays"] })}
        />
      </Row>
      <Row label={t("settings.meetings.summary.blocks")} hint={summaryBlocksHint(r.blocks, locale)} />
      {summaryBlockLabels(locale).map((b) => (
        <Row key={`resumo-${b.key}`} label={b.label}>
          <Switch label={t("settings.meetings.summary.blocks.switch", { label: b.label })} checked={r.blocks[b.key]} onChange={(on) => saveSummary({ ...r, blocks: { ...r.blocks, [b.key]: on } })} />
        </Row>
      ))}
    </div>
  );
}
