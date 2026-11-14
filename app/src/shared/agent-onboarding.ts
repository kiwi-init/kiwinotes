// O onboarding do agente (spec #11955, T11993): a sequência de passos com o Kiwi-cat na primeira vez que o agente liga.
// O que a pessoa escolhe em cada passo vai direto para o lugar de sempre (as instruções, o Modelo, os projetos, a cor);
// aqui fica só onde ela está na sequência.

/** Os 9 passos, na ordem do spec. */
export const ONBOARDING_STEPS = ["claude", "control", "tone", "guardrail", "model", "projects", "color", "magic", "done"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/**
 * - `pending`: o agente ainda não foi ligado com o onboarding (ou foi ligado antes dele existir: só pelo "Refazer").
 * - `open`: o onboarding está na tela, no passo `step` (de 1 a 9). Fechar o app no meio volta ao mesmo passo.
 * - `done`: terminou ou foi fechado; só o "Refazer o onboarding" em Ajustes › Agente abre de novo.
 */
export interface AgentOnboarding {
  state: "pending" | "open" | "done";
  step: number;
}

export const DEFAULT_AGENT_ONBOARDING: AgentOnboarding = { state: "pending", step: 1 };

export function sanitizeAgentOnboarding(v: unknown): AgentOnboarding {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const state = o.state === "open" || o.state === "done" ? o.state : "pending";
  const n = typeof o.step === "number" && Number.isFinite(o.step) ? Math.trunc(o.step) : 1;
  return { state, step: Math.min(Math.max(n, 1), ONBOARDING_STEPS.length) };
}
