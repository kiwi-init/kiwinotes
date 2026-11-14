// "Suas reuniões" em Ajustes › Agente (spec #8360, T11294): quando o agente propõe a nota da reunião, onde ela vai, o
// nome do arquivo (com prévia ao vivo) e os blocos do resumo. Cada mudança vai inteira pelo `agent.configure`.

import { useEffect, useState } from "react";

import type { AgentStatus } from "../../src/shared/ui-contract.ts";
import type { AgentMeetingSettings } from "../../src/store/settings.ts";
import { api, has } from "../src/api.ts";
import { Row, Segmented, Select, Switch } from "../src/kit/index.tsx";
import {
  BLOCKS,
  blocksHint,
  FOLDER_OPTIONS,
  folderHint,
  MEETINGS_HINT,
  MEETINGS_TITLE,
  NAME_OPTIONS,
  namePreview,
  PROPOSE_OPTIONS,
  proposeHint,
} from "./meetingsText.ts";

/** A pasta única que vem marcada quando a pessoa troca para "Numa pasta única" e o cofre não tem pastas. */
const FIRST_FOLDER = "Atas";

export function MeetingsRows({ status, run }: { status: AgentStatus; run: (call: () => Promise<unknown>) => Promise<void> }) {
  const m = status.meetings;
  const [folders, setFolders] = useState<string[] | null>(null);

  useEffect(() => {
    if (m.folder.kind !== "single" || folders || !has("notes.list")) return;
    let alive = true;
    void api.notes.list().then(
      (r) => alive && setFolders(r.folders.filter((f) => f !== "Reuniões" && !f.startsWith("Reuniões/"))),
      () => alive && setFolders([]),
    );
    return () => {
      alive = false;
    };
  }, [m.folder.kind, folders]);

  const save = (next: AgentMeetingSettings) => void run(() => api.agent.configure({ meetings: next }));
  const single = m.folder.kind === "single" ? m.folder.path : null;
  const choices = [...new Set([...(single ? [single] : []), ...(folders ?? [])])];

  return (
    <div className="kn-agent-meetings" role="group" aria-label={MEETINGS_TITLE}>
      <Row label={MEETINGS_TITLE} hint={MEETINGS_HINT} />
      <Row label="Depois da reunião" hint={proposeHint(m.propose, status.economy === true)}>
        <Segmented label="Depois da reunião" value={m.propose} options={PROPOSE_OPTIONS} onChange={(propose) => save({ ...m, propose })} />
      </Row>
      <Row label="Onde vai a nota" hint={folderHint(m.folder)}>
        <div className="kn-agent-meetings-folder">
          <Segmented
            label="Onde vai a nota"
            value={m.folder.kind}
            options={FOLDER_OPTIONS}
            onChange={(kind) =>
              save({ ...m, folder: kind === "single" ? { kind, path: single ?? folders?.[0] ?? FIRST_FOLDER } : { kind: "project" } })
            }
          />
          {single ? (
            <Select
              label="A pasta das notas de reunião"
              value={single}
              options={choices.map((f) => ({ value: f, label: f }))}
              onChange={(path) => save({ ...m, folder: { kind: "single", path } })}
            />
          ) : null}
        </div>
      </Row>
      <Row label="O nome do arquivo" hint={`Prévia: ${namePreview(m.name, new Date())}`}>
        <Segmented label="O nome do arquivo" value={m.name} options={NAME_OPTIONS} onChange={(name) => save({ ...m, name })} />
      </Row>
      <Row label="O que entra no resumo" hint={blocksHint(m.blocks)} />
      {BLOCKS.map((b) => (
        <Row key={b.key} label={b.label}>
          <Switch label={b.label} checked={m.blocks[b.key]} onChange={(on) => save({ ...m, blocks: { ...m.blocks, [b.key]: on } })} />
        </Row>
      ))}
    </div>
  );
}
