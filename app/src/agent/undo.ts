// O desfazer das mudanças do agente (spec #9353): a pessoa volta uma mudança, ou o pedido inteiro, com a cópia de antes
// que o registro do agente guardou (`activity.ts`). É da pessoa, não do agente: não vira ferramenta dele.
//
// - **Nota por nota.** Cada nota do pedido volta ao texto de antes da primeira escrita do agente nela, ou fica como está,
//   com o motivo. Uma nota recusada não impede as outras.
// - **Nunca por cima da pessoa.** Só age se a nota está exatamente na versão que o agente deixou, e a conferência vai
//   junto com a gravação (`notes.save` com `baseVersion`) ou com a ida à Lixeira (`notes.delete` com `baseVersion`). A
//   nota editada, renomeada, movida ou apagada depois, ou outra pasta de notas aberta: nada muda.
// - **Uma mudança só,** se não houve outra escrita do agente depois na mesma nota; senão a mais nova vem primeiro.
// - **O texto do agente vai para as Versões** antes de a nota voltar (`snapshot: true`), e a cópia de antes continua no
//   registro. A nota que o agente criou vai para a Lixeira: 10 minutos no Desfazer do app, depois a Lixeira do macOS.
// - **30 dias,** pela idade da mudança, como o registro.
// - **Pelas capacidades das janelas** (`UNDO_CAPABILITIES`): a janela das Notas recebe o `notes.changed` como de
//   qualquer mudança.

import { versionOf } from "../notes/vault.ts";
import { ACTIVITY_KEEP_MS, ACTIVITY_LIST_MAX, type ActivityChange, type AgentActivity } from "./activity.ts";
import type { AgentUndoNote, AgentUndoResult } from "../shared/ui-contract.ts";

/** As notas pelo que o desfazer precisa: ler, voltar o texto, mandar para a Lixeira e a pasta aberta. */
export interface UndoNotes {
  /** A pasta de notas aberta: o `id` (que as chamadas levam) e a `key` (que não muda ao reabrir); null sem pastas. */
  folder(): Promise<{ id: string; key: string } | null>;
  /** A nota agora; null se ela não existe. */
  get(path: string, folderId?: string): Promise<{ content: string; version: string } | null>;
  /** Grava `content` se a nota ainda está em `baseVersion`, com o texto de agora nas Versões; false se não gravou. */
  save(path: string, content: string, baseVersion: string, folderId?: string): Promise<boolean>;
  /** Manda para a Lixeira se a nota ainda está em `baseVersion`, conferido junto com a ida. */
  trash(path: string, baseVersion: string, folderId?: string): Promise<"trashed" | "changed" | "gone">;
}

/** As únicas capacidades que o desfazer chama. */
export const UNDO_CAPABILITIES = ["notes.folder", "notes.get", "notes.save", "notes.delete"] as const;
type UndoCapability = (typeof UNDO_CAPABILITIES)[number];

const codeOf = (e: unknown) => (e as { code?: string })?.code;
const withFolder = (args: Record<string, unknown>, folderId?: string) => (folderId ? { ...args, folderId } : args);

/** A pasta trocou entre a conferência e a chamada: o `folderCapabilities` recusa o id velho. */
class OtherFolder extends Error {}

/** O desfazer sobre as capacidades do app (as de `uiCapabilities`): só as quatro acima. */
export function undoNotesFromCapabilities(caps: Record<UndoCapability, (args: unknown) => unknown>): UndoNotes {
  const call = async <T>(cap: UndoCapability, args: unknown): Promise<T> => {
    try {
      return (await caps[cap](args)) as T;
    } catch (e) {
      if (codeOf(e) === "E_FOLDER_CHANGED") throw new OtherFolder();
      throw e;
    }
  };
  return {
    folder: async () => {
      try {
        const c = (await call<{ current?: { id?: string; key?: string } }>("notes.folder", {})).current;
        return c?.id ? { id: c.id, key: c.key ?? keyOf(c.id) } : null;
      } catch (e) {
        if (codeOf(e) === "E_NO_FOLDERS") return null; // o engine sem pastas: só há uma
        throw e;
      }
    },
    get: async (path, folderId) => {
      try {
        const n = await call<{ content: string; version: string }>("notes.get", withFolder({ path }, folderId));
        return { content: n.content, version: n.version };
      } catch (e) {
        if (codeOf(e) === "E_NOT_FOUND") return null;
        throw e;
      }
    },
    save: async (path, content, baseVersion, folderId) => {
      try {
        const r = await call<{ saved: boolean }>("notes.save", withFolder({ path, content, baseVersion, snapshot: true }, folderId));
        return r.saved === true;
      } catch (e) {
        if (codeOf(e) === "E_NOT_FOUND") return false;
        throw e;
      }
    },
    trash: async (path, baseVersion, folderId) => {
      try {
        await call("notes.delete", withFolder({ path, baseVersion }, folderId));
        return "trashed";
      } catch (e) {
        if (codeOf(e) === "E_CONFLICT") return "changed";
        if (codeOf(e) === "E_NOT_FOUND") return "gone";
        throw e;
      }
    },
  };
}

/** A chave da pasta a partir do id que o escritor anotou (`<chave>:<n>` ou `internal:<chave>`). */
export const keyOf = (id: string) => id.replace(/^internal:/, "").replace(/:\d+$/, "");

/**
 * A mesma nota (revisão do T9398): o mesmo caminho na mesma pasta de notas. Uma nota de mesmo nome em outra pasta é
 * outra nota. Uma mudança sem a pasta anotada (o engine sem pastas) vale para qualquer uma.
 */
const sameNote = (a: ActivityChange, b: ActivityChange) =>
  a.path === b.path && (!a.folder || !b.folder || keyOf(a.folder) === keyOf(b.folder));

/** O pedido (ou a mudança) não está no registro. */
export class UndoError extends Error {
  readonly code = "E_NOT_FOUND";
}

export interface UndoDeps {
  activity: AgentActivity;
  notes: UndoNotes;
  now?: () => number;
  keepMs?: number;
}

type Refusal = Required<Pick<AgentUndoNote, "reason" | "message">>;

const MESSAGES = {
  expired: (): Refusal => ({ reason: "E_EXPIRED", message: "Essa mudança tem mais de 30 dias: não há mais o que desfazer." }),
  noCopy: (): Refusal => ({ reason: "E_NO_COPY", message: "A cópia de antes não está mais no registro: não há o que desfazer." }),
  otherFolder: (): Refusal => ({
    reason: "E_OTHER_FOLDER",
    message: "O agente escreveu em outra pasta de notas. Abra aquela pasta para desfazer; nada foi mudado.",
  }),
  gone: (p: string): Refusal => ({
    reason: "E_GONE",
    message: `${p} foi renomeada, movida ou apagada depois do agente. Nada foi mudado; o texto de antes continua no registro.`,
  }),
  changed: (p: string, created: boolean): Refusal => ({
    reason: "E_CHANGED",
    message: created
      ? `${p} mudou depois que o agente a criou. Ela fica onde está.`
      : `${p} mudou depois do agente. Nada foi mudado; o texto de antes continua no registro e nas Versões da nota.`,
  }),
  laterHere: (p: string, n: number): Refusal => ({
    reason: "E_LATER_WRITE",
    message: `Depois desta, o agente escreveu de novo em ${p} (a mudança ${n} deste pedido). Desfaça primeiro a mais nova, ou o pedido inteiro.`,
  }),
  laterElsewhere: (p: string, request: string, n: number): Refusal => ({
    reason: "E_LATER_WRITE",
    message: `Depois desta, o agente escreveu de novo em ${p}, no pedido ${request} (a mudança ${n}). Desfaça primeiro aquele.`,
  }),
};

/** As mudanças do pedido que voltam juntas numa nota: os índices (0 é a primeira), na ordem. */
interface Group {
  path: string;
  indexes: number[];
}

/**
 * Desfaz o pedido `requestId` inteiro, ou só a mudança `change` dele (1 é a primeira). Nota por nota; o registro anota
 * o que foi desfeito. Lança `UndoError` se o pedido ou a mudança não está no registro.
 */
export async function undo(d: UndoDeps, requestId: string, change?: number): Promise<AgentUndoResult> {
  const now = d.now ?? Date.now;
  const keepMs = d.keepMs ?? ACTIVITY_KEEP_MS;
  let record;
  try {
    record = await d.activity.get(requestId);
  } catch {
    record = null; // um id que nem cabe no registro
  }
  if (!record) throw new UndoError(`O pedido ${requestId} não está no registro: não há o que desfazer (ele guarda 30 dias).`);
  const changes = record.changes;
  if (change !== undefined && !changes[change - 1]) throw new UndoError(`O pedido ${requestId} não tem a mudança ${change}.`);

  const notes: AgentUndoNote[] = [];
  const groups: Group[] = [];
  if (change !== undefined) {
    const c = changes[change - 1]!;
    if (c.undone) notes.push({ path: c.path, result: "already", changes: [change], message: "Já tinha sido desfeita." });
    else groups.push({ path: c.path, indexes: [change - 1] });
  } else {
    // Nota por nota: o caminho e a pasta (um pedido pode ter escrito em duas pastas).
    const byNote: number[][] = [];
    changes.forEach((c, i) => {
      const same = byNote.find((g) => sameNote(changes[g[0]!]!, c));
      if (same) same.push(i);
      else byNote.push([i]);
    });
    for (const all of byNote) {
      const p = changes[all[0]!]!.path;
      const open = all.filter((i) => !changes[i]!.undone);
      if (open.length) groups.push({ path: p, indexes: open });
      else notes.push({ path: p, result: "already", changes: all.map((i) => i + 1), message: "Já tinha sido desfeita." });
    }
  }
  if (!groups.length) return { request: requestId, notes };

  // As escritas do agente nos outros pedidos, para o "outra escrita depois".
  const others = (await d.activity.list(ACTIVITY_LIST_MAX)).filter((r) => r.id !== requestId);
  // Uma pasta aberta, conferida uma vez: o id dela vai em cada chamada, e o app recusa se ela trocar no meio.
  const folder = await d.notes.folder();

  for (const g of groups) {
    const nums = g.indexes.map((i) => i + 1);
    const refuse = (r: Refusal) => notes.push({ path: g.path, result: "refused", changes: nums, ...r });
    const first = changes[g.indexes[0]!]!;
    const last = changes[g.indexes.at(-1)!]!;
    const created = first.kind === "created";

    const laterHere = change !== undefined ? changes.findIndex((c, i) => i > g.indexes[0]! && sameNote(c, first) && !c.undone) : -1;
    if (laterHere >= 0) {
      refuse(MESSAGES.laterHere(g.path, laterHere + 1));
      continue;
    }
    const laterElsewhere = later(others, last);
    if (laterElsewhere) {
      refuse(MESSAGES.laterElsewhere(g.path, laterElsewhere.request, laterElsewhere.n));
      continue;
    }
    if (g.indexes.some((i) => now() - Date.parse(changes[i]!.at) > keepMs)) {
      refuse(MESSAGES.expired());
      continue;
    }
    if (first.folder && (!folder || keyOf(first.folder) !== folder.key)) {
      refuse(MESSAGES.otherFolder());
      continue;
    }
    const folderId = folder?.id;

    try {
      let before: string | null = null;
      if (!created) {
        try {
          before = await d.activity.copy(first.copy ?? "");
        } catch {
          refuse(MESSAGES.noCopy());
          continue;
        }
      }
      const current = await d.notes.get(g.path, folderId);
      if (!current) {
        refuse(MESSAGES.gone(g.path));
        continue;
      }
      if (current.version !== last.version) {
        // Já de volta ao texto de antes (um desfazer que gravou e não chegou a anotar): só anota.
        if (before !== null && current.version === versionOf(before)) {
          await d.activity.markUndone(requestId, g.indexes);
          notes.push({ path: g.path, result: "already", changes: nums, message: "Já estava de volta ao texto de antes." });
        } else refuse(MESSAGES.changed(g.path, created));
        continue;
      }
      if (created) {
        const r = await d.notes.trash(g.path, last.version, folderId);
        if (r !== "trashed") {
          refuse(r === "gone" ? MESSAGES.gone(g.path) : MESSAGES.changed(g.path, true));
          continue;
        }
        await d.activity.markUndone(requestId, g.indexes);
        notes.push({ path: g.path, result: "trashed", changes: nums });
      } else {
        if (!(await d.notes.save(g.path, before!, last.version, folderId))) {
          refuse(MESSAGES.changed(g.path, false));
          continue;
        }
        await d.activity.markUndone(requestId, g.indexes);
        notes.push({ path: g.path, result: "restored", changes: nums });
      }
    } catch (e) {
      if (e instanceof OtherFolder) refuse(MESSAGES.otherFolder());
      else throw e;
    }
  }
  // Na ordem das mudanças do pedido.
  notes.sort((a, b) => a.changes[0]! - b.changes[0]!);
  return { request: requestId, notes };
}

/** A escrita do agente na mesma nota de `after`, num outro pedido, depois dela e ainda não desfeita; a mais velha. */
function later(others: { id: string; changes: ActivityChange[] }[], after: ActivityChange): { request: string; n: number } | null {
  const t = Date.parse(after.at);
  let found: { request: string; n: number; t: number } | null = null;
  for (const r of others) {
    for (const [i, c] of r.changes.entries()) {
      const ct = Date.parse(c.at);
      if (sameNote(c, after) && !c.undone && ct > t && (!found || ct < found.t)) found = { request: r.id, n: i + 1, t: ct };
    }
  }
  return found && { request: found.request, n: found.n };
}
