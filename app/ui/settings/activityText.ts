// Os textos da seção "Atividade do agente" (spec #9480): a hora de cada pedido, o que o agente leu, cada mudança, o que
// o [Ver] avisa e o que o [Desfazer] respondeu, em palavras simples. Funções puras, para o `bun test`.

import type { AgentActivityRequest, AgentChangeView, AgentUndoNote } from "../../src/shared/ui-contract.ts";

export type ActivityChange = AgentActivityRequest["changes"][number];

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const two = (n: number) => String(n).padStart(2, "0");

/** "14:32", na hora local. */
export function hourOf(iso: string): string {
  const d = new Date(iso);
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** "hoje, 14:32", "ontem, 09:10" ou "12 nov, 14:32", na hora local. */
export function whenOf(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const today = day(new Date(now));
  const diff = Math.round((today - day(d)) / 86_400_000);
  const label = diff === 0 ? "hoje" : diff === 1 ? "ontem" : `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return `${label}, ${hourOf(iso)}`;
}

/** O nome da nota como a pessoa vê: sem o `.md`. */
export const noteName = (p: string) => p.replace(/\.md$/i, "");

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** O que o agente leu, resumido: "leu 3 notas, procurou 2 vezes". */
export function readsLine(reads: AgentActivityRequest["reads"]): string {
  const notes = new Set<string>();
  const meetings = new Set<string>();
  let searches = 0;
  let listedNotes = false;
  let listedMeetings = false;
  const projects = new Set<string>();
  let listedProjects = false;
  for (const r of reads) {
    if (r.tool === "notes_read" || r.tool === "notes_outline") notes.add(r.target ?? `#${notes.size}`);
    else if (r.tool === "meetings_get") meetings.add(r.target ?? `#${meetings.size}`);
    else if (r.tool === "notes_search") searches++;
    else if (r.tool === "notes_list") listedNotes = true;
    else if (r.tool === "meetings_list") listedMeetings = true;
    else if (r.tool === "project_status") projects.add(r.target ?? `#${projects.size}`);
    else if (r.tool === "projects_list") listedProjects = true;
  }
  const parts: string[] = [];
  if (notes.size) parts.push(`leu ${plural(notes.size, "nota", "notas")}`);
  if (meetings.size) parts.push(`leu ${plural(meetings.size, "reunião", "reuniões")}`);
  if (searches) parts.push(`procurou ${plural(searches, "vez", "vezes")}`);
  if (listedNotes) parts.push("listou as notas");
  if (listedMeetings) parts.push("listou as reuniões");
  if (projects.size) parts.push(`viu ${plural(projects.size, "projeto", "projetos")}`);
  if (listedProjects) parts.push("listou os projetos");
  if (!parts.length) return "Não leu nenhuma nota.";
  const text = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} e ${parts.at(-1)}`;
  return text[0]!.toUpperCase() + text.slice(1) + ".";
}

/**
 * O que o filtro do guardrail segurou no pedido (spec #9818), uma linha por lugar: "O Kiwi segurou 2 segredos em
 * Projetos/Kiwi.", "…no pedido.", "…nos resultados da busca.". Só a contagem, nunca o segredo.
 */
export function heldLines(r: Pick<AgentActivityRequest, "reads" | "requestHeld">): string[] {
  const where = new Map<string, number>();
  const add = (k: string, n: number) => where.set(k, Math.max(where.get(k) ?? 0, n));
  if (r.requestHeld) add("no pedido", r.requestHeld);
  for (const x of r.reads) {
    if (!x.held) continue;
    if (x.tool === "notes_search") add("nos resultados da busca", x.held);
    else if (x.target) add(`em ${noteName(x.target.split(" › ")[0]!)}`, x.held);
  }
  return [...where].map(([k, n]) => `O Kiwi segurou ${plural(n, "segredo", "segredos")} ${k}.`);
}

/** A mudança que tirou segredos da nota (spec #9818): o aviso, com o caminho de volta. */
export const removedLine = (n: number) =>
  `Esta mudança tirou ${plural(n, "segredo", "segredos")} da nota. O Desfazer ${n === 1 ? "o traz" : "os traz"} de volta, e o texto de antes está nas Versões.`;

/** Uma mudança: "Criou Projetos/Resumo", "Acrescentou em Ideias", "Trocou Kiwi › Prazo". */
export function changeLine(c: Pick<ActivityChange, "kind" | "path" | "section">): string {
  const where = `${noteName(c.path)}${c.section ? ` › ${c.section}` : ""}`;
  return c.kind === "created" ? `Criou ${where}` : c.kind === "appended" ? `Acrescentou em ${where}` : `Trocou ${where}`;
}

/** O começo do pedido, como a lista mostra: a primeira linha com texto (o registro guarda os primeiros 300 caracteres). */
export const requestLine = (text: string) => text.split("\n").find((l) => l.trim())?.trim() ?? "";

/** Quantas mudanças do pedido ainda dá para desfazer. */
export const openChanges = (r: AgentActivityRequest) => r.changes.filter((c) => !c.undone).length;

/** O aviso em cima do [Ver], ou null quando o depois é o texto exato do agente numa nota que já existia. */
export function viewNotice(v: AgentChangeView): string | null {
  if (v.before === null && v.state !== "exact" && v.state !== "changed")
    return "A cópia de antes não está mais guardada: não há o que mostrar.";
  switch (v.state) {
    case "undone":
      return `Desfeito ${dayHour(v.undone!)}. O texto que o agente tinha escrito está nas Versões da nota; abaixo, o texto de antes.`;
    case "gone":
      return "A nota não está mais lá: foi renomeada, movida ou apagada. Abaixo, o texto de antes.";
    case "otherFolder":
      return "A nota está em outra pasta de notas. Abra aquela pasta para ver a nota de agora; abaixo, o texto de antes.";
    case "changed":
      return "A nota mudou depois do agente: abaixo está a nota de agora, que já não é só o que ele escreveu.";
    case "exact":
      if (v.before === null) return "A cópia de antes não está mais guardada: abaixo, só o texto que o agente deixou.";
      return v.kind === "created" ? "A nota que o agente criou." : null;
  }
}

/** "às 14:32" hoje, ou "em 12 nov, às 14:32". */
function dayHour(iso: string, now = Date.now()): string {
  const w = whenOf(iso, now);
  return w.startsWith("hoje") ? `às ${hourOf(iso)}` : w.startsWith("ontem") ? `ontem, às ${hourOf(iso)}` : `em ${w.replace(", ", ", às ")}`;
}

/** "Desfeito às 14:32", na linha da mudança. */
export const undoneLine = (iso: string, now = Date.now()) => `Desfeito ${dayHour(iso, now)}`;

/** O que o desfazer fez numa nota, em palavras simples. `requestAt` é a hora do pedido desfeito. */
export function undoLine(n: AgentUndoNote, requestId: string, now = Date.now()): string {
  const name = noteName(n.path);
  if (n.result === "restored") return `${name} voltou ao texto de antes.`;
  if (n.result === "trashed") return `${name} foi para a Lixeira. Nos próximos 10 minutos, dá para trazer de volta pelas Notas.`;
  if (n.result === "already") return `${name} já tinha sido desfeita. Nada mudou.`;
  switch (n.reason) {
    case "E_CHANGED":
      return `${name} mudou depois do agente, então ficou como está. O texto de antes continua guardado.`;
    case "E_GONE":
      return `${name} foi renomeada, movida ou apagada depois do agente. Nada mudou.`;
    case "E_LATER_WRITE": {
      const l = n.later;
      if (l && l.request === requestId)
        return `O agente escreveu de novo em ${name} depois, neste mesmo pedido. Desfaça antes a mudança mais nova, ou o pedido inteiro. Nada mudou.`;
      if (l) return `O agente escreveu de novo em ${name} no pedido ${l.at ? `de ${whenOf(l.at, now)}` : "seguinte"}. Desfaça antes aquele pedido. Nada mudou.`;
      return `O agente escreveu de novo em ${name} depois. Desfaça antes a escrita mais nova. Nada mudou.`;
    }
    case "E_OTHER_FOLDER":
      return `O agente escreveu em ${name} em outra pasta de notas. Abra aquela pasta para desfazer. Nada mudou.`;
    case "E_EXPIRED":
      return `A mudança em ${name} tem mais de 30 dias: não há mais o que desfazer.`;
    case "E_NO_COPY":
      return `A cópia de antes de ${name} não está mais guardada: não há o que desfazer.`;
    default:
      return n.message ?? `${name} ficou como está.`;
  }
}

/** O pedido saiu do registro entre abrir a lista e clicar (passou dos 30 dias): o aviso fica na seção, fora da lista. */
export const goneRequest = (at?: string, now = Date.now()) =>
  `${at ? `O pedido de ${whenOf(at, now)}` : "Esse pedido"} passou dos 30 dias: não há mais o que desfazer.`;

/** A seção sem pedidos. */
export const EMPTY_ACTIVITY = "O agente ainda não fez nada.";

/** A dica da seção. */
export const ACTIVITY_HINT =
  "Cada pedido dos últimos 30 dias, com o que o agente leu e mudou. O Desfazer volta a nota ao texto de antes, se ninguém mexeu nela depois; o texto do agente fica nas Versões.";

/** Quantos pedidos a lista mostra antes do "Mostrar mais", e até onde ele vai. */
export const ACTIVITY_FIRST = 50;
export const ACTIVITY_MORE = 200;
