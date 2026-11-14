// Os textos do onboarding do agente (spec #11955): o título e a frase de cada passo, a barra de progresso e o cartão
// final. TypeScript puro, testado no `bun test`.

import { ONBOARDING_STEPS, type OnboardingStep } from "../../../src/shared/agent-onboarding.ts";
import type { AgentTurnEvent, AgentVoiceUi } from "../../../src/shared/ui-contract.ts";

export const STEP_TEXT: Record<OnboardingStep, { title: string; hint: string }> = {
  claude: { title: "Oi! Vamos acordar o Claude Code", hint: "O Kiwi confere se ele está instalado e logado, baixa a ponte com ele e manda um oi para testar." },
  control: { title: "Aperta o Control e fala oi", hint: "Segure o Control, fale, e solte para mandar. O microfone só abre enquanto você segura." },
  tone: { title: "O seu jeito", hint: "Como o agente fala com você: curto ou detalhado, formal ou informal." },
  guardrail: { title: "O guardrail na prática", hint: "Escreva uma senha de mentira e veja o Kiwi esconder antes de qualquer coisa sair do Mac." },
  model: { title: "O Modelo de nota", hint: "Como o agente organiza as suas notas." },
  projects: { title: "Os seus projetos", hint: "Marque as pastas que são projetos. O Kiwi só lê os nomes, aqui no Mac." },
  color: { title: "A cor do gato", hint: "A névoa em volta dele. Dá para trocar depois em Ajustes." },
  magic: { title: "Um gostinho", hint: "Se quiser, o agente organiza uma nota sua agora, e você vê o antes e o depois." },
  done: { title: "Pronto!", hint: "É só segurar o Control." },
};

export const STEP_COUNT = ONBOARDING_STEPS.length;

/** O passo de 1 a 9, para o id. */
export const stepAt = (n: number): OnboardingStep => ONBOARDING_STEPS[Math.min(Math.max(n, 1), STEP_COUNT) - 1]!;

/** "Passo 3 de 9". */
export const progressLine = (n: number) => `Passo ${n} de ${STEP_COUNT}`;

/**
 * O passo 1 é o único que segura a pessoa (spec #11955: sem o Claude Code logado, o agente não liga). O "Pular" dele só
 * vale quando o Claude Code serve e a ponte está baixada; o teste é opcional.
 */
export function canLeaveClaude(s: { claude: { installed: boolean; loggedIn: boolean; versionOk: boolean } | null; adapter: { phase: string } }): boolean {
  return !!s.claude?.installed && s.claude.loggedIn && s.claude.versionOk && s.adapter.phase === "ready";
}

/** O jeito de falar no cartão final: a 1ª linha das instruções, curta; sem instruções, o padrão. */
export function toneSummary(instructions: string): string {
  const first = instructions.split("\n").find((l) => l.trim())?.trim() ?? "";
  if (!first) return "O padrão do agente";
  return first.length > 60 ? `${first.slice(0, 59)}…` : first;
}

/** Os projetos no cartão final: até 3 nomes e "mais N". */
export function projectsSummary(names: readonly string[]): string {
  if (!names.length) return "Nenhum ainda";
  const shown = names.slice(0, 3).join(", ");
  return names.length > 3 ? `${shown} e mais ${names.length - 3}` : shown;
}

/** O atalho no cartão final. */
export function shortcutSummary(controlShortcut: boolean): string {
  return controlShortcut ? "Segure o Control para falar" : "Ligue o Control em Ajustes › Agente";
}

// ── Passo 2: o Control (T12002) ──────────────────────────────────────────────────────────────────────────────────────


/** Onde a pessoa está no "aperta o Control e fala oi". */
export type ControlPhase = { phase: "waiting" } | { phase: "listening" } | { phase: "processing" } | { phase: "asked"; text: string; id: string } | { phase: "answered"; text: string };

/** O próximo estado do passo 2, pelo evento da fala (`agent.voice`) ou do pedido (`agent.turn`). */
export function controlStep(s: ControlPhase, e: { voice: AgentVoiceUi } | { turn: AgentTurnEvent }): ControlPhase {
  if ("voice" in e) {
    const v = e.voice;
    if (v.phase === "listening") return s.phase === "answered" ? s : { phase: "listening" };
    if (v.phase === "processing") return { phase: "processing" };
    if (v.phase === "asked") return { phase: "asked", text: v.text, id: v.id };
    return s.phase === "listening" || s.phase === "processing" ? { phase: "waiting" } : s;
  }
  const t = e.turn;
  if (s.phase === "asked" && t.id === s.id && t.type === "done") return { phase: "answered", text: s.text };
  return s;
}

/** A frase do passo 2 para o estado. */
export function controlLine(s: ControlPhase): string {
  switch (s.phase) {
    case "waiting":
      return "Segure o Control, diga \"oi\" e solte.";
    case "listening":
      return "Ouvindo… solte o Control para mandar.";
    case "processing":
      return "Entendendo o que você disse…";
    case "asked":
      return `Você disse: "${s.text}". O gato está pensando…`;
    case "answered":
      return `Deu certo! Você disse "${s.text}". Agora é só segurar o Control quando quiser.`;
  }
}

// ── Passo 3: o jeito de falar (T12002) ───────────────────────────────────────────────────────────────────────────────

export interface Tone {
  length: "curto" | "detalhado";
  register: "informal" | "formal";
}

export const DEFAULT_TONE: Tone = { length: "curto", register: "informal" };

/** O começo da linha que o onboarding cuida nas instruções: só ela muda; o resto é da pessoa. */
const TONE_PREFIX = "Jeito de falar:";

/** A linha das instruções para o jeito escolhido. */
export function toneLine(t: Tone): string {
  const len = t.length === "curto" ? "respostas curtas, direto ao ponto" : "respostas detalhadas, explicando o porquê";
  const reg = t.register === "informal" ? "tom informal, de colega" : "tom formal";
  return `${TONE_PREFIX} ${len}; ${reg}.`;
}

/** As instruções com a linha do jeito de falar trocada (ou posta no começo); as outras linhas ficam como estão. */
export function withTone(instructions: string, t: Tone): string {
  const lines = instructions.split("\n");
  const at = lines.findIndex((l) => l.trim().startsWith(TONE_PREFIX));
  if (at >= 0) {
    lines[at] = toneLine(t);
    return lines.join("\n");
  }
  return instructions.trim() ? `${toneLine(t)}\n${instructions}` : toneLine(t);
}

/** O jeito que as instruções já pedem (a linha do onboarding), ou o padrão. */
export function toneOf(instructions: string): Tone {
  const line = instructions.split("\n").find((l) => l.trim().startsWith(TONE_PREFIX));
  if (!line) return DEFAULT_TONE;
  return { length: line.includes("detalhadas") ? "detalhado" : "curto", register: line.includes("tom formal") ? "formal" : "informal" };
}

/** A resposta de exemplo, fixa, do próprio Kiwi (sem pedido ao agente), para a pergunta "o que tem de novo no projeto?". */
export function toneExample(t: Tone): string {
  if (t.length === "curto")
    return t.register === "informal"
      ? "Duas novidades: o prazo foi para abril e a Ana entrou no time. Quer que eu anote no projeto?"
      : "Há duas novidades: o prazo passou para abril e a Ana passou a integrar a equipe. Deseja que eu registre no projeto?";
  return t.register === "informal"
    ? "Teve duas coisas novas. O prazo foi para abril, porque a revisão da segurança atrasou uma semana e o time preferiu não apertar. E a Ana entrou no time: ela cuida da parte de reuniões, que estava parada. Quer que eu anote as duas no diário do projeto?"
    : "Há duas novidades. O prazo foi transferido para abril, em razão do atraso de uma semana na revisão de segurança, e a equipe optou por não comprimir o cronograma. Além disso, a Ana passou a integrar a equipe e assumirá a parte de reuniões, que estava parada. Deseja que eu registre ambas no diário do projeto?";
}

// ── Passo 6: os projetos (T11999) ────────────────────────────────────────────────────────────────────────────────────

/**
 * As pastas que podem ser projeto: as de primeiro nível do cofre, sem as escondidas e sem as do próprio Kiwi (as
 * reuniões, os modelos, o diário e os anexos), em ordem alfabética. Só os nomes, lidos no Mac.
 */
export function projectCandidates(folders: readonly string[], skip: readonly (string | null | undefined)[]): string[] {
  const out = new Set(skip.filter((s): s is string => !!s).map((s) => s.replace(/^\/+|\/+$/g, "")));
  return [...new Set(folders.map((f) => f.replace(/^\/+|\/+$/g, "")))]
    .filter((f) => f && !f.includes("/") && !f.startsWith(".") && !out.has(f))
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
}

// ── Passo 8: o momento mágico (T12001) ───────────────────────────────────────────────────────────────────────────────

/** O pedido do passo 8: organizar uma nota no Modelo, sem perder nada. É o único pedido do onboarding. */
export function magicRequest(path: string): string {
  return `Organize a nota "${path}" no Modelo de nota: leia com notes_read e reescreva com notes_write, mantendo todo o conteúdo. Mude só essa nota.`;
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
