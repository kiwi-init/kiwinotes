// O [Ver] da tela "Atividade do agente" (spec #9480): o antes e o depois de uma mudança do agente, para a tela comparar.
// Só lê: o registro (`activity.ts`) e a nota, pelas mesmas capacidades do desfazer (`UndoNotes`).
//
// - **O antes** é a cópia do registro; numa nota criada, "". Sem a cópia, null.
// - **O depois exato** é a nota de agora, se ela ainda está na versão que o agente deixou; senão, a cópia da escrita
//   seguinte do agente na mesma nota, se essa cópia está naquela versão (a 1ª de duas escritas no mesmo pedido).
// - **Senão,** a nota de agora, marcada como mudada depois do agente.
// - **Só o antes** numa mudança já desfeita, numa nota que sumiu e com outra pasta de notas aberta: a tela nunca lê a
//   nota de mesmo nome da pasta errada.

import { versionOf } from "../notes/vault.ts";
import { ACTIVITY_LIST_MAX, type ActivityChange, type AgentActivity } from "./activity.ts";
import { keyOf, OtherFolder, sameNote, UndoError, type UndoNotes } from "./undo.ts";
import type { AgentChangeView } from "../shared/ui-contract.ts";

export interface ChangeViewDeps {
  activity: AgentActivity;
  notes: UndoNotes;
}

/** O antes e o depois da mudança `change` (1 é a primeira) do pedido `requestId`. `UndoError` se não está no registro. */
export async function viewChange(d: ChangeViewDeps, requestId: string, change: number): Promise<AgentChangeView> {
  let record;
  try {
    record = await d.activity.get(requestId);
  } catch {
    record = null; // um id que nem cabe no registro
  }
  if (!record) throw new UndoError(`O pedido ${requestId} não está no registro (ele guarda 30 dias).`);
  const c = record.changes[change - 1];
  if (!c) throw new UndoError(`O pedido ${requestId} não tem a mudança ${change}.`);

  const before = c.kind === "created" ? "" : await d.activity.copy(c.copy ?? "").catch(() => null);
  const base: AgentChangeView = {
    request: requestId,
    change,
    path: c.path,
    kind: c.kind,
    ...(c.section !== undefined ? { section: c.section } : {}),
    at: c.at,
    ...(c.undone ? { undone: c.undone } : {}),
    before,
    state: "undone",
  };
  if (c.undone) return base;

  const folder = await d.notes.folder();
  if (c.folder && (!folder || keyOf(c.folder) !== folder.key)) return { ...base, state: "otherFolder" };
  let current;
  try {
    current = await d.notes.get(c.path, folder?.id);
  } catch (e) {
    if (e instanceof OtherFolder) return { ...base, state: "otherFolder" };
    throw e;
  }
  if (!current) return { ...base, state: "gone" };
  if (current.version === c.version) return { ...base, state: "exact", after: current.content };

  const next = await nextWrite(d.activity, requestId, change - 1, record.changes, c);
  if (next?.copy) {
    const text = await d.activity.copy(next.copy).catch(() => null);
    if (text !== null && versionOf(text) === c.version) return { ...base, state: "exact", after: text };
  }
  return { ...base, state: "changed", after: current.content };
}

/** A escrita seguinte do agente na mesma nota: no mesmo pedido depois desta, ou num outro pedido depois dela. */
async function nextWrite(
  activity: AgentActivity,
  requestId: string,
  index: number,
  changes: ActivityChange[],
  c: ActivityChange,
): Promise<ActivityChange | null> {
  const here = changes.find((x, i) => i > index && sameNote(x, c));
  if (here) return here;
  const t = Date.parse(c.at);
  let found: ActivityChange | null = null;
  for (const r of await activity.list(ACTIVITY_LIST_MAX)) {
    if (r.id === requestId) continue;
    for (const x of r.changes) {
      const xt = Date.parse(x.at);
      if (sameNote(x, c) && xt > t && (!found || xt < Date.parse(found.at))) found = x;
    }
  }
  return found;
}
