// Os textos da seção "Atividade do agente" (spec #9480): a hora de cada pedido, o que o agente leu, cada mudança, o que
// o [Ver] avisa e o que o [Desfazer] respondeu, em palavras simples, pelo catálogo (`activity.*`, T29272). Funções
// puras, para o `bun test`.

import { formatTime } from "../../src/shared/i18n/index.ts";
import type { AgentActivityRequest, AgentChangeView, AgentUndoNote } from "../../src/shared/ui-contract.ts";
import { appLocale, t } from "../src/i18n.ts";

export type ActivityChange = AgentActivityRequest["changes"][number];

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const two = (n: number) => String(n).padStart(2, "0");

/** "14:32" (ou "2:32 PM" em inglês), na hora local. */
export function hourOf(iso: string): string {
  const d = new Date(iso);
  const { locale } = appLocale();
  return locale === "pt" ? `${two(d.getHours())}:${two(d.getMinutes())}` : formatTime(locale, d);
}

/** Quantos dias antes de hoje, pelo relógio local: 0 é hoje, 1 é ontem. */
function daysAgo(d: Date, now: number): number {
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  return Math.round((day(new Date(now)) - day(d)) / 86_400_000);
}

/** O dia curto: "12 nov" / "Nov 12". */
function shortDay(d: Date): string {
  if (appLocale().locale === "pt") return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(d);
}

/** "hoje, 14:32", "ontem, 09:10" ou "12 nov, 14:32" ("today, 2:32 PM" em inglês), na hora local. */
export function whenOf(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  const diff = daysAgo(d, now);
  const label = diff === 0 ? t("activity.today") : diff === 1 ? t("activity.yesterday") : shortDay(d);
  return `${label}, ${hourOf(iso)}`;
}

/** O nome da nota como a pessoa vê: sem o `.md`. */
export const noteName = (p: string) => p.replace(/\.md$/i, "");

/** O que o agente leu, resumido: "leu 3 notas, procurou 2 vezes". */
export function readsLine(reads: AgentActivityRequest["reads"]): string {
  const notes = new Set<string>();
  const meetings = new Set<string>();
  let searches = 0;
  let listedNotes = false;
  let listedMeetings = false;
  const projects = new Set<string>();
  let listedProjects = false;
  /** Os arquivos lidos (spec #11549): a mesma planilha lida em várias partes conta uma vez. */
  const files = new Set<string>();
  for (const r of reads) {
    if (r.tool === "files_read" || r.tool === "sheets_read" || r.tool === "docx_read") files.add((r.target ?? `#${files.size}`).split(" › ")[0]!);
    else if (r.tool === "notes_read" || r.tool === "notes_outline") notes.add(r.target ?? `#${notes.size}`);
    else if (r.tool === "meetings_get") meetings.add(r.target ?? `#${meetings.size}`);
    else if (r.tool === "notes_search") searches++;
    else if (r.tool === "notes_list") listedNotes = true;
    else if (r.tool === "meetings_list") listedMeetings = true;
    else if (r.tool === "project_status") projects.add(r.target ?? `#${projects.size}`);
    else if (r.tool === "projects_list") listedProjects = true;
    // A memória (spec #11469) tem as linhas dela (`memoryLines`): não é uma leitura de nota.
  }
  const parts: string[] = [];
  if (notes.size) parts.push(t("activity.read.notes", { n: notes.size }));
  if (meetings.size) parts.push(t("activity.read.meetings", { n: meetings.size }));
  if (files.size) parts.push(t("activity.read.files", { n: files.size }));
  if (searches) parts.push(t("activity.read.searches", { n: searches }));
  if (listedNotes) parts.push(t("activity.read.listedNotes"));
  if (listedMeetings) parts.push(t("activity.read.listedMeetings"));
  if (projects.size) parts.push(t("activity.read.projects", { n: projects.size }));
  if (listedProjects) parts.push(t("activity.read.listedProjects"));
  if (!parts.length) return reads.some((r) => r.tool.startsWith("memory_")) ? "" : t("activity.read.none");
  const text = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")}${t("activity.and")}${parts.at(-1)}`;
  return text[0]!.toUpperCase() + text.slice(1) + ".";
}

/** O que o agente mudou na memória (spec #11469), uma linha por fato: "Anotou na memória: “…”." */
export function memoryLines(reads: AgentActivityRequest["reads"]): string[] {
  return reads
    .filter((r) => (r.tool === "memory_remember" || r.tool === "memory_forget") && r.target)
    .map((r) => t(r.tool === "memory_remember" ? "activity.mem.remember" : "activity.mem.forget", { fact: r.target! }));
}

/**
 * O que o filtro do guardrail segurou no pedido (spec #9818), uma linha por lugar: "O Kiwi segurou 2 segredos em
 * Projetos/Kiwi.", "…no pedido.", "…nos resultados da busca.". Só a contagem, nunca o segredo.
 */
export function heldLines(r: Pick<AgentActivityRequest, "reads" | "requestHeld">): string[] {
  const where = new Map<string, number>();
  const add = (k: string, n: number) => where.set(k, Math.max(where.get(k) ?? 0, n));
  if (r.requestHeld) add(t("activity.held.request"), r.requestHeld);
  for (const x of r.reads) {
    if (!x.held) continue;
    if (x.tool === "notes_search") add(t("activity.held.search"), x.held);
    else if (x.target) add(t("activity.held.in", { note: noteName(x.target.split(" › ")[0]!) }), x.held);
  }
  return [...where].map(([k, n]) => t("activity.held", { n, where: k }));
}

/**
 * Uma dúvida que ficou sem resposta (spec #9873): onde, e a máscara do trecho, nunca o trecho. "O Kiwi ficou em dúvida
 * em Projetos/Kiwi, linha 4 (•••• (32 caracteres)) e segurou desta vez."
 */
export function doubtLine(d: { path: string; line: number; mask: string }): string {
  const where = d.path ? t("activity.doubt.where", { note: noteName(d.path), line: d.line }) : t("activity.doubt.request");
  return t("activity.doubt", { where, mask: d.mask });
}

/** A mudança que tirou segredos da nota (spec #9818): o aviso, com o caminho de volta. */
export const removedLine = (n: number) => t("activity.removed", { n });

/** Um arquivo que não é nota (o que o agente gerou, spec #11549): a Atividade oferece o Finder no lugar do [Ver]. */
export const isFile = (path: string) => !/\.md$/i.test(path);

/** Uma mudança: "Criou Projetos/Resumo", "Acrescentou em Ideias", "Trocou Kiwi › Prazo". */
export function changeLine(c: Pick<ActivityChange, "kind" | "path" | "section">): string {
  const where = `${noteName(c.path)}${c.section ? ` › ${c.section}` : ""}`;
  return t(c.kind === "created" ? "activity.change.created" : c.kind === "appended" ? "activity.change.appended" : "activity.change.replaced", { where });
}

/** O começo do pedido, como a lista mostra: a primeira linha com texto (o registro guarda os primeiros 300 caracteres). */
export const requestLine = (text: string) => text.split("\n").find((l) => l.trim())?.trim() ?? "";

/** Quantas mudanças do pedido ainda dá para desfazer. */
export const openChanges = (r: AgentActivityRequest) => r.changes.filter((c) => !c.undone).length;

/** O aviso em cima do [Ver], ou null quando o depois é o texto exato do agente numa nota que já existia. */
export function viewNotice(v: AgentChangeView): string | null {
  if (v.before === null && v.state !== "exact" && v.state !== "changed")
    return t("activity.view.noCopy");
  switch (v.state) {
    case "undone":
      return t("activity.view.undone", { when: dayHour(v.undone!) });
    case "gone":
      return t("activity.view.gone");
    case "otherFolder":
      return t("activity.view.otherFolder");
    case "changed":
      return t("activity.view.changed");
    case "exact":
      if (v.before === null) return t("activity.view.exactNoCopy");
      return v.kind === "created" ? t("activity.view.created") : null;
  }
}

/** "às 14:32" hoje, "ontem, às 14:32", ou "em 12 nov, às 14:32". */
function dayHour(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  const diff = daysAgo(d, now);
  const time = hourOf(iso);
  return diff === 0 ? t("activity.at", { time }) : diff === 1 ? t("activity.atYesterday", { time }) : t("activity.atDay", { date: shortDay(d), time });
}

/** "Desfeito às 14:32", na linha da mudança. */
export const undoneLine = (iso: string, now = Date.now()) => t("activity.undoneAt", { when: dayHour(iso, now) });

/** O que o desfazer fez numa nota, em palavras simples. `requestAt` é a hora do pedido desfeito. */
export function undoLine(n: AgentUndoNote, requestId: string, now = Date.now()): string {
  const name = noteName(n.path);
  if (n.result === "restored") return t("activity.undo.restored", { name });
  if (n.result === "trashed") return t("activity.undo.trashed", { name });
  if (n.result === "already") return t("activity.undo.already", { name });
  switch (n.reason) {
    case "E_CHANGED":
      return t("activity.undo.changed", { name });
    case "E_GONE":
      return t("activity.undo.gone", { name });
    case "E_LATER_WRITE": {
      const l = n.later;
      if (l && l.request === requestId) return t("activity.undo.laterSame", { name });
      if (l) return l.at ? t("activity.undo.laterAt", { name, when: whenOf(l.at, now) }) : t("activity.undo.laterNext", { name });
      return t("activity.undo.later", { name });
    }
    case "E_OTHER_FOLDER":
      return t("activity.undo.otherFolder", { name });
    case "E_EXPIRED":
      return t("activity.undo.expired", { name });
    case "E_NO_COPY":
      return t("activity.undo.noCopy", { name });
    default:
      return n.message ?? t("activity.undo.default", { name });
  }
}

/** O pedido saiu do registro entre abrir a lista e clicar (passou dos 30 dias): o aviso fica na seção, fora da lista. */
export const goneRequest = (at?: string, now = Date.now()) => (at ? t("activity.goneAt", { when: whenOf(at, now) }) : t("activity.gone"));

/** A seção sem pedidos. */
export const emptyActivity = () => t("activity.empty");

/** A dica da seção. */
export const activityHint = () => t("activity.hint");

/** Quantos pedidos a lista mostra antes do "Mostrar mais", e até onde ele vai. */
export const ACTIVITY_FIRST = 50;
export const ACTIVITY_MORE = 200;
