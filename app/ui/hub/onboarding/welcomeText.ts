// A boas-vindas da primeira abertura (T20795, spec #20780): o texto do balão do Kiwi Cat (harry #20820), o ritmo em que
// ele se escreve e a ordem das telas depois dos dois botões (lead #20854). Sem React, para os testes.

/** O balão, palavra por palavra como o harry escreveu (#20820). */
export const WELCOME_TEXT =
  "Olá, tudo bem? Um prazer ter você aqui! Sou o Kiwi, o agente de IA do Kiwi Notes. Leio, organizo e te ajudo nas tarefas do dia a dia. Suas notas ficam no seu Mac, seguras e protegidas. Vamos lá?";

export const WELCOME_YES = "Vamos lá";
export const WELCOME_NO = "Agora não";

/** Letras por segundo do balão: o texto inteiro em uns 5 s. */
export const TYPE_CPS = 40;
/** A pausa a mais depois de um ponto, uma exclamação ou uma interrogação, como quem respira. */
export const TYPE_PAUSE_MS = 350;

/** Quantas letras do texto já apareceram `ms` depois de começar. Com movimento reduzido, o texto inteiro na hora. */
export function typedLength(text: string, ms: number, reduced = false): number {
  if (reduced) return text.length;
  let t = 0;
  for (let i = 0; i < text.length; i++) {
    t += 1000 / TYPE_CPS;
    if (t > ms) return i;
    if (/[.!?]/.test(text[i]!) && text[i + 1] === " ") t += TYPE_PAUSE_MS;
  }
  return text.length;
}

/** Quanto tempo o texto leva para se escrever inteiro. */
export function typingDuration(text: string): number {
  const pauses = [...text.matchAll(/[.!?] /g)].length;
  return Math.ceil((text.length * 1000) / TYPE_CPS + pauses * TYPE_PAUSE_MS);
}

/**
 * As telas da primeira abertura, na ordem do lead (#20854):
 * - **Vamos lá:** o que o Kiwi faz (T20838) → as permissões e o modelo de voz (T20796) → o consentimento (ADR 0011) →
 *   o onboarding do agente, que abre sozinho quando o agente liga.
 * - **Agora não:** as permissões e o modelo de voz → o Hub, com o agente desligado.
 */
export type WelcomeStage = "welcome" | "tour" | "setup" | "consent" | "closed";
export type WelcomeEvent = "yes" | "no" | "next";

export interface WelcomeFlow {
  stage: WelcomeStage;
  /** A pessoa disse Vamos lá: depois das permissões, o consentimento. */
  agent: boolean;
}

export const WELCOME_START: WelcomeFlow = { stage: "welcome", agent: false };

/**
 * O próximo passo. `tour`: a tela do que o Kiwi faz existe neste build. `consented`: o agente já foi aceito antes (o
 * consentimento não se repete; o "Vamos lá" liga direto).
 */
export function welcomeNext(f: WelcomeFlow, e: WelcomeEvent, o: { tour: boolean }): WelcomeFlow {
  switch (f.stage) {
    case "welcome":
      if (e === "yes") return { stage: o.tour ? "tour" : "setup", agent: true };
      if (e === "no") return { stage: "setup", agent: false };
      return f;
    case "tour":
      return e === "next" ? { ...f, stage: "setup" } : f;
    case "setup":
      return e === "next" ? { ...f, stage: f.agent ? "consent" : "closed" } : f;
    case "consent":
      return e === "yes" || e === "no" ? { ...f, stage: "closed" } : f;
    case "closed":
      return f;
  }
}
