// A proposta da reunião (spec #8360, T11290): depois de uma reunião gravada, o agente manda os campos (o projeto, o
// tema, o resumo, as decisões, as ações…) pela ferramenta `meeting_propose`, e o Kiwi monta o resto. Nada é escrito
// antes do [Aplicar] da pessoa.
//
// - **O Kiwi monta, não o agente:** a nota da reunião (`data · tema.md` na pasta do projeto, com o link para a
//   transcrição em `Reuniões/`) e a mudança da nota principal (uma linha no histórico de reuniões, as decisões e as
//   pendências na seção delas). Assim os blocos escolhidos em Ajustes valem sempre, e escolher entre dois projetos não
//   gasta outro pedido.
// - **Guardada só no Mac,** em `<dados>/agent/proposals.json` (0600), por 30 dias, aplicada, descartada ou pendente.
//   O que passou dos 30 dias sai assim que o arquivo é lido.

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { headingFor, markdownStructure } from "../shared/markdown-structure.ts";
import { meetingNoteTitle } from "../shared/meeting-note-name.ts";
import { linkSafeName } from "../shared/wikilinks.ts";

export { meetingNoteTitle };
import { DEFAULT_AGENT_MEETING_SETTINGS, type AgentMeetingSettings } from "../store/settings.ts";

/** Quanto uma proposta fica guardada (spec #8360): 30 dias, como o registro do agente. */
export const PROPOSAL_KEEP_MS = 30 * 86_400_000;
/** Os tetos dos campos que o agente manda. */
export const PROPOSAL_THEME_CHARS = 120;
export const PROPOSAL_TEXT_CHARS = 6_000;
export const PROPOSAL_ITEM_CHARS = 500;
export const PROPOSAL_LIST_MAX = 30;
/** O máximo de projetos candidatos numa proposta em dúvida. */
export const PROPOSAL_CANDIDATES_MAX = 4;

/** Uma ação da reunião: o quê, quem e quando, como o agente entendeu. */
export interface ProposalAction {
  what: string;
  who?: string;
  when?: string;
}

/** O que o agente mandou: só campos, sem texto pronto. */
export interface ProposalFields {
  theme: string;
  summary?: string;
  decisions: string[];
  actions: ProposalAction[];
  participants: string[];
  nextSteps: string[];
  /** As pendências novas que vão para a nota principal. */
  pending: string[];
}

/** Um projeto como a proposta guarda. */
export interface ProposalProject {
  folder: string;
  name: string;
  main: string | null;
}

/** A reunião da proposta: a nota em `Reuniões/`. */
export interface ProposalMeeting {
  path: string;
  title: string;
  /** O dia local, `AAAA-MM-DD`. */
  date: string;
}

/**
 * `offer`: o modo econômico estava ligado no fim da reunião (spec #11084), e o Kiwi pergunta antes de gastar um pedido;
 * ainda sem os campos. `pending`: a proposta pronta, esperando [Aplicar] ou [Descartar].
 */
export type ProposalStatus = "offer" | "pending" | "applied" | "discarded";

export interface MeetingProposal {
  id: string;
  /** Quando o agente propôs (ms). */
  at: number;
  /** O pedido do agente em que a proposta nasceu (o registro). */
  request: string;
  meeting: ProposalMeeting;
  /** O projeto escolhido; null sem projeto (ainda em dúvida, ou "Nenhum: só a nota da reunião"). */
  project: ProposalProject | null;
  /** Os projetos parecidos, quando o agente ficou em dúvida: a pessoa escolhe com botões. */
  candidates: ProposalProject[];
  /** Os campos do agente; null numa `offer`, que ainda não foi preparada. */
  fields: ProposalFields | null;
  status: ProposalStatus;
  /** A nota da reunião já criada por um [Aplicar] que não terminou: o próximo não cria outra. */
  notePath?: string;
  /** A nota principal já recebeu a reunião: o próximo [Aplicar] não a repete. */
  mainDone?: boolean;
  /** O pedido do registro em que o [Aplicar] escreveu: é o que o [Desfazer] volta. */
  applyRequest?: string;
  /** Quando foi aplicada ou descartada (ms). */
  doneAt?: number;
  /** Quando o [Desfazer] voltou tudo o que o [Aplicar] escreveu (ms). */
  undoneAt?: number;
}

/** O que a pessoa escolhe em Ajustes › Agente › "Suas reuniões" para a nota: a pasta, o nome e os blocos. */
export type MeetingNoteSettings = Pick<AgentMeetingSettings, "folder" | "name" | "blocks">;

export const DEFAULT_MEETING_NOTE_SETTINGS: MeetingNoteSettings = DEFAULT_AGENT_MEETING_SETTINGS;

/** A proposta espera a pessoa escolher o projeto entre os candidatos. */
export const needsChoice = (p: MeetingProposal) => p.status === "pending" && !p.project && p.candidates.length > 0;

const noMd = (p: string) => p.replace(/\.md$/i, "");
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** A pasta da nota da reunião: a do projeto, a única de Ajustes, ou a raiz quando não há projeto nem pasta única. */
export function meetingNoteFolder(project: ProposalProject | null, s: MeetingNoteSettings): string {
  if (s.folder.kind === "single") return s.folder.path.replace(/^\/+|\/+$/g, "");
  return project ? project.folder : "";
}

/** `11/11/2026` a partir de `2026-11-11`. */
const dayOf = (date: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : date;
};

const bullets = (items: string[]) => items.map((i) => `- ${oneLine(i)}`).join("\n");

function actionLine(a: ProposalAction): string {
  const extra = [a.who && oneLine(a.who), a.when && oneLine(a.when)].filter(Boolean).join(", ");
  return `- [ ] ${oneLine(a.what)}${extra ? ` (${extra})` : ""}`;
}

/** O texto da nota da reunião, com os blocos ligados em Ajustes. A transcrição bruta fica em `Reuniões/`: só o link. */
export function meetingNoteContent(meeting: ProposalMeeting, f: ProposalFields, s: MeetingNoteSettings): string {
  const parts: string[] = [`Reunião de ${dayOf(meeting.date)} · a transcrição: [[${noMd(meeting.path)}|${linkSafeName(meeting.title) || "Reunião"}]]`];
  const b = s.blocks;
  if (b.participants && f.participants.length) parts.push(`**Participantes:** ${f.participants.map(oneLine).join(", ")}`);
  if (b.summary && f.summary?.trim()) parts.push(`## Resumo\n\n${f.summary.trim()}`);
  if (b.decisions && f.decisions.length) parts.push(`## Decisões\n\n${bullets(f.decisions)}`);
  if (b.actions && f.actions.length) parts.push(`## Ações\n\n${f.actions.map(actionLine).join("\n")}`);
  if (b.nextSteps && f.nextSteps.length) parts.push(`## Próximos passos\n\n${bullets(f.nextSteps)}`);
  return `${parts.join("\n\n")}\n`;
}

/** Os títulos que a nota principal pode ter para cada parte (o primeiro que existir ganha). */
const HISTORY_TITLES = ["Histórico de reuniões", "Reuniões"];
const DECISIONS_TITLES = ["Decisões"];
const PENDING_TITLES = ["Pendências", "Pendentes", "A fazer"];

/** Onde está a seção de título `titles` (o primeiro que existir): o fim do texto dela. */
function sectionEnd(content: string, titles: string[]): { end: number; last: boolean } | null {
  const headings = markdownStructure(content).headings;
  for (const t of titles) {
    const h = headingFor(headings, t);
    if (!h) continue;
    const next = headings.find((x) => x.from > h.from && x.level <= h.level);
    return { end: next ? next.from : content.length, last: !next };
  }
  return null;
}

/** Tira só as quebras de linha do fim: os espaços no fim de uma linha são a quebra do Markdown e ficam. */
const trimNewlines = (s: string) => s.replace(/(?:\r?\n)+$/, "");

/** Acrescenta `lines` no fim da seção (sem mexer no que já está), ou numa seção nova no fim da nota. */
function addToSection(content: string, titles: string[], lines: string[]): string {
  if (!lines.length) return content;
  const block = lines.join("\n");
  const at = sectionEnd(content, titles);
  if (!at) {
    const core = trimNewlines(content);
    return `${core}${core ? "\n\n" : ""}## ${titles[0]}\n\n${block}\n`;
  }
  const before = trimNewlines(content.slice(0, at.end));
  const after = content.slice(at.end);
  return `${before}\n${block}\n${at.last ? "" : "\n"}${after}`;
}

/**
 * A nota principal do projeto com a reunião: uma linha no histórico de reuniões, com o link para a nota nova, e as
 * decisões e as pendências novas nas seções delas. Só acrescenta: nenhuma linha que já existe muda.
 */
export function mainNoteWithMeeting(content: string, notePath: string, meeting: ProposalMeeting, f: ProposalFields): string {
  const link = `[[${noMd(notePath)}|${linkSafeName(oneLine(f.theme)) || "Reunião"}]]`;
  let next = addToSection(content, HISTORY_TITLES, [`- ${meeting.date} · ${link}`]);
  next = addToSection(next, DECISIONS_TITLES, f.decisions.map((d) => `- ${oneLine(d)} (${dayOf(meeting.date)})`));
  next = addToSection(next, PENDING_TITLES, f.pending.map((p) => `- [ ] ${oneLine(p)}`));
  return next;
}

/**
 * A nota principal já tem esta reunião: o link para a nota dela está lá. Um [Aplicar] que parou depois de gravar a
 * principal (o app caiu antes de marcar a proposta) não a repete no seguinte.
 */
export function mainHasMeeting(content: string, notePath: string): boolean {
  return content.includes(`[[${noMd(notePath)}|`);
}

/** Uma linha da diferença na nota principal: as que a proposta acrescenta vêm marcadas. */
export interface DiffLine {
  text: string;
  added: boolean;
}

/**
 * A diferença entre a nota de antes e a de depois, linha a linha. A proposta só acrescenta linhas, então o diff é o
 * caminho guloso: cada linha de antes casa com a próxima igual de depois, e o que sobra no meio é novo.
 */
export function addedLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const out: DiffLine[] = [];
  let i = 0;
  for (const line of b) {
    if (i < a.length && line === a[i]) {
      out.push({ text: line, added: false });
      i++;
    } else out.push({ text: line, added: true });
  }
  return out;
}

interface ProposalFile {
  version: 1;
  proposals: MeetingProposal[];
}

/** As propostas guardadas, só no Mac. */
export class ProposalStore {
  private readonly file: string;

  constructor(
    dir: string,
    private readonly now: () => number = Date.now,
  ) {
    this.file = path.join(dir, "proposals.json");
  }

  private load(): ProposalFile {
    if (!existsSync(this.file)) return { version: 1, proposals: [] };
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as Partial<ProposalFile>;
      if (raw.version !== 1 || !Array.isArray(raw.proposals)) throw new Error("bad");
      const now = this.now();
      const kept = raw.proposals.filter((p) => p && typeof p.at === "number" && now - p.at < PROPOSAL_KEEP_MS);
      const f: ProposalFile = { version: 1, proposals: kept };
      // Os 30 dias valem no disco também: o que passou deles sai assim que o arquivo é lido.
      if (kept.length !== raw.proposals.length) this.save(f);
      return f;
    } catch {
      try {
        renameSync(this.file, `${this.file}.bad`);
      } catch {
        // nada
      }
      return { version: 1, proposals: [] };
    }
  }

  private save(f: ProposalFile): void {
    mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(f), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, this.file);
  }

  /** As propostas dos últimos 30 dias, da mais nova para a mais velha. */
  list(): MeetingProposal[] {
    return this.load().proposals.sort((a, b) => b.at - a.at);
  }

  /** Já houve proposta (ou pergunta) para esta reunião, em qualquer estado: uma reunião só gera uma sozinha. */
  hasMeeting(path: string): boolean {
    return this.load().proposals.some((p) => p.meeting.path === path);
  }

  get(id: string): MeetingProposal | null {
    return this.load().proposals.find((p) => p.id === id) ?? null;
  }

  /** Uma proposta nova (ou a pergunta do modo econômico). Uma pendente ou oferta da mesma reunião sai: vale a mais nova. */
  add(p: Omit<MeetingProposal, "id" | "at" | "status">, status: "pending" | "offer" = "pending"): MeetingProposal {
    const f = this.load();
    const proposal: MeetingProposal = { ...p, id: crypto.randomUUID(), at: this.now(), status };
    f.proposals = f.proposals.filter((x) => !((x.status === "pending" || x.status === "offer") && x.meeting.path === p.meeting.path && !x.notePath));
    f.proposals.push(proposal);
    this.save(f);
    return proposal;
  }

  /** Muda uma proposta; devolve a de depois, ou null se ela não existe mais. */
  update(id: string, change: (p: MeetingProposal) => void): MeetingProposal | null {
    const f = this.load();
    const p = f.proposals.find((x) => x.id === id);
    if (!p) return null;
    change(p);
    this.save(f);
    return p;
  }
}
