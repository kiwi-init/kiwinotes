// As Pendências da aba Início (T15875, harry #15873; o desenho é a proposta 4, p4.tsx): os `- [ ]` abertos das notas
// e os próximos passos das atas, agrupados por nota, com "Abrir" para cada uma. Só lê: marcar feito é na nota.
import { type ReactNode, useState } from "react";

import type { HomePending, PendingGroup } from "../../src/shared/home.ts";
import { api } from "../src/api.ts";
import { Segmented } from "../src/kit/index.tsx";
import { MeetingIcon, NoteIcon } from "./icons.tsx";
import { ago } from "./format.ts";
import { useHome } from "./useHome.ts";

type Filter = "all" | "meeting" | "note";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "Todas" },
  { value: "meeting", label: "Reuniões" },
  { value: "note", label: "Notas" },
];

export function Pendencias({ onOpen, now = Date.now }: { onOpen(path: string, internal: boolean): void; now?: () => number }) {
  const load = useHome(api.home.pending);
  const [filter, setFilter] = useState<Filter>("all");
  if (load.state !== "ready") return <PendingShell>{load.state === "error" ? <p className="kn-home-v-empty">Não deu para ler as pendências.</p> : null}</PendingShell>;
  const { groups, total } = load.data;
  const shown = groups.filter((g) => filter === "all" || g.origin === filter);
  return (
    <PendingShell
      sub={summary(total)}
      filter={total.meeting + total.note > 0 ? <Segmented value={filter} options={FILTERS} onChange={setFilter} label="Mostrar" /> : null}
    >
      {shown.length === 0 ? (
        <p className="kn-home-v-empty">{emptyText(filter, total)}</p>
      ) : (
        <div className="kn-home-v-groups">
          {shown.map((g) => (
            <Group key={g.path} g={g} now={now()} onOpen={() => onOpen(g.path, g.internal)} />
          ))}
        </div>
      )}
    </PendingShell>
  );
}

function PendingShell({ sub, filter, children }: { sub?: string; filter?: ReactNode; children: ReactNode }) {
  return (
    <div className="kn-home-v-page" data-view="pendencias">
      <div className="kn-home-v-head">
        <div>
          <h1 className="kn-home-v-title">Pendências</h1>
          {sub ? <p className="kn-home-v-sub">{sub}</p> : null}
        </div>
        {filter}
      </div>
      {children}
    </div>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function summary(total: HomePending["total"]): string {
  const all = total.meeting + total.note;
  if (all === 0) return "Nada em aberto.";
  return `${plural(all, "aberta", "abertas")} · ${total.meeting} das reuniões, ${total.note} das notas`;
}

function emptyText(filter: Filter, total: HomePending["total"]): string {
  if (total.meeting + total.note === 0) return "Nenhum - [ ] aberto nas notas, nem próximo passo nas atas.";
  return filter === "meeting" ? "Nenhum próximo passo aberto nas atas." : "Nenhum - [ ] aberto nas notas.";
}

function Group({ g, now, onOpen }: { g: PendingGroup; now: number; onOpen(): void }) {
  return (
    <section className="kn-home-v-card kn-home-v-group" data-origin={g.origin} data-path={g.path}>
      <header className="kn-home-v-group-head">
        <span className="kn-home-v-group-icon">{g.origin === "meeting" ? <MeetingIcon size={14} /> : <NoteIcon size={14} />}</span>
        <span className="kn-home-v-group-title">{g.title}</span>
        <span className="kn-home-v-muted kn-home-v-group-where">{[g.folder, g.editedAt ? ago(g.editedAt, now) : null].filter(Boolean).join(" · ")}</span>
        <button type="button" className="kn-home-v-link" onClick={onOpen}>
          Abrir
        </button>
      </header>
      <ul className="kn-home-v-list">
        {g.items.map((i) => (
          <li key={i.line}>
            <span className="kn-home-v-box" aria-hidden="true" />
            <span className="kn-home-v-text">{i.text}</span>
          </li>
        ))}
        {g.more > 0 ? (
          <li className="kn-home-v-more">
            <button type="button" className="kn-home-v-link" onClick={onOpen}>
              e mais {g.more}
            </button>
          </li>
        ) : null}
      </ul>
    </section>
  );
}
