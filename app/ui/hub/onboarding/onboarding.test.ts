// Os textos do onboarding (spec #11955, T11993).

import { expect, test } from "bun:test";

import { ONBOARDING_STEPS } from "../../../src/shared/agent-onboarding.ts";
import { holdName, stepText, canLeaveClaude, magicCandidates, magicRequest, projectCandidates, controlLine, controlStep, type ControlPhase, DEFAULT_TONE, toneExample, toneOf, withTone, progressLine, projectsSummary, shortcutSummary, STEP_COUNT, STEP_TEXT, stepAt, toneSummary } from "./onboardingText.ts";

test("os 9 passos na ordem do spec, cada um com título e frase (o do Control, sem subtítulo: a frase é a do cartão)", () => {
  expect(STEP_COUNT).toBe(9);
  expect(ONBOARDING_STEPS.map((s) => STEP_TEXT[s].title.length > 0 && (s === "control" || STEP_TEXT[s].hint.length > 0))).toEqual(Array(9).fill(true));
  expect(STEP_TEXT.control.hint).toBe("");
  expect([stepAt(1), stepAt(4), stepAt(9), stepAt(0), stepAt(12)]).toEqual(["claude", "guardrail", "done", "claude", "done"]);
  expect(progressLine(3)).toBe("Passo 3 de 9");
});

test("o passo 1 só deixa seguir com o Claude Code logado e a ponte baixada", () => {
  const ok = { claude: { installed: true, loggedIn: true, versionOk: true }, adapter: { phase: "ready" } };
  expect(canLeaveClaude(ok)).toBe(true);
  expect(canLeaveClaude({ ...ok, adapter: { phase: "missing" } })).toBe(false);
  expect(canLeaveClaude({ ...ok, claude: { ...ok.claude, loggedIn: false } })).toBe(false);
  expect(canLeaveClaude({ ...ok, claude: null })).toBe(false);
});

test("o cartão final: o jeito de falar, os projetos e o atalho", () => {
  expect(toneSummary("")).toBe("O padrão do agente");
  expect(toneSummary("\nRespostas curtas, informal.\nOutra linha")).toBe("Respostas curtas, informal.");
  expect(toneSummary("x".repeat(80))).toHaveLength(60);
  expect(projectsSummary([])).toBe("Nenhum ainda");
  expect(projectsSummary(["Kiwi", "PACS"])).toBe("Kiwi, PACS");
  expect(projectsSummary(["A", "B", "C", "D", "E"])).toBe("A, B, C e mais 2");
  expect(shortcutSummary(true)).toBe("Segure o Control para falar");
  expect(shortcutSummary(false)).toBe("Ligue o Kiwi Cat em Ajustes › Agente");
  // O atalho escolhido (spec #12946) nas frases.
  expect(holdName("control")).toBe("o Control");
  expect(holdName("rightOption")).toBe("o ⌥ direito");
  expect(holdName("control+option+space")).toBe("⌃⌥ Espaço");
  expect(shortcutSummary(true, holdName("rightOption"))).toBe("Segure o ⌥ direito para falar");
  expect(stepText("control", "o ⌥ direito").title).toBe("Aperta o ⌥ direito e fala oi");
  expect(stepText("control").title).toBe("Aperta o Control e fala oi");
  expect(controlLine({ phase: "waiting" }, "⌃⌥ Espaço")).toBe('Segure ⌃⌥ Espaço, diga "oi" e solte. O microfone só abre enquanto você segura.');
});

test("o passo 2: a fala pelo Control vai de esperando a ouvindo, pedido e resposta", () => {
  let s: ControlPhase = { phase: "waiting" };
  s = controlStep(s, { voice: { phase: "listening", voz: 0.4 } });
  expect(s).toEqual({ phase: "listening" });
  expect(controlStep(s, { voice: { phase: "idle", cancelled: true } })).toEqual({ phase: "waiting" });
  s = controlStep(s, { voice: { phase: "processing" } });
  s = controlStep(s, { voice: { phase: "asked", text: "oi", id: "p1" } });
  expect(controlLine(s)).toContain('Você disse: "oi"');
  // A resposta de outro pedido não conta.
  expect(controlStep(s, { turn: { id: "p0", type: "done", text: "", stopReason: "end_turn" } as never })).toEqual(s);
  s = controlStep(s, { turn: { id: "p1", type: "done", text: "Oi!", stopReason: "end_turn" } as never });
  expect(s).toEqual({ phase: "answered", text: "oi" });
  // Depois de dar certo, segurar de novo não apaga o "deu certo".
  expect(controlStep(s, { voice: { phase: "listening", voz: 0.2 } })).toEqual(s);
  expect(controlLine({ phase: "waiting" })).toBe('Segure o Control, diga "oi" e solte. O microfone só abre enquanto você segura.');
});

test("o passo 3: o jeito de falar troca só a linha dele nas instruções, e o exemplo muda com a escolha", () => {
  expect(withTone("", DEFAULT_TONE)).toBe("Jeito de falar: respostas curtas, direto ao ponto; tom informal, de colega.");
  const mine = "Sempre em português.\nNão mexa na pasta Arquivo.";
  const a = withTone(mine, { length: "detalhado", register: "formal" });
  expect(a).toBe(`Jeito de falar: respostas detalhadas, explicando o porquê; tom formal.\n${mine}`);
  const b = withTone(a, DEFAULT_TONE);
  expect(b.split("\n")).toHaveLength(3);
  expect(b).toEndWith(mine);
  expect(toneOf(a)).toEqual({ length: "detalhado", register: "formal" });
  expect(toneOf(b)).toEqual(DEFAULT_TONE);
  expect(toneOf(mine)).toEqual(DEFAULT_TONE);
  const examples = new Set(
    (["curto", "detalhado"] as const).flatMap((length) => (["informal", "formal"] as const).map((register) => toneExample({ length, register }))),
  );
  expect(examples.size).toBe(4);
  expect(toneExample({ length: "curto", register: "informal" }).length).toBeLessThan(toneExample({ length: "detalhado", register: "informal" }).length);
});

test("o passo 6: só as pastas de primeiro nível, sem as escondidas e sem as do Kiwi, em ordem", () => {
  const folders = ["Projetos", "Projetos/Kiwi", "Reuniões", ".kiwi", "Modelos", "Diário", "anexos", "Clientes", "Ávila", "Clientes"];
  expect(projectCandidates(folders, ["Reuniões", "Modelos", "Diário", "anexos", null])).toEqual(["Ávila", "Clientes", "Projetos"]);
  expect(projectCandidates([], [])).toEqual([]);
});

test("o passo 8: o pedido nomeia a nota, e a lista deixa de fora as reuniões e os modelos", () => {
  expect(magicRequest("Ideias/Gato.md")).toStartWith('Organize a nota "Ideias/Gato.md" no Modelo de nota:');
  const notes = [
    { path: "Ideias/Gato.md", folder: "Ideias", mtime: "2026-11-10T10:00:00Z" },
    { path: "Reuniões/Orçamento.md", folder: "Reuniões", mtime: "2026-11-12T10:00:00Z" },
    { path: "Reuniões/2026/Kickoff.md", folder: "Reuniões/2026", mtime: "2026-11-12T11:00:00Z" },
    { path: "Modelos/Ata.md", folder: "Modelos", mtime: "2026-11-11T10:00:00Z" },
    { path: "Kiwi/Kiwi.md", folder: "Kiwi", mtime: "2026-11-13T10:00:00Z" },
    { path: "Desenho.canvas", folder: "", mtime: "2026-11-14T10:00:00Z" },
  ];
  expect(magicCandidates(notes, ["Reuniões", "Modelos", null])).toEqual(["Kiwi/Kiwi.md", "Ideias/Gato.md"]);
});
