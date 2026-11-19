import { expect, test } from "bun:test";

import { typedLength, typingDuration, WELCOME_START, WELCOME_TEXT, welcomeNext, type WelcomeEvent, type WelcomeFlow } from "./welcomeText.ts";

const walk = (events: WelcomeEvent[], tour = true) => {
  const stages: string[] = [];
  let f: WelcomeFlow = WELCOME_START;
  for (const e of events) {
    f = welcomeNext(f, e, { tour });
    stages.push(f.stage);
  }
  return stages;
};

test("o balão é o texto do harry (#20820)", () => {
  expect(WELCOME_TEXT).toStartWith("Olá, tudo bem? Um prazer ter você aqui! Sou o Kiwi, o agente de IA do Kiwi Notes.");
  expect(WELCOME_TEXT).toEndWith("Suas notas ficam no seu Mac, seguras e protegidas. Vamos lá?");
});

test("Vamos lá: o que o Kiwi faz → permissões → consentimento → fecha (o onboarding do agente abre sozinho)", () => {
  expect(walk(["yes", "next", "next", "yes"])).toEqual(["tour", "setup", "consent", "closed"]);
  // Sem a tela do que o Kiwi faz neste build, direto às permissões.
  expect(walk(["yes", "next", "yes"], false)).toEqual(["setup", "consent", "closed"]);
  // Agora não no consentimento: fecha também, com o agente desligado.
  expect(walk(["yes", "next", "next", "no"])).toEqual(["tour", "setup", "consent", "closed"]);
});

test("Agora não: permissões → Hub, sem consentimento", () => {
  expect(walk(["no", "next"])).toEqual(["setup", "closed"]);
});

test("um evento fora de hora não pula etapa", () => {
  expect(walk(["next"])).toEqual(["welcome"]);
  expect(walk(["yes", "yes", "no"])).toEqual(["tour", "tour", "tour"]);
  expect(walk(["no", "yes", "no"])).toEqual(["setup", "setup", "setup"]);
  expect(walk(["no", "next", "yes", "next"])).toEqual(["setup", "closed", "closed", "closed"]);
});

test("o balão se escreve aos poucos, com pausa depois de cada frase, e acaba no tempo dito", () => {
  expect(typedLength(WELCOME_TEXT, 0)).toBe(0);
  const lengths = [100, 500, 1000, 2000, 4000].map((ms) => typedLength(WELCOME_TEXT, ms));
  for (let i = 1; i < lengths.length; i++) expect(lengths[i]!).toBeGreaterThan(lengths[i - 1]!);
  const end = typingDuration(WELCOME_TEXT);
  expect(end).toBeGreaterThan(4000);
  expect(end).toBeLessThan(10_000);
  expect(typedLength(WELCOME_TEXT, end - 30)).toBeLessThan(WELCOME_TEXT.length);
  expect(typedLength(WELCOME_TEXT, end)).toBe(WELCOME_TEXT.length);
  // A pausa: logo depois do "?" da primeira frase, o texto para um pouco.
  const q = WELCOME_TEXT.indexOf("?") + 1;
  let t = 0;
  while (typedLength(WELCOME_TEXT, t) < q) t += 5;
  expect(typedLength(WELCOME_TEXT, t + 300)).toBe(q);
});

test("com Reduzir movimento, o texto inteiro na hora", () => {
  expect(typedLength(WELCOME_TEXT, 0, true)).toBe(WELCOME_TEXT.length);
});
