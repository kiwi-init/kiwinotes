// Os textos do onboarding do agente (spec #11955): o título e a frase de cada passo, a barra de progresso e o cartão
// final. TypeScript puro, testado no `bun test`.

import { ONBOARDING_STEPS, type OnboardingStep } from "../../../src/shared/agent-onboarding.ts";
import { DEFAULT_SHORTCUTS, parseShortcut, shortcutLabel } from "../../../src/shared/shortcuts.ts";
import type { ProjectReason } from "../../../src/notes/project-finder.ts";
import type { ProjectInfo } from "../../../src/notes/projects.ts";
import type { AgentTurnEvent, AgentVoiceUi, ProjectCandidate, ProjectSearchView } from "../../../src/shared/ui-contract.ts";

export const STEP_TEXT: Record<OnboardingStep, { title: string; hint: string }> = {
  claude: { title: "Oi! Vamos acordar o Claude Code", hint: "O Kiwi confere se ele está instalado e logado, baixa a ponte com ele e manda um oi para testar." },
  // Sem subtítulo (revisão do T13145): o cartão (que leva o aviso do microfone) e a frase embaixo já dizem como.
  control: { title: "Aperta o Control e fala oi", hint: "" },
  tone: { title: "O seu jeito", hint: "Como o agente fala com você: curto ou detalhado, formal ou informal." },
  guardrail: { title: "O guardrail na prática", hint: "Escreva uma senha de mentira e veja o Kiwi esconder antes de qualquer coisa sair do Mac." },
  model: { title: "O Modelo de nota", hint: "Como o agente organiza as suas notas." },
  projects: { title: "Os seus projetos", hint: "Marque as pastas que são projetos. O Kiwi só lê os nomes, aqui no Mac." },
  color: { title: "Escolha a cor do Kiwi Cat!", hint: "A névoa em volta dele. Dá para trocar depois em Ajustes." },
  place: { title: "Onde o Kiwi Cat aparece", hint: "Por cima dos outros apps, enquanto o agente trabalha: escolha o canto e o tamanho. Dá para trocar depois em Ajustes." },
  magic: { title: "Um gostinho", hint: "Se quiser, o agente organiza uma nota sua agora, e você vê o antes e o depois." },
  done: { title: "Pronto!", hint: "É só segurar o Control." },
};

export const STEP_COUNT = ONBOARDING_STEPS.length;

/** O passo de 1 a 10, para o id. */
export const stepAt = (n: number): OnboardingStep => ONBOARDING_STEPS[Math.min(Math.max(n, 1), STEP_COUNT) - 1]!;

/** "Passo 3 de 10". */
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

/** Como as frases chamam o atalho do Kiwi Cat (spec #12946): "o Control", "o ⌥ direito", ou a combinação ("⌃⌥Espaço"). */
export function holdName(text: string | null | undefined): string {
  const t = text ?? DEFAULT_SHORTCUTS.agent!;
  return parseShortcut(t)?.kind === "key" ? `o ${shortcutLabel(t)}` : shortcutLabel(t);
}

/** O texto do passo, com o atalho escolhido no lugar do Control (spec #12946). */
export function stepText(step: OnboardingStep, hold = "o Control"): { title: string; hint: string } {
  const t = STEP_TEXT[step];
  return { title: t.title.replaceAll("o Control", hold), hint: t.hint.replaceAll("o Control", hold) };
}

/** O atalho no cartão final. */
export function shortcutSummary(controlShortcut: boolean, hold = "o Control"): string {
  return controlShortcut ? `Segure ${hold} para falar` : "Ligue o Kiwi Cat em Ajustes › Agente";
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
export function controlLine(s: ControlPhase, hold = "o Control"): string {
  switch (s.phase) {
    case "waiting":
      return `Segure ${hold}, diga "oi" e solte.`;
    case "listening":
      return `Ouvindo… solte ${hold} para mandar.`;
    case "processing":
      return "Entendendo o que você disse…";
    case "asked":
      return `Você disse: "${s.text}". O gato está pensando…`;
    case "answered":
      return `Deu certo! Você disse "${s.text}". Agora é só segurar ${hold} quando quiser.`;
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
      where: c?.where ?? p.outside ?? `Notas/${p.folder}`,
      // O que a busca não achou foi a pessoa que marcou: a linha diz isso no lugar do motivo (e não entra na contagem).
      reason: c ? reasonText(c.reason) : "escolhida por você",
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
      return "o nome diz projeto";
    case "marker":
      return `tem ${reason.marker}`;
    case "note":
      return "tem a nota do projeto";
    case "inside":
      return `dentro de ${reason.group}`;
  }
}

/** A linha de onde a busca está: procurando, achou, parou; e os lugares que o macOS não deixou ler. */
export function searchLine(view: Pick<ProjectSearchView, "state" | "found" | "skipped">): string {
  const n = view.found.length;
  const count = n === 1 ? "1 pasta" : `${n} pastas`;
  const head =
    view.state === "searching" ? `Procurando… ${count} até agora.`
    : view.state === "stopped" ? `Parei a busca: ${count}.`
    : view.state === "done" ? (n ? `Achei ${count}.` : "Não achei nenhuma pasta de projeto.")
    : "";
  if (!view.skipped.length) return head;
  return `${head} Ficaram de fora, sem permissão: ${view.skipped.join(", ")}.`.trim();
}

/** O aviso de uma linha antes da busca (spec #12950): por que o pedido do macOS pode aparecer. */
export const SEARCH_NOTICE =
  "Para procurar em Documents, Desktop e no iCloud Drive, o macOS pode pedir permissão uma vez. O Kiwi só lê os nomes das pastas, e nada sai do Mac.";

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
