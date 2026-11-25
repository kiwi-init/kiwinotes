// Os textos do onboarding do agente (spec #11955): o título e a frase de cada passo, a barra de progresso e o cartão
// final. TypeScript puro, testado no `bun test`.

import { ONBOARDING_STEPS, type OnboardingStep } from "../../../src/shared/agent-onboarding.ts";
import { DEFAULT_SHORTCUTS, parseShortcut, shortcutLabel } from "../../../src/shared/shortcuts.ts";
import type { ProjectReason } from "../../../src/notes/project-finder.ts";
import type { ProjectInfo } from "../../../src/notes/projects.ts";
import type { AgentTurnEvent, AgentVoiceUi, ProjectCandidate, ProjectSearchView } from "../../../src/shared/ui-contract.ts";
import { AGENTS, kindOf, loginUnknown, programOf, type AgentKind, type ProgramState } from "../../settings/agentText.ts";
import type { TextKey } from "../../../src/shared/i18n/index.ts";
import { t } from "../../src/i18n.ts";

/** O título e a frase de cada passo, no catálogo (spec #28171). O passo 2 não tem frase (revisão do T13145): o cartão
 * (que leva o aviso do microfone) e a frase embaixo já dizem como. `{hold}` é o atalho escolhido (spec #12946). */
export const STEP_KEYS: Record<OnboardingStep, { title: TextKey; hint: TextKey | null }> = {
  claude: { title: "onb.step.claude.title", hint: "onb.step.claude.hint" },
  control: { title: "onb.step.control.title", hint: null },
  tone: { title: "onb.step.tone.title", hint: "onb.step.tone.hint" },
  guardrail: { title: "onb.step.guardrail.title", hint: "onb.step.guardrail.hint" },
  model: { title: "onb.step.model.title", hint: "onb.step.model.hint" },
  projects: { title: "onb.step.projects.title", hint: "onb.step.projects.hint" },
  color: { title: "onb.step.color.title", hint: "onb.step.color.hint" },
  place: { title: "onb.step.place.title", hint: "onb.step.place.hint" },
  magic: { title: "onb.step.magic.title", hint: "onb.step.magic.hint" },
  done: { title: "onb.step.done.title", hint: "onb.step.done.hint" },
};

export const STEP_COUNT = ONBOARDING_STEPS.length;

/** O passo de 1 a 10, para o id. */
export const stepAt = (n: number): OnboardingStep => ONBOARDING_STEPS[Math.min(Math.max(n, 1), STEP_COUNT) - 1]!;

/** "Passo 3 de 10". */
export const progressLine = (n: number) => t("onb.progress", { step: String(n), total: String(STEP_COUNT) });

/**
 * O passo 1 é o único que segura a pessoa (spec #11955: sem o agente logado, ele não liga). O "Pular" dele só vale quando
 * o agente escolhido serve e, no Claude Code, a ponte está baixada (o Gemini fala ACP sozinho, spec #24666); o teste é
 * opcional. O Gemini antes do primeiro pedido não diz o login (`loginKnown: false`), e o oi é o que confere.
 */
export function canLeaveClaude(s: { claude: ProgramState | null; adapter: { phase: string }; kind?: AgentKind; gemini?: ProgramState | null }): boolean {
  const c = programOf(s);
  return !!c?.installed && (c.loggedIn || loginUnknown(c)) && c.versionOk && (!AGENTS[kindOf(s)].adapter || s.adapter.phase === "ready");
}

/** O jeito de falar no cartão final: a 1ª linha das instruções, curta; sem instruções, o padrão. */
export function toneSummary(instructions: string): string {
  const first = instructions.split("\n").find((l) => l.trim())?.trim() ?? "";
  if (!first) return t("onb.summary.toneDefault");
  return first.length > 60 ? `${first.slice(0, 59)}…` : first;
}

/** Os projetos no cartão final: até 3 nomes e "mais N". */
export function projectsSummary(names: readonly string[]): string {
  if (!names.length) return t("onb.summary.noProjects");
  const shown = names.slice(0, 3).join(", ");
  return names.length > 3 ? t("onb.summary.moreProjects", { shown, n: String(names.length - 3) }) : shown;
}

/** Como as frases chamam o atalho do Kiwi Cat (spec #12946): "o Control", "o ⌥ direito", ou a combinação ("⌃⌥Espaço"). */
export function holdName(text: string | null | undefined): string {
  const s = text ?? DEFAULT_SHORTCUTS.agent!;
  return parseShortcut(s)?.kind === "key" ? t("onb.hold.key", { key: shortcutLabel(s) }) : shortcutLabel(s);
}

/** O texto do passo, com o atalho escolhido no lugar do Control (spec #12946). */
export function stepText(step: OnboardingStep, hold = holdName(null)): { title: string; hint: string } {
  const k = STEP_KEYS[step];
  return { title: t(k.title, { hold }), hint: k.hint ? t(k.hint, { hold }) : "" };
}

/** O atalho no cartão final. */
export function shortcutSummary(controlShortcut: boolean, hold = holdName(null)): string {
  return controlShortcut ? t("onb.summary.hold", { hold }) : t("onb.summary.noShortcut");
}

// ── Passo 2: o Control (T12002) ──────────────────────────────────────────────────────────────────────────────────────


/** Onde a pessoa está no "aperta o Control e fala oi". */
export type ControlPhase = { phase: "waiting" } | { phase: "listening" } | { phase: "processing" } | { phase: "asked"; text?: string; id: string } | { phase: "answered"; text?: string };

/** O próximo estado do passo 2, pelo evento da fala (`agent.voice`) ou do pedido (`agent.turn`). */
export function controlStep(s: ControlPhase, e: { voice: AgentVoiceUi } | { turn: AgentTurnEvent }): ControlPhase {
  if ("voice" in e) {
    const v = e.voice;
    if (v.phase === "listening") return s.phase === "answered" ? s : { phase: "listening" };
    if (v.phase === "processing") return { phase: "processing" };
    if (v.phase === "asked") return v.text ? { phase: "asked", text: v.text, id: v.id } : { phase: "asked", id: v.id };
    return s.phase === "listening" || s.phase === "processing" ? { phase: "waiting" } : s;
  }
  const t = e.turn;
  if (s.phase === "asked" && t.id === s.id && t.type === "done") return s.text ? { phase: "answered", text: s.text } : { phase: "answered" };
  return s;
}

/** A frase do passo 2 para o estado. */
export function controlLine(s: ControlPhase, hold = holdName(null)): string {
  switch (s.phase) {
    case "waiting":
      return t("onb.control.waiting", { hold });
    case "listening":
      return t("onb.control.listening", { hold });
    case "processing":
      return t("onb.control.processing");
    case "asked":
      // Sem o texto ("Mostrar o que eu falei" desligado, spec #26055), a frase não repete a fala.
      return s.text ? t("onb.control.askedText", { text: s.text }) : t("onb.control.asked");
    case "answered":
      return s.text ? t("onb.control.answeredText", { text: s.text, hold }) : t("onb.control.answered", { hold });
  }
}

// ── Passo 3: o jeito de falar (T12002) ───────────────────────────────────────────────────────────────────────────────

export interface Tone {
  length: "curto" | "detalhado";
  register: "informal" | "formal";
}

export const DEFAULT_TONE: Tone = { length: "curto", register: "informal" };

/**
 * O começo da linha que o onboarding cuida nas instruções: só ela muda; o resto é da pessoa. A linha sai na língua do
 * app, e as duas são reconhecidas (quem trocou de língua não ganha uma segunda linha).
 */
const TONE_PREFIXES = ["Jeito de falar:", "How to talk:"];
const isToneLine = (l: string) => TONE_PREFIXES.some((p) => l.trim().startsWith(p));

/** A linha das instruções para o jeito escolhido. */
export function toneLine(tone: Tone): string {
  const len = t(tone.length === "curto" ? "onb.tone.line.short" : "onb.tone.line.detailed");
  const reg = t(tone.register === "informal" ? "onb.tone.line.informal" : "onb.tone.line.formal");
  return `${t("onb.tone.prefix")} ${len}; ${reg}.`;
}

/** As instruções com a linha do jeito de falar trocada (ou posta no começo); as outras linhas ficam como estão. */
export function withTone(instructions: string, t: Tone): string {
  const lines = instructions.split("\n");
  const at = lines.findIndex(isToneLine);
  if (at >= 0) {
    lines[at] = toneLine(t);
    return lines.join("\n");
  }
  return instructions.trim() ? `${toneLine(t)}\n${instructions}` : toneLine(t);
}

/** O jeito que as instruções já pedem (a linha do onboarding), ou o padrão. */
export function toneOf(instructions: string): Tone {
  const line = instructions.split("\n").find(isToneLine);
  if (!line) return DEFAULT_TONE;
  const detailed = line.includes("detalhadas") || line.includes("detailed");
  const formal = line.includes("tom formal") || line.includes("; formal tone");
  return { length: detailed ? "detalhado" : "curto", register: formal ? "formal" : "informal" };
}

/** A resposta de exemplo, fixa, do próprio Kiwi (sem pedido ao agente), para a pergunta "o que tem de novo no projeto?". */
export function toneExample(tone: Tone): string {
  if (tone.length === "curto") return t(tone.register === "informal" ? "onb.tone.example.shortInformal" : "onb.tone.example.shortFormal");
  return t(tone.register === "informal" ? "onb.tone.example.detailedInformal" : "onb.tone.example.detailedFormal");
}

// ── Passo 6: os projetos (T11999) ────────────────────────────────────────────────────────────────────────────────────

/** Uma linha do passo 6: uma pasta achada pela busca ou um projeto já marcado. `marked`: a pasta do projeto, se é um. */
export interface ProjectRow {
  key: string;
  name: string;
  where: string;
  reason?: string;
  folder?: string;
  outside?: string;
  marked?: string;
}

/**
 * As linhas do passo 6 (spec #12950): os projetos já marcados primeiro, e depois o que a busca achou, do mais recente ao
 * mais antigo, sem repetir uma pasta que já é projeto (pela pasta dentro da pasta de notas, ou pelo caminho de fora).
 */
export function projectRows(projects: readonly Pick<ProjectInfo, "name" | "folder" | "outside">[], found: readonly ProjectCandidate[]): ProjectRow[] {
  const keyOf = (c: { folder?: string; outside?: string }) => (c.outside ? `outside:${c.outside}` : `folder:${c.folder}`);
  const byKey = new Map(found.map((c) => [keyOf(c), c]));
  const rows: ProjectRow[] = projects.map((p) => {
    const c = byKey.get(keyOf(p));
    return {
      key: keyOf(p),
      name: c?.name ?? p.name,
      where: c?.where ?? p.outside ?? t("onb.projects.notes", { folder: p.folder }),
      // O que a busca não achou foi a pessoa que marcou: a linha diz isso no lugar do motivo (e não entra na contagem).
      reason: c ? reasonText(c.reason) : t("onb.projects.chosen"),
      ...(p.outside ? { outside: p.outside } : { folder: p.folder }),
      marked: p.folder,
    };
  });
  const seen = new Set(rows.map((r) => r.key));
  for (const c of found) {
    const key = keyOf(c);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ key, name: c.name, where: c.where, reason: reasonText(c.reason), ...(c.outside ? { outside: c.outside } : { folder: c.folder }) });
  }
  return rows;
}

/** Por que a busca achou a pasta (spec #12950), o texto ao lado dela. */
export function reasonText(reason: ProjectReason): string {
  switch (reason.kind) {
    case "name":
      return t("onb.reason.name");
    case "marker":
      return t("onb.reason.marker", { marker: reason.marker });
    case "note":
      return t("onb.reason.note");
    case "inside":
      return t("onb.reason.inside", { group: reason.group });
  }
}

/** A linha de onde a busca está: procurando, achou, parou; e os lugares que o macOS não deixou ler. */
export function searchLine(view: Pick<ProjectSearchView, "state" | "found" | "skipped">): string {
  const n = view.found.length;
  const count = t("onb.search.count", { n });
  const head =
    view.state === "searching" ? t("onb.search.searching", { count })
    : view.state === "stopped" ? t("onb.search.stopped", { count })
    : view.state === "done" ? (n ? t("onb.search.found", { count }) : t("onb.search.none"))
    : "";
  if (!view.skipped.length) return head;
  return t("onb.search.skipped", { head, places: view.skipped.join(", ") }).trim();
}

/** O aviso de uma linha antes da busca (spec #12950): por que o pedido do macOS pode aparecer. */
export const searchNotice = (): string => t("onb.search.notice");

// ── Passo 8: o momento mágico (T12001) ───────────────────────────────────────────────────────────────────────────────

/** O pedido do passo 8: organizar uma nota no Modelo, sem perder nada. É o único pedido do onboarding. */
export function magicRequest(path: string): string {
  return t("onb.magic.request", { path });
}

/**
 * As notas que dá para organizar no passo 8: fora das pastas do Kiwi (as reuniões e os modelos), as mudadas por último
 * primeiro, até 50.
 */
export function magicCandidates(notes: readonly { path: string; folder: string; mtime: string }[], skip: readonly (string | null | undefined)[]): string[] {
  const out = skip.filter((s): s is string => !!s).map((s) => s.replace(/^\/+|\/+$/g, ""));
  const inside = (folder: string) => out.some((s) => folder === s || folder.startsWith(`${s}/`));
  return notes
    .filter((n) => n.path.endsWith(".md") && !inside(n.folder))
    .sort((a, b) => b.mtime.localeCompare(a.mtime))
    .slice(0, 50)
    .map((n) => n.path);
}
